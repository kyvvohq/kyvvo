// Área admin — listagem de usuários (contas individuais de login: pode
// haver mais de uma por tenant, ex.: dono + equipe convidada) com o tenant e
// plano de cada um, pra suporte/triagem. Edição de módulos não duplica nada
// aqui — reaproveita GET/PATCH /admin/api/tenants/:id[/modulos/:moduloKey]
// já existentes (módulo é uma permissão do TENANT, não do usuário
// individual; todo membro da equipe de um tenant enxerga os mesmos módulos).
const planos = require('../lib/planos');

function registerAdminUsuariosRoutes(fastify, pool) {
  fastify.get('/admin/api/usuarios', { preHandler: [fastify.authenticateAdmin] }, async (request) => {
    const { search } = request.query || {};
    const params = [];
    let where = '';
    if (search && search.trim()) {
      params.push(`%${search.trim()}%`);
      where = 'WHERE u.nome ILIKE $1 OR u.email ILIKE $1 OR t.nome ILIKE $1';
    }

    const { rows } = await pool.query(
      `SELECT u.id, u.nome, u.email, u.role, u.ativo, u.email_verified, u.criado_em,
              t.id AS tenant_id, t.nome AS tenant_nome, t.plano,
              (SELECT COUNT(*)::int FROM tenant_modulos tm WHERE tm.tenant_id = t.id AND tm.ativo) AS total_modulos_ativos
       FROM usuarios u
       JOIN tenants t ON t.id = u.tenant_id
       ${where}
       ORDER BY u.criado_em DESC`,
      params
    );

    return {
      usuarios: rows.map((u) => ({ ...u, plano_nome: planos.nomeDoPlano(u.plano) })),
    };
  });
}

module.exports = { registerAdminUsuariosRoutes };
