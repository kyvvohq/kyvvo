const { test, expect } = require('@playwright/test');

// Cobre US52 — bloqueio de acesso pós-trial sem assinatura ativa: redirect
// do painel pra /bloqueio.html quando o trial venceu, guarda de saída da
// própria tela de bloqueio (não deixa quem não está bloqueado ficar lá) e o
// fluxo de cadastro de pagamento que libera o acesso de volta. Como o resto
// da suíte, as chamadas de API são mockadas via page.route — sem Postgres
// real nem conta Asaas.

function semearSessao(page) {
  return page.addInitScript(() => {
    window.localStorage.setItem('kyvvo_token', 'fake-jwt-token');
    window.localStorage.setItem('kyvvo_nome', 'Ana');
  });
}

// Mocks mínimos pro painel.html carregar sem os 403 reais do backend
// atrapalharem o teste (aqui quem decide bloquear ou não é só o mock de
// /api/tenant/status).
async function mockarRotasDoPainel(page) {
  await page.route('**/api/configuracao', (route) =>
    route.fulfill({ json: { dias_funcionamento: [1, 2, 3, 4, 5, 6], formato_hora: '24h', segmento: 'salao_beleza' } })
  );
  await page.route('**/api/agendamentos**', (route) =>
    route.fulfill({ json: { view: 'dia', data: '2026-07-09', agendamentos: [] } })
  );
  await page.route('**/api/tenant/modulos', (route) => route.fulfill({ json: { modulos: [] } }));
  await page.route('**/api/perfil', (route) => route.fulfill({ json: { nome_responsavel: 'Ana', nome_segmento: 'Salão da Ana' } }));
  await page.route('**/api/eventos', (route) => route.fulfill({ json: { ok: true } }));
}

const pagamentosBase = {
  plano: 'trial',
  plano_nome: 'Profissional',
  valor_plano: 247,
  meio_pagamento: null,
  cartao_final: null,
  cpf_cnpj: null,
  proxima_cobranca: null,
  historico: [],
  suporte_email: 'suporte@kyvvo.com.br',
  suporte_whatsapp: '553484285182',
};

test.describe('Painel — redirect pós-trial (US52)', () => {
  test('trial ativo: painel carrega normalmente, sem redirecionar', async ({ page }) => {
    await semearSessao(page);
    await mockarRotasDoPainel(page);
    await page.route('**/api/tenant/status', (route) =>
      route.fulfill({ json: { email_verified: true, status: 'trial', trial_ativo: true, dias_restantes: 5 } })
    );

    await page.goto('/painel.html');
    await expect(page).toHaveURL(/\/painel\.html$/);
    await expect(page.locator('#trial-banner')).toContainText('5 dias restantes');
  });

  test('trial vencido sem pagamento: painel redireciona para /bloqueio.html', async ({ page }) => {
    await semearSessao(page);
    await mockarRotasDoPainel(page);
    await page.route('**/api/tenant/status', (route) =>
      route.fulfill({ json: { email_verified: true, status: 'trial', trial_ativo: false, dias_restantes: -3 } })
    );
    await page.route('**/api/pagamentos', (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      return route.fulfill({ json: { ...pagamentosBase, status: 'trial', trial_ativo: false } });
    });

    await page.goto('/painel.html');
    await expect(page).toHaveURL(/\/bloqueio\.html$/);
  });

  test('trial vencido mas já com assinatura ativa: painel não redireciona (CA — status não é mais "trial")', async ({ page }) => {
    await semearSessao(page);
    await mockarRotasDoPainel(page);
    await page.route('**/api/tenant/status', (route) =>
      route.fulfill({ json: { email_verified: true, status: 'ativo', trial_ativo: false, dias_restantes: -3 } })
    );
    await page.route('**/api/pagamentos', (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      return route.fulfill({ json: { ...pagamentosBase, status: 'ativo', trial_ativo: false, meio_pagamento: 'pix' } });
    });

    await page.goto('/painel.html');
    await expect(page).toHaveURL(/\/painel\.html$/);
  });
});

test.describe('Tela de bloqueio (/bloqueio.html) — US52', () => {
  test('sem sessão redireciona para /login.html', async ({ page }) => {
    await page.goto('/bloqueio.html');
    await expect(page).toHaveURL(/\/login\.html$/);
  });

  test('trial ativo (não deveria estar aqui): redireciona de volta pro painel', async ({ page }) => {
    await semearSessao(page);
    await page.route('**/api/pagamentos', (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      return route.fulfill({ json: { ...pagamentosBase, status: 'trial', trial_ativo: true } });
    });

    await page.goto('/bloqueio.html');
    await expect(page).toHaveURL(/\/painel\.html$/);
  });

  test('assinatura já ativa (não deveria estar aqui): redireciona de volta pro painel', async ({ page }) => {
    await semearSessao(page);
    await page.route('**/api/pagamentos', (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      return route.fulfill({ json: { ...pagamentosBase, status: 'ativo', trial_ativo: false, meio_pagamento: 'pix' } });
    });

    await page.goto('/bloqueio.html');
    await expect(page).toHaveURL(/\/painel\.html$/);
  });

  test('trial vencido sem pagamento: mostra plano, explicação, suporte e o formulário de pagamento', async ({ page }) => {
    await semearSessao(page);
    await page.route('**/api/pagamentos', (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      return route.fulfill({ json: { ...pagamentosBase, status: 'trial', trial_ativo: false } });
    });
    let eventoRegistrado = null;
    await page.route('**/api/eventos', (route) => {
      eventoRegistrado = route.request().postDataJSON();
      return route.fulfill({ json: { ok: true } });
    });

    await page.goto('/bloqueio.html');
    await expect(page).toHaveURL(/\/bloqueio\.html$/);
    await expect(page.locator('#bloqueio-plano')).toContainText('Profissional');
    await expect(page.locator('#bloqueio-plano')).toContainText('R$ 247,00');
    await expect(page.locator('#bloqueio-suporte')).toContainText('suporte@kyvvo.com.br');
    await expect(page.locator('#bloqueio-suporte')).toContainText('553484285182');
    await expect(page.locator('#form-pagamento')).toBeVisible();
    await expect(page.locator('#pagamento-cpf-cnpj')).toBeVisible();
    expect(eventoRegistrado).toMatchObject({ tipo: 'bloqueio_exibido' });
  });

  test('cadastra pagamento com sucesso e volta para o painel', async ({ page }) => {
    await semearSessao(page);
    await page.route('**/api/pagamentos', (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      return route.fulfill({ json: { ...pagamentosBase, status: 'trial', trial_ativo: false } });
    });
    await page.route('**/api/eventos', (route) => route.fulfill({ json: { ok: true } }));
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
          proxima_cobranca: { data: '2026-08-01', valor: 247 },
          historico: [],
        },
      });
    });
    // Depois do cadastro a tela redireciona pro painel — mocka o essencial
    // pra essa navegação não falhar em cima de um 403/404 qualquer.
    await mockarRotasDoPainel(page);
    await page.route('**/api/tenant/status', (route) =>
      route.fulfill({ json: { email_verified: true, status: 'ativo', trial_ativo: false, dias_restantes: null } })
    );

    await page.goto('/bloqueio.html');
    await page.fill('#pagamento-cpf-cnpj', '123.456.789-00');
    await page.click('#btn-salvar-pagamento');

    await expect(page.locator('.toast-sucesso')).toHaveText(/assinatura está ativa/);
    expect(corpoEnviado).toMatchObject({ meio: 'pix', cpf_cnpj: '12345678900' });
    await expect(page).toHaveURL(/\/painel\.html$/, { timeout: 5000 });
  });
});
