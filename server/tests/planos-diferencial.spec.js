const { test, expect } = require('@playwright/test');

// Cobre US73: cada card de plano passa a vender o benefício (headline em
// destaque + frase concreta) em vez do meio técnico. API mockada via
// page.route — sem dependência de Postgres real.

function planosMock(overrides = []) {
  const base = [
    { slug: 'essencial', nome: 'Essencial', descricao: 'Bot de agendamento + número próprio', tecnologia: 'bot', tipo_numero: 'proprio', preco_mensal: 79.9, limite_disparos: 100, destaque: false, badge: null, headline_diferencial: 'Seu número, atendimento guiado', frase_beneficio: 'A cliente escolhe o serviço e o horário por listas e botões.' },
    { slug: 'smart', nome: 'Smart', descricao: 'IA conversacional + número próprio', tecnologia: 'ia', tipo_numero: 'proprio', preco_mensal: 149.9, limite_disparos: 500, destaque: true, badge: 'Mais popular', headline_diferencial: 'Seu número, atendimento que conversa', frase_beneficio: 'A cliente escreve como fala — "quero cortar amanhã de manhã" — e o bot resolve.' },
  ];
  return base.map((p) => ({ ...p, ...(overrides[p.slug] || {}) }));
}

async function mockPlanos(page, planos) {
  await page.route('**/api/planos', (route) => route.fulfill({ json: planos }));
}

test.describe('Landing — copy de diferencial dos planos (US73)', () => {
  test('CA03 — exibe headline em destaque e frase de benefício', async ({ page }) => {
    await mockPlanos(page, planosMock());
    await page.goto('/index.html');

    const card = page.getByTestId('plano-smart');
    await expect(card).toContainText('Seu número, atendimento que conversa');
    await expect(card).toContainText('quero cortar amanhã de manhã');
  });

  test('CA03 — não exibe mais o texto técnico antigo', async ({ page }) => {
    await mockPlanos(page, planosMock());
    await page.goto('/index.html');

    await page.getByTestId('plano-smart').waitFor();
    await expect(page.getByText(/IA conversacional \+ número/i)).toHaveCount(0);
  });

  test('CA03 — frase de benefício vazia não quebra o layout do card', async ({ page }) => {
    await mockPlanos(page, planosMock({ essencial: { frase_beneficio: '' } }));
    await page.goto('/index.html');

    await expect(page.getByTestId('plano-essencial')).toBeVisible();
    await expect(page.getByTestId('frase-beneficio-essencial')).toHaveCount(0);
  });

  test('CA03 — headline vazia não quebra o layout do card', async ({ page }) => {
    await mockPlanos(page, planosMock({ essencial: { headline_diferencial: '' } }));
    await page.goto('/index.html');

    await expect(page.getByTestId('plano-essencial')).toBeVisible();
    await expect(page.getByTestId('headline-essencial')).toHaveCount(0);
  });
});
