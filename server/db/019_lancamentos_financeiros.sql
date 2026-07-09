-- US18 (ST18.1) — primeira funcionalidade real do módulo "financeiro"
-- (catálogo já existia desde US10/ST10.1, nunca tinha sido construído).
-- Livro-caixa manual simples: entrada/saída registrada à mão pela dona do
-- salão/petshop, sem integração automática com pagamento de cliente ainda.

create table lancamentos_financeiros (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  tipo text not null check (tipo in ('entrada', 'saida')),
  valor numeric(10,2) not null check (valor > 0),
  descricao text,
  data date not null default current_date,
  criado_em timestamptz not null default now()
);

create index idx_lancamentos_tenant_data on lancamentos_financeiros (tenant_id, data);
