const { test, expect } = require('@playwright/test');

// Cobre US69 (CA01/CA02/CA03): coluna "Modo de atendimento" na listagem de
// tenants do admin, modal de confirmação antes da troca e chamada ao PATCH
// /admin/api/tenants/:id/modo. API mockada via page.route — sem dependência
// de Postgres real.

function tenantMock(overrides = {}) {
  return {
    id: 't1',
    nome: 'Salão Kyvvo Teste',
    responsavel: 'Ana Paula',
    email: 'ana@salaokyvvo.com',
    whatsapp: '11987654321',
    cadastrado_em: '2026-07-01T10:00:00Z',
    ativado_em: '2026-07-02T11:30:00Z',
    ativo: true,
    status_conta: 'Trial ativo',
    total_usuarios: 1,
    tecnologia: 'bot',
    ...overrides,
  };
}

async function entrarNaListaDeTenants(page, tenants = []) {
  await page.route('**/admin/api/tenants*', (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    return route.fulfill({
      json: { tenants, page: 1, limit: 20, total: tenants.length, total_paginas: 1 },
    });
  });
  await page.addInitScript(() => {
    window.localStorage.setItem('kyvvo_admin_token', 'admin-token-fake');
    window.localStorage.setItem('kyvvo_admin_nome', 'Equipe Kyvvo');
  });
  await page.goto('/admin/painel.html');
}

test.describe('Admin — modo de atendimento do tenant (US69)', () => {
  test('CA01 — exibe badge Bot e botão Alterar para tenant tecnologia=bot', async ({ page }) => {
    await entrarNaListaDeTenants(page, [tenantMock({ tecnologia: 'bot' })]);
    const celula = page.locator('[data-testid="modo-t1"]');
    await expect(celula).toContainText('Bot');
    await expect(page.locator('[data-testid="btn-alterar-modo-t1"]')).toBeVisible();
  });

  test('CA01 — exibe badge IA para tenant tecnologia=ia', async ({ page }) => {
    await entrarNaListaDeTenants(page, [tenantMock({ tecnologia: 'ia' })]);
    await expect(page.locator('[data-testid="modo-t1"]')).toContainText('IA');
  });

  test('CA01 — não exibe botão Alterar para tenant inativo', async ({ page }) => {
    await entrarNaListaDeTenants(page, [tenantMock({ ativo: false, status_conta: 'Inativo' })]);
    await expect(page.locator('[data-testid="btn-alterar-modo-t1"]')).toHaveCount(0);
  });

  test('CA02 — modal exibe modo atual, modo destino e aviso ao trocar para bot', async ({ page }) => {
    await entrarNaListaDeTenants(page, [tenantMock({ tecnologia: 'ia' })]);
    await page.click('[data-testid="btn-alterar-modo-t1"]');

    await expect(page.locator('.modal-card')).toContainText('Salão Kyvvo Teste');
    await expect(page.locator('.modal-card')).toContainText('IA');
    await expect(page.locator('.modal-card')).toContainText('Bot');
    await expect(page.locator('.modal-card')).toContainText('Conversas em andamento');
  });

  test('CA02 — não exibe aviso de conversas ao trocar de bot para ia', async ({ page }) => {
    await entrarNaListaDeTenants(page, [tenantMock({ tecnologia: 'bot' })]);
    await page.click('[data-testid="btn-alterar-modo-t1"]');
    await expect(page.locator('.modal-card')).not.toContainText('Conversas em andamento');
  });

  test('CA02 — Cancelar fecha o modal sem chamar a API', async ({ page }) => {
    await entrarNaListaDeTenants(page, [tenantMock({ tecnologia: 'bot' })]);
    let chamouPatch = false;
    await page.route('**/admin/api/tenants/t1/modo', (route) => {
      chamouPatch = true;
      return route.fulfill({ json: {} });
    });

    await page.click('[data-testid="btn-alterar-modo-t1"]');
    await page.click('#btn-cancelar-modo');

    await expect(page.locator('.modal-overlay')).toHaveCount(0);
    expect(chamouPatch).toBe(false);
  });

  test('CA03 — Confirmar troca chama PATCH .../modo com a tecnologia de destino', async ({ page }) => {
    await entrarNaListaDeTenants(page, [tenantMock({ tecnologia: 'bot' })]);

    let corpoEnviado = null;
    await page.route('**/admin/api/tenants/t1/modo', (route) => {
      corpoEnviado = route.request().postDataJSON();
      return route.fulfill({ json: { id: 't1', tecnologia: 'ia' } });
    });

    await page.click('[data-testid="btn-alterar-modo-t1"]');
    await page.click('#btn-confirmar-modo');

    await expect(page.locator('.toast-sucesso')).toBeVisible();
    expect(corpoEnviado).toEqual({ tecnologia: 'ia' });
  });

  test('CA03 — exibe erro do backend sem fechar o modal', async ({ page }) => {
    await entrarNaListaDeTenants(page, [tenantMock({ tecnologia: 'bot' })]);
    await page.route('**/admin/api/tenants/t1/modo', (route) =>
      route.fulfill({ status: 422, json: { error: 'tecnologia inválida' } })
    );

    await page.click('[data-testid="btn-alterar-modo-t1"]');
    await page.click('#btn-confirmar-modo');

    await expect(page.locator('#modo-erro')).toHaveText('tecnologia inválida');
    await expect(page.locator('.modal-overlay')).toBeVisible();
  });
});
