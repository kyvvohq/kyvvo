-- US61: bloqueios manuais de agenda — período em que o dono do salão marca
-- a agenda como indisponível (férias, folga, compromisso pessoal, etc.),
-- impedindo novos agendamentos nesse intervalo. Complementa
-- dias_funcionamento/horario_abertura/horario_fechamento/horario_almoco
-- (tenants), que são a regra geral recorrente — isto aqui são exceções
-- pontuais, com início/fim livres (não só uma janela dentro de um dia).
--
-- `profissional_id` nulo = bloqueio vale pra agenda inteira (todos os
-- profissionais); preenchido = bloqueio só daquele profissional. ON DELETE
-- CASCADE (mesmo padrão de servicos/agendamentos): excluir um profissional
-- não deve deixar bloqueios órfãos apontando pra um id inexistente.
create table bloqueios_agenda (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  profissional_id uuid references profissionais(id) on delete cascade,
  inicio timestamptz not null,
  fim timestamptz not null,
  motivo text,
  criado_em timestamptz not null default now(),
  check (fim > inicio)
);

create index idx_bloqueios_agenda_tenant_periodo on bloqueios_agenda (tenant_id, inicio, fim);
