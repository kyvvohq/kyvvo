const { test, expect } = require('@playwright/test');

// Cobre US61: bloqueios manuais de agenda pelo portal (listar, criar — pra
// toda a agenda ou só um profissional —, validar e excluir). As chamadas de
// API são mockadas via page.route — sem dependência de Postgres real.

async function entrarNoPainel(page, { bloqueios = [], profissionais = [] } = {}) {
  await page.route('**/api/configuracao', (route) =>
    route.fulfill({ json: { dias_funcionamento: [1, 2, 3, 4, 5, 6], formato_hora: '24h', segmento: 'salao_beleza' } })
  );
  await page.route('**/api/agendamentos**', (route) =>
    route.fulfill({ json: { view: 'dia', data: '2026-07-09', agendamentos: [] } })
  );
  await page.route('**/api/servicos', (route) => route.fulfill({ json: { servicos: [] } }));
  await page.route('**/api/bloqueios', (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    return route.fulfill({ json: { bloqueios } });
  });
  await page.route('**/api/profissionais', (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    return route.fulfill({ json: { profissionais } });
  });
  await page.addInitScript(() => {
    window.localStorage.setItem('kyvvo_token', 'fake-jwt-token');
    window.localStorage.setItem('kyvvo_nome', 'Ana');
  });
  await page.goto('/painel.html');
}

async function abrirTelaBloqueios(page) {
  await page.click('#menu-cadastros-toggle');
  await page.click('.menu-item[data-menu="bloqueios"]');
}

test.describe('Bloqueios de agenda — CRUD (US61)', () => {
  test('lista bloqueios com período, profissional e motivo', async ({ page }) => {
    await entrarNoPainel(page, {
      bloqueios: [
        { id: 'b1', profissional_id: 'p1', profissional: 'Bruna', inicio: '2026-07-20T13:00:00.000Z', fim: '2026-07-20T15:00:00.000Z', motivo: 'Consulta médica' },
      ],
    });
    await abrirTelaBloqueios(page);
    const item = page.locator('.servico-item');
    await expect(item).toContainText('Profissional: Bruna');
    await expect(item).toContainText('Consulta médica');
  });

  test('bloqueio sem profissional mostra "Toda a agenda"', async ({ page }) => {
    await entrarNoPainel(page, {
      bloqueios: [{ id: 'b1', profissional_id: null, profissional: null, inicio: '2026-07-20T13:00:00.000Z', fim: '2026-07-21T13:00:00.000Z', motivo: null }],
    });
    await abrirTelaBloqueios(page);
    await expect(page.locator('.servico-item')).toContainText('Toda a agenda');
  });

  test('sem bloqueios cadastrados, mostra mensagem vazia', async ({ page }) => {
    await entrarNoPainel(page, { bloqueios: [] });
    await abrirTelaBloqueios(page);
    await expect(page.locator('.vazio')).toContainText('Nenhum bloqueio cadastrado');
  });

  test('cria um bloqueio para toda a agenda (sem selecionar profissional)', async ({ page }) => {
    await entrarNoPainel(page, { bloqueios: [], profissionais: [{ id: 'p1', nome: 'Bruna' }] });
    let corpoEnviado = null;
    await page.route('**/api/bloqueios', (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      corpoEnviado = route.request().postDataJSON();
      return route.fulfill({ status: 201, json: { id: 'novo', ...corpoEnviado } });
    });

    await abrirTelaBloqueios(page);
    await page.click('#btn-novo-bloqueio');
    await page.fill('#bloqueio-data-inicio', '2026-08-10');
    await page.fill('#bloqueio-hora-inicio', '09:00');
    await page.fill('#bloqueio-data-fim', '2026-08-10');
    await page.fill('#bloqueio-hora-fim', '12:00');
    await page.fill('#bloqueio-motivo', 'Manutenção do salão');
    await page.click('#btn-salvar-bloqueio');

    await expect(page.locator('.toast-sucesso')).toHaveText(/criado com sucesso/);
    expect(corpoEnviado.profissional_id).toBeNull();
    expect(corpoEnviado.motivo).toBe('Manutenção do salão');
    expect(corpoEnviado.inicio).toBe('2026-08-10T12:00:00.000Z');
    expect(corpoEnviado.fim).toBe('2026-08-10T15:00:00.000Z');
  });

  test('cria um bloqueio para um profissional específico', async ({ page }) => {
    await entrarNoPainel(page, { bloqueios: [], profissionais: [{ id: 'p1', nome: 'Bruna' }] });
    let corpoEnviado = null;
    await page.route('**/api/bloqueios', (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      corpoEnviado = route.request().postDataJSON();
      return route.fulfill({ status: 201, json: { id: 'novo', ...corpoEnviado } });
    });

    await abrirTelaBloqueios(page);
    await page.click('#btn-novo-bloqueio');
    await page.fill('#bloqueio-data-inicio', '2026-08-10');
    await page.fill('#bloqueio-hora-inicio', '09:00');
    await page.fill('#bloqueio-data-fim', '2026-08-10');
    await page.fill('#bloqueio-hora-fim', '12:00');
    await page.selectOption('#bloqueio-profissional', 'p1');
    await page.click('#btn-salvar-bloqueio');

    await expect(page.locator('.toast-sucesso')).toHaveText(/criado com sucesso/);
    expect(corpoEnviado.profissional_id).toBe('p1');
  });

  test('fim antes ou igual ao início mostra erro sem chamar a API', async ({ page }) => {
    await entrarNoPainel(page, { bloqueios: [], profissionais: [] });
    let chamou = false;
    await page.route('**/api/bloqueios', (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      chamou = true;
      return route.fulfill({ status: 201, json: {} });
    });

    await abrirTelaBloqueios(page);
    await page.click('#btn-novo-bloqueio');
    await page.fill('#bloqueio-data-inicio', '2026-08-10');
    await page.fill('#bloqueio-hora-inicio', '12:00');
    await page.fill('#bloqueio-data-fim', '2026-08-10');
    await page.fill('#bloqueio-hora-fim', '09:00');
    await page.click('#btn-salvar-bloqueio');

    await expect(page.locator('#bloqueio-erro')).toHaveText('O fim do bloqueio deve ser depois do início.');
    expect(chamou).toBe(false);
  });

  test('conflito com agendamento existente (409) mostra o erro do backend', async ({ page }) => {
    await entrarNoPainel(page, { bloqueios: [], profissionais: [] });
    await page.route('**/api/bloqueios', (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      return route.fulfill({ status: 409, json: { error: 'Não é possível bloquear: há 1 agendamento(s) confirmado(s) nesse período.' } });
    });

    await abrirTelaBloqueios(page);
    await page.click('#btn-novo-bloqueio');
    await page.fill('#bloqueio-data-inicio', '2026-08-10');
    await page.fill('#bloqueio-hora-inicio', '09:00');
    await page.fill('#bloqueio-data-fim', '2026-08-10');
    await page.fill('#bloqueio-hora-fim', '12:00');
    await page.click('#btn-salvar-bloqueio');

    await expect(page.locator('#bloqueio-erro')).toHaveText(/Não é possível bloquear/);
  });

  test('exclui um bloqueio e some da listagem', async ({ page }) => {
    await entrarNoPainel(page, {
      bloqueios: [{ id: 'b1', profissional_id: null, profissional: null, inicio: '2026-07-20T13:00:00.000Z', fim: '2026-07-20T15:00:00.000Z', motivo: null }],
    });
    let metodoRecebido = null;
    await page.route('**/api/bloqueios/b1', (route) => {
      metodoRecebido = route.request().method();
      return route.fulfill({ json: { ok: true } });
    });

    await abrirTelaBloqueios(page);
    await page.click('[data-acao-bloqueio="excluir"]');
    await expect(page.locator('.modal-card')).toContainText('A agenda volta a ficar disponível');
    await page.click('#btn-confirmar-excluir-bloqueio');

    await expect(page.locator('.toast-sucesso')).toHaveText(/excluído com sucesso/);
    expect(metodoRecebido).toBe('DELETE');
  });

  test('cancelar a exclusão fecha o popup sem chamar a API', async ({ page }) => {
    await entrarNoPainel(page, {
      bloqueios: [{ id: 'b1', profissional_id: null, profissional: null, inicio: '2026-07-20T13:00:00.000Z', fim: '2026-07-20T15:00:00.000Z', motivo: null }],
    });
    let chamou = false;
    await page.route('**/api/bloqueios/b1', (route) => {
      chamou = true;
      return route.fulfill({ json: { ok: true } });
    });

    await abrirTelaBloqueios(page);
    await page.click('[data-acao-bloqueio="excluir"]');
    await page.click('#btn-voltar-excluir-bloqueio');

    await expect(page.locator('.modal-overlay')).toHaveCount(0);
    expect(chamou).toBe(false);
  });

  test('o cabeçalho "Cadastros" fica destacado quando Bloqueios está ativo', async ({ page }) => {
    await entrarNoPainel(page, { bloqueios: [] });
    await abrirTelaBloqueios(page);
    await expect(page.locator('#menu-cadastros-toggle')).toHaveClass(/tem-filho-ativo/);
  });
});
