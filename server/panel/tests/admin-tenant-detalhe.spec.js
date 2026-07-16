const { test, expect } = require('@playwright/test');

// Cobre US28: página de detalhe do tenant no admin, acessada a partir da
// listagem (US26/US27). API mockada via page.route — sem dependência de
// Postgres real.

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
    trial_expires_at: null,
    plano: null,
    status_conta: 'Ativo',
    plano_atual: 'Não definido',
    trial_ativo: false,
    trial_inicio: null,
    trial_fim: null,
    trial_dias_restantes: null,
    responsavel: { nome: 'Ana Paula', email: 'ana@salaokyvvo.com' },
    modulos_ativos: [{ key: 'agenda_inteligente', nome: 'Agenda Inteligente' }],
    usuarios: [{ id: 'u1', email: 'ana@salaokyvvo.com', nome: 'Ana Paula' }],
    contagens: { servicos: 3, profissionais: 2, total_agendamentos: 12, ultimo_agendamento: '2026-07-10T14:00:00Z', total_clientes: 8 },
    ...overrides,
  };
}

async function entrarNoDetalheDoTenant(page, detalhe) {
  await page.route('**/admin/api/tenants/*', (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    return route.fulfill({ json: detalhe });
  });
  await page.addInitScript(() => {
    window.localStorage.setItem('kyvvo_admin_token', 'admin-token-fake');
    window.localStorage.setItem('kyvvo_admin_nome', 'Equipe Kyvvo');
  });
  await page.goto('/admin/tenants/t1');
}

test.describe('Admin — detalhe do tenant (US28)', () => {
  test('redireciona para o login se não autenticado como admin', async ({ page }) => {
    await page.goto('/admin/tenants/t1');
    await expect(page).toHaveURL(/\/admin\/login\.html/);
  });

  test('seção Dados do negócio (CA02)', async ({ page }) => {
    await entrarNoDetalheDoTenant(page, tenantDetalheMock());

    await expect(page.getByText('Salão de beleza')).toBeVisible();
    const linkWhatsapp = page.locator('a[href^="https://wa.me/55"]');
    await expect(linkWhatsapp).toHaveAttribute('href', 'https://wa.me/5511987654321');
    await expect(linkWhatsapp).toContainText('(11) 98765-4321');
  });

  test('seção Dados do responsável, com data e hora (CA03)', async ({ page }) => {
    await entrarNoDetalheDoTenant(page, tenantDetalheMock());

    const secao = page.locator('.secao-detalhe', { hasText: 'Dados do responsável' });
    await expect(secao).toContainText('Ana Paula');
    await expect(secao.locator('a[href="mailto:ana@salaokyvvo.com"]')).toBeVisible();
    await expect(secao).toContainText('01/07/2026');
    await expect(secao).toContainText(/\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}/);
  });

  test('sem ativação ainda, mostra "Não ativado" (CA03)', async ({ page }) => {
    await entrarNoDetalheDoTenant(page, tenantDetalheMock({ ativado_em: null }));
    await expect(page.locator('.secao-detalhe', { hasText: 'Dados do responsável' })).toContainText('Não ativado');
  });

  test('seção Status da conta com plano atual (CA04)', async ({ page }) => {
    await entrarNoDetalheDoTenant(
      page,
      tenantDetalheMock({
        status: 'trial',
        status_conta: 'Trial ativo',
        plano_atual: 'Trial',
        trial_ativo: true,
        trial_inicio: '2026-07-10T11:30:00Z',
        trial_fim: '2026-07-24T11:30:00Z',
        trial_dias_restantes: 5,
      })
    );

    const secao = page.locator('.secao-detalhe', { hasText: 'Status da conta' });
    await expect(page.locator('.badge-status')).toHaveText('Trial ativo');
    await expect(secao).toContainText('Plano atual: Trial');
  });

  test('status suspenso mostra badge dedicado (CA04)', async ({ page }) => {
    await entrarNoDetalheDoTenant(page, tenantDetalheMock({ status: 'suspenso', status_conta: 'Suspenso' }));
    await expect(page.locator('.badge-status')).toHaveText('Suspenso');
    await expect(page.locator('.badge-status-suspenso')).toBeVisible();
  });

  test('indicador de trial somente leitura — ativo (US31/CA01-CA04)', async ({ page }) => {
    await entrarNoDetalheDoTenant(
      page,
      tenantDetalheMock({
        trial_ativo: true,
        trial_inicio: '2026-07-10T11:30:00Z',
        trial_fim: '2026-07-24T11:30:00Z',
        trial_dias_restantes: 5,
      })
    );

    const secao = page.locator('.secao-detalhe', { hasText: 'Status da conta' });
    await expect(secao.locator('.badge-trial-indicador')).toHaveText('Trial ativo');
    await expect(secao.locator('.toggle-readonly')).toHaveClass(/toggle-on/);
    await expect(secao).toContainText('Início do trial: 10/07/2026');
    await expect(secao).toContainText('Término do trial: 24/07/2026');
    await expect(secao).toContainText('Dias restantes: 5');
  });

  test('indicador de trial somente leitura — expirado (US31/CA03)', async ({ page }) => {
    await entrarNoDetalheDoTenant(
      page,
      tenantDetalheMock({
        trial_ativo: false,
        trial_inicio: '2026-06-01T11:30:00Z',
        trial_fim: '2026-06-15T11:30:00Z',
        trial_dias_restantes: -30,
      })
    );

    const secao = page.locator('.secao-detalhe', { hasText: 'Status da conta' });
    await expect(secao.locator('.badge-trial-indicador')).toHaveText('Trial expirado');
    await expect(secao.locator('.toggle-readonly')).toHaveClass(/toggle-off/);
    await expect(secao).toContainText('Dias restantes: Expirado há 30 dias');
  });

  test('indicador de trial somente leitura — não ativado (US31/CA03)', async ({ page }) => {
    await entrarNoDetalheDoTenant(
      page,
      tenantDetalheMock({
        trial_ativo: false,
        trial_inicio: null,
        trial_fim: null,
        trial_dias_restantes: null,
      })
    );

    const secao = page.locator('.secao-detalhe', { hasText: 'Status da conta' });
    await expect(secao.locator('.badge-trial-indicador')).toHaveText('Não ativado');
    await expect(secao.locator('.toggle-readonly')).toHaveClass(/toggle-off/);
    await expect(secao).not.toContainText('Início do trial');
    await expect(secao).not.toContainText('Término do trial');
  });

  test('indicador de trial não tem controle interativo/clicável (US31/CA01)', async ({ page }) => {
    await entrarNoDetalheDoTenant(
      page,
      tenantDetalheMock({
        trial_ativo: true,
        trial_inicio: '2026-07-10T11:30:00Z',
        trial_fim: '2026-07-24T11:30:00Z',
        trial_dias_restantes: 5,
      })
    );

    const toggle = page.locator('.toggle-readonly');
    await expect(toggle).toBeVisible();
    expect(await toggle.evaluate((el) => el.tagName)).toBe('SPAN');
  });

  test('seção Módulos ativos como chips (CA05)', async ({ page }) => {
    await entrarNoDetalheDoTenant(page, tenantDetalheMock());
    await expect(page.locator('.chip-modulo')).toHaveText('Agenda Inteligente');
  });

  test('sem módulos ativos, mostra mensagem vazia (CA05)', async ({ page }) => {
    await entrarNoDetalheDoTenant(page, tenantDetalheMock({ modulos_ativos: [] }));
    await expect(page.getByText('Nenhum módulo ativo')).toBeVisible();
  });

  test('seção Atividade recente (CA06)', async ({ page }) => {
    await entrarNoDetalheDoTenant(page, tenantDetalheMock());
    const secao = page.locator('.secao-detalhe', { hasText: 'Atividade recente' });
    await expect(secao).toContainText('Total de agendamentos: 12');
    await expect(secao).toContainText('Total de clientes cadastrados: 8');
    await expect(secao).toContainText('10/07/2026');
  });

  test('botão "Voltar para lista" leva de volta à listagem (CA01)', async ({ page }) => {
    await entrarNoDetalheDoTenant(page, tenantDetalheMock());
    await page.click('text=Voltar para lista');
    await expect(page).toHaveURL(/\/admin\/painel\.html/);
  });

  test('tenant inexistente mostra a mensagem de erro do backend', async ({ page }) => {
    await page.route('**/admin/api/tenants/*', (route) => {
      return route.fulfill({ status: 404, json: { error: 'Tenant não encontrado' } });
    });
    await page.addInitScript(() => {
      window.localStorage.setItem('kyvvo_admin_token', 'admin-token-fake');
    });
    await page.goto('/admin/tenants/inexistente');
    await expect(page.getByText('Tenant não encontrado')).toBeVisible();
  });

  test('clicar numa linha da listagem navega para o detalhe (CA01)', async ({ page }) => {
    await page.route('**/admin/api/tenants*', (route) => {
      if (route.request().url().includes('/admin/api/tenants?')) {
        return route.fulfill({
          json: {
            tenants: [{ id: 't1', nome: 'Salão Kyvvo Teste', status_conta: 'Ativo', cadastrado_em: '2026-07-01T10:00:00Z' }],
            page: 1,
            limit: 20,
            total: 1,
            total_paginas: 1,
          },
        });
      }
      return route.fulfill({ json: tenantDetalheMock() });
    });
    await page.addInitScript(() => {
      window.localStorage.setItem('kyvvo_admin_token', 'admin-token-fake');
    });
    await page.goto('/admin/painel.html');

    await page.click('.tabela-tenants tbody tr td:first-child');
    await expect(page).toHaveURL(/\/admin\/tenants\/t1$/);
  });
});
