const { test, expect } = require('@playwright/test');

// Cobre US16: área administrativa da Kyvvo, completamente separada do login
// dos tenants (autenticação própria, localStorage próprio). As chamadas de
// API são mockadas via page.route — sem dependência de Postgres real.

test.describe('Admin — login (US16)', () => {
  test('redireciona para o painel admin sem tentar usar sessão de tenant', async ({ page }) => {
    await page.addInitScript(() => {
      // Sessão de TENANT aberta no mesmo navegador — não deve interferir.
      window.localStorage.setItem('kyvvo_token', 'token-de-tenant');
    });
    await page.goto('/admin/login.html');
    // Sem kyvvo_admin_token, continua na tela de login do admin (não usa o
    // token de tenant pra nada).
    await expect(page.locator('#form-login')).toBeVisible();
    await expect(page.locator('.admin-badge')).toHaveText(/Área administrativa/);
  });

  test('login bem-sucedido redireciona pro painel admin', async ({ page }) => {
    await page.route('**/admin/api/auth/login', (route) =>
      route.fulfill({ json: { token: 'admin-token-fake', nome: 'Equipe Kyvvo', email: 'equipe@kyvvo.com.br' } })
    );
    await page.route('**/admin/api/tenants', (route) => route.fulfill({ json: { tenants: [] } }));

    await page.goto('/admin/login.html');
    await page.fill('#email', 'equipe@kyvvo.com.br');
    await page.fill('#senha', 'senha-forte');
    await page.click('#btn-entrar');

    await expect(page).toHaveURL(/\/admin\/painel\.html/);
    await expect(page.locator('#admin-nome')).toHaveText('Equipe Kyvvo');
  });

  test('login com credenciais inválidas mostra erro', async ({ page }) => {
    await page.route('**/admin/api/auth/login', (route) =>
      route.fulfill({ status: 401, json: { error: 'E-mail ou senha inválidos' } })
    );
    await page.goto('/admin/login.html');
    await page.fill('#email', 'equipe@kyvvo.com.br');
    await page.fill('#senha', 'errada');
    await page.click('#btn-entrar');

    await expect(page.locator('#erro')).toHaveText(/incorretos/);
    await expect(page).toHaveURL(/\/admin\/login\.html/);
  });
});

test.describe('Admin — CRUD de tenants (US16)', () => {
  async function entrarNoPainelAdmin(page, tenants = []) {
    await page.route('**/admin/api/tenants', (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      return route.fulfill({ json: { tenants } });
    });
    await page.addInitScript(() => {
      window.localStorage.setItem('kyvvo_admin_token', 'admin-token-fake');
      window.localStorage.setItem('kyvvo_admin_nome', 'Equipe Kyvvo');
    });
    await page.goto('/admin/painel.html');
  }

  test('lista os tenants cadastrados', async ({ page }) => {
    await entrarNoPainelAdmin(page, [
      { id: 't1', nome: 'Salão Kyvvo Teste', segmento: 'salao_beleza', ativo: true, total_usuarios: 1 },
      { id: 't2', nome: 'PetShop Amigo Fiel', segmento: 'petshop', ativo: true, total_usuarios: 1 },
    ]);
    await expect(page.locator('.agendamento-item')).toHaveCount(2);
    await expect(page.locator('.agendamento-item').first()).toContainText('Salão Kyvvo Teste');
  });

  test('tenant desativado mostra o selo "Desativado"', async ({ page }) => {
    await entrarNoPainelAdmin(page, [
      { id: 't1', nome: 'Cliente Antigo', segmento: 'outro', ativo: false, total_usuarios: 1 },
    ]);
    await expect(page.locator('.agendamento-item')).toContainText('Desativado');
  });

  test('cria um tenant novo, sem usuário de login junto', async ({ page }) => {
    await entrarNoPainelAdmin(page, []);
    let corpoEnviado = null;
    await page.route('**/admin/api/tenants', (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      corpoEnviado = route.request().postDataJSON();
      return route.fulfill({ status: 201, json: { id: 'novo', ...corpoEnviado } });
    });

    await page.click('#btn-novo-tenant');
    await page.fill('#tenant-nome', 'Clínica Bem Estar');
    await page.selectOption('#tenant-segmento', 'fisioterapia');
    await page.click('#btn-salvar-tenant');

    await expect(page.locator('.toast-sucesso')).toHaveText(/criado com sucesso/);
    expect(corpoEnviado).toMatchObject({ nome: 'Clínica Bem Estar', segmento: 'fisioterapia' });
    expect(corpoEnviado.usuario).toBeUndefined();
  });

  test('cria um tenant novo com usuário de login junto', async ({ page }) => {
    await entrarNoPainelAdmin(page, []);
    let corpoEnviado = null;
    await page.route('**/admin/api/tenants', (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      corpoEnviado = route.request().postDataJSON();
      return route.fulfill({ status: 201, json: { id: 'novo', ...corpoEnviado } });
    });

    await page.click('#btn-novo-tenant');
    await page.fill('#tenant-nome', 'Studio Pilates Vida');
    await page.selectOption('#tenant-segmento', 'pilates');
    await page.check('#tenant-criar-usuario');
    await page.fill('#tenant-usuario-email', 'dona@studiopilates.com');
    await page.fill('#tenant-usuario-senha', 'SenhaForte123');
    await page.click('#btn-salvar-tenant');

    await expect(page.locator('.toast-sucesso')).toHaveText(/criado com sucesso/);
    expect(corpoEnviado.usuario).toMatchObject({ email: 'dona@studiopilates.com', senha: 'SenhaForte123' });
  });

  test('editar mostra módulos ativos, usuários e contagens do tenant', async ({ page }) => {
    await entrarNoPainelAdmin(page, [
      { id: 't1', nome: 'Salão Kyvvo Teste', segmento: 'salao_beleza', ativo: true, total_usuarios: 1 },
    ]);
    await page.route('**/admin/api/tenants/t1', (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      return route.fulfill({
        json: {
          id: 't1',
          nome: 'Salão Kyvvo Teste',
          segmento: 'salao_beleza',
          telefone: '5511999999999',
          endereco: 'Rua Exemplo, 123',
          ativo: true,
          modulos_ativos: [{ key: 'agenda_inteligente', nome: 'Agenda Inteligente' }],
          usuarios: [{ id: 'u1', email: 'ana@salaokyvvo.com', nome: 'Ana' }],
          contagens: { servicos: 3, profissionais: 2 },
        },
      });
    });

    await page.click('[data-tenant-toggle="t1"]');
    await page.click('[data-tenant-acao="editar"]');

    await expect(page.locator('.modal-texto')).toContainText('Agenda Inteligente');
    await expect(page.locator('.modal-texto')).toContainText('ana@salaokyvvo.com');
    await expect(page.locator('.modal-texto')).toContainText('3');
    await expect(page.locator('#tenant-nome')).toHaveValue('Salão Kyvvo Teste');
  });

  test('desativar um tenant chama o PATCH correto e atualiza a lista', async ({ page }) => {
    await entrarNoPainelAdmin(page, [
      { id: 't1', nome: 'Salão Kyvvo Teste', segmento: 'salao_beleza', ativo: true, total_usuarios: 1 },
    ]);
    let corpoEnviado = null;
    await page.route('**/admin/api/tenants/t1', (route) => {
      if (route.request().method() !== 'PATCH') return route.fallback();
      corpoEnviado = route.request().postDataJSON();
      return route.fulfill({ json: { id: 't1', ativo: false } });
    });

    await page.click('[data-tenant-toggle="t1"]');
    await page.click('[data-tenant-acao="alternar"]');

    await expect(page.locator('.toast-sucesso')).toHaveText(/desativado com sucesso/);
    expect(corpoEnviado).toMatchObject({ ativo: false });
  });

  test('nome em branco fica destacado como obrigatório', async ({ page }) => {
    await entrarNoPainelAdmin(page, []);
    await page.click('#btn-novo-tenant');
    await page.click('#btn-salvar-tenant');
    await expect(page.locator('#tenant-nome')).toHaveClass(/campo-invalido/);
  });
});
