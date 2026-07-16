const { test, expect } = require('@playwright/test');

// Cobre o segmento de negócio do tenant (salão de beleza, petshop, etc.) na
// tela de Configuração — o texto de "dias de funcionamento" se adapta ao
// segmento. A exibição do segmento no Perfil foi substituída pelos novos
// campos da US33 (ver tests/perfil.spec.js); esta suíte cobre só o que
// continua igual. As chamadas de API são mockadas via page.route — sem
// dependência de Postgres real.

async function entrarNoPainel(page, { segmento = 'salao_beleza' } = {}) {
  await page.route('**/api/configuracao', (route) =>
    route.fulfill({
      json: { dias_funcionamento: [1, 2, 3, 4, 5, 6], formato_hora: '24h', horario_abertura: '08:00:00', horario_fechamento: '20:00:00', segmento },
    })
  );
  await page.route('**/api/agendamentos**', (route) =>
    route.fulfill({ json: { view: 'dia', data: '2026-07-09', agendamentos: [] } })
  );
  await page.addInitScript(() => {
    window.localStorage.setItem('kyvvo_token', 'fake-jwt-token');
    window.localStorage.setItem('kyvvo_nome', 'Ana');
  });
  await page.goto('/painel.html');
  await page.click('.menu-item[data-menu="configuracao"]');
}

test.describe('Segmento do negócio — Configuração', () => {
  test('view Configuração usa o segmento no texto de dias de funcionamento (petshop)', async ({ page }) => {
    await entrarNoPainel(page, { segmento: 'petshop' });
    await expect(page.locator('.perfil-form label').first()).toHaveText(/o petshop funciona/);
  });

  test('view Configuração usa o segmento no texto de dias de funcionamento (salão de beleza)', async ({ page }) => {
    await entrarNoPainel(page, { segmento: 'salao_beleza' });
    await expect(page.locator('.perfil-form label').first()).toHaveText(/o salão funciona/);
  });
});
