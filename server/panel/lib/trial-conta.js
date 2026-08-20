// Trial e bloqueio de acesso por status de conta — extraído de index.js
// (fase 1 da modularização). Estava fisicamente dentro do bloco "Área
// admin", mas é consumido pelo decorator `fastify.authenticate` (toda rota
// autenticada do sistema) e por GET /api/tenant/status/Pagamentos — uma
// dependência de billing/entitlements escondida dentro do que devia ser só
// admin. Funções puras: só leem `tenant` (já buscado pelo chamador) + os
// valores de configuracoes-sistema, sem tocar o Postgres.
const { config } = require('./configuracoes-sistema');

// Indicador de trial somente leitura (US31/CA02) — calculado a partir de
// `ativado_em` (data real de ativação da conta), não de `trial_expires_at`
// (que reflete a data de cadastro/US20 e pode divergir da ativação).
// trial_ativo = ativado_em não nulo E ativado_em + trialDias dias >= hoje.
function calcularTrialTenant(tenant) {
  if (!tenant.ativado_em) {
    return { trialAtivo: false, trialInicio: null, trialFim: null, trialDiasRestantes: null };
  }
  const inicio = new Date(tenant.ativado_em);
  const fim = new Date(inicio.getTime() + config.trialDias * 24 * 60 * 60 * 1000);
  const diasRestantes = Math.ceil((fim.getTime() - Date.now()) / (24 * 60 * 60 * 1000));
  return {
    trialAtivo: fim.getTime() >= Date.now(),
    trialInicio: inicio.toISOString(),
    trialFim: fim.toISOString(),
    trialDiasRestantes: diasRestantes,
  };
}

// Bloqueio de acesso por falta de pagamento — usado tanto por `authenticate`
// (enforça de verdade) quanto por GET /api/tenant/status e
// montarResumoPagamentos (pra frontend saber pra onde redirecionar/o que
// mostrar), sempre a partir da mesma fonte de verdade: nunca duplicar essa
// conta em mais de um lugar.
// - trial vencido sem assinatura: bloqueia (fluxo já existia).
// - inadimplente (Asaas PAYMENT_OVERDUE): só bloqueia depois de
//   carenciaDiasInadimplencia dias desde a mudança de status — dá tempo de a
//   cobrança ser regularizada (retry automático da Asaas, por ex.) antes de
//   cortar o acesso.
// - suspenso (Asaas PAYMENT_DELETED — cobrança excluída/falhou de vez):
//   bloqueia na hora, sem carência — já é o estado mais grave.
// - cancelado: bloqueia só depois de `acesso_ate` (o período já pago), igual
//   já era feito na Cobrança pra exibição, agora também aqui pra valer de
//   verdade.
function calcularBloqueioAssinatura(tenant) {
  if (tenant.status === 'trial') {
    return calcularTrialTenant(tenant).trialAtivo ? null : 'trial_expirado';
  }
  if (tenant.status === 'suspenso') {
    return 'suspenso';
  }
  if (tenant.status === 'inadimplente') {
    if (!tenant.status_alterado_em) return 'inadimplente';
    const fimCarencia = new Date(tenant.status_alterado_em).getTime() + config.carenciaDiasInadimplencia * 24 * 60 * 60 * 1000;
    return Date.now() >= fimCarencia ? 'inadimplente' : null;
  }
  if (tenant.status === 'cancelado') {
    if (!tenant.acesso_ate) return 'cancelado';
    // `acesso_ate` é `date` (sem hora) — vale até o fim do próprio dia.
    const fimAcesso = new Date(`${tenant.acesso_ate}T23:59:59-03:00`).getTime();
    return Date.now() > fimAcesso ? 'cancelado' : null;
  }
  return null;
}

const BLOQUEIO_MENSAGENS = {
  trial_expirado: 'Seu período de teste terminou. Cadastre um meio de pagamento para continuar usando o Kyvvo.',
  inadimplente: 'Não conseguimos confirmar seu pagamento. Atualize sua forma de pagamento para reativar o acesso.',
  suspenso: 'Sua assinatura foi suspensa por falha no pagamento. Atualize sua forma de pagamento para reativar o acesso.',
  cancelado: 'Sua assinatura foi encerrada e o período pago já terminou. Reative sua assinatura para continuar usando o Kyvvo.',
};

// Status de conta exibido na listagem de tenants e no detalhe (US26/US28/
// CA02) — o estado de trial usa `calcularTrialTenant` (US31), baseada em
// `ativado_em`, no lugar do cálculo antigo por `trial_expires_at`.
function statusContaTenant(tenant) {
  if (!tenant.ativo) return 'Inativo';
  if (tenant.status === 'trial') {
    if (!tenant.ativado_em) return 'Não ativado';
    return calcularTrialTenant(tenant).trialAtivo ? 'Trial ativo' : 'Trial expirado';
  }
  if (tenant.status === 'ativo') return 'Ativo';
  if (tenant.status === 'suspenso') return 'Suspenso';
  return 'Inativo';
}

module.exports = { calcularTrialTenant, calcularBloqueioAssinatura, statusContaTenant, BLOQUEIO_MENSAGENS };
