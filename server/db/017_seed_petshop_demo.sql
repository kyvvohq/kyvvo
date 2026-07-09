-- Tenant de demonstração (Pet Shop) — dados fictícios, criado pra validar de
-- verdade o multi-tenant (US13: o bot resolve tenant dinamicamente, o portal
-- isola tudo por tenant_id) com um segundo salão além do "Salão Kyvvo Teste".
-- Sem instância de WhatsApp conectada ainda (instancia_whatsapp fica NULL) —
-- só acesso ao portal web por enquanto.
--
-- O usuário de login (tabela usuarios) é criado à parte, direto em produção
-- via SSH, e não neste arquivo — não commitamos hash de senha no repositório,
-- mesmo sendo credencial de demo.

with novo_tenant as (
  insert into tenants (nome, telefone, endereco, horario_abertura, horario_fechamento)
  values (
    'PetShop Amigo Fiel (Demo)',
    '5511988887777',
    'Rua das Flores, 123 - São Paulo/SP',
    '09:00',
    '18:00'
  )
  returning id
),
modulo_agenda as (
  insert into tenant_modulos (tenant_id, modulo_key, ativo)
  select id, 'agenda_inteligente', true
  from novo_tenant
),
servicos_criados as (
  insert into servicos (tenant_id, nome, duracao_minutos, preco)
  select id, s.nome, s.duracao_minutos, s.preco
  from novo_tenant, (values
    ('Banho', 60, 60.00),
    ('Tosa', 45, 50.00),
    ('Banho e Tosa', 90, 95.00),
    ('Hidratação', 30, 40.00),
    ('Corte de unhas', 15, 20.00)
  ) as s(nome, duracao_minutos, preco)
  returning id, tenant_id, nome
),
profissionais_criados as (
  insert into profissionais (tenant_id, nome)
  select id, p.nome
  from novo_tenant, (values ('Carlos Tosador'), ('Fernanda Banhista')) as p(nome)
  returning id, tenant_id
)
-- Ambos os profissionais atendem todos os serviços (petshop pequeno, demo).
insert into profissionais_servicos (profissional_id, servico_id)
select p.id, s.id
from profissionais_criados p
join servicos_criados s on s.tenant_id = p.tenant_id;
