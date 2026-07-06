-- Kyvvo — canal de origem do agendamento (US09 / ST09.4)
-- Registra por qual canal o agendamento foi criado, para futuros relatórios de
-- canal (CA09): 'whatsapp' = bot de agendamento (E1), 'portal' = cadastro manual
-- feito pela dona no painel web.
--
-- O default é 'whatsapp' de propósito: os agendamentos que já existem vieram do
-- bot/seed (pré-portal) e o INSERT do bot no n8n não informa a coluna, então
-- ambos caem no canal correto sem precisar de alteração. O endpoint autenticado
-- do portal, por sua vez, sempre grava 'portal' explicitamente.
alter table agendamentos
  add column origem text not null default 'whatsapp'
  check (origem in ('portal', 'whatsapp'));
