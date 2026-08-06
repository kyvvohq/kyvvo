const { test, expect } = require('@playwright/test');

// Cobre US66 — modal de primeiros passos (serviços, horário de funcionamento
// e WhatsApp) exibido automaticamente só no primeiro acesso elegível, sem
// item fixo na sidebar (substitui a tela dedicada + item fixo da US56):
// checklist com próximo passo recomendado, navegação pros cadastros,
// "Pular por agora" (dispensa persistida no backend) e reentrada sem
// reexibir depois de pular/concluir. As chamadas de API são mockadas via
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

test.describe('Modal de primeiros passos (US66)', () => {
  test('menu lateral nunca tem item fixo de primeiros passos (US66/Cenário 2)', async ({ page }) => {
    const status = { ...STATUS_BASE, configuracao: { ...STATUS_BASE.configuracao, sem_servicos: true } };
    await entrarNoPainel(page, status);

    await expect(page.locator('#menu-item-onboarding')).toHaveCount(0);
    await expect(page.locator('.menu-item', { hasText: 'Primeiros passos' })).toHaveCount(0);
    // Navegação principal continua disponível normalmente.
    await expect(page.locator('.menu-item[data-menu="inicio"]')).toBeVisible();
    await expect(page.locator('.menu-item[data-menu="agendamento"]')).toBeVisible();
  });

  test('configuração completa: modal não aparece (US66/Cenário 5 — concluído)', async ({ page }) => {
    await entrarNoPainel(page, STATUS_BASE);
    await page.waitForLoadState('networkidle');

    await expect(page.locator('.modal-overlay')).toHaveCount(0);
    await expect(page.locator('.menu-item[data-menu="agendamento"]')).toHaveClass(/active/);
  });

  test('primeiro acesso com serviços pendentes mostra o modal automaticamente (US66/Cenário 1)', async ({ page }) => {
    const status = { ...STATUS_BASE, configuracao: { ...STATUS_BASE.configuracao, sem_servicos: true } };
    await entrarNoPainel(page, status);

    await expect(page.locator('.modal-overlay')).toBeVisible();
    await expect(page.locator('.onboarding-cabecalho h2')).toHaveText('Primeiros passos');
    // A tela por trás continua a mesma (não é mais um redirecionamento de tela).
    await expect(page.locator('.menu-item[data-menu="agendamento"]')).toHaveClass(/active/);
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

  test('clicar no botão do passo pendente fecha o modal e navega pro cadastro correspondente', async ({ page }) => {
    const status = { ...STATUS_BASE, configuracao: { ...STATUS_BASE.configuracao, sem_servicos: true } };
    await entrarNoPainel(page, status);
    await page.route('**/api/servicos', (route) => route.fulfill({ json: { servicos: [] } }));
    await page.route('**/api/profissionais', (route) => route.fulfill({ json: { profissionais: [] } }));

    await page.click('[data-acao-onboarding-passo="servicos"]');

    await expect(page.locator('.modal-overlay')).toHaveCount(0);
    await expect(page.locator('.nav-periodo strong')).toHaveText('Serviços');
  });

  test('"Pular por agora" fecha o modal, persiste a dispensa e não bloqueia o painel (US66/Cenário 3)', async ({ page }) => {
    const status = { ...STATUS_BASE, configuracao: { ...STATUS_BASE.configuracao, sem_servicos: true } };
    await entrarNoPainel(page, status);

    let dispensarChamado = false;
    await page.route('**/api/onboarding/dispensar', (route) => {
      dispensarChamado = true;
      return route.fulfill({ json: { ok: true } });
    });

    await page.click('#btn-pular-onboarding');

    await expect(page.locator('.modal-overlay')).toHaveCount(0);
    expect(dispensarChamado).toBe(true);
    // Painel continua utilizável por trás — nenhum bloqueio de tela.
    await expect(page.locator('.menu-item[data-menu="agendamento"]')).toHaveClass(/active/);
  });

  test('checklist já dispensado não mostra o modal automaticamente (US66/Cenário 3 — reentrada)', async ({ page }) => {
    const status = {
      ...STATUS_BASE,
      onboarding_dispensado: true,
      configuracao: { ...STATUS_BASE.configuracao, sem_servicos: true },
    };
    await entrarNoPainel(page, status);
    await page.waitForLoadState('networkidle');

    await expect(page.locator('.modal-overlay')).toHaveCount(0);
    await expect(page.locator('.menu-item[data-menu="agendamento"]')).toHaveClass(/active/);
  });

  test('fechar o modal sem decidir não persiste nada e ele reaparece no próximo carregamento (US66/Cenário 5)', async ({ page }) => {
    const status = { ...STATUS_BASE, configuracao: { ...STATUS_BASE.configuracao, sem_servicos: true } };
    await entrarNoPainel(page, status);

    let dispensarChamado = false;
    await page.route('**/api/onboarding/dispensar', (route) => {
      dispensarChamado = true;
      return route.fulfill({ json: { ok: true } });
    });

    await expect(page.locator('.modal-overlay')).toBeVisible();
    await page.click('#modal-close');
    await expect(page.locator('.modal-overlay')).toHaveCount(0);
    expect(dispensarChamado).toBe(false);

    await page.reload();
    await expect(page.locator('.modal-overlay')).toBeVisible();
    await expect(page.locator('.onboarding-cabecalho h2')).toHaveText('Primeiros passos');
  });

  test('modal cabe na tela e permanece utilizável em viewport mobile (US66/Cenário 6)', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 700 });
    const status = { ...STATUS_BASE, configuracao: { ...STATUS_BASE.configuracao, sem_servicos: true } };
    await entrarNoPainel(page, status);

    const card = page.locator('.modal-card-onboarding');
    await expect(card).toBeVisible();
    const box = await card.boundingBox();
    expect(box.width).toBeLessThanOrEqual(375);
    await expect(page.locator('#btn-pular-onboarding')).toBeVisible();
  });
});
