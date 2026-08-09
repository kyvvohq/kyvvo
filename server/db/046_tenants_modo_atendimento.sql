-- US69 — expõe no admin Kyvvo o controle de modo de atendimento (bot/ia) por
-- tenant. `planos.tecnologia` (migration 045) é o padrão do plano contratado;
-- este `tenants.tecnologia` é o valor efetivo do tenant, que o admin Kyvvo
-- ajusta manualmente na troca de plano (US68 usa este campo pro roteador).
-- Backfill a partir do plano atual — todo tenant já tem um modo implícito
-- hoje, herdado do plano.
alter table tenants
  add column if not exists tecnologia text check (tecnologia in ('bot', 'ia'));

update tenants t
set tecnologia = coalesce(p.tecnologia, 'bot')
from planos p
where t.plano = p.chave and t.tecnologia is null;

update tenants set tecnologia = 'bot' where tecnologia is null;

alter table tenants alter column tecnologia set default 'bot';
alter table tenants alter column tecnologia set not null;

-- CA03 — auditoria de cada troca, mesmo padrão de log_modulos_tenant
-- (migration 044): uma linha por tenant/alteração, estado anterior/novo
-- gravados explicitamente. Log por tenant (não em log_configuracoes, que não
-- tem tenant_id e serve só pra configurações globais de planos/sistema).
create table log_modo_atendimento_tenant (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  valor_anterior text not null,
  valor_novo text not null,
  alterado_por uuid references kyvvo_admins(id),
  alterado_em timestamptz not null default now()
);

create index idx_log_modo_atendimento_tenant on log_modo_atendimento_tenant (tenant_id, alterado_em desc);
