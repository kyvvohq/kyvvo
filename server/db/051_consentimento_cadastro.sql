-- US79 — aceite obrigatório de Termos de Uso/Política de Privacidade e
-- consentimento (opcional) de marketing no cadastro self-service. Trilha de
-- auditoria imutável: cada aceite gera uma linha nova, nunca é sobrescrita —
-- se os termos mudarem e o tenant precisar re-aceitar no futuro, isso também
-- vira um INSERT novo, preservando o histórico completo.
create table consentimentos_cadastro (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  termos_versao text not null,
  privacidade_versao text not null,
  aceita_marketing boolean not null default false,
  ip text,
  aceito_em timestamptz not null default now()
);

create index consentimentos_cadastro_tenant_id_idx on consentimentos_cadastro (tenant_id);
