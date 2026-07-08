const { test, expect } = require('@playwright/test');

// Cobre ST09.5 (US09): submit do formulário salva via POST /api/agendamentos,
// fecha o modal, atualiza a agenda e exibe o toast de sucesso — ou mostra o
// erro do backend (ex: conflito de horário) sem fechar o modal. As chamadas de
// API são mockadas via page.route — sem dependência de Postgres real.

async function mockDashboardApis(page) {
  await page.route('**/api/configuracao', (route) =>
    route.fulfill({ json: { dias_funcionamento: [1, 2, 3, 4, 5, 6], formato_hora: '24h' } })
  );
  await page.route('**/api/agendamentos**', (route) => {
    if (route.request().method() === 'GET') {
      return route.fulfill({ json: { view: 'dia', data: '2026-07-06', agendamentos: [] } });
    }
    return route.fallback();
  });
  await page.route('**/api/servicos', (route) =>
    route.fulfill({ json: { servicos: [{ id: 's1', nome: 'Corte', duracao_minutos: 30 }] } })
  );
  await page.route('**/api/profissionais', (route) =>
    route.fulfill({ json: { profissionais: [{ id: 'p1', nome: 'Ana' }] } })
  );
  await page.route('**/api/agendamentos/disponibilidade**', (route) =>
    route.fulfill({ json: { slots: [{ hora: '2026-07-10T14:00:00.000Z', disponivel: true }] } })
  );
}

async function preencherFormulario(page) {
  await page.click('#btn-novo-agendamento');
  await page.fill('#novo-ag-nome', 'Maria');
  await page.selectOption('#novo-ag-servico', 's1');
  await page.selectOption('#novo-ag-profissional', 'p1');
  await page.fill('#novo-ag-data', '2026-07-10');
  await expect(page.locator('#novo-ag-horario option')).not.toHaveCount(0);
}

test.describe('Novo agendamento — salvar (ST09.5)', () => {
  test('sucesso: fecha modal, mostra toast e atualiza a agenda', async ({ page }) => {
    await mockDashboardApis(page);
    let corpoEnviado = null;
    await page.route('**/api/agendamentos', (route) => {
      if (route.request().method() === 'POST') {
        corpoEnviado = route.request().postDataJSON();
        return route.fulfill({ json: { id: 'ag1', ...corpoEnviado } });
      }
      return route.fulfill({ json: { view: 'dia', data: '2026-07-06', agendamentos: [] } });
    });

    await page.addInitScript(() => {
      window.localStorage.setItem('kyvvo_token', 'fake-jwt-token');
      window.localStorage.setItem('kyvvo_nome', 'Ana');
    });
    await page.goto('/painel.html');
    await preencherFormulario(page);
    await page.fill('#novo-ag-observacoes', 'Cliente prefere corte curto');

    await page.click('#btn-salvar-novo-ag');

    await expect(page.locator('#modal-overlay')).toHaveCount(0);
    await expect(page.locator('.toast-sucesso')).toHaveText(/Agendamento cadastrado com sucesso/);
    expect(corpoEnviado).toMatchObject({
      cliente_nome: 'Maria',
      servico_id: 's1',
      profissional_id: 'p1',
      observacoes: 'Cliente prefere corte curto',
      origem: 'portal',
    });
  });

  test('telefone em branco não bloqueia o salvamento (é opcional)', async ({ page }) => {
    await mockDashboardApis(page);
    let corpoEnviado = null;
    await page.route('**/api/agendamentos', (route) => {
      if (route.request().method() === 'POST') {
        corpoEnviado = route.request().postDataJSON();
        return route.fulfill({ json: { id: 'ag1', ...corpoEnviado } });
      }
      return route.fulfill({ json: { view: 'dia', data: '2026-07-06', agendamentos: [] } });
    });

    await page.addInitScript(() => {
      window.localStorage.setItem('kyvvo_token', 'fake-jwt-token');
      window.localStorage.setItem('kyvvo_nome', 'Ana');
    });
    await page.goto('/painel.html');
    await preencherFormulario(page);
    // Telefone deliberadamente deixado em branco.

    await page.click('#btn-salvar-novo-ag');

    await expect(page.locator('#modal-overlay')).toHaveCount(0);
    expect(corpoEnviado.cliente_telefone).toBe('');
  });

  test('conflito de horário: mostra o erro no modal sem fechar', async ({ page }) => {
    await mockDashboardApis(page);
    await page.route('**/api/agendamentos', (route) => {
      if (route.request().method() === 'POST') {
        return route.fulfill({ status: 409, json: { error: 'Conflito de horário: Ana já tem agendamento neste período.' } });
      }
      return route.fulfill({ json: { view: 'dia', data: '2026-07-06', agendamentos: [] } });
    });

    await page.addInitScript(() => {
      window.localStorage.setItem('kyvvo_token', 'fake-jwt-token');
      window.localStorage.setItem('kyvvo_nome', 'Ana');
    });
    await page.goto('/painel.html');
    await preencherFormulario(page);

    await page.click('#btn-salvar-novo-ag');

    await expect(page.locator('#modal-overlay')).toBeVisible();
    await expect(page.locator('#novo-ag-erro')).toHaveText(/Conflito de horário/);
    await expect(page.locator('#btn-salvar-novo-ag')).toBeEnabled();
  });
});
