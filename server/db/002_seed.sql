-- Kyvvo — dado fictício pra testar o bot (trocar pelo salão real depois)

with novo_tenant as (
  insert into tenants (nome, telefone, endereco)
  values ('Salão Kyvvo Teste', '5511999999999', 'Rua Exemplo, 123 — São Paulo/SP')
  returning id
),
novos_servicos as (
  insert into servicos (tenant_id, nome, duracao_minutos, preco)
  select id, s.nome, s.duracao, s.preco
  from novo_tenant, (values
    ('Corte', 30, 50.00),
    ('Escova', 45, 40.00),
    ('Coloração', 90, 150.00)
  ) as s(nome, duracao, preco)
  returning id, tenant_id, nome
),
novos_profissionais as (
  insert into profissionais (tenant_id, nome)
  select id, p.nome
  from novo_tenant, (values ('Ana'), ('Bruna')) as p(nome)
  returning id, nome
)
insert into profissionais_servicos (profissional_id, servico_id)
select pr.id, sv.id
from novos_profissionais pr
cross join novos_servicos sv;

select t.id as tenant_id, t.nome as tenant_nome
from tenants t
where t.nome = 'Salão Kyvvo Teste';
