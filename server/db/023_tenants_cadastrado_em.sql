-- US29 — data de cadastro do tenant: momento exato em que o usuário
-- submeteu o formulário de cadastro com sucesso (POST /auth/register).
-- Campo próprio (em vez de reaproveitar `criado_em`) pra description ficar
-- alinhada com `ativado_em` (US30) e não depender do nome técnico da coluna
-- de criação da linha.

alter table tenants add column if not exists cadastrado_em timestamptz;

-- Backfill: tenants existentes já têm o momento real de cadastro em
-- `criado_em` (mesma coisa, coluna com DEFAULT NOW() desde 001_init.sql).
update tenants set cadastrado_em = criado_em where cadastrado_em is null;

alter table tenants alter column cadastrado_em set default now();
alter table tenants alter column cadastrado_em set not null;
