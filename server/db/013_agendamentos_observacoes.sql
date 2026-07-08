-- Bug: o textarea "Observações" do formulário de novo agendamento (US09/CA02)
-- é coletado na UI, mas não existia coluna correspondente em agendamentos —
-- o valor era descartado silenciosamente no POST /api/agendamentos.

alter table agendamentos add column observacoes text;
