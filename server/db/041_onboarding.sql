-- US56 — onboarding guiado pós-primeiro acesso (E5 — Onboarding e
-- self-service). O checklist cobre 3 passos: serviços, horário de
-- funcionamento e WhatsApp. Serviços e WhatsApp já têm estado observável
-- (COUNT(*) em servicos / meta_phone_number_id em tenants) — só falta um
-- jeito de saber se o horário (que sempre tem um valor, por causa do default
-- 08:00-20:00 da migration 014) foi de fato revisado pelo usuário, e um jeito
-- de o usuário dispensar o checklist sem perder a possibilidade de retomar
-- depois (CA "usuário pode retomar o onboarding depois").
alter table tenants add column if not exists onboarding_horario_revisado boolean not null default false;
alter table tenants add column if not exists onboarding_dispensado boolean not null default false;
