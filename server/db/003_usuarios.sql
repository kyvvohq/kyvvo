-- Kyvvo — login do dono do salão (E2: painel web)

create table usuarios (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  email text not null unique,
  senha_hash text not null,
  nome text,
  criado_em timestamptz not null default now()
);

create index idx_usuarios_email on usuarios (email);
