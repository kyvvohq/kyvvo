// Área admin da Kyvvo — Números prontos (US39.2, "plano Novo número") —
// extraído de index.js (fase 9 da modularização): GET/POST
// /admin/api/numeros-prontos, POST /:id/vincular, POST /:id/testar.
// Inventário de números adquiridos manualmente pela operação (fora do
// repositório, ver US40) que um admin cadastra aqui, vincula a um salão e
// testa antes de considerar operacional. Vincular só copia
// meta_phone_number_id/meta_waba_id pra tenants — o resto (status/webhook
// via Cloud API) já funciona igual ao self-service (Embedded Signup).
const metaWhatsappService = require('../meta-whatsapp-service');

function registerAdminNumerosProntosRoutes(fastify, pool) {
  fastify.get('/admin/api/numeros-prontos', { preHandler: [fastify.authenticateAdmin] }, async () => {
    const { rows } = await pool.query(
      `SELECT n.*, t.nome AS tenant_nome
       FROM numeros_prontos n
       LEFT JOIN tenants t ON t.id = n.tenant_id
       ORDER BY n.criado_em DESC`
    );
    return { numeros: rows };
  });

  fastify.post('/admin/api/numeros-prontos', { preHandler: [fastify.authenticateAdmin] }, async (request, reply) => {
    const { telefone, meta_phone_number_id: metaPhoneNumberId, meta_waba_id: metaWabaId } = request.body || {};
    if (!telefone || !metaPhoneNumberId || !metaWabaId) {
      return reply.code(400).send({ error: 'Informe telefone, meta_phone_number_id e meta_waba_id.' });
    }

    try {
      const { rows } = await pool.query(
        `INSERT INTO numeros_prontos (telefone, meta_phone_number_id, meta_waba_id, criado_por)
         VALUES ($1, $2, $3, $4) RETURNING *`,
        [telefone.trim(), metaPhoneNumberId.trim(), metaWabaId.trim(), request.admin.adminId]
      );
      reply.code(201);
      return rows[0];
    } catch (erro) {
      if (erro.code === '23505') {
        return reply.code(409).send({ error: 'Esse Phone Number ID já está cadastrado.' });
      }
      throw erro;
    }
  });

  // CA (US39.2) — vincula um número disponível a um salão: grava o tenant no
  // registro do número e propaga meta_phone_number_id/meta_waba_id pra
  // tenants, mesmas colunas usadas pelo self-service (033/034), pra todo o
  // resto da integração (status, webhook) funcionar sem distinção.
  fastify.post('/admin/api/numeros-prontos/:id/vincular', { preHandler: [fastify.authenticateAdmin] }, async (request, reply) => {
    const { id } = request.params;
    const { tenant_id: tenantId } = request.body || {};
    if (!tenantId) {
      return reply.code(400).send({ error: 'Informe tenant_id.' });
    }

    const { rows: numeroRows } = await pool.query('SELECT * FROM numeros_prontos WHERE id = $1', [id]);
    const numero = numeroRows[0];
    if (!numero) {
      return reply.code(404).send({ error: 'Número não encontrado.' });
    }
    if (numero.status !== 'disponivel') {
      return reply.code(409).send({ error: `Número não está disponível (status atual: ${numero.status}).` });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows: tenantRows } = await client.query('SELECT id FROM tenants WHERE id = $1', [tenantId]);
      if (!tenantRows[0]) {
        await client.query('ROLLBACK');
        return reply.code(404).send({ error: 'Salão (tenant) não encontrado.' });
      }

      await client.query(
        `UPDATE numeros_prontos
         SET tenant_id = $2, status = 'em_configuracao', vinculado_em = now(), vinculado_por = $3
         WHERE id = $1`,
        [id, tenantId, request.admin.adminId]
      );
      await client.query('UPDATE tenants SET meta_waba_id = $2, meta_phone_number_id = $3 WHERE id = $1', [
        tenantId,
        numero.meta_waba_id,
        numero.meta_phone_number_id,
      ]);
      await client.query('COMMIT');
    } catch (erro) {
      await client.query('ROLLBACK');
      if (erro.code === '23505') {
        return reply.code(409).send({ error: 'Esse número já está conectado a outro salão.' });
      }
      throw erro;
    } finally {
      client.release();
    }

    const { rows } = await pool.query(
      `SELECT n.*, t.nome AS tenant_nome FROM numeros_prontos n LEFT JOIN tenants t ON t.id = n.tenant_id WHERE n.id = $1`,
      [id]
    );
    return rows[0];
  });

  // CA (US39.2) — envia mensagem de teste pro número vinculado; sucesso marca
  // o número como "ativo" (operacional de fato, não só configurado), erro
  // marca como "erro" e guarda o motivo pra investigação.
  fastify.post('/admin/api/numeros-prontos/:id/testar', { preHandler: [fastify.authenticateAdmin] }, async (request, reply) => {
    const { id } = request.params;
    const { numero_destino: numeroDestino } = request.body || {};
    if (!numeroDestino) {
      return reply.code(400).send({ error: 'Informe numero_destino.' });
    }

    const { rows: numeroRows } = await pool.query('SELECT * FROM numeros_prontos WHERE id = $1', [id]);
    const numero = numeroRows[0];
    if (!numero) {
      return reply.code(404).send({ error: 'Número não encontrado.' });
    }
    if (!numero.tenant_id) {
      return reply.code(409).send({ error: 'Vincule o número a um salão antes de testar.' });
    }

    let status;
    let resultado;
    try {
      await metaWhatsappService.enviarMensagemTeste(numero.meta_phone_number_id, numeroDestino);
      status = 'ativo';
      resultado = `Mensagem de teste enviada com sucesso para ${numeroDestino}.`;
    } catch (erro) {
      status = 'erro';
      resultado = erro.message;
    }

    const { rows } = await pool.query(
      `UPDATE numeros_prontos SET status = $2, testado_em = now(), teste_resultado = $3
       WHERE id = $1 RETURNING *`,
      [id, status, resultado]
    );
    if (status === 'erro') {
      return reply.code(400).send({ error: resultado, numero: rows[0] });
    }
    return rows[0];
  });
}

module.exports = { registerAdminNumerosProntosRoutes };
