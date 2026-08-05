const { test, expect } = require('@playwright/test');

// Cobre o user menu (avatar + dropdown, PR11): substitui os itens "Meu
// Perfil"/"Fatura"/"Configuração" da sidebar e o botão "Sair" solto por um
// avatar com iniciais + nome do responsável + nome do negócio (truncado em
// 30 caracteres) + seta, que abre um dropdown com Meu Perfil/Minha Empresa/
// Cobrança/Preferências/Ajuda/divisor/Sair. As chamadas de API são mockadas
// via page.route — sem dependência de Postgres real.

async function entrarNoPainel(page, perfil = {}) {
  await page.route('**/api/configuracao', (route) =>
    route.fulfill({ json: { dias_funcionamento: [1, 2, 3, 4, 5, 6], formato_hora: '24h' } })
  );
  await page.route('**/api/agendamentos**', (route) =>
    route.fulfill({ json: { view: 'dia', data: '2026-07-20', agendamentos: [] } })
  );
  await page.route('**/api/perfil', (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    return route.fulfill({ json: { nome_responsavel: 'Ana Souza', nome_segmento: 'Salão da Ana', ...perfil } });
  });
  await page.addInitScript(() => {
    window.localStorage.setItem('kyvvo_token', 'fake-jwt-token');
    window.localStorage.setItem('kyvvo_nome', 'Ana');
  });
  await page.goto('/painel.html');
}

test.describe('User menu — avatar (PR11)', () => {
  test('mostra as iniciais do primeiro e último nome do responsável', async ({ page }) => {
    await entrarNoPainel(page, { nome_responsavel: 'Ana Souza' });
    await expect(page.locator('#user-menu-avatar')).toHaveText('AS');
    await expect(page.locator('#user-menu-nome')).toHaveText('Ana Souza');
  });

  test('nome único usa só a primeira letra', async ({ page }) => {
    await entrarNoPainel(page, { nome_responsavel: 'Madonna' });
    await expect(page.locator('#user-menu-avatar')).toHaveText('M');
  });

  test('nome do negócio aparece abaixo do nome do responsável', async ({ page }) => {
    await entrarNoPainel(page, { nome_segmento: 'Salão da Ana' });
    await expect(page.locator('#user-menu-empresa')).toHaveText('Salão da Ana');
  });

  test('nome do negócio maior que 30 caracteres é truncado', async ({ page }) => {
    await entrarNoPainel(page, { nome_segmento: 'Salão de Beleza e Estética Premium da Ana Souza' });
    const texto = await page.locator('#user-menu-empresa').textContent();
    expect(texto.length).toBeLessThanOrEqual(31); // 30 chars + "…"
    expect(texto.endsWith('…')).toBe(true);
  });
});

test.describe('User menu — dropdown (PR11)', () => {
  test('dropdown começa fechado e abre ao clicar no avatar', async ({ page }) => {
    await entrarNoPainel(page);
    await expect(page.locator('#user-menu-dropdown')).toBeHidden();
    await page.click('#user-menu-toggle');
    await expect(page.locator('#user-menu-dropdown')).toBeVisible();
  });

  test('fecha ao clicar fora', async ({ page }) => {
    await entrarNoPainel(page);
    await page.click('#user-menu-toggle');
    await expect(page.locator('#user-menu-dropdown')).toBeVisible();
    await page.click('#conteudo');
    await expect(page.locator('#user-menu-dropdown')).toBeHidden();
  });

  test('lista Meu Perfil, Minha Empresa, Equipe, WhatsApp, Cobrança, Preferências e Ajuda, com divisor antes do Sair', async ({ page }) => {
    await entrarNoPainel(page);
    await page.click('#user-menu-toggle');
    const itens = await page.locator('.user-menu-item').allTextContents();
    expect(itens).toEqual(['Meu Perfil', 'Minha Empresa', 'Equipe', 'WhatsApp', 'Cobrança', 'Preferências', 'Ajuda']);
    await expect(page.locator('.user-menu-divisor')).toBeVisible();
    await expect(page.locator('#btn-sair')).toContainText('Sair');
  });

  test('"Ajuda" mostra o placeholder "em breve"', async ({ page }) => {
    await entrarNoPainel(page);
    await page.click('#user-menu-toggle');
    await page.click('.user-menu-item[data-menu="ajuda"]');
    await expect(page.locator('#conteudo')).toContainText('Em breve');
  });

  test('"Minha Empresa" abre a tela de dados do negócio (PR12)', async ({ page }) => {
    await entrarNoPainel(page);
    await page.click('#user-menu-toggle');
    await page.click('.user-menu-item[data-menu="empresa"]');
    await expect(page.locator('#form-empresa')).toBeVisible();
    await expect(page.locator('#nome_segmento')).toHaveValue('Salão da Ana');
  });

  test('clicar num item fecha o dropdown e navega pra tela certa', async ({ page }) => {
    await entrarNoPainel(page);
    await page.click('#user-menu-toggle');
    await page.click('.user-menu-item[data-menu="perfil"]');
    await expect(page.locator('#user-menu-dropdown')).toBeHidden();
    await expect(page.locator('#form-perfil')).toBeVisible();
  });
});
