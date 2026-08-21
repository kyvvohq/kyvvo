// Pagamentos / Asaas (US32) — extraído de index.js (fase 8 da
// modularização): GET /api/pagamentos[/status], POST /api/pagamentos/cadastrar,
// PATCH /api/pagamentos/plano, DELETE /api/pagamentos/assinatura,
// POST /webhooks/asaas. montarResumoPagamentos virou lib/pagamentos.js
// (cross-cutting: também usada pela Área admin).
const planos = require('../lib/planos');
const asaasService = require('../asaas-service');
const configSistema = require('../lib/configuracoes-sistema');
const { calcularTrialTenant } = require('../lib/trial-conta');
const { UF_VALIDAS } = require('../lib/validadores');
const { registrarEvento } = require('../lib/eventos');
const { montarResumoPagamentos } = require('../lib/pagamentos');

// US32/CA05 — data da primeira cobrança da assinatura Asaas: se o trial (14
// dias a partir de `ativado_em`) ainda não acabou, a cobrança só nasce pra
// vencer no fim do trial; senão, vence hoje (tenant já devia estar pagando).
function proximaCobrancaRespeitandoTrial(tenant) {
  if (tenant.ativado_em) {
    const trialFim = new Date(new Date(tenant.ativado_em).getTime() + configSistema.config.trialDias * 24 * 60 * 60 * 1000);
    if (trialFim.getTime() > Date.now()) return trialFim.toISOString().slice(0, 10);
  }
  return new Date().toISOString().slice(0, 10);
}

function registerPagamentosRoutes(fastify, pool) {
  const CARTAO_FINAL_REGEX = /^\d{4}$/;
  // A Asaas exige CPF (11 dígitos) ou CNPJ (14) do Customer pra emitir
  // cobrança — descoberto só ao testar com uma chave de API real (o modo
  // dev nunca chama a API de verdade, então nunca acusaria essa exigência).
  const CPF_CNPJ_REGEX = /^\d{11}$|^\d{14}$/;

  // CA02/CA07/CA08 — estado atual da aba de pagamentos do tenant logado.
  // US62 — cobrança/assinatura é visão de administrador; operador não acessa.
  fastify.get('/api/pagamentos', { preHandler: [fastify.authenticate, fastify.requireAdmin] }, async (request) => {
    const { tenantId } = request.user;
    const { rows } = await pool.query(
      `SELECT plano, status, ativado_em, status_alterado_em, asaas_customer_id, asaas_subscription_id,
              asaas_meio_pagamento, asaas_meio_pagamento_alterado_em, asaas_cartao_final, cpf_cnpj, cancelado_em, acesso_ate,
              endereco_cep, endereco_logradouro, endereco_numero,
              endereco_complemento, endereco_bairro, endereco_cidade, endereco_uf
       FROM tenants WHERE id = $1`,
      [tenantId]
    );
    return montarResumoPagamentos(rows[0]);
  });

  // CA01-CA07 (US36) — detalhes do trial pra aba de pagamentos do portal do
  // tenant (extensão do indicador somente leitura da US31, que hoje só existe
  // pro admin via calcularTrialTenant/TRIAL_DIAS). `trial_dias_utilizados`/
  // `trial_percentual` são derivados de `trial_dias_restantes` com o mesmo
  // critério (Math.ceil) usado no cálculo dos dias restantes, e sempre
  // clampados entre 0 e TRIAL_DIAS mesmo com o trial já expirado.
  fastify.get('/api/pagamentos/status', { preHandler: [fastify.authenticate, fastify.requireAdmin] }, async (request, reply) => {
    const { tenantId } = request.user;
    const { rows } = await pool.query('SELECT status, plano, ativado_em FROM tenants WHERE id = $1', [tenantId]);
    const tenant = rows[0];
    if (!tenant) {
      return reply.code(404).send({ error: 'Tenant não encontrado' });
    }

    const trial = calcularTrialTenant(tenant);
    const diasUtilizados = trial.trialDiasRestantes == null
      ? null
      : Math.min(configSistema.config.trialDias, Math.max(0, configSistema.config.trialDias - trial.trialDiasRestantes));
    const trialPercentual = diasUtilizados == null ? null : Math.min(100, Math.round((diasUtilizados / configSistema.config.trialDias) * 100));

    return {
      trial_ativo: trial.trialAtivo,
      trial_inicio: trial.trialInicio ? trial.trialInicio.slice(0, 10) : null,
      trial_fim: trial.trialFim ? trial.trialFim.slice(0, 10) : null,
      trial_dias_restantes: trial.trialDiasRestantes,
      trial_dias_utilizados: diasUtilizados,
      trial_percentual: trialPercentual,
      status_pagamento: tenant.status,
      plano: tenant.plano,
    };
  });

  // CA04/CA05/CA09 — orquestra Customer + Subscription no Asaas. Cria na
  // primeira vez; se o tenant já tem assinatura, apenas troca o meio de
  // pagamento (CA09 — atualiza, não cancela).
  //
  // Cartão de crédito: a Asaas não tem tokenização client-side (diferente da
  // Efí, avaliada antes de escolher a Asaas) — só um endpoint de servidor
  // (`POST /creditCard/tokenize`). Por isso o número/validade/CVV chegam aqui
  // brutos (via HTTPS) e são tokenizados neste handler, nunca armazenados
  // nem logados — só repassados à Asaas e descartados.
  fastify.post('/api/pagamentos/cadastrar', { preHandler: [fastify.authenticate, fastify.requireAdmin] }, async (request, reply) => {
    const { tenantId } = request.user;
    const {
      meio,
      cpf_cnpj: cpfCnpjBruto,
      cartao_numero: cartaoNumeroBruto,
      cartao_nome: cartaoNome,
      cartao_validade_mes: cartaoValidadeMes,
      cartao_validade_ano: cartaoValidadeAno,
      cartao_cvv: cartaoCvv,
      endereco: enderecoBruto,
    } = request.body || {};

    if (!['pix', 'cartao'].includes(meio)) {
      return reply.code(400).send({ error: 'Campo "meio" deve ser "pix" ou "cartao"' });
    }

    const cartaoNumeroLimpo = String(cartaoNumeroBruto || '').replace(/\D/g, '');
    if (meio === 'cartao') {
      if (!CARTAO_FINAL_REGEX.test(cartaoNumeroLimpo.slice(-4))) {
        return reply.code(400).send({ error: 'Informe um número de cartão válido.' });
      }
      if (!(cartaoNome || '').trim()) {
        return reply.code(400).send({ error: 'Informe o nome impresso no cartão.' });
      }
      if (!/^\d{1,2}$/.test(cartaoValidadeMes || '') || !/^\d{4}$/.test(cartaoValidadeAno || '')) {
        return reply.code(400).send({ error: 'Informe a validade do cartão (MM/AAAA).' });
      }
      if (!/^\d{3,4}$/.test(cartaoCvv || '')) {
        return reply.code(400).send({ error: 'Informe o CVV do cartão.' });
      }
    }

    const { rows } = await pool.query(
      `SELECT nome, whatsapp, telefone, plano, status, ativado_em, asaas_customer_id, asaas_subscription_id, cpf_cnpj,
              endereco_cep, endereco_logradouro, endereco_numero,
              endereco_complemento, endereco_bairro, endereco_cidade, endereco_uf
       FROM tenants WHERE id = $1`,
      [tenantId]
    );
    const tenant = rows[0];
    if (!tenant) {
      return reply.code(404).send({ error: 'Tenant não encontrado' });
    }

    // CPF/CNPJ só é pedido na primeira vez (CA04) — se o tenant já tiver um
    // Customer criado na Asaas, ele já foi enviado então e não muda a troca
    // de meio de pagamento (CA09).
    const cpfCnpjLimpo = String(cpfCnpjBruto || '').replace(/\D/g, '') || tenant.cpf_cnpj;
    if (!tenant.asaas_customer_id && !CPF_CNPJ_REGEX.test(cpfCnpjLimpo || '')) {
      return reply.code(400).send({ error: 'Informe um CPF (11 dígitos) ou CNPJ (14 dígitos) válido.' });
    }

    // A Asaas exige endereço no Customer/tokenização de cartão. O modal de
    // pagamento coleta o endereço no ato se o tenant não tiver um (ou se
    // marcou a opção de atualizar) — vem em `endereco` no corpo; senão,
    // reaproveita o que já está salvo no tenant (US33).
    let endereco = {
      cep: tenant.endereco_cep,
      logradouro: tenant.endereco_logradouro,
      numero: tenant.endereco_numero,
      complemento: tenant.endereco_complemento,
      bairro: tenant.endereco_bairro,
      cidade: tenant.endereco_cidade,
      uf: tenant.endereco_uf,
    };
    if (meio === 'cartao') {
      if (enderecoBruto) {
        const { cep, logradouro, numero, complemento, bairro, cidade, uf } = enderecoBruto;
        const cepLimpo = String(cep || '').replace(/\D/g, '');
        const enderecoValido =
          /^\d{8}$/.test(cepLimpo) &&
          (logradouro || '').trim() &&
          (numero || '').trim() &&
          (bairro || '').trim() &&
          (cidade || '').trim() &&
          UF_VALIDAS.includes(String(uf || '').toUpperCase());
        if (!enderecoValido) {
          return reply.code(400).send({ error: 'Preencha todos os campos do endereço.' });
        }
        endereco = {
          cep: cepLimpo,
          logradouro: logradouro.trim(),
          numero: numero.trim(),
          complemento: (complemento || '').trim() || null,
          bairro: bairro.trim(),
          cidade: cidade.trim(),
          uf: String(uf).toUpperCase(),
        };
      } else if (!(endereco.cep && endereco.numero)) {
        return reply.code(400).send({ error: 'Informe seu endereço para cadastrar um cartão.' });
      }
    }

    // Trial (ou tenant sem plano definido) ainda não escolheu um plano pago —
    // hoje só existe o Profissional (mesmo conjunto de módulos liberado no
    // trial, ver MODULOS_TRIAL); vira o plano contratado.
    const plano = tenant.plano && tenant.plano !== 'trial' ? tenant.plano : planos.PLANO_PADRAO_CHAVE;
    // CA09 (US38) — preço/nome sempre lidos do cache carregado da tabela
    // `planos`, nunca hardcoded; um plano desativado (`ativo = false`) ainda
    // pode ser usado aqui (só novas assinaturas deixam de oferecê-lo na
    // seleção de plano quando essa tela existir — não é o caso hoje, já que
    // só o Profissional é contratável).
    const planoInfo = planos.obterPlano(plano);
    if (!planoInfo) {
      return reply.code(400).send({ error: 'Plano não configurado. Contate o suporte.' });
    }
    const billingType = meio === 'pix' ? 'PIX' : 'CREDIT_CARD';
    const cartaoFinal = meio === 'cartao' ? cartaoNumeroLimpo.slice(-4) : null;

    // Número de contato do titular (exigido na tokenização de cartão) — nem
    // todo tenant tem WhatsApp cadastrado (ex: criado pela área admin, US16),
    // mas `telefone` é obrigatório desde a US33; usa o que tiver.
    const contato = tenant.whatsapp || tenant.telefone;

    // US52 — marca a tentativa de cadastro assim que as validações passam,
    // antes de chamar a Asaas (a conclusão só é registrada depois do UPDATE
    // no tenant ter sucesso, mais abaixo).
    await registrarEvento(tenantId, 'pagamento_iniciado');

    let customer;
    let subscriptionId;
    try {
      customer = await asaasService.criarOuRecuperarCustomer({
        tenantId,
        nome: tenant.nome,
        email: request.user.email,
        whatsapp: contato,
        cpfCnpj: cpfCnpjLimpo,
        asaasCustomerId: tenant.asaas_customer_id,
      });

      let creditCardToken;
      if (meio === 'cartao') {
        const tokenizado = await asaasService.tokenizarCartao({
          customerId: customer.id,
          holderName: cartaoNome.trim(),
          number: cartaoNumeroLimpo,
          expiryMonth: cartaoValidadeMes,
          expiryYear: cartaoValidadeAno,
          ccv: cartaoCvv,
          holderInfo: {
            name: tenant.nome,
            email: request.user.email,
            cpfCnpj: cpfCnpjLimpo,
            postalCode: endereco.cep,
            addressNumber: endereco.numero,
            addressComplement: endereco.complemento || undefined,
            // A Asaas valida `phone` como fixo (10 dígitos) e `mobilePhone`
            // como celular (11) separadamente — mandar um número de 11
            // dígitos em `phone` é rejeitado como inválido. `telefone`/
            // `whatsapp` no Kyvvo são sempre celular (DDD + 9 dígitos) hoje.
            mobilePhone: contato || undefined,
          },
          remoteIp: request.ip,
        });
        creditCardToken = tokenizado.creditCardToken;
      }

      // CA06 (US35) — uma assinatura cancelada já foi encerrada na Asaas, então
      // reativar sempre cria uma nova (nunca reaproveita/atualiza o id antigo,
      // que a Asaas rejeitaria por já estar cancelado).
      if (tenant.asaas_subscription_id && tenant.status !== 'cancelado') {
        await asaasService.atualizarSubscription({
          subscriptionId: tenant.asaas_subscription_id,
          billingType,
          creditCardToken,
          tenantId,
        });
        subscriptionId = tenant.asaas_subscription_id;
      } else {
        const subscription = await asaasService.criarSubscription({
          customerId: customer.id,
          billingType,
          valor: Number(planoInfo.preco_mensal),
          planoNome: planoInfo.nome,
          nextDueDate: proximaCobrancaRespeitandoTrial(tenant),
          creditCardToken,
          tenantId,
        });
        subscriptionId = subscription.id;
      }
    } catch (erro) {
      console.error(`[pagamentos] falha na integração com a Asaas para tenant ${tenantId}: ${erro.message}`);
      // 400, não 502/504 — a Cloudflare intercepta e substitui o corpo da
      // resposta pela própria página de erro genérica ("Bad Gateway... Visit
      // cloudflare.com") sempre que o código de status é um dos que ela
      // também usa pra falha de conectividade do próprio proxy (502, 504,
      // 520-527), mesmo quando é a origem (nós) que respondeu de propósito
      // com esse status — não há como desativar isso sem plano Enterprise.
      return reply.code(400).send({ error: 'Não foi possível processar o pagamento agora. Tente novamente em instantes.' });
    }

    // CA04/CA05/CA07 (US37) — durante o trial, cadastrar pagamento agenda a
    // cobrança pro fim do trial (nextDueDate acima) mas não cobra agora, então
    // o tenant continua em 'trial' (com meio de pagamento já anexado) até a
    // Asaas confirmar a primeira cobrança de verdade (webhook PAYMENT_CONFIRMED
    // já vira 'ativo'); só pula direto pra 'ativo' se o trial já tiver
    // acabado (cobrança imediata) ou se já não estava em trial (CA09/US35).
    const trialAindaAtivo = tenant.status === 'trial' && calcularTrialTenant(tenant).trialAtivo;
    const novoStatus = trialAindaAtivo ? 'trial' : 'ativo';

    const { rows: atualizado } = await pool.query(
      `UPDATE tenants SET
         asaas_customer_id = $2,
         asaas_subscription_id = $3,
         plano = $4,
         status = $15,
         asaas_meio_pagamento = $5,
         asaas_meio_pagamento_alterado_em = now(),
         asaas_cartao_final = $6,
         cpf_cnpj = $7,
         endereco_cep = $8,
         endereco_logradouro = $9,
         endereco_numero = $10,
         endereco_complemento = $11,
         endereco_bairro = $12,
         endereco_cidade = $13,
         endereco_uf = $14,
         cancelado_em = null,
         acesso_ate = null
       WHERE id = $1
       RETURNING plano, status, ativado_em, status_alterado_em, asaas_customer_id, asaas_subscription_id,
                 asaas_meio_pagamento, asaas_meio_pagamento_alterado_em, asaas_cartao_final, cpf_cnpj, cancelado_em, acesso_ate,
                 endereco_cep, endereco_logradouro, endereco_numero,
                 endereco_complemento, endereco_bairro, endereco_cidade, endereco_uf`,
      [
        tenantId, customer.id, subscriptionId, plano, meio, meio === 'cartao' ? cartaoFinal : null, cpfCnpjLimpo,
        endereco.cep, endereco.logradouro, endereco.numero, endereco.complemento, endereco.bairro, endereco.cidade, endereco.uf,
        novoStatus,
      ]
    );

    await registrarEvento(tenantId, 'pagamento_concluido');

    return montarResumoPagamentos(atualizado[0]);
  });

  // Troca de plano — disponível a qualquer momento pra quem já tem uma
  // assinatura (trial com pagamento agendado, ativo, inadimplente ou
  // suspenso; cancelado não tem assinatura pra alterar, precisa reativar
  // primeiro). Sem proration: o valor novo só vale a partir da próxima
  // cobrança (a Asaas não calcula proporcional — ver atualizarSubscription).
  // Só planos com `ativo=true` na tabela `planos` podem ser escolhidos.
  fastify.patch('/api/pagamentos/plano', { preHandler: [fastify.authenticate, fastify.requireAdmin] }, async (request, reply) => {
    const { tenantId } = request.user;
    const { plano } = request.body || {};

    // O modal de troca é montado a partir de GET /api/planos (catálogo
    // público), que só expõe `slug` — não `chave` (ver comentário em
    // montarResumoPagamentos). Aceita os dois aqui, mesmo padrão de
    // GET /api/planos/:slug, e resolve pra `chave` (identificador real,
    // usado em tenants.plano e no PLANOS_CACHE) antes de seguir.
    const { rows: planoRows } = await pool.query(
      'SELECT chave, nome, preco_mensal, ativo FROM planos WHERE (slug = $1 OR chave = $1) AND ativo = true',
      [plano]
    );
    const planoInfo = planoRows[0];
    if (!planoInfo) {
      return reply.code(400).send({ error: 'Plano inválido ou não disponível.' });
    }

    const { rows } = await pool.query(
      'SELECT plano, status, asaas_subscription_id FROM tenants WHERE id = $1',
      [tenantId]
    );
    const tenant = rows[0];
    if (!tenant || !tenant.asaas_subscription_id || tenant.status === 'cancelado') {
      return reply.code(400).send({ error: 'Nenhuma assinatura ativa pra trocar de plano. Cadastre uma forma de pagamento primeiro.' });
    }
    if (tenant.plano === planoInfo.chave) {
      return reply.code(400).send({ error: 'Você já está nesse plano.' });
    }

    try {
      await asaasService.atualizarSubscription({
        subscriptionId: tenant.asaas_subscription_id,
        valor: Number(planoInfo.preco_mensal),
        tenantId,
      });
    } catch (erro) {
      console.error(`[pagamentos] falha ao trocar plano do tenant ${tenantId} para ${planoInfo.chave}: ${erro.message}`);
      return reply.code(400).send({ error: 'Não foi possível trocar de plano agora. Tente novamente em instantes.' });
    }

    const { rows: atualizado } = await pool.query(
      `UPDATE tenants SET plano = $2 WHERE id = $1
       RETURNING plano, status, ativado_em, status_alterado_em, asaas_customer_id, asaas_subscription_id,
                 asaas_meio_pagamento, asaas_meio_pagamento_alterado_em, asaas_cartao_final, cpf_cnpj, cancelado_em, acesso_ate,
                 endereco_cep, endereco_logradouro, endereco_numero,
                 endereco_complemento, endereco_bairro, endereco_cidade, endereco_uf`,
      [tenantId, planoInfo.chave]
    );

    return montarResumoPagamentos(atualizado[0]);
  });

  // CA01/CA03/CA07 (US35) — cancela a assinatura do tenant logado. Encerra a
  // cobrança recorrente na Asaas mas mantém o acesso até o fim do período já
  // pago (`acesso_ate`, CA05). Só o próprio tenant autenticado pode cancelar
  // a própria assinatura — nunca aceita um id de tenant vindo do corpo.
  fastify.delete('/api/pagamentos/assinatura', { preHandler: [fastify.authenticate, fastify.requireAdmin] }, async (request, reply) => {
    const { tenantId } = request.user;
    const { rows } = await pool.query(
      `SELECT status, asaas_subscription_id FROM tenants WHERE id = $1`,
      [tenantId]
    );
    const tenant = rows[0];
    if (!tenant) {
      return reply.code(404).send({ error: 'Tenant não encontrado' });
    }
    if (tenant.status !== 'ativo') {
      return reply.code(400).send({ error: 'Só é possível cancelar uma assinatura ativa.' });
    }
    if (!tenant.asaas_subscription_id) {
      return reply.code(400).send({ error: 'Nenhuma assinatura encontrada para cancelar.' });
    }

    let acessoAte;
    try {
      // Consulta o nextDueDate antes de cancelar — depois de cancelada, a
      // Asaas pode não devolver mais essa data (e em modo dev nunca devolve),
      // então guardamos o valor agora pra sempre poder exibir até quando o
      // acesso pago continua (CA04).
      const subscription = await asaasService.buscarSubscription(tenant.asaas_subscription_id);
      acessoAte = subscription ? subscription.nextDueDate : null;
      await asaasService.cancelarSubscription({ subscriptionId: tenant.asaas_subscription_id, tenantId });
    } catch (erro) {
      console.error(`[pagamentos] falha ao cancelar assinatura na Asaas para tenant ${tenantId}: ${erro.message}`);
      // 400, não 502/504 — mesmo motivo do /cadastrar: a Cloudflare intercepta
      // esses códigos e substitui o corpo da resposta pela própria página de
      // erro genérica, mesmo quando é a origem que respondeu de propósito.
      return reply.code(400).send({ error: 'Não foi possível cancelar a assinatura agora. Tente novamente em instantes.' });
    }

    await pool.query(
      `UPDATE tenants SET status = 'cancelado', cancelado_em = NOW(), acesso_ate = $2 WHERE id = $1`,
      [tenantId, acessoAte]
    );

    return { cancelado: true, acesso_ate: acessoAte };
  });

  // CA10 — webhook da Asaas: atualiza o status do tenant conforme o evento da
  // cobrança/assinatura. Sem fastify.authenticate — quem chama é a Asaas, não
  // um usuário logado; a validação é pelo token no header (CA12).
  const ASAAS_EVENTO_PARA_STATUS = {
    PAYMENT_CONFIRMED: 'ativo',
    PAYMENT_RECEIVED: 'ativo',
    PAYMENT_OVERDUE: 'inadimplente',
    PAYMENT_DELETED: 'suspenso',
    // CA05 (US35) — confirma um cancelamento que já foi feito por aqui (rota
    // acima) ou cancelado direto no painel da Asaas; 'cancelado' (não mais
    // 'suspenso') pra não sobrescrever o estado que a US35 já deixa
    // consistente do lado de cá.
    SUBSCRIPTION_CANCELLED: 'cancelado',
  };

  fastify.post('/webhooks/asaas', async (request, reply) => {
    const tokenEsperado = process.env.ASAAS_WEBHOOK_TOKEN;
    const tokenRecebido = request.headers['asaas-access-token'];
    if (!tokenEsperado || tokenRecebido !== tokenEsperado) {
      return reply.code(401).send({ error: 'Token de webhook inválido' });
    }

    const { event, payment, subscription } = request.body || {};
    const novoStatus = ASAAS_EVENTO_PARA_STATUS[event];
    // Evento sem mapeamento (ex: PAYMENT_CREATED) ou sem uma cobrança/
    // assinatura pra identificar o tenant: apenas confirma o recebimento —
    // é assim que a Asaas espera 200 pra não reenviar o mesmo evento.
    if (!novoStatus) {
      return { ok: true };
    }
    const subscriptionId = (payment && payment.subscription) || (subscription && subscription.id);
    if (!subscriptionId) {
      return { ok: true };
    }

    // status_alterado_em alimenta a carência de CARENCIA_DIAS_INADIMPLENCIA
    // antes de bloquear quem está 'inadimplente' (ver calcularBloqueioAssinatura)
    // — só atualiza se o status realmente mudou, senão um evento repetido da
    // Asaas pro mesmo status reiniciaria a carência do zero.
    await pool.query(
      `UPDATE tenants SET status = $2, status_alterado_em = now()
       WHERE asaas_subscription_id = $1 AND status IS DISTINCT FROM $2`,
      [subscriptionId, novoStatus]
    );
    return { ok: true };
  });
}

module.exports = { registerPagamentosRoutes };
