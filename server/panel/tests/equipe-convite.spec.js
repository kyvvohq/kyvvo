const { test, expect } = require('@playwright/test');

// Cobre US62 — tela pública de aceitar convite (/equipe-convite.html): sem
// token na URL, convite não encontrado/expirado/aceito/cancelado, e o fluxo
// feliz (validação de campos, aceitar e auto-login). As chamadas de API são
// mockadas via page.route — sem dependência de Postgres real.

test.describe('Aceitar convite (/equipe-convite.html)', () => {
  test('sem token na URL, mostra mensagem de link inválido', async ({ page }) => {
    await page.goto('/equipe-convite.html');
    await expect(page.locator('#estado-invalido')).toBeVisible();
    await expect(page.locator('#mensagem-invalido')).toContainText('Link de convite inválido');
  });

  test('convite não encontrado (404) mostra mensagem específica', async ({ page }) => {
    await page.route('**/api/equipe/convites/token-invalido', (route) => route.fulfill({ status: 404, json: { error: 'Convite não encontrado.' } }));
    await page.goto('/equipe-convite.html?token=token-invalido');
    await expect(page.locator('#mensagem-invalido')).toContainText('Convite não encontrado');
  });

  test('convite expirado mostra mensagem específica e não exibe o formulário', async ({ page }) => {
    await page.route('**/api/equipe/convites/tok-expirado', (route) =>
      route.fulfill({ json: { email: 'joana@salao.com', role: 'operador', status: 'expirado', tenant_nome: 'Salão da Ana' } })
    );
    await page.goto('/equipe-convite.html?token=tok-expirado');
    await expect(page.locator('#mensagem-invalido')).toContainText('expirou');
    await expect(page.locator('#estado-form')).toBeHidden();
  });

  test('convite já aceito mostra mensagem específica', async ({ page }) => {
    await page.route('**/api/equipe/convites/tok-aceito', (route) =>
      route.fulfill({ json: { email: 'joana@salao.com', role: 'operador', status: 'aceito', tenant_nome: 'Salão da Ana' } })
    );
    await page.goto('/equipe-convite.html?token=tok-aceito');
    await expect(page.locator('#mensagem-invalido')).toContainText('já foi aceito');
  });

  test('convite cancelado mostra mensagem específica', async ({ page }) => {
    await page.route('**/api/equipe/convites/tok-cancelado', (route) =>
      route.fulfill({ json: { email: 'joana@salao.com', role: 'operador', status: 'cancelado', tenant_nome: 'Salão da Ana' } })
    );
    await page.goto('/equipe-convite.html?token=tok-cancelado');
    await expect(page.locator('#mensagem-invalido')).toContainText('cancelado');
  });

  test('convite pendente mostra o formulário com e-mail pré-preenchido e descrição do perfil', async ({ page }) => {
    await page.route('**/api/equipe/convites/tok-valido', (route) =>
      route.fulfill({ json: { email: 'joana@salao.com', role: 'operador', status: 'pendente', tenant_nome: 'Salão da Ana' } })
    );
    await page.goto('/equipe-convite.html?token=tok-valido');
    await expect(page.locator('#estado-form')).toBeVisible();
    await expect(page.locator('#email')).toHaveValue('joana@salao.com');
    await expect(page.locator('#convite-descricao')).toContainText('Salão da Ana');
    await expect(page.locator('#convite-descricao')).toContainText('operador');
  });

  test('validação: nome vazio e senha fraca ficam destacados', async ({ page }) => {
    await page.route('**/api/equipe/convites/tok-valido', (route) =>
      route.fulfill({ json: { email: 'joana@salao.com', role: 'operador', status: 'pendente', tenant_nome: 'Salão da Ana' } })
    );
    await page.goto('/equipe-convite.html?token=tok-valido');

    await page.fill('#senha', 'fraca');
    await page.locator('#senha').blur();
    await expect(page.locator('#erro-senha')).toHaveText('Mínimo 8 caracteres, 1 número e 1 letra maiúscula.');

    await page.click('#btn-aceitar');
    await expect(page.locator('#erro-nome')).toHaveText('Informe seu nome.');
  });

  test('aceitar com sucesso salva a sessão e redireciona pro painel', async ({ page }) => {
    await page.route('**/api/equipe/convites/tok-valido', (route) =>
      route.fulfill({ json: { email: 'joana@salao.com', role: 'operador', status: 'pendente', tenant_nome: 'Salão da Ana' } })
    );
    let payloadEnviado = null;
    await page.route('**/api/equipe/convites/tok-valido/aceitar', (route) => {
      payloadEnviado = route.request().postDataJSON();
      return route.fulfill({ json: { token: 'jwt-novo', nome: 'Joana Silva', email: 'joana@salao.com', role: 'operador', email_verified: true } });
    });
    await page.route('**/api/configuracao', (route) =>
      route.fulfill({ json: { dias_funcionamento: [1, 2, 3, 4, 5, 6], formato_hora: '24h' } })
    );
    await page.route('**/api/agendamentos**', (route) => route.fulfill({ json: { view: 'dia', data: '2026-08-06', agendamentos: [] } }));
    await page.route('**/api/tenant/status', (route) =>
      route.fulfill({ json: { email_verified: true, status: 'ativo', trial_ativo: false, role: 'operador', configuracao: {} } })
    );

    await page.goto('/equipe-convite.html?token=tok-valido');
    await page.fill('#nome', 'Joana Silva');
    await page.fill('#senha', 'Senha1234');
    await page.click('#btn-aceitar');

    await expect(page).toHaveURL(/\/painel\.html$/);
    expect(payloadEnviado).toEqual({ nome: 'Joana Silva', senha: 'Senha1234' });
    expect(await page.evaluate(() => localStorage.getItem('kyvvo_token'))).toBe('jwt-novo');
    expect(await page.evaluate(() => localStorage.getItem('kyvvo_email_verified'))).toBe('true');
  });

  test('erro do backend ao aceitar aparece na mensagem geral', async ({ page }) => {
    await page.route('**/api/equipe/convites/tok-valido', (route) =>
      route.fulfill({ json: { email: 'joana@salao.com', role: 'operador', status: 'pendente', tenant_nome: 'Salão da Ana' } })
    );
    await page.route('**/api/equipe/convites/tok-valido/aceitar', (route) =>
      route.fulfill({ status: 400, json: { error: 'Este convite expirou. Peça um novo convite ao administrador.' } })
    );

    await page.goto('/equipe-convite.html?token=tok-valido');
    await page.fill('#nome', 'Joana Silva');
    await page.fill('#senha', 'Senha1234');
    await page.click('#btn-aceitar');

    await expect(page.locator('#erro-geral')).toHaveText('Este convite expirou. Peça um novo convite ao administrador.');
  });
});
