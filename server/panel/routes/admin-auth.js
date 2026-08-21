// Área admin da Kyvvo (US16) — login — extraído de index.js (fase 9 da
// modularização): POST /admin/api/auth/login.
const bcrypt = require('bcryptjs');

function registerAdminAuthRoutes(fastify, pool) {
  fastify.post('/admin/api/auth/login', async (request, reply) => {
    const { email, senha } = request.body || {};
    if (!email || !senha) {
      return reply.code(400).send({ error: 'E-mail e senha são obrigatórios' });
    }

    const { rows } = await pool.query(
      'SELECT id, email, senha_hash, nome FROM kyvvo_admins WHERE email = $1',
      [email.toLowerCase().trim()]
    );
    const admin = rows[0];
    if (!admin) {
      return reply.code(401).send({ error: 'E-mail ou senha inválidos' });
    }

    const senhaValida = await bcrypt.compare(senha, admin.senha_hash);
    if (!senhaValida) {
      return reply.code(401).send({ error: 'E-mail ou senha inválidos' });
    }

    const token = fastify.jwt.admin.sign({ adminId: admin.id, email: admin.email }, { expiresIn: '7d' });
    return { token, nome: admin.nome, email: admin.email };
  });
}

module.exports = { registerAdminAuthRoutes };
