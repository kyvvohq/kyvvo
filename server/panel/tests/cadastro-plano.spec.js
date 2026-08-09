const { test, expect } = require('@playwright/test');

// Cobre US67/CA06 (tela de cadastro recebe ?plano=<slug> vindo da landing e
// pré-seleciona o plano), US72/CA02 (slugs legados, ex: ?plano=starter,
// continuam resolvendo pro plano certo e a URL é normalizada pro slug
// atual) e US78 (a prévia aparece sempre — com fallback pro plano em
// destaque — troca sem sair da tela mantendo a URL em sincronia, e o slug
// escolhido viaja junto no cadastro pra não perder a referência de preço
// entre o card e a cobrança). API mockada via page.route — sem dependência
// de Postgres real.

// US72 — nomes/slugs pelo eixo de valor (eram Starter/Business/Professional/
// Enterprise, slugs starter/business/professional/enterprise — que também
// funcionam como "chave legada" aceita por GET /api/planos/:slug).
function planosMock() {
  return [
    { slug: 'essencial', nome: 'Essencial', descricao: 'Bot de agendamento + número próprio', tecnologia: 'bot', tipo_numero: 'proprio', preco_mensal: 79.9, limite_disparos: 100, destaque: false, badge: null },
    { slug: 'essencial-plus', nome: 'Essencial Plus', descricao: 'Bot de agendamento + número Kyvvo pronto', tecnologia: 'bot', tipo_numero: 'kyvvo', preco_mensal: 119.9, limite_disparos: 100, destaque: false, badge: null },
    { slug: 'smart', nome: 'Smart', descricao: 'IA conversacional + número próprio', tecnologia: 'ia', tipo_numero: 'proprio', preco_mensal: 149.9, limite_disparos: 500, destaque: false, badge: null },
    { slug: 'smart-plus', nome: 'Smart Plus', descricao: 'IA conversacional + número Kyvvo pronto', tecnologia: 'ia', tipo_numero: 'kyvvo', preco_mensal: 179.9, limite_disparos: 500, destaque: true, badge: 'Mais popular' },
  ];
}

// Aceita tanto o slug atual quanto a chave legada, igual ao endpoint real
// (GET /api/planos/:slug com `WHERE slug = $1 OR chave = $1`).
const SLUGS_LEGADOS = { starter: 'essencial', business: 'essencial-plus', professional: 'smart', enterprise: 'smart-plus' };

async function mockApisBasicas(page) {
  await page.route('**/api/segmentos', (route) => route.fulfill({ json: { segmentos: [{ id: 1, nome: 'Salão de beleza' }] } }));
  await page.route('**/api/planos', (route) => {
    if (new URL(route.request().url()).pathname !== '/api/planos') return route.fallback();
    return route.fulfill({ json: planosMock() });
  });
  await page.route('**/api/planos/*', (route) => {
    const slugPedido = new URL(route.request().url()).pathname.split('/').pop();
    const slugResolvido = SLUGS_LEGADOS[slugPedido] || slugPedido;
    const plano = planosMock().find((p) => p.slug === slugResolvido);
    if (!plano) return route.fulfill({ status: 404, json: { error: 'Plano não encontrado' } });
    return route.fulfill({ json: plano });
  });
}

test.describe('Cadastro — plano pré-selecionado via ?plano= (US67/CA06)', () => {
  test('com ?plano=smart-plus, mostra nome e preço do plano pré-selecionado', async ({ page }) => {
    await mockApisBasicas(page);
    await page.goto('/cadastro.html?plano=smart-plus');

    await expect(page.locator('#cadastro-plano')).toBeVisible();
    await expect(page.locator('#cadastro-plano-nome')).toHaveText('Smart Plus');
    await expect(page.locator('#cadastro-plano-preco')).toHaveText('R$ 179,90/mês');
    await expect(page.locator('#cadastro-plano-select')).toHaveValue('smart-plus');
  });

  test('permite trocar de plano sem sair da tela', async ({ page }) => {
    await mockApisBasicas(page);
    await page.goto('/cadastro.html?plano=smart-plus');
    await expect(page.locator('#cadastro-plano-nome')).toHaveText('Smart Plus');

    await page.selectOption('#cadastro-plano-select', 'essencial');

    await expect(page.locator('#cadastro-plano-nome')).toHaveText('Essencial');
    await expect(page.locator('#cadastro-plano-preco')).toHaveText('R$ 79,90/mês');
    await expect(page).toHaveURL(/plano=essencial/); // URL acompanha a troca, sem recarregar/navegar
  });
});

test.describe('Cadastro — prévia sempre visível com fallback pro destaque (US78/CA02)', () => {
  test('sem ?plano= na URL, mostra a prévia com o plano em destaque pré-selecionado', async ({ page }) => {
    await mockApisBasicas(page);
    await page.goto('/cadastro.html');

    await expect(page.locator('#cadastro-plano')).toBeVisible();
    await expect(page.locator('#cadastro-plano-nome')).toHaveText('Smart Plus');
    await expect(page.locator('#cadastro-plano-select')).toHaveValue('smart-plus');
  });

  test('plano desconhecido na URL cai no plano em destaque', async ({ page }) => {
    await mockApisBasicas(page);
    await page.goto('/cadastro.html?plano=inexistente');

    await expect(page.locator('#cadastro-plano')).toBeVisible();
    await expect(page.locator('#cadastro-plano-nome')).toHaveText('Smart Plus');
  });

  test('sem plano em destaque no catálogo, cai no mais barato', async ({ page }) => {
    await page.route('**/api/segmentos', (route) => route.fulfill({ json: { segmentos: [{ id: 1, nome: 'Salão de beleza' }] } }));
    await page.route('**/api/planos', (route) =>
      route.fulfill({
        json: planosMock().map((p) => ({ ...p, destaque: false })),
      })
    );
    await page.goto('/cadastro.html');

    await expect(page.locator('#cadastro-plano-nome')).toHaveText('Essencial');
  });
});

test.describe('Cadastro — slugs legados continuam funcionando (US72/CA02)', () => {
  test('?plano=starter (slug antigo) pré-seleciona o Essencial', async ({ page }) => {
    await mockApisBasicas(page);
    await page.goto('/cadastro.html?plano=starter');

    await expect(page.locator('#cadastro-plano')).toBeVisible();
    await expect(page.locator('#cadastro-plano-nome')).toHaveText('Essencial');
    await expect(page.locator('#cadastro-plano-preco')).toHaveText('R$ 79,90/mês');
  });

  test('?plano=enterprise (slug antigo) pré-seleciona o Smart Plus e normaliza a URL', async ({ page }) => {
    await mockApisBasicas(page);
    await page.goto('/cadastro.html?plano=enterprise');

    await expect(page.locator('#cadastro-plano-nome')).toHaveText('Smart Plus');
    await expect(page).toHaveURL(/plano=smart-plus/);
  });
});

test.describe('Cadastro — troca de plano atualiza a URL (US78/CA03)', () => {
  test('sem ?plano= na URL, o fallback pro destaque atualiza a URL', async ({ page }) => {
    await mockApisBasicas(page);
    await page.goto('/cadastro.html');

    await expect(page.locator('#cadastro-plano-nome')).toHaveText('Smart Plus');
    await expect(page).toHaveURL(/plano=smart-plus/);
  });

  test('trocar de plano atualiza a URL pro slug escolhido', async ({ page }) => {
    await mockApisBasicas(page);
    await page.goto('/cadastro.html?plano=smart-plus');

    await page.selectOption('#cadastro-plano-select', 'essencial');

    await expect(page).toHaveURL(/plano=essencial/);
    await expect(page).not.toHaveURL(/plano=smart-plus/);
  });
});

test.describe('Cadastro — plano escolhido viaja no cadastro (US78/CA04)', () => {
  test('cadastro envia o plano_slug pré-selecionado (destaque) sem o usuário interagir', async ({ page }) => {
    await mockApisBasicas(page);
    let payloadEnviado = null;
    await page.route('**/api/auth/register', (route) => {
      payloadEnviado = route.request().postDataJSON();
      return route.fulfill({
        status: 201,
        json: { token: 'jwt-novo', nome: 'Ana', email: 'ana@salao.com', email_verified: false },
      });
    });
    await page.route('**/api/tenant/status', (route) =>
      route.fulfill({ json: { email: 'ana@salao.com', email_verified: false, status: 'trial' } })
    );

    await page.goto('/cadastro.html?plano=business');
    await page.fill('#nome_responsavel', 'Ana Souza');
    await page.fill('#whatsapp', '(34) 99999-9999');
    await page.fill('#email', 'ana@salao.com');
    await page.fill('#senha', 'Senha123');
    await page.check('#aceite_termos');
    await page.click('#btn-criar');

    await expect(page).toHaveURL(/\/verificar\.html$/);
    // US72/CA02 — "business" é chave legada; a prévia normaliza pro slug
    // atual ("essencial-plus") antes do envio, então é isso que viaja.
    expect(payloadEnviado.plano_slug).toBe('essencial-plus');
  });

  test('sem catálogo carregado (falha na API), o cadastro segue sem plano_slug', async ({ page }) => {
    await page.route('**/api/segmentos', (route) => route.fulfill({ json: { segmentos: [{ id: 1, nome: 'Salão de beleza' }] } }));
    await page.route('**/api/planos', (route) => route.fulfill({ status: 500, json: {} }));

    let payloadEnviado = null;
    await page.route('**/api/auth/register', (route) => {
      payloadEnviado = route.request().postDataJSON();
      return route.fulfill({
        status: 201,
        json: { token: 'jwt-novo', nome: 'Ana', email: 'ana@salao.com', email_verified: false },
      });
    });
    await page.route('**/api/tenant/status', (route) =>
      route.fulfill({ json: { email: 'ana@salao.com', email_verified: false, status: 'trial' } })
    );

    await page.goto('/cadastro.html');
    await page.fill('#nome_responsavel', 'Ana Souza');
    await page.fill('#whatsapp', '(34) 99999-9999');
    await page.fill('#email', 'ana@salao.com');
    await page.fill('#senha', 'Senha123');
    await page.check('#aceite_termos');
    await page.click('#btn-criar');

    await expect(page).toHaveURL(/\/verificar\.html$/);
    expect(payloadEnviado.plano_slug).toBeNull();
    await expect(page.locator('#cadastro-plano')).toBeHidden();
  });
});
