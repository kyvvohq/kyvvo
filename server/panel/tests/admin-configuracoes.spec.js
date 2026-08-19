const { test, expect } = require('@playwright/test');

// Cobre US38: página de Configurações do sistema na área admin (preços dos
// planos + configurações gerais + log de auditoria). A lista de planos
// mostra só Plano/Descrição/Destaque/Ativo/Editar — editar abre um popup
// com todos os campos (Salvar/Sair). API mockada via page.route — sem
// dependência de Postgres real.

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

async function abrirModalPlano(page, chave) {
  await page.click(`tr[data-plano="${chave}"] [data-acao="editar-plano"]`);
}

test.describe('Admin — Configurações do sistema (US38)', () => {
  test('redireciona para o login se não autenticado como admin', async ({ page }) => {
    await page.goto('/admin/configuracoes.html');
    await expect(page).toHaveURL(/\/admin\/login\.html/);
  });

  test('lista os planos com nome, descrição e status de destaque/ativo (CA02)', async ({ page }) => {
    await entrarEmConfiguracoes(page, configuracoesMock());

    const linhaStarter = page.locator('tr[data-plano="starter"]');
    await expect(linhaStarter).toContainText('Starter');
    await expect(linhaStarter).toContainText('Acesso web + bot WhatsApp');
    await expect(linhaStarter.getByTestId('ativo-starter')).toHaveClass(/toggle-on/);

    const linhaEmpresarial = page.locator('tr[data-plano="empresarial"]');
    await expect(linhaEmpresarial.getByTestId('ativo-empresarial')).toHaveClass(/toggle-off/);
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

  test('editar plano abre o popup com nome preenchido; "Sair" fecha sem salvar (CA03/CA04)', async ({ page }) => {
    await entrarEmConfiguracoes(page, configuracoesMock());

    await expect(page.locator('.modal-overlay')).toHaveCount(0);
    await abrirModalPlano(page, 'starter');
    await expect(page.locator('.modal-overlay')).toBeVisible();
    await expect(page.locator('#plano-editar-nome')).toHaveValue('Starter');
    await expect(page.locator('.modal-texto').filter({ hasText: 'apenas novas assinaturas' })).toBeVisible();

    await page.click('#btn-sair-editar-plano');
    await expect(page.locator('.modal-overlay')).toHaveCount(0);
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

    await abrirModalPlano(page, 'starter');
    await page.fill('#plano-editar-preco', '167');
    await page.click('#btn-salvar-editar-plano');

    await expect(page.locator('.toast-sucesso')).toHaveText(/Plano atualizado/);
    expect(corpoEnviado).toMatchObject({ preco_mensal: 167 });
    await expect(page.locator('.modal-overlay')).toHaveCount(0);
  });

  test('preço abaixo de R$ 1 não salva e mostra erro no popup (CA03)', async ({ page }) => {
    await entrarEmConfiguracoes(page, configuracoesMock());

    let chamou = false;
    await page.route('**/admin/api/configuracoes/planos/starter', () => { chamou = true; });

    await abrirModalPlano(page, 'starter');
    await page.fill('#plano-editar-preco', '0');
    await page.click('#btn-salvar-editar-plano');

    await expect(page.locator('#plano-editar-erro')).toHaveText(/mínimo R\$ 1,00/);
    expect(chamou).toBe(false);
  });

  test('erro do backend ao salvar aparece no popup', async ({ page }) => {
    await entrarEmConfiguracoes(page, configuracoesMock());
    await page.route('**/admin/api/configuracoes/planos/starter', (route) =>
      route.fulfill({ status: 400, json: { error: 'Preço mensal deve ser no mínimo R$ 1,00.' } })
    );

    await abrirModalPlano(page, 'starter');
    await page.fill('#plano-editar-preco', '5');
    await page.click('#btn-salvar-editar-plano');

    await expect(page.locator('#plano-editar-erro')).toHaveText(/mínimo R\$ 1,00/);
    await expect(page.locator('.modal-overlay')).toBeVisible();
  });

  test('desliga o status ativo de um plano pelo popup', async ({ page }) => {
    await entrarEmConfiguracoes(page, configuracoesMock());

    let corpoEnviado = null;
    await page.route('**/admin/api/configuracoes/planos/empresarial', (route) => {
      corpoEnviado = route.request().postDataJSON();
      return route.fulfill({
        json: { chave: 'empresarial', nome: 'Empresarial', descricao: 'Tudo + multi-unidades + disparos ilimitados', preco_mensal: 447, limite_disparos: null, ativo: true, atualizado_em: '2026-07-17T12:00:00Z' },
      });
    });

    await abrirModalPlano(page, 'empresarial');
    await expect(page.locator('#plano-editar-ativo')).not.toBeChecked();
    await page.check('#plano-editar-ativo');
    await page.click('#btn-salvar-editar-plano');

    await expect(page.locator('.toast-sucesso')).toHaveText(/Plano atualizado/);
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
// (somente leitura, exibidos no popup) e destaque/badge (editáveis).
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
  test('exibe os 4 planos na lista simplificada', async ({ page }) => {
    await entrarEmConfiguracoes(page, configuracoesMock({ planos: planosGrade2x2() }));

    for (const chave of ['starter', 'business', 'professional', 'enterprise']) {
      await expect(page.locator(`tr[data-plano="${chave}"]`)).toBeVisible();
    }

    const linhaEnterprise = page.locator('tr[data-plano="enterprise"]');
    await expect(linhaEnterprise).toContainText('Smart Plus');
    await expect(linhaEnterprise.getByTestId('destaque-enterprise')).toHaveClass(/toggle-on/);
  });

  test('popup mostra slug, tecnologia e tipo de número como texto somente leitura (sem input)', async ({ page }) => {
    await entrarEmConfiguracoes(page, configuracoesMock({ planos: planosGrade2x2() }));

    await abrirModalPlano(page, 'enterprise');
    const infoEstrutural = page.locator('.modal-texto').filter({ hasText: 'Slug:' });
    await expect(infoEstrutural).toContainText('smart-plus');
    await expect(infoEstrutural).toContainText('IA');
    await expect(infoEstrutural).toContainText('Número Kyvvo');
    await expect(infoEstrutural.locator('input')).toHaveCount(0);
  });

  test('edita o badge de um plano (CA04)', async ({ page }) => {
    await entrarEmConfiguracoes(page, configuracoesMock({ planos: planosGrade2x2() }));

    let corpoEnviado = null;
    await page.route('**/admin/api/configuracoes/planos/professional', (route) => {
      corpoEnviado = route.request().postDataJSON();
      return route.fulfill({ json: { ...planosGrade2x2()[2], badge: 'Recomendado' } });
    });

    await abrirModalPlano(page, 'professional');
    await page.fill('#plano-editar-badge', 'Recomendado');
    await page.click('#btn-salvar-editar-plano');

    await expect(page.locator('.toast-sucesso')).toHaveText(/Plano atualizado/);
    expect(corpoEnviado).toMatchObject({ badge: 'Recomendado' });
  });

  test('liga o destaque de um plano pelo popup (CA04)', async ({ page }) => {
    await entrarEmConfiguracoes(page, configuracoesMock({ planos: planosGrade2x2() }));

    let corpoEnviado = null;
    await page.route('**/admin/api/configuracoes/planos/starter', (route) => {
      corpoEnviado = route.request().postDataJSON();
      return route.fulfill({ json: { ...planosGrade2x2()[0], destaque: true } });
    });

    await abrirModalPlano(page, 'starter');
    await page.check('#plano-editar-destaque');
    await page.click('#btn-salvar-editar-plano');

    await expect(page.locator('.toast-sucesso')).toHaveText(/Plano atualizado/);
    expect(corpoEnviado).toMatchObject({ destaque: true });
  });
});

// US74/CA05 — diferenciais (3 campos fixos) e limites de uso editáveis no
// popup do admin.
test.describe('Admin — Configurações — diferenciais e limites dos planos (US74/CA05)', () => {
  test('popup pré-preenche as features e os limites do plano', async ({ page }) => {
    await entrarEmConfiguracoes(page, configuracoesMock({ planos: planosGrade2x2() }));

    await abrirModalPlano(page, 'professional');
    await expect(page.locator('#plano-editar-feature-0')).toHaveValue('Bot entende linguagem natural');
    await expect(page.locator('#plano-editar-limite-conversas_mes')).toHaveValue('500');

    await page.click('#btn-sair-editar-plano');
    await abrirModalPlano(page, 'enterprise');
    await expect(page.locator('#plano-editar-limite-conversas_mes')).toHaveValue('');
  });

  test('adiciona uma feature e persiste', async ({ page }) => {
    await entrarEmConfiguracoes(page, configuracoesMock({ planos: planosGrade2x2() }));

    let corpoEnviado = null;
    await page.route('**/admin/api/configuracoes/planos/business', (route) => {
      corpoEnviado = route.request().postDataJSON();
      return route.fulfill({ json: { ...planosGrade2x2()[1] } });
    });

    await abrirModalPlano(page, 'business');
    await page.fill('#plano-editar-feature-0', 'Número virtual gerenciado pelo Kyvvo');
    await page.click('#btn-salvar-editar-plano');

    await expect(page.locator('.toast-sucesso')).toHaveText(/Plano atualizado/);
    expect(corpoEnviado.features).toEqual(['Número virtual gerenciado pelo Kyvvo']);
  });

  test('só 3 campos de feature existem — impossível adicionar uma 4ª', async ({ page }) => {
    await entrarEmConfiguracoes(page, configuracoesMock({ planos: planosGrade2x2() }));

    await abrirModalPlano(page, 'professional');
    await expect(page.locator('#plano-editar-feature-0')).toBeVisible();
    await expect(page.locator('#plano-editar-feature-1')).toBeVisible();
    await expect(page.locator('#plano-editar-feature-2')).toBeVisible();
    await expect(page.locator('#plano-editar-feature-3')).toHaveCount(0);
  });

  test('salva limite em branco como ilimitado (null)', async ({ page }) => {
    await entrarEmConfiguracoes(page, configuracoesMock({ planos: planosGrade2x2() }));

    let corpoEnviado = null;
    await page.route('**/admin/api/configuracoes/planos/enterprise', (route) => {
      corpoEnviado = route.request().postDataJSON();
      return route.fulfill({ json: { ...planosGrade2x2()[3] } });
    });

    await abrirModalPlano(page, 'enterprise');
    await page.fill('#plano-editar-limite-conversas_mes', '');
    await page.click('#btn-salvar-editar-plano');

    await expect(page.locator('.toast-sucesso')).toHaveText(/Plano atualizado/);
    expect(corpoEnviado.limites.conversas_mes).toBeNull();
  });

  test('edita o valor numérico de um limite', async ({ page }) => {
    await entrarEmConfiguracoes(page, configuracoesMock({ planos: planosGrade2x2() }));

    let corpoEnviado = null;
    await page.route('**/admin/api/configuracoes/planos/professional', (route) => {
      corpoEnviado = route.request().postDataJSON();
      return route.fulfill({ json: { ...planosGrade2x2()[2] } });
    });

    await abrirModalPlano(page, 'professional');
    await page.fill('#plano-editar-limite-profissionais', '8');
    await page.click('#btn-salvar-editar-plano');

    expect(corpoEnviado.limites.profissionais).toBe(8);
  });
});

// US73/CA04 — copy de diferencial (headline + frase de benefício) editável
// no popup do admin, com limite de 120 caracteres validado em tempo real.
test.describe('Admin — Configurações — copy de diferencial dos planos (US73/CA04)', () => {
  test('popup pré-preenche headline e frase de benefício', async ({ page }) => {
    await entrarEmConfiguracoes(page, configuracoesMock({ planos: planosGrade2x2() }));

    await abrirModalPlano(page, 'professional');
    await expect(page.locator('#plano-editar-headline')).toHaveValue('Seu número, atendimento que conversa');
    await expect(page.locator('#plano-editar-frase')).toHaveValue('A cliente escreve como fala e o bot resolve.');
  });

  test('edita a headline e a frase de benefício', async ({ page }) => {
    await entrarEmConfiguracoes(page, configuracoesMock({ planos: planosGrade2x2() }));

    let corpoEnviado = null;
    await page.route('**/admin/api/configuracoes/planos/professional', (route) => {
      corpoEnviado = route.request().postDataJSON();
      return route.fulfill({ json: { ...planosGrade2x2()[2], headline_diferencial: 'Atendimento que conversa' } });
    });

    await abrirModalPlano(page, 'professional');
    await page.fill('#plano-editar-headline', 'Atendimento que conversa');
    await page.click('#btn-salvar-editar-plano');

    await expect(page.locator('.toast-sucesso')).toHaveText(/Plano atualizado/);
    expect(corpoEnviado.headline_diferencial).toBe('Atendimento que conversa');
  });

  test('bloqueia salvar acima de 120 caracteres e mostra o contador', async ({ page }) => {
    await entrarEmConfiguracoes(page, configuracoesMock({ planos: planosGrade2x2() }));

    let chamou = false;
    await page.route('**/admin/api/configuracoes/planos/professional', () => { chamou = true; });

    await abrirModalPlano(page, 'professional');
    await page.fill('#plano-editar-frase', 'a'.repeat(121));

    await expect(page.locator('#btn-salvar-editar-plano')).toBeDisabled();
    await expect(page.locator('#plano-editar-erro')).toHaveText(/máximo de 120/i);

    await page.click('#btn-salvar-editar-plano', { force: true });
    expect(chamou).toBe(false);
  });

  test('volta a permitir salvar ao corrigir o texto pro limite', async ({ page }) => {
    await entrarEmConfiguracoes(page, configuracoesMock({ planos: planosGrade2x2() }));

    await abrirModalPlano(page, 'professional');
    await page.fill('#plano-editar-frase', 'a'.repeat(121));
    await expect(page.locator('#btn-salvar-editar-plano')).toBeDisabled();

    await page.fill('#plano-editar-frase', 'a'.repeat(50));
    await expect(page.locator('#btn-salvar-editar-plano')).toBeEnabled();
  });
});

// US72/CA04 — nome do plano passa a ser editável no popup, sem alterar o
// slug (que continua estrutural/somente leitura).
test.describe('Admin — Configurações — editar nome do plano (US72/CA04)', () => {
  test('edita o nome de um plano sem enviar slug no payload', async ({ page }) => {
    await entrarEmConfiguracoes(page, configuracoesMock({ planos: planosGrade2x2() }));

    let corpoEnviado = null;
    await page.route('**/admin/api/configuracoes/planos/professional', (route) => {
      corpoEnviado = route.request().postDataJSON();
      return route.fulfill({ json: { ...planosGrade2x2()[2], nome: 'Smart IA' } });
    });

    await abrirModalPlano(page, 'professional');
    await page.fill('#plano-editar-nome', 'Smart IA');
    await page.click('#btn-salvar-editar-plano');

    await expect(page.locator('.toast-sucesso')).toHaveText(/Plano atualizado/);
    expect(corpoEnviado.nome).toBe('Smart IA');
    expect(corpoEnviado.slug).toBeUndefined();
  });

  test('nome em branco não salva e mostra erro', async ({ page }) => {
    await entrarEmConfiguracoes(page, configuracoesMock({ planos: planosGrade2x2() }));

    let chamou = false;
    await page.route('**/admin/api/configuracoes/planos/professional', () => { chamou = true; });

    await abrirModalPlano(page, 'professional');
    await page.fill('#plano-editar-nome', '   ');
    await page.click('#btn-salvar-editar-plano');

    await expect(page.locator('#plano-editar-erro')).toHaveText(/em branco/);
    expect(chamou).toBe(false);
  });
});
