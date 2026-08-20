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

  // US57 — antes, a saudação do topo ("Bom dia, Ana!") ficava com o nome
  // antigo até logout/login, mesmo com o resto da tela (user menu) já
  // atualizado, porque só lia `kyvvo_nome` do localStorage uma vez no load.
  test('salvar com nome novo atualiza a saudação do topo e o localStorage na hora', async ({ page }) => {
    await entrarNoPainel(page);
    await expect(page.locator('#saudacao')).toContainText('Ana!');

    await page.route('**/api/perfil', (route) => {
      if (route.request().method() !== 'PATCH') return route.fallback();
      return route.fulfill({ json: { ...PERFIL_BASE, nome_responsavel: 'Beatriz Souza' } });
    });

    await page.fill('#nome_responsavel', 'Beatriz Souza');
    await page.click('#btn-salvar-perfil');

    await expect(page.locator('.toast-sucesso')).toHaveText(/Perfil atualizado com sucesso/);
    await expect(page.locator('#saudacao')).toContainText('Beatriz!');
    expect(await page.evaluate(() => window.localStorage.getItem('kyvvo_nome'))).toBe('Beatriz Souza');
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

test.describe('Alterar senha (Meu Perfil)', () => {
  test('olhinho alterna entre texto oculto e visível nos 3 campos', async ({ page }) => {
    await entrarNoPainel(page);
    await expect(page.locator('#senha_atual')).toHaveAttribute('type', 'password');
    await page.click('#btn-toggle-senha_atual');
    await expect(page.locator('#senha_atual')).toHaveAttribute('type', 'text');
    await page.click('#btn-toggle-senha_atual');
    await expect(page.locator('#senha_atual')).toHaveAttribute('type', 'password');
  });

  test('senha nova fraca mostra erro e não chama a API', async ({ page }) => {
    await entrarNoPainel(page);
    let chamou = false;
    await page.route('**/api/perfil/senha', (route) => {
      chamou = true;
      return route.fulfill({ json: { ok: true } });
    });

    await page.fill('#senha_atual', 'SenhaAtual123');
    await page.fill('#senha_nova', 'fraca');
    await page.fill('#senha_repetir', 'fraca');
    await page.click('#btn-salvar-senha');

    await expect(page.locator('#erro-senha_nova')).toContainText('no mínimo 8 caracteres');
    expect(chamou).toBe(false);
  });

  test('senhas diferentes mostram "as duas senhas estão diferentes" embaixo de repetir, ao vivo', async ({ page }) => {
    await entrarNoPainel(page);
    await page.fill('#senha_nova', 'SenhaNova123');
    await page.fill('#senha_repetir', 'SenhaDiferente123');
    await expect(page.locator('#erro-senha_repetir')).toHaveText('As duas senhas estão diferentes.');

    await page.fill('#senha_repetir', 'SenhaNova123');
    await expect(page.locator('#erro-senha_repetir')).toHaveText('');
  });

  test('senhas diferentes bloqueiam o envio mesmo sem ter perdido o foco', async ({ page }) => {
    await entrarNoPainel(page);
    let chamou = false;
    await page.route('**/api/perfil/senha', (route) => {
      chamou = true;
      return route.fulfill({ json: { ok: true } });
    });

    await page.fill('#senha_atual', 'SenhaAtual123');
    await page.fill('#senha_nova', 'SenhaNova123');
    await page.fill('#senha_repetir', 'Outra123');
    await page.click('#btn-salvar-senha');

    await expect(page.locator('#erro-senha_repetir')).toHaveText('As duas senhas estão diferentes.');
    expect(chamou).toBe(false);
  });

  test('senha atual incorreta mostra o erro do backend embaixo do campo', async ({ page }) => {
    await entrarNoPainel(page);
    await page.route('**/api/perfil/senha', (route) =>
      route.fulfill({ status: 400, json: { error: 'Senha atual incorreta.' } })
    );

    await page.fill('#senha_atual', 'SenhaErrada123');
    await page.fill('#senha_nova', 'SenhaNova123');
    await page.fill('#senha_repetir', 'SenhaNova123');
    await page.click('#btn-salvar-senha');

    await expect(page.locator('#erro-senha_atual')).toHaveText('Senha atual incorreta.');
  });

  test('sucesso desloga (limpa o token) e redireciona pra /login?senha_redefinida=1', async ({ page }) => {
    await entrarNoPainel(page);
    let corpoEnviado = null;
    await page.route('**/api/perfil/senha', (route) => {
      corpoEnviado = route.request().postDataJSON();
      return route.fulfill({ json: { ok: true } });
    });
    await page.route('**/login*', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<h1>login</h1>' }));

    await page.fill('#senha_atual', 'SenhaAtual123');
    await page.fill('#senha_nova', 'SenhaNova123');
    await page.fill('#senha_repetir', 'SenhaNova123');
    await page.click('#btn-salvar-senha');

    await expect(page).toHaveURL(/\/login\?senha_redefinida=1/);
    expect(corpoEnviado).toMatchObject({ senha_atual: 'SenhaAtual123', senha_nova: 'SenhaNova123' });
    expect(await page.evaluate(() => window.localStorage.getItem('kyvvo_token'))).toBeNull();
  });
});
