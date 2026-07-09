const { test, expect } = require('@playwright/test');

// Cobre US17: CRUD de serviços e profissionais pelo portal (listar, criar,
// editar, excluir, e o vínculo de quais serviços cada profissional atende).
// As chamadas de API são mockadas via page.route — sem dependência de
// Postgres real.

async function entrarNoPainel(page, { servicos = [], profissionais = [] } = {}) {
  await page.route('**/api/configuracao', (route) =>
    route.fulfill({ json: { dias_funcionamento: [1, 2, 3, 4, 5, 6], formato_hora: '24h', segmento: 'salao_beleza' } })
  );
  await page.route('**/api/agendamentos**', (route) =>
    route.fulfill({ json: { view: 'dia', data: '2026-07-09', agendamentos: [] } })
  );
  await page.route('**/api/servicos', (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    return route.fulfill({ json: { servicos } });
  });
  await page.route('**/api/profissionais', (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    return route.fulfill({ json: { profissionais } });
  });
  await page.addInitScript(() => {
    window.localStorage.setItem('kyvvo_token', 'fake-jwt-token');
    window.localStorage.setItem('kyvvo_nome', 'Ana');
  });
  await page.goto('/painel.html');
}

test.describe('Serviços — CRUD (US17)', () => {
  test('lista os serviços cadastrados', async ({ page }) => {
    await entrarNoPainel(page, { servicos: [{ id: 's1', nome: 'Corte', duracao_minutos: 30, preco: 50 }] });
    await page.click('.menu-item[data-menu="servicos"]');
    const item = page.locator('.agendamento-item');
    await expect(item).toContainText('Corte');
    await expect(item).toContainText('30min');
    await expect(item).toContainText('R$ 50,00');
  });

  test('sem serviços cadastrados, mostra mensagem vazia', async ({ page }) => {
    await entrarNoPainel(page, { servicos: [] });
    await page.click('.menu-item[data-menu="servicos"]');
    await expect(page.locator('.vazio')).toContainText('Nenhum serviço cadastrado');
  });

  test('cria um novo serviço', async ({ page }) => {
    await entrarNoPainel(page, { servicos: [] });
    let corpoEnviado = null;
    await page.route('**/api/servicos', (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      corpoEnviado = route.request().postDataJSON();
      return route.fulfill({ status: 201, json: { id: 'novo', ...corpoEnviado } });
    });

    await page.click('.menu-item[data-menu="servicos"]');
    await page.click('#btn-novo-servico');
    await page.fill('#servico-nome', 'Escova');
    await page.fill('#servico-duracao', '45');
    await page.fill('#servico-preco', '60');
    await page.click('#btn-salvar-servico');

    await expect(page.locator('.toast-sucesso')).toHaveText(/criado com sucesso/);
    expect(corpoEnviado).toMatchObject({ nome: 'Escova', duracao_minutos: 45, preco: 60 });
  });

  test('editar um serviço existente pré-preenche o formulário', async ({ page }) => {
    await entrarNoPainel(page, { servicos: [{ id: 's1', nome: 'Corte', duracao_minutos: 30, preco: 50 }] });
    await page.click('.menu-item[data-menu="servicos"]');
    await page.click('[data-acoes-toggle="s1"]');
    await page.click('[data-acao-servico="editar"]');

    await expect(page.locator('#servico-nome')).toHaveValue('Corte');
    await expect(page.locator('#servico-duracao')).toHaveValue('30');
    await expect(page.locator('#servico-preco')).toHaveValue('50');
  });

  test('excluir bloqueado por agendamento futuro mostra o erro do backend', async ({ page }) => {
    await entrarNoPainel(page, { servicos: [{ id: 's1', nome: 'Corte', duracao_minutos: 30, preco: 50 }] });
    await page.route('**/api/servicos/s1', (route) =>
      route.fulfill({ status: 409, json: { error: 'Não é possível excluir: há 2 agendamento(s) futuro(s) usando este serviço.' } })
    );

    await page.click('.menu-item[data-menu="servicos"]');
    await page.click('[data-acoes-toggle="s1"]');
    await page.click('[data-acao-servico="excluir"]');
    await page.click('#btn-confirmar-excluir-servico');

    await expect(page.locator('#excluir-servico-erro')).toHaveText(/agendamento\(s\) futuro\(s\)/);
    await expect(page.locator('.modal-overlay')).toBeVisible();
  });

  test('exclui um serviço sem conflito', async ({ page }) => {
    await entrarNoPainel(page, { servicos: [{ id: 's1', nome: 'Corte', duracao_minutos: 30, preco: null }] });
    await page.route('**/api/servicos/s1', (route) => route.fulfill({ json: { ok: true } }));

    await page.click('.menu-item[data-menu="servicos"]');
    await page.click('[data-acoes-toggle="s1"]');
    await page.click('[data-acao-servico="excluir"]');
    await page.click('#btn-confirmar-excluir-servico');

    await expect(page.locator('.toast-sucesso')).toHaveText(/excluído com sucesso/);
  });
});

test.describe('Profissionais — CRUD (US17)', () => {
  test('lista os profissionais com a contagem de serviços atendidos', async ({ page }) => {
    await entrarNoPainel(page, {
      profissionais: [{ id: 'p1', nome: 'Bruna', servicos: ['s1', 's2'] }],
    });
    await page.click('.menu-item[data-menu="profissionais"]');
    const item = page.locator('.agendamento-item');
    await expect(item).toContainText('Bruna');
    await expect(item).toContainText('2 serviços atendidos');
  });

  test('cria profissional novo com serviços selecionados', async ({ page }) => {
    await entrarNoPainel(page, { profissionais: [] });
    await page.route('**/api/servicos', (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      return route.fulfill({ json: { servicos: [{ id: 's1', nome: 'Corte', duracao_minutos: 30, preco: 50 }] } });
    });
    let corpoEnviado = null;
    await page.route('**/api/profissionais', (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      corpoEnviado = route.request().postDataJSON();
      return route.fulfill({ status: 201, json: { id: 'novo', ...corpoEnviado } });
    });

    await page.click('.menu-item[data-menu="profissionais"]');
    await page.click('#btn-novo-profissional');
    await page.fill('#profissional-nome', 'Carla');
    await page.check('#profissional-servicos input[value="s1"]');
    await page.click('#btn-salvar-profissional');

    await expect(page.locator('.toast-sucesso')).toHaveText(/criado com sucesso/);
    expect(corpoEnviado).toMatchObject({ nome: 'Carla', servicos: ['s1'] });
  });

  test('nome em branco fica destacado como obrigatório', async ({ page }) => {
    await entrarNoPainel(page, { profissionais: [] });
    await page.route('**/api/servicos', (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      return route.fulfill({ json: { servicos: [] } });
    });

    await page.click('.menu-item[data-menu="profissionais"]');
    await page.click('#btn-novo-profissional');
    await page.click('#btn-salvar-profissional');

    await expect(page.locator('#profissional-nome')).toHaveClass(/campo-invalido/);
  });
});
