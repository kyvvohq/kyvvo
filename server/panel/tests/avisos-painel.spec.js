const { test, expect } = require('@playwright/test');

// Cobre US59: avisos contextuais no painel sobre cobrança pendente e
// configuração incompleta (sem serviços/profissionais, WhatsApp
// desconectado). O aviso de trial (#trial-banner) já existia (US52) e não é
// coberto aqui — ver bloqueio.spec.js. As chamadas de API são mockadas via
// page.route — sem dependência de Postgres real.

const STATUS_BASE = {
  email_verified: true,
  status: 'ativo',
  trial_ativo: false,
  dias_restantes: null,
  pagamento_pendente: false,
  configuracao: { sem_servicos: false, sem_profissionais: false, whatsapp_desconectado: false },
};

async function entrarNoPainel(page, status = STATUS_BASE) {
  await page.route('**/api/configuracao', (route) =>
    route.fulfill({ json: { dias_funcionamento: [1, 2, 3, 4, 5, 6], formato_hora: '24h', segmento: 'salao_beleza' } })
  );
  await page.route('**/api/agendamentos**', (route) =>
    route.fulfill({ json: { view: 'dia', data: '2026-07-09', agendamentos: [] } })
  );
  await page.route('**/api/tenant/status', (route) => route.fulfill({ json: status }));
  await page.addInitScript(() => {
    window.localStorage.setItem('kyvvo_token', 'fake-jwt-token');
    window.localStorage.setItem('kyvvo_nome', 'Ana');
  });
  await page.goto('/painel.html');
}

test.describe('Avisos contextuais do painel (US59)', () => {
  test('sem pendências, nenhum aviso aparece', async ({ page }) => {
    await entrarNoPainel(page);
    await expect(page.locator('.aviso-item')).toHaveCount(0);
  });

  test('cobrança pendente mostra aviso crítico sem botão de dispensar', async ({ page }) => {
    await entrarNoPainel(page, { ...STATUS_BASE, pagamento_pendente: true });
    const aviso = page.locator('.aviso-item[data-aviso-id="pagamento_pendente"]');
    await expect(aviso).toBeVisible();
    await expect(aviso).toHaveClass(/aviso-critico/);
    await expect(aviso.locator('.aviso-dispensar')).toHaveCount(0);
  });

  test('clicar em "Resolver agora" no aviso de cobrança navega para a tela de Cobrança', async ({ page }) => {
    await entrarNoPainel(page, { ...STATUS_BASE, pagamento_pendente: true });
    await page.route('**/api/pagamentos', (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      return route.fulfill({
        json: {
          status: 'inadimplente', plano_nome: 'Profissional', valor_plano: 247, meio_pagamento: 'pix',
          cartao_final: null, cpf_cnpj: null, proxima_cobranca: null, historico: [],
        },
      });
    });

    await page.click('.aviso-item[data-aviso-id="pagamento_pendente"] .aviso-acao');
    await expect(page.locator('.nav-periodo strong')).toHaveText('Pagamento');
  });

  test('sem serviços cadastrados mostra aviso dispensável', async ({ page }) => {
    await entrarNoPainel(page, { ...STATUS_BASE, configuracao: { ...STATUS_BASE.configuracao, sem_servicos: true } });
    const aviso = page.locator('.aviso-item[data-aviso-id="sem_servicos"]');
    await expect(aviso).toBeVisible();
    await expect(aviso).toHaveClass(/aviso-info/);
    await expect(aviso.locator('.aviso-dispensar')).toBeVisible();
  });

  test('sem profissionais e WhatsApp desconectado empilham os dois avisos ao mesmo tempo', async ({ page }) => {
    await entrarNoPainel(page, {
      ...STATUS_BASE,
      configuracao: { sem_servicos: false, sem_profissionais: true, whatsapp_desconectado: true },
    });
    await expect(page.locator('.aviso-item[data-aviso-id="sem_profissionais"]')).toBeVisible();
    await expect(page.locator('.aviso-item[data-aviso-id="whatsapp_desconectado"]')).toBeVisible();
    await expect(page.locator('.aviso-item')).toHaveCount(2);
  });

  test('dispensar um aviso remove ele da tela e a dispensa persiste num reload', async ({ page }) => {
    const status = { ...STATUS_BASE, configuracao: { ...STATUS_BASE.configuracao, sem_servicos: true } };
    await entrarNoPainel(page, status);
    const aviso = page.locator('.aviso-item[data-aviso-id="sem_servicos"]');
    await expect(aviso).toBeVisible();

    await page.click('.aviso-item[data-aviso-id="sem_servicos"] .aviso-dispensar');
    await expect(aviso).toHaveCount(0);

    await page.reload();
    await expect(page.locator('.aviso-item[data-aviso-id="sem_servicos"]')).toHaveCount(0);
  });

  test('aviso dispensado reaparece se a pendência voltar a existir depois de ter sido resolvida', async ({ page }) => {
    const semServicos = { ...STATUS_BASE, configuracao: { ...STATUS_BASE.configuracao, sem_servicos: true } };
    await entrarNoPainel(page, semServicos);
    await page.click('.aviso-item[data-aviso-id="sem_servicos"] .aviso-dispensar');
    await expect(page.locator('.aviso-item[data-aviso-id="sem_servicos"]')).toHaveCount(0);

    // Pendência resolvida (serviço cadastrado): simula a próxima consulta de
    // status (mesma função usada por verificarStatusConta) sem precisar de
    // um reload de página só pra reexecutar essa checagem.
    await page.evaluate((status) => window.renderAvisos(window.construirAvisos(status)), STATUS_BASE);
    expect(JSON.parse(await page.evaluate(() => window.localStorage.getItem('kyvvo_avisos_dispensados')))).not.toContain('sem_servicos');
    await expect(page.locator('.aviso-item[data-aviso-id="sem_servicos"]')).toHaveCount(0);

    // Pendência volta a existir — aviso reaparece em vez de continuar escondido.
    await page.evaluate((status) => window.renderAvisos(window.construirAvisos(status)), semServicos);
    await expect(page.locator('.aviso-item[data-aviso-id="sem_servicos"]')).toBeVisible();
  });

  test('status sem os campos de US59 (payload antigo) não quebra e não mostra nenhum aviso', async ({ page }) => {
    await entrarNoPainel(page, { email_verified: true, status: 'trial', trial_ativo: true, dias_restantes: 5 });
    await expect(page.locator('.aviso-item')).toHaveCount(0);
    await expect(page.locator('#trial-banner')).toContainText('5 dias restantes');
  });
});
