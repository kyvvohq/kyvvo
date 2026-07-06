-- Kyvvo — sistema de módulos e planos (US10 / ST10.1)
-- Estrutura de dados para ativar/desativar módulos por tenant. Sem cobrança
-- nesta etapa: a ativação/desativação é feita direto no banco por enquanto.

-- Catálogo fixo de módulos conhecidos.
-- preco_mensal fica nulo por enquanto — só precisa existir a coluna; a
-- precificação entra numa US futura.
create table modulos (
  key text primary key,
  nome text not null,
  preco_mensal numeric(10,2),
  criado_em timestamptz not null default now()
);

insert into modulos (key, nome) values
  ('agenda_inteligente',  'Agenda Inteligente'),
  ('financeiro',          'Financeiro'),
  ('dashboards',          'Dashboards'),
  ('estoque',             'Estoque'),
  ('comissao',            'Comissão'),
  ('campanhas_proativas', 'Campanhas Proativas');

-- Ativação de módulos por tenant.
create table tenant_modulos (
  tenant_id uuid not null references tenants(id) on delete cascade,
  modulo_key text not null references modulos(key) on delete cascade,
  ativo boolean not null default true,
  ativado_em timestamptz not null default now(),
  primary key (tenant_id, modulo_key)
);

-- Consulta mais comum: módulos ativos de um tenant (CA04).
create index idx_tenant_modulos_tenant on tenant_modulos (tenant_id) where ativo;

-- Migra todos os tenants existentes com o módulo agenda_inteligente ativo —
-- é o que todos já usam hoje.
insert into tenant_modulos (tenant_id, modulo_key, ativo)
select t.id, 'agenda_inteligente', true
from tenants t
on conflict (tenant_id, modulo_key) do nothing;
