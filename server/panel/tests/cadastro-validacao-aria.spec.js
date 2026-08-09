const { test, expect } = require('@playwright/test');

// Cobre US80.3 — validação inline por campo com aria-invalid/aria-describedby
// associando cada input à sua mensagem de erro pra leitores de tela. O
// comportamento de exibir/limpar o erro no blur já existia (US20/CA02) —
// aqui só a semântica de acessibilidade é nova.

const SEGMENTOS_MOCK = { segmentos: [{ id: 1, nome: 'Salão de Beleza' }] };

async function mockSegmentos(page) {
  await page.route('**/api/segmentos', (route) => route.fulfill({ json: SEGMENTOS_MOCK }));
}

test.describe('Cadastro — validação inline com aria (US80.3)', () => {
  test('cada campo começa com aria-invalid=false e aponta pra sua mensagem via aria-describedby', async ({ page }) => {
    await mockSegmentos(page);
    await page.goto('/cadastro.html');

    // US77 removeu Segmento do cadastro; Telefone só existe (oculto) atrás
    // do checkbox "Uso outro número para ligações", mas o atributo aria já
    // é aplicado no elemento independente de visibilidade.
    for (const campo of ['nome_responsavel', 'email', 'telefone', 'whatsapp']) {
      await expect(page.locator('#' + campo)).toHaveAttribute('aria-invalid', 'false');
      await expect(page.locator('#' + campo)).toHaveAttribute('aria-describedby', 'erro-' + campo);
    }
    // US80.1 — senha também referencia o checklist de requisitos, além da
    // mensagem de erro (aria-describedby aceita múltiplos IDs).
    await expect(page.locator('#senha')).toHaveAttribute('aria-invalid', 'false');
    await expect(page.locator('#senha')).toHaveAttribute('aria-describedby', 'senha-requisitos erro-senha');
  });

  test('erro no blur marca aria-invalid=true no campo correspondente', async ({ page }) => {
    await mockSegmentos(page);
    await page.goto('/cadastro.html');

    await page.fill('#email', 'nao-e-email');
    await page.locator('#email').blur();

    await expect(page.locator('#email')).toHaveAttribute('aria-invalid', 'true');
    await expect(page.locator('#erro-email')).toHaveText('Digite um e-mail válido.');
  });

  test('corrigir o campo limpa a mensagem e volta aria-invalid=false', async ({ page }) => {
    await mockSegmentos(page);
    await page.goto('/cadastro.html');

    await page.fill('#email', 'nao-e-email');
    await page.locator('#email').blur();
    await expect(page.locator('#email')).toHaveAttribute('aria-invalid', 'true');

    await page.fill('#email', 'ana@salao.com');
    await expect(page.locator('#email')).toHaveAttribute('aria-invalid', 'false');
    await expect(page.locator('#erro-email')).toHaveText('');
  });
});
