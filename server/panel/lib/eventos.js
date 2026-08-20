// Funil de conversão pós-trial (US52) — extraído de index.js (fase 1 da
// modularização). Precisa do pool do Postgres; mesmo padrão `init(pool)` já
// usado em token-service.js.
let pool;
function init(poolInstance) {
  pool = poolInstance;
}

// CA: aviso exibido, trial expirado, bloqueio exibido, pagamento iniciado,
// pagamento concluído. Tabela append-only (eventos_analytics); os tipos
// válidos são só esses, checados aqui em vez de num enum/check no banco.
const EVENTOS_ANALYTICS_TIPOS = new Set([
  'aviso_trial_exibido',
  'trial_expirado',
  'bloqueio_exibido',
  'pagamento_iniciado',
  'pagamento_concluido',
]);
// Subconjunto que o próprio frontend pode registrar via POST /api/eventos —
// os outros (trial_expirado, pagamento_iniciado/concluido) nascem direto nos
// handlers do backend, que já sabem que o evento de fato aconteceu; aceitar
// esses pelo endpoint deixaria qualquer tenant forjar métricas de conversão.
const EVENTOS_ANALYTICS_TIPOS_FRONTEND = new Set(['aviso_trial_exibido', 'bloqueio_exibido']);

async function registrarEvento(tenantId, tipo) {
  await pool.query('INSERT INTO eventos_analytics (tenant_id, tipo) VALUES ($1, $2)', [tenantId, tipo]);
}

// 'trial_expirado' marca a transição de estado, não uma impressão de tela —
// só grava na primeira vez que o guard de `authenticate` barra esse tenant,
// senão toda requisição bloqueada geraria uma linha nova.
async function registrarEventoTrialExpiradoUmaVez(tenantId) {
  const { rows } = await pool.query(
    "SELECT 1 FROM eventos_analytics WHERE tenant_id = $1 AND tipo = 'trial_expirado' LIMIT 1",
    [tenantId]
  );
  if (rows.length === 0) await registrarEvento(tenantId, 'trial_expirado');
}

module.exports = { init, EVENTOS_ANALYTICS_TIPOS, EVENTOS_ANALYTICS_TIPOS_FRONTEND, registrarEvento, registrarEventoTrialExpiradoUmaVez };
