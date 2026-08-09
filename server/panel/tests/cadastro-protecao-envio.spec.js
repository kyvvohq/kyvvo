const { test, expect } = require('@playwright/test');

// Cobre US80.4 — foco no primeiro erro (já coberto em cadastro.spec.js,
// "submeter formulário inválido..."), estado de carregando, proteção contra
// duplo envio e preservação dos campos numa falha de rede.

const SEGMENTOS_MOCK = { segmentos: [{ id: 1, nome: 'Salão de Beleza' }] };

async function mockSegmentos(page) {
  await page.route('**/api/segmentos', (route) => route.fulfill({ json: SEGMENTOS_MOCK }));
}

// US77 — Segmento saiu do cadastro e Telefone só existe atrás do checkbox
// "Uso outro número para ligações"; US79 exige marcar o aceite de termos.
async function preencherCamposValidos(page) {
  await page.fill('#nome_responsavel', 'Ana Souza');
  await page.fill('#whatsapp', '(34) 99999-9999');
  await page.fill('#email', 'ana@salao.com');
  await page.fill('#senha', 'Senha123');
  await page.check('#aceite_termos');
}

test.describe('Cadastro — proteção contra envio duplicado (US80.4)', () => {
  test('botão mostra estado de carregando e fica desabilitado durante o envio', async ({ page }) => {
    await mockSegmentos(page);
    await page.route('**/api/auth/register', async (route) => {
      await new Promise((r) => setTimeout(r, 500));
      route.fulfill({ status: 201, json: { token: 't', nome: 'Ana', email: 'ana@salao.com', email_verified: false } });
    });
    await page.route('**/api/tenant/status', (route) =>
      route.fulfill({ json: { email: 'ana@salao.com', email_verified: false, status: 'trial' } })
    );

    await page.goto('/cadastro.html');
    await preencherCamposValidos(page);
    await page.click('#btn-criar');

    await expect(page.locator('#btn-criar')).toBeDisabled();
    await expect(page.locator('#btn-criar')).toHaveText('Criando conta...');
  });

  test('um segundo envio disparado enquanto o primeiro está em voo não duplica a requisição', async ({ page }) => {
    await mockSegmentos(page);
    let chamadas = 0;
    await page.route('**/api/auth/register', async (route) => {
      chamadas += 1;
      await new Promise((r) => setTimeout(r, 400));
      route.fulfill({ status: 201, json: { token: 't', nome: 'Ana', email: 'ana@salao.com', email_verified: false } });
    });
    await page.route('**/api/tenant/status', (route) =>
      route.fulfill({ json: { email: 'ana@salao.com', email_verified: false, status: 'trial' } })
    );

    await page.goto('/cadastro.html');
    await preencherCamposValidos(page);
    // Dispara um segundo 'submit' diretamente no form enquanto o primeiro
    // ainda está em voo — um clique real no botão já fica bloqueado por
    // `disabled`, então isso simula uma via alternativa (ex.: Enter
    // disparado por outro handler) que não passa pelo estado do botão.
    await page.click('#btn-criar');
    await page.evaluate(() => document.getElementById('form-cadastro').requestSubmit());

    await expect(page).toHaveURL(/\/verificar\.html$/);
    expect(chamadas).toBe(1);
  });

  test('falha de rede mostra mensagem recuperável e não limpa os campos preenchidos', async ({ page }) => {
    await mockSegmentos(page);
    await page.route('**/api/auth/register', (route) => route.abort('failed'));

    await page.goto('/cadastro.html');
    await preencherCamposValidos(page);
    await page.click('#btn-criar');

    await expect(page.locator('#erro-geral')).toHaveText('Erro ao processar. Tente novamente.');
    await expect(page.locator('#nome_responsavel')).toHaveValue('Ana Souza');
    await expect(page.locator('#email')).toHaveValue('ana@salao.com');
    await expect(page.locator('#whatsapp')).toHaveValue('(34) 99999-9999');
    await expect(page.locator('#btn-criar')).toBeEnabled();
    await expect(page.locator('#btn-criar')).toHaveText('Começar grátis');
  });
});
