const { test, expect } = require('@playwright/test');

// Cobre US79/CA01 (aceite obrigatório dos Termos de Uso/Política de
// Privacidade) e US79/CA02 (consentimento de marketing separado e
// opcional). CA03 (trilha de auditoria no backend: versão, IP, imutável) e
// CA04 (link "Já tem conta? Entrar", já existente desde o US20) não têm
// cobertura de UI própria aqui — CA03 foi validado diretamente contra
// Postgres real (INSERT + FK + cascade) e CA04 não mudou nesta história.

async function mockSegmentos(page) {
  await page.route('**/api/segmentos', (route) =>
    route.fulfill({ json: { segmentos: [{ id: 1, nome: 'Salão de Beleza' }] } })
  );
}

async function preencherCamposValidos(page) {
  await page.fill('#nome_responsavel', 'Ana Souza');
  await page.fill('#email', 'ana@salao.com');
  await page.selectOption('#segmento', '1');
  await page.fill('#telefone', '(34) 98888-7777');
  await page.fill('#whatsapp', '(34) 99999-9999');
  await page.fill('#senha', 'Senha123');
}

test.describe('Cadastro — aceite de termos e consentimento (US79)', () => {
  test('CA01 — o checkbox de aceite começa desmarcado e os links abrem em nova aba', async ({ page }) => {
    await mockSegmentos(page);
    await page.goto('/cadastro.html');

    await expect(page.locator('#aceite_termos')).not.toBeChecked();
    await expect(page.getByRole('link', { name: 'Termos de Uso' })).toHaveAttribute('target', '_blank');
    await expect(page.getByRole('link', { name: 'Política de Privacidade' })).toHaveAttribute('target', '_blank');
  });

  test('CA01 — bloqueia o envio sem o aceite marcado e mostra erro inline', async ({ page }) => {
    await mockSegmentos(page);
    let chamouRegister = false;
    await page.route('**/api/auth/register', (route) => {
      chamouRegister = true;
      route.fulfill({ status: 201, json: {} });
    });

    await page.goto('/cadastro.html');
    await preencherCamposValidos(page);
    await page.click('#btn-criar');

    expect(chamouRegister).toBe(false);
    await expect(page.locator('#erro-aceite_termos')).toHaveText(
      'Você precisa aceitar os Termos de Uso e a Política de Privacidade para continuar.'
    );
  });

  test('CA01 — marcar o aceite depois do erro libera o envio', async ({ page }) => {
    await mockSegmentos(page);
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
    await preencherCamposValidos(page);
    await page.click('#btn-criar');
    await expect(page.locator('#erro-aceite_termos')).not.toHaveText('');

    await page.check('#aceite_termos');
    await expect(page.locator('#erro-aceite_termos')).toHaveText('');
    await page.click('#btn-criar');

    await expect(page).toHaveURL(/\/verificar\.html$/);
    expect(payloadEnviado.aceite_termos).toBe(true);
  });

  test('CA02 — o consentimento de marketing é opcional, desmarcado por padrão', async ({ page }) => {
    await mockSegmentos(page);
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
    await expect(page.locator('#aceita_marketing')).not.toBeChecked();

    await preencherCamposValidos(page);
    await page.check('#aceite_termos');
    await page.click('#btn-criar');

    await expect(page).toHaveURL(/\/verificar\.html$/);
    expect(payloadEnviado.aceita_marketing).toBe(false);
  });

  test('CA02 — marcar o consentimento de marketing envia aceita_marketing=true', async ({ page }) => {
    await mockSegmentos(page);
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
    await preencherCamposValidos(page);
    await page.check('#aceite_termos');
    await page.check('#aceita_marketing');
    await page.click('#btn-criar');

    await expect(page).toHaveURL(/\/verificar\.html$/);
    expect(payloadEnviado.aceita_marketing).toBe(true);
  });
});
