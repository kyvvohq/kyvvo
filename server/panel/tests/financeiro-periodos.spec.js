const { test, expect } = require('@playwright/test');

// Cobre US71: abas Mês/Semana/Dia na página /financeiro, alimentadas por
// GET /api/financeiro/resumo (CA01) e por GET /api/financeiro/lancamentos
// com filtro por período (detalhamento). As chamadas de API são mockadas
// via page.route — sem dependência de Postgres real.

async function entrarNoFinanceiro(page, { lancamentosMes = [], resumoMes = { entradas: 0, saidas: 0, saldo: 0 } } = {}) {
  await page.route('**/api/configuracao', (route) =>
    route.fulfill({ json: { dias_funcionamento: [1, 2, 3, 4, 5, 6], formato_hora: '24h' } })
  );
  await page.route('**/api/agendamentos**', (route) => route.fulfill({ json: { view: 'dia', data: '2026-08-08', agendamentos: [] } }));
  await page.route('**/api/tenant/modulos', (route) =>
    route.fulfill({ json: { modulos: [{ key: 'financeiro', nome: 'Financeiro', preco_mensal: 0 }] } })
  );
  await page.route('**/api/financeiro/lancamentos**', (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    const url = new URL(route.request().url());
    if (url.searchParams.get('periodo')) return route.fallback();
    return route.fulfill({ json: { mes: '2026-08', lancamentos: lancamentosMes, resumo: resumoMes } });
  });
  await page.addInitScript(() => {
    window.localStorage.setItem('kyvvo_token', 'fake-jwt-token');
    window.localStorage.setItem('kyvvo_nome', 'Ana');
  });
  await page.goto('/painel.html');
  await page.click('.menu-item[data-menu="modulo:financeiro"]');
}

test.describe('Financeiro — abas Mês/Semana/Dia (US71)', () => {
  test('CA02 — aba Mês fica ativa por padrão e mostra as 3 abas', async ({ page }) => {
    await entrarNoFinanceiro(page);
    await expect(page.locator('[data-financeiro-aba="mes"]')).toHaveClass(/active/);
    await expect(page.locator('[data-financeiro-aba="semana"]')).toBeVisible();
    await expect(page.locator('[data-financeiro-aba="dia"]')).toBeVisible();
  });

  test('CA02 — cards previsto/realizado/total do mês com testid, e gráfico por semana', async ({ page }) => {
    await entrarNoFinanceiro(page, {
      resumoMes: { entradas: 500, saidas: 0, saldo: 500, previsto: 150, realizado: 350 },
      lancamentosMes: [
        { id: 'l1', tipo: 'entrada', valor: 200, data: '2026-08-03', status: 'realizado' },
        { id: 'l2', tipo: 'entrada', valor: 150, data: '2026-08-10', status: 'realizado' },
        { id: 'l3', tipo: 'entrada', valor: 150, data: '2026-08-20', status: 'previsto' },
      ],
    });
    await expect(page.locator('[data-testid="card-previsto"]')).toContainText('R$ 150,00');
    await expect(page.locator('[data-testid="card-realizado"]')).toContainText('R$ 350,00');
    await expect(page.locator('[data-testid="card-total"]')).toContainText('R$ 500,00');
    await expect(page.locator('[data-testid="grafico-semanas"]')).toBeVisible();
  });

  test('CA03 — aba Semana mostra resumo e expande detalhamento ao clicar', async ({ page }) => {
    await entrarNoFinanceiro(page);
    await page.route('**/api/financeiro/resumo?periodo=semana*', (route) =>
      route.fulfill({ json: { periodo: 'semana', referencia: '2026-08-03', realizado: 100, previsto: 80, total: 180 } })
    );
    await page.route('**/api/financeiro/lancamentos?periodo=semana*', (route) =>
      route.fulfill({
        json: {
          lancamentos: [
            { id: 'l1', tipo: 'entrada', valor: 100, data: '2026-08-04', status: 'realizado', origem: 'agendamento', cliente: 'Maria', servico: 'Corte' },
            { id: 'l2', tipo: 'entrada', valor: 80, data: '2026-08-06', status: 'previsto', origem: 'agendamento', cliente: 'Ana', servico: 'Escova' },
          ],
        },
      })
    );

    await page.click('[data-financeiro-aba="semana"]');
    await expect(page.locator('[data-financeiro-aba="semana"]')).toHaveClass(/active/);
    await expect(page.locator('[data-testid="card-realizado"]')).toContainText('R$ 100,00');
    await expect(page.locator('[data-testid="card-previsto"]')).toContainText('R$ 80,00');
    await expect(page.locator('[data-testid="card-total"]')).toContainText('R$ 180,00');
    await expect(page.locator('[data-testid="lista-lancamentos"]')).toHaveCount(0);

    await page.click('#btn-toggle-detalhamento-semana');
    await expect(page.locator('[data-testid="lista-lancamentos"]')).toBeVisible();
    const itens = page.locator('[data-testid="lancamento-item"]');
    await expect(itens).toHaveCount(2);
    await expect(itens.first()).toContainText('Maria');
    await expect(itens.first()).toContainText('Corte');
  });

  test('CA03 — navega para semana anterior', async ({ page }) => {
    await entrarNoFinanceiro(page);
    let ultimaReferencia = null;
    await page.route('**/api/financeiro/resumo?periodo=semana*', (route) => {
      ultimaReferencia = new URL(route.request().url()).searchParams.get('referencia');
      return route.fulfill({ json: { periodo: 'semana', referencia: ultimaReferencia, realizado: 0, previsto: 0, total: 0 } });
    });
    await page.click('[data-financeiro-aba="semana"]');
    await expect(page.locator('[data-testid="card-total"]')).toBeVisible();
    const referenciaInicial = ultimaReferencia;

    await page.click('[data-testid="nav-semana-anterior"]');
    await expect(page.locator('[data-testid="card-total"]')).toBeVisible();
    expect(ultimaReferencia).not.toBe(referenciaInicial);
  });

  test('CA04 — aba Dia mostra resumo e lista sempre visível (sem toggle)', async ({ page }) => {
    await entrarNoFinanceiro(page);
    await page.route('**/api/financeiro/resumo?periodo=dia*', (route) =>
      route.fulfill({ json: { periodo: 'dia', referencia: '2026-08-08', realizado: 200, previsto: 0, total: 200 } })
    );
    await page.route('**/api/financeiro/lancamentos?periodo=dia*', (route) =>
      route.fulfill({
        json: {
          lancamentos: [
            { id: 'l1', tipo: 'entrada', valor: 120, data: '2026-08-08', status: 'realizado', origem: 'manual', descricao: 'Corte avulso' },
          ],
        },
      })
    );

    await page.click('[data-financeiro-aba="dia"]');
    await expect(page.locator('[data-financeiro-aba="dia"]')).toHaveClass(/active/);
    await expect(page.locator('[data-testid="card-realizado"]')).toContainText('R$ 200,00');
    await expect(page.locator('[data-testid="lista-lancamentos"]')).toBeVisible();
    await expect(page.locator('[data-testid="lancamento-item"]')).toHaveCount(1);
  });

  test('CA04 — lista vazia no dia mostra mensagem específica', async ({ page }) => {
    await entrarNoFinanceiro(page);
    await page.route('**/api/financeiro/resumo?periodo=dia*', (route) =>
      route.fulfill({ json: { periodo: 'dia', referencia: '2026-08-08', realizado: 0, previsto: 0, total: 0 } })
    );
    await page.route('**/api/financeiro/lancamentos?periodo=dia*', (route) => route.fulfill({ json: { lancamentos: [] } }));

    await page.click('[data-financeiro-aba="dia"]');
    await expect(page.getByText('Nenhum lançamento registrado para este dia.')).toBeVisible();
  });

  test('CA04 — navega para dia anterior', async ({ page }) => {
    await entrarNoFinanceiro(page);
    let ultimaReferencia = null;
    await page.route('**/api/financeiro/resumo?periodo=dia*', (route) => {
      ultimaReferencia = new URL(route.request().url()).searchParams.get('referencia');
      return route.fulfill({ json: { periodo: 'dia', referencia: ultimaReferencia, realizado: 0, previsto: 0, total: 0 } });
    });
    await page.route('**/api/financeiro/lancamentos?periodo=dia*', (route) => route.fulfill({ json: { lancamentos: [] } }));

    await page.click('[data-financeiro-aba="dia"]');
    await expect(page.locator('[data-testid="card-total"]')).toBeVisible();
    const referenciaInicial = ultimaReferencia;

    await page.click('[data-testid="nav-dia-anterior"]');
    await expect(page.locator('[data-testid="card-total"]')).toBeVisible();
    expect(ultimaReferencia).not.toBe(referenciaInicial);
  });

  test('CA05 — abrirFinanceiroComFiltro("dia", ...) abre direto na aba Dia', async ({ page }) => {
    await entrarNoFinanceiro(page);
    await page.route('**/api/financeiro/resumo?periodo=dia*', (route) =>
      route.fulfill({ json: { periodo: 'dia', referencia: '2026-08-08', realizado: 50, previsto: 0, total: 50 } })
    );
    await page.route('**/api/financeiro/lancamentos?periodo=dia*', (route) => route.fulfill({ json: { lancamentos: [] } }));

    await page.evaluate(() => window.abrirFinanceiroComFiltro('dia', '2026-08-08'));
    await expect(page.locator('[data-financeiro-aba="dia"]')).toHaveClass(/active/);
    await expect(page.locator('[data-financeiro-aba="dia"]')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('[data-testid="card-realizado"]')).toContainText('R$ 50,00');
  });

  test('CA05 — abrirFinanceiroComFiltro("mes", ...) abre direto na aba Mês', async ({ page }) => {
    await entrarNoFinanceiro(page, { resumoMes: { entradas: 0, saidas: 0, saldo: 0 } });
    await page.evaluate(() => window.abrirFinanceiroComFiltro('mes'));
    await expect(page.locator('[data-financeiro-aba="mes"]')).toHaveClass(/active/);
    await expect(page.locator('[data-financeiro-aba="mes"]')).toHaveAttribute('aria-selected', 'true');
  });
});
