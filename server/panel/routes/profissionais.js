// CRUD de Profissionais (US17/ST17.2) — extraído de index.js (fase 2 da
// modularização).
const { garantirProfissionalPadrao } = require('../lib/profissionais');

async function definirServicosDoProfissional(client, tenantId, profissionalId, servicoIds) {
  if (!Array.isArray(servicoIds)) return;
  // Só vincula serviços que realmente pertencem a este tenant — evita que
  // um id de outro tenant seja injetado no vínculo.
  await client.query('DELETE FROM profissionais_servicos WHERE profissional_id = $1', [profissionalId]);
  if (servicoIds.length === 0) return;
  await client.query(
    `INSERT INTO profissionais_servicos (profissional_id, servico_id)
     SELECT $1, s.id FROM servicos s WHERE s.tenant_id = $2 AND s.id = ANY($3::uuid[])`,
    [profissionalId, tenantId, servicoIds]
  );
}

function registerProfissionaisRoutes(fastify, pool) {
  // Lista de profissionais do tenant, usada para popular o dropdown do
  // formulário de novo agendamento (ST09.2 / US09). Inclui os ids dos
  // serviços que cada um atende, usado na tela de gestão (US17/ST17.4).
  fastify.get('/api/profissionais', { preHandler: [fastify.authenticate] }, async (request) => {
    const { tenantId } = request.user;
    await garantirProfissionalPadrao(tenantId);
    const { rows } = await pool.query(
      `SELECT p.id, p.nome,
              COALESCE(array_agg(ps.servico_id) FILTER (WHERE ps.servico_id IS NOT NULL), '{}') AS servicos
       FROM profissionais p
       LEFT JOIN profissionais_servicos ps ON ps.profissional_id = p.id
       WHERE p.tenant_id = $1
       GROUP BY p.id, p.nome
       ORDER BY p.nome`,
      [tenantId]
    );
    return { profissionais: rows };
  });

  fastify.post('/api/profissionais', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenantId } = request.user;
    const { nome, servicos } = request.body || {};

    if (!nome || !nome.trim()) {
      return reply.code(400).send({ error: 'Campo "nome" é obrigatório' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        'INSERT INTO profissionais (tenant_id, nome) VALUES ($1, $2) RETURNING id, nome',
        [tenantId, nome.trim()]
      );
      await definirServicosDoProfissional(client, tenantId, rows[0].id, servicos);
      await client.query('COMMIT');
      reply.code(201);
      return { ...rows[0], servicos: servicos || [] };
    } catch (erro) {
      await client.query('ROLLBACK');
      throw erro;
    } finally {
      client.release();
    }
  });

  fastify.patch('/api/profissionais/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenantId } = request.user;
    const { id } = request.params;
    const { nome, servicos } = request.body || {};

    if (nome !== undefined && !nome.trim()) {
      return reply.code(400).send({ error: 'Campo "nome" não pode ficar vazio' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `UPDATE profissionais SET nome = COALESCE($3, nome)
         WHERE id = $1 AND tenant_id = $2
         RETURNING id, nome`,
        [id, tenantId, nome ? nome.trim() : null]
      );
      if (!rows[0]) {
        await client.query('ROLLBACK');
        return reply.code(404).send({ error: 'Profissional não encontrado' });
      }
      await definirServicosDoProfissional(client, tenantId, id, servicos);
      await client.query('COMMIT');
      return { ...rows[0], servicos: servicos !== undefined ? servicos : undefined };
    } catch (erro) {
      await client.query('ROLLBACK');
      throw erro;
    } finally {
      client.release();
    }
  });

  fastify.delete('/api/profissionais/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenantId } = request.user;
    const { id } = request.params;

    // ST17.5 — mesma proteção do DELETE de serviço.
    const { rows: futuros } = await pool.query(
      `SELECT COUNT(*)::int AS total FROM agendamentos
       WHERE tenant_id = $1 AND profissional_id = $2 AND status = 'confirmado' AND data_hora > now()`,
      [tenantId, id]
    );
    if (futuros[0].total > 0) {
      return reply.code(409).send({
        error: `Não é possível excluir: há ${futuros[0].total} agendamento(s) futuro(s) com este profissional.`,
      });
    }

    const { rowCount } = await pool.query('DELETE FROM profissionais WHERE id = $1 AND tenant_id = $2', [id, tenantId]);
    if (!rowCount) {
      return reply.code(404).send({ error: 'Profissional não encontrado' });
    }
    return { ok: true };
  });
}

module.exports = { registerProfissionaisRoutes };
