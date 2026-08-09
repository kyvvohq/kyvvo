const { test, expect } = require('@playwright/test');

// Cobre US38: página de Configurações do sistema na área admin (preços dos
// planos + configurações gerais + log de auditoria). API mockada via
// page.route — sem dependência de Postgres real.

function configuracoesMock(overrides = {}) {
  return {
    planos: [
      { chave: 'starter', nome: 'Starter', descricao: 'Acesso web + bot WhatsApp', preco_mensal: 147, limite_disparos: 100, ativo: true, atualizado_em: '2026-07-01T10:00:00Z' },
      { chave: 'profissional', nome: 'Profissional', descricao: 'Web + app mobile + 500 disparos', preco_mensal: 247, limite_disparos: 500, ativo: true, atualizado_em: '2026-07-01T10:00:00Z' },
      { chave: 'empresarial', nome: 'Empresarial', descricao: 'Tudo + multi-unidades + disparos ilimitados', preco_mensal: 447, limite_disparos: null, ativo: false, atualizado_em: '2026-07-01T10:00:00Z' },
    ],
    sistema: {
      trial_dias: '14',
      carencia_dias_inadimplencia: '3',
      max_tentativas_reenvio_token: '5',
      email_suporte: 'suporte@kyvvo.com.br',
      whatsapp_suporte: '553484285182',
    },
    log: [
      { campo: 'planos.starter.preco_mensal', valor_anterior: '137', valor_novo: '147', alterado_em: '2026-07-15T09:00:00Z', alterado_por_nome: 'Equipe Kyvvo' },
    ],
    ...overrides,
  };
}

async function entrarEmConfiguracoes(page, configuracoes) {
  await page.route('**/admin/api/configuracoes', (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    return route.fulfill({ json: configuracoes });
  });
  await page.addInitScript(() => {
    window.localStorage.setItem('kyvvo_admin_token', 'admin-token-fake');
    window.localStorage.setItem('kyvvo_admin_nome', 'Equipe Kyvvo');
  });
  await page.goto('/admin/configuracoes.html');
}

test.describe('Admin — Configurações do sistema (US38)', () => {
  test('redireciona para o login se não autenticado como admin', async ({ page }) => {
    await page.goto('/admin/configuracoes.html');
    await expect(page).toHaveURL(/\/admin\/login\.html/);
  });

  test('lista os planos com nome, descrição, preço, limite e status (CA02)', async ({ page }) => {
    await entrarEmConfiguracoes(page, configuracoesMock());

    const linhaStarter = page.locator('tr[data-plano="starter"]');
    await expect(linhaStarter).toContainText('Starter');
    await expect(linhaStarter).toContainText('Acesso web + bot WhatsApp');
    await expect(linhaStarter).toContainText('R$ 147,00');
    await expect(linhaStarter).toContainText('100');

    const linhaEmpresarial = page.locator('tr[data-plano="empresarial"]');
    await expect(linhaEmpresarial).toContainText('Ilimitado');
    await expect(linhaEmpresarial.locator('[data-acao="toggle-ativo-plano"]')).toHaveClass(/toggle-off/);
  });

  test('link "Configurações" está disponível no painel admin', async ({ page }) => {
    await page.route('**/admin/api/tenants', (route) => route.fulfill({ json: { tenants: [] } }));
    await page.addInitScript(() => {
      window.localStorage.setItem('kyvvo_admin_token', 'admin-token-fake');
      window.localStorage.setItem('kyvvo_admin_nome', 'Equipe Kyvvo');
    });
    await page.goto('/admin/painel.html');
    await expect(page.locator('a[href="/admin/configuracoes.html"]')).toBeVisible();
  });

  test('editar preço de um plano: banner de aviso aparece e some ao cancelar (CA03/CA04)', async ({ page }) => {
    await entrarEmConfiguracoes(page, configuracoesMock());

    await expect(page.locator('.banner-aviso')).toHaveCount(0);
    await page.click('tr[data-plano="starter"] [data-acao="editar-plano"]');
    await expect(page.locator('.banner-aviso')).toContainText('alterações de preço afetam apenas novas assinaturas');

    await page.click('tr[data-plano="starter"] [data-acao="cancelar-plano"]');
    await expect(page.locator('.banner-aviso')).toHaveCount(0);
    await expect(page.locator('tr[data-plano="starter"] [data-acao="editar-plano"]')).toBeVisible();
  });

  test('salva um novo preço com sucesso (CA03/CA09)', async ({ page }) => {
    await entrarEmConfiguracoes(page, configuracoesMock());

    let corpoEnviado = null;
    await page.route('**/admin/api/configuracoes/planos/starter', (route) => {
      corpoEnviado = route.request().postDataJSON();
      return route.fulfill({
        json: { chave: 'starter', nome: 'Starter', descricao: 'Acesso web + bot WhatsApp', preco_mensal: 167, limite_disparos: 100, ativo: true, atualizado_em: '2026-07-17T12:00:00Z' },
      });
    });

    await page.click('tr[data-plano="starter"] [data-acao="editar-plano"]');
    await page.fill('tr[data-plano="starter"] .input-plano-preco', '167');
    await page.click('tr[data-plano="starter"] [data-acao="salvar-plano"]');

    await expect(page.locator('.toast-sucesso')).toHaveText(/Preço atualizado/);
    expect(corpoEnviado).toMatchObject({ preco_mensal: 167 });
  });

  test('preço abaixo de R$ 1 não salva e mostra erro (CA03)', async ({ page }) => {
    await entrarEmConfiguracoes(page, configuracoesMock());

    let chamou = false;
    await page.route('**/admin/api/configuracoes/planos/starter', () => { chamou = true; });

    await page.click('tr[data-plano="starter"] [data-acao="editar-plano"]');
    await page.fill('tr[data-plano="starter"] .input-plano-preco', '0');
    await page.click('tr[data-plano="starter"] [data-acao="salvar-plano"]');

    await expect(page.locator('tr[data-plano="starter"] [data-erro-plano="starter"]')).toHaveText(/mínimo R\$ 1,00/);
    expect(chamou).toBe(false);
  });

  test('erro do backend ao salvar aparece na linha', async ({ page }) => {
    await entrarEmConfiguracoes(page, configuracoesMock());
    await page.route('**/admin/api/configuracoes/planos/starter', (route) =>
      route.fulfill({ status: 400, json: { error: 'Preço mensal deve ser no mínimo R$ 1,00.' } })
    );

    await page.click('tr[data-plano="starter"] [data-acao="editar-plano"]');
    await page.fill('tr[data-plano="starter"] .input-plano-preco', '5');
    await page.click('tr[data-plano="starter"] [data-acao="salvar-plano"]');

    await expect(page.locator('tr[data-plano="starter"] [data-erro-plano="starter"]')).toHaveText(/mínimo R\$ 1,00/);
  });

  test('alterna o status ativo de um plano imediatamente, sem modo de edição (CA02)', async ({ page }) => {
    await entrarEmConfiguracoes(page, configuracoesMock());

    let corpoEnviado = null;
    await page.route('**/admin/api/configuracoes/planos/empresarial', (route) => {
      corpoEnviado = route.request().postDataJSON();
      return route.fulfill({
        json: { chave: 'empresarial', nome: 'Empresarial', descricao: 'Tudo + multi-unidades + disparos ilimitados', preco_mensal: 447, limite_disparos: null, ativo: true, atualizado_em: '2026-07-17T12:00:00Z' },
      });
    });

    await page.click('tr[data-plano="empresarial"] [data-acao="toggle-ativo-plano"]');

    await expect(page.locator('.toast-sucesso')).toHaveText(/ativado/);
    expect(corpoEnviado).toMatchObject({ ativo: true });
  });

  test('lista as configurações gerais e edita uma delas (CA06)', async ({ page }) => {
    await entrarEmConfiguracoes(page, configuracoesMock());

    const linhaTrial = page.locator('tr[data-config="trial_dias"]');
    await expect(linhaTrial).toContainText('Dias de trial');
    await expect(linhaTrial).toContainText('14');

    let corpoEnviado = null;
    await page.route('**/admin/api/configuracoes/sistema', (route) => {
      corpoEnviado = route.request().postDataJSON();
      return route.fulfill({ json: { ...configuracoesMock().sistema, trial_dias: '21' } });
    });

    await page.click('tr[data-config="trial_dias"] [data-acao="editar-config"]');
    await page.fill('tr[data-config="trial_dias"] .input-config-valor', '21');
    await page.click('tr[data-config="trial_dias"] [data-acao="salvar-config"]');

    await expect(page.locator('.toast-sucesso')).toHaveText(/Configuração atualizada/);
    expect(corpoEnviado).toMatchObject({ trial_dias: '21' });
  });

  test('configuração numérica inválida não salva e mostra erro (CA06)', async ({ page }) => {
    await entrarEmConfiguracoes(page, configuracoesMock());

    let chamou = false;
    await page.route('**/admin/api/configuracoes/sistema', () => { chamou = true; });

    await page.click('tr[data-config="trial_dias"] [data-acao="editar-config"]');
    await page.fill('tr[data-config="trial_dias"] .input-config-valor', '-5');
    await page.click('tr[data-config="trial_dias"] [data-acao="salvar-config"]');

    await expect(page.locator('tr[data-config="trial_dias"] [data-erro-config="trial_dias"]')).toContainText('número inteiro maior que zero');
    expect(chamou).toBe(false);
  });

  test('mostra o log de auditoria com as últimas alterações (CA07)', async ({ page }) => {
    await entrarEmConfiguracoes(page, configuracoesMock());

    const linhaLog = page.locator('.tabela-tenants').last().locator('tbody tr').first();
    await expect(linhaLog).toContainText('planos.starter.preco_mensal');
    await expect(linhaLog).toContainText('137');
    await expect(linhaLog).toContainText('147');
    await expect(linhaLog).toContainText('Equipe Kyvvo');
  });

  test('sem alterações registradas, mostra mensagem vazia no log', async ({ page }) => {
    await entrarEmConfiguracoes(page, configuracoesMock({ log: [] }));

    const linhaLog = page.locator('.tabela-tenants').last().locator('tbody tr').first();
    await expect(linhaLog).toContainText('Nenhuma alteração registrada ainda.');
  });
});

// US67 — grade 2x2 (tecnologia bot/ia x tipo_numero proprio/kyvvo): o
// catálogo de planos ganha 4 planos com slug/tecnologia/tipo_numero
// (somente leitura) e destaque/badge (editáveis).
// US72 — nome/slug renomeados pelo eixo de valor; `chave` (identificador
// interno, usado em data-plano/rota do PATCH) nunca muda.
function planosGrade2x2() {
  return [
    { chave: 'starter', slug: 'essencial', nome: 'Essencial', descricao: 'Bot de agendamento + número próprio', tecnologia: 'bot', tipo_numero: 'proprio', preco_mensal: 79.9, limite_disparos: 100, destaque: false, badge: null, headline_diferencial: 'Seu número, atendimento guiado', frase_beneficio: 'A cliente escolhe o serviço e o horário por listas e botões.', herda_de: null, features: [{ id: 'f1', label: 'Fluxo guiado', ordem: 1 }], limites: { conversas_mes: 100, profissionais: 3, unidades: 1 }, ativo: true, atualizado_em: '2026-08-01T10:00:00Z' },
    { chave: 'business', slug: 'essencial-plus', nome: 'Essencial Plus', descricao: 'Bot de agendamento + número Kyvvo pronto', tecnologia: 'bot', tipo_numero: 'kyvvo', preco_mensal: 119.9, limite_disparos: 100, destaque: false, badge: null, headline_diferencial: 'Número pronto, zero configuração', frase_beneficio: 'A gente entrega o número já ativo.', herda_de: 'starter', features: [], limites: { conversas_mes: 100, profissionais: 3, unidades: 1 }, ativo: true, atualizado_em: '2026-08-01T10:00:00Z' },
    { chave: 'professional', slug: 'smart', nome: 'Smart', descricao: 'IA conversacional + número próprio', tecnologia: 'ia', tipo_numero: 'proprio', preco_mensal: 149.9, limite_disparos: 500, destaque: false, badge: null, headline_diferencial: 'Seu número, atendimento que conversa', frase_beneficio: 'A cliente escreve como fala e o bot resolve.', herda_de: 'starter', features: [{ id: 'f2', label: 'Bot entende linguagem natural', ordem: 1 }], limites: { conversas_mes: 500, profissionais: 5, unidades: 1 }, ativo: true, atualizado_em: '2026-08-01T10:00:00Z' },
    { chave: 'enterprise', slug: 'smart-plus', nome: 'Smart Plus', descricao: 'IA conversacional + número Kyvvo pronto', tecnologia: 'ia', tipo_numero: 'kyvvo', preco_mensal: 179.9, limite_disparos: 500, destaque: true, badge: 'Mais popular', headline_diferencial: 'Número pronto, atendimento premium', frase_beneficio: 'Sem configuração, atendimento completo.', herda_de: 'professional', features: [], limites: { conversas_mes: null, profissionais: 5, unidades: 1 }, ativo: true, atualizado_em: '2026-08-01T10:00:00Z' },
  ];
}

test.describe('Admin — Configurações — grade 2x2 de planos (US67/CA04)', () => {
  test('exibe os 4 planos com slug, tecnologia e tipo de número', async ({ page }) => {
    await entrarEmConfiguracoes(page, configuracoesMock({ planos: planosGrade2x2() }));

    for (const chave of ['starter', 'business', 'professional', 'enterprise']) {
      await expect(page.locator(`tr[data-plano="${chave}"]`)).toBeVisible();
    }

    const linhaEnterprise = page.locator('tr[data-plano="enterprise"]');
    await expect(linhaEnterprise).toContainText('Smart Plus');
    await expect(linhaEnterprise.locator('[data-testid="slug-enterprise"]')).toHaveText('smart-plus');
    await expect(linhaEnterprise).toContainText('IA');
    await expect(linhaEnterprise).toContainText('Número Kyvvo');
    await expect(linhaEnterprise).toContainText('Mais popular');
  });

  test('slug, tecnologia e tipo de número não têm botão de edição (somente leitura)', async ({ page }) => {
    await entrarEmConfiguracoes(page, configuracoesMock({ planos: planosGrade2x2() }));

    await page.click('tr[data-plano="enterprise"] [data-acao="editar-plano"]');
    const slugCell = page.getByTestId('slug-enterprise');
    await expect(slugCell.locator('input')).toHaveCount(0);
  });

  test('edita o badge de um plano (CA04)', async ({ page }) => {
    await entrarEmConfiguracoes(page, configuracoesMock({ planos: planosGrade2x2() }));

    let corpoEnviado = null;
    await page.route('**/admin/api/configuracoes/planos/professional', (route) => {
      corpoEnviado = route.request().postDataJSON();
      return route.fulfill({ json: { ...planosGrade2x2()[2], badge: 'Recomendado' } });
    });

    await page.click('tr[data-plano="professional"] [data-acao="editar-plano"]');
    await page.fill('tr[data-plano="professional"] .input-plano-badge', 'Recomendado');
    await page.click('tr[data-plano="professional"] [data-acao="salvar-plano"]');

    await expect(page.locator('.toast-sucesso')).toHaveText(/Preço atualizado/);
    expect(corpoEnviado).toMatchObject({ badge: 'Recomendado' });
  });

  test('alterna o destaque de um plano imediatamente, sem modo de edição (CA04)', async ({ page }) => {
    await entrarEmConfiguracoes(page, configuracoesMock({ planos: planosGrade2x2() }));

    let corpoEnviado = null;
    await page.route('**/admin/api/configuracoes/planos/starter', (route) => {
      corpoEnviado = route.request().postDataJSON();
      return route.fulfill({ json: { ...planosGrade2x2()[0], destaque: true } });
    });

    await page.click('tr[data-plano="starter"] [data-acao="toggle-destaque-plano"]');

    await expect(page.locator('.toast-sucesso')).toHaveText(/Destaque ativado/);
    expect(corpoEnviado).toMatchObject({ destaque: true });
  });
});

// US74/CA05 — diferenciais (3 campos fixos) e limites de uso editáveis no
// admin.
test.describe('Admin — Configurações — diferenciais e limites dos planos (US74/CA05)', () => {
  test('exibe as features e os limites de cada plano (somente leitura)', async ({ page }) => {
    await entrarEmConfiguracoes(page, configuracoesMock({ planos: planosGrade2x2() }));

    const linhaSmart = page.locator('tr[data-plano="professional"]');
    await expect(linhaSmart).toContainText('Bot entende linguagem natural');
    await expect(linhaSmart).toContainText('Conversas/mês: 500');

    const linhaSmartPlus = page.locator('tr[data-plano="enterprise"]');
    await expect(linhaSmartPlus).toContainText('Conversas/mês: Ilimitado');
  });

  test('adiciona uma feature e persiste', async ({ page }) => {
    await entrarEmConfiguracoes(page, configuracoesMock({ planos: planosGrade2x2() }));

    let corpoEnviado = null;
    await page.route('**/admin/api/configuracoes/planos/business', (route) => {
      corpoEnviado = route.request().postDataJSON();
      return route.fulfill({ json: { ...planosGrade2x2()[1] } });
    });

    await page.click('tr[data-plano="business"] [data-acao="editar-plano"]');
    await page.fill('[data-testid="input-feature-1-business"]', 'Número virtual gerenciado pelo Kyvvo');
    await page.click('[data-testid="salvar-business"]');

    await expect(page.locator('.toast-sucesso')).toHaveText(/Preço atualizado/);
    expect(corpoEnviado.features).toEqual(['Número virtual gerenciado pelo Kyvvo']);
  });

  test('só 3 campos de feature existem — impossível adicionar uma 4ª', async ({ page }) => {
    await entrarEmConfiguracoes(page, configuracoesMock({ planos: planosGrade2x2() }));

    await page.click('tr[data-plano="professional"] [data-acao="editar-plano"]');
    await expect(page.locator('[data-testid="input-feature-1-professional"]')).toBeVisible();
    await expect(page.locator('[data-testid="input-feature-2-professional"]')).toBeVisible();
    await expect(page.locator('[data-testid="input-feature-3-professional"]')).toBeVisible();
    await expect(page.locator('[data-testid="input-feature-4-professional"]')).toHaveCount(0);
  });

  test('salva limite em branco como ilimitado (null)', async ({ page }) => {
    await entrarEmConfiguracoes(page, configuracoesMock({ planos: planosGrade2x2() }));

    let corpoEnviado = null;
    await page.route('**/admin/api/configuracoes/planos/enterprise', (route) => {
      corpoEnviado = route.request().postDataJSON();
      return route.fulfill({ json: { ...planosGrade2x2()[3] } });
    });

    await page.click('tr[data-plano="enterprise"] [data-acao="editar-plano"]');
    await page.fill('[data-testid="input-limite-conversas_mes-enterprise"]', '');
    await page.click('[data-testid="salvar-enterprise"]');

    await expect(page.locator('.toast-sucesso')).toHaveText(/Preço atualizado/);
    expect(corpoEnviado.limites.conversas_mes).toBeNull();
  });

  test('edita o valor numérico de um limite', async ({ page }) => {
    await entrarEmConfiguracoes(page, configuracoesMock({ planos: planosGrade2x2() }));

    let corpoEnviado = null;
    await page.route('**/admin/api/configuracoes/planos/professional', (route) => {
      corpoEnviado = route.request().postDataJSON();
      return route.fulfill({ json: { ...planosGrade2x2()[2] } });
    });

    await page.click('tr[data-plano="professional"] [data-acao="editar-plano"]');
    await page.fill('[data-testid="input-limite-profissionais-professional"]', '8');
    await page.click('[data-testid="salvar-professional"]');

    expect(corpoEnviado.limites.profissionais).toBe(8);
  });
});

// US73/CA04 — copy de diferencial (headline + frase de benefício) editável
// no admin, com limite de 120 caracteres validado em tempo real.
test.describe('Admin — Configurações — copy de diferencial dos planos (US73/CA04)', () => {
  test('exibe headline e frase de benefício de cada plano (somente leitura)', async ({ page }) => {
    await entrarEmConfiguracoes(page, configuracoesMock({ planos: planosGrade2x2() }));

    const linhaSmart = page.locator('tr[data-plano="professional"]');
    await expect(linhaSmart).toContainText('Seu número, atendimento que conversa');
    await expect(linhaSmart).toContainText('A cliente escreve como fala e o bot resolve.');
  });

  test('edita a headline e a frase de benefício', async ({ page }) => {
    await entrarEmConfiguracoes(page, configuracoesMock({ planos: planosGrade2x2() }));

    let corpoEnviado = null;
    await page.route('**/admin/api/configuracoes/planos/professional', (route) => {
      corpoEnviado = route.request().postDataJSON();
      return route.fulfill({ json: { ...planosGrade2x2()[2], headline_diferencial: 'Atendimento que conversa' } });
    });

    await page.click('tr[data-plano="professional"] [data-acao="editar-plano"]');
    await page.fill('[data-testid="input-headline-professional"]', 'Atendimento que conversa');
    await page.click('[data-testid="salvar-professional"]');

    await expect(page.locator('.toast-sucesso')).toHaveText(/Preço atualizado/);
    expect(corpoEnviado.headline_diferencial).toBe('Atendimento que conversa');
  });

  test('bloqueia salvar acima de 120 caracteres e mostra o contador', async ({ page }) => {
    await entrarEmConfiguracoes(page, configuracoesMock({ planos: planosGrade2x2() }));

    let chamou = false;
    await page.route('**/admin/api/configuracoes/planos/professional', () => { chamou = true; });

    await page.click('tr[data-plano="professional"] [data-acao="editar-plano"]');
    await page.fill('[data-testid="input-frase-professional"]', 'a'.repeat(121));

    await expect(page.locator('[data-testid="salvar-professional"]')).toBeDisabled();
    await expect(page.locator('tr[data-plano="professional"] [data-erro-plano="professional"]')).toHaveText(/máximo de 120/i);

    await page.click('[data-testid="salvar-professional"]', { force: true });
    expect(chamou).toBe(false);
  });

  test('volta a permitir salvar ao corrigir o texto pro limite', async ({ page }) => {
    await entrarEmConfiguracoes(page, configuracoesMock({ planos: planosGrade2x2() }));

    await page.click('tr[data-plano="professional"] [data-acao="editar-plano"]');
    await page.fill('[data-testid="input-frase-professional"]', 'a'.repeat(121));
    await expect(page.locator('[data-testid="salvar-professional"]')).toBeDisabled();

    await page.fill('[data-testid="input-frase-professional"]', 'a'.repeat(50));
    await expect(page.locator('[data-testid="salvar-professional"]')).toBeEnabled();
  });
});

// US72/CA04 — nome do plano passa a ser editável no painel admin, sem
// alterar o slug (que continua estrutural/somente leitura).
test.describe('Admin — Configurações — editar nome do plano (US72/CA04)', () => {
  test('edita o nome de um plano sem enviar slug no payload', async ({ page }) => {
    await entrarEmConfiguracoes(page, configuracoesMock({ planos: planosGrade2x2() }));

    let corpoEnviado = null;
    await page.route('**/admin/api/configuracoes/planos/professional', (route) => {
      corpoEnviado = route.request().postDataJSON();
      return route.fulfill({ json: { ...planosGrade2x2()[2], nome: 'Smart IA' } });
    });

    await page.click('tr[data-plano="professional"] [data-acao="editar-plano"]');
    await page.fill('[data-testid="input-nome-professional"]', 'Smart IA');
    await page.click('[data-testid="salvar-professional"]');

    await expect(page.locator('.toast-sucesso')).toHaveText(/Preço atualizado/);
    expect(corpoEnviado.nome).toBe('Smart IA');
    expect(corpoEnviado.slug).toBeUndefined();
  });

  test('nome em branco não salva e mostra erro', async ({ page }) => {
    await entrarEmConfiguracoes(page, configuracoesMock({ planos: planosGrade2x2() }));

    let chamou = false;
    await page.route('**/admin/api/configuracoes/planos/professional', () => { chamou = true; });

    await page.click('tr[data-plano="professional"] [data-acao="editar-plano"]');
    await page.fill('[data-testid="input-nome-professional"]', '   ');
    await page.click('[data-testid="salvar-professional"]');

    await expect(page.locator('tr[data-plano="professional"] [data-erro-plano="professional"]')).toHaveText(/em branco/);
    expect(chamou).toBe(false);
  });
});
