-- US68 dashboard de consumo — captura tokens de entrada/saída por turno da IA
-- (só populado nas linhas role='assistant', que são as únicas que chamam a
-- Anthropic API; linhas role='user' ficam null).
alter table conversas_ia
  add column if not exists tokens_entrada integer,
  add column if not exists tokens_saida integer;
