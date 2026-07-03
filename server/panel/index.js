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
      reply.code(401).send({ error: 'Não autenticado' });
    }
  });

  // ---------- Auth ----------
  fastify.post('/api/auth/login', async (request, reply) => {
    const { email, senha } = request.body || {};
    if (!email || !senha) {
      return reply.code(400).send({ error: 'E-mail e senha são obrigatórios' });
    }

    const { rows } = await pool.query(
      'SELECT id, tenant_id, email, senha_hash, nome FROM usuarios WHERE email = $1',
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
      { userId: usuario.id, tenantId: usuario.tenant_id, email: usuario.email },
      { expiresIn: '7d' }
    );

    return { token, nome: usuario.nome, email: usuario.email };
  });

  // ---------- Agenda ----------
  fastify.get('/api/agendamentos', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenantId } = request.user;
    const { view, data } = request.query;

    if (view === 'dia') {
      const dataRef = data || new Date().toISOString().slice(0, 10);
      const { rows } = await pool.query(
        `SELECT a.id, a.data_hora, a.status, c.nome AS cliente, c.telefone AS cliente_telefone,
                p.nome AS profissional, s.nome AS servico, s.duracao_minutos
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
        `SELECT a.id, a.data_hora, a.status, c.nome AS cliente,
                p.nome AS profissional, s.nome AS servico, s.duracao_minutos
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
