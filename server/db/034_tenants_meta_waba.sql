-- Self-service de conexão do WhatsApp (Embedded Signup da Meta) — cada
-- tenant vai ter sua própria WhatsApp Business Account ao conectar o número
-- dele. meta_phone_number_id já existe (033); meta_waba_id é o outro
-- identificador que o Embedded Signup devolve, necessário pra assinar o
-- webhook daquela conta (POST /{waba_id}/subscribed_apps).

alter table tenants add column meta_waba_id text unique;
