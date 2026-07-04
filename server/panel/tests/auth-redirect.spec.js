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

    await page.goto('/login.html');
    await page.fill('#email', 'ana@kyvvo.com');
    await page.fill('#senha', 'senha-errada');
    await page.click('#btn-entrar');

    await expect(page).toHaveURL(/\/login\.html$/);
    await expect(page.locator('#erro')).toHaveText('E-mail ou senha inválidos');
  });
});
