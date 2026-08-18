const { test, expect } = require('@playwright/test');

// Cobre US69 (CA02/CA03): modal de confirmação antes da troca de modo de
// atendimento e chamada ao PATCH /admin/api/tenants/:id/modo. A partir do
// redesign da tela de Tenants, "Alterar modo de atendimento" deixou de ter
// coluna/botão próprios na tabela (CA01 antigo) e passou a viver dentro do
// menu "•••" de ações de cada linha — cobrindo isso aqui em vez de um
// data-testid dedicado. API mockada via page.route — sem dependência de
// Postgres real.

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

// Toda renderização da tela de Tenants busca também os cards de
// estatística (/resumo) e o catálogo de planos (filtro "Plano ▾") — sem
// mockar os dois, o fetch cairia na rede real (404 no ambiente de teste).
async function entrarNaListaDeTenants(page, tenants = []) {
  await page.route('**/admin/api/tenants/resumo', (route) =>
    route.fulfill({ json: { total: 0, ativos: 0, em_trial: 0, inativos: 0, novos_mes: 0 } })
  );
  await page.route('**/admin/api/planos', (route) => route.fulfill({ json: { planos: [] } }));
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

// Abre o menu "•••" da linha e clica em "Alterar modo de atendimento" —
// caminho único de entrada pra essa ação depois do redesign.
async function abrirModalTrocaModo(page, id) {
  await page.click(`[data-testid="btn-acoes-${id}"]`);
  await page.click(`[data-tenant-acao="alterar-modo"][data-id="${id}"]`);
}

test.describe('Admin — modo de atendimento do tenant (US69)', () => {
  test('CA02 — modal exibe modo atual, modo destino e aviso ao trocar para bot', async ({ page }) => {
    await entrarNaListaDeTenants(page, [tenantMock({ tecnologia: 'ia' })]);
    await abrirModalTrocaModo(page, 't1');

    await expect(page.locator('.modal-card')).toContainText('Salão Kyvvo Teste');
    await expect(page.locator('.modal-card')).toContainText('IA');
    await expect(page.locator('.modal-card')).toContainText('Bot');
    await expect(page.locator('.modal-card')).toContainText('Conversas em andamento');
  });

  test('CA02 — não exibe aviso de conversas ao trocar de bot para ia', async ({ page }) => {
    await entrarNaListaDeTenants(page, [tenantMock({ tecnologia: 'bot' })]);
    await abrirModalTrocaModo(page, 't1');
    await expect(page.locator('.modal-card')).not.toContainText('Conversas em andamento');
  });

  test('CA02 — Cancelar fecha o modal sem chamar a API', async ({ page }) => {
    await entrarNaListaDeTenants(page, [tenantMock({ tecnologia: 'bot' })]);
    let chamouPatch = false;
    await page.route('**/admin/api/tenants/t1/modo', (route) => {
      chamouPatch = true;
      return route.fulfill({ json: {} });
    });

    await abrirModalTrocaModo(page, 't1');
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

    await abrirModalTrocaModo(page, 't1');
    await page.click('#btn-confirmar-modo');

    await expect(page.locator('.toast-sucesso')).toBeVisible();
    expect(corpoEnviado).toEqual({ tecnologia: 'ia' });
  });

  test('CA03 — exibe erro do backend sem fechar o modal', async ({ page }) => {
    await entrarNaListaDeTenants(page, [tenantMock({ tecnologia: 'bot' })]);
    await page.route('**/admin/api/tenants/t1/modo', (route) =>
      route.fulfill({ status: 422, json: { error: 'tecnologia inválida' } })
    );

    await abrirModalTrocaModo(page, 't1');
    await page.click('#btn-confirmar-modo');

    await expect(page.locator('#modo-erro')).toHaveText('tecnologia inválida');
    await expect(page.locator('.modal-overlay')).toBeVisible();
  });
});
