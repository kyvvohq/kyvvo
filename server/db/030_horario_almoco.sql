-- Horário de almoço opcional do salão, configurável por tenant na aba
-- Configuração (mesmo padrão de horario_abertura/horario_fechamento da
-- 014_horario_funcionamento.sql). Desativado por padrão, pra não mudar o
-- comportamento de nenhum tenant existente até que alguém ligue a opção.

alter table tenants add column horario_almoco_ativo boolean not null default false;
alter table tenants add column horario_almoco_inicio time;
alter table tenants add column horario_almoco_fim time;

alter table tenants add constraint check_horario_almoco check (
  horario_almoco_ativo = false
  or (horario_almoco_inicio is not null and horario_almoco_fim is not null and horario_almoco_inicio < horario_almoco_fim)
);
