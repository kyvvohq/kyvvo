// Área admin da Kyvvo — Monitoramento — extraído de index.js (fase 9 da
// modularização): GET /admin/api/whatsapp/status, GET /admin/api/ia-uso.
function registerAdminMonitoramentoRoutes(fastify, pool) {
  // Status de conexão do WhatsApp — chama a Graph API da Meta ao vivo com as
  // credenciais configuradas (META_WHATSAPP_TOKEN/META_PHONE_NUMBER_ID) pra
  // diagnosticar problema de token/permissão sem precisar entrar no painel da
  // Meta ou no servidor.
  fastify.get('/admin/api/whatsapp/status', { preHandler: [fastify.authenticateAdmin] }, async () => {
    const metaToken = process.env.META_WHATSAPP_TOKEN;
    const phoneNumberId = process.env.META_PHONE_NUMBER_ID;
    const meta = { configurado: Boolean(metaToken && phoneNumberId), phoneNumberId: phoneNumberId || null };

    if (meta.configurado) {
      try {
        const res = await fetch(
          `https://graph.facebook.com/v22.0/${phoneNumberId}?fields=display_phone_number,verified_name,quality_rating,code_verification_status`,
          { headers: { Authorization: `Bearer ${metaToken}` }, signal: AbortSignal.timeout(8000) }
        );
        const corpo = await res.json();
        if (res.ok) {
          meta.conectado = true;
          meta.numeroExibido = corpo.display_phone_number || null;
          meta.nomeVerificado = corpo.verified_name || null;
          meta.qualidade = corpo.quality_rating || null;
          meta.statusVerificacao = corpo.code_verification_status || null;
        } else {
          meta.conectado = false;
          meta.erro = (corpo.error && corpo.error.message) || `A Meta respondeu ${res.status}.`;
        }
      } catch (err) {
        meta.conectado = false;
        meta.erro = `Falha ao contatar a Meta: ${err.message}`;
      }
    }

    return { meta, verificadoEm: new Date().toISOString() };
  });

  // Dashboard de consumo da IA (US68) — volume de mensagens/conversas por
  // tenant/dia e custo real em R$, calculado a partir dos tokens capturados
  // em cada turno do assistente (só linhas role='assistant' têm
  // tokens_entrada/tokens_saida — são as únicas que chamam a Anthropic API).
  // Mensagens salvas antes da migration 053 ficam com tokens null: entram no
  // volume mas não somam custo.
  const IA_PRECO_USD_ENTRADA_POR_MILHAO = 1.0; // Claude Haiku 4.5
  const IA_PRECO_USD_SAIDA_POR_MILHAO = 5.0;
  // Cotação fixa aproximada (não é uma cotação ao vivo) — ajustar aqui de
  // tempos em tempos se o real variar muito contra o dólar.
  const IA_USD_PARA_BRL = 5.3;

  function calcularCustoReaisIA(tokensEntrada, tokensSaida) {
    const usd = (tokensEntrada / 1e6) * IA_PRECO_USD_ENTRADA_POR_MILHAO
      + (tokensSaida / 1e6) * IA_PRECO_USD_SAIDA_POR_MILHAO;
    return Number((usd * IA_USD_PARA_BRL).toFixed(2));
  }

  fastify.get('/admin/api/ia-uso', { preHandler: [fastify.authenticateAdmin] }, async (request) => {
    const dias = Math.min(Math.max(parseInt(request.query.dias, 10) || 30, 1), 90);

    const { rows: porDia } = await pool.query(
      `SELECT (criado_em AT TIME ZONE 'America/Sao_Paulo')::date AS dia,
              count(*) FILTER (WHERE role = 'assistant') AS mensagens,
              coalesce(sum(tokens_entrada), 0) AS tokens_entrada,
              coalesce(sum(tokens_saida), 0) AS tokens_saida
         FROM conversas_ia
        WHERE criado_em >= now() - ($1 || ' days')::interval
        GROUP BY 1
        ORDER BY 1`,
      [dias]
    );

    const { rows: porTenant } = await pool.query(
      `SELECT t.id AS tenant_id, t.nome AS tenant_nome,
              count(*) FILTER (WHERE c.role = 'assistant') AS mensagens,
              count(DISTINCT c.cliente_id) AS conversas,
              coalesce(sum(c.tokens_entrada), 0) AS tokens_entrada,
              coalesce(sum(c.tokens_saida), 0) AS tokens_saida,
              count(*) FILTER (WHERE c.role = 'assistant' AND c.intent = 'fallback_humano') AS fallback_humano
         FROM conversas_ia c
         JOIN tenants t ON t.id = c.tenant_id
        WHERE c.criado_em >= now() - ($1 || ' days')::interval
        GROUP BY t.id, t.nome
        ORDER BY mensagens DESC`,
      [dias]
    );

    const { rows: porIntent } = await pool.query(
      `SELECT coalesce(intent, 'unknown') AS intent, count(*) AS quantidade
         FROM conversas_ia
        WHERE role = 'assistant' AND criado_em >= now() - ($1 || ' days')::interval
        GROUP BY 1
        ORDER BY 2 DESC`,
      [dias]
    );

    const totalMensagens = porDia.reduce((soma, r) => soma + Number(r.mensagens), 0);
    const totalTokensEntrada = porDia.reduce((soma, r) => soma + Number(r.tokens_entrada), 0);
    const totalTokensSaida = porDia.reduce((soma, r) => soma + Number(r.tokens_saida), 0);
    const totalFallback = porTenant.reduce((soma, r) => soma + Number(r.fallback_humano), 0);

    return {
      periodo: { dias },
      resumo: {
        totalMensagens,
        tenantsAtivos: porTenant.length,
        tokensEntrada: totalTokensEntrada,
        tokensSaida: totalTokensSaida,
        custoReaisTotal: calcularCustoReaisIA(totalTokensEntrada, totalTokensSaida),
        taxaFallbackHumano: totalMensagens ? Number(((totalFallback / totalMensagens) * 100).toFixed(1)) : 0,
      },
      porDia: porDia.map((r) => ({
        dia: r.dia.toISOString().slice(0, 10),
        mensagens: Number(r.mensagens),
        custoReais: calcularCustoReaisIA(Number(r.tokens_entrada), Number(r.tokens_saida)),
      })),
      porTenant: porTenant.map((r) => ({
        tenantId: r.tenant_id,
        tenantNome: r.tenant_nome,
        mensagens: Number(r.mensagens),
        conversas: Number(r.conversas),
        tokensEntrada: Number(r.tokens_entrada),
        tokensSaida: Number(r.tokens_saida),
        custoReais: calcularCustoReaisIA(Number(r.tokens_entrada), Number(r.tokens_saida)),
        taxaFallbackHumano: Number(r.mensagens) > 0
          ? Number(((Number(r.fallback_humano) / Number(r.mensagens)) * 100).toFixed(1))
          : 0,
      })),
      porIntent: porIntent.map((r) => ({ intent: r.intent, quantidade: Number(r.quantidade) })),
    };
  });
}

module.exports = { registerAdminMonitoramentoRoutes };
