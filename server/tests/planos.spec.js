const { test, expect } = require('@playwright/test');

// Cobre US67: seção de preços da landing (grade 2x2), consumindo o endpoint
// público do painel (GET /api/planos, mockado aqui via page.route — sem
// dependência de Postgres real nem do painel de verdade rodando).

// US72 — nomes/slugs pelo eixo de valor (eram Starter/Business/Professional/
// Enterprise, slugs starter/business/professional/enterprise).
const PLANOS_MOCK = [
  { slug: 'essencial', nome: 'Essencial', descricao: 'Bot de agendamento + número próprio', tecnologia: 'bot', tipo_numero: 'proprio', preco_mensal: 79.9, limite_disparos: 100, destaque: false, badge: null },
  { slug: 'essencial-plus', nome: 'Essencial Plus', descricao: 'Bot de agendamento + número Kyvvo pronto', tecnologia: 'bot', tipo_numero: 'kyvvo', preco_mensal: 119.9, limite_disparos: 100, destaque: false, badge: null },
  { slug: 'smart', nome: 'Smart', descricao: 'IA conversacional + número próprio', tecnologia: 'ia', tipo_numero: 'proprio', preco_mensal: 149.9, limite_disparos: 500, destaque: false, badge: null },
  { slug: 'smart-plus', nome: 'Smart Plus', descricao: 'IA conversacional + número Kyvvo pronto', tecnologia: 'ia', tipo_numero: 'kyvvo', preco_mensal: 179.9, limite_disparos: 500, destaque: true, badge: 'Mais popular' },
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

    await expect(page.locator('[data-slug="smart-plus"]')).toContainText('Mais popular');
    await expect(page.locator('[data-slug="smart-plus"]')).toHaveClass(/destaque/);
    await expect(page.locator('[data-slug="essencial"]')).not.toHaveClass(/destaque/);
  });

  test('preço vem do endpoint, não é hardcoded (CA02)', async ({ page }) => {
    const alterado = PLANOS_MOCK.map((p) => (p.slug === 'smart-plus' ? { ...p, preco_mensal: 199.9 } : p));
    await mockPlanos(page, alterado);
    await page.goto('/index.html');

    await expect(page.getByTestId('planos-grid')).toContainText('R$ 199,90');
    await expect(page.getByTestId('planos-grid')).not.toContainText('R$ 179,90');
  });

  test('CTA de cada plano aponta pro cadastro com ?plano=<slug> (CA06)', async ({ page }) => {
    await mockPlanos(page);
    await page.goto('/index.html');

    const cta = page.getByTestId('cta-smart-plus');
    await expect(cta).toHaveAttribute('href', /\/cadastro\.html\?plano=smart-plus$/);
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

test.describe('Landing — planos pelo eixo de valor (US72)', () => {
  test('CA03 — nomes vêm do endpoint, ordenados por preço, sem nomenclatura antiga', async ({ page }) => {
    await mockPlanos(page);
    await page.goto('/index.html');

    const grid = page.getByTestId('planos-grid');
    await expect(grid).toContainText('Essencial');
    await expect(grid).toContainText('Essencial Plus');
    await expect(grid).toContainText('Smart Plus');

    const titulos = await grid.locator('article.plano-card').allTextContents();
    expect(titulos[0]).toContain('Essencial');
    expect(titulos.at(-1)).toContain('Smart Plus');

    for (const nomeAntigo of ['Starter', 'Business', 'Professional', 'Enterprise']) {
      await expect(grid.getByText(nomeAntigo, { exact: true })).toHaveCount(0);
    }
  });
});
