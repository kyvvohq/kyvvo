const { test, expect } = require('@playwright/test');

// Cobre US67/CA06: tela de cadastro (cadastro.html) recebe ?plano=<slug> vindo
// da landing e pré-seleciona o plano (nome + preço), permitindo trocar sem
// voltar pra landing. API mockada via page.route — sem dependência de
// Postgres real.

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
  test('sem ?plano= na URL, não mostra a prévia de plano', async ({ page }) => {
    await mockApisBasicas(page);
    await page.goto('/cadastro.html');
    await expect(page.locator('#cadastro-plano')).toBeHidden();
  });

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
    await expect(page).toHaveURL(/plano=enterprise/); // não recarrega/navega pra trocar
  });

  test('plano desconhecido cai no primeiro plano do catálogo', async ({ page }) => {
    await mockApisBasicas(page);
    await page.goto('/cadastro.html?plano=inexistente');

    await expect(page.locator('#cadastro-plano')).toBeVisible();
    await expect(page.locator('#cadastro-plano-nome')).toHaveText('Starter');
  });
});
