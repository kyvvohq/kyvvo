-- US77 — Segmento sai do formulário de cadastro (migra pro onboarding,
-- US82) e passa a ser opcional na criação da conta. `segmento_id` já era
-- nullable (migration 035); só `segmento` (texto) tinha NOT NULL (018).
-- CHECK de segmento continua valendo — Postgres não avalia CHECK como
-- violado quando a coluna é NULL, só quando o valor não bate com a lista.
alter table tenants
  alter column segmento drop not null,
  alter column segmento drop default;

-- Marca contas que ainda não passaram pelo onboarding (US82) — hoje só
-- controla se falta preencher segmento/nome do negócio no primeiro acesso.
-- Contas existentes já têm segmento definido, então nascem false.
alter table tenants
  add column if not exists onboarding_pendente boolean not null default false;
