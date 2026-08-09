const { test, expect } = require('@playwright/test');

// Cobre US80.1 — checklist de requisitos da senha no cadastro, visível
// antes mesmo de digitar e atualizada em tempo real conforme cada regra é
// atendida. O bloqueio de envio com requisito pendente já existia via
// SENHA_REGEX (US20/CA02) — coberto em cadastro.spec.js.

const SEGMENTOS_MOCK = { segmentos: [{ id: 1, nome: 'Salão de Beleza' }] };

async function mockSegmentos(page) {
  await page.route('**/api/segmentos', (route) => route.fulfill({ json: SEGMENTOS_MOCK }));
}

test.describe('Cadastro — checklist de requisitos da senha (US80.1)', () => {
  test('exibe os 3 requisitos, todos pendentes, antes de digitar', async ({ page }) => {
    await mockSegmentos(page);
    await page.goto('/cadastro.html');

    await expect(page.locator('#req-tamanho')).toBeVisible();
    await expect(page.locator('#req-maiuscula')).toBeVisible();
    await expect(page.locator('#req-numero')).toBeVisible();
    await expect(page.locator('#req-tamanho')).toHaveAttribute('aria-checked', 'false');
    await expect(page.locator('#req-maiuscula')).toHaveAttribute('aria-checked', 'false');
    await expect(page.locator('#req-numero')).toHaveAttribute('aria-checked', 'false');
  });

  test('marca cada requisito como atendido conforme a senha digitada cumpre a regra', async ({ page }) => {
    await mockSegmentos(page);
    await page.goto('/cadastro.html');

    await page.fill('#senha', 'abc');
    await expect(page.locator('#req-tamanho')).toHaveAttribute('aria-checked', 'false');
    await expect(page.locator('#req-maiuscula')).toHaveAttribute('aria-checked', 'false');
    await expect(page.locator('#req-numero')).toHaveAttribute('aria-checked', 'false');

    await page.fill('#senha', 'abcdefgh');
    await expect(page.locator('#req-tamanho')).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator('#req-maiuscula')).toHaveAttribute('aria-checked', 'false');
    await expect(page.locator('#req-numero')).toHaveAttribute('aria-checked', 'false');

    await page.fill('#senha', 'Abcdefgh');
    await expect(page.locator('#req-maiuscula')).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator('#req-numero')).toHaveAttribute('aria-checked', 'false');

    await page.fill('#senha', 'Abcdefg1');
    await expect(page.locator('#req-tamanho')).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator('#req-maiuscula')).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator('#req-numero')).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator('#req-tamanho')).toHaveClass(/atendido/);
    await expect(page.locator('#req-maiuscula')).toHaveClass(/atendido/);
    await expect(page.locator('#req-numero')).toHaveClass(/atendido/);
  });

  test('desfazer um requisito volta o item pra pendente', async ({ page }) => {
    await mockSegmentos(page);
    await page.goto('/cadastro.html');

    await page.fill('#senha', 'Abcdefg1');
    await expect(page.locator('#req-numero')).toHaveAttribute('aria-checked', 'true');

    await page.fill('#senha', 'Abcdefgh');
    await expect(page.locator('#req-numero')).toHaveAttribute('aria-checked', 'false');
    await expect(page.locator('#req-numero')).not.toHaveClass(/atendido/);
  });
});
