-- A Asaas exige CPF ou CNPJ do Customer para emitir uma cobrança (Pix ou
-- cartão) — descoberto só ao testar US32 com uma chave de API real de
-- sandbox (o modo dev, sem chave, nunca chama a API de verdade e por isso
-- nunca teria acusado essa exigência).

alter table tenants add column if not exists cpf_cnpj text;
