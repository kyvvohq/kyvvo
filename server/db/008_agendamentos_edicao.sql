-- Kyvvo — suporte a edição de agendamentos (US08: reagendar, cancelar, encaixar)

alter table agendamentos add column updated_at timestamptz not null default now();
alter table agendamentos add column encaixe boolean not null default false;
