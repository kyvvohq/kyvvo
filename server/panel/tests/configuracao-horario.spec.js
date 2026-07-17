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

test.describe('Configuração — dias de funcionamento (grid de 7 colunas)', () => {
  test('exibe um toggle por dia, marcado conforme dias_funcionamento', async ({ page }) => {
    await entrarNaConfiguracao(page, {
      dias_funcionamento: [1, 3, 5],
      formato_hora: '24h',
      horario_abertura: '08:00:00',
      horario_fechamento: '20:00:00',
    });

    const toggles = page.locator('.dias-grid input[type="checkbox"]');
    await expect(toggles).toHaveCount(7);
    await expect(page.locator('.dias-grid input[value="1"]')).toBeChecked();
    await expect(page.locator('.dias-grid input[value="3"]')).toBeChecked();
    await expect(page.locator('.dias-grid input[value="5"]')).toBeChecked();
    await expect(page.locator('.dias-grid input[value="0"]')).not.toBeChecked();
  });

  test('salva a lista de dias marcados', async ({ page }) => {
    await entrarNaConfiguracao(page, {
      dias_funcionamento: [1, 2, 3, 4, 5],
      formato_hora: '24h',
      horario_abertura: '08:00:00',
      horario_fechamento: '20:00:00',
    });

    let corpoEnviado = null;
    await page.route('**/api/configuracao', (route) => {
      if (route.request().method() !== 'PATCH') return route.fallback();
      corpoEnviado = route.request().postDataJSON();
      return route.fulfill({ json: { dias_funcionamento: [0, 1, 2, 3, 4, 5, 6], formato_hora: '24h', horario_abertura: '08:00:00', horario_fechamento: '20:00:00' } });
    });

    await page.click('.dias-grid input[value="0"]');
    await page.click('.dias-grid input[value="6"]');
    await page.click('#form-config button[type="submit"]');

    await expect(page.locator('#config-msg')).toHaveText('Salvo com sucesso!');
    expect(corpoEnviado.diasFuncionamento.sort()).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });
});

test.describe('Configuração — horário de almoço', () => {
  test('campos de início/término ficam ocultos quando o almoço está desativado', async ({ page }) => {
    await entrarNaConfiguracao(page, {
      dias_funcionamento: [1, 2, 3, 4, 5, 6],
      formato_hora: '24h',
      horario_abertura: '08:00:00',
      horario_fechamento: '20:00:00',
      horario_almoco_ativo: false,
    });

    await expect(page.locator('#config-almoco-ativo')).not.toBeChecked();
    await expect(page.locator('#config-almoco-campos')).toBeHidden();
  });

  test('campos de início/término aparecem já preenchidos quando o almoço está ativo', async ({ page }) => {
    await entrarNaConfiguracao(page, {
      dias_funcionamento: [1, 2, 3, 4, 5, 6],
      formato_hora: '24h',
      horario_abertura: '08:00:00',
      horario_fechamento: '20:00:00',
      horario_almoco_ativo: true,
      horario_almoco_inicio: '12:00:00',
      horario_almoco_fim: '13:30:00',
    });

    await expect(page.locator('#config-almoco-ativo')).toBeChecked();
    await expect(page.locator('#config-almoco-campos')).toBeVisible();
    await expect(page.locator('#config-almoco-inicio')).toHaveValue('12:00');
    await expect(page.locator('#config-almoco-fim')).toHaveValue('13:30');
  });

  test('ligar o toggle exibe os campos na hora, sem precisar salvar', async ({ page }) => {
    await entrarNaConfiguracao(page, {
      dias_funcionamento: [1, 2, 3, 4, 5, 6],
      formato_hora: '24h',
      horario_abertura: '08:00:00',
      horario_fechamento: '20:00:00',
      horario_almoco_ativo: false,
    });

    await expect(page.locator('#config-almoco-campos')).toBeHidden();
    await page.click('#config-almoco-ativo');
    await expect(page.locator('#config-almoco-campos')).toBeVisible();
    await page.click('#config-almoco-ativo');
    await expect(page.locator('#config-almoco-campos')).toBeHidden();
  });

  test('salva horário de almoço ativado com início/término', async ({ page }) => {
    await entrarNaConfiguracao(page, {
      dias_funcionamento: [1, 2, 3, 4, 5, 6],
      formato_hora: '24h',
      horario_abertura: '08:00:00',
      horario_fechamento: '20:00:00',
      horario_almoco_ativo: false,
    });

    let corpoEnviado = null;
    await page.route('**/api/configuracao', (route) => {
      if (route.request().method() !== 'PATCH') return route.fallback();
      corpoEnviado = route.request().postDataJSON();
      return route.fulfill({
        json: {
          dias_funcionamento: [1, 2, 3, 4, 5, 6],
          formato_hora: '24h',
          horario_abertura: '08:00:00',
          horario_fechamento: '20:00:00',
          horario_almoco_ativo: true,
          horario_almoco_inicio: '12:00:00',
          horario_almoco_fim: '13:00:00',
        },
      });
    });

    await page.click('#config-almoco-ativo');
    await page.fill('#config-almoco-inicio', '12:00');
    await page.fill('#config-almoco-fim', '13:00');
    await page.click('#form-config button[type="submit"]');

    await expect(page.locator('#config-msg')).toHaveText('Salvo com sucesso!');
    expect(corpoEnviado).toMatchObject({ horarioAlmocoAtivo: true, horarioAlmocoInicio: '12:00', horarioAlmocoFim: '13:00' });
  });

  test('desativar o almoço envia horarioAlmocoAtivo: false e não envia horários', async ({ page }) => {
    await entrarNaConfiguracao(page, {
      dias_funcionamento: [1, 2, 3, 4, 5, 6],
      formato_hora: '24h',
      horario_abertura: '08:00:00',
      horario_fechamento: '20:00:00',
      horario_almoco_ativo: true,
      horario_almoco_inicio: '12:00:00',
      horario_almoco_fim: '13:00:00',
    });

    let corpoEnviado = null;
    await page.route('**/api/configuracao', (route) => {
      if (route.request().method() !== 'PATCH') return route.fallback();
      corpoEnviado = route.request().postDataJSON();
      return route.fulfill({
        json: {
          dias_funcionamento: [1, 2, 3, 4, 5, 6],
          formato_hora: '24h',
          horario_abertura: '08:00:00',
          horario_fechamento: '20:00:00',
          horario_almoco_ativo: false,
          horario_almoco_inicio: null,
          horario_almoco_fim: null,
        },
      });
    });

    await page.click('#config-almoco-ativo');
    await page.click('#form-config button[type="submit"]');

    await expect(page.locator('#config-msg')).toHaveText('Salvo com sucesso!');
    expect(corpoEnviado).toMatchObject({ horarioAlmocoAtivo: false, horarioAlmocoInicio: null, horarioAlmocoFim: null });
  });
});
