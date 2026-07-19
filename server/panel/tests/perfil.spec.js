const { test, expect } = require('@playwright/test');

// Cobre US33/PR12: edição de Meu Perfil (só dados pessoais) no portal —
// Nome do Responsável, Telefone + checkbox "é WhatsApp" e o campo somente
// leitura (E-mail). Nome do negócio/Endereço saíram pra "Minha Empresa" (ver
// minha-empresa.spec.js) — as duas telas salvam via PATCH /api/perfil, cada
// uma enviando só o grupo de campo que lhe cabe. As chamadas de API são
// mockadas via page.route — sem dependência de Postgres real.

const PERFIL_BASE = {
  nome_responsavel: 'Ana Souza',
  email: 'ana@exemplo.com',
  nome_segmento: 'Salão da Ana',
  segmento: 'salao_beleza',
  telefone: '34999998888',
  whatsapp: '34988887777',
};

async function entrarNoPainel(page, perfil = PERFIL_BASE) {
  await page.route('**/api/configuracao', (route) =>
    route.fulfill({ json: { dias_funcionamento: [1, 2, 3, 4, 5, 6], formato_hora: '24h', segmento: 'salao_beleza' } })
  );
  await page.route('**/api/agendamentos**', (route) =>
    route.fulfill({ json: { view: 'dia', data: '2026-07-09', agendamentos: [] } })
  );
  await page.route('**/api/perfil', (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    return route.fulfill({ json: perfil });
  });
  await page.addInitScript(() => {
    window.localStorage.setItem('kyvvo_token', 'fake-jwt-token');
    window.localStorage.setItem('kyvvo_nome', 'Ana');
  });
  await page.goto('/painel.html');
  await page.click('#user-menu-toggle');
  await page.click('.user-menu-item[data-menu="perfil"]');
}

test.describe('Meu Perfil (US33/PR12)', () => {
  test('pré-preenche o formulário com os dados atuais', async ({ page }) => {
    await entrarNoPainel(page);
    await expect(page.locator('#nome_responsavel')).toHaveValue('Ana Souza');
    await expect(page.locator('#telefone')).toHaveValue('(34) 99999-8888');
  });

  test('não mostra mais os campos de negócio (Nome do Segmento/Endereço, agora em Minha Empresa)', async ({ page }) => {
    await entrarNoPainel(page);
    await expect(page.locator('#nome_segmento')).toHaveCount(0);
    await expect(page.locator('#endereco-cep')).toHaveCount(0);
  });

  test('E-mail aparece como somente leitura (CA05)', async ({ page }) => {
    await entrarNoPainel(page);
    await expect(page.locator('input[value="ana@exemplo.com"]')).toBeDisabled();
  });

  test('campos obrigatórios mostram asterisco vermelho', async ({ page }) => {
    await entrarNoPainel(page);
    await expect(page.locator('label[for="nome_responsavel"] .obrigatorio')).toHaveText('*');
    await expect(page.locator('label[for="telefone"] .obrigatorio')).toHaveText('*');
  });

  test('checkbox "é WhatsApp" vem marcado quando telefone e whatsapp já são o mesmo número', async ({ page }) => {
    await entrarNoPainel(page, { ...PERFIL_BASE, whatsapp: PERFIL_BASE.telefone });
    await expect(page.locator('#telefone-e-whatsapp')).toBeChecked();
  });

  test('checkbox "é WhatsApp" vem desmarcado quando são números diferentes', async ({ page }) => {
    await entrarNoPainel(page);
    await expect(page.locator('#telefone-e-whatsapp')).not.toBeChecked();
  });

  test('campos obrigatórios em branco ficam destacados com mensagem específica (CA03)', async ({ page }) => {
    await entrarNoPainel(page, { ...PERFIL_BASE, nome_responsavel: '', telefone: '' });
    await page.click('#btn-salvar-perfil');
    await expect(page.locator('#erro-nome_responsavel')).toHaveText('Informe o nome do responsável.');
    await expect(page.locator('#erro-telefone')).toHaveText('Informe um telefone válido com DDD.');
    await expect(page.locator('#nome_responsavel')).toHaveClass(/invalid/);
  });

  test('salva as alterações com sucesso, sem mandar campos de empresa no payload (CA06)', async ({ page }) => {
    await entrarNoPainel(page);
    let corpoEnviado = null;
    await page.route('**/api/perfil', (route) => {
      if (route.request().method() !== 'PATCH') return route.fallback();
      corpoEnviado = route.request().postDataJSON();
      return route.fulfill({ json: { ...PERFIL_BASE, nome_responsavel: 'Ana Souza Silva' } });
    });

    await page.fill('#nome_responsavel', 'Ana Souza Silva');
    await page.click('#btn-salvar-perfil');

    await expect(page.locator('.toast-sucesso')).toHaveText(/Perfil atualizado com sucesso/);
    expect(corpoEnviado).toMatchObject({ nome_responsavel: 'Ana Souza Silva', telefone_e_whatsapp: false });
    expect(corpoEnviado).not.toHaveProperty('nome_segmento');
    expect(corpoEnviado).not.toHaveProperty('endereco');
  });

  test('marcar "é WhatsApp" envia telefone_e_whatsapp: true', async ({ page }) => {
    await entrarNoPainel(page);
    let corpoEnviado = null;
    await page.route('**/api/perfil', (route) => {
      if (route.request().method() !== 'PATCH') return route.fallback();
      corpoEnviado = route.request().postDataJSON();
      return route.fulfill({ json: PERFIL_BASE });
    });

    await page.check('#telefone-e-whatsapp');
    await page.click('#btn-salvar-perfil');

    await expect(page.locator('.toast-sucesso')).toHaveText(/Perfil atualizado com sucesso/);
    expect(corpoEnviado).toMatchObject({ telefone_e_whatsapp: true });
  });

  test('conflito de WhatsApp já cadastrado mostra o erro do backend', async ({ page }) => {
    await entrarNoPainel(page);
    await page.route('**/api/perfil', (route) => {
      if (route.request().method() !== 'PATCH') return route.fallback();
      return route.fulfill({ status: 409, json: { error: 'Este número já está cadastrado como WhatsApp de outra conta.' } });
    });

    await page.check('#telefone-e-whatsapp');
    await page.click('#btn-salvar-perfil');

    await expect(page.locator('.toast-erro')).toHaveText(/já está cadastrado como WhatsApp/);
  });

  test('erro de rede ao salvar mostra toast de erro (CA06)', async ({ page }) => {
    await entrarNoPainel(page);
    await page.route('**/api/perfil', (route) => {
      if (route.request().method() !== 'PATCH') return route.fallback();
      return route.fulfill({ status: 500, json: { error: 'Erro ao salvar. Tente novamente.' } });
    });

    await page.click('#btn-salvar-perfil');
    await expect(page.locator('.toast-erro')).toHaveText(/Erro ao salvar/);
  });
});
