// Documentação interativa da API (Swagger/OpenAPI), servida em /admin/docs
// (via admin.kyvvo.com.br/docs — o nginx do subdomínio admin prepende
// "/admin/" a todo request, ver [[project-kyvvo-infra]]). Não anota rota por
// rota com schema: `transform` abaixo roda uma vez pra CADA rota já
// registrada no Fastify (index.js + routes/*.js) e deriva a tag a partir do
// próprio path — cobre as ~90 rotas existentes hoje sem tocar em nenhuma, e
// continua cobrindo automaticamente qualquer rota nova daqui pra frente, sem
// precisar lembrar de manter uma lista à parte.
//
// Rotas que não servem API (páginas HTML da SPA — /painel, /agenda,
// /admin/tenants/:id etc.) não começam com /api, /admin/api ou /webhook* —
// ficam de fora do doc (hide: true) por não serem endpoints de dados.
//
// "Try it out" sempre mira studio.kyvvo.com.br (host direto, sem reescrita de
// path) independente de onde a página de docs foi carregada — acessar via
// admin.kyvvo.com.br e chamar uma rota /admin/api/... duplicaria o prefixo
// (o nginx de lá já prepende /admin/ sozinho).
function capitalizar(slug) {
  return slug
    .split('-')
    .map((parte) => parte.charAt(0).toUpperCase() + parte.slice(1))
    .join(' ');
}

function tagParaRota(url) {
  if (url.startsWith('/webhook')) return 'Webhooks';
  const admin = url.match(/^\/admin\/api\/([a-z0-9-]+)/i);
  if (admin) return `Admin - ${capitalizar(admin[1])}`;
  const publica = url.match(/^\/api\/([a-z0-9-]+)/i);
  if (publica) return capitalizar(publica[1]);
  return null;
}

const openapiConfig = {
  openapi: '3.0.0',
  info: {
    title: 'Kyvvo API',
    description:
      'API do painel Kyvvo (portal do tenant + área admin). Gerado automaticamente a partir das rotas registradas — sem schema manual por rota, então corpo/resposta de cada endpoint aparecem só como "objeto genérico" quando não documentados explicitamente. Clique em "Authorize" e cole um token (Bearer) pra testar rotas ao vivo: token de tenant (login normal) pras rotas sem prefixo "Admin -", token da área admin pras rotas "Admin - *".',
    version: '1.0.0',
  },
  servers: [
    { url: 'https://studio.kyvvo.com.br', description: 'Produção (host direto — use este pro "Try it out")' },
  ],
  components: {
    securitySchemes: {
      tenantAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT', description: 'Token do login do tenant (kyvvo_token)' },
      adminAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT', description: 'Token do login da área admin' },
    },
  },
};

function transform({ schema, url }) {
  const tag = tagParaRota(url);
  if (!tag) {
    return { schema: { ...(schema || {}), hide: true }, url };
  }
  const security = url.startsWith('/admin/api/') ? [{ adminAuth: [] }] : [{ tenantAuth: [] }];
  return { schema: { ...(schema || {}), tags: [tag], security }, url };
}

module.exports = { openapiConfig, transform };
