-- US68.1 — histórico de conversas do motor de IA (Claude Haiku 4.5) e
-- controle de handoff pra atendimento humano. Cada mensagem (do cliente e da
-- IA) vira uma linha própria — nunca sobrescrita — pra servir de contexto nas
-- próximas chamadas à Anthropic API e pra auditoria.
create table conversas_ia (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  cliente_id uuid not null references clientes(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  conteudo text not null,
  intent text,
  criado_em timestamptz not null default now()
);

create index idx_conversas_ia_tenant_cliente on conversas_ia (tenant_id, cliente_id, criado_em desc);

-- US68.6 — enquanto 'aguardando_humano', o roteador (US68.2) não encaminha
-- novas mensagens desse cliente pra IA; o salão retoma manualmente (fora do
-- escopo desta US, que só cria o campo de controle).
alter table clientes
  add column if not exists status_conversa text not null default 'ativo'
  check (status_conversa in ('ativo', 'aguardando_humano'));
