const { test, expect } = require('@playwright/test');

// Cobre o horário de funcionamento do salão na aba Configuração: carrega os
// valores atuais, salva um novo intervalo e exibe o erro do backend (em vez
// de "Salvo com sucesso!") quando a validação falha. As chamadas de API são
// mockadas via page.route — sem dependência de Postgres real.

async function entrarNaConfiguracao(page, configuracaoInicial) {
  await page.route('**/api/configuracao', (route) => {
    if (route.request().method() === 'PATCH') return route.fallback();
    return route.fulfill({ json: configuracaoInicial });
  });
  await page.route('**/api/agendamentos**', (route) =>
    route.fulfill({ json: { view: 'dia', data: '2026-07-08', agendamentos: [] } })
  );
  await page.addInitScript(() => {
    window.localStorage.setItem('kyvvo_token', 'fake-jwt-token');
    window.localStorage.setItem('kyvvo_nome', 'Ana');
  });
  await page.goto('/painel.html');
  await page.click('.menu-item[data-menu="configuracao"]');
  await expect(page.locator('#config-horario-abertura')).toBeVisible();
}

test.describe('Configuração — horário de funcionamento', () => {
  test('carrega o horário de abertura/fechamento salvo', async ({ page }) => {
    await entrarNaConfiguracao(page, {
      dias_funcionamento: [1, 2, 3, 4, 5, 6],
      formato_hora: '24h',
      horario_abertura: '09:00:00',
      horario_fechamento: '18:00:00',
    });

    await expect(page.locator('#config-horario-abertura')).toHaveValue('09:00');
    await expect(page.locator('#config-horario-fechamento')).toHaveValue('18:00');
  });

  test('salva um novo horário de funcionamento', async ({ page }) => {
    await entrarNaConfiguracao(page, {
      dias_funcionamento: [1, 2, 3, 4, 5, 6],
      formato_hora: '24h',
      horario_abertura: '08:00:00',
      horario_fechamento: '20:00:00',
    });

    let corpoEnviado = null;
    await page.route('**/api/configuracao', (route) => {
      if (route.request().method() !== 'PATCH') return route.fallback();
      corpoEnviado = route.request().postDataJSON();
      return route.fulfill({
        json: {
          dias_funcionamento: [1, 2, 3, 4, 5, 6],
          formato_hora: '24h',
          horario_abertura: '09:00:00',
          horario_fechamento: '19:00:00',
        },
      });
    });

    await page.fill('#config-horario-abertura', '09:00');
    await page.fill('#config-horario-fechamento', '19:00');
    await page.click('#form-config button[type="submit"]');

    await expect(page.locator('#config-msg')).toHaveText('Salvo com sucesso!');
    expect(corpoEnviado).toMatchObject({ horarioAbertura: '09:00', horarioFechamento: '19:00' });
  });

  test('erro de validação do backend aparece na mensagem (não finge sucesso)', async ({ page }) => {
    await entrarNaConfiguracao(page, {
      dias_funcionamento: [1, 2, 3, 4, 5, 6],
      formato_hora: '24h',
      horario_abertura: '08:00:00',
      horario_fechamento: '20:00:00',
    });

    await page.route('**/api/configuracao', (route) => {
      if (route.request().method() !== 'PATCH') return route.fallback();
      return route.fulfill({
        status: 400,
        json: { error: 'Horário de abertura precisa ser antes do horário de fechamento' },
      });
    });

    await page.fill('#config-horario-abertura', '21:00');
    await page.fill('#config-horario-fechamento', '20:00');
    await page.click('#form-config button[type="submit"]');

    await expect(page.locator('#config-msg')).toHaveText('Horário de abertura precisa ser antes do horário de fechamento');
  });
});
