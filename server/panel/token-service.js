// US20 — geração e envio dos tokens de validação de cadastro.
//
// O mesmo token de 6 dígitos é enviado por dois canais (e-mail via Resend e
// WhatsApp via Evolution API — CA05/CA06). Ambos os provedores são opcionais:
// se as variáveis de ambiente não estiverem configuradas, o envio cai num
// modo de log (imprime o token no console), pra que o fluxo de cadastro
// funcione em dev/homologação sem depender de serviço externo. O envio nunca
// derruba o cadastro: uma falha de e-mail/WhatsApp é logada e engolida — o
// tenant já foi criado e o usuário pode pedir reenvio (CA11).

const crypto = require('crypto');

const TOKEN_EXPIRACAO_MINUTOS = 30;

// Gera um token numérico de 6 dígitos (com zeros à esquerda). crypto.randomInt
// evita o viés de Math.random e é suficiente aqui.
function gerarToken() {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
}

// Mascara o e-mail pra exibição na tela de validação (CA07): "jo***@dominio.com".
function mascararEmail(email) {
  const [usuario, dominio] = String(email).split('@');
  if (!dominio) return email;
  const visivel = usuario.slice(0, 2);
  return `${visivel}${'*'.repeat(Math.max(usuario.length - 2, 1))}@${dominio}`;
}

// Envia o token por e-mail via Resend, se configurado. Retorna true se
// realmente despachou pra um provedor, false se caiu no modo de log.
async function enviarTokenEmail(email, token) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM || 'Kyvvo <no-reply@kyvvo.com.br>';

  if (!apiKey) {
    console.log(`[token-service] (dev) e-mail para ${email} — código: ${token}`);
    return false;
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: [email],
        subject: 'Confirme seu e-mail — Kyvvo',
        html: emailHtml(token),
      }),
    });
    if (!res.ok) {
      console.error(`[token-service] Resend respondeu ${res.status} ao enviar para ${email}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error(`[token-service] Falha ao enviar e-mail para ${email}: ${err.message}`);
    return false;
  }
}

// Envia o token por WhatsApp via Evolution API, se configurada. Espera o
// número nacional em dígitos (ex: "34984285182") e prefixa o DDI 55.
async function enviarTokenWhatsapp(whatsappNacional, token) {
  const url = process.env.EVOLUTION_API_URL;
  const apiKey = process.env.EVOLUTION_API_KEY;
  const instancia = process.env.EVOLUTION_INSTANCE;
  const texto = `Seu código de verificação Kyvvo é: ${token}. Válido por ${TOKEN_EXPIRACAO_MINUTOS} minutos.`;

  if (!url || !apiKey || !instancia) {
    console.log(`[token-service] (dev) WhatsApp para 55${whatsappNacional} — código: ${token}`);
    return false;
  }

  try {
    const res = await fetch(`${url.replace(/\/$/, '')}/message/sendText/${instancia}`, {
      method: 'POST',
      headers: {
        apikey: apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ number: `55${whatsappNacional}`, text: texto }),
    });
    if (!res.ok) {
      console.error(`[token-service] Evolution API respondeu ${res.status} ao enviar para 55${whatsappNacional}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error(`[token-service] Falha ao enviar WhatsApp para 55${whatsappNacional}: ${err.message}`);
    return false;
  }
}

// Dispara os dois canais em paralelo. Nunca lança — o cadastro segue mesmo
// que os dois falhem (o usuário pode reenviar).
async function enviarToken({ email, whatsappNacional, token }) {
  await Promise.allSettled([
    enviarTokenEmail(email, token),
    enviarTokenWhatsapp(whatsappNacional, token),
  ]);
}

function emailHtml(token) {
  return `
  <div style="font-family:Arial,Helvetica,sans-serif;background:#080b14;padding:32px;color:#f2f2f7">
    <div style="max-width:420px;margin:0 auto;background:#12162a;border:1px solid #232847;border-radius:16px;padding:32px">
      <div style="font-size:22px;font-weight:800;letter-spacing:-.03em;margin-bottom:24px">
        ky<span style="color:#a688ff">vv</span>o
      </div>
      <h1 style="font-size:18px;margin:0 0 12px">Confirme seu e-mail</h1>
      <p style="color:#a1a5c4;font-size:14px;line-height:1.6;margin:0 0 24px">
        Use o código abaixo para ativar sua conta Kyvvo e começar seu trial de 14 dias.
      </p>
      <div style="font-size:34px;font-weight:800;letter-spacing:8px;text-align:center;color:#a688ff;margin:0 0 24px">
        ${token}
      </div>
      <p style="color:#a1a5c4;font-size:12px;line-height:1.6;margin:0">
        O código expira em ${TOKEN_EXPIRACAO_MINUTOS} minutos. Se não foi você, ignore este e-mail.
      </p>
    </div>
  </div>`;
}

module.exports = {
  TOKEN_EXPIRACAO_MINUTOS,
  gerarToken,
  mascararEmail,
  enviarToken,
  enviarTokenEmail,
  enviarTokenWhatsapp,
};
