-- US33 — perfil editável no portal: nome do responsável (usuário) e endereço
-- estruturado em subcampos (CEP/logradouro/número/complemento/bairro/cidade/
-- UF) para autopreenchimento via ViaCEP e futura geolocalização (CA04).
--
-- A coluna livre `tenants.endereco` (usada pelo CRUD manual da área admin,
-- US16) não é alterada nem migrada — o portal passa a usar exclusivamente os
-- novos subcampos a partir desta US; tenants criados pela área admin nascem
-- com esses subcampos vazios até o próprio usuário preenchê-los pelo Meu
-- Perfil. `usuarios.nome` já existe desde o início (US03) e passa a ser
-- editável pelo próprio usuário como "Nome do Responsável" (CA02).

alter table tenants add column if not exists endereco_cep text;
alter table tenants add column if not exists endereco_logradouro text;
alter table tenants add column if not exists endereco_numero text;
alter table tenants add column if not exists endereco_complemento text;
alter table tenants add column if not exists endereco_bairro text;
alter table tenants add column if not exists endereco_cidade text;
alter table tenants add column if not exists endereco_uf text;
