-- US20 — Cadastro self-service com trial de 14 dias e verificação por
-- e-mail/WhatsApp (E5 — Onboarding e self-service).
--
-- Até aqui todo tenant era criado manualmente pela equipe da Kyvvo (área
-- admin, US16). Esta migration adiciona o que falta pro dono do salão se
-- cadastrar sozinho: flag de e-mail verificado no usuário, dados de plano/
-- trial no tenant, WhatsApp como unique key e a tabela de tokens de validação.

-- Flag de e-mail verificado. Usuários já existentes foram onboardados
-- manualmente e são confiáveis — marca todos como verificados pra não
-- bloquear ninguém que já usa o portal. Só cadastros novos nascem com false.
alter table usuarios add column if not exists email_verified boolean not null default false;
update usuarios set email_verified = true where email_verified = false;

-- Dados de plano/trial e WhatsApp do tenant. `status` é separado de `ativo`
-- (US16): `ativo` continua sendo o bloqueio administrativo (soft delete),
-- enquanto `status` descreve o ciclo de vida comercial da conta.
alter table tenants add column if not exists whatsapp text;
alter table tenants add column if not exists plano text;
alter table tenants add column if not exists status text not null default 'ativo'
  check (status in ('ativo', 'trial', 'suspenso', 'expirado', 'cancelado'));
alter table tenants add column if not exists trial_expires_at timestamptz;

-- WhatsApp é unique key (CA03). Índice parcial: tenants antigos sem WhatsApp
-- (null) não conflitam entre si.
create unique index if not exists uq_tenants_whatsapp on tenants (whatsapp) where whatsapp is not null;

-- Tokens de validação de 6 dígitos, usados tanto no canal e-mail quanto no
-- WhatsApp (o mesmo token vale pros dois — CA06). Uso único (`usado`),
-- expiração em 30 min (`expires_at`) e no máximo 5 tentativas (`tentativas`).
create table if not exists tokens_validacao (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references usuarios(id) on delete cascade,
  token text not null,
  expires_at timestamptz not null,
  usado boolean not null default false,
  tentativas int not null default 0,
  criado_em timestamptz not null default now()
);

-- Consulta mais comum: o token pendente (não usado) de um usuário.
create index if not exists idx_tokens_validacao_user on tokens_validacao (user_id) where not usado;
-- Usado no rate limit de reenvios (CA11: máx. 5 por hora) e no cooldown de 60s.
create index if not exists idx_tokens_validacao_user_criado on tokens_validacao (user_id, criado_em);
