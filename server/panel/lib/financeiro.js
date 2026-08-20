// Sincronização do lançamento financeiro vinculado a um agendamento —
// extraído de index.js (fase 1 da modularização). Não precisa de
// `init(pool)`: já recebe `client` (pool ou client de transação já aberto
// pelo chamador) como argumento explícito.

// US64 — cria/atualiza o lançamento financeiro vinculado a um agendamento
// com serviço pago (CA "Cenário 1/3/4/5/6/7"). `client` pode ser o pool do
// módulo ou um client de transação já aberto pelo chamador — POST/PATCH
// /api/agendamentos precisam que a mudança no agendamento e no financeiro
// aconteçam atomicamente, senão um crash no meio deixaria os dois lados
// inconsistentes.
//
// Sempre um UPDATE em cima do lançamento existente do agendamento (nunca um
// segundo INSERT): o ON CONFLICT usa o índice único uq_lancamentos_agendamento,
// que também garante isso numa corrida (CA "Cenário 7", evitar duplicidade).
async function sincronizarLancamentoFinanceiro(client, {
  tenantId, agendamentoId, servicoNome, servicoPreco, dataHora, statusAgendamento, formaPagamento,
}) {
  // Serviço sem preço (ou preço zero) nunca gera lançamento automático (CA
  // "Cenário 2") — nem na criação nem numa atualização: hoje não existe
  // jeito de mudar o serviço/preço de um agendamento já criado (servico_id é
  // fixo, e servicos.preco não tem endpoint de edição), então um agendamento
  // que nasceu sem lançamento nunca precisa ganhar um depois.
  const preco = servicoPreco != null ? Number(servicoPreco) : 0;
  if (!(preco > 0)) return;

  // 'reagendado' nunca é de fato setado por nenhum código hoje (reagendar só
  // muda data_hora no mesmo registro) — trata como 'confirmado' por
  // segurança, caso isso mude no futuro. 'falta' (no-show) mapeia pro mesmo
  // 'cancelado' que uma cancelação de verdade — financeiramente o efeito é
  // igual (a receita prevista não acontece) — mas o status do AGENDAMENTO em
  // si continua 'falta', distinto de 'cancelado', pro Relatórios conseguir
  // medir taxa de comparecimento e faturamento perdido por no-show à parte.
  const statusFinanceiro = statusAgendamento === 'concluido'
    ? 'realizado'
    : (statusAgendamento === 'cancelado' || statusAgendamento === 'falta')
      ? 'cancelado'
      : 'previsto';

  // formaPagamento só chega preenchida em "Confirmar pagamento" (US, menu
  // Financeiro) — as outras chamadas (criar/reagendar/cancelar agendamento)
  // não sabem a forma de pagamento e não podem apagar a que já foi
  // registrada, por isso o COALESCE no UPDATE mantém o valor existente
  // quando formaPagamento vem null.
  await client.query(
    `INSERT INTO lancamentos_financeiros (tenant_id, agendamento_id, tipo, valor, descricao, data, status, forma_pagamento)
     VALUES ($1, $2, 'entrada', $3, $4, ($5::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date, $6, $7)
     ON CONFLICT (agendamento_id) WHERE agendamento_id IS NOT NULL
     DO UPDATE SET valor = EXCLUDED.valor, data = EXCLUDED.data, status = EXCLUDED.status, descricao = EXCLUDED.descricao,
                    forma_pagamento = COALESCE(EXCLUDED.forma_pagamento, lancamentos_financeiros.forma_pagamento)`,
    [tenantId, agendamentoId, preco, servicoNome, dataHora, statusFinanceiro, formaPagamento || null]
  );
}

module.exports = { sincronizarLancamentoFinanceiro };
