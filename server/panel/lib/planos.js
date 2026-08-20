// Catálogo de planos (chave -> {nome, preco_mensal, ...}) — extraído de
// index.js (fase 1 da modularização). Lido da tabela `planos`, nunca mais
// hardcoded. Recarregado no boot e logo após qualquer PATCH de um plano, pra
// refletir mudança de preço/nome/descrição imediatamente nas próximas
// assinaturas (sem afetar as já existentes, que já têm o valor gravado na
// Subscription da Asaas).
//
// `planosCache` é interno ao módulo (nunca exportado bruto) — quem precisa
// ler um plano usa `obterPlano(chave)`, que sempre lê o valor atual, mesmo
// depois de um `carregar()` reatribuir o cache inteiro.
let planosCache = {};
let pool;

function init(poolInstance) {
  pool = poolInstance;
}

async function carregar() {
  const { rows } = await pool.query(
    `SELECT chave, slug, nome, descricao, tecnologia, tipo_numero, preco_mensal,
            limite_disparos, destaque, badge, ativo
       FROM planos`
  );
  planosCache = Object.fromEntries(rows.map((r) => [r.chave, r]));
}

function obterPlano(chave) {
  return planosCache[chave];
}

function obterTodos() {
  return Object.values(planosCache);
}

// Plano que um tenant sem plano escolhido (trial ou nulo) contrata ao
// cadastrar pagamento — qual plano é o "padrão" é uma decisão de produto,
// não uma configuração de preço, por isso continua fixo no código. US67:
// sucessor do antigo 'profissional' na grade 2x2 (mesmo limite de disparos e
// mesma tecnologia liberada no trial).
const PLANO_PADRAO_CHAVE = 'professional';

// Nome de exibição do plano — usado tanto no perfil do tenant quanto no
// detalhe do tenant na área admin, pra nunca divergir (US28/US33).
function nomeDoPlano(chave) {
  if (chave === 'trial') return 'Trial';
  return (planosCache[chave] && planosCache[chave].nome) || 'Não definido';
}

module.exports = { init, carregar, obterPlano, obterTodos, nomeDoPlano, PLANO_PADRAO_CHAVE };
