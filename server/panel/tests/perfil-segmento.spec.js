const { test, expect } = require('@playwright/test');

// Cobre o segmento de negócio do tenant (salão de beleza, petshop, etc.):
// o label do campo "nome" no Perfil e o texto de "dias de funcionamento" na
// Configuração se adaptam ao segmento, sem mudar nenhum comportamento
// funcional. As chamadas de API são mockadas via page.route — sem
// dependência de Postgres real.

async function entrarNoPainel(page, { segmento = 'salao_beleza', menu = 'perfil' } = {}) {
  await page.route('**/api/perfil', (route) => {
    if (route.request().method() === 'PATCH') return route.fallback();
    return route.fulfill({ json: { nome: 'Negócio Teste', telefone: '', endereco: '', segmento } });
  });
  await page.route('**/api/configuracao', (route) =>
    route.fulfill({
      json: { dias_funcionamento: [1, 2, 3, 4, 5, 6], formato_hora: '24h', horario_abertura: '08:00:00', horario_fechamento: '20:00:00', segmento },
    })
  );
  await page.route('**/api/agendamentos**', (route) =>
    route.fulfill({ json: { view: 'dia', data: '2026-07-09', agendamentos: [] } })
  );
  await page.addInitScript(() => {
    window.localStorage.setItem('kyvvo_token', 'fake-jwt-token');
    window.localStorage.setItem('kyvvo_nome', 'Ana');
  });
  await page.goto('/painel.html');
  await page.click(`.menu-item[data-menu="${menu}"]`);
}

test.describe('Segmento do negócio — Perfil e Configuração', () => {
  test('petshop mostra "Nome do petshop" no Perfil', async ({ page }) => {
    await entrarNoPainel(page, { segmento: 'petshop' });
    await expect(page.locator('label[for="nome"]')).toHaveText('Nome do petshop');
    await expect(page.locator('#segmento')).toHaveValue('petshop');
  });

  test('salão de beleza mostra "Nome do salão" no Perfil', async ({ page }) => {
    await entrarNoPainel(page, { segmento: 'salao_beleza' });
    await expect(page.locator('label[for="nome"]')).toHaveText('Nome do salão');
  });

  test('segmento aparece desabilitado no Perfil — só a Kyvvo pode alterar', async ({ page }) => {
    await entrarNoPainel(page, { segmento: 'salao_beleza' });
    await expect(page.locator('#segmento')).toBeDisabled();
  });

  test('salvar perfil não envia segmento (não editável pelo tenant)', async ({ page }) => {
    await entrarNoPainel(page, { segmento: 'salao_beleza' });
    let corpoEnviado = null;
    await page.route('**/api/perfil', (route) => {
      if (route.request().method() !== 'PATCH') return route.fallback();
      corpoEnviado = route.request().postDataJSON();
      return route.fulfill({ json: { ...corpoEnviado } });
    });

    await page.click('#form-perfil button[type="submit"]');

    await expect(page.locator('#perfil-msg')).toHaveText('Salvo com sucesso!');
    expect(corpoEnviado.segmento).toBeUndefined();
  });

  test('view Configuração usa o segmento no texto de dias de funcionamento (petshop)', async ({ page }) => {
    await entrarNoPainel(page, { segmento: 'petshop', menu: 'configuracao' });
    await expect(page.locator('.perfil-form label').first()).toHaveText(/o petshop funciona/);
  });
});
