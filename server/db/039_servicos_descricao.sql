-- US60: serviço ganha uma descrição curta (opcional), pra dar mais contexto
-- ao dono do salão e, futuramente, ao bot de WhatsApp na hora de detalhar o
-- serviço pro cliente. Sem limite de tamanho no banco — a validação de
-- "curta" (280 caracteres) fica na API, igual ao padrão de outros campos de
-- texto livre do sistema.

alter table servicos add column descricao text;
