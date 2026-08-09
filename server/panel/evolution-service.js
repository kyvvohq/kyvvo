// US68 — cliente HTTP puro pra Evolution API (sem dependência de pool/DB),
// mesmo padrão de meta-whatsapp-service.js. Usado pelo IA Engine pra enviar
// as respostas da IA e as notificações de fallback humano de volta pro
// WhatsApp — o n8n nunca vê essas mensagens, porque o roteador (US68.2)
// intercepta o webhook antes dele.

const EVOLUTION_API_URL = process.env.EVOLUTION_API_URL;
const EVOLUTION_API_KEY = process.env.EVOLUTION_API_KEY;

// Envia uma mensagem de texto simples pela instância do tenant. `numero`
// aceita com ou sem o sufixo @s.whatsapp.net — a Evolution API normaliza.
async function enviarTexto(instancia, numero, texto) {
  if (!EVOLUTION_API_URL || !EVOLUTION_API_KEY) {
    throw new Error('EVOLUTION_API_URL/EVOLUTION_API_KEY não configurados no servidor.');
  }
  const numeroLimpo = String(numero).replace('@s.whatsapp.net', '').replace('@lid', '');
  const res = await fetch(`${EVOLUTION_API_URL}/message/sendText/${encodeURIComponent(instancia)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: EVOLUTION_API_KEY },
    body: JSON.stringify({ number: numeroLimpo, text: texto }),
    signal: AbortSignal.timeout(15000),
  });
  const dados = await res.json().catch(() => ({}));
  if (!res.ok) {
    const mensagem = (dados && (dados.message || dados.error)) || `Evolution API respondeu ${res.status}`;
    throw new Error(typeof mensagem === 'string' ? mensagem : JSON.stringify(mensagem));
  }
  return dados;
}

module.exports = { enviarTexto };
