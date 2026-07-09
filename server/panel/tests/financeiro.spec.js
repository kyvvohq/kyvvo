const { test, expect } = require('@playwright/test');

// Cobre US18: controle financeiro simples (entrada/saída), primeira
// funcionalidade real do módulo "financeiro" — só aparece no menu se o
// módulo estiver ativo, e mostra resumo + lista + formulário de novo
// lançamento. As chamadas de API são mockadas via page.route — sem
// dependência de Postgres real.

async function entrarNoPainel(page, { lancamentos = [], resumo = { entradas: 0, saidas: 0, saldo: 0 } } = {}) {
  await page.route('**/api/configuracao', (route) =>
    route.fulfill({ json: { dias_funcionamento: [1, 2, 3, 4, 5, 6], formato_hora: '24h', segmento: 'salao_beleza' } })
  );
  await page.route('**/api/agendamentos**', (route) =>
    route.fulfill({ json: { view: 'dia', data: '2026-07-09', agendamentos: [] } })
  );
  await page.route('**/api/tenant/modulos', (route) =>
    route.fulfill({ json: { modulos: [{ key: 'financeiro', nome: 'Financeiro', preco_mensal: null }] } })
  );
  await page.route('**/api/financeiro/lancamentos**', (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    return route.fulfill({ json: { mes: '2026-07', lancamentos, resumo } });
  });
  await page.addInitScript(() => {
    window.localStorage.setItem('kyvvo_token', 'fake-jwt-token');
    window.localStorage.setItem('kyvvo_nome', 'Ana');
  });
  await page.goto('/painel.html');
  await page.click('.menu-item[data-menu="modulo:financeiro"]');
}

test.describe('Financeiro (US18)', () => {
  test('mostra o resumo de entradas, saídas e saldo do período', async ({ page }) => {
    await entrarNoPainel(page, { resumo: { entradas: 200, saidas: 50, saldo: 150 } });
    await expect(page.locator('.financeiro-entrada').first()).toHaveText('R$ 200,00');
    await expect(page.locator('.financeiro-saida').first()).toHaveText('R$ 50,00');
  });

  test('lista os lançamentos do mês', async ({ page }) => {
    await entrarNoPainel(page, {
      lancamentos: [{ id: 'l1', tipo: 'entrada', valor: 80, descricao: 'Venda balcão', data: '2026-07-05' }],
    });
    await expect(page.locator('.agendamento-item')).toContainText('Venda balcão');
    await expect(page.locator('.agendamento-item')).toContainText('R$ 80,00');
  });

  test('sem lançamentos, mostra mensagem vazia', async ({ page }) => {
    await entrarNoPainel(page, { lancamentos: [] });
    await expect(page.locator('.vazio').last()).toContainText('Nenhum lançamento neste mês');
  });

  test('cria um novo lançamento de entrada', async ({ page }) => {
    await entrarNoPainel(page, { lancamentos: [] });
    let corpoEnviado = null;
    await page.route('**/api/financeiro/lancamentos', (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      corpoEnviado = route.request().postDataJSON();
      return route.fulfill({ status: 201, json: { id: 'novo', ...corpoEnviado } });
    });

    await page.click('#btn-novo-lancamento');
    await page.selectOption('#lancamento-tipo', 'entrada');
    await page.fill('#lancamento-valor', '120.50');
    await page.fill('#lancamento-descricao', 'Pacote mensal');
    await page.click('#btn-salvar-lancamento');

    await expect(page.locator('.toast-sucesso')).toHaveText(/registrado com sucesso/);
    expect(corpoEnviado).toMatchObject({ tipo: 'entrada', valor: 120.5, descricao: 'Pacote mensal' });
  });

  test('valor em branco fica destacado como obrigatório', async ({ page }) => {
    await entrarNoPainel(page, { lancamentos: [] });
    await page.click('#btn-novo-lancamento');
    await page.click('#btn-salvar-lancamento');
    await expect(page.locator('#lancamento-valor')).toHaveClass(/campo-invalido/);
  });

  test('erro do backend (ex: módulo desativado) aparece no modal', async ({ page }) => {
    await entrarNoPainel(page, { lancamentos: [] });
    await page.route('**/api/financeiro/lancamentos', (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      return route.fulfill({ status: 403, json: { error: 'Módulo não ativo para este tenant' } });
    });

    await page.click('#btn-novo-lancamento');
    await page.selectOption('#lancamento-tipo', 'saida');
    await page.fill('#lancamento-valor', '30');
    await page.click('#btn-salvar-lancamento');

    await expect(page.locator('#lancamento-erro')).toHaveText(/Módulo não ativo/);
  });
});
