const { test, expect } = require('@playwright/test');

// Cobre US82.2 — estrutura de 3 passos do onboarding pós-cadastro
// (/onboarding): indicador "Passo X de 3", navegação com "Voltar" sem perder
// o que já foi preenchido e "Fazer isso depois" levando ao painel sem exigir
// nada. O conteúdo específico de cada passo (validação completa do nome do
// negócio, cartões de segmento, sugestões de serviço por segmento) é escopo
// das subtasks US82.3/US82.4/US82.5 — aqui só a mecânica do wizard em si.
// APIs mockadas via page.route — sem dependência de Postgres real.

const SEGMENTOS = [
  { id: 1, nome: 'Salão de beleza' },
  { id: 2, nome: 'Petshop' },
];

async function mockPainelApis(page) {
  await page.route('**/api/configuracao', (route) =>
    route.fulfill({ json: { dias_funcionamento: [1, 2, 3, 4, 5, 6], formato_hora: '24h' } })
  );
  await page.route('**/api/agendamentos**', (route) =>
    route.fulfill({ json: { view: 'dia', data: '2026-08-09', agendamentos: [] } })
  );
  await page.route('**/api/tenant/status', (route) =>
    route.fulfill({
      json: {
        email_verified: true,
        status: 'ativo',
        trial_ativo: true,
        dias_restantes: 10,
        pagamento_pendente: false,
        onboarding_dispensado: false,
        configuracao: { sem_servicos: false, sem_profissionais: false, whatsapp_desconectado: false, horario_nao_confirmado: false },
      },
    })
  );
}

async function abrirOnboarding(page) {
  await page.route('**/api/segmentos', (route) => route.fulfill({ json: { segmentos: SEGMENTOS } }));
  await mockPainelApis(page);
  await page.addInitScript(() => {
    window.localStorage.setItem('kyvvo_token', 'fake-jwt-token');
    window.localStorage.setItem('kyvvo_nome', 'Ana');
  });
  await page.goto('/onboarding');
}

test.describe('Guarda de rota (/onboarding)', () => {
  test('sem sessão, redireciona para /login.html', async ({ page }) => {
    await page.goto('/onboarding');
    await expect(page).toHaveURL(/\/login\.html$/);
  });
});

test.describe('Estrutura de 3 passos do onboarding (US82.2)', () => {
  test('inicia no passo 1 com o indicador "Passo 1 de 3"', async ({ page }) => {
    await abrirOnboarding(page);
    await expect(page.locator('#wizard-progresso-texto')).toHaveText('Passo 1 de 3');
    await expect(page.locator('#wizard-passo-1')).toBeVisible();
    await expect(page.locator('#wizard-passo-2')).toBeHidden();
    await expect(page.locator('#btn-voltar')).toBeHidden();
  });

  test('não avança do passo 1 sem preencher o nome do negócio', async ({ page }) => {
    await abrirOnboarding(page);
    await page.click('#btn-avancar');

    await expect(page.locator('#wizard-progresso-texto')).toHaveText('Passo 1 de 3');
    await expect(page.locator('#erro-nome_negocio')).toHaveText('Informe o nome do seu negócio.');
    await expect(page.locator('#nome_negocio')).toHaveClass(/invalid/);
  });

  test('avança pelos 3 passos e mostra o segmento carregado do catálogo', async ({ page }) => {
    await abrirOnboarding(page);
    await page.fill('#nome_negocio', 'Studio Bela');
    await page.click('#btn-avancar');

    await expect(page.locator('#wizard-progresso-texto')).toHaveText('Passo 2 de 3');
    await expect(page.locator('#wizard-passo-2')).toBeVisible();
    await expect(page.locator('#segmento option')).toHaveCount(3); // opção vazia + 2 segmentos
    await expect(page.locator('#segmento option').nth(1)).toHaveText('Salão de beleza');

    await page.click('#btn-avancar');
    await expect(page.locator('#wizard-progresso-texto')).toHaveText('Passo 3 de 3');
    await expect(page.locator('#wizard-passo-3')).toBeVisible();
    await expect(page.locator('#btn-avancar')).toHaveText('Concluir');
  });

  test('"Voltar" preserva o nome do negócio já preenchido (CA02)', async ({ page }) => {
    await abrirOnboarding(page);
    await page.fill('#nome_negocio', 'Studio Bela');
    await page.click('#btn-avancar');
    await expect(page.locator('#wizard-progresso-texto')).toHaveText('Passo 2 de 3');

    await page.click('#btn-voltar');
    await expect(page.locator('#wizard-progresso-texto')).toHaveText('Passo 1 de 3');
    await expect(page.locator('#nome_negocio')).toHaveValue('Studio Bela');
  });

  test('passo 3 permite adicionar e remover serviços livremente', async ({ page }) => {
    await abrirOnboarding(page);
    await page.fill('#nome_negocio', 'Studio Bela');
    await page.click('#btn-avancar');
    await page.click('#btn-avancar');

    await page.fill('#novo_servico', 'Corte de cabelo');
    await page.click('#btn-adicionar-servico');
    await expect(page.locator('.wizard-servico-item')).toHaveCount(1);
    await expect(page.locator('.wizard-servico-item')).toContainText('Corte de cabelo');

    await page.click('.wizard-servico-remover');
    await expect(page.locator('.wizard-servico-item')).toHaveCount(0);
  });

  test('"Fazer isso depois" leva ao painel a partir de qualquer passo, sem exigir nada preenchido', async ({ page }) => {
    await abrirOnboarding(page);
    await page.click('#btn-pular');
    await expect(page).toHaveURL(/\/painel\.html$/);
  });

  test('"Concluir" no último passo leva ao painel', async ({ page }) => {
    await abrirOnboarding(page);
    await page.fill('#nome_negocio', 'Studio Bela');
    await page.click('#btn-avancar');
    await page.click('#btn-avancar');
    await page.click('#btn-avancar');

    await expect(page).toHaveURL(/\/painel\.html$/);
  });
});
