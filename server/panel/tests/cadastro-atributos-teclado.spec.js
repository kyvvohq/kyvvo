const { test, expect } = require('@playwright/test');

// Cobre US81.1 — type/inputmode/autocomplete corretos em cada campo do
// cadastro, pra abrir o teclado certo no celular e permitir preenchimento
// automático do navegador/gerenciador de senhas.

test.describe('Cadastro — type/inputmode/autocomplete dos campos (US81.1)', () => {
  test('nome do responsável usa type text e autocomplete name', async ({ page }) => {
    await page.goto('/cadastro.html');
    const campo = page.locator('#nome_responsavel');
    await expect(campo).toHaveAttribute('type', 'text');
    await expect(campo).toHaveAttribute('autocomplete', 'name');
  });

  test('e-mail usa type email e autocomplete email', async ({ page }) => {
    await page.goto('/cadastro.html');
    const campo = page.locator('#email');
    await expect(campo).toHaveAttribute('type', 'email');
    await expect(campo).toHaveAttribute('autocomplete', 'email');
  });

  test('telefone e whatsapp usam type tel, inputmode numeric e autocomplete tel', async ({ page }) => {
    await page.goto('/cadastro.html');
    for (const id of ['#telefone', '#whatsapp']) {
      const campo = page.locator(id);
      await expect(campo).toHaveAttribute('type', 'tel');
      await expect(campo).toHaveAttribute('inputmode', 'numeric');
      await expect(campo).toHaveAttribute('autocomplete', 'tel');
    }
  });

  test('senha usa type password e autocomplete new-password', async ({ page }) => {
    await page.goto('/cadastro.html');
    const campo = page.locator('#senha');
    await expect(campo).toHaveAttribute('type', 'password');
    await expect(campo).toHaveAttribute('autocomplete', 'new-password');
  });
});
