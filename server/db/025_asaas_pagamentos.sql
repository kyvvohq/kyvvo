-- US32 — Aba de pagamentos no portal, integração com Asaas (Pix recorrente ou
-- cartão de crédito) para manter a assinatura ativa após o trial (E3 —
-- Sistema de módulos e planos).
--
-- `plano` e `status` já existem desde a US20 (021_cadastro_self_service.sql);
-- só falta o identificador do cliente/assinatura no Asaas e o estado
-- "inadimplente" no ciclo de vida comercial (CA10/CA07).

alter table tenants add column if not exists asaas_customer_id text;
alter table tenants add column if not exists asaas_subscription_id text;
-- Meio de pagamento ativo ('pix' | 'cartao') e os 4 últimos dígitos do cartão
-- (quando aplicável), só para exibição na aba de pagamentos (CA08) — os
-- dados completos do cartão nunca chegam ao servidor Kyvvo (CA06/CA12).
alter table tenants add column if not exists asaas_meio_pagamento text
  check (asaas_meio_pagamento in ('pix', 'cartao'));
alter table tenants add column if not exists asaas_cartao_final text;

alter table tenants drop constraint if exists tenants_status_check;
alter table tenants add constraint tenants_status_check
  check (status in ('ativo', 'trial', 'inadimplente', 'suspenso', 'expirado', 'cancelado'));
