const { test, expect } = require('@playwright/test');

// Cobre ST07.4 (US07): redirecionamento pós-login para o dashboard e
// redirecionamento de usuário não autenticado tentando acessar rota protegida.
// As chamadas de API são mockadas via page.route — sem dependência de Postgres real.

async function mockDashboardApis(page) {
  await page.route('**/api/configuracao', (route) =>
    route.fulfill({ json: { dias_funcionamento: [1, 2, 3, 4, 5, 6], formato_hora: '24h' } })
  );
  await page.route('**/api/agendamentos**', (route) =>
    route.fulfill({ json: { view: 'dia', data: '2026-07-04', agendamentos: [] } })
  );
}

test.describe('Guarda de rota protegida (/painel.html)', () => {
  test('usuário não autenticado acessando o painel é redirecionado para /login.html', async ({ page }) => {
    await page.goto('/painel.html');
    await expect(page).toHaveURL(/\/login\.html$/);
  });

  test('usuário autenticado acessando o painel permanece nele', async ({ page }) => {
    await mockDashboardApis(page);
    await page.addInitScript(() => {
      window.localStorage.setItem('kyvvo_token', 'fake-jwt-token');
      window.localStorage.setItem('kyvvo_nome', 'Ana');
    });
    await page.goto('/painel.html');
    await expect(page).toHaveURL(/\/painel\.html$/);
    await expect(page.locator('#saudacao')).toContainText('Ana');
  });
});

test.describe('Redirecionamento raiz (/)', () => {
  test('sem sessão, / redireciona para /login.html', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/login\.html$/);
  });

  test('com sessão, / redireciona para /painel.html', async ({ page }) => {
    await mockDashboardApis(page);
    await page.addInitScript(() => {
      window.localStorage.setItem('kyvvo_token', 'fake-jwt-token');
    });
    await page.goto('/');
    await expect(page).toHaveURL(/\/painel\.html$/);
  });
});

test.describe('Logout (/painel.html) — ST07.5', () => {
  test('clicar em Sair chama /api/auth/logout, limpa a sessão local e redireciona para kyvvo.com.br', async ({ page }) => {
    await mockDashboardApis(page);
    let logoutChamado = false;
    await page.route('**/api/auth/logout', (route) => {
      logoutChamado = true;
      route.fulfill({ json: { ok: true } });
    });
    // Intercepta a navegação pro domínio de marketing (fora do servidor de
    // teste) — evita bater na rede de verdade. O localStorage é checado via
    // context.storageState() (lê o storage do navegador diretamente, sem
    // precisar de um contexto JS vivo numa página) em vez de page.evaluate()
    // — evaluate trava em deadlock se chamado de dentro do handler da rota
    // que a própria navegação em andamento está esperando resolver.
    await page.route('https://kyvvo.com.br/**', (route) =>
      route.fulfill({ body: '<html></html>', contentType: 'text/html' })
    );
    await page.addInitScript(() => {
      if (location.pathname.endsWith('/painel.html')) {
        window.localStorage.setItem('kyvvo_token', 'fake-jwt-token');
        window.localStorage.setItem('kyvvo_nome', 'Ana');
      }
    });

    await page.goto('/painel.html');
    await page.click('#btn-sair');
    await page.waitForURL('https://kyvvo.com.br/');

    expect(logoutChamado).toBe(true);
    const estado = await page.context().storageState();
    const origemPainel = estado.origins.find((o) => o.origin === 'http://127.0.0.1:4173');
    expect(origemPainel?.localStorage.find((kv) => kv.name === 'kyvvo_token')).toBeUndefined();
  });

  test('logout limpa a sessão e redireciona mesmo se a chamada ao servidor falhar', async ({ page }) => {
    await mockDashboardApis(page);
    await page.route('**/api/auth/logout', (route) => route.abort());
    await page.route('https://kyvvo.com.br/**', (route) =>
      route.fulfill({ body: '<html></html>', contentType: 'text/html' })
    );
    await page.addInitScript(() => {
      if (location.pathname.endsWith('/painel.html')) {
        window.localStorage.setItem('kyvvo_token', 'fake-jwt-token');
      }
    });

    await page.goto('/painel.html');
    await page.click('#btn-sair');
    await page.waitForURL('https://kyvvo.com.br/');

    const estado = await page.context().storageState();
    const origemPainel = estado.origins.find((o) => o.origin === 'http://127.0.0.1:4173');
    expect(origemPainel?.localStorage.find((kv) => kv.name === 'kyvvo_token')).toBeUndefined();
  });
});

test.describe('Login (/login.html)', () => {
  test('login bem-sucedido redireciona para o dashboard (/painel.html)', async ({ page }) => {
    await mockDashboardApis(page);
    await page.route('**/api/auth/login', (route) =>
      route.fulfill({ json: { token: 'fake-jwt-token', nome: 'Ana', email: 'ana@kyvvo.com' } })
    );

    await page.goto('/login.html');
    await page.fill('#email', 'ana@kyvvo.com');
    await page.fill('#senha', 'senha-correta');
    await page.click('#btn-entrar');

    await expect(page).toHaveURL(/\/painel\.html$/);
  });

  test('login com credenciais inválidas não redireciona e exibe erro', async ({ page }) => {
    await page.route('**/api/auth/login', (route) =>
      route.fulfill({ status: 401, json: { error: 'E-mail ou senha inválidos' } })
    );
    // O formulário agora tenta login de admin como fallback quando o de
    // tenant falha (login único) — precisa rejeitar os dois pra cair no erro.
    await page.route('**/admin/api/auth/login', (route) =>
      route.fulfill({ status: 401, json: { error: 'E-mail ou senha inválidos' } })
    );

    await page.goto('/login.html');
    await page.fill('#email', 'ana@kyvvo.com');
    await page.fill('#senha', 'senha-errada');
    await page.click('#btn-entrar');

    await expect(page).toHaveURL(/\/login\.html$/);
    // CA03 exige a mensagem fixa abaixo independentemente do texto de erro
    // retornado pela API — era isso que a tela já fazia; o teste antigo
    // esperava o texto cru da API e por isso estava sempre falhando.
    await expect(page.locator('#erro')).toHaveText('E-mail ou senha incorretos. Tente novamente.');
  });

  test('login com e-mail de admin (login único) redireciona para o painel administrativo', async ({ page }) => {
    await page.route('**/api/auth/login', (route) =>
      route.fulfill({ status: 401, json: { error: 'E-mail ou senha inválidos' } })
    );
    await page.route('**/admin/api/auth/login', (route) =>
      route.fulfill({ json: { token: 'fake-admin-jwt', nome: 'Admin Kyvvo', email: 'admin@kyvvo.com.br' } })
    );
    await page.route('**/admin/api/tenants', (route) => route.fulfill({ json: { tenants: [] } }));

    await page.goto('/login.html');
    await page.fill('#email', 'admin@kyvvo.com.br');
    await page.fill('#senha', 'senha-admin');
    await page.click('#btn-entrar');

    await expect(page).toHaveURL(/\/admin\/painel\.html$/);
    expect(await page.evaluate(() => window.localStorage.getItem('kyvvo_admin_token'))).toBe('fake-admin-jwt');
  });
});
