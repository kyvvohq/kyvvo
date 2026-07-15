const { test, expect } = require('@playwright/test');

// Cobre US26: tela dedicada de listagem de tenants no admin da Kyvvo,
// separada do CRUD simples em painel.html (US16). API mockada via
// page.route — sem dependência de Postgres real.

function tenantMock(overrides = {}) {
  return {
    id: 't1',
    nome: 'Salão Kyvvo Teste',
    responsavel: 'Ana Paula',
    email: 'ana@salaokyvvo.com',
    whatsapp: '11987654321',
    cadastrado_em: '2026-07-01T10:00:00Z',
    ativado_em: '2026-07-02T11:30:00Z',
    ativo: true,
    status_conta: 'Trial ativo',
    total_usuarios: 1,
    ...overrides,
  };
}

async function entrarNaListaDeTenants(page, tenants = [], meta = {}) {
  await page.route('**/admin/api/tenants*', (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    return route.fulfill({
      json: { tenants, page: 1, limit: 20, total: tenants.length, total_paginas: 1, ...meta },
    });
  });
  await page.addInitScript(() => {
    window.localStorage.setItem('kyvvo_admin_token', 'admin-token-fake');
    window.localStorage.setItem('kyvvo_admin_nome', 'Equipe Kyvvo');
  });
  await page.goto('/admin/tenants.html');
}

test.describe('Admin — listagem de tenants (US26)', () => {
  test('redireciona para o login se não autenticado como admin', async ({ page }) => {
    await page.goto('/admin/tenants.html');
    await expect(page).toHaveURL(/\/admin\/login\.html/);
  });

  test('lista os tenants com as colunas definidas (CA02)', async ({ page }) => {
    await entrarNaListaDeTenants(page, [tenantMock()]);

    const linha = page.locator('.tabela-tenants tbody tr').first();
    await expect(linha).toContainText('Salão Kyvvo Teste');
    await expect(linha).toContainText('Ana Paula');
    await expect(linha).toContainText('ana@salaokyvvo.com');
    // WhatsApp formatado (XX) XXXXX-XXXX
    await expect(linha).toContainText('(11) 98765-4321');
    await expect(linha).toContainText('01/07/2026');
    await expect(linha).toContainText('02/07/2026');
    await expect(linha.locator('.badge-status')).toHaveText('Trial ativo');
    await expect(linha.locator('.btn-ver-detalhes')).toHaveAttribute('href', '/admin/tenants/t1');
  });

  test('estado vazio quando não há tenants cadastrados (CA05)', async ({ page }) => {
    await entrarNaListaDeTenants(page, []);
    await expect(page.locator('.vazio')).toHaveText('Nenhum tenant cadastrado ainda.');
  });

  test('ordenação padrão por data de cadastro decrescente (CA03)', async ({ page }) => {
    let urlRecebida = null;
    await page.route('**/admin/api/tenants*', (route) => {
      urlRecebida = route.request().url();
      return route.fulfill({ json: { tenants: [tenantMock()], page: 1, limit: 20, total: 1, total_paginas: 1 } });
    });
    await page.addInitScript(() => {
      window.localStorage.setItem('kyvvo_admin_token', 'admin-token-fake');
    });
    await page.goto('/admin/tenants.html');

    expect(urlRecebida).toContain('order_by=cadastrado_em');
    expect(urlRecebida).toContain('order_dir=desc');
  });

  test('clicar no cabeçalho de uma coluna reordena a tabela (CA03)', async ({ page }) => {
    const requisicoes = [];
    await page.route('**/admin/api/tenants*', (route) => {
      requisicoes.push(route.request().url());
      return route.fulfill({ json: { tenants: [tenantMock()], page: 1, limit: 20, total: 1, total_paginas: 1 } });
    });
    await page.addInitScript(() => {
      window.localStorage.setItem('kyvvo_admin_token', 'admin-token-fake');
    });
    await page.goto('/admin/tenants.html');

    await page.click('[data-order-by="nome"]');
    await expect.poll(() => requisicoes.at(-1)).toContain('order_by=nome');
    await expect.poll(() => requisicoes.at(-1)).toContain('order_dir=desc');

    // Clicar de novo na mesma coluna inverte a direção.
    await page.click('[data-order-by="nome"]');
    await expect.poll(() => requisicoes.at(-1)).toContain('order_dir=asc');
  });

  test('paginação: botões Anterior/Próximo e indicador de página (CA04)', async ({ page }) => {
    const requisicoes = [];
    await page.route('**/admin/api/tenants*', (route) => {
      const url = new URL(route.request().url());
      requisicoes.push(url.toString());
      const pagina = Number(url.searchParams.get('page')) || 1;
      return route.fulfill({
        json: { tenants: [tenantMock({ id: `t${pagina}` })], page: pagina, limit: 20, total: 40, total_paginas: 2 },
      });
    });
    await page.addInitScript(() => {
      window.localStorage.setItem('kyvvo_admin_token', 'admin-token-fake');
    });
    await page.goto('/admin/tenants.html');

    await expect(page.getByText('Página 1 de 2')).toBeVisible();
    await expect(page.locator('#btn-pagina-anterior')).toBeDisabled();

    await page.click('#btn-pagina-proxima');
    await expect(page.getByText('Página 2 de 2')).toBeVisible();
    await expect(page.locator('#btn-pagina-proxima')).toBeDisabled();
    expect(requisicoes.at(-1)).toContain('page=2');
  });
});
