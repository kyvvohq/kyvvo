const { test, expect } = require('@playwright/test');

// Cobre US26/US27/US28/US31: listagem de tenants (busca, ordenação,
// paginação, badges de status) dentro do painel admin. API mockada via
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
  await page.goto('/admin/painel.html');
}

test.describe('Admin — listagem de tenants (US26)', () => {
  test('redireciona para o login se não autenticado como admin', async ({ page }) => {
    await page.goto('/admin/painel.html');
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

  test('Status "Trial ativo" mostra a contagem de dias restantes (US31/CA06)', async ({ page }) => {
    await entrarNaListaDeTenants(page, [tenantMock({ status_conta: 'Trial ativo', trial_ativo: true, trial_dias_restantes: 7 })]);
    const linha = page.locator('.tabela-tenants tbody tr').first();
    await expect(linha.locator('.badge-status')).toHaveText('Trial ativo (7 dias)');
  });

  test('Status "Não ativado" usa o badge amarelo dedicado (US31/CA06)', async ({ page }) => {
    await entrarNaListaDeTenants(page, [
      tenantMock({ ativado_em: null, status_conta: 'Não ativado', trial_ativo: false, trial_dias_restantes: null }),
    ]);
    const linha = page.locator('.tabela-tenants tbody tr').first();
    await expect(linha.locator('.badge-status')).toHaveText('Não ativado');
    await expect(linha.locator('.badge-status-nao-ativado')).toBeVisible();
  });

  test('Status "Trial expirado" não mostra contagem de dias (US31/CA06)', async ({ page }) => {
    await entrarNaListaDeTenants(page, [
      tenantMock({ status_conta: 'Trial expirado', trial_ativo: false, trial_dias_restantes: -3 }),
    ]);
    const linha = page.locator('.tabela-tenants tbody tr').first();
    await expect(linha.locator('.badge-status')).toHaveText('Trial expirado');
    await expect(linha.locator('.badge-trial-expirado')).toBeVisible();
  });

  test('escapa nome/responsavel/email antes de inserir na tabela (proteção contra XSS)', async ({ page }) => {
    let dialogDisparado = false;
    page.on('dialog', async (dialog) => {
      dialogDisparado = true;
      await dialog.dismiss();
    });

    await entrarNaListaDeTenants(page, [
      tenantMock({
        nome: '<img src=x onerror="window.__xss=true">',
        responsavel: '"><script>window.__xss=true</script>',
        email: 'a"onmouseover="window.__xss=true"@evil.com',
      }),
    ]);

    const linha = page.locator('.tabela-tenants tbody tr').first();
    await expect(linha).toBeVisible();
    // O texto malicioso aparece escapado como texto, nunca executado.
    await expect(linha).toContainText('<img src=x onerror=');
    const xssExecutado = await page.evaluate(() => window.__xss === true);
    expect(xssExecutado).toBe(false);
    expect(dialogDisparado).toBe(false);
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
    await page.goto('/admin/painel.html');

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
    await page.goto('/admin/painel.html');

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
    await page.goto('/admin/painel.html');

    await expect(page.getByText('Página 1 de 2')).toBeVisible();
    await expect(page.locator('#btn-pagina-anterior')).toBeDisabled();

    await page.click('#btn-pagina-proxima');
    await expect(page.getByText('Página 2 de 2')).toBeVisible();
    await expect(page.locator('#btn-pagina-proxima')).toBeDisabled();
    expect(requisicoes.at(-1)).toContain('page=2');
  });
});

test.describe('Admin — busca na listagem de tenants (US27)', () => {
  test('campo de busca com placeholder e ícone de lupa (CA01)', async ({ page }) => {
    await entrarNaListaDeTenants(page, [tenantMock()]);
    const campo = page.locator('#busca-tenants');
    await expect(campo).toHaveAttribute('placeholder', 'Buscar por e-mail ou WhatsApp...');
    await expect(page.locator('.busca-tenants-icone')).toBeVisible();
  });

  test('digitar aciona a busca com debounce e reseta pra página 1 (CA02, CA05)', async ({ page }) => {
    const requisicoes = [];
    await page.route('**/admin/api/tenants*', (route) => {
      requisicoes.push(route.request().url());
      return route.fulfill({ json: { tenants: [tenantMock()], page: 1, limit: 20, total: 1, total_paginas: 1 } });
    });
    await page.addInitScript(() => {
      window.localStorage.setItem('kyvvo_admin_token', 'admin-token-fake');
    });
    await page.goto('/admin/painel.html');

    await page.fill('#busca-tenants', '@gmail');

    await expect.poll(() => requisicoes.at(-1)).toContain('search=%40gmail');
    expect(requisicoes.at(-1)).toContain('page=1');
  });

  test('busca por trecho do WhatsApp envia o termo ao backend (CA03)', async ({ page }) => {
    const requisicoes = [];
    await page.route('**/admin/api/tenants*', (route) => {
      requisicoes.push(route.request().url());
      return route.fulfill({ json: { tenants: [tenantMock()], page: 1, limit: 20, total: 1, total_paginas: 1 } });
    });
    await page.addInitScript(() => {
      window.localStorage.setItem('kyvvo_admin_token', 'admin-token-fake');
    });
    await page.goto('/admin/painel.html');

    await page.fill('#busca-tenants', '3499');
    await expect.poll(() => requisicoes.at(-1)).toContain('search=3499');
  });

  test('contador e estado vazio de busca sem resultados (CA04)', async ({ page }) => {
    await page.route('**/admin/api/tenants*', (route) => {
      const url = new URL(route.request().url());
      const search = url.searchParams.get('search');
      if (search) {
        return route.fulfill({ json: { tenants: [], page: 1, limit: 20, total: 0, total_paginas: 1 } });
      }
      return route.fulfill({ json: { tenants: [tenantMock()], page: 1, limit: 20, total: 1, total_paginas: 1 } });
    });
    await page.addInitScript(() => {
      window.localStorage.setItem('kyvvo_admin_token', 'admin-token-fake');
    });
    await page.goto('/admin/painel.html');

    await page.fill('#busca-tenants', 'inexistente');
    await expect(page.getByText("Nenhum tenant encontrado para 'inexistente'.")).toBeVisible();
  });

  test('botão limpar busca aparece ao digitar e restaura a listagem completa (CA04)', async ({ page }) => {
    const requisicoes = [];
    await page.route('**/admin/api/tenants*', (route) => {
      const url = new URL(route.request().url());
      requisicoes.push(url.toString());
      const search = url.searchParams.get('search');
      if (search) {
        return route.fulfill({ json: { tenants: [], page: 1, limit: 20, total: 0, total_paginas: 1 } });
      }
      return route.fulfill({ json: { tenants: [tenantMock()], page: 1, limit: 20, total: 1, total_paginas: 1 } });
    });
    await page.addInitScript(() => {
      window.localStorage.setItem('kyvvo_admin_token', 'admin-token-fake');
    });
    await page.goto('/admin/painel.html');

    const btnLimpar = page.locator('#btn-limpar-busca');
    await expect(btnLimpar).toBeHidden();

    await page.fill('#busca-tenants', 'termo');
    await expect(btnLimpar).toBeVisible();
    await expect.poll(() => requisicoes.at(-1)).toContain('search=termo');

    await btnLimpar.click();
    await expect(btnLimpar).toBeHidden();
    await expect(page.locator('#busca-tenants')).toHaveValue('');
    await expect.poll(() => requisicoes.at(-1)).not.toContain('search=');
  });
});
