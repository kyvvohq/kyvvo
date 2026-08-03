const { test, expect } = require('@playwright/test');

// Cobre US39.2: seção "Números prontos" (plano "Novo número") na página
// admin de WhatsApp — cadastro de número, vínculo a um salão e envio de
// mensagem de teste. API mockada via page.route — sem dependência de
// Postgres real.

const STATUS_META_PADRAO = {
  meta: { configurado: false },
  verificadoEm: '2026-08-03T12:00:00Z',
};

function numeroPronto(overrides = {}) {
  return {
    id: 'num-1',
    telefone: '(34) 98555-8788',
    meta_phone_number_id: '111222333',
    meta_waba_id: '444555666',
    status: 'disponivel',
    tenant_id: null,
    tenant_nome: null,
    testado_em: null,
    teste_resultado: null,
    criado_em: '2026-08-01T10:00:00Z',
    ...overrides,
  };
}

// `numeros` é sempre servido a partir do array passado, por referência — os
// testes que simulam vincular/testar atualizam esse array no mock da rota
// POST correspondente, pra que o refetch (GET) feito pelo app depois da ação
// reflita o novo estado, igual ao backend real faria.
async function entrarEmWhatsapp(page, { numeros = [], tenants = [], statusMeta = STATUS_META_PADRAO } = {}) {
  await page.route('**/admin/api/whatsapp/status', (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    return route.fulfill({ json: statusMeta });
  });
  await page.route('**/admin/api/numeros-prontos', (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    return route.fulfill({ json: { numeros } });
  });
  await page.route('**/admin/api/tenants', (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    return route.fulfill({ json: { tenants } });
  });
  await page.addInitScript(() => {
    window.localStorage.setItem('kyvvo_admin_token', 'admin-token-fake');
    window.localStorage.setItem('kyvvo_admin_nome', 'Equipe Kyvvo');
  });
  await page.goto('/admin/whatsapp.html');
}

test.describe('Admin — Números prontos / plano "Novo número" (US39.2)', () => {
  test('lista números prontos com status, salão e último teste', async ({ page }) => {
    await entrarEmWhatsapp(page, {
      numeros: [
        numeroPronto({ id: 'num-1', status: 'disponivel' }),
        numeroPronto({
          id: 'num-2',
          telefone: '(34) 99000-1122',
          status: 'ativo',
          tenant_id: 't-1',
          tenant_nome: 'Salão da Ana',
          testado_em: '2026-08-02T09:00:00Z',
          teste_resultado: 'Mensagem de teste enviada com sucesso para 5534988887777.',
        }),
      ],
    });

    const linha1 = page.locator('tr[data-numero="num-1"]');
    await expect(linha1).toContainText('(34) 98555-8788');
    await expect(linha1).toContainText('Disponível');
    await expect(linha1).toContainText('—');

    const linha2 = page.locator('tr[data-numero="num-2"]');
    await expect(linha2).toContainText('Ativo');
    await expect(linha2).toContainText('Salão da Ana');
    await expect(linha2).toContainText('Mensagem de teste enviada com sucesso');
  });

  test('mostra estado vazio quando não há números cadastrados', async ({ page }) => {
    await entrarEmWhatsapp(page);
    await expect(page.locator('.tabela-tenants')).toContainText('Nenhum número pronto cadastrado ainda.');
  });

  test('cadastra um novo número pronto (Entregável: estrutura pra associar número ao salão)', async ({ page }) => {
    await entrarEmWhatsapp(page);

    let corpoEnviado = null;
    await page.route('**/admin/api/numeros-prontos', (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      corpoEnviado = route.request().postDataJSON();
      return route.fulfill({
        status: 201,
        json: numeroPronto({ id: 'num-novo', telefone: corpoEnviado.telefone, meta_phone_number_id: corpoEnviado.meta_phone_number_id, meta_waba_id: corpoEnviado.meta_waba_id }),
      });
    });

    await page.click('[data-acao="abrir-novo-numero"]');
    await page.fill('#novo-numero-telefone', '(34) 98555-8788');
    await page.fill('#novo-numero-phone-id', '111222333');
    await page.fill('#novo-numero-waba-id', '444555666');
    await page.click('[data-acao="salvar-novo-numero"]');

    await expect(page.locator('.toast-sucesso')).toHaveText(/cadastrado/);
    expect(corpoEnviado).toMatchObject({
      telefone: '(34) 98555-8788',
      meta_phone_number_id: '111222333',
      meta_waba_id: '444555666',
    });
  });

  test('vincula um número disponível a um salão (CA: número pode ser vinculado a um salão específico)', async ({ page }) => {
    const numeros = [numeroPronto()];
    await entrarEmWhatsapp(page, {
      numeros,
      tenants: [{ id: 't-1', nome: 'Salão da Ana' }, { id: 't-2', nome: 'Barbearia do João' }],
    });

    let corpoEnviado = null;
    await page.route('**/admin/api/numeros-prontos/num-1/vincular', (route) => {
      corpoEnviado = route.request().postDataJSON();
      numeros[0] = numeroPronto({ status: 'em_configuracao', tenant_id: 't-1', tenant_nome: 'Salão da Ana' });
      return route.fulfill({ json: numeros[0] });
    });

    await page.click('tr[data-numero="num-1"] [data-acao="abrir-vincular"]');
    await page.selectOption('#select-tenant-num-1', 't-1');
    await page.click('tr[data-numero="num-1"] [data-acao="confirmar-vincular"]');

    await expect(page.locator('.toast-sucesso')).toHaveText(/vinculado/);
    expect(corpoEnviado).toMatchObject({ tenant_id: 't-1' });
    await expect(page.locator('tr[data-numero="num-1"]')).toContainText('Salão da Ana');
  });

  test('erro ao vincular sem selecionar salão aparece inline, sem chamar a API', async ({ page }) => {
    await entrarEmWhatsapp(page, { numeros: [numeroPronto()], tenants: [{ id: 't-1', nome: 'Salão da Ana' }] });

    let chamou = false;
    await page.route('**/admin/api/numeros-prontos/num-1/vincular', (route) => {
      chamou = true;
      return route.fulfill({ json: {} });
    });

    await page.click('tr[data-numero="num-1"] [data-acao="abrir-vincular"]');
    await page.click('tr[data-numero="num-1"] [data-acao="confirmar-vincular"]');

    await expect(page.locator('#vincular-erro-num-1')).toHaveText('Selecione um salão.');
    expect(chamou).toBe(false);
  });

  test('envia mensagem de teste com sucesso: número operacional na Cloud API (CA)', async ({ page }) => {
    const numeros = [numeroPronto({ status: 'em_configuracao', tenant_id: 't-1', tenant_nome: 'Salão da Ana' })];
    await entrarEmWhatsapp(page, { numeros });

    let corpoEnviado = null;
    await page.route('**/admin/api/numeros-prontos/num-1/testar', (route) => {
      corpoEnviado = route.request().postDataJSON();
      numeros[0] = numeroPronto({
        status: 'ativo',
        tenant_id: 't-1',
        tenant_nome: 'Salão da Ana',
        testado_em: '2026-08-03T15:00:00Z',
        teste_resultado: 'Mensagem de teste enviada com sucesso para 5534988887777.',
      });
      return route.fulfill({ json: numeros[0] });
    });

    await page.click('tr[data-numero="num-1"] [data-acao="abrir-testar"]');
    await page.fill('#teste-destino-num-1', '5534988887777');
    await page.click('tr[data-numero="num-1"] [data-acao="confirmar-testar"]');

    await expect(page.locator('.toast-sucesso')).toHaveText(/Mensagem de teste enviada/);
    expect(corpoEnviado).toMatchObject({ numero_destino: '5534988887777' });
    await expect(page.locator('tr[data-numero="num-1"]')).toContainText('Ativo');
  });

  test('erro no envio da mensagem de teste marca status como erro e mostra o motivo (CA: status confiável)', async ({ page }) => {
    await entrarEmWhatsapp(page, {
      numeros: [numeroPronto({ status: 'em_configuracao', tenant_id: 't-1', tenant_nome: 'Salão da Ana' })],
    });

    await page.route('**/admin/api/numeros-prontos/num-1/testar', (route) =>
      route.fulfill({ status: 400, json: { error: 'META_WHATSAPP_TOKEN não configurado no servidor.' } })
    );

    await page.click('tr[data-numero="num-1"] [data-acao="abrir-testar"]');
    await page.fill('#teste-destino-num-1', '5534988887777');
    await page.click('tr[data-numero="num-1"] [data-acao="confirmar-testar"]');

    await expect(page.locator('#testar-erro-num-1')).toHaveText(/META_WHATSAPP_TOKEN não configurado/);
  });
});
