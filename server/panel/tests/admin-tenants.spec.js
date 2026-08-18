const { test, expect } = require('@playwright/test');

// Cobre US26/US27/US28/US31: listagem de tenants (busca, ordenação,
// paginação, badges de status, filtros e menu "•••" de ações) dentro do
// painel admin. API mockada via page.route — sem dependência de Postgres
// real.

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
    plano: 'professional',
    plano_nome: 'Professional',
    status_conta: 'Trial ativo',
    total_usuarios: 1,
    ...overrides,
  };
}

// Toda renderização da tela de Tenants busca também os cards de
// estatística (/resumo) e o catálogo de planos (pro filtro "Plano ▾") —
// sem mockar os dois, o fetch cairia na rede real (404 no ambiente de
// teste) e a tela nunca terminaria de carregar.
async function mockResumoEPlanos(page, resumo = {}) {
  await page.route('**/admin/api/tenants/resumo', (route) =>
    route.fulfill({ json: { total: 0, ativos: 0, em_trial: 0, inativos: 0, novos_mes: 0, ...resumo } })
  );
  await page.route('**/admin/api/planos', (route) =>
    route.fulfill({ json: { planos: [{ chave: 'professional', nome: 'Professional' }] } })
  );
}

async function entrarNaListaDeTenants(page, tenants = [], meta = {}) {
  await mockResumoEPlanos(page);
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

// Menu "•••" da linha começa fechado (display:none) — precisa abrir antes
// de qualquer ação dentro dele ficar clicável.
async function abrirAcoesDaLinha(page, id) {
  await page.click(`[data-testid="btn-acoes-${id}"]`);
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
    await expect(linha).toContainText('01/07/2026');
    await expect(linha).toContainText('Professional');
    await expect(linha.locator('.badge-status')).toHaveText('Trial ativo');
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

  test('cards de estatística refletem o resumo do backend', async ({ page }) => {
    await entrarNaListaDeTenants(page, [tenantMock()], {});
    await page.route('**/admin/api/tenants/resumo', (route) =>
      route.fulfill({ json: { total: 6, ativos: 2, em_trial: 1, inativos: 3, novos_mes: 2 } })
    );
    await page.reload();

    const cards = page.locator('.financeiro-resumo-card');
    await expect(cards.nth(0)).toContainText('6');
    await expect(cards.nth(0)).toContainText('2 este mês');
    await expect(cards.nth(1)).toContainText('2');
    await expect(cards.nth(2)).toContainText('1');
    await expect(cards.nth(3)).toContainText('3');
  });

  test('ordenação padrão por data de cadastro decrescente (CA03)', async ({ page }) => {
    let urlRecebida = null;
    await mockResumoEPlanos(page);
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
    await mockResumoEPlanos(page);
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
    await mockResumoEPlanos(page);
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

test.describe('Admin — filtros da listagem de tenants', () => {
  test('selecionar um filtro de Status envia o parâmetro certo e reseta pra página 1', async ({ page }) => {
    const requisicoes = [];
    await mockResumoEPlanos(page);
    await page.route('**/admin/api/tenants*', (route) => {
      requisicoes.push(route.request().url());
      return route.fulfill({ json: { tenants: [tenantMock()], page: 1, limit: 20, total: 1, total_paginas: 1 } });
    });
    await page.addInitScript(() => {
      window.localStorage.setItem('kyvvo_admin_token', 'admin-token-fake');
    });
    await page.goto('/admin/painel.html');

    await page.selectOption('#filtro-status', 'trial');
    await expect.poll(() => requisicoes.at(-1)).toContain('status=trial');
    expect(requisicoes.at(-1)).toContain('page=1');
  });

  test('selecionar um filtro de Plano envia o parâmetro certo', async ({ page }) => {
    const requisicoes = [];
    await mockResumoEPlanos(page);
    await page.route('**/admin/api/tenants*', (route) => {
      requisicoes.push(route.request().url());
      return route.fulfill({ json: { tenants: [tenantMock()], page: 1, limit: 20, total: 1, total_paginas: 1 } });
    });
    await page.addInitScript(() => {
      window.localStorage.setItem('kyvvo_admin_token', 'admin-token-fake');
    });
    await page.goto('/admin/painel.html');

    await page.selectOption('#filtro-plano', 'professional');
    await expect.poll(() => requisicoes.at(-1)).toContain('plano=professional');
  });

  test('selecionar um filtro de Modo envia o parâmetro certo', async ({ page }) => {
    const requisicoes = [];
    await mockResumoEPlanos(page);
    await page.route('**/admin/api/tenants*', (route) => {
      requisicoes.push(route.request().url());
      return route.fulfill({ json: { tenants: [tenantMock()], page: 1, limit: 20, total: 1, total_paginas: 1 } });
    });
    await page.addInitScript(() => {
      window.localStorage.setItem('kyvvo_admin_token', 'admin-token-fake');
    });
    await page.goto('/admin/painel.html');

    await page.selectOption('#filtro-modo', 'ia');
    await expect.poll(() => requisicoes.at(-1)).toContain('modo=ia');
  });
});

test.describe('Admin — menu "•••" de ações da listagem de tenants', () => {
  test('abre só um dropdown por vez e fecha ao clicar fora', async ({ page }) => {
    await entrarNaListaDeTenants(page, [tenantMock({ id: 't1' }), tenantMock({ id: 't2', nome: 'PetShop Amigo Fiel' })]);

    await abrirAcoesDaLinha(page, 't1');
    await expect(page.locator('#dropdown-t1')).toHaveClass(/aberto/);

    await abrirAcoesDaLinha(page, 't2');
    await expect(page.locator('#dropdown-t1')).not.toHaveClass(/aberto/);
    await expect(page.locator('#dropdown-t2')).toHaveClass(/aberto/);

    await page.click('body');
    await expect(page.locator('#dropdown-t2')).not.toHaveClass(/aberto/);
  });

  test('"Ver detalhes" abre o painel lateral com informações/assinatura/whatsapp', async ({ page }) => {
    await entrarNaListaDeTenants(page, [tenantMock({ id: 't1' })]);
    await page.route('**/admin/api/tenants/t1/assinatura-resumo', (route) =>
      route.fulfill({
        json: {
          id: 't1',
          nome: 'Salão Kyvvo Teste',
          status_conta: 'Trial ativo',
          trial_dias_restantes: 3,
          responsavel: { nome: 'Ana Ribeiro', email: 'ana@salaokyvvo.com' },
          whatsapp: '11987654321',
          plano_nome: 'Smart',
          valor_plano: 149.9,
          proxima_cobranca: { data: '2026-08-10', valor: 149.9 },
          whatsapp_conectado: true,
          whatsapp_numero: '11987654321',
        },
      })
    );

    await abrirAcoesDaLinha(page, 't1');
    await page.click('[data-tenant-acao="ver-detalhes"][data-id="t1"]');

    const drawer = page.locator('.drawer-painel');
    await expect(drawer).toContainText('Salão Kyvvo Teste');
    await expect(drawer).toContainText('Ana Ribeiro');
    await expect(drawer).toContainText('Smart');
    await expect(drawer).toContainText('Conectado');

    await page.click('#drawer-btn-gerenciar');
    await expect(page).toHaveURL(/\/admin\/tenants\/t1/);
  });

  test('"Editar tenant" abre o modal de edição', async ({ page }) => {
    await entrarNaListaDeTenants(page, [tenantMock({ id: 't1' })]);
    await page.route('**/admin/api/tenants/t1', (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      return route.fulfill({
        json: {
          id: 't1',
          nome: 'Salão Kyvvo Teste',
          segmento: 'salao_beleza',
          ativo: true,
          modulos_ativos: [],
          usuarios: [],
          contagens: { servicos: 0, profissionais: 0 },
        },
      });
    });

    await abrirAcoesDaLinha(page, 't1');
    await page.click('[data-tenant-acao="editar"][data-id="t1"]');
    await expect(page.locator('#tenant-nome')).toHaveValue('Salão Kyvvo Teste');
  });

  test('"Desativar acesso" chama o PATCH correto e atualiza a lista', async ({ page }) => {
    await entrarNaListaDeTenants(page, [tenantMock({ id: 't1' })]);
    let corpoEnviado = null;
    await page.route('**/admin/api/tenants/t1', (route) => {
      if (route.request().method() !== 'PATCH') return route.fallback();
      corpoEnviado = route.request().postDataJSON();
      return route.fulfill({ json: { id: 't1', ativo: false } });
    });

    await abrirAcoesDaLinha(page, 't1');
    await page.click('[data-tenant-acao="alternar"][data-id="t1"]');

    await expect(page.locator('.toast-sucesso')).toHaveText(/desativado com sucesso/);
    expect(corpoEnviado).toMatchObject({ ativo: false });
  });

  test('"Gerenciar assinatura" navega pra Assinaturas já filtrado pelo nome do tenant', async ({ page }) => {
    await entrarNaListaDeTenants(page, [tenantMock({ id: 't1', nome: 'Salão Kyvvo Teste' })]);
    await abrirAcoesDaLinha(page, 't1');
    await page.click('[data-tenant-acao="gerenciar-assinatura"][data-id="t1"]');
    await expect(page).toHaveURL(/\/assinaturas\.html\?busca=Sal%C3%A3o/);
  });

  test('"Excluir tenant" pede confirmação e chama o DELETE (soft delete)', async ({ page }) => {
    await entrarNaListaDeTenants(page, [tenantMock({ id: 't1' })]);
    let metodoChamado = null;
    await page.route('**/admin/api/tenants/t1', (route) => {
      if (route.request().method() !== 'DELETE') return route.fallback();
      metodoChamado = 'DELETE';
      return route.fulfill({ json: { ok: true } });
    });

    await abrirAcoesDaLinha(page, 't1');
    await page.click('[data-tenant-acao="excluir"][data-id="t1"]');
    await expect(page.locator('.modal-card')).toContainText('Excluir tenant');

    await page.click('#btn-confirmar-excluir');
    await expect(page.locator('.toast-sucesso')).toHaveText(/excluído com sucesso/);
    expect(metodoChamado).toBe('DELETE');
  });
});

test.describe('Admin — busca na listagem de tenants (US27)', () => {
  test('campo de busca com placeholder (CA01)', async ({ page }) => {
    await entrarNaListaDeTenants(page, [tenantMock()]);
    const campo = page.locator('#busca-tenants');
    await expect(campo).toHaveAttribute('placeholder', 'Buscar por e-mail ou WhatsApp...');
  });

  test('digitar aciona a busca com debounce e reseta pra página 1 (CA02, CA05)', async ({ page }) => {
    const requisicoes = [];
    await mockResumoEPlanos(page);
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
    await mockResumoEPlanos(page);
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
    await mockResumoEPlanos(page);
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
    await expect(page.getByText('Nenhum tenant encontrado para os filtros aplicados.')).toBeVisible();
  });
});
