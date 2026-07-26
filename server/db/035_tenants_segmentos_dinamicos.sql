-- US34 — cadastro (cadastro.html) passa a coletar Segmento via dropdown
-- dinâmico em vez de texto livre "Nome da empresa", e Telefone próprio do
-- responsável (`tenants.telefone` já existe desde 001_init.sql, mas até
-- aqui só era espelhado do whatsapp no self-service; nunca tinha valor
-- próprio vindo do usuário).
--
-- `tenants.segmento` (texto + check, 018) continua a fonte de verdade usada
-- por Perfil/Minha Empresa (app.js `infoSegmento`) e pelo CRUD admin de
-- tenants (`SEGMENTOS_VALIDOS`) — não é tocado aqui pra não quebrar essas
-- telas. `segmentos` é uma tabela nova só pra popular o dropdown do
-- cadastro dinamicamente (CA02); o slug de cada linha bate com os valores
-- já aceitos pelo check de `segmento`, e `segmento_id` é a referência nova
-- gravada a partir do cadastro, mantendo os dois campos sincronizados.
create table if not exists segmentos (
  id serial primary key,
  slug text not null unique,
  nome text not null,
  ativo boolean not null default true,
  criado_em timestamptz not null default now()
);

insert into segmentos (slug, nome) values
  ('salao_beleza', 'Salão de Beleza'),
  ('petshop', 'Pet Shop'),
  ('psicologia', 'Psicologia'),
  ('fisioterapia', 'Fisioterapia'),
  ('pilates', 'Pilates'),
  ('outro', 'Outro')
on conflict (slug) do nothing;

alter table tenants add column if not exists segmento_id integer references segmentos(id);
