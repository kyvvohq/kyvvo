const { test, expect } = require('@playwright/test');

// Cobre US67/CA06 (tela de cadastro recebe ?plano=<slug> vindo da landing e
// pré-seleciona o plano) e US78 (a prévia aparece sempre — com fallback pro
// plano em destaque — troca sem sair da tela mantendo a URL em sincronia, e
// o slug escolhido viaja junto no cadastro pra não perder a referência de
// preço entre o card e a cobrança). API mockada via page.route — sem
// dependência de Postgres real.

function planosMock() {
  return [
    { slug: 'starter', nome: 'Starter', descricao: 'Bot de agendamento + número próprio', tecnologia: 'bot', tipo_numero: 'proprio', preco_mensal: 79.9, limite_disparos: 100, destaque: false, badge: null },
    { slug: 'business', nome: 'Business', descricao: 'Bot de agendamento + número Kyvvo pronto', tecnologia: 'bot', tipo_numero: 'kyvvo', preco_mensal: 119.9, limite_disparos: 100, destaque: false, badge: null },
    { slug: 'professional', nome: 'Professional', descricao: 'IA conversacional + número próprio', tecnologia: 'ia', tipo_numero: 'proprio', preco_mensal: 149.9, limite_disparos: 500, destaque: false, badge: null },
    { slug: 'enterprise', nome: 'Enterprise', descricao: 'IA conversacional + número Kyvvo pronto', tecnologia: 'ia', tipo_numero: 'kyvvo', preco_mensal: 179.9, limite_disparos: 500, destaque: true, badge: 'Mais popular' },
  ];
}

async function mockApisBasicas(page) {
  await page.route('**/api/segmentos', (route) => route.fulfill({ json: { segmentos: [{ id: 1, nome: 'Salão de beleza' }] } }));
  await page.route('**/api/planos', (route) => route.fulfill({ json: planosMock() }));
}

test.describe('Cadastro — plano pré-selecionado via ?plano= (US67/CA06)', () => {
  test('com ?plano=enterprise, mostra nome e preço do plano pré-selecionado', async ({ page }) => {
    await mockApisBasicas(page);
    await page.goto('/cadastro.html?plano=enterprise');

    await expect(page.locator('#cadastro-plano')).toBeVisible();
    await expect(page.locator('#cadastro-plano-nome')).toHaveText('Enterprise');
    await expect(page.locator('#cadastro-plano-preco')).toHaveText('R$ 179,90/mês');
    await expect(page.locator('#cadastro-plano-select')).toHaveValue('enterprise');
  });

  test('permite trocar de plano sem sair da tela', async ({ page }) => {
    await mockApisBasicas(page);
    await page.goto('/cadastro.html?plano=enterprise');
    await expect(page.locator('#cadastro-plano-nome')).toHaveText('Enterprise');

    await page.selectOption('#cadastro-plano-select', 'starter');

    await expect(page.locator('#cadastro-plano-nome')).toHaveText('Starter');
    await expect(page.locator('#cadastro-plano-preco')).toHaveText('R$ 79,90/mês');
  });
});

test.describe('Cadastro — prévia sempre visível com fallback pro destaque (US78/CA02)', () => {
  test('sem ?plano= na URL, mostra a prévia com o plano em destaque pré-selecionado', async ({ page }) => {
    await mockApisBasicas(page);
    await page.goto('/cadastro.html');

    await expect(page.locator('#cadastro-plano')).toBeVisible();
    await expect(page.locator('#cadastro-plano-nome')).toHaveText('Enterprise');
    await expect(page.locator('#cadastro-plano-select')).toHaveValue('enterprise');
  });

  test('plano desconhecido na URL cai no plano em destaque', async ({ page }) => {
    await mockApisBasicas(page);
    await page.goto('/cadastro.html?plano=inexistente');

    await expect(page.locator('#cadastro-plano')).toBeVisible();
    await expect(page.locator('#cadastro-plano-nome')).toHaveText('Enterprise');
  });

  test('sem plano em destaque no catálogo, cai no mais barato', async ({ page }) => {
    await page.route('**/api/segmentos', (route) => route.fulfill({ json: { segmentos: [{ id: 1, nome: 'Salão de beleza' }] } }));
    await page.route('**/api/planos', (route) =>
      route.fulfill({
        json: planosMock().map((p) => ({ ...p, destaque: false })),
      })
    );
    await page.goto('/cadastro.html');

    await expect(page.locator('#cadastro-plano-nome')).toHaveText('Starter');
  });
});

test.describe('Cadastro — troca de plano atualiza a URL (US78/CA03)', () => {
  test('sem ?plano= na URL, o fallback pro destaque atualiza a URL', async ({ page }) => {
    await mockApisBasicas(page);
    await page.goto('/cadastro.html');

    await expect(page.locator('#cadastro-plano-nome')).toHaveText('Enterprise');
    await expect(page).toHaveURL(/plano=enterprise/);
  });

  test('trocar de plano atualiza a URL pro slug escolhido', async ({ page }) => {
    await mockApisBasicas(page);
    await page.goto('/cadastro.html?plano=enterprise');

    await page.selectOption('#cadastro-plano-select', 'starter');

    await expect(page).toHaveURL(/plano=starter/);
    await expect(page).not.toHaveURL(/plano=enterprise/);
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
    await page.fill('#email', 'ana@salao.com');
    await page.selectOption('#segmento', '1');
    await page.fill('#telefone', '(34) 98888-7777');
    await page.fill('#whatsapp', '(34) 99999-9999');
    await page.fill('#senha', 'Senha123');
    await page.click('#btn-criar');

    await expect(page).toHaveURL(/\/verificar\.html$/);
    expect(payloadEnviado.plano_slug).toBe('business');
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
    await page.fill('#email', 'ana@salao.com');
    await page.selectOption('#segmento', '1');
    await page.fill('#telefone', '(34) 98888-7777');
    await page.fill('#whatsapp', '(34) 99999-9999');
    await page.fill('#senha', 'Senha123');
    await page.click('#btn-criar');

    await expect(page).toHaveURL(/\/verificar\.html$/);
    expect(payloadEnviado.plano_slug).toBeNull();
    await expect(page.locator('#cadastro-plano')).toBeHidden();
  });
});
