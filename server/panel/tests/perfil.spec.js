const { test, expect } = require('@playwright/test');

// Cobre US33/PR5: edição de perfil no portal (Nome do Responsável, Nome do
// [segmento] com label dinâmico, Telefone + checkbox "é WhatsApp" e Endereço
// estruturado com máscara de CEP e autopreenchimento via ViaCEP), mais o
// campo somente leitura (E-mail). As chamadas de API são mockadas via
// page.route — sem dependência de Postgres real nem da API pública do
// ViaCEP (também mockada).

const PERFIL_BASE = {
  nome_responsavel: 'Ana Souza',
  email: 'ana@exemplo.com',
  nome_segmento: 'Salão da Ana',
  segmento: 'salao_beleza',
  telefone: '34999998888',
  whatsapp: '34988887777',
  plano: 'profissional',
  plano_nome: 'Profissional',
  endereco_cep: '38400000',
  endereco_logradouro: 'Rua das Flores',
  endereco_numero: '100',
  endereco_complemento: null,
  endereco_bairro: 'Centro',
  endereco_cidade: 'Uberlândia',
  endereco_uf: 'MG',
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

test.describe('Perfil (US33)', () => {
  // Os labels/textos do user menu (Meu Perfil/Minha Empresa/Cobrança/
  // Preferências/Ajuda/Sair) são cobertos em tests/user-menu.spec.js (PR11).

  test('pré-preenche o formulário com os dados atuais, CEP já mascarado (CA02)', async ({ page }) => {
    await entrarNoPainel(page);
    await expect(page.locator('#nome_responsavel')).toHaveValue('Ana Souza');
    await expect(page.locator('#nome_segmento')).toHaveValue('Salão da Ana');
    await expect(page.locator('#telefone')).toHaveValue('(34) 99999-8888');
    await expect(page.locator('#endereco-cep')).toHaveValue('38400-000');
    await expect(page.locator('#endereco-logradouro')).toHaveValue('Rua das Flores');
    await expect(page.locator('#endereco-uf')).toHaveValue('MG');
  });

  test('E-mail aparece como somente leitura (CA05)', async ({ page }) => {
    await entrarNoPainel(page);
    await expect(page.locator('input[value="ana@exemplo.com"]')).toBeDisabled();
  });

  test('label do Nome do [segmento] é dinâmico conforme o segmento do tenant', async ({ page }) => {
    await entrarNoPainel(page, { ...PERFIL_BASE, segmento: 'petshop' });
    await expect(page.locator('label[for="nome_segmento"]')).toContainText('Nome do petshop');
  });

  test('campos obrigatórios mostram asterisco vermelho, Complemento não', async ({ page }) => {
    await entrarNoPainel(page);
    await expect(page.locator('label[for="nome_responsavel"] .obrigatorio')).toHaveText('*');
    await expect(page.locator('label[for="telefone"] .obrigatorio')).toHaveText('*');
    await expect(page.locator('label[for="endereco-cep"] .obrigatorio')).toHaveText('*');
    await expect(page.locator('label[for="endereco-complemento"] .obrigatorio')).toHaveCount(0);
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

  test('endereço incompleto mostra mensagem única de erro (CA03/CA04)', async ({ page }) => {
    await entrarNoPainel(page, { ...PERFIL_BASE, endereco_bairro: '' });
    await page.click('#btn-salvar-perfil');
    await expect(page.locator('#erro-endereco')).toHaveText('Preencha todos os campos do endereço.');
  });

  test('CEP preenchido autocompleta o endereço via ViaCEP (CA04)', async ({ page }) => {
    await page.route('https://viacep.com.br/**', (route) =>
      route.fulfill({
        json: { logradouro: 'Avenida Central', bairro: 'Bairro Novo', localidade: 'Uberaba', uf: 'MG' },
      })
    );
    await entrarNoPainel(page, { ...PERFIL_BASE, endereco_cep: '', endereco_logradouro: '', endereco_bairro: '', endereco_cidade: '', endereco_uf: '' });

    await page.fill('#endereco-cep', '38010000');
    await page.locator('#endereco-cep').blur();

    await expect(page.locator('#endereco-logradouro')).toHaveValue('Avenida Central');
    await expect(page.locator('#endereco-bairro')).toHaveValue('Bairro Novo');
    await expect(page.locator('#endereco-cidade')).toHaveValue('Uberaba');
    await expect(page.locator('#endereco-uf')).toHaveValue('MG');
  });

  test('CEP não encontrado mostra aviso pra preencher manualmente (CA04)', async ({ page }) => {
    await page.route('https://viacep.com.br/**', (route) => route.fulfill({ json: { erro: true } }));
    await entrarNoPainel(page, { ...PERFIL_BASE, endereco_cep: '' });

    await page.fill('#endereco-cep', '00000000');
    await page.locator('#endereco-cep').blur();

    await expect(page.locator('#erro-endereco')).toHaveText('CEP não encontrado. Preencha o endereço manualmente.');
  });

  test('salva as alterações com sucesso (CA06)', async ({ page }) => {
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
    expect(corpoEnviado).toMatchObject({ nome_responsavel: 'Ana Souza Silva', nome_segmento: 'Salão da Ana', telefone_e_whatsapp: false });
    expect(corpoEnviado.endereco).toMatchObject({ cep: '38400-000', cidade: 'Uberlândia', uf: 'MG' });
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
