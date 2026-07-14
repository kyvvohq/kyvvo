-- US30 — data de ativação do tenant: momento exato em que o usuário
-- confirmou o token de validação com sucesso (POST /auth/verify-token,
-- email_verified = true). Diferente de `criado_em`/cadastro: um tenant pode
-- ter se cadastrado e nunca ativado (ativado_em fica null).

alter table tenants add column if not exists ativado_em timestamptz;
