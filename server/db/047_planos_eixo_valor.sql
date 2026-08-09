-- US72 — planos ganham nomenclatura pelo eixo de valor (Essencial/Smart x
-- número próprio/Kyvvo) em vez da escada por porte (Starter/Business/
-- Professional/Enterprise), que sugeria uma hierarquia linear errada
-- (Business parecia "menor" que Professional só por vir antes na escada,
-- quando na verdade são eixos diferentes: número vs inteligência).
--
-- `chave` (identificador interno, usado em tenants.plano/PLANO_PADRAO_CHAVE
-- e em toda a UI admin) e todos os outros campos (id, preco_mensal,
-- tecnologia, tipo_numero) permanecem intocados — só nome e slug mudam.
-- Links antigos (?plano=starter) continuam funcionando sem tabela de
-- aliases: como `chave` nunca muda e era igual ao slug antigo, GET
-- /api/planos/:slug passa a aceitar `slug = $1 OR chave = $1`.
update planos set nome = 'Essencial', slug = 'essencial' where chave = 'starter';
update planos set nome = 'Essencial Plus', slug = 'essencial-plus' where chave = 'business';
update planos set nome = 'Smart', slug = 'smart' where chave = 'professional';
update planos set nome = 'Smart Plus', slug = 'smart-plus' where chave = 'enterprise';
