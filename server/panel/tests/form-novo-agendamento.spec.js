const { test, expect } = require('@playwright/test');

// Cobre ST09.2 (US09): formulário de cadastro com todos os campos e a validação
// de obrigatórios com destaque visual em vermelho. As chamadas de API são
// mockadas via page.route — sem dependência de Postgres real.

async function mockDashboardApis(page) {
  await page.route('**/api/configuracao', (route) =>
    route.fulfill({ json: { dias_funcionamento: [1, 2, 3, 4, 5, 6], formato_hora: '24h' } })
  );
  await page.route('**/api/agendamentos**', (route) =>
    route.fulfill({ json: { view: 'dia', data: '2026-07-06', agendamentos: [] } })
  );
  await page.route('**/api/servicos', (route) =>
    route.fulfill({ json: { servicos: [
      { id: 's1', nome: 'Corte', duracao_minutos: 30 },
      { id: 's2', nome: 'Escova', duracao_minutos: 45 },
    ] } })
  );
  await page.route('**/api/profissionais', (route) =>
    route.fulfill({ json: { profissionais: [
      { id: 'p1', nome: 'Ana' },
      { id: 'p2', nome: 'Bruna' },
    ] } })
  );
}

async function abrirFormulario(page) {
  await mockDashboardApis(page);
  await page.addInitScript(() => {
    window.localStorage.setItem('kyvvo_token', 'fake-jwt-token');
    window.localStorage.setItem('kyvvo_nome', 'Ana');
  });
  await page.goto('/painel.html');
  await page.click('#btn-novo-agendamento');
  await expect(page.locator('#form-novo-agendamento')).toBeVisible();
}

test.describe('Novo agendamento — formulário de cadastro (ST09.2)', () => {
  test('o formulário contém todos os campos previstos', async ({ page }) => {
    await abrirFormulario(page);
    for (const campo of [
      '#novo-ag-nome',
      '#novo-ag-telefone',
      '#novo-ag-servico',
      '#novo-ag-profissional',
      '#novo-ag-data',
      '#novo-ag-horario',
      '#novo-ag-observacoes',
    ]) {
      await expect(page.locator(campo)).toBeVisible();
    }
  });

  test('serviços e profissionais são carregados nos dropdowns', async ({ page }) => {
    await abrirFormulario(page);
    await expect(page.locator('#novo-ag-servico option')).toContainText(['Selecione...', 'Corte (30min)', 'Escova (45min)']);
    await expect(page.locator('#novo-ag-profissional option')).toContainText(['Selecione...', 'Ana', 'Bruna']);
  });

  test('submeter vazio destaca os campos obrigatórios em vermelho', async ({ page }) => {
    await abrirFormulario(page);
    await page.click('#btn-salvar-novo-ag');

    // Telefone é obrigatório (é o canal de comunicação com a cliente).
    await expect(page.locator('#novo-ag-nome')).toHaveClass(/campo-invalido/);
    await expect(page.locator('#novo-ag-telefone')).toHaveClass(/campo-invalido/);
    await expect(page.locator('#novo-ag-servico')).toHaveClass(/campo-invalido/);
    await expect(page.locator('#novo-ag-profissional')).toHaveClass(/campo-invalido/);
    await expect(page.locator('#novo-ag-data')).toHaveClass(/campo-invalido/);
    await expect(page.locator('#novo-ag-horario')).toHaveClass(/campo-invalido/);
    await expect(page.locator('#novo-ag-erro')).toHaveText('Preencha os campos obrigatórios destacados em vermelho.');
  });

  test('preencher um campo obrigatório remove seu destaque de erro', async ({ page }) => {
    await abrirFormulario(page);
    await page.click('#btn-salvar-novo-ag');
    await expect(page.locator('#novo-ag-nome')).toHaveClass(/campo-invalido/);

    await page.fill('#novo-ag-nome', 'Maria');
    await expect(page.locator('#novo-ag-nome')).not.toHaveClass(/campo-invalido/);
    // Os demais obrigatórios continuam destacados até serem preenchidos.
    await expect(page.locator('#novo-ag-servico')).toHaveClass(/campo-invalido/);
  });

  test('telefone em branco fica destacado como obrigatório', async ({ page }) => {
    await abrirFormulario(page);
    await page.fill('#novo-ag-nome', 'Maria');
    await page.selectOption('#novo-ag-servico', 's1');
    await page.selectOption('#novo-ag-profissional', 'p1');
    await page.fill('#novo-ag-data', '2026-07-10');
    await page.click('#btn-salvar-novo-ag');
    await expect(page.locator('#novo-ag-telefone')).toHaveClass(/campo-invalido/);
    await expect(page.locator('#novo-ag-nome')).not.toHaveClass(/campo-invalido/);

    await page.fill('#novo-ag-telefone', '11999999999');
    await expect(page.locator('#novo-ag-telefone')).not.toHaveClass(/campo-invalido/);
  });
});
