-- Serviços ganham dois estados novos, além do delete existente:
--
-- `ativo` (padrão true) — alternado pelo botão Desabilitar/Habilitar no
-- portal: quando false, o serviço continua listado (com aviso visual) mas
-- some do dropdown de "Novo agendamento"; o dono pode reativar a qualquer
-- momento. Segue a convenção já usada em tenant_modulos/tenants/
-- configuracoes_sistema (coluna booleana chamada exatamente `ativo`).
--
-- `excluido_em` (nulo = não excluído) — soft delete: some da listagem e de
-- novos agendamentos, mas a linha continua existindo pra não quebrar o
-- histórico de agendamentos antigos que a referenciam (servico_id tem ON
-- DELETE CASCADE — um hard delete apagaria esses agendamentos). O botão
-- "Excluir" do portal passa a fazer isso em vez de um DELETE de verdade.
--
-- `profissional_preferencial_id` (opcional) — ao criar/editar um serviço, o
-- dono pode marcar um profissional preferencial; ao escolher esse serviço em
-- "Novo agendamento", o profissional já vem pré-selecionado (o usuário ainda
-- pode trocar). ON DELETE SET NULL pra excluir um profissional nunca travar
-- nem apagar o serviço que o tinha como preferencial.

alter table servicos add column ativo boolean not null default true;
alter table servicos add column excluido_em timestamptz;
alter table servicos add column profissional_preferencial_id uuid references profissionais(id) on delete set null;
