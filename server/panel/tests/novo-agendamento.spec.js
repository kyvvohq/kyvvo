const { test, expect } = require('@playwright/test');

// Cobre ST09.1 (US09): botão em destaque "+ Novo agendamento" na tela de agenda
// e abertura do modal do formulário de cadastro. As chamadas de API são mockadas
// via page.route — sem dependência de Postgres real.

async function mockDashboardApis(page) {
  await page.route('**/api/configuracao', (route) =>
    route.fulfill({ json: { dias_funcionamento: [1, 2, 3, 4, 5, 6], formato_hora: '24h' } })
  );
  await page.route('**/api/agendamentos**', (route) =>
    route.fulfill({ json: { view: 'dia', data: '2026-07-06', agendamentos: [] } })
  );
}

async function entrarNoPainel(page) {
  await mockDashboardApis(page);
  await page.addInitScript(() => {
    window.localStorage.setItem('kyvvo_token', 'fake-jwt-token');
    window.localStorage.setItem('kyvvo_nome', 'Ana');
  });
  await page.goto('/painel.html');
}

test.describe('Novo agendamento — botão na agenda (ST09.1)', () => {
  test('botão "+ Novo agendamento" aparece na tela de agenda', async ({ page }) => {
    await entrarNoPainel(page);
    await expect(page.locator('#btn-novo-agendamento')).toBeVisible();
  });

  test('botão continua visível ao trocar entre as views dia, semana e mês', async ({ page }) => {
    await entrarNoPainel(page);
    for (const aba of ['semana', 'mes', 'dia']) {
      await page.click(`.tab[data-tab="${aba}"]`);
      await expect(page.locator('#btn-novo-agendamento')).toBeVisible();
    }
  });

  test('clicar no botão abre o modal do formulário de cadastro', async ({ page }) => {
    await entrarNoPainel(page);
    await page.click('#btn-novo-agendamento');
    await expect(page.locator('#modal-overlay')).toBeVisible();
    await expect(page.locator('.modal-card h3')).toHaveText('Novo agendamento');
    await expect(page.locator('#form-novo-agendamento')).toBeVisible();
  });

  test('fechar o modal pelo botão de fechar remove o overlay', async ({ page }) => {
    await entrarNoPainel(page);
    await page.click('#btn-novo-agendamento');
    await expect(page.locator('#modal-overlay')).toBeVisible();
    await page.click('#modal-close');
    await expect(page.locator('#modal-overlay')).toHaveCount(0);
  });

  test('o botão fica oculto fora do menu de agendamento (Perfil)', async ({ page }) => {
    await page.route('**/api/perfil', (route) => route.fulfill({ json: { nome: 'Salão Ana', telefone: '', endereco: '' } }));
    await entrarNoPainel(page);
    await page.click('#user-menu-toggle');
    await page.click('.user-menu-item[data-menu="perfil"]');
    await expect(page.locator('#btn-novo-agendamento')).toBeHidden();
  });
});
