-- Bloqueio de acesso por inadimplência/suspensão/cancelamento vencido.
-- `status_alterado_em` registra quando `tenants.status` mudou pela última
-- vez (setado pelo webhook da Asaas) — usado pra calcular o fim da carência
-- de CARENCIA_DIAS_INADIMPLENCIA antes de bloquear quem está 'inadimplente'
-- (suspenso/cancelado vencido bloqueiam sem carência, ver authenticate).

alter table tenants add column if not exists status_alterado_em timestamptz;
