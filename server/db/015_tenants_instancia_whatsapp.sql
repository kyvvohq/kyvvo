-- US13 (ST13.1/ST13.2) — vínculo tenant <-> instância do WhatsApp (Evolution
-- API), pra o bot resolver o tenant dinamicamente pelo instanceName recebido
-- no payload do webhook, em vez de um TENANT_ID fixo hardcoded no workflow.

alter table tenants add column instancia_whatsapp text unique;

update tenants set instancia_whatsapp = 'kyvvo-salao'
where id = 'f8f8601d-b395-475b-a8ae-d6059426daf9';
