const { test, expect } = require('@playwright/test');

// Cobre US32: aba de Pagamentos no portal (Pix recorrente ou cartão de
// crédito) e a integração com a Asaas orquestrada pelo backend. Como nos
// outros specs, as chamadas de API são mockadas via page.route — sem
// dependência de Postgres real nem de uma conta Asaas.

async function entrarNoPainel(page, pagamentos) {
  await page.route('**/api/configuracao', (route) =>
    route.fulfill({ json: { dias_funcionamento: [1, 2, 3, 4, 5, 6], formato_hora: '24h', segmento: 'salao_beleza' } })
  );
  await page.route('**/api/agendamentos**', (route) =>
    route.fulfill({ json: { view: 'dia', data: '2026-07-09', agendamentos: [] } })
  );
  await page.route('**/api/tenant/modulos', (route) => route.fulfill({ json: { modulos: [] } }));
  await page.route('**/api/pagamentos', (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    return route.fulfill({ json: pagamentos });
  });
  await page.addInitScript(() => {
    window.localStorage.setItem('kyvvo_token', 'fake-jwt-token');
    window.localStorage.setItem('kyvvo_nome', 'Ana');
  });
  await page.goto('/painel.html');
  await page.click('.menu-item[data-menu="pagamentos"]');
}

test.describe('Pagamentos (US32)', () => {
  test('trial ativo sem meio cadastrado — mostra plano e botão de cadastro', async ({ page }) => {
    await entrarNoPainel(page, {
      status: 'trial',
      plano: 'trial',
      plano_nome: null,
      valor_plano: null,
      meio_pagamento: null,
      cartao_final: null,
      proxima_cobranca: null,
      historico: [],
      asaas_js_url: null,
    });
    await expect(page.locator('#btn-cadastrar-pagamento')).toHaveText('Cadastrar forma de pagamento');
    await expect(page.locator('.modal-texto')).toContainText('meio de pagamento');
  });

  test('assinatura ativa — mostra plano, meio, status e histórico', async ({ page }) => {
    await entrarNoPainel(page, {
      status: 'ativo',
      plano: 'profissional',
      plano_nome: 'Profissional',
      valor_plano: 247,
      meio_pagamento: 'pix',
      cartao_final: null,
      proxima_cobranca: { data: '2026-08-01', valor: 247 },
      historico: [{ data: '2026-07-01', valor: 247, status: 'CONFIRMED' }],
      asaas_js_url: null,
    });
    await expect(page.locator('.financeiro-resumo-card')).toContainText(['Profissional', 'Pix recorrente', 'Ativo']);
    await expect(page.locator('.modal-texto')).toContainText('01/08/2026');
    await expect(page.locator('.tabela-tenants tbody tr').first()).toContainText('01/07/2026');
    await expect(page.locator('#btn-cadastrar-pagamento')).toHaveText('Alterar forma de pagamento');
  });

  test('cartão de crédito fica desabilitado sem Asaas.js configurada', async ({ page }) => {
    await entrarNoPainel(page, {
      status: 'trial',
      plano: 'trial',
      plano_nome: null,
      valor_plano: null,
      meio_pagamento: null,
      cartao_final: null,
      proxima_cobranca: null,
      historico: [],
      asaas_js_url: null,
    });
    await page.click('#btn-cadastrar-pagamento');
    await expect(page.locator('input[name="meio"][value="cartao"]')).toBeDisabled();
  });

  test('cadastra Pix recorrente com sucesso', async ({ page }) => {
    await entrarNoPainel(page, {
      status: 'trial',
      plano: 'trial',
      plano_nome: null,
      valor_plano: null,
      meio_pagamento: null,
      cartao_final: null,
      proxima_cobranca: null,
      historico: [],
      asaas_js_url: null,
    });

    let corpoEnviado = null;
    await page.route('**/api/pagamentos/cadastrar', (route) => {
      corpoEnviado = route.request().postDataJSON();
      return route.fulfill({
        json: {
          status: 'ativo',
          plano: 'profissional',
          plano_nome: 'Profissional',
          valor_plano: 247,
          meio_pagamento: 'pix',
          cartao_final: null,
          proxima_cobranca: { data: '2026-08-01', valor: 247 },
          historico: [],
          asaas_js_url: null,
        },
      });
    });

    await page.click('#btn-cadastrar-pagamento');
    await page.click('#btn-salvar-pagamento');

    await expect(page.locator('.toast-sucesso')).toHaveText(/assinatura está ativa/);
    expect(corpoEnviado).toMatchObject({ meio: 'pix' });
  });

  test('erro do backend na integração com a Asaas aparece no modal', async ({ page }) => {
    await entrarNoPainel(page, {
      status: 'trial',
      plano: 'trial',
      plano_nome: null,
      valor_plano: null,
      meio_pagamento: null,
      cartao_final: null,
      proxima_cobranca: null,
      historico: [],
      asaas_js_url: null,
    });
    await page.route('**/api/pagamentos/cadastrar', (route) =>
      route.fulfill({ status: 502, json: { error: 'Não foi possível processar o pagamento agora. Tente novamente em instantes.' } })
    );

    await page.click('#btn-cadastrar-pagamento');
    await page.click('#btn-salvar-pagamento');

    await expect(page.locator('#pagamento-erro')).toHaveText(/Não foi possível processar/);
  });
});
