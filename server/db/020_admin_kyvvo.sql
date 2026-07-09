-- US16 — área administrativa interna da Kyvvo, completamente separada do
-- login dos tenants (autenticação própria, sem tenant_id, JWT com secret
-- diferente). Usada pela equipe da Kyvvo pra onboarding/suporte, não pelos
-- clientes.

create table kyvvo_admins (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  senha_hash text not null,
  nome text not null,
  criado_em timestamptz not null default now()
);

-- "Desativar" um tenant é sempre soft — nunca deletamos um tenant com dado
-- real. Passa a bloquear login dos usuários daquele tenant quando false.
alter table tenants add column ativo boolean not null default true;
