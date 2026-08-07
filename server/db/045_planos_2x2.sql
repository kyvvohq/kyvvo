-- US67 — a landing ganha uma seção de preços de verdade: grade 2x2
-- (tecnologia Bot/IA x número Próprio/Kyvvo), com o catálogo consultado
-- dinamicamente via GET /api/planos (sem auth). O catálogo da US38 tinha só
-- 3 planos (starter/profissional/empresarial), sem esses dois eixos.
--
-- Não faz TRUNCATE na tabela `planos`: `tenants.plano` grava a `chave` como
-- texto solto (sem FK), e o checkout (US32, `montarResumoPagamentos`/
-- `POST /api/pagamentos/cadastrar` em panel/index.js) resolve preço via essa
-- chave mesmo pra planos com `ativo = false` (ver comentário na própria
-- rota: "um plano desativado ainda pode ser usado aqui"). Apagar
-- 'profissional'/'empresarial' quebraria o checkout de qualquer tenant com
-- assinatura nesses planos legados. Em vez disso, os planos sem equivalente
-- direto na nova grade são desativados e preservados (mesma filosofia do
-- comentário em 029_configuracoes_sistema.sql: "clientes com assinaturas
-- ativas continuam pagando o valor original"); `starter` é reaproveitado,
-- já que bate 1:1 com a nova grade, e `profissional` vira a base do novo
-- `professional` (mesmo limite de disparos: 500).

alter table planos
  add column if not exists slug text,
  add column if not exists tecnologia text check (tecnologia in ('bot', 'ia')),
  add column if not exists tipo_numero text check (tipo_numero in ('proprio', 'kyvvo')),
  add column if not exists destaque boolean not null default false,
  add column if not exists badge text;

update planos set slug = chave where slug is null;
alter table planos alter column slug set not null;
alter table planos add constraint planos_slug_key unique (slug);

-- Planos legados sem equivalente na grade 2x2 saem de circulação pra novas
-- assinaturas (não aparecem mais em GET /api/planos, que só lista ativos),
-- mas continuam resolvendo preço pra quem já os tem.
update planos set ativo = false where chave in ('profissional', 'empresarial');

insert into planos
  (chave, slug, nome, descricao, tecnologia, tipo_numero, preco_mensal, limite_disparos, destaque, badge, ativo)
values
  ('starter', 'starter', 'Starter', 'Bot de agendamento + número próprio', 'bot', 'proprio', 79.90, 100, false, null, true),
  ('business', 'business', 'Business', 'Bot de agendamento + número Kyvvo pronto', 'bot', 'kyvvo', 119.90, 100, false, null, true),
  ('professional', 'professional', 'Professional', 'IA conversacional + número próprio', 'ia', 'proprio', 149.90, 500, false, null, true),
  ('enterprise', 'enterprise', 'Enterprise', 'IA conversacional + número Kyvvo pronto', 'ia', 'kyvvo', 179.90, 500, true, 'Mais popular', true)
on conflict (chave) do update set
  slug = excluded.slug,
  nome = excluded.nome,
  descricao = excluded.descricao,
  tecnologia = excluded.tecnologia,
  tipo_numero = excluded.tipo_numero,
  preco_mensal = excluded.preco_mensal,
  limite_disparos = excluded.limite_disparos,
  destaque = excluded.destaque,
  badge = excluded.badge,
  ativo = true;
