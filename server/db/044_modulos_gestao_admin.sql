-- US65 — gestão de módulos por salão no portal Admin: ativar/desativar por
-- tenant pela interface (sem alteração manual no banco), com módulos
-- obrigatórios bloqueados para remoção e auditoria de cada alteração.

-- CA04 — módulos obrigatórios do core não podem ser removidos. Só
-- agenda_inteligente é obrigatório hoje: é a base do produto e todo tenant
-- já usa (migration 010).
alter table modulos add column obrigatorio boolean not null default false;
update modulos set obrigatorio = true where key = 'agenda_inteligente';

-- CA05 — histórico auditável de ativação/desativação de módulos por tenant.
-- Mesmo padrão de log_configuracoes (migration 029): uma linha por alteração,
-- estado anterior/novo gravados explicitamente pra não depender de derivar
-- de `acao`.
create table log_modulos_tenant (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  modulo_key text not null references modulos(key) on delete cascade,
  acao text not null check (acao in ('ativado', 'desativado')),
  estado_anterior boolean not null,
  estado_novo boolean not null,
  alterado_por uuid references kyvvo_admins(id),
  alterado_em timestamptz not null default now()
);

-- Consulta mais comum: histórico de um tenant em ordem cronológica (CA05).
create index idx_log_modulos_tenant on log_modulos_tenant (tenant_id, alterado_em desc);
