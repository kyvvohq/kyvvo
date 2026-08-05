const { test, expect } = require('@playwright/test');

// Cobre US56 — checklist de onboarding guiado (serviços, horário de
// funcionamento e WhatsApp): redirecionamento automático no primeiro acesso
// com configuração incompleta, item "Primeiros passos" na sidebar, próximo
// passo recomendado, navegação pros cadastros e "Pular por agora"
// (dispensa persistida no backend). As chamadas de API são mockadas via
// page.route — sem dependência de Postgres real.

const STATUS_BASE = {
  email_verified: true,
  status: 'ativo',
  trial_ativo: false,
  dias_restantes: null,
  pagamento_pendente: false,
  onboarding_dispensado: false,
  configuracao: { sem_servicos: false, sem_profissionais: false, whatsapp_desconectado: false, horario_nao_confirmado: false },
};

async function entrarNoPainel(page, status) {
  await page.route('**/api/configuracao', (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    return route.fulfill({ json: { dias_funcionamento: [1, 2, 3, 4, 5, 6], formato_hora: '24h', segmento: 'salao_beleza' } });
  });
  await page.route('**/api/agendamentos**', (route) =>
    route.fulfill({ json: { view: 'dia', data: '2026-07-09', agendamentos: [] } })
  );
  await page.route('**/api/tenant/status', (route) => route.fulfill({ json: status }));
  await page.addInitScript(() => {
    window.localStorage.setItem('kyvvo_token', 'fake-jwt-token');
    window.localStorage.setItem('kyvvo_nome', 'Ana');
  });
  await page.goto('/painel.html');
}

test.describe('Onboarding guiado (US56)', () => {
  test('configuração completa: sem redirecionamento e item da sidebar escondido', async ({ page }) => {
    await entrarNoPainel(page, STATUS_BASE);
    await expect(page.locator('.menu-item[data-menu="agendamento"]')).toHaveClass(/active/);
    await expect(page.locator('#menu-item-onboarding')).toBeHidden();
  });

  test('primeiro acesso com serviços pendentes é levado direto pro checklist (CA "primeiro acesso identifica configuração incompleta")', async ({ page }) => {
    const status = { ...STATUS_BASE, configuracao: { ...STATUS_BASE.configuracao, sem_servicos: true } };
    await entrarNoPainel(page, status);

    await expect(page.locator('.menu-item[data-menu="onboarding"]')).toHaveClass(/active/);
    await expect(page.locator('.onboarding-cabecalho h2')).toHaveText('Primeiros passos');
    await expect(page.locator('#menu-item-onboarding')).toBeVisible();
  });

  test('checklist mostra os 3 passos, marca os concluídos e destaca o próximo passo recomendado', async ({ page }) => {
    // Serviços já cadastrados, mas horário não revisado e WhatsApp
    // desconectado — "horário" deve ser o próximo passo recomendado (é o
    // primeiro pendente na ordem servicos → horario → whatsapp).
    const status = {
      ...STATUS_BASE,
      configuracao: { sem_servicos: false, sem_profissionais: false, whatsapp_desconectado: true, horario_nao_confirmado: true },
    };
    await entrarNoPainel(page, status);

    const passos = page.locator('.onboarding-passo');
    await expect(passos).toHaveCount(3);
    await expect(passos.nth(0)).toHaveClass(/onboarding-passo-feito/);
    await expect(passos.nth(1)).toHaveClass(/onboarding-passo-recomendado/);
    await expect(passos.nth(1)).toContainText('Confirme seu horário de funcionamento');
    await expect(passos.nth(1)).toContainText('Próximo passo recomendado');
    await expect(passos.nth(2)).not.toHaveClass(/onboarding-passo-recomendado/);
    await expect(page.locator('.onboarding-progresso span')).toHaveText('1 de 3 concluídos');
  });

  test('clicar no botão do passo pendente navega direto pro cadastro correspondente', async ({ page }) => {
    const status = { ...STATUS_BASE, configuracao: { ...STATUS_BASE.configuracao, sem_servicos: true } };
    await entrarNoPainel(page, status);
    await page.route('**/api/servicos', (route) => route.fulfill({ json: { servicos: [] } }));
    await page.route('**/api/profissionais', (route) => route.fulfill({ json: { profissionais: [] } }));

    await page.click('[data-acao-onboarding-passo="servicos"]');
    await expect(page.locator('.nav-periodo strong')).toHaveText('Serviços');
  });

  test('"Pular por agora" chama a API de dispensa e volta pro Início', async ({ page }) => {
    const status = { ...STATUS_BASE, configuracao: { ...STATUS_BASE.configuracao, sem_servicos: true } };
    await entrarNoPainel(page, status);

    let dispensarChamado = false;
    await page.route('**/api/onboarding/dispensar', (route) => {
      dispensarChamado = true;
      return route.fulfill({ json: { ok: true } });
    });

    await page.click('#btn-pular-onboarding');
    await expect(page.locator('.menu-item[data-menu="inicio"]')).toHaveClass(/active/);
    expect(dispensarChamado).toBe(true);
    // Item continua na sidebar — checklist ainda incompleto, só o
    // redirecionamento automático que não deve repetir (CA "retomar depois").
    await expect(page.locator('#menu-item-onboarding')).toBeVisible();
  });

  test('checklist já dispensado não redireciona automaticamente, mas o item continua acessível na sidebar', async ({ page }) => {
    const status = {
      ...STATUS_BASE,
      onboarding_dispensado: true,
      configuracao: { ...STATUS_BASE.configuracao, sem_servicos: true },
    };
    await entrarNoPainel(page, status);

    await expect(page.locator('.menu-item[data-menu="agendamento"]')).toHaveClass(/active/);
    await expect(page.locator('#menu-item-onboarding')).toBeVisible();

    await page.click('.menu-item[data-menu="onboarding"]');
    await expect(page.locator('.onboarding-cabecalho h2')).toHaveText('Primeiros passos');
  });

  test('checklist completo não mostra "Pular por agora"', async ({ page }) => {
    await entrarNoPainel(page, STATUS_BASE);
    await page.waitForLoadState('networkidle');
    // Item escondido na sidebar (checklist já completo) — desmarca o hidden
    // só pra conseguir chegar na tela por um clique normal, mesmo sem um
    // jeito de fazer isso na UI de verdade nesse estado.
    await page.evaluate(() => { document.getElementById('menu-item-onboarding').hidden = false; });
    await page.click('.menu-item[data-menu="onboarding"]');
    await expect(page.locator('.onboarding-progresso span')).toHaveText('3 de 3 concluídos');
    await expect(page.locator('#btn-pular-onboarding')).toHaveCount(0);
  });
});
