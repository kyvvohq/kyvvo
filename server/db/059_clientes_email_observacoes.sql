-- Menu Clientes reformulado: cadastro manual, busca unificada (nome/
-- telefone/e-mail), indicadores (total/novos no mês/pra retornar) e perfil
-- do cliente com observações livres.
alter table clientes add column if not exists email text;
alter table clientes add column if not exists observacoes text;
