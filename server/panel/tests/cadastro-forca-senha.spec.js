const { test, expect } = require('@playwright/test');

// Cobre US80.2 — indicador de força da senha e alternância de
// visibilidade com rótulo acessível — e US80.5 — microcopy do CTA
// ("Criar minha conta") e do aviso de trial, no cadastro.

const SEGMENTOS_MOCK = { segmentos: [{ id: 1, nome: 'Salão de Beleza' }] };

async function mockSegmentos(page) {
  await page.route('**/api/segmentos', (route) => route.fulfill({ json: SEGMENTOS_MOCK }));
}

test.describe('Cadastro — força da senha e alternar visibilidade (US80.2)', () => {
  test('não mostra o indicador antes de digitar e classifica a força conforme a senha muda', async ({ page }) => {
    await mockSegmentos(page);
    await page.goto('/cadastro.html');

    await expect(page.locator('#forca-senha')).toBeHidden();

    await page.fill('#senha', 'abc12345');
    await expect(page.locator('#forca-senha')).toBeVisible();
    await expect(page.locator('#forca-senha')).toHaveText(/média/i);

    await page.fill('#senha', 'Salao#2026Kyvvo');
    await expect(page.locator('#forca-senha')).toHaveText(/forte/i);

    await page.fill('#senha', 'abc');
    await expect(page.locator('#forca-senha')).toHaveText(/fraca/i);

    await page.fill('#senha', '');
    await expect(page.locator('#forca-senha')).toBeHidden();
  });

  test('alterna a visibilidade da senha com rótulo acessível', async ({ page }) => {
    await mockSegmentos(page);
    await page.goto('/cadastro.html');

    const senha = page.locator('#senha');
    const botao = page.getByRole('button', { name: /mostrar senha/i });

    await expect(senha).toHaveAttribute('type', 'password');
    await botao.click();
    await expect(senha).toHaveAttribute('type', 'text');
    await expect(page.getByRole('button', { name: /ocultar senha/i })).toBeVisible();

    await page.getByRole('button', { name: /ocultar senha/i }).click();
    await expect(senha).toHaveAttribute('type', 'password');
    await expect(page.getByRole('button', { name: /mostrar senha/i })).toBeVisible();
  });
});

test.describe('Cadastro — microcopy do CTA e do trial (US80.5)', () => {
  test('botão de envio e aviso de trial usam o texto atualizado', async ({ page }) => {
    await mockSegmentos(page);
    await page.goto('/cadastro.html');

    await expect(page.locator('#btn-criar')).toHaveText('Criar minha conta');
    await expect(page.locator('.cadastro-sub')).toHaveText('14 dias grátis. Avisamos antes de qualquer cobrança.');
  });
});
