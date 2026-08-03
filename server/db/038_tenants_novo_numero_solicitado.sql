-- US39.1 — jornada de ativação do "Novo número": passo 2/3 (coleta de dados
-- mínimos + confirmação de expectativa). Os demais dados mínimos já existem
-- em tenants (nome, telefone, segmento, horario_abertura/fechamento) e em
-- usuarios (nome do responsável) desde o cadastro — só falta a preferência
-- de DDD e o registro de quando o pedido foi feito, pra a operação (Bruno)
-- saber quem está esperando um número (ver checklist da US39.1: vincular via
-- numeros_prontos.tenant_id, migration 037, quando o número estiver pronto).

alter table tenants add column novo_numero_ddd_preferencia text;
alter table tenants add column novo_numero_solicitado_em timestamptz;
