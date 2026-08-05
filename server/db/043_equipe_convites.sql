-- US62 — convites de equipe com perfis de acesso (E5 — Onboarding e
-- self-service). Até aqui só existia um usuário por tenant (o dono, criado
-- no cadastro self-service). `usuarios.tenant_id` nunca teve unicidade —
-- a tabela já suportava múltiplos usuários por tenant, só faltava um jeito
-- de convidar mais gente e um campo pra diferenciar o que cada um pode
-- fazer.
--
-- `role` (administrador/operador) — administrador continua com acesso
-- completo (comportamento de hoje, sem mudança pra quem já existe: default
-- 'administrador' também nos usuários já cadastrados). Operador tem acesso
-- operacional (agenda, clientes, cadastros do dia a dia), sem entrar em
-- cobrança/financeiro/configurações do negócio/gestão de equipe.
--
-- `ativo` — desativar (CA "administrador pode remover ou desativar membro")
-- sem apagar o histórico de quem criou/alterou o quê; DELETE continua
-- disponível pra remoção definitiva de quem nunca teve atividade relevante.
alter table usuarios add column if not exists role text not null default 'administrador'
  check (role in ('administrador', 'operador'));
alter table usuarios add column if not exists ativo boolean not null default true;

-- Convite de e-mail: token opaco (link, não código de 6 dígitos — diferente
-- do fluxo de verificação/recuperação do token-service.js, aqui é um clique
-- só, sem digitar nada). `status` cobre o ciclo pedido pela CA (pendente/
-- aceito/expirado): 'expirado' é computado na leitura comparando expires_at
-- com now() (não precisa de job pra atualizar a coluna), mas a coluna existe
-- pra registrar 'aceito'/'cancelado' de forma definitiva.
create table if not exists convites_equipe (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  email text not null,
  role text not null check (role in ('administrador', 'operador')),
  status text not null default 'pendente' check (status in ('pendente', 'aceito', 'expirado', 'cancelado')),
  token text not null unique,
  convidado_por uuid references usuarios(id) on delete set null,
  expires_at timestamptz not null,
  aceito_em timestamptz,
  criado_em timestamptz not null default now()
);

-- Só um convite pendente por e-mail dentro do mesmo tenant — reenviar
-- convite pro mesmo e-mail cancela o anterior antes de criar um novo (regra
-- da aplicação), o índice é o cinto de segurança contra corrida.
create unique index if not exists uq_convite_pendente on convites_equipe (tenant_id, lower(email)) where status = 'pendente';
create index if not exists idx_convites_tenant on convites_equipe (tenant_id, criado_em desc);
