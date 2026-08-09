const { test, expect } = require('@playwright/test');

// Cobre US70: faixa de 4 cards financeiros (Realizado/Previsto hoje e no
// mês) na tela inicial, alimentada por GET /api/financeiro/resumo-dashboard,
// visível só pra quem tem o módulo financeiro ativo e não é operador (US62),
// e cada card navega pro Financeiro. As chamadas de API são mockadas via
// page.route — sem dependência de Postgres real.

function statusMock(overrides = {}) {
  return {
    email_verified: true,
    status: 'ativo',
    trial_ativo: false,
    dias_restantes: null,
    pagamento_pendente: false,
    role: 'administrador',
    configuracao: { sem_servicos: false, sem_profissionais: false, whatsapp_desconectado: false },
    ...overrides,
  };
}

async function entrarNoPainel(page, { status = statusMock(), temFinanceiro = true, resumo, mockarResumo = true } = {}) {
  await page.route('**/api/configuracao', (route) =>
    route.fulfill({ json: { dias_funcionamento: [1, 2, 3, 4, 5, 6], formato_hora: '24h' } })
  );
  await page.route('**/api/agendamentos**', (route) => {
    const url = new URL(route.request().url());
    return route.fulfill({ json: { view: 'dia', data: url.searchParams.get('data'), agendamentos: [] } });
  });
  await page.route('**/api/tenant/status', (route) => route.fulfill({ json: status }));
  await page.route('**/api/tenant/modulos', (route) =>
    route.fulfill({ json: { modulos: temFinanceiro ? [{ key: 'financeiro', nome: 'Financeiro', preco_mensal: 0 }] : [] } })
  );
  if (mockarResumo) {
    await page.route('**/api/financeiro/resumo-dashboard', (route) =>
      route.fulfill({
        json: resumo || { realizado_hoje: 320, previsto_hoje: 180, realizado_mes: 4820, previsto_mes: 2100 },
      })
    );
  }
  await page.route('**/api/financeiro/lancamentos**', (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    return route.fulfill({ json: { mes: '2026-07', lancamentos: [], resumo: { entradas: 0, saidas: 0, saldo: 0 } } });
  });
  await page.addInitScript(() => {
    window.localStorage.setItem('kyvvo_token', 'fake-jwt-token');
    window.localStorage.setItem('kyvvo_nome', 'Ana');
  });
  await page.goto('/painel.html');
  await page.click('.menu-item[data-menu="inicio"]');
}

test.describe('Tela inicial — resumo financeiro (US70)', () => {
  test('CA02 — exibe os 4 cards com os valores formatados', async ({ page }) => {
    await entrarNoPainel(page, { resumo: { realizado_hoje: 320, previsto_hoje: 180, realizado_mes: 4820, previsto_mes: 2100 } });

    await expect(page.locator('[data-testid="card-realizado-hoje"]')).toContainText('R$ 320,00');
    await expect(page.locator('[data-testid="card-previsto-hoje"]')).toContainText('R$ 180,00');
    await expect(page.locator('[data-testid="card-realizado-mes"]')).toContainText('R$ 4820,00');
    await expect(page.locator('[data-testid="card-previsto-mes"]')).toContainText('R$ 2100,00');
  });

  test('CA02 — cards Realizado usam a cor de entrada (verde) e Previsto a cor neutra', async ({ page }) => {
    await entrarNoPainel(page);
    await expect(page.locator('[data-testid="card-realizado-hoje"] .financeiro-entrada')).toBeVisible();
    await expect(page.locator('[data-testid="card-previsto-hoje"] .financeiro-previsto')).toBeVisible();
    await expect(page.locator('[data-testid="card-realizado-mes"] .financeiro-entrada')).toBeVisible();
    await expect(page.locator('[data-testid="card-previsto-mes"] .financeiro-previsto')).toBeVisible();
  });

  test('não exibe os cards quando o tenant não tem o módulo financeiro ativo', async ({ page }) => {
    await entrarNoPainel(page, { temFinanceiro: false, mockarResumo: false });
    await expect(page.locator('[data-testid="cards-financeiro-resumo"]')).toHaveCount(0);
  });

  test('US62 — não exibe os cards pro operador, mesmo com o módulo ativo', async ({ page }) => {
    await entrarNoPainel(page, { status: statusMock({ role: 'operador' }), mockarResumo: false });
    await expect(page.locator('[data-testid="cards-financeiro-resumo"]')).toHaveCount(0);
  });

  test('CA03 — clicar num card navega pro Financeiro', async ({ page }) => {
    await entrarNoPainel(page);
    await page.click('[data-testid="card-realizado-hoje"]');
    await expect(page.locator('.menu-item[data-menu="modulo:financeiro"]')).toHaveClass(/active/);
    await expect(page.locator('.financeiro-resumo-label').first()).toBeVisible();
  });

  test('CA03 — card do mês também navega pro Financeiro', async ({ page }) => {
    await entrarNoPainel(page);
    await page.click('[data-testid="card-realizado-mes"]');
    await expect(page.locator('.menu-item[data-menu="modulo:financeiro"]')).toHaveClass(/active/);
  });
});
