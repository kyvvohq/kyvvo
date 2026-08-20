-- Bloqueio de feriados nacionais (Configurações > Bloqueio de agenda) — um
-- único switch por tenant, não linhas em bloqueios_agenda: o calendário de
-- feriados é computado em tempo real (fixos + móveis via cálculo da Páscoa,
-- ver listarFeriadosNacionais em index.js) em vez de pré-gerado ano a ano,
-- então não existe "feriado" persistido pra editar — só esse booleano.
alter table tenants add column if not exists feriados_bloqueados boolean not null default false;
