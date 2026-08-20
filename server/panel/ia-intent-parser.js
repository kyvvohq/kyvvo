// US68/CA04 — parser de intenção da IA (WhatsApp) e escolha de qual
// atendimento futuro do cliente uma ação de reagendar/cancelar deve afetar.
// Extraído de index.js numa avaliação do bot (2026-08-19): eram funções
// puras (sem banco/rede) presas dentro do monólito, então não dava pra
// testar essas regras sem subir o app inteiro. Mesmo raciocínio de
// isolamento já usado em anthropic-service.js/meta-whatsapp-service.js —
// só que aqui nem precisa de HTTP, é lógica pura.

const IA_INTENTS_VALIDOS = new Set(['agendar', 'reagendar', 'cancelar', 'consultar', 'unknown', 'fallback_humano', 'informar_nascimento']);

// Só aceita o JSON estruturado que o system prompt exige da IA, nunca deixa
// a IA executar ação direto. JSON inválido, intent desconhecido ou campo
// "resposta" ausente degradam pra um "unknown" com resposta genérica —
// nunca lança erro pro cliente ver. `log(obj, msg)` é opcional (quem chama
// decide o logger de verdade, ex. fastify.log.warn em index.js); sem ele,
// os avisos são só silenciados — nunca derruba o parser.
function parsearIntentIA(textoResposta, { log } = {}) {
  const avisar = typeof log === 'function' ? log : () => {};
  let bruto;
  try {
    // A IA às vezes envolve o JSON em ```json ... ``` mesmo sendo instruída a
    // não fazer isso — extrai o primeiro objeto JSON encontrado por segurança.
    const match = textoResposta.match(/\{[\s\S]*\}/);
    bruto = JSON.parse(match ? match[0] : textoResposta);
  } catch (erroParse) {
    avisar({ erro: erroParse.message, textoResposta }, 'Parser de intenção IA (US68.4) — resposta da IA não é JSON válido');
    return { intent: 'unknown', params: {}, resposta: 'Desculpa, não entendi. Pode repetir de outro jeito?' };
  }
  const intent = IA_INTENTS_VALIDOS.has(bruto.intent) ? bruto.intent : 'unknown';
  const params = (bruto.params && typeof bruto.params === 'object') ? bruto.params : {};
  const respostaFaltando = !(typeof bruto.resposta === 'string' && bruto.resposta.trim());
  if (respostaFaltando) {
    avisar({ bruto }, 'Parser de intenção IA (US68.4) — JSON válido mas sem campo "resposta"');
  }
  const resposta = respostaFaltando ? 'Desculpa, não entendi. Pode repetir de outro jeito?' : bruto.resposta.trim();
  return { intent, params, resposta };
}

// Escolhe qual dos atendimentos futuros confirmados do cliente uma ação de
// reagendar/cancelar deve afetar. Corrigido numa avaliação do bot
// (2026-08-19): antes o executor sempre pegava o mais próximo (LIMIT 1)
// direto na query — com a recorrência de agendamento (Novo agendamento >
// Recorrência) um cliente pode ter vários atendimentos confirmados ao mesmo
// tempo, e "o mais próximo" deixa de ser necessariamente o que ele quis
// dizer. Só decide sozinho quando há exatamente 1 candidato (o caso de
// sempre); com 2+, exige que a IA já tenha identificado qual via
// "dataHoraAlvoISO" (ver montarContextoIA em index.js) — sem isso, lança
// "AgendamentoAmbiguo" em vez de arriscar mexer no agendamento errado.
// `candidatos` é uma lista de linhas do banco (cada uma com `.id`/
// `.data_hora`, entre outros campos que o chamador precisar) — esta função
// não sabe nem precisa saber de banco, só decide qual delas é a certa.
function escolherAgendamentoAlvoIA(candidatos, dataHoraAlvoISO) {
  if (!candidatos.length) return null;
  if (candidatos.length === 1) return candidatos[0];
  const alvo = dataHoraAlvoISO
    ? candidatos.find((c) => new Date(c.data_hora).getTime() === new Date(dataHoraAlvoISO).getTime())
    : null;
  if (!alvo) throw new Error('AgendamentoAmbiguo');
  return alvo;
}

module.exports = { parsearIntentIA, escolherAgendamentoAlvoIA, IA_INTENTS_VALIDOS };
