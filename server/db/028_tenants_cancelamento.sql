-- US35 — cancelamento de assinatura self-service (CA03/CA04). `cancelado_em`
-- registra quando o cancelamento foi confirmado; `acesso_ate` guarda até
-- quando o acesso pago continua, calculado a partir do nextDueDate da
-- assinatura no momento do cancelamento (depois de cancelada, a Asaas pode
-- não devolver mais essa informação).

alter table tenants add column if not exists cancelado_em timestamptz;
alter table tenants add column if not exists acesso_ate date;
