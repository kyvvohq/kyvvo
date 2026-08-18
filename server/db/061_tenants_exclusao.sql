-- Exclusão de tenant (área admin) — soft delete, mesmo padrão de
-- clientes.excluido_em (058) / servicos.excluido_em (031). Hard delete não
-- dá: apagaria em cascata agendamentos, clientes, financeiro e usuários do
-- tenant — perda de dado real, não só cosmética. Some da listagem/busca
-- admin, mas os dados continuam no banco (reversível via SQL direto).
alter table tenants add column if not exists excluido_em timestamptz;
