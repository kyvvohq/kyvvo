-- US21 — serviço centralizado de tokens de validação (E5 — Onboarding e
-- self-service). Generaliza a tabela `tokens_validacao` (criada na US20 só
-- pra verificação de e-mail no cadastro) pra também cobrir recuperação de
-- senha e alteração de e-mail/WhatsApp: cada token passa a carregar o `tipo`
-- de fluxo a que pertence (CA01). Linhas existentes (só de cadastro) recebem
-- o tipo 'email_verificacao'.
alter table tokens_validacao add column if not exists tipo text not null default 'email_verificacao'
  check (tipo in ('email_verificacao', 'recuperacao_senha', 'alteracao_email', 'alteracao_whatsapp'));

-- "Token pendente" agora é por (user_id, tipo), não só por user_id: um
-- usuário pode ter, por exemplo, uma verificação de e-mail pendente e um
-- pedido de recuperação de senha pendente ao mesmo tempo, sem que gerar um
-- invalide o outro (CA05).
drop index if exists idx_tokens_validacao_user;
create index if not exists idx_tokens_validacao_user_tipo on tokens_validacao (user_id, tipo) where not usado;
