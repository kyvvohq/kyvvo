const { test, expect } = require('@playwright/test');

// Cobre US67: seção de preços da landing (grade 2x2), consumindo o endpoint
// público do painel (GET /api/planos, mockado aqui via page.route — sem
// dependência de Postgres real nem do painel de verdade rodando).

const PLANOS_MOCK = [
  { slug: 'starter', nome: 'Starter', descricao: 'Bot de agendamento + número próprio', tecnologia: 'bot', tipo_numero: 'proprio', preco_mensal: 79.9, limite_disparos: 100, destaque: false, badge: null },
  { slug: 'business', nome: 'Business', descricao: 'Bot de agendamento + número Kyvvo pronto', tecnologia: 'bot', tipo_numero: 'kyvvo', preco_mensal: 119.9, limite_disparos: 100, destaque: false, badge: null },
  { slug: 'professional', nome: 'Professional', descricao: 'IA conversacional + número próprio', tecnologia: 'ia', tipo_numero: 'proprio', preco_mensal: 149.9, limite_disparos: 500, destaque: false, badge: null },
  { slug: 'enterprise', nome: 'Enterprise', descricao: 'IA conversacional + número Kyvvo pronto', tecnologia: 'ia', tipo_numero: 'kyvvo', preco_mensal: 179.9, limite_disparos: 500, destaque: true, badge: 'Mais popular' },
];

async function mockPlanos(page, planos = PLANOS_MOCK) {
  await page.route('**/api/planos', (route) => route.fulfill({ json: planos }));
}

test.describe('Landing — grade de planos 2x2 (US67)', () => {
  test('renderiza 4 planos com nome e preço dinâmico (CA02)', async ({ page }) => {
    await mockPlanos(page);
    await page.goto('/index.html');

    const grid = page.getByTestId('planos-grid');
    await expect(grid.locator('article.plano-card')).toHaveCount(4);
    await expect(grid).toContainText('R$ 79,90');
    await expect(grid).toContainText('R$ 179,90');
  });

  test('exibe o badge no plano com destaque (CA02)', async ({ page }) => {
    await mockPlanos(page);
    await page.goto('/index.html');

    await expect(page.locator('[data-slug="enterprise"]')).toContainText('Mais popular');
    await expect(page.locator('[data-slug="enterprise"]')).toHaveClass(/destaque/);
    await expect(page.locator('[data-slug="starter"]')).not.toHaveClass(/destaque/);
  });

  test('preço vem do endpoint, não é hardcoded (CA02)', async ({ page }) => {
    const alterado = PLANOS_MOCK.map((p) => (p.slug === 'enterprise' ? { ...p, preco_mensal: 199.9 } : p));
    await mockPlanos(page, alterado);
    await page.goto('/index.html');

    await expect(page.getByTestId('planos-grid')).toContainText('R$ 199,90');
    await expect(page.getByTestId('planos-grid')).not.toContainText('R$ 179,90');
  });

  test('CTA de cada plano aponta pro cadastro com ?plano=<slug> (CA06)', async ({ page }) => {
    await mockPlanos(page);
    await page.goto('/index.html');

    const cta = page.getByTestId('cta-enterprise');
    await expect(cta).toHaveAttribute('href', /\/cadastro\.html\?plano=enterprise$/);
  });

  test('grade em 2 colunas no desktop (CA05)', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await mockPlanos(page);
    await page.goto('/index.html');

    const colunas = await page.getByTestId('planos-grid').evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length);
    expect(colunas).toBe(2);
  });

  test('grade em coluna única no mobile (CA05)', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await mockPlanos(page);
    await page.goto('/index.html');

    const colunas = await page.getByTestId('planos-grid').evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length);
    expect(colunas).toBe(1);
  });

  test('sem resposta da API, mostra mensagem de erro sem quebrar a página', async ({ page }) => {
    await page.route('**/api/planos', (route) => route.fulfill({ status: 500, json: {} }));
    await page.goto('/index.html');

    await expect(page.getByTestId('planos-grid')).toContainText('Não foi possível carregar os planos');
  });
});
