-- Vínculo tenant <-> número da API oficial da Meta (WhatsApp Cloud API), pra
-- o bot de agendamento (workflow n8n "Kyvvo — Bot Agendamento v4 — Meta")
-- resolver o tenant dinamicamente pelo phone_number_id recebido no payload
-- do webhook — equivalente ao que instancia_whatsapp (015) faz hoje pro
-- fluxo Evolution API, mas os dois convivem em paralelo até a migração ser
-- validada e o fluxo antigo ser desligado.

alter table tenants add column meta_phone_number_id text unique;

-- PREENCHER antes de rodar: o Phone Number ID do número 34 98428-5182 (não é
-- o telefone em si — é o ID que aparece na tela "Configuração da API" do
-- WhatsApp no painel da Meta, ao lado do número).
update tenants set meta_phone_number_id = 'PREENCHER_PHONE_NUMBER_ID'
where id = 'f8f8601d-b395-475b-a8ae-d6059426daf9';
