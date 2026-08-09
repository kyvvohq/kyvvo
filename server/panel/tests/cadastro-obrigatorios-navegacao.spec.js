const { test, expect } = require('@playwright/test');

// Cobre US81.2 (labels obrigatórias com indicação visual) e US81.4 (logo
// como link pra home, ordem de tabulação e envio com Enter) no cadastro.

async function preencherCamposValidos(page) {
  await page.fill('#nome_responsavel', 'Ana Souza');
  await page.fill('#whatsapp', '(34) 99999-9999');
  await page.fill('#email', 'ana@salao.com');
  await page.fill('#senha', 'Senha123');
  await page.check('#aceite_termos');
}

test.describe('Cadastro — campos obrigatórios (US81.2)', () => {
  test('os 4 campos essenciais têm required e indicação visual na label', async ({ page }) => {
    await page.goto('/cadastro.html');

    for (const id of ['nome_responsavel', 'whatsapp', 'email', 'senha']) {
      const campo = page.locator('#' + id);
      await expect(campo).toHaveAttribute('required', '');
      await expect(campo).toHaveAttribute('aria-required', 'true');
      const label = page.locator(`label[for="${id}"]`);
      await expect(label).toBeVisible();
      await expect(label.locator('.obrigatorio')).toBeVisible();
    }
  });
});

test.describe('Cadastro — logo, tabulação e envio com Enter (US81.4)', () => {
  test('a logo do topo é um link pra home', async ({ page }) => {
    await page.goto('/cadastro.html');
    const logo = page.locator('a.logo');
    await expect(logo).toHaveAttribute('href', '/');
    await expect(logo).toHaveText('kyvvo');
  });

  test('a ordem de tabulação segue a ordem visual dos campos', async ({ page }) => {
    await page.goto('/cadastro.html');

    await page.locator('#nome_responsavel').focus();
    await expect(page.locator('#nome_responsavel')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.locator('#whatsapp')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.locator('#email')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.locator('#senha')).toBeFocused();
  });

  test('o formulário pode ser enviado com Enter', async ({ page }) => {
    await page.route('**/api/auth/register', (route) =>
      route.fulfill({ status: 201, json: { token: 't', nome: 'Ana', email: 'ana@salao.com', email_verified: false } })
    );
    await page.route('**/api/tenant/status', (route) =>
      route.fulfill({ json: { email: 'ana@salao.com', email_verified: false, status: 'trial' } })
    );

    await page.goto('/cadastro.html');
    await preencherCamposValidos(page);
    await page.locator('#senha').press('Enter');

    await expect(page).toHaveURL(/\/verificar\.html$/);
  });
});
