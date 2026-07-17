const { test, expect } = require('@playwright/test');

// Cobre US32: aba de Pagamentos no portal (Pix recorrente ou cartão de
// crédito) e a integração com a Asaas orquestrada pelo backend. A Asaas não
// tem tokenização client-side (diferente de outros gateways) — o número do
// cartão/validade/CVV vão direto pro nosso próprio backend, que tokeniza
// server-side. Como nos outros specs, as chamadas de API são mockadas via
// page.route — sem dependência de Postgres real nem de uma conta Asaas.

// `trialStatus` mocka GET /api/pagamentos/status (US36) — só chamado pelo
// front quando `pagamentos.status === 'trial'`; um valor padrão razoável
// cobre os testes que nem repararem nesse endpoint (ex: cadastro de US32).
async function entrarNoPainel(page, pagamentos, trialStatus) {
  await page.route('**/api/configuracao', (route) =>
    route.fulfill({ json: { dias_funcionamento: [1, 2, 3, 4, 5, 6], formato_hora: '24h', segmento: 'salao_beleza' } })
  );
  await page.route('**/api/agendamentos**', (route) =>
    route.fulfill({ json: { view: 'dia', data: '2026-07-09', agendamentos: [] } })
  );
  await page.route('**/api/tenant/modulos', (route) => route.fulfill({ json: { modulos: [] } }));
  await page.route('**/api/pagamentos', (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    return route.fulfill({ json: pagamentos });
  });
  await page.route('**/api/pagamentos/status', (route) =>
    route.fulfill({
      json: trialStatus || {
        trial_ativo: true,
        trial_inicio: '2026-07-01',
        trial_fim: '2026-07-15',
        trial_dias_restantes: 7,
        trial_dias_utilizados: 7,
        trial_percentual: 50,
        status_pagamento: 'trial',
        plano: 'trial',
      },
    })
  );
  await page.addInitScript(() => {
    window.localStorage.setItem('kyvvo_token', 'fake-jwt-token');
    window.localStorage.setItem('kyvvo_nome', 'Ana');
  });
  await page.goto('/painel.html');
  await page.click('.menu-item[data-menu="pagamentos"]');
}

test.describe('Pagamentos (US32)', () => {
  test('trial ativo sem meio cadastrado — mostra plano e botão de cadastro', async ({ page }) => {
    await entrarNoPainel(page, {
      status: 'trial',
      plano: 'trial',
      plano_nome: null,
      valor_plano: null,
      meio_pagamento: null,
      cartao_final: null,
      proxima_cobranca: null,
      historico: [],
    });
    await expect(page.locator('#btn-cadastrar-pagamento')).toHaveText('Cadastrar pagamento');
    await expect(page.locator('.trial-status-bloco')).toContainText('TRIAL ATIVO');
  });

  test('assinatura ativa — mostra plano, meio, status e histórico', async ({ page }) => {
    await entrarNoPainel(page, {
      status: 'ativo',
      plano: 'profissional',
      plano_nome: 'Profissional',
      valor_plano: 247,
      meio_pagamento: 'pix',
      cartao_final: null,
      proxima_cobranca: { data: '2026-08-01', valor: 247 },
      historico: [{ data: '2026-07-01', valor: 247, status: 'CONFIRMED' }],
    });
    await expect(page.locator('.financeiro-resumo-card')).toContainText(['Profissional', 'Pix recorrente', 'Ativo']);
    await expect(page.locator('.modal-texto')).toContainText('01/08/2026');
    await expect(page.locator('.tabela-tenants tbody tr').first()).toContainText('01/07/2026');
    await expect(page.locator('#btn-cadastrar-pagamento')).toHaveText('Alterar forma de pagamento');
  });

  test('CPF/CNPJ é obrigatório na primeira vez (CA04)', async ({ page }) => {
    await entrarNoPainel(page, {
      status: 'trial',
      plano: 'trial',
      plano_nome: null,
      valor_plano: null,
      meio_pagamento: null,
      cartao_final: null,
      cpf_cnpj: null,
      proxima_cobranca: null,
      historico: [],
    });

    await page.click('#btn-cadastrar-pagamento');
    await page.fill('#pagamento-cpf-cnpj', '123');
    await page.click('#btn-salvar-pagamento');

    await expect(page.locator('#pagamento-erro')).toHaveText(/CPF.*CNPJ/);
  });

  test('cadastra Pix recorrente com sucesso', async ({ page }) => {
    await entrarNoPainel(page, {
      status: 'trial',
      plano: 'trial',
      plano_nome: null,
      valor_plano: null,
      meio_pagamento: null,
      cartao_final: null,
      cpf_cnpj: null,
      proxima_cobranca: null,
      historico: [],
    });

    let corpoEnviado = null;
    await page.route('**/api/pagamentos/cadastrar', (route) => {
      corpoEnviado = route.request().postDataJSON();
      return route.fulfill({
        json: {
          status: 'ativo',
          plano: 'profissional',
          plano_nome: 'Profissional',
          valor_plano: 247,
          meio_pagamento: 'pix',
          cartao_final: null,
          cpf_cnpj: '12345678900',
          proxima_cobranca: { data: '2026-08-01', valor: 247 },
          historico: [],
        },
      });
    });

    await page.click('#btn-cadastrar-pagamento');
    await page.fill('#pagamento-cpf-cnpj', '123.456.789-00');
    await page.click('#btn-salvar-pagamento');

    await expect(page.locator('.toast-sucesso')).toHaveText(/assinatura está ativa/);
    expect(corpoEnviado).toMatchObject({ meio: 'pix', cpf_cnpj: '12345678900' });
  });

  test('dropdown "Forma de pagamento" mostra os campos de cartão e endereço ao selecionar', async ({ page }) => {
    await entrarNoPainel(page, {
      status: 'trial',
      plano: 'trial',
      plano_nome: null,
      valor_plano: null,
      meio_pagamento: null,
      cartao_final: null,
      cpf_cnpj: '12345678900',
      endereco_cep: null,
      proxima_cobranca: null,
      historico: [],
    });

    await page.click('#btn-cadastrar-pagamento');
    await expect(page.locator('#campos-cartao')).toBeHidden();
    await page.selectOption('#pagamento-meio', 'cartao');
    await expect(page.locator('#campos-cartao')).toBeVisible();
    await expect(page.locator('#cartao-numero')).toBeVisible();
    await expect(page.locator('#pagamento-cep')).toBeVisible();
  });

  test('endereço não cadastrado: campos aparecem editáveis e obrigatórios pra cartão', async ({ page }) => {
    await entrarNoPainel(page, {
      status: 'trial',
      plano: 'trial',
      plano_nome: null,
      valor_plano: null,
      meio_pagamento: null,
      cartao_final: null,
      cpf_cnpj: '12345678900',
      endereco_cep: null,
      endereco_numero: null,
      proxima_cobranca: null,
      historico: [],
    });

    await page.click('#btn-cadastrar-pagamento');
    await page.selectOption('#pagamento-meio', 'cartao');
    await expect(page.locator('#pagamento-atualizar-endereco')).toHaveCount(0);
    await expect(page.locator('#pagamento-cep')).toBeEnabled();

    await page.fill('#cartao-numero', '4242 4242 4242 4242');
    await page.fill('#cartao-nome', 'ANA SOUZA');
    await page.fill('#cartao-validade', '12/2030');
    await page.fill('#cartao-cvv', '123');
    await page.click('#btn-salvar-pagamento');

    await expect(page.locator('#pagamento-erro')).toHaveText(/endereço/);
  });

  test('endereço já cadastrado: aparece bloqueado com checkbox pra atualizar', async ({ page }) => {
    await entrarNoPainel(page, {
      status: 'trial',
      plano: 'trial',
      plano_nome: null,
      valor_plano: null,
      meio_pagamento: null,
      cartao_final: null,
      cpf_cnpj: '12345678900',
      endereco_cep: '38400100',
      endereco_logradouro: 'Avenida Floriano Peixoto',
      endereco_numero: '123',
      endereco_complemento: null,
      endereco_bairro: 'Centro',
      endereco_cidade: 'Uberlândia',
      endereco_uf: 'MG',
      proxima_cobranca: null,
      historico: [],
    });

    await page.click('#btn-cadastrar-pagamento');
    await page.selectOption('#pagamento-meio', 'cartao');

    await expect(page.locator('#pagamento-cep')).toHaveValue('38400100');
    await expect(page.locator('#pagamento-cep')).toBeDisabled();
    await expect(page.locator('#pagamento-atualizar-endereco')).toBeVisible();

    await page.check('#pagamento-atualizar-endereco');
    await expect(page.locator('#pagamento-cep')).toBeEnabled();
  });

  test('cadastra cartão de crédito enviando os dados direto ao backend (sem script client-side)', async ({ page }) => {
    await entrarNoPainel(page, {
      status: 'trial',
      plano: 'trial',
      plano_nome: null,
      valor_plano: null,
      meio_pagamento: null,
      cartao_final: null,
      cpf_cnpj: null,
      endereco_cep: null,
      endereco_numero: null,
      proxima_cobranca: null,
      historico: [],
    });

    let corpoEnviado = null;
    await page.route('**/api/pagamentos/cadastrar', (route) => {
      corpoEnviado = route.request().postDataJSON();
      return route.fulfill({
        json: {
          status: 'ativo',
          plano: 'profissional',
          plano_nome: 'Profissional',
          valor_plano: 247,
          meio_pagamento: 'cartao',
          cartao_final: '4242',
          cpf_cnpj: '12345678900',
          proxima_cobranca: { data: '2026-08-01', valor: 247 },
          historico: [],
        },
      });
    });

    await page.click('#btn-cadastrar-pagamento');
    await page.fill('#pagamento-cpf-cnpj', '123.456.789-00');
    await page.selectOption('#pagamento-meio', 'cartao');
    await page.fill('#cartao-numero', '4242 4242 4242 4242');
    await page.fill('#cartao-nome', 'ANA SOUZA');
    await page.fill('#cartao-validade', '12/2030');
    await page.fill('#cartao-cvv', '123');
    await page.fill('#pagamento-cep', '38400100');
    await page.fill('#pagamento-numero', '123');
    await page.fill('#pagamento-logradouro', 'Avenida Floriano Peixoto');
    await page.fill('#pagamento-bairro', 'Centro');
    await page.fill('#pagamento-cidade', 'Uberlândia');
    await page.selectOption('#pagamento-uf', 'MG');
    await page.click('#btn-salvar-pagamento');

    await expect(page.locator('.toast-sucesso')).toHaveText(/assinatura está ativa/);
    expect(corpoEnviado).toMatchObject({
      meio: 'cartao',
      cartao_numero: '4242424242424242',
      cartao_nome: 'ANA SOUZA',
      cartao_validade_mes: '12',
      cartao_validade_ano: '2030',
      cartao_cvv: '123',
      endereco: {
        cep: '38400100',
        numero: '123',
        logradouro: 'Avenida Floriano Peixoto',
        bairro: 'Centro',
        cidade: 'Uberlândia',
        uf: 'MG',
      },
    });
  });

  test('endereço já cadastrado sem marcar "atualizar" não é reenviado no payload', async ({ page }) => {
    await entrarNoPainel(page, {
      status: 'trial',
      plano: 'trial',
      plano_nome: null,
      valor_plano: null,
      meio_pagamento: null,
      cartao_final: null,
      cpf_cnpj: '12345678900',
      endereco_cep: '38400100',
      endereco_logradouro: 'Avenida Floriano Peixoto',
      endereco_numero: '123',
      endereco_complemento: null,
      endereco_bairro: 'Centro',
      endereco_cidade: 'Uberlândia',
      endereco_uf: 'MG',
      proxima_cobranca: null,
      historico: [],
    });

    let corpoEnviado = null;
    await page.route('**/api/pagamentos/cadastrar', (route) => {
      corpoEnviado = route.request().postDataJSON();
      return route.fulfill({
        json: {
          status: 'ativo',
          plano: 'profissional',
          plano_nome: 'Profissional',
          valor_plano: 247,
          meio_pagamento: 'cartao',
          cartao_final: '4242',
          cpf_cnpj: '12345678900',
          proxima_cobranca: { data: '2026-08-01', valor: 247 },
          historico: [],
        },
      });
    });

    await page.click('#btn-cadastrar-pagamento');
    await page.selectOption('#pagamento-meio', 'cartao');
    await page.fill('#cartao-numero', '4242 4242 4242 4242');
    await page.fill('#cartao-nome', 'ANA SOUZA');
    await page.fill('#cartao-validade', '12/2030');
    await page.fill('#cartao-cvv', '123');
    await page.click('#btn-salvar-pagamento');

    await expect(page.locator('.toast-sucesso')).toHaveText(/assinatura está ativa/);
    expect(corpoEnviado.endereco).toBeUndefined();
  });

  test('CPF/CNPJ não é pedido de novo ao trocar de meio de pagamento (CA09)', async ({ page }) => {
    await entrarNoPainel(page, {
      status: 'ativo',
      plano: 'profissional',
      plano_nome: 'Profissional',
      valor_plano: 247,
      meio_pagamento: 'pix',
      cartao_final: null,
      cpf_cnpj: '12345678900',
      proxima_cobranca: { data: '2026-08-01', valor: 247 },
      historico: [],
    });

    await page.click('#btn-cadastrar-pagamento');
    await expect(page.locator('#pagamento-cpf-cnpj')).toHaveCount(0);
  });

  test('erro do backend na integração com a Asaas aparece no modal', async ({ page }) => {
    await entrarNoPainel(page, {
      status: 'trial',
      plano: 'trial',
      plano_nome: null,
      valor_plano: null,
      meio_pagamento: null,
      cartao_final: null,
      cpf_cnpj: null,
      proxima_cobranca: null,
      historico: [],
    });
    await page.route('**/api/pagamentos/cadastrar', (route) =>
      route.fulfill({ status: 400, json: { error: 'Não foi possível processar o pagamento agora. Tente novamente em instantes.' } })
    );

    await page.click('#btn-cadastrar-pagamento');
    await page.fill('#pagamento-cpf-cnpj', '123.456.789-00');
    await page.click('#btn-salvar-pagamento');

    await expect(page.locator('#pagamento-erro')).toHaveText(/Não foi possível processar/);
  });
});

test.describe('Cancelamento de assinatura (US35)', () => {
  test('assinatura ativa mostra o botão de cancelar (CA01)', async ({ page }) => {
    await entrarNoPainel(page, {
      status: 'ativo',
      plano: 'profissional',
      plano_nome: 'Profissional',
      valor_plano: 247,
      meio_pagamento: 'pix',
      cartao_final: null,
      proxima_cobranca: { data: '2026-08-01', valor: 247 },
      historico: [],
    });

    await expect(page.locator('#btn-cancelar-assinatura')).toHaveText('Cancelar assinatura');
  });

  for (const status of ['trial', 'suspenso', 'inadimplente']) {
    test(`status "${status}" não mostra o botão de cancelar (CA01)`, async ({ page }) => {
      await entrarNoPainel(page, {
        status,
        plano: 'profissional',
        plano_nome: 'Profissional',
        valor_plano: 247,
        meio_pagamento: status === 'trial' ? null : 'pix',
        cartao_final: null,
        proxima_cobranca: status === 'trial' ? null : { data: '2026-08-01', valor: 247 },
        historico: [],
      });

      await expect(page.locator('#btn-cancelar-assinatura')).toHaveCount(0);
    });
  }

  test('modal de confirmação e cancelamento com sucesso (CA02/CA03/CA04)', async ({ page }) => {
    await entrarNoPainel(page, {
      status: 'ativo',
      plano: 'profissional',
      plano_nome: 'Profissional',
      valor_plano: 247,
      meio_pagamento: 'pix',
      cartao_final: null,
      proxima_cobranca: { data: '2026-08-01', valor: 247 },
      historico: [],
    });

    let metodoRecebido = null;
    await page.route('**/api/pagamentos/assinatura', (route) => {
      metodoRecebido = route.request().method();
      return route.fulfill({ json: { cancelado: true, acesso_ate: '2026-08-01' } });
    });

    await page.click('#btn-cancelar-assinatura');
    await expect(page.locator('.modal-card h3')).toHaveText('Tem certeza que deseja cancelar?');
    await expect(page.locator('.modal-card .modal-texto')).toContainText('01/08/2026');

    await page.click('#btn-confirmar-cancelamento');

    expect(metodoRecebido).toBe('DELETE');
    await expect(page.locator('.toast-sucesso')).toHaveText(/01\/08\/2026/);
  });

  test('"Manter assinatura" fecha o modal sem chamar a API', async ({ page }) => {
    await entrarNoPainel(page, {
      status: 'ativo',
      plano: 'profissional',
      plano_nome: 'Profissional',
      valor_plano: 247,
      meio_pagamento: 'pix',
      cartao_final: null,
      proxima_cobranca: { data: '2026-08-01', valor: 247 },
      historico: [],
    });

    let chamou = false;
    await page.route('**/api/pagamentos/assinatura', (route) => {
      chamou = true;
      return route.fulfill({ json: { cancelado: true, acesso_ate: '2026-08-01' } });
    });

    await page.click('#btn-cancelar-assinatura');
    await page.click('#btn-manter-assinatura');

    await expect(page.locator('#modal-overlay')).toHaveCount(0);
    expect(chamou).toBe(false);
  });

  test('erro ao cancelar aparece no modal', async ({ page }) => {
    await entrarNoPainel(page, {
      status: 'ativo',
      plano: 'profissional',
      plano_nome: 'Profissional',
      valor_plano: 247,
      meio_pagamento: 'pix',
      cartao_final: null,
      proxima_cobranca: { data: '2026-08-01', valor: 247 },
      historico: [],
    });

    await page.route('**/api/pagamentos/assinatura', (route) =>
      route.fulfill({ status: 400, json: { error: 'Não foi possível cancelar a assinatura agora. Tente novamente em instantes.' } })
    );

    await page.click('#btn-cancelar-assinatura');
    await page.click('#btn-confirmar-cancelamento');

    await expect(page.locator('#cancelar-assinatura-erro')).toHaveText(/Não foi possível cancelar/);
  });

  test('status cancelado mostra info de acesso e botão de reativar, sem botão de alterar/cancelar (CA04/CA06)', async ({ page }) => {
    await entrarNoPainel(page, {
      status: 'cancelado',
      plano: 'profissional',
      plano_nome: 'Profissional',
      valor_plano: 247,
      meio_pagamento: 'pix',
      cartao_final: null,
      cpf_cnpj: '12345678900',
      cancelado_em: '2026-07-10T12:00:00Z',
      acesso_ate: '2026-08-01',
      proxima_cobranca: null,
      historico: [],
    });

    await expect(page.locator('.badge')).toHaveText('Cancelado');
    await expect(page.locator('.modal-texto')).toContainText('01/08/2026');
    await expect(page.locator('#btn-reativar-pagamento')).toHaveText('Reativar assinatura');
    await expect(page.locator('#btn-cadastrar-pagamento')).toHaveCount(0);
    await expect(page.locator('#btn-cancelar-assinatura')).toHaveCount(0);
  });

  test('reativar assinatura abre o fluxo de cadastro de pagamento (CA06)', async ({ page }) => {
    await entrarNoPainel(page, {
      status: 'cancelado',
      plano: 'profissional',
      plano_nome: 'Profissional',
      valor_plano: 247,
      meio_pagamento: 'pix',
      cartao_final: null,
      cpf_cnpj: '12345678900',
      cancelado_em: '2026-07-10T12:00:00Z',
      acesso_ate: '2026-08-01',
      proxima_cobranca: null,
      historico: [],
    });

    await page.route('**/api/pagamentos/cadastrar', (route) =>
      route.fulfill({
        json: {
          status: 'ativo',
          plano: 'profissional',
          plano_nome: 'Profissional',
          valor_plano: 247,
          meio_pagamento: 'pix',
          cartao_final: null,
          cpf_cnpj: '12345678900',
          cancelado_em: null,
          acesso_ate: null,
          proxima_cobranca: { data: '2026-08-02', valor: 247 },
          historico: [],
        },
      })
    );

    await page.click('#btn-reativar-pagamento');
    await expect(page.locator('#form-pagamento')).toBeVisible();
    await expect(page.locator('#pagamento-cpf-cnpj')).toHaveCount(0);

    await page.click('#btn-salvar-pagamento');
    await expect(page.locator('.toast-sucesso')).toHaveText(/assinatura está ativa/);
  });
});

test.describe('Cadastro de pagamento durante o trial (US37)', () => {
  test('trial ativo: modal mostra o banner de cobrança futura antes do formulário (CA02)', async ({ page }) => {
    await entrarNoPainel(page, {
      status: 'trial',
      plano: 'trial',
      plano_nome: 'Profissional',
      valor_plano: 247,
      trial_ativo: true,
      trial_fim: '2026-07-20',
      meio_pagamento: null,
      cartao_final: null,
      cpf_cnpj: null,
      proxima_cobranca: null,
      historico: [],
    });

    await page.click('#btn-cadastrar-pagamento');

    await expect(page.locator('.trial-banner-cobranca-futura')).toContainText('Você não será cobrado agora');
    await expect(page.locator('.trial-banner-cobranca-futura')).toContainText('R$ 247,00');
    await expect(page.locator('.trial-banner-cobranca-futura')).toContainText('20/07/2026');
    await expect(page.locator('.trial-banner-cobranca-futura')).toContainText('cancelar a qualquer momento');
  });

  test('trial expirado (sem trial_ativo): modal não mostra o banner de cobrança futura', async ({ page }) => {
    await entrarNoPainel(page, {
      status: 'trial',
      plano: 'trial',
      plano_nome: 'Profissional',
      valor_plano: 247,
      trial_ativo: false,
      trial_fim: '2026-06-01',
      meio_pagamento: null,
      cartao_final: null,
      cpf_cnpj: null,
      proxima_cobranca: null,
      historico: [],
    });

    await page.click('#btn-cadastrar-pagamento');

    await expect(page.locator('.trial-banner-cobranca-futura')).toHaveCount(0);
  });

  test('cadastro durante trial ativo: toast e resposta indicam cobrança agendada, não assinatura ativa (CA05)', async ({ page }) => {
    await entrarNoPainel(page, {
      status: 'trial',
      plano: 'trial',
      plano_nome: 'Profissional',
      valor_plano: 247,
      trial_ativo: true,
      trial_fim: '2026-07-20',
      meio_pagamento: null,
      cartao_final: null,
      cpf_cnpj: null,
      proxima_cobranca: null,
      historico: [],
    });

    await page.route('**/api/pagamentos/cadastrar', (route) =>
      route.fulfill({
        json: {
          status: 'trial',
          plano: 'profissional',
          plano_nome: 'Profissional',
          valor_plano: 247,
          trial_ativo: true,
          trial_fim: '2026-07-20',
          meio_pagamento: 'pix',
          cartao_final: null,
          cpf_cnpj: '12345678900',
          proxima_cobranca: { data: '2026-07-20', valor: 247 },
          historico: [],
        },
      })
    );

    await page.click('#btn-cadastrar-pagamento');
    await page.fill('#pagamento-cpf-cnpj', '123.456.789-00');
    await page.click('#btn-salvar-pagamento');

    await expect(page.locator('.toast-sucesso')).toHaveText(/cobrado em 20\/07\/2026.*aproveite o trial/);
  });

  test('trial com pagamento já agendado: aba de pagamentos mostra o badge dedicado e "Alterar forma de pagamento" (CA05)', async ({ page }) => {
    await entrarNoPainel(page, {
      status: 'trial',
      plano: 'profissional',
      plano_nome: 'Profissional',
      valor_plano: 247,
      trial_ativo: true,
      trial_fim: '2026-07-20',
      meio_pagamento: 'pix',
      cartao_final: null,
      cpf_cnpj: '12345678900',
      proxima_cobranca: { data: '2026-07-20', valor: 247 },
      historico: [],
    });

    await expect(page.locator('.badge')).toHaveText('Trial com pagamento agendado');
    await expect(page.locator('.modal-texto')).toContainText('20/07/2026');
    await expect(page.locator('#btn-cadastrar-pagamento')).toHaveText('Alterar forma de pagamento');
  });
});

test.describe('Status do trial na aba de pagamentos (US36)', () => {
  const pagamentosTrial = {
    status: 'trial',
    plano: 'trial',
    plano_nome: null,
    valor_plano: null,
    meio_pagamento: null,
    cartao_final: null,
    proxima_cobranca: null,
    historico: [],
  };

  test('trial ativo mostra badge, datas, barra de progresso e CTA (CA01/CA02/CA03/CA04)', async ({ page }) => {
    await entrarNoPainel(page, pagamentosTrial, {
      trial_ativo: true,
      trial_inicio: '2026-07-01',
      trial_fim: '2026-07-15',
      trial_dias_restantes: 7,
      trial_dias_utilizados: 7,
      trial_percentual: 50,
      status_pagamento: 'trial',
      plano: 'trial',
    });

    await expect(page.locator('.badge-trial-ativo')).toHaveText('TRIAL ATIVO');
    await expect(page.locator('.trial-status-bloco')).toContainText('01/07/2026');
    await expect(page.locator('.trial-status-bloco')).toContainText('15/07/2026');
    await expect(page.locator('.trial-progresso-dias')).toContainText('7 dias restantes');
    await expect(page.locator('.trial-progresso-dias')).toContainText('7 de 14 dias utilizados');
    await expect(page.locator('.trial-progresso-preenchido')).toHaveAttribute('style', /width:50%/);
    await expect(page.locator('.trial-status-bloco')).toContainText('não pague nada até 15/07/2026');
    await expect(page.locator('#btn-cadastrar-pagamento')).toHaveText('Cadastrar pagamento');
  });

  test('trial expirando em até 3 dias mostra badge amarelo e mensagem de urgência (CA05)', async ({ page }) => {
    await entrarNoPainel(page, pagamentosTrial, {
      trial_ativo: true,
      trial_inicio: '2026-07-01',
      trial_fim: '2026-07-17',
      trial_dias_restantes: 2,
      trial_dias_utilizados: 12,
      trial_percentual: 86,
      status_pagamento: 'trial',
      plano: 'trial',
    });

    await expect(page.locator('.badge-trial-expirando')).toHaveText('TRIAL EXPIRANDO');
    await expect(page.locator('.trial-status-bloco')).toContainText('Seu trial expira em 2 dias');
    await expect(page.locator('.trial-progresso-preenchido.trial-barra-vermelha')).toBeVisible();
    await expect(page.locator('#btn-cadastrar-pagamento')).toHaveText('Cadastrar pagamento');
  });

  test('trial expirado mostra badge vermelho, mensagem e botão "Escolher plano" (CA06)', async ({ page }) => {
    await entrarNoPainel(page, pagamentosTrial, {
      trial_ativo: false,
      trial_inicio: '2026-06-01',
      trial_fim: '2026-06-15',
      trial_dias_restantes: -10,
      trial_dias_utilizados: 14,
      trial_percentual: 100,
      status_pagamento: 'trial',
      plano: 'trial',
    });

    await expect(page.locator('.badge-trial-expirado')).toHaveText('TRIAL EXPIRADO');
    await expect(page.locator('.trial-status-bloco')).toContainText('Seu período gratuito encerrou');
    await expect(page.locator('#btn-cadastrar-pagamento')).toHaveText('Escolher plano');
  });
});
