const { test, expect } = require('@playwright/test');

// Cobre US74: bloco "Tudo do X, mais:" com os diferenciais exclusivos e os
// limites de uso (conversas/mês, profissionais, unidades) no card de cada
// plano. API mockada via page.route — sem dependência de Postgres real.

function planoBase(overrides = {}) {
  return {
    slug: 'essencial',
    nome: 'Essencial',
    descricao: 'Bot de agendamento + número próprio',
    tecnologia: 'bot',
    tipo_numero: 'proprio',
    preco_mensal: 79.9,
    limite_disparos: 100,
    destaque: false,
    badge: null,
    herda_de_nome: null,
    features: [
      { label: 'Fluxo guiado por listas e botões', ordem: 1 },
      { label: 'Confirmação automática', ordem: 2 },
    ],
    limites: { conversas_mes: 100, profissionais: 3, unidades: 1 },
    ...overrides,
  };
}

function planoSmart(overrides = {}) {
  return planoBase({
    slug: 'smart',
    nome: 'Smart',
    herda_de_nome: 'Essencial',
    preco_mensal: 149.9,
    features: [
      { label: 'Bot entende linguagem natural', ordem: 1 },
      { label: 'Reagendamento por texto livre', ordem: 2 },
    ],
    limites: { conversas_mes: 500, profissionais: 5, unidades: 1 },
    ...overrides,
  });
}

async function mockPlanos(page, planos) {
  await page.route('**/api/planos', (route) => route.fulfill({ json: planos }));
}

test.describe('Landing — features e limites dos planos (US74)', () => {
  test('CA03 — plano que herda exibe "Tudo do X, mais:" e as features', async ({ page }) => {
    await mockPlanos(page, [planoBase(), planoSmart()]);
    await page.goto('/index.html');

    const card = page.getByTestId('plano-smart');
    await expect(card).toContainText('Tudo do Essencial, mais:');
    await expect(card).toContainText('Bot entende linguagem natural');
  });

  test('CA03 — plano base (sem herda_de) não exibe o rótulo de herança', async ({ page }) => {
    await mockPlanos(page, [planoBase(), planoSmart()]);
    await page.goto('/index.html');

    await expect(page.getByTestId('plano-essencial')).not.toContainText('Tudo do');
  });

  test('CA03 — plano sem features não renderiza o bloco', async ({ page }) => {
    await mockPlanos(page, [planoBase({ features: [] })]);
    await page.goto('/index.html');

    await expect(page.getByTestId('plano-essencial')).toBeVisible();
    await expect(page.getByTestId('bloco-features-essencial')).toHaveCount(0);
  });

  test('CA04 — exibe limites formatados no card', async ({ page }) => {
    await mockPlanos(page, [planoSmart()]);
    await page.goto('/index.html');

    const card = page.getByTestId('plano-smart');
    await expect(card).toContainText('Até 500 conversas/mês');
    await expect(card).toContainText('Até 5 profissionais');
    await expect(card).toContainText('1 unidade');
  });

  test('CA04 — exibe texto de ilimitado quando o limite é nulo', async ({ page }) => {
    await mockPlanos(page, [planoSmart({ limites: { conversas_mes: null, profissionais: 5, unidades: 1 } })]);
    await page.goto('/index.html');

    await expect(page.getByTestId('plano-smart')).toContainText('Conversas ilimitadas');
  });

  test('CA04 — formatarLimite trata singular e plural', async ({ page }) => {
    await mockPlanos(page, [planoBase()]);
    await page.goto('/index.html');

    const resultado = await page.evaluate(() => ({
      singular: window.formatarLimite('unidades', 1),
      plural: window.formatarLimite('unidades', 3),
      ilimitado: window.formatarLimite('unidades', null),
    }));
    expect(resultado.singular).toBe('1 unidade');
    expect(resultado.plural).toBe('Até 3 unidades');
    expect(resultado.ilimitado).toBe('Unidades ilimitadas');
  });
});
