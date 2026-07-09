-- Segmento de negócio do tenant (salão de beleza, petshop, etc.) — usado só
-- pra adaptar terminologia/labels na UI (ex: "Nome do salão" vs "Nome do
-- petshop"), sem afetar comportamento funcional por enquanto. Lista curta e
-- fixa por CHECK em vez de tabela dedicada — mesmos nichos já usados na
-- landing page (server/public/index.html, .niches-row).

alter table tenants add column segmento text not null default 'salao_beleza'
  check (segmento in ('salao_beleza', 'petshop', 'psicologia', 'fisioterapia', 'pilates', 'outro'));

update tenants set segmento = 'petshop' where id = 'b2d17c9e-7186-4116-b740-7c169a9f9e84';
