-- US38 — preços dos planos e configurações gerais do sistema movem pro banco
-- (antes hardcoded em asaas-service.js/index.js), pra um admin da Kyvvo poder
-- alterar sem precisar de deploy. Alteração de preço afeta só novas
-- assinaturas — assinaturas existentes já têm o valor gravado na Subscription
-- da Asaas, então não são afetadas por uma mudança aqui.
--
-- `admin_id`/`atualizado_por`/`alterado_por` referenciam kyvvo_admins (não
-- existe uma tabela genérica "users" neste banco — só kyvvo_admins pro time da
-- Kyvvo e usuarios pro lado do tenant).

create table planos (
  chave text primary key,
  nome text not null,
  descricao text,
  preco_mensal numeric(10,2) not null check (preco_mensal >= 1),
  limite_disparos integer,
  ativo boolean not null default true,
  atualizado_em timestamptz not null default now(),
  atualizado_por uuid references kyvvo_admins(id)
);

insert into planos (chave, nome, descricao, preco_mensal, limite_disparos) values
  ('starter', 'Starter', 'Acesso web + bot WhatsApp', 147.00, 100),
  ('profissional', 'Profissional', 'Web + app mobile + 500 disparos', 247.00, 500),
  ('empresarial', 'Empresarial', 'Tudo + multi-unidades + disparos ilimitados', 447.00, null);

-- Configurações gerais (CA06) como chave/valor — texto sempre, cada leitor
-- converte pro tipo que precisa (numérico pros dias/tentativas, texto puro
-- pros contatos de suporte).
create table configuracoes_sistema (
  chave text primary key,
  valor text not null,
  atualizado_em timestamptz not null default now(),
  atualizado_por uuid references kyvvo_admins(id)
);

insert into configuracoes_sistema (chave, valor) values
  ('trial_dias', '14'),
  ('carencia_dias_inadimplencia', '3'),
  ('max_tentativas_reenvio_token', '5'),
  ('email_suporte', 'suporte@kyvvo.com.br'),
  ('whatsapp_suporte', '553484285182');

-- Log de auditoria (CA05/CA07) — uma linha por campo alterado, tanto de
-- planos quanto de configurações gerais.
create table log_configuracoes (
  id uuid primary key default gen_random_uuid(),
  campo text not null,
  valor_anterior text,
  valor_novo text,
  alterado_por uuid references kyvvo_admins(id),
  alterado_em timestamptz not null default now()
);
