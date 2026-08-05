const { test, expect } = require('@playwright/test');

// Cobre US54 — confirmação do código e definição da nova senha: validação de
// campos, pré-preenchimento do e-mail via querystring, mensagens de erro
// específicas por motivo (código incorreto/expirado/bloqueado) e redirect
// pro login após sucesso. APIs mockadas via page.route — sem Postgres real.

test.describe('Redefinir senha (/redefinir-senha.html)', () => {
  test('pré-preenche o e-mail a partir da querystring', async ({ page }) => {
    await page.goto('/redefinir-senha.html?email=ana%40salao.com');
    await expect(page.locator('#email')).toHaveValue('ana@salao.com');
  });

  test('validação onBlur exibe as mensagens de erro corretas', async ({ page }) => {
    await page.goto('/redefinir-senha.html');

    await page.fill('#email', 'nao-e-email');
    await page.locator('#email').blur();
    await expect(page.locator('#erro-email')).toHaveText('Digite um e-mail válido.');

    await page.fill('#token', '123');
    await page.locator('#token').blur();
    await expect(page.locator('#erro-token')).toHaveText('Digite o código de 6 dígitos.');

    await page.fill('#senha', 'fraca');
    await page.locator('#senha').blur();
    await expect(page.locator('#erro-senha')).toHaveText(
      'Mínimo 8 caracteres, 1 número e 1 letra maiúscula.'
    );
  });

  test('campo do código só aceita dígitos', async ({ page }) => {
    await page.goto('/redefinir-senha.html');
    await page.fill('#token', 'a1b2');
    await expect(page.locator('#token')).toHaveValue('12');
  });

  test('campo do código é limitado a 6 caracteres (maxlength)', async ({ page }) => {
    await page.goto('/redefinir-senha.html');
    await page.fill('#token', '1234567890');
    await expect(page.locator('#token')).toHaveValue('123456');
  });

  test('submeter formulário inválido não chama a API', async ({ page }) => {
    let chamouApi = false;
    await page.route('**/api/auth/redefinir-senha', (route) => {
      chamouApi = true;
      route.fulfill({ json: { ok: true } });
    });

    await page.goto('/redefinir-senha.html');
    await page.click('#btn-redefinir');

    await expect(page.locator('#erro-email')).toHaveText('Digite um e-mail válido.');
    expect(chamouApi).toBe(false);
  });

  test('código e senha válidos redefinem a senha e redirecionam para o login', async ({ page }) => {
    let payloadEnviado = null;
    await page.route('**/api/auth/redefinir-senha', (route) => {
      payloadEnviado = route.request().postDataJSON();
      return route.fulfill({
        json: { ok: true, message: 'Senha redefinida com sucesso. Faça login com a nova senha.' },
      });
    });

    await page.goto('/redefinir-senha.html?email=ana%40salao.com');
    await page.fill('#token', '123456');
    await page.fill('#senha', 'NovaSenha1');
    await page.click('#btn-redefinir');

    await expect(page).toHaveURL(/\/login\.html\?senha_redefinida=1$/);
    expect(payloadEnviado).toMatchObject({ email: 'ana@salao.com', token: '123456', senha: 'NovaSenha1' });
  });

  test('código incorreto exibe a mensagem de erro da API e permanece na página', async ({ page }) => {
    await page.route('**/api/auth/redefinir-senha', (route) =>
      route.fulfill({ status: 400, json: { error: 'Código incorreto. Tente novamente.' } })
    );

    await page.goto('/redefinir-senha.html?email=ana%40salao.com');
    await page.fill('#token', '000000');
    await page.fill('#senha', 'NovaSenha1');
    await page.click('#btn-redefinir');

    await expect(page).toHaveURL(/\/redefinir-senha\.html/);
    await expect(page.locator('#erro')).toHaveText('Código incorreto. Tente novamente.');
  });
});
