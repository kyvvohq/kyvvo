-- Reverte a migration 012: telefone volta a ser obrigatório em clientes.
-- Decisão do Bruno (2026-07-08): telefone é vital para a comunicação com o
-- cliente (WhatsApp), não deveria ter sido opcional no cadastro manual.
-- Nenhum registro com telefone nulo existia no momento desta migration.

alter table clientes alter column telefone set not null;
