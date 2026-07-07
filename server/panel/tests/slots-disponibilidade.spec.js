const { test, expect } = require('@playwright/test');

// Cobre ST09.3 (US09): integração do dropdown de horários do formulário de novo
// agendamento com GET /agendamentos/disponibilidade. Slots ocupados aparecem
// desabilitados, um skeleton loader é exibido durante a carga e, quando não há
// horário livre na data, um aviso é mostrado. As chamadas de API são mockadas
// via page.route — sem dependência de Postgres real.

async function mockDashboardApis(page) {
  await page.route('**/api/configuracao', (route) =>
    route.fulfill({ json: { dias_funcionamento: [1, 2, 3, 4, 5, 6], formato_hora: '24h' } })
  );
  await page.route('**/api/agendamentos**', (route) =>
    route.fulfill({ json: { view: 'dia', data: '2026-07-06', agendamentos: [] } })
  );
  await page.route('**/api/servicos', (route) =>
    route.fulfill({ json: { servicos: [{ id: 's1', nome: 'Corte', duracao_minutos: 30 }] } })
  );
  await page.route('**/api/profissionais', (route) =>
    route.fulfill({ json: { profissionais: [{ id: 'p1', nome: 'Ana' }] } })
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

// Preenche serviço, profissional e data — os três parâmetros que disparam a
// carga dos slots via GET /agendamentos/disponibilidade.
async function preencherContexto(page) {
  await page.selectOption('#novo-ag-servico', 's1');
  await page.selectOption('#novo-ag-profissional', 'p1');
  await page.fill('#novo-ag-data', '2026-07-10');
}

test.describe('Novo agendamento — dropdown de slots (ST09.3)', () => {
  test('carrega os slots ao selecionar serviço, profissional e data; ocupados desabilitados', async ({ page }) => {
    await abrirFormulario(page);
    await page.route('**/api/agendamentos/disponibilidade**', (route) =>
      route.fulfill({
        json: {
          data: '2026-07-10',
          slots: [
            { hora: '2026-07-10T11:00:00.000Z', disponivel: true },
            { hora: '2026-07-10T11:30:00.000Z', disponivel: false },
            { hora: '2026-07-10T12:00:00.000Z', disponivel: true },
          ],
        },
      })
    );

    await preencherContexto(page);

    const opcoes = page.locator('#novo-ag-horario option');
    await expect(opcoes).toHaveCount(3);

    // O slot ocupado fica desabilitado e sinalizado com "(ocupado)".
    const ocupado = page.locator('#novo-ag-horario option[value="2026-07-10T11:30:00.000Z"]');
    await expect(ocupado).toBeDisabled();
    await expect(ocupado).toContainText('(ocupado)');

    // O primeiro slot livre é selecionado automaticamente.
    await expect(page.locator('#novo-ag-horario')).toHaveValue('2026-07-10T11:00:00.000Z');
    await expect(page.locator('#novo-ag-horario-aviso')).toHaveText('');
  });

  test('exibe skeleton loader enquanto os slots carregam', async ({ page }) => {
    await abrirFormulario(page);
    await page.route('**/api/agendamentos/disponibilidade**', async (route) => {
      await new Promise((r) => setTimeout(r, 400));
      await route.fulfill({
        json: { data: '2026-07-10', slots: [{ hora: '2026-07-10T11:00:00.000Z', disponivel: true }] },
      });
    });

    await preencherContexto(page);

    // Durante a carga: skeleton visível e select escondido.
    await expect(page.locator('#novo-ag-horario-skeleton')).toBeVisible();
    await expect(page.locator('#novo-ag-horario')).toBeHidden();

    // Terminada a carga: skeleton some e o select volta com os slots.
    await expect(page.locator('#novo-ag-horario-skeleton')).toBeHidden();
    await expect(page.locator('#novo-ag-horario')).toBeVisible();
  });

  test('sem horários livres na data, exibe aviso e mantém o horário sem seleção', async ({ page }) => {
    await abrirFormulario(page);
    await page.route('**/api/agendamentos/disponibilidade**', (route) =>
      route.fulfill({
        json: {
          data: '2026-07-10',
          slots: [
            { hora: '2026-07-10T11:00:00.000Z', disponivel: false },
            { hora: '2026-07-10T11:30:00.000Z', disponivel: false },
          ],
        },
      })
    );

    await preencherContexto(page);

    await expect(page.locator('#novo-ag-horario-aviso')).toHaveText(
      'Nenhum horário disponível nesta data. Tente outra data.'
    );
    await expect(page.locator('#novo-ag-horario')).toHaveValue('');

    // Como não há horário selecionado, o formulário barra o horário obrigatório.
    await page.click('#btn-salvar-novo-ag');
    await expect(page.locator('#novo-ag-horario')).toHaveClass(/campo-invalido/);
  });

  test('não busca disponibilidade enquanto faltar serviço, profissional ou data', async ({ page }) => {
    await abrirFormulario(page);
    let chamou = false;
    await page.route('**/api/agendamentos/disponibilidade**', (route) => {
      chamou = true;
      route.fulfill({ json: { data: '2026-07-10', slots: [] } });
    });

    // Apenas serviço e profissional; sem data ainda.
    await page.selectOption('#novo-ag-servico', 's1');
    await page.selectOption('#novo-ag-profissional', 'p1');

    await expect(page.locator('#novo-ag-horario')).toHaveValue('');
    await expect(page.locator('#novo-ag-horario option')).toContainText('Selecione serviço, profissional e data');
    expect(chamou).toBe(false);
  });
});
