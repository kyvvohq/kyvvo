const { test, expect } = require('@playwright/test');

// Cobre US20/ST20.4 — tela de validação do token: guarda de sessão, validação
// do código de 6 dígitos (CA08), erros e cooldown do reenvio (CA07/CA11). APIs
// mockadas via page.route — sem Postgres real.

function semearSessao(page) {
  return page.addInitScript(() => {
    if (location.pathname.endsWith('/verificar.html')) {
      window.localStorage.setItem('kyvvo_token', 'jwt-novo');
      window.localStorage.setItem('kyvvo_email', 'ana@salao.com');
    }
  });
}

test.describe('Validação de token (/verificar.html)', () => {
  test('sem sessão redireciona para /login.html', async ({ page }) => {
    await page.goto('/verificar.html');
    await expect(page).toHaveURL(/\/login\.html$/);
  });

  test('exibe o e-mail mascarado e mantém "Reenviar" desabilitado no início (CA07)', async ({ page }) => {
    await semearSessao(page);
    await page.route('**/api/tenant/status', (route) =>
      route.fulfill({ json: { email: 'ana@salao.com', email_verified: false, status: 'trial' } })
    );

    await page.goto('/verificar.html');
    await expect(page.locator('#instrucao')).toContainText('an*@salao.com');
    await expect(page.locator('#link-reenviar')).toHaveClass(/link-desabilitado/);
  });

  test('token correto valida e redireciona para o painel com flag de sucesso (CA08)', async ({ page }) => {
    await semearSessao(page);
    await page.route('**/api/tenant/status', (route) =>
      route.fulfill({ json: { email: 'ana@salao.com', email_verified: false, status: 'trial' } })
    );
    await page.route('**/api/auth/verify-token', (route) =>
      route.fulfill({ json: { ok: true, message: 'E-mail verificado! Seu trial de 14 dias está ativo.' } })
    );

    await page.goto('/verificar.html');
    await page.fill('#token', '123456');
    await page.click('#btn-validar');

    await expect(page).toHaveURL(/\/painel\.html\?verificado=1$/);
  });

  test('token incorreto exibe a mensagem de erro da API (CA08)', async ({ page }) => {
    await semearSessao(page);
    await page.route('**/api/tenant/status', (route) =>
      route.fulfill({ json: { email: 'ana@salao.com', email_verified: false, status: 'trial' } })
    );
    await page.route('**/api/auth/verify-token', (route) =>
      route.fulfill({ status: 400, json: { error: 'Código incorreto. Tente novamente.' } })
    );

    await page.goto('/verificar.html');
    await page.fill('#token', '000000');
    await page.click('#btn-validar');

    await expect(page).toHaveURL(/\/verificar\.html$/);
    await expect(page.locator('#erro')).toHaveText('Código incorreto. Tente novamente.');
  });
});
