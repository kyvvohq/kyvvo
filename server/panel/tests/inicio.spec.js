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

  // US63 — atalhos, pendências e estado vazio orientado à ação.
  test('mostra atalhos para Serviços e Clientes; Financeiro só aparece com o módulo ativo', async ({ page }) => {
    await entrarNoPainel(page, { dia: [] });
    await expect(page.locator('[data-acao-atalho-inicio="servicos"]')).toBeVisible();
    await expect(page.locator('[data-acao-atalho-inicio="clientes"]')).toBeVisible();
    await expect(page.locator('[data-acao-atalho-inicio="modulo:financeiro"]')).toHaveCount(0);
  });

  test('atalho de Financeiro aparece quando o módulo está ativo e navega até ele', async ({ page }) => {
    await page.clock.install({ time: new Date('2026-07-17T10:00:00-03:00') });
    await page.route('**/api/configuracao', (route) =>
      route.fulfill({ json: { dias_funcionamento: [1, 2, 3, 4, 5, 6], formato_hora: '24h' } })
    );
    await page.route('**/api/agendamentos**', (route) => {
      const url = new URL(route.request().url());
      return route.fulfill({ json: { view: 'dia', data: url.searchParams.get('data'), agendamentos: [] } });
    });
    await page.route('**/api/tenant/modulos', (route) =>
      route.fulfill({ json: { modulos: [{ key: 'financeiro', nome: 'Financeiro', preco_mensal: 0 }] } })
    );
    await page.route('**/api/financeiro/lancamentos**', (route) =>
      route.fulfill({ json: { lancamentos: [], resumo: { entradas: 0, saidas: 0, saldo: 0 } } })
    );
    await page.addInitScript(() => {
      window.localStorage.setItem('kyvvo_token', 'fake-jwt-token');
      window.localStorage.setItem('kyvvo_nome', 'Ana');
    });
    await page.goto('/painel.html');
    await page.click('.menu-item[data-menu="inicio"]');

    await page.click('[data-acao-atalho-inicio="modulo:financeiro"]');
    await expect(page.locator('#btn-novo-lancamento')).toBeVisible();
  });

  test('atalho de Serviços navega até a tela de Serviços', async ({ page }) => {
    await entrarNoPainel(page, { dia: [] });
    await page.route('**/api/servicos', (route) => route.fulfill({ json: { servicos: [] } }));
    await page.route('**/api/profissionais', (route) => route.fulfill({ json: { profissionais: [] } }));
    await page.click('[data-acao-atalho-inicio="servicos"]');
    await expect(page.locator('.nav-periodo strong')).toHaveText('Serviços');
  });

  test('trial ativo mostra pendência com contagem de dias e botão de ação', async ({ page }) => {
    await entrarNoPainel(page, { dia: [] });
    await page.route('**/api/tenant/status', (route) =>
      route.fulfill({ json: { status: 'trial', dias_restantes: 3, pagamento_pendente: false, configuracao: { sem_servicos: false, sem_profissionais: false, whatsapp_desconectado: false } } })
    );
    await page.reload();
    await page.click('.menu-item[data-menu="inicio"]');

    const pendencia = page.locator('.inicio-pendencias li');
    await expect(pendencia).toContainText('Seu trial acaba em 3 dias.');
    await expect(pendencia.locator('button')).toHaveText('Escolher plano');
  });

  test('cobrança pendente e configuração incompleta aparecem como pendências, empilhadas', async ({ page }) => {
    await entrarNoPainel(page, { dia: [] });
    await page.route('**/api/tenant/status', (route) =>
      route.fulfill({
        json: {
          status: 'ativo',
          dias_restantes: null,
          pagamento_pendente: true,
          configuracao: { sem_servicos: true, sem_profissionais: false, whatsapp_desconectado: false },
        },
      })
    );
    await page.reload();
    await page.click('.menu-item[data-menu="inicio"]');

    await expect(page.locator('.inicio-pendencias li')).toHaveCount(2);
    await expect(page.locator('.inicio-pendencias')).toContainText('Pagamento pendente');
    await expect(page.locator('.inicio-pendencias')).toContainText('Nenhum serviço cadastrado ainda.');
  });

  test('sem agendamentos e sem serviços cadastrados, o estado vazio orienta a cadastrar serviços', async ({ page }) => {
    await entrarNoPainel(page, { dia: [] });
    await page.route('**/api/tenant/status', (route) =>
      route.fulfill({
        json: { status: 'ativo', dias_restantes: null, pagamento_pendente: false, configuracao: { sem_servicos: true, sem_profissionais: false, whatsapp_desconectado: false } },
      })
    );
    await page.reload();
    await page.click('.menu-item[data-menu="inicio"]');

    await expect(page.locator('.vazio')).toHaveText('Cadastre seus serviços para começar a receber agendamentos.');
  });

  test('sem status disponível (chamada não mockada/falhou), dashboard funciona normalmente sem pendências', async ({ page }) => {
    await entrarNoPainel(page, { dia: [] });
    await expect(page.locator('.inicio-pendencias')).toHaveCount(0);
    await expect(page.locator('.vazio')).toHaveText('Nenhum agendamento para o restante de hoje.');
  });
});

test.describe('Clientes (US63)', () => {
  async function entrarEmClientes(page, clientes = []) {
    await page.route('**/api/configuracao', (route) =>
      route.fulfill({ json: { dias_funcionamento: [1, 2, 3, 4, 5, 6], formato_hora: '24h' } })
    );
    await page.route('**/api/agendamentos**', (route) =>
      route.fulfill({ json: { view: 'dia', data: '2026-07-17', agendamentos: [] } })
    );
    await page.route('**/api/clientes', (route) => route.fulfill({ json: { clientes } }));
    await page.addInitScript(() => {
      window.localStorage.setItem('kyvvo_token', 'fake-jwt-token');
      window.localStorage.setItem('kyvvo_nome', 'Ana');
    });
    await page.goto('/painel.html');
    await page.click('#menu-cadastros-toggle');
    await page.click('.menu-item[data-menu="clientes"]');
  }

  test('lista os clientes com nome, telefone e total de agendamentos confirmados', async ({ page }) => {
    await entrarEmClientes(page, [{ id: 'c1', nome: 'Maria', telefone: '34999998888', total_agendamentos: 3 }]);
    const item = page.locator('.agendamento-item');
    await expect(item).toContainText('Cliente: Maria');
    await expect(item).toContainText('Telefone: 34999998888');
    await expect(item).toContainText('3 agendamentos confirmados');
  });

  test('cliente sem nome mostra "Sem nome"', async ({ page }) => {
    await entrarEmClientes(page, [{ id: 'c1', nome: null, telefone: '34999998888', total_agendamentos: 0 }]);
    await expect(page.locator('.agendamento-item')).toContainText('Cliente: Sem nome');
  });

  test('sem clientes cadastrados, mostra mensagem vazia orientando o próximo passo', async ({ page }) => {
    await entrarEmClientes(page, []);
    await expect(page.locator('.vazio')).toContainText('Os clientes aparecem aqui assim que o primeiro agendamento é feito');
  });
});
