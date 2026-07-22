-- Vínculo tenant <-> número da API oficial da Meta (WhatsApp Cloud API), pra
-- o bot de agendamento (workflow n8n "Kyvvo — Bot Agendamento v4 — Meta")
-- resolver o tenant dinamicamente pelo phone_number_id recebido no payload
-- do webhook — equivalente ao que instancia_whatsapp (015) faz hoje pro
-- fluxo Evolution API, mas os dois convivem em paralelo até a migração ser
-- validada e o fluxo antigo ser desligado.

alter table tenants add column meta_phone_number_id text unique;

-- Phone Number ID do número 34 98428-5182, confirmado na tela "Etapa 2.
-- Configuração da produção" do caso de uso WhatsApp Business Messaging
-- (o valor visto antes, 1219869254547193, era de uma tela diferente — o
-- número de teste temporário da "Etapa 1. Experimente" — e estava errado).
update tenants set meta_phone_number_id = '1263829973471596'
where id = 'f8f8601d-b395-475b-a8ae-d6059426daf9';
