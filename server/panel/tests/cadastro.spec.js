const { test, expect } = require('@playwright/test');

// Cobre US20/ST20.1 + US34 — tela de cadastro self-service: validações de
// campo (CA02), verificação de unicidade (CA03/CA06) e criação com
// redirecionamento para a validação do token (CA04/CA07). As chamadas de API
// são mockadas via page.route — sem dependência de Postgres real.

const SEGMENTOS_MOCK = {
  segmentos: [
    { id: 1, nome: 'Salão de Beleza' },
    { id: 2, nome: 'Pet Shop' },
    { id: 3, nome: 'Outro' },
  ],
};

async function mockSegmentos(page) {
  await page.route('**/api/segmentos', (route) => route.fulfill({ json: SEGMENTOS_MOCK }));
}

test.describe('Cadastro (/cadastro.html)', () => {
  test('validação onBlur exibe as mensagens de erro corretas (CA02)', async ({ page }) => {
    await mockSegmentos(page);
    await page.goto('/cadastro.html');

    await page.fill('#email', 'nao-e-email');
    await page.locator('#email').blur();
    await expect(page.locator('#erro-email')).toHaveText('Digite um e-mail válido.');

    await page.fill('#senha', 'fraca');
    await page.locator('#senha').blur();
    await expect(page.locator('#erro-senha')).toHaveText(
      'A senha deve ter no mínimo 8 caracteres, 1 número e 1 letra maiúscula.'
    );

    await page.fill('#telefone', '123');
    await page.locator('#telefone').blur();
    await expect(page.locator('#erro-telefone')).toHaveText('Digite um telefone válido com DDD.');

    await page.fill('#whatsapp', '123');
    await page.locator('#whatsapp').blur();
    await expect(page.locator('#erro-whatsapp')).toHaveText('Digite um número de WhatsApp válido com DDD.');

    await page.locator('#segmento').focus();
    await page.locator('#segmento').blur();
    await expect(page.locator('#erro-segmento')).toHaveText('Selecione seu segmento.');
  });

  test('segmento é carregado dinamicamente via GET /api/segmentos (CA02)', async ({ page }) => {
    await mockSegmentos(page);
    await page.goto('/cadastro.html');

    await expect(page.locator('#segmento option')).toHaveCount(4); // placeholder + 3 mockados
    await expect(page.locator('#segmento option[value="2"]')).toHaveText('Pet Shop');
  });

  test('falha ao carregar segmentos exibe mensagem de erro (CA02)', async ({ page }) => {
    await page.route('**/api/segmentos', (route) => route.fulfill({ status: 500, json: {} }));
    await page.goto('/cadastro.html');

    await expect(page.locator('#erro-segmento')).toHaveText(
      'Não foi possível carregar os segmentos. Tente novamente.'
    );
  });

  test('telefone recebe máscara automática ao digitar (CA03)', async ({ page }) => {
    await mockSegmentos(page);
    await page.goto('/cadastro.html');

    await page.fill('#telefone', '34999998888');
    await expect(page.locator('#telefone')).toHaveValue('(34) 99999-8888');
  });

  test('submeter formulário inválido não chama a API e foca o primeiro campo com erro', async ({ page }) => {
    await mockSegmentos(page);
    let chamouRegister = false;
    await page.route('**/api/auth/register', (route) => {
      chamouRegister = true;
      route.fulfill({ status: 201, json: {} });
    });

    await page.goto('/cadastro.html');
    await page.click('#btn-criar');

    await expect(page.locator('#erro-nome_responsavel')).toHaveText('Informe o nome do responsável.');
    expect(chamouRegister).toBe(false);
  });

  test('cadastro válido cria a conta e redireciona para a validação do token (CA04/CA07)', async ({ page }) => {
    await mockSegmentos(page);
    let payloadEnviado = null;
    await page.route('**/api/auth/register', (route) => {
      payloadEnviado = route.request().postDataJSON();
      return route.fulfill({
        status: 201,
        json: { token: 'jwt-novo', nome: 'Ana', email: 'ana@salao.com', email_verified: false },
      });
    });
    // Após o redirect, a tela de validação consulta o status — mocka pra não
    // deixar o teste dependente de rede.
    await page.route('**/api/tenant/status', (route) =>
      route.fulfill({ json: { email: 'ana@salao.com', email_verified: false, status: 'trial' } })
    );

    await page.goto('/cadastro.html');
    await page.fill('#nome_responsavel', 'Ana Souza');
    await page.fill('#email', 'ana@salao.com');
    await page.selectOption('#segmento', '1');
    await page.fill('#telefone', '(34) 98888-7777');
    await page.fill('#whatsapp', '(34) 99999-9999');
    await page.fill('#senha', 'Senha123');
    await page.click('#btn-criar');

    await expect(page).toHaveURL(/\/verificar\.html$/);
    expect(await page.evaluate(() => localStorage.getItem('kyvvo_token'))).toBe('jwt-novo');
    expect(await page.evaluate(() => localStorage.getItem('kyvvo_email'))).toBe('ana@salao.com');
    expect(payloadEnviado).toMatchObject({
      nome_responsavel: 'Ana Souza',
      email: 'ana@salao.com',
      segmento_id: 1,
      whatsapp: '(34) 99999-9999',
    });
  });

  test('e-mail já cadastrado (CA03) exibe a mensagem de unicidade da API', async ({ page }) => {
    await mockSegmentos(page);
    await page.route('**/api/auth/register', (route) =>
      route.fulfill({
        status: 409,
        json: { error: 'Este e-mail já está cadastrado. Faça login ou use outro e-mail.' },
      })
    );

    await page.goto('/cadastro.html');
    await page.fill('#nome_responsavel', 'Ana Souza');
    await page.fill('#email', 'ana@salao.com');
    await page.selectOption('#segmento', '1');
    await page.fill('#telefone', '(34) 98888-7777');
    await page.fill('#whatsapp', '(34) 99999-9999');
    await page.fill('#senha', 'Senha123');
    await page.click('#btn-criar');

    await expect(page).toHaveURL(/\/cadastro\.html$/);
    await expect(page.locator('#erro-geral')).toHaveText(
      'Este e-mail já está cadastrado. Faça login ou use outro e-mail.'
    );
  });
});
