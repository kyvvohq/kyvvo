// US32 — integração com a Asaas (E3 — Sistema de módulos e planos) pra
// cobrança recorrente (Pix ou cartão de crédito) depois do trial de 14 dias.
//
// Mesmo padrão do token-service.js (Resend/Evolution API): sem as variáveis
// de ambiente configuradas, as chamadas caem num modo de log (devolvem um id
// fake), pra que o fluxo funcione em dev/homologação sem depender de uma
// conta real na Asaas. `ASAAS_ENV` escolhe entre sandbox e produção — nunca
// aponta pra produção por acidente sem a variável explícita.

const BASE_URL_SANDBOX = 'https://sandbox.asaas.com/api/v3';
const BASE_URL_PRODUCTION = 'https://www.asaas.com/api/v3';

// Catálogo de planos pagos (CA05). Todo tenant sai do trial já usando o
// conjunto de módulos do plano Profissional (ver MODULOS_TRIAL em index.js) —
// não existe hoje uma tela de troca de plano, então é o único plano
// efetivamente contratável nesta etapa; os demais ficam no catálogo para o
// dia em que a seleção de plano existir.
const PLANOS = {
  starter: { nome: 'Starter', valor: 147 },
  profissional: { nome: 'Profissional', valor: 247 },
  empresarial: { nome: 'Empresarial', valor: 447 },
};
const PLANO_PADRAO = 'profissional';

function ambiente() {
  return process.env.ASAAS_ENV === 'production' ? 'production' : 'sandbox';
}

function baseUrl() {
  return ambiente() === 'production' ? BASE_URL_PRODUCTION : BASE_URL_SANDBOX;
}

function apiKey() {
  return ambiente() === 'production'
    ? process.env.ASAAS_API_KEY_PRODUCTION
    : process.env.ASAAS_API_KEY_SANDBOX;
}

function modoDev() {
  return !apiKey();
}

async function chamar(metodo, caminho, corpo) {
  const res = await fetch(`${baseUrl()}${caminho}`, {
    method: metodo,
    headers: {
      'Content-Type': 'application/json',
      access_token: apiKey(),
    },
    body: corpo ? JSON.stringify(corpo) : undefined,
    signal: AbortSignal.timeout(10000),
  });
  const dados = await res.json().catch(() => ({}));
  if (!res.ok) {
    const mensagem = (dados.errors && dados.errors[0] && dados.errors[0].description) || `Asaas respondeu ${res.status}`;
    throw new Error(mensagem);
  }
  return dados;
}

// CA04 — cria (ou recupera, se já existir) o Customer no Asaas pro tenant.
// Em modo dev, devolve um id fake e loga em vez de chamar a API.
async function criarOuRecuperarCustomer({ tenantId, nome, email, whatsapp, asaasCustomerId }) {
  if (asaasCustomerId) return { id: asaasCustomerId };

  if (modoDev()) {
    const idFake = `cus_dev_${tenantId}`;
    console.log(`[asaas-service] (dev) customer para tenant ${tenantId} — id: ${idFake}`);
    return { id: idFake };
  }

  return chamar('POST', '/customers', {
    name: nome,
    email,
    phone: whatsapp || undefined,
    externalReference: tenantId,
  });
}

// CA05 — cria a Subscription no Asaas (Pix ou cartão). `nextDueDate` deve
// respeitar o trial restante (calculado pelo chamador). Em modo dev, devolve
// um id fake e loga.
async function criarSubscription({ customerId, billingType, plano, nextDueDate, creditCardToken, tenantId }) {
  const valor = (PLANOS[plano] || PLANOS[PLANO_PADRAO]).valor;

  if (modoDev()) {
    const idFake = `sub_dev_${tenantId}`;
    console.log(`[asaas-service] (dev) subscription ${billingType} para tenant ${tenantId} — id: ${idFake}, valor: ${valor}`);
    return { id: idFake };
  }

  return chamar('POST', '/subscriptions', {
    customer: customerId,
    billingType,
    value: valor,
    cycle: 'MONTHLY',
    nextDueDate,
    description: `Kyvvo — Plano ${(PLANOS[plano] || PLANOS[PLANO_PADRAO]).nome}`,
    creditCardToken: billingType === 'CREDIT_CARD' ? creditCardToken : undefined,
  });
}

// CA09 — troca o meio de pagamento de uma assinatura existente (atualiza, não
// cancela). Em modo dev, só loga.
async function atualizarSubscription({ subscriptionId, billingType, creditCardToken, tenantId }) {
  if (modoDev()) {
    console.log(`[asaas-service] (dev) atualiza subscription ${subscriptionId} do tenant ${tenantId} para ${billingType}`);
    return { id: subscriptionId };
  }

  return chamar('PUT', `/subscriptions/${subscriptionId}`, {
    billingType,
    creditCardToken: billingType === 'CREDIT_CARD' ? creditCardToken : undefined,
  });
}

// CA08 (US33) — sincroniza nome/telefone com o Customer já existente no
// Asaas quando o usuário edita o perfil. Em modo dev, só loga.
async function atualizarCustomer({ customerId, nome, whatsapp }) {
  if (modoDev()) {
    console.log(`[asaas-service] (dev) atualiza customer ${customerId} — nome: ${nome}`);
    return { id: customerId };
  }

  return chamar('PUT', `/customers/${customerId}`, { name: nome, phone: whatsapp || undefined });
}

// CA08 — últimas cobranças da assinatura, pro histórico na aba de pagamentos.
// Em modo dev, devolve uma lista vazia (não há cobranças reais pra listar).
async function listarUltimasCobrancas(subscriptionId, limite = 5) {
  if (modoDev() || !subscriptionId) return [];

  const dados = await chamar(
    'GET',
    `/payments?subscription=${encodeURIComponent(subscriptionId)}&limit=${limite}&sort=dueDate&order=desc`
  );
  return dados.data || [];
}

// CA08 — próxima cobrança (data + valor) da assinatura, pra exibir na aba de
// pagamentos. Em modo dev, devolve null (não há assinatura real na Asaas).
async function buscarSubscription(subscriptionId) {
  if (modoDev() || !subscriptionId) return null;
  return chamar('GET', `/subscriptions/${subscriptionId}`);
}

module.exports = {
  PLANOS,
  PLANO_PADRAO,
  ambiente,
  modoDev,
  criarOuRecuperarCustomer,
  criarSubscription,
  atualizarSubscription,
  atualizarCustomer,
  buscarSubscription,
  listarUltimasCobrancas,
};
