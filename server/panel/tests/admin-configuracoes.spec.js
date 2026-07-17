const { test, expect } = require('@playwright/test');

// Cobre US38: página de Configurações do sistema na área admin (preços dos
// planos + configurações gerais + log de auditoria). API mockada via
// page.route — sem dependência de Postgres real.

function configuracoesMock(overrides = {}) {
  return {
    planos: [
      { chave: 'starter', nome: 'Starter', descricao: 'Acesso web + bot WhatsApp', preco_mensal: 147, limite_disparos: 100, ativo: true, atualizado_em: '2026-07-01T10:00:00Z' },
      { chave: 'profissional', nome: 'Profissional', descricao: 'Web + app mobile + 500 disparos', preco_mensal: 247, limite_disparos: 500, ativo: true, atualizado_em: '2026-07-01T10:00:00Z' },
      { chave: 'empresarial', nome: 'Empresarial', descricao: 'Tudo + multi-unidades + disparos ilimitados', preco_mensal: 447, limite_disparos: null, ativo: false, atualizado_em: '2026-07-01T10:00:00Z' },
    ],
    sistema: {
      trial_dias: '14',
      carencia_dias_inadimplencia: '3',
      max_tentativas_reenvio_token: '5',
      email_suporte: 'suporte@kyvvo.com.br',
      whatsapp_suporte: '553484285182',
    },
    log: [
      { campo: 'planos.starter.preco_mensal', valor_anterior: '137', valor_novo: '147', alterado_em: '2026-07-15T09:00:00Z', alterado_por_nome: 'Equipe Kyvvo' },
    ],
    ...overrides,
  };
}

async function entrarEmConfiguracoes(page, configuracoes) {
  await page.route('**/admin/api/configuracoes', (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    return route.fulfill({ json: configuracoes });
  });
  await page.addInitScript(() => {
    window.localStorage.setItem('kyvvo_admin_token', 'admin-token-fake');
    window.localStorage.setItem('kyvvo_admin_nome', 'Equipe Kyvvo');
  });
  await page.goto('/admin/configuracoes.html');
}

test.describe('Admin — Configurações do sistema (US38)', () => {
  test('redireciona para o login se não autenticado como admin', async ({ page }) => {
    await page.goto('/admin/configuracoes.html');
    await expect(page).toHaveURL(/\/admin\/login\.html/);
  });

  test('lista os planos com nome, descrição, preço, limite e status (CA02)', async ({ page }) => {
    await entrarEmConfiguracoes(page, configuracoesMock());

    const linhaStarter = page.locator('tr[data-plano="starter"]');
    await expect(linhaStarter).toContainText('Starter');
    await expect(linhaStarter).toContainText('Acesso web + bot WhatsApp');
    await expect(linhaStarter).toContainText('R$ 147,00');
    await expect(linhaStarter).toContainText('100');

    const linhaEmpresarial = page.locator('tr[data-plano="empresarial"]');
    await expect(linhaEmpresarial).toContainText('Ilimitado');
    await expect(linhaEmpresarial.locator('.toggle-clicavel')).toHaveClass(/toggle-off/);
  });

  test('link "Configurações" está disponível no painel admin', async ({ page }) => {
    await page.route('**/admin/api/tenants', (route) => route.fulfill({ json: { tenants: [] } }));
    await page.addInitScript(() => {
      window.localStorage.setItem('kyvvo_admin_token', 'admin-token-fake');
      window.localStorage.setItem('kyvvo_admin_nome', 'Equipe Kyvvo');
    });
    await page.goto('/admin/painel.html');
    await expect(page.locator('a[href="/admin/configuracoes.html"]')).toBeVisible();
  });

  test('editar preço de um plano: banner de aviso aparece e some ao cancelar (CA03/CA04)', async ({ page }) => {
    await entrarEmConfiguracoes(page, configuracoesMock());

    await expect(page.locator('.banner-aviso')).toHaveCount(0);
    await page.click('tr[data-plano="starter"] [data-acao="editar-plano"]');
    await expect(page.locator('.banner-aviso')).toContainText('alterações de preço afetam apenas novas assinaturas');

    await page.click('tr[data-plano="starter"] [data-acao="cancelar-plano"]');
    await expect(page.locator('.banner-aviso')).toHaveCount(0);
    await expect(page.locator('tr[data-plano="starter"] [data-acao="editar-plano"]')).toBeVisible();
  });

  test('salva um novo preço com sucesso (CA03/CA09)', async ({ page }) => {
    await entrarEmConfiguracoes(page, configuracoesMock());

    let corpoEnviado = null;
    await page.route('**/admin/api/configuracoes/planos/starter', (route) => {
      corpoEnviado = route.request().postDataJSON();
      return route.fulfill({
        json: { chave: 'starter', nome: 'Starter', descricao: 'Acesso web + bot WhatsApp', preco_mensal: 167, limite_disparos: 100, ativo: true, atualizado_em: '2026-07-17T12:00:00Z' },
      });
    });

    await page.click('tr[data-plano="starter"] [data-acao="editar-plano"]');
    await page.fill('tr[data-plano="starter"] .input-plano-preco', '167');
    await page.click('tr[data-plano="starter"] [data-acao="salvar-plano"]');

    await expect(page.locator('.toast-sucesso')).toHaveText(/Preço atualizado/);
    expect(corpoEnviado).toMatchObject({ preco_mensal: 167 });
  });

  test('preço abaixo de R$ 1 não salva e mostra erro (CA03)', async ({ page }) => {
    await entrarEmConfiguracoes(page, configuracoesMock());

    let chamou = false;
    await page.route('**/admin/api/configuracoes/planos/starter', () => { chamou = true; });

    await page.click('tr[data-plano="starter"] [data-acao="editar-plano"]');
    await page.fill('tr[data-plano="starter"] .input-plano-preco', '0');
    await page.click('tr[data-plano="starter"] [data-acao="salvar-plano"]');

    await expect(page.locator('tr[data-plano="starter"] [data-erro-plano="starter"]')).toHaveText(/mínimo R\$ 1,00/);
    expect(chamou).toBe(false);
  });

  test('erro do backend ao salvar aparece na linha', async ({ page }) => {
    await entrarEmConfiguracoes(page, configuracoesMock());
    await page.route('**/admin/api/configuracoes/planos/starter', (route) =>
      route.fulfill({ status: 400, json: { error: 'Preço mensal deve ser no mínimo R$ 1,00.' } })
    );

    await page.click('tr[data-plano="starter"] [data-acao="editar-plano"]');
    await page.fill('tr[data-plano="starter"] .input-plano-preco', '5');
    await page.click('tr[data-plano="starter"] [data-acao="salvar-plano"]');

    await expect(page.locator('tr[data-plano="starter"] [data-erro-plano="starter"]')).toHaveText(/mínimo R\$ 1,00/);
  });

  test('alterna o status ativo de um plano imediatamente, sem modo de edição (CA02)', async ({ page }) => {
    await entrarEmConfiguracoes(page, configuracoesMock());

    let corpoEnviado = null;
    await page.route('**/admin/api/configuracoes/planos/empresarial', (route) => {
      corpoEnviado = route.request().postDataJSON();
      return route.fulfill({
        json: { chave: 'empresarial', nome: 'Empresarial', descricao: 'Tudo + multi-unidades + disparos ilimitados', preco_mensal: 447, limite_disparos: null, ativo: true, atualizado_em: '2026-07-17T12:00:00Z' },
      });
    });

    await page.click('tr[data-plano="empresarial"] .toggle-clicavel');

    await expect(page.locator('.toast-sucesso')).toHaveText(/ativado/);
    expect(corpoEnviado).toMatchObject({ ativo: true });
  });

  test('lista as configurações gerais e edita uma delas (CA06)', async ({ page }) => {
    await entrarEmConfiguracoes(page, configuracoesMock());

    const linhaTrial = page.locator('tr[data-config="trial_dias"]');
    await expect(linhaTrial).toContainText('Dias de trial');
    await expect(linhaTrial).toContainText('14');

    let corpoEnviado = null;
    await page.route('**/admin/api/configuracoes/sistema', (route) => {
      corpoEnviado = route.request().postDataJSON();
      return route.fulfill({ json: { ...configuracoesMock().sistema, trial_dias: '21' } });
    });

    await page.click('tr[data-config="trial_dias"] [data-acao="editar-config"]');
    await page.fill('tr[data-config="trial_dias"] .input-config-valor', '21');
    await page.click('tr[data-config="trial_dias"] [data-acao="salvar-config"]');

    await expect(page.locator('.toast-sucesso')).toHaveText(/Configuração atualizada/);
    expect(corpoEnviado).toMatchObject({ trial_dias: '21' });
  });

  test('configuração numérica inválida não salva e mostra erro (CA06)', async ({ page }) => {
    await entrarEmConfiguracoes(page, configuracoesMock());

    let chamou = false;
    await page.route('**/admin/api/configuracoes/sistema', () => { chamou = true; });

    await page.click('tr[data-config="trial_dias"] [data-acao="editar-config"]');
    await page.fill('tr[data-config="trial_dias"] .input-config-valor', '-5');
    await page.click('tr[data-config="trial_dias"] [data-acao="salvar-config"]');

    await expect(page.locator('tr[data-config="trial_dias"] [data-erro-config="trial_dias"]')).toContainText('número inteiro maior que zero');
    expect(chamou).toBe(false);
  });

  test('mostra o log de auditoria com as últimas alterações (CA07)', async ({ page }) => {
    await entrarEmConfiguracoes(page, configuracoesMock());

    const linhaLog = page.locator('.tabela-tenants').last().locator('tbody tr').first();
    await expect(linhaLog).toContainText('planos.starter.preco_mensal');
    await expect(linhaLog).toContainText('137');
    await expect(linhaLog).toContainText('147');
    await expect(linhaLog).toContainText('Equipe Kyvvo');
  });

  test('sem alterações registradas, mostra mensagem vazia no log', async ({ page }) => {
    await entrarEmConfiguracoes(page, configuracoesMock({ log: [] }));

    const linhaLog = page.locator('.tabela-tenants').last().locator('tbody tr').first();
    await expect(linhaLog).toContainText('Nenhuma alteração registrada ainda.');
  });
});
