-- Exclusão de cliente (menu Clientes) — soft delete, mesmo padrão de
-- servicos.excluido_em (031). Hard delete não dá: agendamentos.cliente_id
-- referencia clientes ON DELETE CASCADE, então apagar um cliente de verdade
-- apagaria em cascata todo o histórico de atendimentos e os lançamentos
-- financeiros ligados a ele — perda de dado real, não só cosmética.
alter table clientes add column if not exists excluido_em timestamptz;
