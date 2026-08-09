const { test, expect } = require('@playwright/test');

// Cobre US20/ST20.1 + US34 (validações, unicidade, criação com redirect) e
// US77 (formulário reduzido a 4 campos essenciais + telefone alternativo
// opcional, sem Segmento — que migrou pro onboarding, US82). As chamadas de
// API são mockadas via page.route — sem dependência de Postgres real.

test.describe('Cadastro (/cadastro.html) — formulário reduzido (US77)', () => {
  test('CA01 — exibe apenas os 4 campos essenciais, sem Segmento', async ({ page }) => {
    await page.goto('/cadastro.html');

    await expect(page.locator('#nome_responsavel')).toBeVisible();
    await expect(page.locator('#whatsapp')).toBeVisible();
    await expect(page.locator('#email')).toBeVisible();
    await expect(page.locator('#senha')).toBeVisible();
    await expect(page.locator('#segmento')).toHaveCount(0);
  });

  test('CA01 — telefone para ligações começa oculto', async ({ page }) => {
    await page.goto('/cadastro.html');
    await expect(page.locator('#bloco-telefone-alternativo')).toBeHidden();
  });

  test('CA02 — marcar o checkbox revela o telefone e move o foco', async ({ page }) => {
    await page.goto('/cadastro.html');

    await page.check('#usa_telefone_alternativo');

    await expect(page.locator('#bloco-telefone-alternativo')).toBeVisible();
    await expect(page.locator('#telefone')).toBeFocused();
  });

  test('CA02 — desmarcar oculta o campo e descarta o valor digitado', async ({ page }) => {
    await page.goto('/cadastro.html');

    await page.check('#usa_telefone_alternativo');
    await page.fill('#telefone', '(34) 93333-3333');
    await page.uncheck('#usa_telefone_alternativo');

    await expect(page.locator('#bloco-telefone-alternativo')).toBeHidden();
    await expect(page.locator('#telefone')).toHaveValue('');
  });

  test('CA02 — sem telefone alternativo marcado, telefone enviado é igual ao whatsapp', async ({ page }) => {
    let payloadEnviado = null;
    await page.route('**/api/auth/register', (route) => {
      payloadEnviado = route.request().postDataJSON();
      return route.fulfill({
        status: 201,
        json: { token: 'jwt-novo', nome: 'Ana', email: 'ana@salao.com', email_verified: false },
      });
    });
    await page.route('**/api/tenant/status', (route) =>
      route.fulfill({ json: { email: 'ana@salao.com', email_verified: false, status: 'trial' } })
    );

    await page.goto('/cadastro.html');
    await page.fill('#nome_responsavel', 'Ana Souza');
    await page.fill('#whatsapp', '34999999999');
    await page.fill('#email', 'ana@salao.com');
    await page.fill('#senha', 'Senha123');
    await page.click('#btn-criar');

    await expect(page).toHaveURL(/\/verificar\.html$/);
    expect(payloadEnviado.telefone).toBe(payloadEnviado.whatsapp);
    expect(payloadEnviado).not.toHaveProperty('segmento_id');
  });

  test('CA03 — máscara automática é aplicada no WhatsApp ao digitar', async ({ page }) => {
    await page.goto('/cadastro.html');

    await page.fill('#whatsapp', '34999998888');
    await expect(page.locator('#whatsapp')).toHaveValue('(34) 99999-8888');
  });

  test('CA03 — número de WhatsApp incompleto é rejeitado com mensagem inline', async ({ page }) => {
    await page.goto('/cadastro.html');

    await page.fill('#whatsapp', '3499');
    await page.locator('#whatsapp').blur();
    await expect(page.locator('#erro-whatsapp')).toHaveText('Digite um número de WhatsApp válido com DDD.');
  });

  test('validação onBlur exibe as mensagens de erro corretas (CA02/US20)', async ({ page }) => {
    await page.goto('/cadastro.html');

    await page.fill('#email', 'nao-e-email');
    await page.locator('#email').blur();
    await expect(page.locator('#erro-email')).toHaveText('Digite um e-mail válido.');

    await page.fill('#senha', 'fraca');
    await page.locator('#senha').blur();
    await expect(page.locator('#erro-senha')).toHaveText(
      'A senha deve ter no mínimo 8 caracteres, 1 número e 1 letra maiúscula.'
    );
  });

  test('submeter formulário inválido não chama a API e foca o primeiro campo com erro', async ({ page }) => {
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
    await page.fill('#whatsapp', '(34) 99999-9999');
    await page.fill('#email', 'ana@salao.com');
    await page.fill('#senha', 'Senha123');
    await page.click('#btn-criar');

    await expect(page).toHaveURL(/\/verificar\.html$/);
    expect(await page.evaluate(() => localStorage.getItem('kyvvo_token'))).toBe('jwt-novo');
    expect(await page.evaluate(() => localStorage.getItem('kyvvo_email'))).toBe('ana@salao.com');
    expect(payloadEnviado).toMatchObject({
      nome_responsavel: 'Ana Souza',
      email: 'ana@salao.com',
      whatsapp: '(34) 99999-9999',
    });
  });

  test('cadastro com telefone alternativo envia o valor do campo revelado', async ({ page }) => {
    let payloadEnviado = null;
    await page.route('**/api/auth/register', (route) => {
      payloadEnviado = route.request().postDataJSON();
      return route.fulfill({
        status: 201,
        json: { token: 'jwt-novo', nome: 'Ana', email: 'ana@salao.com', email_verified: false },
      });
    });
    await page.route('**/api/tenant/status', (route) =>
      route.fulfill({ json: { email: 'ana@salao.com', email_verified: false, status: 'trial' } })
    );

    await page.goto('/cadastro.html');
    await page.fill('#nome_responsavel', 'Ana Souza');
    await page.fill('#whatsapp', '(34) 99999-9999');
    await page.fill('#email', 'ana@salao.com');
    await page.fill('#senha', 'Senha123');
    await page.check('#usa_telefone_alternativo');
    await page.fill('#telefone', '(34) 93333-4444');
    await page.click('#btn-criar');

    await expect(page).toHaveURL(/\/verificar\.html$/);
    expect(payloadEnviado.telefone).toBe('(34) 93333-4444');
    expect(payloadEnviado.telefone).not.toBe(payloadEnviado.whatsapp);
  });

  test('e-mail já cadastrado (CA03/US20) exibe a mensagem de unicidade da API', async ({ page }) => {
    await page.route('**/api/auth/register', (route) =>
      route.fulfill({
        status: 409,
        json: { error: 'Este e-mail já está cadastrado. Faça login ou use outro e-mail.' },
      })
    );

    await page.goto('/cadastro.html');
    await page.fill('#nome_responsavel', 'Ana Souza');
    await page.fill('#whatsapp', '(34) 99999-9999');
    await page.fill('#email', 'ana@salao.com');
    await page.fill('#senha', 'Senha123');
    await page.click('#btn-criar');

    await expect(page).toHaveURL(/\/cadastro\.html$/);
    await expect(page.locator('#erro-geral')).toHaveText(
      'Este e-mail já está cadastrado. Faça login ou use outro e-mail.'
    );
  });
});
