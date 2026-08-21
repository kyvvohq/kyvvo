// montarResumoPagamentos — extraído de index.js (fase 8 da modularização).
// Cross-cutting: usado pelas rotas de Pagamentos (routes/pagamentos.js) E
// pela Área admin (ainda em index.js, GET /admin/api/tenants/:id e
// /assinatura-resumo) — por isso vira lib em vez de ficar privado num único
// routes/*.js. Não precisa de `pool`: só monta o payload a partir de um
// `tenant` já carregado pelo chamador.
const planos = require('./planos');
const asaasService = require('../asaas-service');
const configSistema = require('./configuracoes-sistema');
const { calcularTrialTenant, calcularBloqueioAssinatura } = require('./trial-conta');

// Monta o payload de resposta da aba de pagamentos (CA02/CA07/CA08) — usado
// tanto pelo GET quanto pela resposta do POST /cadastrar, pra sempre
// devolver o mesmo formato depois de qualquer mudança de estado.
async function montarResumoPagamentos(tenant) {
  // Sem plano escolhido ainda (tenant.plano nulo ou 'trial'), o plano que
  // efetivamente será cobrado ao cadastrar pagamento é sempre o
  // PLANO_PADRAO_CHAVE (ver /api/pagamentos/cadastrar) — devolve esse valor
  // em vez de null pra US37/CA02 poder anunciar "R$ [VALOR]" antes do
  // trial acabar. CA09 (US38) — preço/nome sempre lidos do cache carregado
  // da tabela `planos` (nunca mais hardcoded em asaas-service.js).
  const planoInfo = planos.obterPlano(tenant.plano) || planos.obterPlano(planos.PLANO_PADRAO_CHAVE) || null;
  const subscription = await asaasService.buscarSubscription(tenant.asaas_subscription_id).catch((erro) => {
    console.error(`[pagamentos] falha ao buscar subscription ${tenant.asaas_subscription_id}: ${erro.message}`);
    return null;
  });
  const historico = await asaasService.listarUltimasCobrancas(tenant.asaas_subscription_id).catch((erro) => {
    console.error(`[pagamentos] falha ao listar cobranças da subscription ${tenant.asaas_subscription_id}: ${erro.message}`);
    return [];
  });
  // trial_ativo/trial_fim (US37/CA02) — reaproveita o mesmo cálculo do
  // indicador somente leitura do admin (US31/calcularTrialTenant) pro
  // frontend anunciar a data da primeira cobrança antes do cadastro.
  const trial = calcularTrialTenant(tenant);

  return {
    status: tenant.status,
    // Mesma fonte de verdade de `authenticate` — a tela de bloqueio
    // (bloqueio.html) usa isso pra decidir se mostra a tela de
    // regularização, em vez de repetir o cálculo de carência em JS.
    bloqueio_motivo: calcularBloqueioAssinatura(tenant),
    plano: tenant.plano,
    // GET /api/planos (catálogo público usado no modal de troca) não expõe
    // `chave` de propósito — só `slug` é identificador externo. Devolve o
    // slug do plano atual aqui pra o frontend conseguir marcar o plano
    // corrente na lista sem precisar de outro campo.
    plano_slug: planoInfo ? planoInfo.slug : null,
    plano_nome: planoInfo ? planoInfo.nome : null,
    valor_plano: planoInfo ? Number(planoInfo.preco_mensal) : null,
    trial_ativo: trial.trialAtivo,
    trial_fim: trial.trialFim ? trial.trialFim.slice(0, 10) : null,
    meio_pagamento: tenant.asaas_meio_pagamento,
    meio_pagamento_alterado_em: tenant.asaas_meio_pagamento_alterado_em,
    cartao_final: tenant.asaas_cartao_final,
    // `ciclo` — hoje toda subscription nasce mensal (asaas-service.js
    // criarSubscription hardcoda `cycle: 'MONTHLY'`, não existe fluxo de
    // contratação anual ainda), mas lê de `subscription.cycle` em vez de
    // hardcodar aqui pra já ficar certo no dia em que a Asaas devolver
    // YEARLY (troca de ciclo direto no painel deles, por exemplo).
    ciclo: subscription && subscription.cycle === 'YEARLY' ? 'Anual' : 'Mensal',
    cpf_cnpj: tenant.cpf_cnpj,
    endereco_cep: tenant.endereco_cep,
    endereco_logradouro: tenant.endereco_logradouro,
    endereco_numero: tenant.endereco_numero,
    endereco_complemento: tenant.endereco_complemento,
    endereco_bairro: tenant.endereco_bairro,
    endereco_cidade: tenant.endereco_cidade,
    endereco_uf: tenant.endereco_uf,
    cancelado_em: tenant.cancelado_em,
    acesso_ate: tenant.acesso_ate,
    // US52 — tela de bloqueio pós-trial (bloqueio.html) explica como falar
    // com o suporte durante a regularização; reaproveita as mesmas
    // configurações já usadas em GET /api/tenant/status.
    suporte_email: configSistema.config.emailSuporte,
    suporte_whatsapp: configSistema.config.whatsappSuporte,
    proxima_cobranca: subscription
      ? { plano_nome: planoInfo ? planoInfo.nome : null, data: subscription.nextDueDate, valor: subscription.value }
      : null,
    // `meio` (PR5) — a Asaas já devolve billingType (PIX/CREDIT_CARD) em
    // cada cobrança do histórico; não precisa de coluna nova nem de nova
    // integração, só repassar o campo que já vinha no payload bruto.
    // `plano_nome`/`ciclo` por linha — a Asaas não guarda o plano Kyvvo por
    // cobrança histórica (troca de plano reaproveita a mesma subscription,
    // ver PATCH /api/pagamentos/plano), então usa o plano/ciclo *atuais*
    // pra todo o histórico — simplificação documentada, não um bug.
    historico: historico.map((p) => ({
      data: p.dueDate,
      plano_nome: planoInfo ? planoInfo.nome : null,
      valor: p.value,
      ciclo: subscription && subscription.cycle === 'YEARLY' ? 'Anual' : 'Mensal',
      status: p.status,
      meio: p.billingType,
    })),
  };
}

module.exports = { montarResumoPagamentos };
