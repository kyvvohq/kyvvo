-- US52 — eventos de analytics do funil de conversão pós-trial (aviso de
-- vencimento, trial expirado, tela de bloqueio exibida, início e conclusão
-- do cadastro de pagamento). Registro simples, append-only; os tipos válidos
-- são validados em código (ver EVENTOS_ANALYTICS_* em index.js), não há
-- enum/check aqui pra não precisar de migration toda vez que um tipo novo
-- for adicionado.

create table if not exists eventos_analytics (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  tipo text not null,
  criado_em timestamptz not null default now()
);

-- Consulta mais comum: histórico de eventos de um tenant em ordem
-- cronológica; também usada pelo dedup de "trial_expirado" (só grava uma
-- vez por tenant).
create index if not exists idx_eventos_analytics_tenant on eventos_analytics (tenant_id, tipo, criado_em);
