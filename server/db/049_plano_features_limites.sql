-- US74 — abaixo do preço, cada card passa a mostrar o incremento sobre o
-- plano base ("Tudo do Essencial, mais:") e os limites de uso
-- (conversas/mês, profissionais, unidades). `plano_chave`/`herda_de`
-- referenciam `planos.chave` (chave primária real da tabela — não existe
-- coluna `id` separada) e nunca a `slug` (que a US72 renomeia em paralelo).

alter table planos
  add column if not exists herda_de text references planos(chave);

-- CA01 — até 3 diferenciais por plano (label + ordem de exibição);
-- remove em cascata se o plano for excluído.
create table plano_features (
  id uuid primary key default gen_random_uuid(),
  plano_chave text not null references planos(chave) on delete cascade,
  label text not null,
  ordem integer not null default 1
);
create index idx_plano_features_plano on plano_features (plano_chave, ordem);

-- CA01 — limites de uso por plano; `valor` nulo = ilimitado. Chaves restritas
-- às 3 métricas definidas na US (conversas_mes/profissionais/unidades).
create table plano_limites (
  id uuid primary key default gen_random_uuid(),
  plano_chave text not null references planos(chave) on delete cascade,
  chave text not null check (chave in ('conversas_mes', 'profissionais', 'unidades')),
  valor integer,
  unidade text,
  unique (plano_chave, chave)
);

-- Herança (CA02/CA03: "Tudo do {herda_de_nome}, mais:") — Essencial é a
-- base; Essencial Plus e Smart herdam dela; Smart Plus herda de Smart
-- (adiciona a camada de IA por cima do que Essencial Plus já tem).
update planos set herda_de = 'starter' where chave = 'business';
update planos set herda_de = 'starter' where chave = 'professional';
update planos set herda_de = 'professional' where chave = 'enterprise';

insert into plano_features (plano_chave, label, ordem) values
  ('starter', 'Fluxo guiado por listas e botões', 1),
  ('starter', 'Confirmação automática', 2),
  ('starter', 'Agenda sem conflito de horário', 3),
  ('business', 'Número virtual gerenciado pelo Kyvvo', 1),
  ('business', 'Verificação na Meta feita por nós', 2),
  ('business', 'Pronto para atender no mesmo dia', 3),
  ('professional', 'Bot entende linguagem natural', 1),
  ('professional', 'Reagendamento e cancelamento por texto livre', 2),
  ('professional', 'Menos conversa abandonada', 3),
  ('enterprise', 'Número virtual gerenciado pelo Kyvvo', 1),
  ('enterprise', 'Verificação na Meta feita por nós', 2),
  ('enterprise', 'Atendimento por IA sem configuração', 3);

-- Valores iniciais de piloto (não fechados comercialmente — editáveis no
-- admin, CA05). conversas_mes espelha o limite_disparos já existente por
-- plano; profissionais/unidades são um ponto de partida razoável pro MVP
-- (nenhum tenant real ainda usa multi-unidade).
insert into plano_limites (plano_chave, chave, valor) values
  ('starter', 'conversas_mes', 100), ('starter', 'profissionais', 3), ('starter', 'unidades', 1),
  ('business', 'conversas_mes', 100), ('business', 'profissionais', 3), ('business', 'unidades', 1),
  ('professional', 'conversas_mes', 500), ('professional', 'profissionais', 5), ('professional', 'unidades', 1),
  ('enterprise', 'conversas_mes', 500), ('enterprise', 'profissionais', 5), ('enterprise', 'unidades', 1);
