// Rotas públicas (sem autenticação) — extraído de index.js (fase 10 da
// modularização): GET /api/config-publica, GET /api/segmentos,
// GET /api/planos[/:slug]. Não inclui o webhook do WhatsApp
// (/webhook/whatsapp, GET/POST) nem o IA Engine — esses ficam em index.js
// até a fase WhatsApp/IA Engine.
function registerPublicoRoutes(fastify, pool) {
  // GET /api/config-publica — expõe só a chave pública do PostHog pro front do
  // painel (US47/CA de rastreamento de conversão). Não autenticada de
  // propósito: precisa estar disponível em login.html/cadastro.html, antes de
  // qualquer sessão existir. Sem POSTHOG_KEY configurada, o front recebe
  // posthogKey: null e analytics.js não inicializa o tracking (fail-safe).
  fastify.get('/api/config-publica', async () => ({
    posthogKey: process.env.POSTHOG_KEY || null,
    posthogHost: process.env.POSTHOG_HOST || 'https://us.i.posthog.com',
  }));

  // Segmentos disponíveis pro dropdown do cadastro (CA02/US34) — tabela
  // dinâmica (035), consultada sem autenticação já que roda antes do login.
  fastify.get('/api/segmentos', async () => {
    const { rows } = await pool.query('SELECT id, nome FROM segmentos WHERE ativo = true ORDER BY id');
    return { segmentos: rows };
  });

  // US67/CA01 — catálogo público de planos (grade 2x2), consultado sem
  // autenticação tanto pela landing (outra origem) quanto pelo cadastro
  // (CA06, pra pré-selecionar o plano vindo de ?plano=). Só planos ativos —
  // os desativados pela migration 045 (chaves legadas) não aparecem aqui,
  // mas continuam resolvendo preço no checkout de quem já os tem.
  // US74/CA02 — monta features (ordenadas) e limites por plano a partir de
  // linhas soltas (plano_features/plano_limites) — mais simples que fazer o
  // agrupamento em SQL (json_agg) e mantém a mesma forma de query usada no
  // resto do arquivo.
  async function anexarFeaturesELimites(planosRows) {
    const chaves = planosRows.map((p) => p.chave);
    if (!chaves.length) return planosRows.map(({ chave, ...resto }) => resto);

    const [{ rows: featuresRows }, { rows: limitesRows }] = await Promise.all([
      pool.query(
        `SELECT plano_chave, label, ordem FROM plano_features WHERE plano_chave = ANY($1) ORDER BY ordem ASC`,
        [chaves]
      ),
      pool.query(`SELECT plano_chave, chave, valor FROM plano_limites WHERE plano_chave = ANY($1)`, [chaves]),
    ]);

    return planosRows.map((p) => {
      const { chave, herda_de, herda_de_nome, ...resto } = p;
      return {
        ...resto,
        preco_mensal: Number(p.preco_mensal),
        herda_de_nome: herda_de_nome || null,
        features: featuresRows.filter((f) => f.plano_chave === chave).map((f) => ({ label: f.label, ordem: f.ordem })),
        limites: Object.fromEntries(limitesRows.filter((l) => l.plano_chave === chave).map((l) => [l.chave, l.valor])),
      };
    });
  }

  fastify.get('/api/planos', async () => {
    const { rows } = await pool.query(
      `SELECT p.chave, p.slug, p.nome, p.descricao, p.tecnologia, p.tipo_numero, p.preco_mensal,
              p.limite_disparos, p.destaque, p.badge, p.headline_diferencial, p.frase_beneficio,
              p.herda_de, base.nome AS herda_de_nome
         FROM planos p
         LEFT JOIN planos base ON base.chave = p.herda_de
        WHERE p.ativo = true
        ORDER BY p.preco_mensal ASC`
    );
    return anexarFeaturesELimites(rows);
  });

  // US72/CA02 — resolve um slug pra um plano único, aceitando tanto o slug
  // atual quanto a `chave` (identificador interno, imutável — era o slug
  // antes da US72 renomear pra eixo de valor). Isso mantém links antigos
  // (?plano=starter) funcionando sem precisar de uma tabela extra de
  // aliases: `chave` nunca muda, então basta aceitar os dois. Não filtra
  // por `ativo` — é uma consulta pontual (não a lista pra grade de preços),
  // então resolve mesmo plano legado desativado (ex: pra não devolver 404 de
  // um link publicado antes da desativação em 045_planos_2x2.sql).
  fastify.get('/api/planos/:slug', async (request, reply) => {
    const { slug } = request.params;
    const { rows } = await pool.query(
      `SELECT slug, nome, descricao, tecnologia, tipo_numero, preco_mensal,
              limite_disparos, destaque, badge
         FROM planos
        WHERE slug = $1 OR chave = $1`,
      [slug]
    );
    if (!rows[0]) {
      return reply.code(404).send({ error: 'Plano não encontrado' });
    }
    return { ...rows[0], preco_mensal: Number(rows[0].preco_mensal) };
  });
}

module.exports = { registerPublicoRoutes };
