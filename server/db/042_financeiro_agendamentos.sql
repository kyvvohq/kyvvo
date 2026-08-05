-- US64 — lançamento financeiro automático a partir de agendamentos com
-- serviço pago (E8 — Financeiro operacional). Duas mudanças de schema:
--
-- 1) `agendamentos.status` ganha o valor 'concluido' — até aqui o ciclo de
--    vida de um agendamento ia até 'confirmado'/'cancelado' (o 'reagendado'
--    do enum original nunca chegou a ser usado por nenhum código: reagendar
--    só troca `data_hora` no mesmo registro, sem mudar o status). "Concluído"
--    é o gatilho que converte receita prevista em realizada.
--
-- 2) `lancamentos_financeiros` ganha `agendamento_id` (rastreabilidade da
--    origem) e `status` (previsto/realizado/cancelado — diferencia receita
--    prevista de realizada). Lançamentos manuais existentes (livro-caixa,
--    US18) já representam um valor que efetivamente entrou/saiu, então
--    nascem como 'realizado' (default/backfill) e continuam sem
--    agendamento_id.
--
-- Um único lançamento por agendamento (sempre UPDATE em cima do existente em
-- vez de um segundo INSERT) evita duplicidade sem precisar de lógica de
-- "achar e desativar o antigo" — o índice único abaixo garante isso mesmo
-- que uma corrida escape da checagem da aplicação.

alter table agendamentos drop constraint if exists agendamentos_status_check;
alter table agendamentos add constraint agendamentos_status_check
  check (status in ('confirmado', 'cancelado', 'reagendado', 'concluido'));

alter table lancamentos_financeiros add column if not exists agendamento_id uuid references agendamentos(id) on delete set null;
alter table lancamentos_financeiros add column if not exists status text not null default 'realizado'
  check (status in ('previsto', 'realizado', 'cancelado'));

-- Único índice necessário: já serve tanto pra garantir "no máximo um
-- lançamento por agendamento" quanto pra achar esse lançamento rápido na
-- sincronização (ON CONFLICT (agendamento_id) usa exatamente este índice).
create unique index if not exists uq_lancamentos_agendamento on lancamentos_financeiros (agendamento_id) where agendamento_id is not null;
