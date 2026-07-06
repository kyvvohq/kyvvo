const fastify = require('fastify')({ logger: true });
const jwt = require('@fastify/jwt');
const cors = require('@fastify/cors');
const staticPlugin = require('@fastify/static');
const path = require('path');
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');

const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) throw new Error('JWT_SECRET não configurado');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function start() {
  await fastify.register(cors, { origin: true });
  await fastify.register(jwt, { secret: JWT_SECRET });
  await fastify.register(staticPlugin, {
    root: path.join(__dirname, 'public'),
    prefix: '/',
  });

  fastify.decorate('authenticate', async (request, reply) => {
    try {
      await request.jwtVerify();
    } catch (err) {
      return reply.code(401).send({ error: 'Não autenticado' });
    }

    const { rows } = await pool.query(
      'SELECT token_version FROM usuarios WHERE id = $1',
      [request.user.userId]
    );
    const usuario = rows[0];
    if (!usuario || usuario.token_version !== request.user.tokenVersion) {
      return reply.code(401).send({ error: 'Sessão expirada. Faça login novamente.' });
    }
  });

  // ---------- Auth ----------
  fastify.post('/api/auth/login', async (request, reply) => {
    const { email, senha } = request.body || {};
    if (!email || !senha) {
      return reply.code(400).send({ error: 'E-mail e senha são obrigatórios' });
    }

    const { rows } = await pool.query(
      'SELECT id, tenant_id, email, senha_hash, nome, token_version FROM usuarios WHERE email = $1',
      [email.toLowerCase().trim()]
    );
    const usuario = rows[0];
    if (!usuario) {
      return reply.code(401).send({ error: 'E-mail ou senha inválidos' });
    }

    const senhaValida = await bcrypt.compare(senha, usuario.senha_hash);
    if (!senhaValida) {
      return reply.code(401).send({ error: 'E-mail ou senha inválidos' });
    }

    const token = fastify.jwt.sign(
      { userId: usuario.id, tenantId: usuario.tenant_id, email: usuario.email, tokenVersion: usuario.token_version },
      { expiresIn: '7d' }
    );

    return { token, nome: usuario.nome, email: usuario.email };
  });

  // Invalida o token atual (e qualquer outro emitido antes dele) incrementando
  // token_version: como o JWT é stateless, é essa comparação em `authenticate`
  // que faz o logout ter efeito imediato no servidor, e não só no cliente.
  fastify.post('/api/auth/logout', { preHandler: [fastify.authenticate] }, async (request) => {
    await pool.query(
      'UPDATE usuarios SET token_version = token_version + 1 WHERE id = $1',
      [request.user.userId]
    );
    return { ok: true };
  });

  // ---------- Agenda ----------
  fastify.get('/api/agendamentos', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenantId } = request.user;
    const { view, data } = request.query;

    if (view === 'dia') {
      const dataRef = data || new Date().toISOString().slice(0, 10);
      const { rows } = await pool.query(
        `SELECT a.id, a.data_hora, a.status, a.encaixe, c.nome AS cliente, c.telefone AS cliente_telefone,
                a.profissional_id, p.nome AS profissional, a.servico_id, s.nome AS servico, s.duracao_minutos
         FROM agendamentos a
         JOIN clientes c ON c.id = a.cliente_id
         JOIN profissionais p ON p.id = a.profissional_id
         JOIN servicos s ON s.id = a.servico_id
         WHERE a.tenant_id = $1 AND a.data_hora::date = $2::date
         ORDER BY a.data_hora`,
        [tenantId, dataRef]
      );
      return { view: 'dia', data: dataRef, agendamentos: rows };
    }

    if (view === 'semana') {
      const dataRef = data || new Date().toISOString().slice(0, 10);
      const { rows } = await pool.query(
        `SELECT a.id, a.data_hora, a.status, a.encaixe, c.nome AS cliente,
                a.profissional_id, p.nome AS profissional, a.servico_id, s.nome AS servico, s.duracao_minutos
         FROM agendamentos a
         JOIN clientes c ON c.id = a.cliente_id
         JOIN profissionais p ON p.id = a.profissional_id
         JOIN servicos s ON s.id = a.servico_id
         WHERE a.tenant_id = $1
           AND a.data_hora::date >= date_trunc('week', $2::date)
           AND a.data_hora::date < date_trunc('week', $2::date) + interval '7 days'
         ORDER BY a.data_hora`,
        [tenantId, dataRef]
      );
      return { view: 'semana', data: dataRef, agendamentos: rows };
    }

    if (view === 'mes') {
      const mesRef = data || new Date().toISOString().slice(0, 7); // YYYY-MM
      const { rows } = await pool.query(
        `SELECT a.data_hora::date AS dia, COUNT(*)::int AS total
         FROM agendamentos a
         WHERE a.tenant_id = $1
           AND to_char(a.data_hora, 'YYYY-MM') = $2
         GROUP BY a.data_hora::date
         ORDER BY dia`,
        [tenantId, mesRef]
      );
      return { view: 'mes', mes: mesRef, contagemPorDia: rows };
    }

    return reply.code(400).send({ error: 'Parâmetro "view" deve ser dia, semana ou mes' });
  });

  fastify.patch('/api/agendamentos/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenantId } = request.user;
    const { id } = request.params;
    const { status, data_hora: dataHora } = request.body || {};

    if (status === undefined && dataHora === undefined) {
      return reply.code(400).send({ error: 'Informe "status" e/ou "data_hora" para atualizar' });
    }
    if (status !== undefined && !['confirmado', 'cancelado', 'reagendado'].includes(status)) {
      return reply.code(400).send({ error: 'status inválido' });
    }

    const { rows: atuais } = await pool.query(
      `SELECT a.id, a.profissional_id, s.duracao_minutos, p.nome AS profissional
       FROM agendamentos a
       JOIN servicos s ON s.id = a.servico_id
       JOIN profissionais p ON p.id = a.profissional_id
       WHERE a.id = $1 AND a.tenant_id = $2`,
      [id, tenantId]
    );
    const atual = atuais[0];
    if (!atual) {
      return reply.code(404).send({ error: 'Agendamento não encontrado' });
    }

    if (dataHora !== undefined) {
      const { rows: conflitos } = await pool.query(
        `SELECT a.id
         FROM agendamentos a
         JOIN servicos s ON s.id = a.servico_id
         WHERE a.tenant_id = $1
           AND a.profissional_id = $2
           AND a.status = 'confirmado'
           AND a.id <> $3
           AND a.data_hora < $4::timestamptz + ($5 * interval '1 minute')
           AND $4::timestamptz < a.data_hora + (s.duracao_minutos * interval '1 minute')`,
        [tenantId, atual.profissional_id, id, dataHora, atual.duracao_minutos]
      );
      if (conflitos.length > 0) {
        return reply.code(409).send({
          error: `Conflito de horário: ${atual.profissional} já tem agendamento neste período.`,
        });
      }
    }

    await pool.query(
      `UPDATE agendamentos SET
         status = COALESCE($2, status),
         data_hora = COALESCE($3, data_hora),
         updated_at = now()
       WHERE id = $1`,
      [id, status ?? null, dataHora ?? null]
    );

    const { rows: detalhado } = await pool.query(
      `SELECT a.id, a.data_hora, a.status, a.encaixe, a.updated_at,
              c.nome AS cliente, c.telefone AS cliente_telefone,
              p.nome AS profissional, s.nome AS servico, s.duracao_minutos
       FROM agendamentos a
       JOIN clientes c ON c.id = a.cliente_id
       JOIN profissionais p ON p.id = a.profissional_id
       JOIN servicos s ON s.id = a.servico_id
       WHERE a.id = $1`,
      [id]
    );

    return detalhado[0];
  });

  const HORARIO_ABERTURA_HORA = 8;
  const HORARIO_FECHAMENTO_HORA = 20;
  const SLOT_INTERVALO_MINUTOS = 30;

  fastify.get('/api/agendamentos/disponibilidade', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenantId } = request.user;
    const { data, profissional, servico } = request.query;

    if (!data || !profissional || !servico) {
      return reply.code(400).send({ error: 'Parâmetros "data", "profissional" e "servico" são obrigatórios' });
    }

    const { rows: servicoRows } = await pool.query(
      'SELECT duracao_minutos FROM servicos WHERE id = $1 AND tenant_id = $2',
      [servico, tenantId]
    );
    const servicoInfo = servicoRows[0];
    if (!servicoInfo) {
      return reply.code(404).send({ error: 'Serviço não encontrado' });
    }

    const { rows: ocupados } = await pool.query(
      `SELECT a.data_hora, s.duracao_minutos
       FROM agendamentos a
       JOIN servicos s ON s.id = a.servico_id
       WHERE a.tenant_id = $1 AND a.profissional_id = $2
         AND a.status = 'confirmado'
         AND a.data_hora::date = $3::date`,
      [tenantId, profissional, data]
    );

    const duracaoMinutos = servicoInfo.duracao_minutos;
    const slots = [];
    for (
      let minutos = HORARIO_ABERTURA_HORA * 60;
      minutos + duracaoMinutos <= HORARIO_FECHAMENTO_HORA * 60;
      minutos += SLOT_INTERVALO_MINUTOS
    ) {
      const inicioSlot = new Date(`${data}T00:00:00`);
      inicioSlot.setMinutes(inicioSlot.getMinutes() + minutos);
      const fimSlot = new Date(inicioSlot.getTime() + duracaoMinutos * 60000);

      const conflita = ocupados.some((o) => {
        const inicioOcupado = new Date(o.data_hora);
        const fimOcupado = new Date(inicioOcupado.getTime() + o.duracao_minutos * 60000);
        return inicioSlot < fimOcupado && inicioOcupado < fimSlot;
      });

      slots.push({ hora: inicioSlot.toISOString(), disponivel: !conflita });
    }

    return { data, profissional, servico, duracaoMinutos, slots };
  });

  fastify.get('/api/servicos', { preHandler: [fastify.authenticate] }, async (request) => {
    const { tenantId } = request.user;
    const { rows } = await pool.query(
      'SELECT id, nome, duracao_minutos FROM servicos WHERE tenant_id = $1 ORDER BY nome',
      [tenantId]
    );
    return { servicos: rows };
  });

  fastify.post('/api/agendamentos', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenantId } = request.user;
    const {
      cliente_nome: clienteNome,
      cliente_telefone: clienteTelefone,
      profissional_id: profissionalId,
      servico_id: servicoId,
      data_hora: dataHora,
      encaixe,
    } = request.body || {};

    if (!clienteTelefone || !profissionalId || !servicoId || !dataHora) {
      return reply.code(400).send({
        error: 'Campos "cliente_telefone", "profissional_id", "servico_id" e "data_hora" são obrigatórios',
      });
    }

    const { rows: servicoRows } = await pool.query(
      'SELECT duracao_minutos FROM servicos WHERE id = $1 AND tenant_id = $2',
      [servicoId, tenantId]
    );
    const servicoInfo = servicoRows[0];
    if (!servicoInfo) {
      return reply.code(404).send({ error: 'Serviço não encontrado' });
    }

    const { rows: profissionalRows } = await pool.query(
      'SELECT nome FROM profissionais WHERE id = $1 AND tenant_id = $2',
      [profissionalId, tenantId]
    );
    const profissionalInfo = profissionalRows[0];
    if (!profissionalInfo) {
      return reply.code(404).send({ error: 'Profissional não encontrado' });
    }

    // Encaixe é uma exceção manual feita pela dona do salão: sobrepor um
    // horário já ocupado é o próprio propósito da funcionalidade (procedimentos
    // simples/rápidos encaixados ao lado de um atendimento já agendado), então
    // a validação de conflito só se aplica a agendamentos normais.
    if (!encaixe) {
      const { rows: conflitos } = await pool.query(
        `SELECT a.id
         FROM agendamentos a
         JOIN servicos s ON s.id = a.servico_id
         WHERE a.tenant_id = $1
           AND a.profissional_id = $2
           AND a.status = 'confirmado'
           AND a.data_hora < $3::timestamptz + ($4 * interval '1 minute')
           AND $3::timestamptz < a.data_hora + (s.duracao_minutos * interval '1 minute')`,
        [tenantId, profissionalId, dataHora, servicoInfo.duracao_minutos]
      );
      if (conflitos.length > 0) {
        return reply.code(409).send({
          error: `Conflito de horário: ${profissionalInfo.nome} já tem agendamento neste período.`,
        });
      }
    }

    const { rows: clienteRows } = await pool.query(
      `INSERT INTO clientes (tenant_id, nome, telefone)
       VALUES ($1, $2, $3)
       ON CONFLICT (tenant_id, telefone) DO UPDATE SET nome = COALESCE(EXCLUDED.nome, clientes.nome)
       RETURNING id`,
      [tenantId, clienteNome || null, clienteTelefone]
    );
    const clienteId = clienteRows[0].id;

    const { rows: criado } = await pool.query(
      `INSERT INTO agendamentos (tenant_id, cliente_id, profissional_id, servico_id, data_hora, encaixe)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [tenantId, clienteId, profissionalId, servicoId, dataHora, !!encaixe]
    );

    const { rows: detalhado } = await pool.query(
      `SELECT a.id, a.data_hora, a.status, a.encaixe, a.updated_at,
              a.profissional_id, p.nome AS profissional,
              a.servico_id, s.nome AS servico, s.duracao_minutos,
              c.nome AS cliente, c.telefone AS cliente_telefone
       FROM agendamentos a
       JOIN clientes c ON c.id = a.cliente_id
       JOIN profissionais p ON p.id = a.profissional_id
       JOIN servicos s ON s.id = a.servico_id
       WHERE a.id = $1`,
      [criado[0].id]
    );

    reply.code(201);
    return detalhado[0];
  });

  // ---------- Perfil ----------
  fastify.get('/api/perfil', { preHandler: [fastify.authenticate] }, async (request) => {
    const { tenantId } = request.user;
    const { rows } = await pool.query(
      'SELECT id, nome, telefone, endereco, criado_em FROM tenants WHERE id = $1',
      [tenantId]
    );
    return rows[0];
  });

  fastify.patch('/api/perfil', { preHandler: [fastify.authenticate] }, async (request) => {
    const { tenantId } = request.user;
    const { nome, telefone, endereco } = request.body || {};
    const { rows } = await pool.query(
      `UPDATE tenants SET
         nome = COALESCE($2, nome),
         telefone = COALESCE($3, telefone),
         endereco = COALESCE($4, endereco)
       WHERE id = $1
       RETURNING id, nome, telefone, endereco`,
      [tenantId, nome, telefone, endereco]
    );
    return rows[0];
  });

  // ---------- Configuração ----------
  fastify.get('/api/configuracao', { preHandler: [fastify.authenticate] }, async (request) => {
    const { tenantId } = request.user;
    const { rows } = await pool.query(
      'SELECT dias_funcionamento, formato_hora FROM tenants WHERE id = $1',
      [tenantId]
    );
    return rows[0];
  });

  fastify.patch('/api/configuracao', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenantId } = request.user;
    const { diasFuncionamento, formatoHora } = request.body || {};

    if (formatoHora && !['24h', '12h'].includes(formatoHora)) {
      return reply.code(400).send({ error: 'formatoHora deve ser "24h" ou "12h"' });
    }
    if (diasFuncionamento && (!Array.isArray(diasFuncionamento) || diasFuncionamento.some((d) => d < 0 || d > 6))) {
      return reply.code(400).send({ error: 'diasFuncionamento deve ser uma lista de números de 0 a 6' });
    }

    const { rows } = await pool.query(
      `UPDATE tenants SET
         dias_funcionamento = COALESCE($2, dias_funcionamento),
         formato_hora = COALESCE($3, formato_hora)
       WHERE id = $1
       RETURNING dias_funcionamento, formato_hora`,
      [tenantId, diasFuncionamento ? JSON.stringify(diasFuncionamento) : null, formatoHora]
    );
    return rows[0];
  });

  await fastify.listen({ port: PORT, host: '0.0.0.0' });
  console.log(`Painel Kyvvo rodando na porta ${PORT}`);
}

start().catch((err) => {
  console.error(err);
  process.exit(1);
});
