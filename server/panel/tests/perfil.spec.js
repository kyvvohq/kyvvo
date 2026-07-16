const { test, expect } = require('@playwright/test');

// Cobre US33: edição de perfil no portal (Nome do Responsável, Nome do
// Segmento, Telefone e Endereço estruturado com autopreenchimento via
// ViaCEP), mais os campos somente leitura (E-mail, WhatsApp, Plano atual).
// As chamadas de API são mockadas via page.route — sem dependência de
// Postgres real nem da API pública do ViaCEP (também mockada).

const PERFIL_BASE = {
  nome_responsavel: 'Ana Souza',
  email: 'ana@exemplo.com',
  nome_segmento: 'Salão da Ana',
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
  await page.click('.menu-item[data-menu="perfil"]');
}

test.describe('Perfil (US33)', () => {
  test('pré-preenche o formulário com os dados atuais (CA02)', async ({ page }) => {
    await entrarNoPainel(page);
    await expect(page.locator('#nome_responsavel')).toHaveValue('Ana Souza');
    await expect(page.locator('#nome_segmento')).toHaveValue('Salão da Ana');
    await expect(page.locator('#telefone')).toHaveValue('(34) 99999-8888');
    await expect(page.locator('#endereco-cep')).toHaveValue('38400000');
    await expect(page.locator('#endereco-logradouro')).toHaveValue('Rua das Flores');
    await expect(page.locator('#endereco-uf')).toHaveValue('MG');
  });

  test('E-mail, WhatsApp e Plano atual aparecem como somente leitura (CA05)', async ({ page }) => {
    await entrarNoPainel(page);
    await expect(page.locator('input[value="ana@exemplo.com"]')).toBeDisabled();
    await expect(page.locator('input[value="(34) 98888-7777"]')).toBeDisabled();
    await expect(page.locator('.perfil-form')).toContainText('Profissional');
  });

  // A aba de Pagamentos (US32) ainda não existe nesta versão do portal — o
  // link só passa a navegar de fato quando aquele PR for mesclado. Aqui só
  // garante que clicar não quebra a página nesse meio-tempo.
  test('link "ver aba de Pagamentos" não quebra a página quando a aba ainda não existe', async ({ page }) => {
    await entrarNoPainel(page);
    await page.click('#link-perfil-pagamentos');
    await expect(page.locator('#form-perfil')).toBeVisible();
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
    expect(corpoEnviado).toMatchObject({ nome_responsavel: 'Ana Souza Silva', nome_segmento: 'Salão da Ana' });
    expect(corpoEnviado.endereco).toMatchObject({ cep: '38400000', cidade: 'Uberlândia', uf: 'MG' });
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
