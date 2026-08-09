const { test, expect } = require('@playwright/test');

// Cobre US82.1 — enquanto onboarding_pendente for verdadeiro, login e
// verificação de e-mail redirecionam pro wizard (/onboarding, US82.2) em vez
// do painel. onboarding_pendente=false preserva o comportamento anterior
// (redireciona pro painel), sempre depois da checagem de e-mail validado
// (CA10), que continua tendo prioridade. APIs mockadas via page.route — sem
// dependência de Postgres real.

test.describe('Login redireciona pro onboarding quando pendente (US82.1)', () => {
  test('login com onboarding_pendente=true vai pra /onboarding, não pro painel', async ({ page }) => {
    await page.route('**/api/auth/login', (route) =>
      route.fulfill({ json: { token: 'fake-jwt-token', nome: 'Ana', email: 'ana@kyvvo.com', onboarding_pendente: true } })
    );

    await page.goto('/login.html');
    await page.fill('#email', 'ana@kyvvo.com');
    await page.fill('#senha', 'senha-correta');
    await page.click('#btn-entrar');

    await expect(page).toHaveURL(/\/onboarding$/);
    expect(await page.evaluate(() => localStorage.getItem('kyvvo_onboarding_pendente'))).toBe('true');
  });

  test('login com onboarding_pendente=false continua indo pro painel', async ({ page }) => {
    await page.route('**/api/configuracao', (route) =>
      route.fulfill({ json: { dias_funcionamento: [1, 2, 3, 4, 5, 6], formato_hora: '24h' } })
    );
    await page.route('**/api/agendamentos**', (route) => route.fulfill({ json: { view: 'dia', data: '2026-08-09', agendamentos: [] } }));
    await page.route('**/api/auth/login', (route) =>
      route.fulfill({ json: { token: 'fake-jwt-token', nome: 'Ana', email: 'ana@kyvvo.com', onboarding_pendente: false } })
    );

    await page.goto('/login.html');
    await page.fill('#email', 'ana@kyvvo.com');
    await page.fill('#senha', 'senha-correta');
    await page.click('#btn-entrar');

    await expect(page).toHaveURL(/\/painel\.html$/);
  });

  test('e-mail não validado tem prioridade sobre onboarding_pendente', async ({ page }) => {
    await page.route('**/api/auth/login', (route) =>
      route.fulfill({
        json: {
          token: 'fake-jwt-token',
          nome: 'Ana',
          email: 'ana@kyvvo.com',
          email_verified: false,
          onboarding_pendente: true,
        },
      })
    );

    await page.goto('/login.html');
    await page.fill('#email', 'ana@kyvvo.com');
    await page.fill('#senha', 'senha-correta');
    await page.click('#btn-entrar');

    await expect(page).toHaveURL(/\/verificar\.html$/);
  });

  test('sessão já aberta com onboarding pendente redireciona direto ao carregar /login.html', async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem('kyvvo_token', 'fake-jwt-token');
      window.localStorage.setItem('kyvvo_email_verified', 'true');
      window.localStorage.setItem('kyvvo_onboarding_pendente', 'true');
    });
    await page.goto('/login.html');
    await expect(page).toHaveURL(/\/onboarding$/);
  });
});

test.describe('Verificação de e-mail redireciona pro onboarding quando pendente (US82.1)', () => {
  test('validar o código com onboarding_pendente=true vai pra /onboarding', async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem('kyvvo_token', 'fake-jwt-token');
    });
    await page.route('**/api/tenant/status', (route) =>
      route.fulfill({ json: { email: 'ana@kyvvo.com', email_verified: false } })
    );
    await page.route('**/api/auth/verify-token', (route) =>
      route.fulfill({ json: { ok: true, message: 'ok', onboarding_pendente: true } })
    );

    await page.goto('/verificar.html');
    await page.fill('#token', '123456');
    await page.click('#btn-validar');

    await expect(page).toHaveURL(/\/onboarding$/);
  });

  test('validar o código com onboarding_pendente=false vai pro painel (comportamento anterior)', async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem('kyvvo_token', 'fake-jwt-token');
    });
    await page.route('**/api/tenant/status', (route) =>
      route.fulfill({ json: { email: 'ana@kyvvo.com', email_verified: false } })
    );
    await page.route('**/api/auth/verify-token', (route) =>
      route.fulfill({ json: { ok: true, message: 'ok', onboarding_pendente: false } })
    );

    await page.goto('/verificar.html');
    await page.fill('#token', '123456');
    await page.click('#btn-validar');

    await expect(page).toHaveURL(/\/painel\.html\?verificado=1$/);
  });

  test('acessar já verificado com onboarding_pendente=true redireciona pro onboarding', async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem('kyvvo_token', 'fake-jwt-token');
    });
    await page.route('**/api/tenant/status', (route) =>
      route.fulfill({ json: { email: 'ana@kyvvo.com', email_verified: true, onboarding_pendente: true } })
    );

    await page.goto('/verificar.html');

    await expect(page).toHaveURL(/\/onboarding$/);
  });
});
