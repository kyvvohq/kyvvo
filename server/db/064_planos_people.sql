-- Kyvvo People (produto separado, ver server/panel/asaas-service.js e o
-- módulo "people" já existente) ganha seus próprios planos, editáveis pelo
-- mesmo admin de Configurações que já edita os planos do Studio — reaproveita
-- a tabela `planos` (e `plano_limites`) em vez de criar um catálogo paralelo.
-- `produto` distingue as duas grades pra nunca vazar plano de um produto na
-- página pública do outro (GET /api/planos continua só Studio; People ganha
-- GET /api/planos/people à parte).
alter table planos add column produto text not null default 'studio';
alter table planos add constraint planos_produto_check check (produto in ('studio', 'people'));

-- "Business" (seção 10.1 da especificação) é "sob consulta" — sem preço fixo
-- pra cobrar via assinatura recorrente, então não vira linha aqui (fica só
-- como copy estática "fale conosco" no front do People). Só Start/
-- Professional são contratáveis por cartão/Pix.
insert into planos (chave, produto, nome, descricao, preco_mensal, ativo) values
  ('people_start', 'people', 'Start', 'Até 3 vagas ativas simultâneas', 197.00, true),
  ('people_professional', 'people', 'Professional', 'Até 10 vagas ativas simultâneas', 497.00, true);

-- plano_limites.chave tinha um CHECK fechado nas 3 chaves do Studio
-- (conversas_mes/profissionais/unidades) — precisa abrir pras 2 novas do
-- People antes de poder inserir linha com essas chaves.
alter table plano_limites drop constraint plano_limites_chave_check;
alter table plano_limites add constraint plano_limites_chave_check
  check (chave in ('conversas_mes', 'profissionais', 'unidades', 'vagas_ativas', 'candidatos_notificados_mes'));

insert into plano_limites (plano_chave, chave, valor) values
  ('people_start', 'vagas_ativas', 3),
  ('people_start', 'candidatos_notificados_mes', 150),
  ('people_professional', 'vagas_ativas', 10),
  ('people_professional', 'candidatos_notificados_mes', 600);
