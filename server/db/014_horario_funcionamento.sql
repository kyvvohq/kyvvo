-- Horário de funcionamento do salão (abertura/fechamento), configurável por
-- tenant na aba Configuração. Substitui as constantes fixas 8h-20h que hoje
-- geram os slots de GET /agendamentos/disponibilidade e passam a valer como
-- limite real de validação em POST /agendamentos e PATCH /agendamentos/:id.
-- Defaults iguais às constantes antigas, pra não mudar o comportamento de
-- nenhum tenant existente até que alguém ajuste explicitamente.

alter table tenants add column horario_abertura time not null default '08:00';
alter table tenants add column horario_fechamento time not null default '20:00';
alter table tenants add constraint check_horario_funcionamento check (horario_abertura < horario_fechamento);
