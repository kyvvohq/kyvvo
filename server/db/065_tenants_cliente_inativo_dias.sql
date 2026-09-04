-- Limiar de "cliente inativo" configurável por tenant (Preferências, painel
-- do salão) — antes era um número fixo de 30 dias, cravado direto em SQL
-- (ver server/panel/routes/clientes.js e a query "sem retorno" do dashboard
-- Início em index.js). Cada negócio tem seu próprio ritmo de retorno de
-- cliente, então o Bruno/tenant decide o valor; 30 continua sendo o default
-- pra quem nunca mexeu na tela.
alter table tenants add column if not exists cliente_inativo_dias integer not null default 30;
alter table tenants add constraint tenants_cliente_inativo_dias_check check (cliente_inativo_dias between 1 and 365);
