const { test, expect } = require('@playwright/test');

// Cobre US02.5 (nome do dia da semana abaixo da data na view Dia) e US02.6
// (view Mês lista horário-duração de cada agendamento, empilhados na célula,
// em vez de só uma contagem). As chamadas de API são mockadas via
// page.route — sem dependência de Postgres real.

async function entrarNoPainel(page, { dia, mes } = {}) {
  await page.route('**/api/configuracao', (route) =>
    route.fulfill({ json: { dias_funcionamento: [1, 2, 3, 4, 5, 6], formato_hora: '24h' } })
  );
  await page.route('**/api/agendamentos**', (route) => {
    const url = new URL(route.request().url());
    const view = url.searchParams.get('view');
    if (view === 'mes') return route.fulfill({ json: { view: 'mes', mes: '2026-07', agendamentos: mes || [] } });
    return route.fulfill({ json: { view: 'dia', data: '2026-07-08', agendamentos: dia || [] } });
  });
  await page.addInitScript(() => {
    window.localStorage.setItem('kyvvo_token', 'fake-jwt-token');
    window.localStorage.setItem('kyvvo_nome', 'Ana');
  });
  await page.goto('/painel.html');
}

test.describe('View Dia — nome do dia da semana (US02.5)', () => {
  test('mostra o nome do dia da semana logo abaixo da data', async ({ page }) => {
    await entrarNoPainel(page);
    // A view Dia abre direto na data de hoje (não fixada em teste), então só
    // valida que o elemento existe e tem algum dia da semana em pt-BR.
    const diaSemana = page.locator('.nav-periodo-dia-semana');
    await expect(diaSemana).toBeVisible();
    await expect(diaSemana).toHaveText(/segunda|terça|quarta|quinta|sexta|sábado|domingo/i);
  });
});

test.describe('View Mês — horário-duração empilhados (US02.6)', () => {
  test('dia com um agendamento mostra horário-duração', async ({ page }) => {
    await entrarNoPainel(page, {
      mes: [{ data_hora: '2026-07-10T14:00:00.000Z', status: 'confirmado', duracao_minutos: 30 }],
    });
    await page.click('.tab[data-tab="mes"]');

    const cel = page.locator('.dia-cel').filter({ has: page.locator('.num', { hasText: /^10$/ }) });
    await expect(cel.locator('.dia-cel-ag')).toContainText('30min');
  });

  test('dia com vários agendamentos lista todos empilhados', async ({ page }) => {
    await entrarNoPainel(page, {
      mes: [
        { data_hora: '2026-07-10T11:00:00.000Z', status: 'confirmado', duracao_minutos: 30 },
        { data_hora: '2026-07-10T14:00:00.000Z', status: 'confirmado', duracao_minutos: 60 },
        { data_hora: '2026-07-10T16:00:00.000Z', status: 'cancelado', duracao_minutos: 45 },
      ],
    });
    await page.click('.tab[data-tab="mes"]');

    const cel = page.locator('.dia-cel').filter({ has: page.locator('.num', { hasText: /^10$/ }) });
    const itens = cel.locator('.dia-cel-ag');
    await expect(itens).toHaveCount(3);
    // O cancelado fica com estilo diferenciado (riscado), não escondido.
    await expect(itens.last()).toHaveClass(/dia-cel-ag-cancelado/);
  });

  test('dia sem agendamentos não mostra lista', async ({ page }) => {
    await entrarNoPainel(page, { mes: [] });
    await page.click('.tab[data-tab="mes"]');

    const cel = page.locator('.dia-cel').filter({ has: page.locator('.num', { hasText: /^15$/ }) });
    await expect(cel.locator('.dia-cel-ag')).toHaveCount(0);
  });
});
