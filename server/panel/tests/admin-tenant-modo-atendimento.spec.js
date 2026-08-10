const { test, expect } = require('@playwright/test');

// Cobre US69 (CA01/CA02/CA03) e US85/CA03-CA05: seção "Modo de atendimento"
// na página de detalhe do tenant (movida da listagem pela US85), com badge,
// botão de troca, modal de confirmação e histórico de alterações. API
// mockada via page.route — sem dependência de Postgres real.

function tenantDetalheMock(overrides = {}) {
  return {
    id: 't1',
    nome: 'Salão Kyvvo Teste',
    segmento: 'salao_beleza',
    whatsapp: '11987654321',
    cadastrado_em: '2026-07-01T10:00:00Z',
    ativado_em: '2026-07-02T11:30:00Z',
    ativo: true,
    status: 'ativo',
    status_conta: 'Ativo',
    plano_atual: 'Essencial',
    trial_ativo: false,
    trial_inicio: null,
    trial_fim: null,
    trial_dias_restantes: null,
    responsavel: { nome: 'Ana Paula', email: 'ana@salaokyvvo.com' },
    modulos_ativos: [],
    modulos: [],
    usuarios: [],
    contagens: {},
    tecnologia: 'bot',
    ...overrides,
  };
}

async function entrarNoDetalheDoTenant(page, detalhe, { historicoModo = [] } = {}) {
  await page.route('**/api/tenants/*', (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    return route.fulfill({ json: detalhe });
  });
  await page.route('**/api/tenants/*/modulos/historico', (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    return route.fulfill({ json: { historico: [] } });
  });
  await page.route('**/api/tenants/*/modo/historico', (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    return route.fulfill({ json: { historico: historicoModo } });
  });
  await page.addInitScript(() => {
    window.localStorage.setItem('kyvvo_admin_token', 'admin-token-fake');
    window.localStorage.setItem('kyvvo_admin_nome', 'Equipe Kyvvo');
  });
  await page.goto('/admin/tenants/t1');
}

test.describe('Admin — listagem não expõe mais a troca de modo (US85/CA03)', () => {
  test('listagem mostra apenas o resumo do tenant, sem badge nem botão de modo', async ({ page }) => {
    await page.route('**/api/tenants*', (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      return route.fulfill({
        json: {
          tenants: [{ id: 't1', nome: 'Salão Kyvvo Teste', status_conta: 'Ativo', ativo: true, tecnologia: 'bot', cadastrado_em: '2026-07-01T10:00:00Z' }],
          page: 1,
          limit: 20,
          total: 1,
          total_paginas: 1,
        },
      });
    });
    await page.addInitScript(() => {
      window.localStorage.setItem('kyvvo_admin_token', 'admin-token-fake');
    });
    await page.goto('/admin/painel.html');

    await expect(page.locator('[data-testid="modo-t1"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="btn-alterar-modo-t1"]')).toHaveCount(0);
  });
});

test.describe('Admin — seção Modo de atendimento no detalhe (US85/CA03)', () => {
  test('exibe o badge Bot e o botão Alterar para tenant ativo', async ({ page }) => {
    await entrarNoDetalheDoTenant(page, tenantDetalheMock({ tecnologia: 'bot' }));
    const secao = page.locator('.secao-detalhe', { hasText: 'Modo de atendimento' });
    await expect(secao).toContainText('Bot');
    await expect(page.locator('[data-testid="btn-alterar-modo-detalhe"]')).toBeVisible();
  });

  test('exibe o badge IA quando tecnologia=ia', async ({ page }) => {
    await entrarNoDetalheDoTenant(page, tenantDetalheMock({ tecnologia: 'ia' }));
    const secao = page.locator('.secao-detalhe', { hasText: 'Modo de atendimento' });
    await expect(secao).toContainText('IA');
  });

  test('não exibe o botão Alterar para tenant inativo', async ({ page }) => {
    await entrarNoDetalheDoTenant(page, tenantDetalheMock({ ativo: false, status_conta: 'Inativo' }));
    await expect(page.locator('[data-testid="btn-alterar-modo-detalhe"]')).toHaveCount(0);
  });

  test('modal exibe modo atual, modo destino e aviso ao trocar para bot', async ({ page }) => {
    await entrarNoDetalheDoTenant(page, tenantDetalheMock({ tecnologia: 'ia' }));
    await page.click('[data-testid="btn-alterar-modo-detalhe"]');

    await expect(page.locator('.modal-card')).toContainText('Alterar modo de atendimento');
    await expect(page.locator('.modal-card')).toContainText('Salão Kyvvo Teste');
    await expect(page.locator('.modal-card')).toContainText('IA');
    await expect(page.locator('.modal-card')).toContainText('Bot');
    await expect(page.locator('.modal-card')).toContainText('Conversas em andamento');
  });

  test('não exibe aviso de conversas ao trocar de bot para ia', async ({ page }) => {
    await entrarNoDetalheDoTenant(page, tenantDetalheMock({ tecnologia: 'bot' }));
    await page.click('[data-testid="btn-alterar-modo-detalhe"]');
    await expect(page.locator('.modal-card')).not.toContainText('Conversas em andamento');
  });

  test('Cancelar fecha o modal sem chamar a API', async ({ page }) => {
    await entrarNoDetalheDoTenant(page, tenantDetalheMock({ tecnologia: 'bot' }));
    let chamouPatch = false;
    await page.route('**/api/tenants/t1/modo', (route) => {
      chamouPatch = true;
      return route.fulfill({ json: {} });
    });

    await page.click('[data-testid="btn-alterar-modo-detalhe"]');
    await page.click('#btn-cancelar-modo');

    await expect(page.locator('.modal-overlay')).toHaveCount(0);
    expect(chamouPatch).toBe(false);
  });

  test('Confirmar troca chama PATCH .../modo com a tecnologia de destino', async ({ page }) => {
    await entrarNoDetalheDoTenant(page, tenantDetalheMock({ tecnologia: 'bot' }));

    let corpoEnviado = null;
    await page.route('**/api/tenants/t1/modo', (route) => {
      corpoEnviado = route.request().postDataJSON();
      return route.fulfill({ json: { id: 't1', tecnologia: 'ia' } });
    });

    await page.click('[data-testid="btn-alterar-modo-detalhe"]');
    await page.click('#btn-confirmar-modo');

    await expect(page.locator('.toast-sucesso')).toBeVisible();
    expect(corpoEnviado).toEqual({ tecnologia: 'ia' });
  });

  test('erro de validação da troca aparece no modal sem fechar (US85/CA05)', async ({ page }) => {
    await entrarNoDetalheDoTenant(page, tenantDetalheMock({ tecnologia: 'bot' }));
    await page.route('**/api/tenants/t1/modo', (route) =>
      route.fulfill({ status: 422, json: { error: 'Este plano não permite atendimento por IA' } })
    );

    await page.click('[data-testid="btn-alterar-modo-detalhe"]');
    await page.click('#btn-confirmar-modo');

    await expect(page.locator('#modo-erro')).toContainText('não permite atendimento por IA');
    await expect(page.locator('.modal-overlay')).toBeVisible();
  });
});

test.describe('Admin — histórico de modo de atendimento no detalhe (US85/CA04)', () => {
  test('exibe o histórico de trocas, mais recente primeiro', async ({ page }) => {
    await entrarNoDetalheDoTenant(page, tenantDetalheMock({ tecnologia: 'ia' }), {
      historicoModo: [
        { valor_anterior: 'bot', valor_novo: 'ia', alterado_por_nome: 'Equipe Kyvvo', alterado_em: '2026-08-05T10:00:00Z' },
        { valor_anterior: 'ia', valor_novo: 'bot', alterado_por_nome: 'Equipe Kyvvo', alterado_em: '2026-08-01T09:00:00Z' },
      ],
    });

    const linha = page.locator('[data-testid="historico-modo"] tbody tr').first();
    await expect(linha).toContainText('Bot');
    await expect(linha).toContainText('IA');
    await expect(linha).toContainText('Equipe Kyvvo');

    const linhas = page.locator('[data-testid="historico-modo"] tbody tr');
    await expect(linhas).toHaveCount(2);
  });

  test('sem histórico, mostra mensagem de lista vazia', async ({ page }) => {
    await entrarNoDetalheDoTenant(page, tenantDetalheMock(), { historicoModo: [] });
    await expect(page.locator('[data-testid="historico-modo"]')).toContainText('Nenhuma alteração registrada ainda.');
  });
});
