const { test, expect } = require('@playwright/test');

// Cobre US54 — solicitação de recuperação de senha por e-mail: validação de
// campo, resposta genérica da API (CA02) e redirect pra redefinir-senha.html
// já com o e-mail preenchido. APIs mockadas via page.route — sem Postgres real.

test.describe('Esqueci minha senha (/esqueci-senha.html)', () => {
  test('e-mail inválido mostra erro e não chama a API', async ({ page }) => {
    let chamouApi = false;
    await page.route('**/api/auth/esqueci-senha', (route) => {
      chamouApi = true;
      route.fulfill({ json: { ok: true } });
    });

    await page.goto('/esqueci-senha.html');
    await page.fill('#email', 'nao-e-email');
    await page.click('#btn-enviar');

    await expect(page.locator('#erro-email')).toHaveText('Digite um e-mail válido.');
    expect(chamouApi).toBe(false);
  });

  test('e-mail válido envia o pedido e redireciona para redefinir-senha.html com o e-mail (CA02)', async ({ page }) => {
    let payloadEnviado = null;
    await page.route('**/api/auth/esqueci-senha', (route) => {
      payloadEnviado = route.request().postDataJSON();
      return route.fulfill({
        json: { ok: true, message: 'Se este e-mail estiver cadastrado, enviamos um código de recuperação.' },
      });
    });

    await page.goto('/esqueci-senha.html');
    await page.fill('#email', 'ana@salao.com');
    await page.click('#btn-enviar');

    await expect(page.locator('#sucesso')).toContainText('enviamos um código de recuperação');
    expect(payloadEnviado).toMatchObject({ email: 'ana@salao.com' });

    await expect(page).toHaveURL(/\/redefinir-senha\.html\?email=ana%40salao\.com$/);
  });

  test('falha da API exibe a mensagem de erro retornada', async ({ page }) => {
    await page.route('**/api/auth/esqueci-senha', (route) =>
      route.fulfill({ status: 500, json: { error: 'Erro interno. Tente novamente.' } })
    );

    await page.goto('/esqueci-senha.html');
    await page.fill('#email', 'ana@salao.com');
    await page.click('#btn-enviar');

    await expect(page.locator('#erro')).toHaveText('Erro interno. Tente novamente.');
  });
});
