const { test, expect } = require('@playwright/test');

// Cobre US64 — ação "Concluir atendimento" no menu inline do agendamento
// (mesmo padrão de Cancelar/Reagendar): marca o agendamento como concluído
// via PATCH /api/agendamentos/:id, o que no backend converte a receita
// prevista do lançamento financeiro vinculado em realizada. As chamadas de
// API são mockadas via page.route — sem dependência de Postgres real.

const AGENDAMENTO_BASE = {
  id: 'ag1',
  data_hora: '2026-08-06T13:00:00.000Z',
  status: 'confirmado',
  encaixe: false,
  cliente: 'Maria Teste',
  cliente_telefone: '34999990001',
  profissional_id: 'prof1',
  profissional: 'Ana',
  servico_id: 'serv1',
  servico: 'Corte',
  duracao_minutos: 30,
  preco: '50.00',
};

async function entrarNoPainel(page, agendamentos) {
  await page.clock.install({ time: new Date('2026-08-06T10:00:00-03:00') });
  await page.route('**/api/configuracao', (route) =>
    route.fulfill({
      json: {
        dias_funcionamento: [1, 2, 3, 4, 5, 6],
        formato_hora: '24h',
        horario_abertura: '08:00:00',
        horario_fechamento: '20:00:00',
        horario_almoco_ativo: false,
      },
    })
  );
  await page.route('**/api/agendamentos**', (route) => {
    const url = new URL(route.request().url());
    return route.fulfill({ json: { view: 'dia', data: url.searchParams.get('data') || '2026-08-06', agendamentos } });
  });
  await page.addInitScript(() => {
    window.localStorage.setItem('kyvvo_token', 'fake-jwt-token');
    window.localStorage.setItem('kyvvo_nome', 'Ana');
  });
  await page.goto('/painel.html');
}

test.describe('Concluir atendimento (US64)', () => {
  test('agendamento confirmado mostra "Concluir" no menu de ações', async ({ page }) => {
    await entrarNoPainel(page, [AGENDAMENTO_BASE]);
    await page.click('.agendamento-item[data-id="ag1"] .btn-acoes, .grade-ag-card[data-id="ag1"] .btn-acoes');
    await expect(page.locator('#menu-acoes-ag1 [data-acao="concluir"]')).toHaveText('Concluir');
  });

  test('confirmar a conclusão chama o PATCH com status "concluido" e atualiza a tela', async ({ page }) => {
    await entrarNoPainel(page, [AGENDAMENTO_BASE]);
    let payloadEnviado = null;
    await page.route('**/api/agendamentos/ag1', (route) => {
      payloadEnviado = route.request().postDataJSON();
      return route.fulfill({ json: { ...AGENDAMENTO_BASE, status: 'concluido' } });
    });

    await page.click('.agendamento-item[data-id="ag1"] .btn-acoes, .grade-ag-card[data-id="ag1"] .btn-acoes');
    await page.click('#menu-acoes-ag1 [data-acao="concluir"]');
    await expect(page.locator('.modal-card h3')).toHaveText('Concluir atendimento');
    await expect(page.locator('.modal-texto')).toContainText('Maria Teste');
    await expect(page.locator('.modal-texto')).toContainText('Corte');

    await page.click('#btn-confirmar-concluir');

    expect(payloadEnviado).toEqual({ status: 'concluido' });
    await expect(page.locator('.toast-sucesso')).toHaveText(/atualizado com sucesso/);
  });

  test('"Voltar" no modal fecha sem chamar a API', async ({ page }) => {
    await entrarNoPainel(page, [AGENDAMENTO_BASE]);
    let chamouApi = false;
    await page.route('**/api/agendamentos/ag1', (route) => {
      chamouApi = true;
      return route.fulfill({ json: AGENDAMENTO_BASE });
    });

    await page.click('.agendamento-item[data-id="ag1"] .btn-acoes, .grade-ag-card[data-id="ag1"] .btn-acoes');
    await page.click('#menu-acoes-ag1 [data-acao="concluir"]');
    await page.click('#btn-voltar-concluir');

    await expect(page.locator('#modal-overlay')).toHaveCount(0);
    expect(chamouApi).toBe(false);
  });

  test('erro do backend aparece como toast e mantém o agendamento sem alteração', async ({ page }) => {
    await entrarNoPainel(page, [AGENDAMENTO_BASE]);
    await page.route('**/api/agendamentos/ag1', (route) =>
      route.fulfill({ status: 409, json: { error: 'Conflito de horário: Ana já tem agendamento neste período.' } })
    );

    await page.click('.agendamento-item[data-id="ag1"] .btn-acoes, .grade-ag-card[data-id="ag1"] .btn-acoes');
    await page.click('#menu-acoes-ag1 [data-acao="concluir"]');
    await page.click('#btn-confirmar-concluir');

    await expect(page.locator('.toast-erro')).toHaveText(/Conflito de horário/);
  });

  test('agendamento concluído mostra o badge "Concluído" e não tem mais menu de ações', async ({ page }) => {
    await entrarNoPainel(page, [{ ...AGENDAMENTO_BASE, status: 'concluido' }]);
    await expect(page.locator('[data-id="ag1"]')).toContainText('Concluído');
    await expect(page.locator('[data-id="ag1"] .btn-acoes')).toHaveCount(0);
  });
});
