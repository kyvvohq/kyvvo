-- US39.2 — inventário de "números prontos" (plano "Novo número"): números
-- adquiridos manualmente pela operação Kyvvo (fora do repositório, ver US40)
-- que um admin registra aqui e depois vincula a um salão específico, testando
-- o envio antes de considerar o número operacional. Reaproveita as mesmas
-- colunas meta_phone_number_id/meta_waba_id de tenants (033/034) — vincular
-- só copia os IDs pra lá, e o resto da Cloud API (status, webhook) já
-- funciona igual ao self-service (Embedded Signup).

create table numeros_prontos (
  id uuid primary key default gen_random_uuid(),
  telefone text not null,
  meta_phone_number_id text not null unique,
  meta_waba_id text not null,
  status text not null default 'disponivel'
    check (status in ('disponivel', 'reservado', 'em_configuracao', 'ativo', 'erro')),
  tenant_id uuid references tenants(id),
  vinculado_em timestamptz,
  vinculado_por uuid references kyvvo_admins(id),
  testado_em timestamptz,
  teste_resultado text,
  criado_por uuid references kyvvo_admins(id),
  criado_em timestamptz not null default now()
);
