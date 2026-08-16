-- Tela de detalhe do cliente (menu Clientes): nome, telefone, data de
-- nascimento e histórico de atendimentos com forma de pagamento.

-- data_nascimento não é coletada em nenhum fluxo automático hoje (nem
-- cadastro, nem bot/IA no WhatsApp) — só editável manualmente na tela de
-- detalhe do cliente.
alter table clientes add column if not exists data_nascimento date;

-- forma_pagamento não existia em lugar nenhum: capturada só no momento de
-- "Confirmar pagamento" (menu Financeiro), nunca retroativa a lançamentos
-- antigos (ficam com forma_pagamento = null, exibido como "não informado").
alter table lancamentos_financeiros add column if not exists forma_pagamento text;
alter table lancamentos_financeiros drop constraint if exists lancamentos_financeiros_forma_pagamento_check;
alter table lancamentos_financeiros add constraint lancamentos_financeiros_forma_pagamento_check
  check (forma_pagamento is null or forma_pagamento in ('pix', 'cartao', 'dinheiro', 'outro'));
