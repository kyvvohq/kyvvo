// Normalização do WhatsApp do TENANT — extraído de index.js (fase 6 da
// modularização). Puro, sem `pool`. Não confundir com normalizarTelefoneCliente
// (lib/clientes.js), que é pro telefone do CLIENTE e mantém o DDI 55.

// Normaliza um WhatsApp brasileiro para os dígitos nacionais (DDD + número,
// sem o DDI 55), que é o formato guardado como unique key. Retorna null se
// não for um número brasileiro plausível.
function normalizarWhatsapp(bruto) {
  if (!bruto) return null;
  let digitos = String(bruto).replace(/\D/g, '');
  if (digitos.startsWith('55') && digitos.length >= 12) {
    digitos = digitos.slice(2);
  }
  if (digitos.length < 10 || digitos.length > 11) return null;
  const ddd = parseInt(digitos.slice(0, 2), 10);
  if (ddd < 11 || ddd > 99) return null;
  return digitos;
}

module.exports = { normalizarWhatsapp };
