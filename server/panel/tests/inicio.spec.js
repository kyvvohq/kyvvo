const { test, expect } = require('@playwright/test');

// Cobre o novo item de menu "Início" (dashboard): lista os agendamentos que
// ainda vão acontecer hoje (reaproveita GET /api/agendamentos?view=dia) e dá
// um atalho pra "Novo agendamento". As chamadas de API são mockadas via
// page.route — sem dependência de Postgres real.

async function entrarNoPainel(page, { dia = [] } = {}) {
  // "Agora" fixado às 10h de Brasília — os fixtures de cada teste marcam
  // horários antes/depois desse ponto pra exercitar o filtro de "só o que
  // ainda vai acontecer hoje".
  await page.clock.install({ time: new Date('2026-07-17T10:00:00-03:00') });
  await page.route('**/api/configuracao', (route) =>
    route.fulfill({ json: { dias_funcionamento: [1, 2, 3, 4, 5, 6], formato_hora: '24h' } })
  );
  await page.route('**/api/agendamentos**', (route) => {
    const url = new URL(route.request().url());
    return route.fulfill({ json: { view: 'dia', data: url.searchParams.get('data'), agendamentos: dia } });
  });
  await page.addInitScript(() => {
    window.localStorage.setItem('kyvvo_token', 'fake-jwt-token');
    window.localStorage.setItem('kyvvo_nome', 'Ana');
  });
  await page.goto('/painel.html');
  await page.click('.menu-item[data-menu="inicio"]');
}

test.describe('Início (dashboard)', () => {
  test('item de menu "Início" existe e navega pra ele', async ({ page }) => {
    await entrarNoPainel(page);
    await expect(page.locator('.menu-item[data-menu="inicio"]')).toHaveText('Início');
    await expect(page.locator('.menu-item[data-menu="inicio"]')).toHaveClass(/active/);
  });

  test('lista só os agendamentos de hoje que ainda vão acontecer', async ({ page }) => {
    await entrarNoPainel(page, {
      dia: [
        { id: 'passado', data_hora: '2026-07-17T12:00:00.000Z', status: 'confirmado', cliente: 'Maria', profissional: 'Bruna', servico: 'Corte', duracao_minutos: 30, preco: '50.00' },
        { id: 'futuro', data_hora: '2026-07-17T16:00:00.000Z', status: 'confirmado', cliente: 'Joana', profissional: 'Ana', servico: 'Escova', duracao_minutos: 45, preco: '40.00' },
        { id: 'cancelado-futuro', data_hora: '2026-07-17T18:00:00.000Z', status: 'cancelado', cliente: 'Léo', profissional: 'Ana', servico: 'Barba', duracao_minutos: 20, preco: '30.00' },
      ],
    });

    await expect(page.locator('.agendamento-item[data-id="futuro"]')).toBeVisible();
    await expect(page.locator('.agendamento-item[data-id="passado"]')).toHaveCount(0);
    await expect(page.locator('.agendamento-item[data-id="cancelado-futuro"]')).toHaveCount(0);
  });

  test('estado vazio mostra mensagem específica', async ({ page }) => {
    await entrarNoPainel(page, { dia: [] });
    await expect(page.locator('.vazio')).toHaveText('Nenhum agendamento para o restante de hoje.');
  });

  test('botão "+ Novo agendamento" abre o modal', async ({ page }) => {
    await entrarNoPainel(page, { dia: [] });
    await page.click('#btn-inicio-novo-agendamento');
    await expect(page.locator('#modal-overlay')).toBeVisible();
    await expect(page.locator('.modal-card h3')).toHaveText('Novo agendamento');
  });
});
