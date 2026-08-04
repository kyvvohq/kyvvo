const { test, expect } = require('@playwright/test');

// Cobre US39.1: pedido de "Número pronto" na aba WhatsApp do portal — o
// tenant confirma que quer um número novo fornecido pela Kyvvo (sem
// precisar de Embedded Signup), e a tela troca o botão por um card de
// "pedido recebido". Não cobre o fluxo de self-service (Embedded Signup via
// FB.login), que já não tinha suíte própria antes desta task — depende do
// SDK do Facebook carregado via script externo.

async function entrarNoWhatsapp(page, { status, config = { appId: null, configId: null } } = {}) {
  await page.route('**/api/configuracao', (route) =>
    route.fulfill({ json: { dias_funcionamento: [1, 2, 3, 4, 5, 6], formato_hora: '24h', segmento: 'salao_beleza' } })
  );
  await page.route('**/api/agendamentos**', (route) =>
    route.fulfill({ json: { view: 'dia', data: '2026-08-03', agendamentos: [] } })
  );
  await page.route('**/api/tenant/modulos', (route) => route.fulfill({ json: { modulos: [] } }));
  await page.route('**/api/whatsapp/status', (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    return route.fulfill({ json: status });
  });
  await page.route('**/api/whatsapp/config-publica', (route) => route.fulfill({ json: config }));
  await page.addInitScript(() => {
    window.localStorage.setItem('kyvvo_token', 'fake-jwt-token');
    window.localStorage.setItem('kyvvo_nome', 'Ana');
  });
  await page.goto('/painel.html');
  await page.click('#user-menu-toggle');
  await page.click('.user-menu-item[data-menu="whatsapp"]');
}

test.describe('WhatsApp — pedido de número pronto (US39.1)', () => {
  test('não conectado e sem pedido: mostra as duas opções, com botão "Pedir número novo" (CA: fluxo de cadastro e ativação)', async ({ page }) => {
    await entrarNoWhatsapp(page, { status: { conectado: false, phoneNumberId: null, pedidoNumeroNovo: null } });

    await expect(page.locator('.whatsapp-planos-info')).toContainText('Traga seu número');
    await expect(page.locator('.whatsapp-planos-info')).toContainText('Número pronto');
    await expect(page.locator('#btn-pedir-numero-novo')).toHaveText('Pedir número novo');
  });

  test('pedido já enviado: mostra card de "pedido recebido" com data e DDD, sem o botão (CA: mensagem de expectativa sem SLA)', async ({ page }) => {
    await entrarNoWhatsapp(page, {
      status: {
        conectado: false,
        phoneNumberId: null,
        pedidoNumeroNovo: { solicitadoEm: '2026-08-03T14:30:00Z', dddPreferencia: '34' },
      },
    });

    await expect(page.locator('.whatsapp-planos-info')).toContainText('pedido recebido em');
    await expect(page.locator('.whatsapp-planos-info')).toContainText('ainda não temos um prazo fechado');
    await expect(page.locator('#btn-pedir-numero-novo')).toHaveCount(0);
  });

  test('envia o pedido com sucesso: fecha o modal, mostra toast e recarrega a tela (CA02/CA03 da jornada)', async ({ page }) => {
    await entrarNoWhatsapp(page, { status: { conectado: false, phoneNumberId: null, pedidoNumeroNovo: null } });

    // Registrada depois de entrarNoWhatsapp de propósito: rotas mais
    // recentes têm prioridade no Playwright, então esta sobrepõe a rota
    // estática do helper só a partir daqui — o primeiro render (antes do
    // envio) já usou a rota estática (pedidoNumeroNovo: null), e o refetch
    // depois do POST passa a usar esta, refletindo o pedido enviado.
    let corpoEnviado = null;
    let pedidoEnviado = false;
    await page.route('**/api/whatsapp/status', (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      const pedidoNumeroNovo = pedidoEnviado ? { solicitadoEm: '2026-08-03T14:30:00Z', dddPreferencia: '34' } : null;
      return route.fulfill({ json: { conectado: false, phoneNumberId: null, pedidoNumeroNovo } });
    });
    await page.route('**/api/whatsapp/solicitar-numero-novo', (route) => {
      pedidoEnviado = true;
      corpoEnviado = route.request().postDataJSON();
      return route.fulfill({ json: { novo_numero_ddd_preferencia: '34', novo_numero_solicitado_em: '2026-08-03T14:30:00Z' } });
    });

    await page.click('#btn-pedir-numero-novo');
    await expect(page.locator('.modal-card h3')).toHaveText('Pedir número novo');
    await page.fill('#numero-novo-ddd', '34');
    await page.click('#btn-confirmar-numero-novo');

    await expect(page.locator('#numero-novo-erro')).toHaveText('Confirme que você entendeu como funciona antes de enviar.');
    expect(corpoEnviado).toBeNull();

    await page.click('#numero-novo-aceite');
    await page.click('#btn-confirmar-numero-novo');

    await expect(page.locator('.toast-sucesso')).toHaveText(/Pedido enviado/);
    expect(corpoEnviado).toMatchObject({ ddd_preferencia: '34' });
    await expect(page.locator('#modal-overlay')).toHaveCount(0);
    await expect(page.locator('.whatsapp-planos-info')).toContainText('pedido recebido em');
  });

  test('erro do backend ao enviar o pedido aparece no modal', async ({ page }) => {
    await entrarNoWhatsapp(page, { status: { conectado: false, phoneNumberId: null, pedidoNumeroNovo: null } });

    await page.route('**/api/whatsapp/solicitar-numero-novo', (route) =>
      route.fulfill({ status: 409, json: { error: 'Você já pediu um número novo. Nossa equipe vai avisar quando estiver pronto.' } })
    );

    await page.click('#btn-pedir-numero-novo');
    await page.click('#numero-novo-aceite');
    await page.click('#btn-confirmar-numero-novo');

    await expect(page.locator('#numero-novo-erro')).toHaveText(/Você já pediu um número novo/);
  });

  test('já conectado via self-service: não mostra as opções de plano nem o botão de pedir número novo', async ({ page }) => {
    await entrarNoWhatsapp(page, {
      status: { conectado: true, phoneNumberId: '123456', numeroExibido: '+55 34 98888-7777', pedidoNumeroNovo: null },
    });

    await expect(page.locator('.whatsapp-planos-info')).toHaveCount(0);
    await expect(page.locator('#btn-pedir-numero-novo')).toHaveCount(0);
  });
});
