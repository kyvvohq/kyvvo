-- Kyvvo — schema inicial (E1: agendamento via WhatsApp)
-- Multi-tenant: cada linha carrega tenant_id, isolamento é feito por query (sem RLS, banco é Postgres puro no Railway)

create table tenants (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  telefone text,
  endereco text,
  criado_em timestamptz not null default now()
);

create table servicos (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  nome text not null,
  duracao_minutos int not null,
  preco numeric(10,2),
  criado_em timestamptz not null default now()
);

create table profissionais (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  nome text not null,
  criado_em timestamptz not null default now()
);

create table profissionais_servicos (
  profissional_id uuid not null references profissionais(id) on delete cascade,
  servico_id uuid not null references servicos(id) on delete cascade,
  primary key (profissional_id, servico_id)
);

create table clientes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  nome text,
  telefone text not null,
  criado_em timestamptz not null default now(),
  unique (tenant_id, telefone)
);

create table agendamentos (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  cliente_id uuid not null references clientes(id) on delete cascade,
  profissional_id uuid not null references profissionais(id) on delete cascade,
  servico_id uuid not null references servicos(id) on delete cascade,
  data_hora timestamptz not null,
  status text not null default 'confirmado' check (status in ('confirmado', 'cancelado', 'reagendado')),
  criado_em timestamptz not null default now()
);

create index idx_agendamentos_profissional_data on agendamentos (profissional_id, data_hora) where status = 'confirmado';
create index idx_agendamentos_tenant_data on agendamentos (tenant_id, data_hora);
create index idx_clientes_tenant_telefone on clientes (tenant_id, telefone);
