// Normalização de telefone de cliente — extraído de index.js (fase 3 da
// modularização). Puro, sem `pool` — quando o grupo de rotas Clientes for
// extraído numa fase futura, ganha companhia neste arquivo.

// Telefone de CLIENTE (clientes.telefone) — não confundir com
// normalizarWhatsapp (index.js), que é pro WhatsApp do tenant e devolve sem
// DDI. Aqui o canônico é COM DDI 55, igual ao que a Meta manda em msg.from
// (bot n8n e IA Engine, ver /webhook/whatsapp). Sem essa normalização, o
// mesmo cliente que já mandou mensagem pelo WhatsApp virava um registro
// duplicado toda vez que alguém do salão criava um agendamento manual pelo
// portal — a unique key (tenant_id, telefone) não pegava a duplicata porque
// os dois formatos eram strings diferentes ("34999998888" vs
// "5534999998888").
function normalizarTelefoneCliente(bruto) {
  if (!bruto) return null;
  let digitos = String(bruto).replace(/\D/g, '');
  if (digitos.length === 10 || digitos.length === 11) digitos = '55' + digitos;
  if (digitos.length !== 12 && digitos.length !== 13) return null;
  const ddd = parseInt(digitos.slice(2, 4), 10);
  if (ddd < 11 || ddd > 99) return null;
  return digitos;
}

module.exports = { normalizarTelefoneCliente };
