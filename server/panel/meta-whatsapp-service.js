// Self-service de conexão do WhatsApp — Embedded Signup da Meta (WhatsApp
// Business Platform / Cloud API).
//
// Diferente do asaas-service.js/token-service.js, aqui não existe "modo dev"
// com id fake: o fluxo depende inteiramente de credenciais reais da Meta
// (META_APP_ID/META_APP_SECRET pro Facebook Login, META_WHATSAPP_TOKEN pro
// Usuário do Sistema). Sem elas configuradas, as rotas que usam este serviço
// devolvem erro explicando o que falta, em vez de fingir sucesso.
//
// Ponto chave da arquitetura (documentado no plano): o Embedded Signup NÃO
// gera um token por tenant pra guardar no banco. Ele concede ao nosso
// Usuário do Sistema (o mesmo META_WHATSAPP_TOKEN já usado pra todos os
// tenants) acesso à WhatsApp Business Account (WABA) que o tenant conectou —
// o mesmo efeito de "Atribuir pessoas" feito manualmente no Business
// Settings da Meta. Por isso as funções abaixo usam META_WHATSAPP_TOKEN, não
// um token derivado do `code` do tenant.

const GRAPH_API_VERSION = 'v22.0';
const GRAPH_API_BASE = `https://graph.facebook.com/${GRAPH_API_VERSION}`;

async function chamar(metodo, caminho, { query, body, token } = {}) {
  const url = new URL(`${GRAPH_API_BASE}${caminho}`);
  if (query) for (const [chave, valor] of Object.entries(query)) url.searchParams.set(chave, valor);

  const res = await fetch(url, {
    method: metodo,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(10000),
  });
  const dados = await res.json().catch(() => ({}));
  if (!res.ok) {
    const mensagem = (dados.error && dados.error.message) || `Meta respondeu ${res.status}`;
    throw new Error(mensagem);
  }
  return dados;
}

// Troca o `code` de autorização (devolvido pelo FB.login do Embedded Signup)
// por um token de curta duração — usado só pra confirmar que o code é
// legítimo. O envio/recebimento de mensagem continua usando o
// META_WHATSAPP_TOKEN do Usuário do Sistema, não este token.
async function trocarCodePorToken(code) {
  const appId = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;
  if (!appId || !appSecret) {
    throw new Error('META_APP_ID/META_APP_SECRET não configurados no servidor.');
  }
  return chamar('GET', '/oauth/access_token', {
    query: { client_id: appId, client_secret: appSecret, code },
  });
}

// Assina o app do Kyvvo pra receber webhook de mensagens dessa WABA —
// equivalente ao toggle "Assinar webhooks" do Business Settings da Meta.
async function assinarWebhooks(wabaId) {
  const token = process.env.META_WHATSAPP_TOKEN;
  if (!token) throw new Error('META_WHATSAPP_TOKEN não configurado no servidor.');
  return chamar('POST', `/${wabaId}/subscribed_apps`, { token });
}

// Registra o número pra uso na Cloud API (PIN de verificação em duas
// etapas). Best-effort: dependendo de como o Embedded Signup foi
// configurado, o número pode já vir registrado — erro aqui é logado mas não
// derruba a conexão (a WABA/telefone já foram salvos no tenant nesse ponto).
async function registrarNumero(phoneNumberId) {
  const token = process.env.META_WHATSAPP_TOKEN;
  if (!token) throw new Error('META_WHATSAPP_TOKEN não configurado no servidor.');
  const pin = String(Math.floor(100000 + Math.random() * 900000));
  return chamar('POST', `/${phoneNumberId}/register`, {
    token,
    body: { messaging_product: 'whatsapp', pin },
  });
}

// CA (US39.2) — envia uma mensagem de teste pra validar que um "número
// pronto" recém-vinculado a um tenant está mesmo operacional na Cloud API.
// Usa o template "hello_world" (aprovado por padrão em toda WABA, sem
// precisar de aprovação prévia) em vez de texto livre, porque texto livre só
// funciona dentro da janela de 24h de uma conversa já iniciada pelo
// destinatário — o número recém-vinculado nunca teve conversa nenhuma ainda.
async function enviarMensagemTeste(phoneNumberId, numeroDestino) {
  const token = process.env.META_WHATSAPP_TOKEN;
  if (!token) throw new Error('META_WHATSAPP_TOKEN não configurado no servidor.');
  return chamar('POST', `/${phoneNumberId}/messages`, {
    token,
    body: {
      messaging_product: 'whatsapp',
      to: numeroDestino,
      type: 'template',
      template: { name: 'hello_world', language: { code: 'en_US' } },
    },
  });
}

// US68 — envia texto livre em resposta a uma mensagem recebida do cliente
// (motor de IA). Texto livre só é permitido dentro da janela de 24h de uma
// conversa iniciada pelo cliente (diferente de enviarMensagemTeste acima,
// que é proativo e por isso precisa de template aprovado) — como isto é
// sempre uma resposta a uma mensagem que acabou de chegar, está sempre
// dentro da janela.
async function enviarTexto(phoneNumberId, numeroDestino, texto) {
  const token = process.env.META_WHATSAPP_TOKEN;
  if (!token) throw new Error('META_WHATSAPP_TOKEN não configurado no servidor.');
  return chamar('POST', `/${phoneNumberId}/messages`, {
    token,
    body: { messaging_product: 'whatsapp', to: numeroDestino, type: 'text', text: { body: texto } },
  });
}

module.exports = {
  trocarCodePorToken,
  assinarWebhooks,
  registrarNumero,
  enviarMensagemTeste,
  enviarTexto,
};
