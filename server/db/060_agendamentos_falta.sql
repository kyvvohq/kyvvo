-- Menu Relatórios precisa distinguir "não compareceu" (falta) de "cancelado
-- com aviso" — hoje os dois caem no mesmo status, sem jeito de medir taxa de
-- comparecimento nem estimar faturamento perdido por no-show separadamente
-- de cancelamento. Financeiramente os dois têm o mesmo efeito (a receita
-- prevista não acontece, ver sincronizarLancamentoFinanceiro em index.js),
-- mas pra relatório de agenda são eventos diferentes.

alter table agendamentos drop constraint if exists agendamentos_status_check;
alter table agendamentos add constraint agendamentos_status_check
  check (status in ('confirmado', 'cancelado', 'reagendado', 'concluido', 'falta'));
