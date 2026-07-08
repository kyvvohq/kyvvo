-- Bug: US09/CA02 marca telefone como opcional no formulário de novo agendamento,
-- mas clientes.telefone era NOT NULL — salvar sem telefone retornava 400.
-- NULL não conflita com a constraint unique (tenant_id, telefone) no Postgres
-- (NULL nunca é igual a NULL), então cada cliente sem telefone vira uma linha
-- nova em clientes, o que é o comportamento esperado pra quem não informou.

alter table clientes alter column telefone drop not null;
