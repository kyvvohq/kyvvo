// trustProxy: nginx (na frente do processo) já repassa X-Forwarded-For real —
// necessário pra `request.ip` refletir o IP do cliente, não o do proxy
// interno. Usado pelo `remoteIp` exigido na tokenização de cartão (US32).
const fastify = require('fastify')({ logger: true, trustProxy: true });
const jwt = require('@fastify/jwt');
const cors = require('@fastify/cors');
const staticPlugin = require('@fastify/static');
const path = require('path');
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');
const tokenService = require('./token-service');
const asaasService = require('./asaas-service');
const metaWhatsappService = require('./meta-whatsapp-service');

// ---------- Cadastro self-service (US20) ----------
// `let` (não `const`) porque a US38 permite um admin da Kyvvo sobrescrever
// esses valores em runtime via /admin/api/configuracoes/sistema, sem deploy —
// os literais abaixo são só o valor padrão até `carregarConfiguracoesSistema`
// rodar (e o fallback se a tabela `configuracoes_sistema` estiver vazia).
let TRIAL_DIAS = 14;
let MAX_REENVIOS_HORA = 5;
// Cooldown entre pedidos de reenvio — não faz parte da lista de
// configurações editáveis da CA06, então continua fixo no código.
const REENVIO_COOLDOWN_SEGUNDOS = 60;
// CA06 (US38) — configurações gerais editáveis pelo admin que ainda não têm
// nenhum consumidor no código (não existe hoje uma tela de "fale com o
// suporte" no portal do tenant); ficam disponíveis via
// /admin/api/configuracoes pra quando essa tela existir.
let CARENCIA_DIAS_INADIMPLENCIA = 3;
let EMAIL_SUPORTE = 'suporte@kyvvo.com.br';
let WHATSAPP_SUPORTE = '553484285182';
// Módulos liberados durante o trial ("plano Profissional" — CA09). Todo
// tenant novo precisa ao menos da agenda; os demais dão a experiência
// completa enquanto o trial está ativo.
const MODULOS_TRIAL = ['agenda_inteligente', 'financeiro', 'dashboards'];

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Senha: mínimo 8 caracteres, ao menos 1 número e 1 letra maiúscula (CA02).
const SENHA_REGEX = /^(?=.*[A-Z])(?=.*\d).{8,}$/;
// Nichos atendidos pelo Kyvvo (US34) — lista curta e fixa, mesmo enum do
// CHECK da coluna tenants.segmento (migration 018). Reaproveitada no cadastro
// self-service e no CRUD de tenants do admin; migrar pra tabela dinâmica
// (segmentos) fica pra uma US futura, não é necessário pro MVP.
const SEGMENTOS_VALIDOS = ['salao_beleza', 'petshop', 'psicologia', 'fisioterapia', 'pilates', 'outro'];

// Normaliza um WhatsApp brasileiro para os dígitos nacionais (DDD + número,
// sem o DDI 55), que é o formato guardado como unique key. Retorna null se
// não for um número brasileiro plausível.
function normalizarWhatsapp(bruto) {
  if (!bruto) return null;
  let digitos = String(bruto).replace(/\D/g, '');
  if (digitos.startsWith('55') && digitos.length >= 12) {
    digitos = digitos.slice(2);
  }
  if (digitos.length < 10 || digitos.length > 11) return null;
  const ddd = parseInt(digitos.slice(0, 2), 10);
  if (ddd < 11 || ddd > 99) return null;
  return digitos;
}

const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) throw new Error('JWT_SECRET não configurado');
// Secret separado do JWT de tenant (US16) — isolamento real entre os dois
// sistemas de autenticação, não só uma diferença de rota.
const ADMIN_JWT_SECRET = process.env.ADMIN_JWT_SECRET;
if (!ADMIN_JWT_SECRET) throw new Error('ADMIN_JWT_SECRET não configurado');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
tokenService.init(pool);

// CA06/CA09 (US38) — carrega `configuracoes_sistema` do banco pra dentro das
// variáveis em memória usadas pelo resto do código (TRIAL_DIAS etc.), tanto no
// boot quanto logo após um PATCH do admin — assim a mudança vale pro processo
// já rodando, sem precisar de deploy/restart. Chaves ausentes na tabela (banco
// vazio/erro de leitura) mantêm o valor atual em memória.
async function carregarConfiguracoesSistema() {
  const { rows } = await pool.query('SELECT chave, valor FROM configuracoes_sistema');
  const valores = Object.fromEntries(rows.map((r) => [r.chave, r.valor]));

  if (valores.trial_dias != null) TRIAL_DIAS = parseInt(valores.trial_dias, 10);
  if (valores.max_tentativas_reenvio_token != null) MAX_REENVIOS_HORA = parseInt(valores.max_tentativas_reenvio_token, 10);
  if (valores.carencia_dias_inadimplencia != null) CARENCIA_DIAS_INADIMPLENCIA = parseInt(valores.carencia_dias_inadimplencia, 10);
  if (valores.email_suporte != null) EMAIL_SUPORTE = valores.email_suporte;
  if (valores.whatsapp_suporte != null) WHATSAPP_SUPORTE = valores.whatsapp_suporte;
}

// CA09 (US38) — catálogo de planos (chave -> {nome, preco_mensal, ...}) lido
// da tabela `planos`, nunca mais hardcoded. Recarregado no boot e logo após
// qualquer PATCH de um plano, pra refletir mudança de preço/nome/descrição
// imediatamente nas próximas assinaturas (sem afetar as já existentes, que já
// têm o valor gravado na Subscription da Asaas).
let PLANOS_CACHE = {};
// Plano que um tenant sem plano escolhido (trial ou nulo) contrata ao
// cadastrar pagamento — qual plano é o "padrão" é uma decisão de produto,
// não uma configuração de preço, por isso continua fixo no código.
const PLANO_PADRAO_CHAVE = 'profissional';

async function carregarPlanos() {
  const { rows } = await pool.query(
    'SELECT chave, nome, descricao, preco_mensal, limite_disparos, ativo FROM planos'
  );
  PLANOS_CACHE = Object.fromEntries(rows.map((r) => [r.chave, r]));
}

// Nome de exibição do plano — usado tanto no perfil do tenant quanto no
// detalhe do tenant na área admin, pra nunca divergir (US28/US33).
function nomeDoPlano(chave) {
  if (chave === 'trial') return 'Trial';
  return (PLANOS_CACHE[chave] && PLANOS_CACHE[chave].nome) || 'Não definido';
}

// Converte um "time" do Postgres ("08:00:00" ou "08:00") em minutos desde a
// meia-noite, pra comparar com o horário (também em minutos) de um
// agendamento — usado tanto na geração de slots quanto na validação de
// horário de funcionamento em POST/PATCH de agendamentos.
function horarioParaMinutos(horario) {
  const [h, m] = horario.split(':').map(Number);
  return h * 60 + m;
}

// O servidor roda em UTC (container Docker), mas todo horário de
// funcionamento/agenda é pensado em horário de Brasília. Brasil não observa
// horário de verão desde 2019, então o offset fixo -3h é seguro (sem precisar
// de lib de timezone). BUG HISTÓRICO: código anterior usava new Date(...) e
// os métodos locais (getHours/setMinutes) assumindo que "horário local do
// processo" era Brasília — como o processo roda em UTC, isso deslocava todo
// slot gerado em 3h pra trás (um slot rotulado "09:00" era na verdade 06:00
// em Brasília) e podia até cruzar a virada do dia. Toda conversão de/para
// horário de Brasília deve passar pelas duas funções abaixo, nunca por
// getHours/setMinutes/toISOString direto num Date.
const OFFSET_BRASILIA_MINUTOS = 180;

// Minutos desde a meia-noite (em horário de Brasília) de um timestamp de
// agendamento — usado na validação de horário de funcionamento em
// POST/PATCH de agendamentos.
function minutosNoDia(dataISO) {
  const d = new Date(dataISO);
  const minutosUtc = d.getUTCHours() * 60 + d.getUTCMinutes();
  return ((minutosUtc - OFFSET_BRASILIA_MINUTOS) % 1440 + 1440) % 1440;
}

// Dia da semana (0=domingo..6=sábado) de um timestamp de agendamento, já
// ajustado pro dia civil de Brasília (mesmo raciocínio de offset fixo de
// minutosNoDia — ver comentário acima sobre o bug histórico de fuso).
function diaDaSemanaBrasilia(dataISO) {
  return new Date(new Date(dataISO).getTime() - OFFSET_BRASILIA_MINUTOS * 60000).getUTCDay();
}

// Valida um agendamento (dia da semana + intervalo abertura/fechamento +
// intervalo de almoço, se ativo) contra a configuração de horário do tenant.
// `duracaoMinutos` (padrão 0) deixa o fim do agendamento também respeitar o
// fechamento/almoço, não só o início — usado tanto pra validar POST/PATCH de
// agendamentos quanto pra filtrar slots de disponibilidade.
function dentroDoHorarioFuncionamento(tenant, dataHoraISO, duracaoMinutos = 0) {
  const diasFuncionamento = tenant.dias_funcionamento || [1, 2, 3, 4, 5, 6];
  if (!diasFuncionamento.includes(diaDaSemanaBrasilia(dataHoraISO))) {
    return { valido: false, motivo: 'O estabelecimento não abre nesse dia.' };
  }

  const inicioMinutos = minutosNoDia(dataHoraISO);
  const fimMinutos = inicioMinutos + duracaoMinutos;
  const aberturaMinutos = horarioParaMinutos(tenant.horario_abertura);
  const fechamentoMinutos = horarioParaMinutos(tenant.horario_fechamento);
  if (inicioMinutos < aberturaMinutos || fimMinutos > fechamentoMinutos) {
    return {
      valido: false,
      motivo: `Horário fora do funcionamento do salão (${tenant.horario_abertura.slice(0, 5)}–${tenant.horario_fechamento.slice(0, 5)}).`,
    };
  }

  if (tenant.horario_almoco_ativo) {
    const almocoInicioMinutos = horarioParaMinutos(tenant.horario_almoco_inicio);
    const almocoFimMinutos = horarioParaMinutos(tenant.horario_almoco_fim);
    if (inicioMinutos < almocoFimMinutos && almocoInicioMinutos < fimMinutos) {
      return { valido: false, motivo: 'Esse horário cai no intervalo de almoço.' };
    }
  }

  return { valido: true };
}

// Data (YYYY-MM-DD) de "agora" em horário de Brasília — usada como fallback
// quando a view de agenda é consultada sem o parâmetro "data" explícito.
function dataAtualBrasilia() {
  return new Date(Date.now() - OFFSET_BRASILIA_MINUTOS * 60000).toISOString().slice(0, 10);
}

// Mês (YYYY-MM) de "agora" em horário de Brasília — mesmo raciocínio acima.
function mesAtualBrasilia() {
  return new Date(Date.now() - OFFSET_BRASILIA_MINUTOS * 60000).toISOString().slice(0, 7);
}

// US32/CA05 — data da primeira cobrança da assinatura Asaas: se o trial (14
// dias a partir de `ativado_em`) ainda não acabou, a cobrança só nasce pra
// vencer no fim do trial; senão, vence hoje (tenant já devia estar pagando).
function proximaCobrancaRespeitandoTrial(tenant) {
  if (tenant.ativado_em) {
    const trialFim = new Date(new Date(tenant.ativado_em).getTime() + TRIAL_DIAS * 24 * 60 * 60 * 1000);
    if (trialFim.getTime() > Date.now()) return trialFim.toISOString().slice(0, 10);
  }
  return new Date().toISOString().slice(0, 10);
}

async function start() {
  await fastify.register(cors, { origin: true });
  await fastify.register(jwt, { secret: JWT_SECRET });
  // JWT completamente separado pra área admin da Kyvvo (US16) — secret
  // próprio, namespace próprio (fastify.jwt.admin.*, request.adminJwtVerify,
  // reply.adminJwtSign) e decoratorName próprio (request.admin em vez de
  // request.user), pra nunca ter qualquer ambiguidade com o JWT de tenant.
  await fastify.register(jwt, {
    secret: ADMIN_JWT_SECRET,
    namespace: 'admin',
    decoratorName: 'admin',
  });
  await fastify.register(staticPlugin, {
    root: path.join(__dirname, 'public'),
    prefix: '/',
  });

  // Página de detalhe do tenant (US28/CA01) — rota dinâmica que o
  // @fastify/static não resolve sozinho, já que não existe um arquivo físico
  // `/admin/tenants/<id>.html`. Autenticação é feita do mesmo jeito das
  // outras páginas admin: client-side (token no localStorage) + servidor via
  // a API JSON que a página consome.
  fastify.get('/admin/tenants/:id', async (request, reply) => {
    return reply.type('text/html').sendFile('admin/tenant-detalhe.html');
  });

  // Rotas que uma conta ainda não verificada (US20/CA10) precisa continuar
  // acessando pra completar a verificação, pedir reenvio ou sair — checado
  // direto em `authenticate` (em vez de um preHandler à parte que cada rota
  // nova precisaria lembrar de encadear) pra que o bloqueio nunca dependa de
  // alguém adicionar a checagem rota por rota.
  const ROTAS_LIVRES_SEM_VERIFICACAO = new Set([
    'POST /api/auth/logout',
    'POST /api/auth/verify-token',
    'POST /api/auth/resend-token',
    'GET /api/tenant/status',
  ]);

  fastify.decorate('authenticate', async (request, reply) => {
    try {
      await request.jwtVerify();
    } catch (err) {
      return reply.code(401).send({ error: 'Não autenticado' });
    }

    const { rows } = await pool.query(
      'SELECT token_version, email_verified FROM usuarios WHERE id = $1',
      [request.user.userId]
    );
    const usuario = rows[0];
    if (!usuario || usuario.token_version !== request.user.tokenVersion) {
      return reply.code(401).send({ error: 'Sessão expirada. Faça login novamente.' });
    }

    const rotaAtual = `${request.method} ${request.routeOptions.url}`;
    if (!usuario.email_verified && !ROTAS_LIVRES_SEM_VERIFICACAO.has(rotaAtual)) {
      return reply.code(403).send({ error: 'Confirme seu cadastro para continuar. Verifique seu e-mail ou WhatsApp.' });
    }
  });

  // Autenticação da área admin da Kyvvo (US16) — totalmente isolada da
  // autenticação de tenant acima (secret diferente, tabela diferente,
  // decorator diferente). Nunca compartilhar preHandler entre as duas.
  fastify.decorate('authenticateAdmin', async (request, reply) => {
    try {
      await request.adminJwtVerify();
    } catch (err) {
      return reply.code(401).send({ error: 'Não autenticado' });
    }
  });

  // requireModulo('financeiro') devolve um preHandler que barra a rota com 403
  // se o tenant autenticado não tiver aquele módulo ativo em tenant_modulos
  // (US10 / CA03). Deve ser encadeado SEMPRE depois de `authenticate` no array
  // de preHandler, pois depende de request.user.tenantId já resolvido.
  // Uso: preHandler: [fastify.authenticate, fastify.requireModulo('financeiro')]
  fastify.decorate('requireModulo', (moduloKey) => async (request, reply) => {
    const { tenantId } = request.user || {};
    if (!tenantId) {
      return reply.code(401).send({ error: 'Não autenticado' });
    }

    const { rows } = await pool.query(
      'SELECT 1 FROM tenant_modulos WHERE tenant_id = $1 AND modulo_key = $2 AND ativo LIMIT 1',
      [tenantId, moduloKey]
    );
    if (rows.length === 0) {
      return reply.code(403).send({
        error: `Módulo "${moduloKey}" não está ativo para este salão.`,
      });
    }
  });

  // ---------- Auth ----------
  fastify.post('/api/auth/login', async (request, reply) => {
    const { email, senha } = request.body || {};
    if (!email || !senha) {
      return reply.code(400).send({ error: 'E-mail e senha são obrigatórios' });
    }

    const { rows } = await pool.query(
      `SELECT u.id, u.tenant_id, u.email, u.senha_hash, u.nome, u.token_version, u.email_verified, t.ativo AS tenant_ativo
       FROM usuarios u JOIN tenants t ON t.id = u.tenant_id
       WHERE u.email = $1`,
      [email.toLowerCase().trim()]
    );
    const usuario = rows[0];
    if (!usuario) {
      return reply.code(401).send({ error: 'E-mail ou senha inválidos' });
    }

    const senhaValida = await bcrypt.compare(senha, usuario.senha_hash);
    if (!senhaValida) {
      return reply.code(401).send({ error: 'E-mail ou senha inválidos' });
    }

    // Tenant desativado pela área admin da Kyvvo (US16/CA02) — bloqueia
    // login mesmo com senha correta, em vez de deixar o "desativar" ser só
    // um flag decorativo sem efeito nenhum.
    if (!usuario.tenant_ativo) {
      return reply.code(403).send({ error: 'Acesso desativado. Fale com o suporte da Kyvvo.' });
    }

    const token = fastify.jwt.sign(
      { userId: usuario.id, tenantId: usuario.tenant_id, email: usuario.email, tokenVersion: usuario.token_version },
      { expiresIn: '7d' }
    );

    // email_verified informa ao front se deve redirecionar pra tela de
    // validação (CA10) em vez de entrar direto no portal.
    return { token, nome: usuario.nome, email: usuario.email, email_verified: usuario.email_verified };
  });

  // Invalida o token atual (e qualquer outro emitido antes dele) incrementando
  // token_version: como o JWT é stateless, é essa comparação em `authenticate`
  // que faz o logout ter efeito imediato no servidor, e não só no cliente.
  fastify.post('/api/auth/logout', { preHandler: [fastify.authenticate] }, async (request) => {
    await pool.query(
      'UPDATE usuarios SET token_version = token_version + 1 WHERE id = $1',
      [request.user.userId]
    );
    return { ok: true };
  });

  // ---------- Cadastro self-service (US20/US34) ----------
  // Segmentos disponíveis pro dropdown do cadastro (CA02/US34) — tabela
  // dinâmica (035), consultada sem autenticação já que roda antes do login.
  fastify.get('/api/segmentos', async () => {
    const { rows } = await pool.query('SELECT id, nome FROM segmentos WHERE ativo = true ORDER BY id');
    return { segmentos: rows };
  });

  fastify.post('/api/auth/register', async (request, reply) => {
    const {
      nome_responsavel: nomeResponsavel,
      email,
      senha,
      segmento_id: segmentoIdBruto,
      telefone: telefoneBruto,
      whatsapp: whatsappBruto,
    } = request.body || {};

    const nomeLimpo = (nomeResponsavel || '').trim();
    const emailLimpo = (email || '').toLowerCase().trim();

    if (nomeLimpo.length < 2) {
      return reply.code(400).send({ error: 'Informe o nome do responsável.' });
    }
    if (!EMAIL_REGEX.test(emailLimpo)) {
      return reply.code(400).send({ error: 'Digite um e-mail válido.' });
    }
    if (!SENHA_REGEX.test(senha || '')) {
      return reply.code(400).send({
        error: 'A senha deve ter no mínimo 8 caracteres, 1 número e 1 letra maiúscula.',
      });
    }
    const segmentoId = parseInt(segmentoIdBruto, 10);
    if (!Number.isInteger(segmentoId)) {
      return reply.code(400).send({ error: 'Selecione seu segmento.' });
    }
    // Telefone usa a mesma validação/formato do WhatsApp (DDD + número), mas
    // sem checagem de unicidade — diferente do WhatsApp, pode repetir entre
    // contas (CA03 do US34).
    const telefone = normalizarWhatsapp(telefoneBruto);
    if (!telefone) {
      return reply.code(400).send({ error: 'Digite um telefone válido com DDD.' });
    }
    const whatsapp = normalizarWhatsapp(whatsappBruto);
    if (!whatsapp) {
      return reply.code(400).send({ error: 'Digite um número de WhatsApp válido com DDD.' });
    }

    // Verificação de unicidade antes de criar qualquer registro (CA03).
    const { rows: emailRows } = await pool.query('SELECT 1 FROM usuarios WHERE email = $1', [emailLimpo]);
    if (emailRows.length > 0) {
      return reply.code(409).send({ error: 'Este e-mail já está cadastrado. Faça login ou use outro e-mail.' });
    }
    const { rows: whatsappRows } = await pool.query('SELECT 1 FROM tenants WHERE whatsapp = $1', [whatsapp]);
    if (whatsappRows.length > 0) {
      return reply.code(409).send({ error: 'Este número de WhatsApp já está associado a uma conta.' });
    }
    const { rows: segmentoRows } = await pool.query(
      'SELECT slug FROM segmentos WHERE id = $1 AND ativo = true',
      [segmentoId]
    );
    if (!segmentoRows[0]) {
      return reply.code(400).send({ error: 'Selecione um segmento válido.' });
    }
    const segmentoSlug = segmentoRows[0].slug;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Trial começa imediatamente, antes mesmo da validação do token (CA04).
      // `nome` (nome comercial exibido em "Minha Empresa") nasce igual ao
      // nome do responsável — o formulário de cadastro não coleta mais um
      // nome de empresa separado (substituído pelo Segmento, CA01/US34); o
      // tenant pode ajustá-lo depois em Minha Empresa (US33).
      const trialExpira = new Date(Date.now() + TRIAL_DIAS * 24 * 60 * 60 * 1000);
      const { rows: tenantRows } = await client.query(
        `INSERT INTO tenants (nome, telefone, whatsapp, segmento, segmento_id, plano, status, trial_expires_at)
         VALUES ($1, $2, $3, $4, $5, 'trial', 'trial', $6)
         RETURNING id`,
        [nomeLimpo, telefone, whatsapp, segmentoSlug, segmentoId, trialExpira.toISOString()]
      );
      const tenantId = tenantRows[0].id;

      // Libera os módulos do trial (CA09).
      await client.query(
        `INSERT INTO tenant_modulos (tenant_id, modulo_key, ativo)
         SELECT $1, key, true FROM modulos WHERE key = ANY($2::text[])
         ON CONFLICT (tenant_id, modulo_key) DO NOTHING`,
        [tenantId, MODULOS_TRIAL]
      );

      const hash = await bcrypt.hash(senha, 10);
      const { rows: usuarioRows } = await client.query(
        `INSERT INTO usuarios (tenant_id, email, senha_hash, nome, email_verified)
         VALUES ($1, $2, $3, $4, false)
         RETURNING id, token_version`,
        [tenantId, emailLimpo, hash, nomeLimpo]
      );
      const usuarioId = usuarioRows[0].id;

      // Gera e persiste o token dentro da mesma transação da criação do
      // usuário (US21/CA01/CA05). O envio por e-mail/WhatsApp (chamada de
      // rede pra provedor externo) é disparado depois do COMMIT e sem await
      // bloqueando a resposta: uma chamada de rede lenta ou travada não pode
      // segurar uma conexão do pool nem atrasar o cadastro. `enviarPorCanais`
      // nunca lança (usa Promise.allSettled internamente).
      const codigo = await tokenService.criarToken(client, { userId: usuarioId, tipo: 'email_verificacao' });

      await client.query('COMMIT');

      tokenService.enviarPorCanais({ token: codigo, email: emailLimpo, whatsapp, nome: nomeLimpo });

      // Loga o usuário já autenticado (mas com email_verified=false) pra ele
      // seguir direto pra tela de validação do token (CA07).
      const token = fastify.jwt.sign(
        { userId: usuarioId, tenantId, email: emailLimpo, tokenVersion: usuarioRows[0].token_version },
        { expiresIn: '7d' }
      );

      reply.code(201);
      return {
        token,
        nome: nomeLimpo,
        email: emailLimpo,
        email_verified: false,
        email_mascarado: tokenService.mascararEmail(emailLimpo),
      };
    } catch (erro) {
      await client.query('ROLLBACK');
      // Corrida entre a verificação acima e o INSERT (unique keys do banco).
      if (erro.code === '23505') {
        const msg = /whatsapp/i.test(erro.constraint || '')
          ? 'Este número de WhatsApp já está associado a uma conta.'
          : 'Este e-mail já está cadastrado. Faça login ou use outro e-mail.';
        return reply.code(409).send({ error: msg });
      }
      throw erro;
    } finally {
      client.release();
    }
  });

  // Valida o token de 6 dígitos e ativa o e-mail (CA08). Autenticado: o
  // usuário já está logado desde o cadastro (ou desde o login sem validação —
  // CA10).
  fastify.post('/api/auth/verify-token', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { userId, tenantId } = request.user;
    const codigo = String((request.body || {}).token || '').trim();

    if (!/^\d{6}$/.test(codigo)) {
      return reply.code(400).send({ error: 'Código incorreto. Tente novamente.' });
    }

    const { valido, motivo } = await tokenService.validate({ userId, tipo: 'email_verificacao', token: codigo });
    if (!valido) {
      const mensagens = {
        nao_encontrado: 'Nenhum código pendente. Solicite um novo.',
        expirado: 'Código expirado. Solicite um novo.',
        bloqueado: 'Número máximo de tentativas atingido. Solicite um novo código.',
        incorreto: 'Código incorreto. Tente novamente.',
      };
      return reply.code(400).send({ error: mensagens[motivo] || mensagens.incorreto });
    }

    // Token correto (validado e marcado como usado por `tokenService.validate`
    // — uso único, CA05): verifica o e-mail.
    await pool.query('UPDATE usuarios SET email_verified = true WHERE id = $1', [userId]);
    // ativado_em (US30) marca o momento exato da ativação — usado depois pra
    // calcular o trial (ativado_em + 14 dias). COALESCE garante que revalidar
    // um token (ou reprocessar) nunca sobrescreva a data já registrada.
    await pool.query('UPDATE tenants SET ativado_em = COALESCE(ativado_em, now()) WHERE id = $1', [tenantId]);

    return { ok: true, message: 'E-mail verificado! Seu trial de 14 dias está ativo.' };
  });

  // Reenvio de token (CA11): novo token, invalida o anterior, cooldown de 60s
  // e limite de 5 por hora.
  fastify.post('/api/auth/resend-token', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { userId, email } = request.user;

    const { rows: contagem } = await pool.query(
      `SELECT
         COUNT(*)::int AS na_hora,
         MAX(criado_em) AS ultimo
       FROM tokens_validacao
       WHERE user_id = $1 AND tipo = 'email_verificacao' AND criado_em > now() - interval '1 hour'`,
      [userId]
    );
    if (contagem[0].na_hora >= MAX_REENVIOS_HORA) {
      return reply.code(429).send({ error: 'Limite de reenvios atingido. Tente novamente mais tarde.' });
    }
    if (contagem[0].ultimo && Date.now() - new Date(contagem[0].ultimo).getTime() < REENVIO_COOLDOWN_SEGUNDOS * 1000) {
      return reply.code(429).send({ error: 'Aguarde alguns segundos antes de solicitar um novo código.' });
    }

    // Precisa do WhatsApp do tenant pra reenviar pelo mesmo canal do cadastro.
    const { rows: tenantRows } = await pool.query(
      `SELECT t.whatsapp FROM usuarios u JOIN tenants t ON t.id = u.tenant_id WHERE u.id = $1`,
      [userId]
    );
    const whatsapp = tenantRows[0] ? tenantRows[0].whatsapp : null;

    const client = await pool.connect();
    let codigo;
    try {
      await client.query('BEGIN');
      // Invalida qualquer token pendente do mesmo tipo antes de gerar o novo
      // (feito internamente por `criarToken` — US21/CA05).
      codigo = await tokenService.criarToken(client, { userId, tipo: 'email_verificacao' });
      await client.query('COMMIT');
    } catch (erro) {
      await client.query('ROLLBACK');
      throw erro;
    } finally {
      client.release();
    }

    // Tenant criado pela área admin (US16) pode não ter WhatsApp cadastrado —
    // nesse caso reenvia só por e-mail em vez de disparar pro provedor com um
    // número inexistente.
    tokenService.enviarPorCanais({ token: codigo, email, whatsapp: whatsapp || undefined });

    return { ok: true };
  });

  // Status do tenant logado: usado pela tela de validação e pelo banner de
  // trial no portal (CA09). Devolve dias restantes do trial.
  fastify.get('/api/tenant/status', { preHandler: [fastify.authenticate] }, async (request) => {
    const { userId, tenantId } = request.user;
    const { rows } = await pool.query(
      `SELECT u.email, u.email_verified, t.status, t.plano, t.trial_expires_at
       FROM usuarios u JOIN tenants t ON t.id = u.tenant_id
       WHERE u.id = $1`,
      [userId]
    );
    const info = rows[0] || {};
    let diasRestantes = null;
    if (info.trial_expires_at) {
      const ms = new Date(info.trial_expires_at).getTime() - Date.now();
      diasRestantes = Math.max(0, Math.ceil(ms / (24 * 60 * 60 * 1000)));
    }
    return {
      tenant_id: tenantId,
      email: info.email,
      email_mascarado: info.email ? tokenService.mascararEmail(info.email) : null,
      email_verified: !!info.email_verified,
      status: info.status,
      plano: info.plano,
      trial_expires_at: info.trial_expires_at,
      dias_restantes: diasRestantes,
    };
  });

  // ---------- Agenda ----------
  fastify.get('/api/agendamentos', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenantId } = request.user;
    const { view, data } = request.query;

    if (view === 'dia') {
      const dataRef = data || dataAtualBrasilia();
      const { rows } = await pool.query(
        `SELECT a.id, a.data_hora, a.status, a.encaixe, c.nome AS cliente, c.telefone AS cliente_telefone,
                a.profissional_id, p.nome AS profissional, a.servico_id, s.nome AS servico, s.duracao_minutos, s.preco
         FROM agendamentos a
         JOIN clientes c ON c.id = a.cliente_id
         JOIN profissionais p ON p.id = a.profissional_id
         JOIN servicos s ON s.id = a.servico_id
         WHERE a.tenant_id = $1 AND (a.data_hora AT TIME ZONE 'America/Sao_Paulo')::date = $2::date
         ORDER BY a.data_hora`,
        [tenantId, dataRef]
      );
      return { view: 'dia', data: dataRef, agendamentos: rows };
    }

    if (view === 'semana') {
      const dataRef = data || dataAtualBrasilia();
      const { rows } = await pool.query(
        `SELECT a.id, a.data_hora, a.status, a.encaixe, c.nome AS cliente,
                a.profissional_id, p.nome AS profissional, a.servico_id, s.nome AS servico, s.duracao_minutos, s.preco
         FROM agendamentos a
         JOIN clientes c ON c.id = a.cliente_id
         JOIN profissionais p ON p.id = a.profissional_id
         JOIN servicos s ON s.id = a.servico_id
         WHERE a.tenant_id = $1
           AND (a.data_hora AT TIME ZONE 'America/Sao_Paulo')::date >= date_trunc('week', $2::date)
           AND (a.data_hora AT TIME ZONE 'America/Sao_Paulo')::date < date_trunc('week', $2::date) + interval '7 days'
         ORDER BY a.data_hora`,
        [tenantId, dataRef]
      );
      return { view: 'semana', data: dataRef, agendamentos: rows };
    }

    if (view === 'mes') {
      const mesRef = data || mesAtualBrasilia();
      // US02.6 — a view Mês mostrava só a contagem de agendamentos por dia;
      // agora traz data_hora + duração de cada um pra listar horário-duração
      // empilhados na célula do dia (o agrupamento por dia é feito no front).
      const { rows } = await pool.query(
        `SELECT a.data_hora, a.status, s.duracao_minutos
         FROM agendamentos a
         JOIN servicos s ON s.id = a.servico_id
         WHERE a.tenant_id = $1
           AND to_char(a.data_hora AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM') = $2
         ORDER BY a.data_hora`,
        [tenantId, mesRef]
      );
      return { view: 'mes', mes: mesRef, agendamentos: rows };
    }

    return reply.code(400).send({ error: 'Parâmetro "view" deve ser dia, semana ou mes' });
  });

  fastify.patch('/api/agendamentos/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenantId } = request.user;
    const { id } = request.params;
    const { status, data_hora: dataHora } = request.body || {};

    if (status === undefined && dataHora === undefined) {
      return reply.code(400).send({ error: 'Informe "status" e/ou "data_hora" para atualizar' });
    }
    if (status !== undefined && !['confirmado', 'cancelado', 'reagendado'].includes(status)) {
      return reply.code(400).send({ error: 'status inválido' });
    }

    const { rows: atuais } = await pool.query(
      `SELECT a.id, a.profissional_id, s.duracao_minutos, p.nome AS profissional
       FROM agendamentos a
       JOIN servicos s ON s.id = a.servico_id
       JOIN profissionais p ON p.id = a.profissional_id
       WHERE a.id = $1 AND a.tenant_id = $2`,
      [id, tenantId]
    );
    const atual = atuais[0];
    if (!atual) {
      return reply.code(404).send({ error: 'Agendamento não encontrado' });
    }

    if (dataHora !== undefined) {
      // Reagendar também precisa respeitar o horário de funcionamento do
      // salão (dias/abertura/fechamento/almoço), igual ao POST /agendamentos.
      const { rows: tenantRows } = await pool.query(
        `SELECT dias_funcionamento, horario_abertura, horario_fechamento,
                horario_almoco_ativo, horario_almoco_inicio, horario_almoco_fim
         FROM tenants WHERE id = $1`,
        [tenantId]
      );
      const validacao = dentroDoHorarioFuncionamento(tenantRows[0], dataHora, atual.duracao_minutos);
      if (!validacao.valido) {
        return reply.code(400).send({ error: validacao.motivo });
      }

      const { rows: conflitos } = await pool.query(
        `SELECT a.id
         FROM agendamentos a
         JOIN servicos s ON s.id = a.servico_id
         WHERE a.tenant_id = $1
           AND a.profissional_id = $2
           AND a.status = 'confirmado'
           AND a.id <> $3
           AND a.data_hora < $4::timestamptz + ($5 * interval '1 minute')
           AND $4::timestamptz < a.data_hora + (s.duracao_minutos * interval '1 minute')`,
        [tenantId, atual.profissional_id, id, dataHora, atual.duracao_minutos]
      );
      if (conflitos.length > 0) {
        return reply.code(409).send({
          error: `Conflito de horário: ${atual.profissional} já tem agendamento neste período.`,
        });
      }
    }

    await pool.query(
      `UPDATE agendamentos SET
         status = COALESCE($2, status),
         data_hora = COALESCE($3, data_hora),
         updated_at = now()
       WHERE id = $1`,
      [id, status ?? null, dataHora ?? null]
    );

    const { rows: detalhado } = await pool.query(
      `SELECT a.id, a.data_hora, a.status, a.encaixe, a.updated_at,
              c.nome AS cliente, c.telefone AS cliente_telefone,
              p.nome AS profissional, s.nome AS servico, s.duracao_minutos
       FROM agendamentos a
       JOIN clientes c ON c.id = a.cliente_id
       JOIN profissionais p ON p.id = a.profissional_id
       JOIN servicos s ON s.id = a.servico_id
       WHERE a.id = $1`,
      [id]
    );

    return detalhado[0];
  });

  const SLOT_INTERVALO_MINUTOS = 30;

  fastify.get('/api/agendamentos/disponibilidade', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenantId } = request.user;
    const { data, profissional, servico } = request.query;

    if (!data || !profissional || !servico) {
      return reply.code(400).send({ error: 'Parâmetros "data", "profissional" e "servico" são obrigatórios' });
    }

    const { rows: servicoRows } = await pool.query(
      'SELECT duracao_minutos FROM servicos WHERE id = $1 AND tenant_id = $2',
      [servico, tenantId]
    );
    const servicoInfo = servicoRows[0];
    if (!servicoInfo) {
      return reply.code(404).send({ error: 'Serviço não encontrado' });
    }

    const { rows: tenantRows } = await pool.query(
      `SELECT dias_funcionamento, horario_abertura, horario_fechamento,
              horario_almoco_ativo, horario_almoco_inicio, horario_almoco_fim
       FROM tenants WHERE id = $1`,
      [tenantId]
    );
    const tenant = tenantRows[0];
    const diasFuncionamento = tenant.dias_funcionamento || [1, 2, 3, 4, 5, 6];
    // Dia fechado: nenhum slot possível, sem precisar gerar/filtrar nada — o
    // dia da semana é lido a partir do meio-dia local (evita qualquer
    // ambiguidade de fuso na virada do dia que afetaria só a hora, não a
    // data em si, já que `data` já vem como "YYYY-MM-DD").
    if (!diasFuncionamento.includes(diaDaSemanaBrasilia(`${data}T12:00:00-03:00`))) {
      return { data, profissional, servico, duracaoMinutos: servicoInfo.duracao_minutos, slots: [] };
    }

    const horarioAberturaMinutos = horarioParaMinutos(tenant.horario_abertura);
    const horarioFechamentoMinutos = horarioParaMinutos(tenant.horario_fechamento);
    const almocoAtivo = tenant.horario_almoco_ativo;
    const almocoInicioMinutos = almocoAtivo ? horarioParaMinutos(tenant.horario_almoco_inicio) : null;
    const almocoFimMinutos = almocoAtivo ? horarioParaMinutos(tenant.horario_almoco_fim) : null;

    const { rows: ocupados } = await pool.query(
      `SELECT a.data_hora, s.duracao_minutos
       FROM agendamentos a
       JOIN servicos s ON s.id = a.servico_id
       WHERE a.tenant_id = $1 AND a.profissional_id = $2
         AND a.status = 'confirmado'
         AND (a.data_hora AT TIME ZONE 'America/Sao_Paulo')::date = $3::date`,
      [tenantId, profissional, data]
    );

    const duracaoMinutos = servicoInfo.duracao_minutos;
    const slots = [];
    for (
      let minutos = horarioAberturaMinutos;
      minutos + duracaoMinutos <= horarioFechamentoMinutos;
      minutos += SLOT_INTERVALO_MINUTOS
    ) {
      // Slot (do início ao fim do serviço) cai total ou parcialmente dentro
      // do intervalo de almoço — nem oferece como opção (diferente de
      // "ocupado": almoço não é um horário reservável de jeito nenhum).
      const fimSlotMinutos = minutos + duracaoMinutos;
      if (almocoAtivo && minutos < almocoFimMinutos && almocoInicioMinutos < fimSlotMinutos) {
        continue;
      }

      // "T00:00:00-03:00" ancora explicitamente em meia-noite de Brasília,
      // independente do fuso do processo Node (que roda em UTC no container).
      // setUTCMinutes (não setMinutes) evita reintroduzir a mesma confusão de
      // fuso ao somar os minutos do slot.
      const inicioSlot = new Date(`${data}T00:00:00-03:00`);
      inicioSlot.setUTCMinutes(inicioSlot.getUTCMinutes() + minutos);
      const fimSlot = new Date(inicioSlot.getTime() + duracaoMinutos * 60000);

      const conflita = ocupados.some((o) => {
        const inicioOcupado = new Date(o.data_hora);
        const fimOcupado = new Date(inicioOcupado.getTime() + o.duracao_minutos * 60000);
        return inicioSlot < fimOcupado && inicioOcupado < fimSlot;
      });

      slots.push({ hora: inicioSlot.toISOString(), disponivel: !conflita });
    }

    return { data, profissional, servico, duracaoMinutos, slots };
  });

  fastify.get('/api/servicos', { preHandler: [fastify.authenticate] }, async (request) => {
    const { tenantId } = request.user;
    const { rows } = await pool.query(
      `SELECT id, nome, duracao_minutos, preco, ativo, profissional_preferencial_id
       FROM servicos WHERE tenant_id = $1 AND excluido_em IS NULL ORDER BY nome`,
      [tenantId]
    );
    return { servicos: rows };
  });

  // ---------- CRUD de serviços (US17/ST17.1) ----------
  fastify.post('/api/servicos', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenantId } = request.user;
    const { nome, duracao_minutos: duracaoMinutos, preco, profissional_preferencial_id: profissionalPreferencialId } = request.body || {};

    if (!nome || !nome.trim()) {
      return reply.code(400).send({ error: 'Campo "nome" é obrigatório' });
    }
    if (!Number.isFinite(duracaoMinutos) || duracaoMinutos <= 0) {
      return reply.code(400).send({ error: 'Campo "duracao_minutos" deve ser um número maior que zero' });
    }
    if (preco !== undefined && preco !== null && (!Number.isFinite(preco) || preco < 0)) {
      return reply.code(400).send({ error: 'Campo "preco" deve ser um número maior ou igual a zero' });
    }

    const { rows } = await pool.query(
      `INSERT INTO servicos (tenant_id, nome, duracao_minutos, preco, profissional_preferencial_id)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, nome, duracao_minutos, preco, ativo, profissional_preferencial_id`,
      [tenantId, nome.trim(), duracaoMinutos, preco ?? null, profissionalPreferencialId || null]
    );
    reply.code(201);
    return rows[0];
  });

  fastify.patch('/api/servicos/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenantId } = request.user;
    const { id } = request.params;
    const { nome, duracao_minutos: duracaoMinutos, preco, ativo, profissional_preferencial_id: profissionalPreferencialId } = request.body || {};

    if (nome !== undefined && !nome.trim()) {
      return reply.code(400).send({ error: 'Campo "nome" não pode ficar vazio' });
    }
    if (duracaoMinutos !== undefined && (!Number.isFinite(duracaoMinutos) || duracaoMinutos <= 0)) {
      return reply.code(400).send({ error: 'Campo "duracao_minutos" deve ser um número maior que zero' });
    }
    if (preco !== undefined && preco !== null && (!Number.isFinite(preco) || preco < 0)) {
      return reply.code(400).send({ error: 'Campo "preco" deve ser um número maior ou igual a zero' });
    }

    const { rows } = await pool.query(
      `UPDATE servicos SET
         nome = COALESCE($3, nome),
         duracao_minutos = COALESCE($4, duracao_minutos),
         preco = CASE WHEN $5 THEN $6 ELSE preco END,
         ativo = COALESCE($7, ativo),
         profissional_preferencial_id = CASE WHEN $8 THEN $9 ELSE profissional_preferencial_id END
       WHERE id = $1 AND tenant_id = $2 AND excluido_em IS NULL
       RETURNING id, nome, duracao_minutos, preco, ativo, profissional_preferencial_id`,
      [
        id, tenantId, nome ? nome.trim() : null, duracaoMinutos ?? null, preco !== undefined, preco ?? null,
        ativo ?? null, profissionalPreferencialId !== undefined, profissionalPreferencialId || null,
      ]
    );
    if (!rows[0]) {
      return reply.code(404).send({ error: 'Serviço não encontrado' });
    }
    return rows[0];
  });

  // CA da exclusão (redesenho do menu Serviços): soft delete, não mais um
  // DELETE de verdade — servico_id tem ON DELETE CASCADE em agendamentos, e
  // um hard delete apagaria o histórico de agendamentos antigos que usam
  // esse serviço. "Excluir" só marca excluido_em (some da listagem e de
  // novos agendamentos); os agendamentos já feitos continuam intactos.
  fastify.delete('/api/servicos/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenantId } = request.user;
    const { id } = request.params;

    const { rowCount } = await pool.query(
      'UPDATE servicos SET excluido_em = now() WHERE id = $1 AND tenant_id = $2 AND excluido_em IS NULL',
      [id, tenantId]
    );
    if (!rowCount) {
      return reply.code(404).send({ error: 'Serviço não encontrado' });
    }
    return { ok: true };
  });

  // Lista de profissionais do tenant, usada para popular o dropdown do
  // formulário de novo agendamento (ST09.2 / US09). Inclui os ids dos
  // serviços que cada um atende, usado na tela de gestão (US17/ST17.4).
  fastify.get('/api/profissionais', { preHandler: [fastify.authenticate] }, async (request) => {
    const { tenantId } = request.user;
    const { rows } = await pool.query(
      `SELECT p.id, p.nome,
              COALESCE(array_agg(ps.servico_id) FILTER (WHERE ps.servico_id IS NOT NULL), '{}') AS servicos
       FROM profissionais p
       LEFT JOIN profissionais_servicos ps ON ps.profissional_id = p.id
       WHERE p.tenant_id = $1
       GROUP BY p.id, p.nome
       ORDER BY p.nome`,
      [tenantId]
    );
    return { profissionais: rows };
  });

  // ---------- CRUD de profissionais (US17/ST17.2) ----------
  async function definirServicosDoProfissional(client, tenantId, profissionalId, servicoIds) {
    if (!Array.isArray(servicoIds)) return;
    // Só vincula serviços que realmente pertencem a este tenant — evita que
    // um id de outro tenant seja injetado no vínculo.
    await client.query('DELETE FROM profissionais_servicos WHERE profissional_id = $1', [profissionalId]);
    if (servicoIds.length === 0) return;
    await client.query(
      `INSERT INTO profissionais_servicos (profissional_id, servico_id)
       SELECT $1, s.id FROM servicos s WHERE s.tenant_id = $2 AND s.id = ANY($3::uuid[])`,
      [profissionalId, tenantId, servicoIds]
    );
  }

  fastify.post('/api/profissionais', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenantId } = request.user;
    const { nome, servicos } = request.body || {};

    if (!nome || !nome.trim()) {
      return reply.code(400).send({ error: 'Campo "nome" é obrigatório' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        'INSERT INTO profissionais (tenant_id, nome) VALUES ($1, $2) RETURNING id, nome',
        [tenantId, nome.trim()]
      );
      await definirServicosDoProfissional(client, tenantId, rows[0].id, servicos);
      await client.query('COMMIT');
      reply.code(201);
      return { ...rows[0], servicos: servicos || [] };
    } catch (erro) {
      await client.query('ROLLBACK');
      throw erro;
    } finally {
      client.release();
    }
  });

  fastify.patch('/api/profissionais/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenantId } = request.user;
    const { id } = request.params;
    const { nome, servicos } = request.body || {};

    if (nome !== undefined && !nome.trim()) {
      return reply.code(400).send({ error: 'Campo "nome" não pode ficar vazio' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `UPDATE profissionais SET nome = COALESCE($3, nome)
         WHERE id = $1 AND tenant_id = $2
         RETURNING id, nome`,
        [id, tenantId, nome ? nome.trim() : null]
      );
      if (!rows[0]) {
        await client.query('ROLLBACK');
        return reply.code(404).send({ error: 'Profissional não encontrado' });
      }
      await definirServicosDoProfissional(client, tenantId, id, servicos);
      await client.query('COMMIT');
      return { ...rows[0], servicos: servicos !== undefined ? servicos : undefined };
    } catch (erro) {
      await client.query('ROLLBACK');
      throw erro;
    } finally {
      client.release();
    }
  });

  fastify.delete('/api/profissionais/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenantId } = request.user;
    const { id } = request.params;

    // ST17.5 — mesma proteção do DELETE de serviço.
    const { rows: futuros } = await pool.query(
      `SELECT COUNT(*)::int AS total FROM agendamentos
       WHERE tenant_id = $1 AND profissional_id = $2 AND status = 'confirmado' AND data_hora > now()`,
      [tenantId, id]
    );
    if (futuros[0].total > 0) {
      return reply.code(409).send({
        error: `Não é possível excluir: há ${futuros[0].total} agendamento(s) futuro(s) com este profissional.`,
      });
    }

    const { rowCount } = await pool.query('DELETE FROM profissionais WHERE id = $1 AND tenant_id = $2', [id, tenantId]);
    if (!rowCount) {
      return reply.code(404).send({ error: 'Profissional não encontrado' });
    }
    return { ok: true };
  });

  fastify.post('/api/agendamentos', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenantId } = request.user;
    const {
      cliente_nome: clienteNome,
      cliente_telefone: clienteTelefoneBruto,
      profissional_id: profissionalId,
      servico_id: servicoId,
      data_hora: dataHora,
      encaixe,
      origem,
      observacoes,
    } = request.body || {};

    // Telefone é obrigatório: é o canal de comunicação com a cliente
    // (decisão de 2026-07-08, revertendo a US09/CA02 original).
    const clienteTelefone = clienteTelefoneBruto ? clienteTelefoneBruto.trim() : '';

    if (!clienteTelefone || !profissionalId || !servicoId || !dataHora) {
      return reply.code(400).send({
        error: 'Campos "cliente_telefone", "profissional_id", "servico_id" e "data_hora" são obrigatórios',
      });
    }

    // Canal de origem (CA09). Como este endpoint é o do portal (autenticado), o
    // padrão é 'portal'; 'whatsapp' fica aceito para consistência caso o bot
    // passe a usar a mesma rota no futuro.
    if (origem !== undefined && !['portal', 'whatsapp'].includes(origem)) {
      return reply.code(400).send({ error: 'origem deve ser "portal" ou "whatsapp"' });
    }
    const origemFinal = origem || 'portal';

    const { rows: servicoRows } = await pool.query(
      'SELECT duracao_minutos FROM servicos WHERE id = $1 AND tenant_id = $2',
      [servicoId, tenantId]
    );
    const servicoInfo = servicoRows[0];
    if (!servicoInfo) {
      return reply.code(404).send({ error: 'Serviço não encontrado' });
    }

    const { rows: profissionalRows } = await pool.query(
      'SELECT nome FROM profissionais WHERE id = $1 AND tenant_id = $2',
      [profissionalId, tenantId]
    );
    const profissionalInfo = profissionalRows[0];
    if (!profissionalInfo) {
      return reply.code(404).send({ error: 'Profissional não encontrado' });
    }

    // Horário de funcionamento do salão (dias/abertura/fechamento/almoço) —
    // vale pra qualquer agendamento, inclusive encaixe: a exceção do encaixe é
    // sobrepor um horário já ocupado, não funcionar fora do expediente.
    const { rows: tenantRows } = await pool.query(
      `SELECT dias_funcionamento, horario_abertura, horario_fechamento,
              horario_almoco_ativo, horario_almoco_inicio, horario_almoco_fim
       FROM tenants WHERE id = $1`,
      [tenantId]
    );
    const validacaoHorario = dentroDoHorarioFuncionamento(tenantRows[0], dataHora, servicoInfo.duracao_minutos);
    if (!validacaoHorario.valido) {
      return reply.code(400).send({ error: validacaoHorario.motivo });
    }

    // Encaixe é uma exceção manual feita pela dona do salão: sobrepor um
    // horário já ocupado é o próprio propósito da funcionalidade (procedimentos
    // simples/rápidos encaixados ao lado de um atendimento já agendado), então
    // a validação de conflito só se aplica a agendamentos normais.
    if (!encaixe) {
      const { rows: conflitos } = await pool.query(
        `SELECT a.id
         FROM agendamentos a
         JOIN servicos s ON s.id = a.servico_id
         WHERE a.tenant_id = $1
           AND a.profissional_id = $2
           AND a.status = 'confirmado'
           AND a.data_hora < $3::timestamptz + ($4 * interval '1 minute')
           AND $3::timestamptz < a.data_hora + (s.duracao_minutos * interval '1 minute')`,
        [tenantId, profissionalId, dataHora, servicoInfo.duracao_minutos]
      );
      if (conflitos.length > 0) {
        return reply.code(409).send({
          error: `Conflito de horário: ${profissionalInfo.nome} já tem agendamento neste período.`,
        });
      }
    }

    const { rows: clienteRows } = await pool.query(
      `INSERT INTO clientes (tenant_id, nome, telefone)
       VALUES ($1, $2, $3)
       ON CONFLICT (tenant_id, telefone) DO UPDATE SET nome = COALESCE(EXCLUDED.nome, clientes.nome)
       RETURNING id`,
      [tenantId, clienteNome || null, clienteTelefone]
    );
    const clienteId = clienteRows[0].id;

    const { rows: criado } = await pool.query(
      `INSERT INTO agendamentos (tenant_id, cliente_id, profissional_id, servico_id, data_hora, encaixe, origem, observacoes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id`,
      [tenantId, clienteId, profissionalId, servicoId, dataHora, !!encaixe, origemFinal, observacoes || null]
    );

    const { rows: detalhado } = await pool.query(
      `SELECT a.id, a.data_hora, a.status, a.encaixe, a.origem, a.observacoes, a.updated_at,
              a.profissional_id, p.nome AS profissional,
              a.servico_id, s.nome AS servico, s.duracao_minutos,
              c.nome AS cliente, c.telefone AS cliente_telefone
       FROM agendamentos a
       JOIN clientes c ON c.id = a.cliente_id
       JOIN profissionais p ON p.id = a.profissional_id
       JOIN servicos s ON s.id = a.servico_id
       WHERE a.id = $1`,
      [criado[0].id]
    );

    reply.code(201);
    return detalhado[0];
  });

  // ---------- Perfil (US33) ----------
  const UF_VALIDAS = [
    'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB',
    'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO',
  ];

  // Formato comum ao GET e à resposta do PATCH (CA02/CA05): nome_segmento é o
  // `tenants.nome` já existente (nome comercial); nome_responsavel é o nome do
  // próprio usuário logado (`usuarios.nome`) — um campo novo nesta US, distinto
  // do nome do negócio.
  async function buscarPerfil(userId) {
    const { rows } = await pool.query(
      `SELECT u.nome AS nome_responsavel, u.email,
              t.nome AS nome_segmento, t.telefone, t.whatsapp, t.plano, t.segmento,
              t.endereco_cep, t.endereco_logradouro, t.endereco_numero,
              t.endereco_complemento, t.endereco_bairro, t.endereco_cidade, t.endereco_uf
       FROM usuarios u JOIN tenants t ON t.id = u.tenant_id
       WHERE u.id = $1`,
      [userId]
    );
    const perfil = rows[0];
    if (!perfil) return perfil;
    // CA05 — rótulo amigável do plano atual, mesma fonte usada no detalhe do
    // tenant na área admin (US28/nomeDoPlano), pra nunca divergir.
    return { ...perfil, plano_nome: nomeDoPlano(perfil.plano) };
  }

  fastify.get('/api/perfil', { preHandler: [fastify.authenticate] }, async (request) => {
    return buscarPerfil(request.user.userId);
  });

  fastify.patch('/api/perfil', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { userId, tenantId } = request.user;
    // segmento não é editável pelo tenant — só a equipe Kyvvo altera, via
    // PATCH /admin/api/tenants/:id (CA05).
    const {
      nome_responsavel: nomeResponsavelBruto,
      nome_segmento: nomeSegmentoBruto,
      telefone: telefoneBruto,
      telefone_e_whatsapp: telefoneEWhatsapp,
      endereco,
    } = request.body || {};

    // Meu Perfil (dados pessoais) e Minha Empresa (dados do negócio, PR12)
    // viraram duas telas com botão de salvar independentes — cada grupo de
    // campo só é validado/atualizado quando vem no corpo da requisição
    // (padrão COALESCE, igual PATCH /api/configuracao já usa), em vez de
    // exigir tudo junto como antes.
    const grupoPessoal = nomeResponsavelBruto !== undefined || telefoneBruto !== undefined;
    let nomeResponsavel, telefone;
    if (grupoPessoal) {
      nomeResponsavel = (nomeResponsavelBruto || '').trim();
      if (nomeResponsavel.length < 2) {
        return reply.code(400).send({ error: 'Informe o nome do responsável.' });
      }
      telefone = normalizarWhatsapp(telefoneBruto);
      if (!telefone) {
        return reply.code(400).send({ error: 'Informe um telefone válido com DDD.' });
      }
    }

    let nomeSegmento;
    if (nomeSegmentoBruto !== undefined) {
      nomeSegmento = (nomeSegmentoBruto || '').trim();
      if (nomeSegmento.length < 2) {
        return reply.code(400).send({ error: 'Informe o nome do seu negócio.' });
      }
    }

    let enderecoValidado = null;
    if (endereco !== undefined) {
      const { cep, logradouro, numero, complemento, bairro, cidade, uf } = endereco || {};
      const cepLimpo = String(cep || '').replace(/\D/g, '');
      const enderecoCompleto =
        /^\d{8}$/.test(cepLimpo) &&
        (logradouro || '').trim() &&
        (numero || '').trim() &&
        (bairro || '').trim() &&
        (cidade || '').trim() &&
        UF_VALIDAS.includes(String(uf || '').toUpperCase());
      if (!enderecoCompleto) {
        return reply.code(400).send({ error: 'Preencha todos os campos do endereço.' });
      }
      enderecoValidado = {
        cep: cepLimpo,
        logradouro: logradouro.trim(),
        numero: numero.trim(),
        complemento: (complemento || '').trim() || null,
        bairro: bairro.trim(),
        cidade: cidade.trim(),
        uf: String(uf).toUpperCase(),
      };
    }

    const client = await pool.connect();
    let asaasCustomerId;
    try {
      await client.query('BEGIN');
      if (grupoPessoal) {
        await client.query('UPDATE usuarios SET nome = $2 WHERE id = $1', [userId, nomeResponsavel]);
      }
      // Checkbox "Este número também é o WhatsApp" (Meu Perfil) — evita o
      // dono ter que digitar o mesmo número duas vezes; telefone e whatsapp
      // continuam sendo colunas separadas (whatsapp é chave única, usada no
      // cadastro self-service/reenvio de verificação/admin), então só
      // espelha telefone → whatsapp quando o tenant marca a opção e o
      // telefone está de fato sendo atualizado nesta requisição.
      // endereco_complemento usa CASE (em vez de COALESCE) porque é o único
      // subcampo opcional do grupo endereço — precisa poder ser limpo pra
      // null quando o endereço é atualizado, mas não pode ser tocado quando
      // o grupo inteiro está ausente; $4 (cep) só é não-nulo quando o grupo
      // endereço está presente, então serve de sinalizador (mesmo truque já
      // usado em horario_almoco_inicio no PATCH de Configuração).
      const { rows: tenantAtualizado } = await client.query(
        `UPDATE tenants SET
           nome = COALESCE($2, nome),
           telefone = COALESCE($3, telefone),
           whatsapp = CASE WHEN $3 IS NOT NULL AND $11 THEN $3 ELSE whatsapp END,
           endereco_cep = COALESCE($4, endereco_cep),
           endereco_logradouro = COALESCE($5, endereco_logradouro),
           endereco_numero = COALESCE($6, endereco_numero),
           endereco_complemento = CASE WHEN $4 IS NOT NULL THEN $7 ELSE endereco_complemento END,
           endereco_bairro = COALESCE($8, endereco_bairro),
           endereco_cidade = COALESCE($9, endereco_cidade),
           endereco_uf = COALESCE($10, endereco_uf)
         WHERE id = $1
         RETURNING asaas_customer_id`,
        [
          tenantId,
          nomeSegmento ?? null,
          telefone ?? null,
          enderecoValidado?.cep ?? null,
          enderecoValidado?.logradouro ?? null,
          enderecoValidado?.numero ?? null,
          enderecoValidado?.complemento ?? null,
          enderecoValidado?.bairro ?? null,
          enderecoValidado?.cidade ?? null,
          enderecoValidado?.uf ?? null,
          !!telefoneEWhatsapp,
        ]
      );
      asaasCustomerId = tenantAtualizado[0].asaas_customer_id;
      await client.query('COMMIT');
    } catch (erro) {
      await client.query('ROLLBACK');
      if (erro.code === '23505' && /whatsapp/i.test(erro.constraint || '')) {
        return reply.code(409).send({ error: 'Este número já está cadastrado como WhatsApp de outra conta.' });
      }
      throw erro;
    } finally {
      client.release();
    }

    // CA08 — mantém o Customer da Asaas sincronizado quando o tenant já tem
    // assinatura (US32). Best-effort: uma falha aqui não deve impedir o
    // perfil de ser salvo, já que os dados já estão persistidos no Kyvvo.
    // Só roda quando o grupo pessoal (nome/telefone) de fato veio nesta
    // requisição — salvar só Minha Empresa não tem nome/telefone novos pra
    // sincronizar.
    if (asaasCustomerId && grupoPessoal) {
      asaasService
        .atualizarCustomer({ customerId: asaasCustomerId, nome: nomeResponsavel, whatsapp: telefone })
        .catch((erro) => console.error(`[perfil] falha ao sincronizar customer ${asaasCustomerId} na Asaas: ${erro.message}`));
    }

    return buscarPerfil(userId);
  });

  // ---------- WhatsApp (self-service, Embedded Signup da Meta) ----------
  // appId/configId não são secretos — só inicializam o SDK do Facebook no
  // frontend, por isso não têm problema em ir numa rota GET comum.
  fastify.get('/api/whatsapp/config-publica', { preHandler: [fastify.authenticate] }, async () => {
    return {
      appId: process.env.META_APP_ID || null,
      configId: process.env.META_CONFIG_ID || null,
    };
  });

  // Chama a Graph API da Meta ao vivo com o phone_number_id do tenant (não
  // um valor fixo de ambiente — cada tenant tem o seu, ver migration 033/034)
  // usando o META_WHATSAPP_TOKEN compartilhado do Usuário do Sistema.
  fastify.get('/api/whatsapp/status', { preHandler: [fastify.authenticate] }, async (request) => {
    const { tenantId } = request.user;
    const { rows } = await pool.query('SELECT meta_phone_number_id FROM tenants WHERE id = $1', [tenantId]);
    const phoneNumberId = rows[0] && rows[0].meta_phone_number_id;
    const status = { conectado: false, phoneNumberId: phoneNumberId || null };
    if (!phoneNumberId) return status;

    const metaToken = process.env.META_WHATSAPP_TOKEN;
    if (!metaToken) {
      status.erro = 'META_WHATSAPP_TOKEN não configurado no servidor.';
      return status;
    }

    try {
      const res = await fetch(
        `https://graph.facebook.com/v22.0/${phoneNumberId}?fields=display_phone_number,verified_name,quality_rating`,
        { headers: { Authorization: `Bearer ${metaToken}` }, signal: AbortSignal.timeout(8000) }
      );
      const corpo = await res.json();
      if (res.ok) {
        status.conectado = true;
        status.numeroExibido = corpo.display_phone_number || null;
        status.nomeVerificado = corpo.verified_name || null;
        status.qualidade = corpo.quality_rating || null;
      } else {
        status.erro = (corpo.error && corpo.error.message) || `A Meta respondeu ${res.status}.`;
      }
    } catch (err) {
      status.erro = `Falha ao contatar a Meta: ${err.message}`;
    }
    return status;
  });

  // Recebe o resultado do Embedded Signup (code + waba_id + phone_number_id,
  // vindos do postMessage/callback do FB.login no frontend). Não troca por um
  // token pra guardar — o code só confirma que o signup é legítimo; quem
  // manda/recebe mensagem continua sendo o Usuário do Sistema compartilhado
  // (ver comentário em meta-whatsapp-service.js).
  fastify.post('/api/whatsapp/conectar', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenantId } = request.user;
    const { code, wabaId, phoneNumberId } = request.body || {};

    if (!code || !wabaId || !phoneNumberId) {
      return reply.code(400).send({ error: 'Dados incompletos retornados pelo WhatsApp. Tente conectar novamente.' });
    }

    try {
      await metaWhatsappService.trocarCodePorToken(code);
      await metaWhatsappService.assinarWebhooks(wabaId);
      try {
        await metaWhatsappService.registrarNumero(phoneNumberId);
      } catch (erroRegistro) {
        // Best-effort — o número pode já vir registrado dependendo da
        // configuração do Embedded Signup; não impede a conexão de ser salva.
        console.error(`[whatsapp] falha ao registrar número ${phoneNumberId} do tenant ${tenantId}: ${erroRegistro.message}`);
      }
    } catch (erro) {
      return reply.code(400).send({ error: `Não foi possível conectar o WhatsApp: ${erro.message}` });
    }

    try {
      await pool.query('UPDATE tenants SET meta_waba_id = $2, meta_phone_number_id = $3 WHERE id = $1', [
        tenantId,
        wabaId,
        phoneNumberId,
      ]);
    } catch (erro) {
      if (erro.code === '23505') {
        return reply.code(409).send({ error: 'Esse número de WhatsApp já está conectado a outra conta Kyvvo.' });
      }
      throw erro;
    }

    return { conectado: true, phoneNumberId, wabaId };
  });

  // ---------- Configuração ----------
  fastify.get('/api/configuracao', { preHandler: [fastify.authenticate] }, async (request) => {
    const { tenantId } = request.user;
    const { rows } = await pool.query(
      `SELECT dias_funcionamento, formato_hora, horario_abertura, horario_fechamento, segmento,
              horario_almoco_ativo, horario_almoco_inicio, horario_almoco_fim
       FROM tenants WHERE id = $1`,
      [tenantId]
    );
    return rows[0];
  });

  const HORARIO_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;

  fastify.patch('/api/configuracao', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenantId } = request.user;
    const {
      diasFuncionamento, formatoHora, horarioAbertura, horarioFechamento,
      horarioAlmocoAtivo, horarioAlmocoInicio, horarioAlmocoFim,
    } = request.body || {};

    if (formatoHora && !['24h', '12h'].includes(formatoHora)) {
      return reply.code(400).send({ error: 'formatoHora deve ser "24h" ou "12h"' });
    }
    if (diasFuncionamento && (!Array.isArray(diasFuncionamento) || diasFuncionamento.some((d) => d < 0 || d > 6))) {
      return reply.code(400).send({ error: 'diasFuncionamento deve ser uma lista de números de 0 a 6' });
    }
    if (horarioAbertura !== undefined && !HORARIO_REGEX.test(horarioAbertura)) {
      return reply.code(400).send({ error: 'horarioAbertura deve estar no formato HH:MM' });
    }
    if (horarioFechamento !== undefined && !HORARIO_REGEX.test(horarioFechamento)) {
      return reply.code(400).send({ error: 'horarioFechamento deve estar no formato HH:MM' });
    }
    if (horarioAlmocoInicio !== undefined && horarioAlmocoInicio !== null && !HORARIO_REGEX.test(horarioAlmocoInicio)) {
      return reply.code(400).send({ error: 'horarioAlmocoInicio deve estar no formato HH:MM' });
    }
    if (horarioAlmocoFim !== undefined && horarioAlmocoFim !== null && !HORARIO_REGEX.test(horarioAlmocoFim)) {
      return reply.code(400).send({ error: 'horarioAlmocoFim deve estar no formato HH:MM' });
    }

    // Precisa validar abertura < fechamento (e início < fim do almoço) contra
    // o valor final (existente ou novo) de cada lado — não dá pra confiar só
    // no CHECK do banco pra dar uma mensagem de erro clara em vez de estourar
    // uma exceção de SQL. Também busca dias_funcionamento sempre que
    // diasFuncionamento vier no body, pra descobrir quais dias estão sendo
    // desabilitados (ver reagendamento em cascata abaixo).
    let diasRemovidos = [];
    if (horarioAbertura !== undefined || horarioFechamento !== undefined || horarioAlmocoAtivo !== undefined
      || horarioAlmocoInicio !== undefined || horarioAlmocoFim !== undefined || diasFuncionamento !== undefined) {
      const { rows: atuais } = await pool.query(
        `SELECT dias_funcionamento, horario_abertura, horario_fechamento, horario_almoco_ativo, horario_almoco_inicio, horario_almoco_fim
         FROM tenants WHERE id = $1`,
        [tenantId]
      );
      // Normaliza pra "HH:MM" antes de comparar — o valor vindo do banco tem
      // segundos ("08:00:00") e o do request não, e comparação de string só
      // é confiável se os dois lados tiverem o mesmo formato.
      const aberturaFinal = (horarioAbertura ?? atuais[0].horario_abertura).slice(0, 5);
      const fechamentoFinal = (horarioFechamento ?? atuais[0].horario_fechamento).slice(0, 5);
      if (aberturaFinal >= fechamentoFinal) {
        return reply.code(400).send({ error: 'Horário de abertura precisa ser antes do horário de fechamento' });
      }

      const almocoAtivoFinal = horarioAlmocoAtivo ?? atuais[0].horario_almoco_ativo;
      if (almocoAtivoFinal) {
        const almocoInicioFinal = (horarioAlmocoInicio ?? atuais[0].horario_almoco_inicio ?? '').slice(0, 5);
        const almocoFimFinal = (horarioAlmocoFim ?? atuais[0].horario_almoco_fim ?? '').slice(0, 5);
        if (!almocoInicioFinal || !almocoFimFinal) {
          return reply.code(400).send({ error: 'Informe o horário de início e término do almoço.' });
        }
        if (almocoInicioFinal >= almocoFimFinal) {
          return reply.code(400).send({ error: 'Horário de início do almoço precisa ser antes do horário de término.' });
        }
      }

      if (diasFuncionamento) {
        const diasAtuais = atuais[0].dias_funcionamento || [1, 2, 3, 4, 5, 6];
        diasRemovidos = diasAtuais.filter((d) => !diasFuncionamento.includes(d));
      }
    }

    // Reagendamento em cascata (US "desabilitar dia move agendamentos"): só
    // agendamentos futuros e confirmados nos dias que estão sendo
    // desabilitados são movidos, pro mesmo horário no próximo dia que
    // continua aberto — sem checar colisão com outros agendamentos já
    // existentes nesse dia (decisão confirmada com o Bruno: comportamento
    // simples, equivalente a um reagendamento manual apressado). O usuário
    // já confirmou essa consequência num popup no frontend antes de chamar
    // esse PATCH.
    let agendamentosMovidos = 0;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      if (diasRemovidos.length > 0) {
        const { rows: futuros } = await client.query(
          `SELECT id, data_hora FROM agendamentos WHERE tenant_id = $1 AND status = 'confirmado' AND data_hora > now()`,
          [tenantId]
        );
        for (const ag of futuros) {
          if (!diasRemovidos.includes(diaDaSemanaBrasilia(ag.data_hora))) continue;
          // Soma dias inteiros em ms (seguro porque o offset de Brasília é
          // fixo, sem horário de verão — preserva o horário local) até cair
          // num dia presente no diasFuncionamento novo. Mesmo limite de 14
          // tentativas usado no equivalente do frontend (proximoDiaAberto).
          let novaData = ag.data_hora;
          let tentativas = 0;
          while (!diasFuncionamento.includes(diaDaSemanaBrasilia(novaData)) && tentativas < 14) {
            novaData = new Date(novaData.getTime() + 86400000);
            tentativas++;
          }
          await client.query('UPDATE agendamentos SET data_hora = $1 WHERE id = $2', [novaData, ag.id]);
          agendamentosMovidos++;
        }
      }

      const { rows } = await client.query(
        `UPDATE tenants SET
           dias_funcionamento = COALESCE($2, dias_funcionamento),
           formato_hora = COALESCE($3, formato_hora),
           horario_abertura = COALESCE($4, horario_abertura),
           horario_fechamento = COALESCE($5, horario_fechamento),
           horario_almoco_ativo = COALESCE($6, horario_almoco_ativo),
           horario_almoco_inicio = CASE WHEN $6 = false THEN null ELSE COALESCE($7, horario_almoco_inicio) END,
           horario_almoco_fim = CASE WHEN $6 = false THEN null ELSE COALESCE($8, horario_almoco_fim) END
         WHERE id = $1
         RETURNING dias_funcionamento, formato_hora, horario_abertura, horario_fechamento,
                   horario_almoco_ativo, horario_almoco_inicio, horario_almoco_fim`,
        [
          tenantId, diasFuncionamento ? JSON.stringify(diasFuncionamento) : null, formatoHora, horarioAbertura, horarioFechamento,
          horarioAlmocoAtivo ?? null, horarioAlmocoInicio, horarioAlmocoFim,
        ]
      );
      await client.query('COMMIT');
      return { ...rows[0], agendamentos_movidos: agendamentosMovidos };
    } catch (erro) {
      await client.query('ROLLBACK');
      throw erro;
    } finally {
      client.release();
    }
  });

  // ---------- Módulos ----------
  // CA04 — lista os módulos ativos do tenant logado (key, nome de exibição e
  // preço mensal). É o que o painel usa para montar o menu dinâmico (CA05).
  fastify.get('/api/tenant/modulos', { preHandler: [fastify.authenticate] }, async (request) => {
    const { tenantId } = request.user;
    const { rows } = await pool.query(
      `SELECT m.key, m.nome, m.preco_mensal
       FROM tenant_modulos tm
       JOIN modulos m ON m.key = tm.modulo_key
       WHERE tm.tenant_id = $1 AND tm.ativo
       ORDER BY m.nome`,
      [tenantId]
    );
    return { modulos: rows };
  });

  // ---------- Financeiro (US18) ----------
  // Livro-caixa manual simples (entrada/saída) — primeira funcionalidade real
  // do módulo "financeiro", só acessível a quem tem o módulo ativo.
  fastify.get(
    '/api/financeiro/lancamentos',
    { preHandler: [fastify.authenticate, fastify.requireModulo('financeiro')] },
    async (request) => {
      const { tenantId } = request.user;
      const mesRef = request.query.mes || mesAtualBrasilia();

      const { rows } = await pool.query(
        `SELECT id, tipo, valor, descricao, data
         FROM lancamentos_financeiros
         WHERE tenant_id = $1 AND to_char(data, 'YYYY-MM') = $2
         ORDER BY data DESC, criado_em DESC`,
        [tenantId, mesRef]
      );

      const entradas = rows.filter((r) => r.tipo === 'entrada').reduce((soma, r) => soma + Number(r.valor), 0);
      const saidas = rows.filter((r) => r.tipo === 'saida').reduce((soma, r) => soma + Number(r.valor), 0);

      return {
        mes: mesRef,
        lancamentos: rows,
        resumo: { entradas, saidas, saldo: entradas - saidas },
      };
    }
  );

  fastify.post(
    '/api/financeiro/lancamentos',
    { preHandler: [fastify.authenticate, fastify.requireModulo('financeiro')] },
    async (request, reply) => {
      const { tenantId } = request.user;
      const { tipo, valor, descricao, data } = request.body || {};

      if (!['entrada', 'saida'].includes(tipo)) {
        return reply.code(400).send({ error: 'Campo "tipo" deve ser "entrada" ou "saida"' });
      }
      if (!Number.isFinite(valor) || valor <= 0) {
        return reply.code(400).send({ error: 'Campo "valor" deve ser um número maior que zero' });
      }

      const { rows } = await pool.query(
        `INSERT INTO lancamentos_financeiros (tenant_id, tipo, valor, descricao, data)
         VALUES ($1, $2, $3, $4, COALESCE($5, current_date))
         RETURNING id, tipo, valor, descricao, data`,
        [tenantId, tipo, valor, descricao || null, data || null]
      );
      reply.code(201);
      return rows[0];
    }
  );

  // ---------- Pagamentos / Asaas (US32) ----------
  const CARTAO_FINAL_REGEX = /^\d{4}$/;
  // A Asaas exige CPF (11 dígitos) ou CNPJ (14) do Customer pra emitir
  // cobrança — descoberto só ao testar com uma chave de API real (o modo
  // dev nunca chama a API de verdade, então nunca acusaria essa exigência).
  const CPF_CNPJ_REGEX = /^\d{11}$|^\d{14}$/;

  // Monta o payload de resposta da aba de pagamentos (CA02/CA07/CA08) — usado
  // tanto pelo GET quanto pela resposta do POST /cadastrar, pra sempre
  // devolver o mesmo formato depois de qualquer mudança de estado.
  async function montarResumoPagamentos(tenant) {
    // Sem plano escolhido ainda (tenant.plano nulo ou 'trial'), o plano que
    // efetivamente será cobrado ao cadastrar pagamento é sempre o
    // PLANO_PADRAO_CHAVE (ver /api/pagamentos/cadastrar) — devolve esse valor
    // em vez de null pra US37/CA02 poder anunciar "R$ [VALOR]" antes do
    // trial acabar. CA09 (US38) — preço/nome sempre lidos do cache carregado
    // da tabela `planos` (nunca mais hardcoded em asaas-service.js).
    const planoInfo = PLANOS_CACHE[tenant.plano] || PLANOS_CACHE[PLANO_PADRAO_CHAVE] || null;
    const subscription = await asaasService.buscarSubscription(tenant.asaas_subscription_id).catch((erro) => {
      console.error(`[pagamentos] falha ao buscar subscription ${tenant.asaas_subscription_id}: ${erro.message}`);
      return null;
    });
    const historico = await asaasService.listarUltimasCobrancas(tenant.asaas_subscription_id).catch((erro) => {
      console.error(`[pagamentos] falha ao listar cobranças da subscription ${tenant.asaas_subscription_id}: ${erro.message}`);
      return [];
    });
    // trial_ativo/trial_fim (US37/CA02) — reaproveita o mesmo cálculo do
    // indicador somente leitura do admin (US31/calcularTrialTenant) pro
    // frontend anunciar a data da primeira cobrança antes do cadastro.
    const trial = calcularTrialTenant(tenant);

    return {
      status: tenant.status,
      plano: tenant.plano,
      plano_nome: planoInfo ? planoInfo.nome : null,
      valor_plano: planoInfo ? Number(planoInfo.preco_mensal) : null,
      trial_ativo: trial.trialAtivo,
      trial_fim: trial.trialFim ? trial.trialFim.slice(0, 10) : null,
      meio_pagamento: tenant.asaas_meio_pagamento,
      meio_pagamento_alterado_em: tenant.asaas_meio_pagamento_alterado_em,
      cartao_final: tenant.asaas_cartao_final,
      cpf_cnpj: tenant.cpf_cnpj,
      endereco_cep: tenant.endereco_cep,
      endereco_logradouro: tenant.endereco_logradouro,
      endereco_numero: tenant.endereco_numero,
      endereco_complemento: tenant.endereco_complemento,
      endereco_bairro: tenant.endereco_bairro,
      endereco_cidade: tenant.endereco_cidade,
      endereco_uf: tenant.endereco_uf,
      cancelado_em: tenant.cancelado_em,
      acesso_ate: tenant.acesso_ate,
      proxima_cobranca: subscription ? { data: subscription.nextDueDate, valor: subscription.value } : null,
      // `meio` (PR5) — a Asaas já devolve billingType (PIX/CREDIT_CARD) em
      // cada cobrança do histórico; não precisa de coluna nova nem de nova
      // integração, só repassar o campo que já vinha no payload bruto.
      historico: historico.map((p) => ({
        data: p.dueDate,
        valor: p.value,
        status: p.status,
        meio: p.billingType,
      })),
    };
  }

  // CA02/CA07/CA08 — estado atual da aba de pagamentos do tenant logado.
  fastify.get('/api/pagamentos', { preHandler: [fastify.authenticate] }, async (request) => {
    const { tenantId } = request.user;
    const { rows } = await pool.query(
      `SELECT plano, status, ativado_em, asaas_customer_id, asaas_subscription_id,
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
  fastify.get('/api/pagamentos/status', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenantId } = request.user;
    const { rows } = await pool.query('SELECT status, plano, ativado_em FROM tenants WHERE id = $1', [tenantId]);
    const tenant = rows[0];
    if (!tenant) {
      return reply.code(404).send({ error: 'Tenant não encontrado' });
    }

    const trial = calcularTrialTenant(tenant);
    const diasUtilizados = trial.trialDiasRestantes == null
      ? null
      : Math.min(TRIAL_DIAS, Math.max(0, TRIAL_DIAS - trial.trialDiasRestantes));
    const trialPercentual = diasUtilizados == null ? null : Math.min(100, Math.round((diasUtilizados / TRIAL_DIAS) * 100));

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
  fastify.post('/api/pagamentos/cadastrar', { preHandler: [fastify.authenticate] }, async (request, reply) => {
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
    const plano = tenant.plano && tenant.plano !== 'trial' ? tenant.plano : PLANO_PADRAO_CHAVE;
    // CA09 (US38) — preço/nome sempre lidos do cache carregado da tabela
    // `planos`, nunca hardcoded; um plano desativado (`ativo = false`) ainda
    // pode ser usado aqui (só novas assinaturas deixam de oferecê-lo na
    // seleção de plano quando essa tela existir — não é o caso hoje, já que
    // só o Profissional é contratável).
    const planoInfo = PLANOS_CACHE[plano];
    if (!planoInfo) {
      return reply.code(400).send({ error: 'Plano não configurado. Contate o suporte.' });
    }
    const billingType = meio === 'pix' ? 'PIX' : 'CREDIT_CARD';
    const cartaoFinal = meio === 'cartao' ? cartaoNumeroLimpo.slice(-4) : null;

    // Número de contato do titular (exigido na tokenização de cartão) — nem
    // todo tenant tem WhatsApp cadastrado (ex: criado pela área admin, US16),
    // mas `telefone` é obrigatório desde a US33; usa o que tiver.
    const contato = tenant.whatsapp || tenant.telefone;

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
       RETURNING plano, status, ativado_em, asaas_customer_id, asaas_subscription_id,
                 asaas_meio_pagamento, asaas_meio_pagamento_alterado_em, asaas_cartao_final, cpf_cnpj, cancelado_em, acesso_ate,
                 endereco_cep, endereco_logradouro, endereco_numero,
                 endereco_complemento, endereco_bairro, endereco_cidade, endereco_uf`,
      [
        tenantId, customer.id, subscriptionId, plano, meio, meio === 'cartao' ? cartaoFinal : null, cpfCnpjLimpo,
        endereco.cep, endereco.logradouro, endereco.numero, endereco.complemento, endereco.bairro, endereco.cidade, endereco.uf,
        novoStatus,
      ]
    );

    return montarResumoPagamentos(atualizado[0]);
  });

  // CA01/CA03/CA07 (US35) — cancela a assinatura do tenant logado. Encerra a
  // cobrança recorrente na Asaas mas mantém o acesso até o fim do período já
  // pago (`acesso_ate`, CA05). Só o próprio tenant autenticado pode cancelar
  // a própria assinatura — nunca aceita um id de tenant vindo do corpo.
  fastify.delete('/api/pagamentos/assinatura', { preHandler: [fastify.authenticate] }, async (request, reply) => {
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

    await pool.query('UPDATE tenants SET status = $2 WHERE asaas_subscription_id = $1', [subscriptionId, novoStatus]);
    return { ok: true };
  });

  // ---------- Área admin da Kyvvo (US16) ----------
  // Todas as rotas abaixo usam fastify.authenticateAdmin (JWT/tabela
  // separados dos tenants) — nunca fastify.authenticate. Servem a equipe da
  // Kyvvo, não os clientes.

  // Indicador de trial somente leitura (US31/CA02) — calculado a partir de
  // `ativado_em` (data real de ativação da conta), não de `trial_expires_at`
  // (que reflete a data de cadastro/US20 e pode divergir da ativação).
  // trial_ativo = ativado_em não nulo E ativado_em + TRIAL_DIAS dias >= hoje.
  function calcularTrialTenant(tenant) {
    if (!tenant.ativado_em) {
      return { trialAtivo: false, trialInicio: null, trialFim: null, trialDiasRestantes: null };
    }
    const inicio = new Date(tenant.ativado_em);
    const fim = new Date(inicio.getTime() + TRIAL_DIAS * 24 * 60 * 60 * 1000);
    const diasRestantes = Math.ceil((fim.getTime() - Date.now()) / (24 * 60 * 60 * 1000));
    return {
      trialAtivo: fim.getTime() >= Date.now(),
      trialInicio: inicio.toISOString(),
      trialFim: fim.toISOString(),
      trialDiasRestantes: diasRestantes,
    };
  }

  // Status de conta exibido na listagem de tenants e no detalhe (US26/US28/
  // CA02) — o estado de trial usa `calcularTrialTenant` (US31), baseada em
  // `ativado_em`, no lugar do cálculo antigo por `trial_expires_at`.
  function statusContaTenant(tenant) {
    if (!tenant.ativo) return 'Inativo';
    if (tenant.status === 'trial') {
      if (!tenant.ativado_em) return 'Não ativado';
      return calcularTrialTenant(tenant).trialAtivo ? 'Trial ativo' : 'Trial expirado';
    }
    if (tenant.status === 'ativo') return 'Ativo';
    if (tenant.status === 'suspenso') return 'Suspenso';
    return 'Inativo';
  }

  fastify.post('/admin/api/auth/login', async (request, reply) => {
    const { email, senha } = request.body || {};
    if (!email || !senha) {
      return reply.code(400).send({ error: 'E-mail e senha são obrigatórios' });
    }

    const { rows } = await pool.query(
      'SELECT id, email, senha_hash, nome FROM kyvvo_admins WHERE email = $1',
      [email.toLowerCase().trim()]
    );
    const admin = rows[0];
    if (!admin) {
      return reply.code(401).send({ error: 'E-mail ou senha inválidos' });
    }

    const senhaValida = await bcrypt.compare(senha, admin.senha_hash);
    if (!senhaValida) {
      return reply.code(401).send({ error: 'E-mail ou senha inválidos' });
    }

    const token = fastify.jwt.admin.sign({ adminId: admin.id, email: admin.email }, { expiresIn: '7d' });
    return { token, nome: admin.nome, email: admin.email };
  });

  // Colunas ordenáveis da tela de listagem de tenants (US26/CA03) — mapa
  // explícito pra nunca interpolar `order_by` direto numa query SQL.
  const TENANTS_ORDER_COLUMNS = {
    nome: 't.nome',
    cadastrado_em: 't.cadastrado_em',
    ativado_em: 't.ativado_em',
    status: 't.status',
  };

  fastify.get('/admin/api/tenants', { preHandler: [fastify.authenticateAdmin] }, async (request) => {
    const { page, limit, order_by: orderByParam, order_dir: orderDirParam } = request.query;

    // Sem paginação explícita, mantém o comportamento legado (lista completa,
    // ordenada por data de cadastro do sistema) — não muda o CRUD de tenants
    // já existente (US16/painel.html), que consome este mesmo endpoint sem
    // esses parâmetros.
    if (page === undefined && limit === undefined) {
      const { rows } = await pool.query(
        `SELECT t.id, t.nome, t.segmento, t.ativo, t.criado_em, t.cadastrado_em, t.ativado_em,
                (SELECT COUNT(*)::int FROM usuarios u WHERE u.tenant_id = t.id) AS total_usuarios
         FROM tenants t
         ORDER BY t.criado_em DESC`
      );
      return { tenants: rows };
    }

    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const offset = (pageNum - 1) * limitNum;
    const orderColumn = TENANTS_ORDER_COLUMNS[orderByParam] || TENANTS_ORDER_COLUMNS.cadastrado_em;
    const orderDir = String(orderDirParam).toLowerCase() === 'asc' ? 'ASC' : 'DESC';

    // Busca por e-mail (de qualquer usuário do tenant) ou WhatsApp — parâmetro
    // sempre bindado via $n, nunca interpolado na query (US27/CA05).
    const search = typeof request.query.search === 'string' ? request.query.search.trim() : '';
    const whereClause = search
      ? `WHERE t.whatsapp ILIKE $1
           OR EXISTS (SELECT 1 FROM usuarios u WHERE u.tenant_id = t.id AND u.email ILIKE $1)`
      : '';
    const searchParams = search ? [`%${search}%`] : [];

    const { rows: totalRows } = await pool.query(
      `SELECT COUNT(*)::int AS total FROM tenants t ${whereClause}`,
      searchParams
    );
    const total = totalRows[0].total;

    const { rows } = await pool.query(
      `SELECT t.id, t.nome, t.segmento, t.ativo, t.criado_em, t.cadastrado_em, t.ativado_em,
              t.whatsapp, t.status, t.trial_expires_at,
              resp.nome AS responsavel, resp.email AS email,
              (SELECT COUNT(*)::int FROM usuarios u WHERE u.tenant_id = t.id) AS total_usuarios
       FROM tenants t
       LEFT JOIN LATERAL (
         SELECT nome, email FROM usuarios WHERE tenant_id = t.id ORDER BY criado_em ASC LIMIT 1
       ) resp ON true
       ${whereClause}
       ORDER BY ${orderColumn} ${orderDir} NULLS LAST
       LIMIT $${searchParams.length + 1} OFFSET $${searchParams.length + 2}`,
      [...searchParams, limitNum, offset]
    );

    return {
      tenants: rows.map((t) => {
        const trial = calcularTrialTenant(t);
        return { ...t, status_conta: statusContaTenant(t), trial_ativo: trial.trialAtivo, trial_dias_restantes: trial.trialDiasRestantes };
      }),
      page: pageNum,
      limit: limitNum,
      total,
      total_paginas: Math.max(Math.ceil(total / limitNum), 1),
    };
  });

  fastify.get('/admin/api/tenants/:id', { preHandler: [fastify.authenticateAdmin] }, async (request, reply) => {
    const { id } = request.params;
    const { rows } = await pool.query('SELECT * FROM tenants WHERE id = $1', [id]);
    const tenant = rows[0];
    if (!tenant) {
      return reply.code(404).send({ error: 'Tenant não encontrado' });
    }

    const { rows: modulosAtivos } = await pool.query(
      `SELECT m.key, m.nome, m.preco_mensal
       FROM tenant_modulos tm JOIN modulos m ON m.key = tm.modulo_key
       WHERE tm.tenant_id = $1 AND tm.ativo
       ORDER BY m.nome`,
      [id]
    );
    const { rows: usuarios } = await pool.query('SELECT id, email, nome FROM usuarios WHERE tenant_id = $1 ORDER BY nome', [id]);
    // Responsável = primeiro usuário cadastrado do tenant (US28/CA03) — mesmo
    // critério (criado_em ASC) usado na listagem (US26); consulta separada
    // porque a lista `usuarios` acima é ordenada por nome (usada pelo CRUD
    // antigo do US16) e não por data de criação.
    const { rows: responsavelRows } = await pool.query(
      'SELECT nome, email FROM usuarios WHERE tenant_id = $1 ORDER BY criado_em ASC LIMIT 1',
      [id]
    );
    const responsavel = responsavelRows[0] || null;
    const { rows: contagemRows } = await pool.query(
      `SELECT
         (SELECT COUNT(*)::int FROM servicos WHERE tenant_id = $1) AS servicos,
         (SELECT COUNT(*)::int FROM profissionais WHERE tenant_id = $1) AS profissionais,
         (SELECT COUNT(*)::int FROM agendamentos WHERE tenant_id = $1) AS total_agendamentos,
         (SELECT MAX(data_hora) FROM agendamentos WHERE tenant_id = $1) AS ultimo_agendamento,
         (SELECT COUNT(*)::int FROM clientes WHERE tenant_id = $1) AS total_clientes`,
      [id]
    );

    // Indicador de trial somente leitura (US31/CA05) — todo o cálculo de
    // datas acontece aqui; o frontend só formata e exibe.
    const trial = calcularTrialTenant(tenant);

    return {
      ...tenant,
      status_conta: statusContaTenant(tenant),
      plano_atual: nomeDoPlano(tenant.plano),
      trial_ativo: trial.trialAtivo,
      trial_inicio: trial.trialInicio,
      trial_fim: trial.trialFim,
      trial_dias_restantes: trial.trialDiasRestantes,
      responsavel,
      modulos_ativos: modulosAtivos,
      usuarios,
      contagens: contagemRows[0],
    };
  });

  fastify.post('/admin/api/tenants', { preHandler: [fastify.authenticateAdmin] }, async (request, reply) => {
    const { nome, telefone, endereco, segmento, horario_abertura: horarioAbertura, horario_fechamento: horarioFechamento, usuario } =
      request.body || {};

    if (!nome || !nome.trim()) {
      return reply.code(400).send({ error: 'Campo "nome" é obrigatório' });
    }
    if (segmento !== undefined && !SEGMENTOS_VALIDOS.includes(segmento)) {
      return reply.code(400).send({ error: `segmento deve ser um de: ${SEGMENTOS_VALIDOS.join(', ')}` });
    }
    if (usuario && (!usuario.email || !usuario.senha)) {
      return reply.code(400).send({ error: 'Para criar o usuário de login junto, informe "email" e "senha" do usuário' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const { rows: tenantRows } = await client.query(
        `INSERT INTO tenants (nome, telefone, endereco, segmento, horario_abertura, horario_fechamento)
         VALUES ($1, $2, $3, COALESCE($4, 'salao_beleza'), COALESCE($5::time, '08:00'::time), COALESCE($6::time, '20:00'::time))
         RETURNING id, nome, telefone, endereco, segmento, ativo, criado_em`,
        [nome.trim(), telefone || null, endereco || null, segmento || null, horarioAbertura || null, horarioFechamento || null]
      );
      const tenant = tenantRows[0];

      // Todo tenant novo já nasce com a agenda inteligente ativa — é o
      // mínimo pra usar o portal (mesmo padrão da migration 010).
      await client.query(
        `INSERT INTO tenant_modulos (tenant_id, modulo_key, ativo) VALUES ($1, 'agenda_inteligente', true)`,
        [tenant.id]
      );

      let usuarioCriado = null;
      if (usuario) {
        const hash = await bcrypt.hash(usuario.senha, 10);
        // email_verified=true: onboarding feito pela própria equipe Kyvvo,
        // já é confiável (mesmo raciocínio do backfill da migration 021) —
        // sem isso o usuário nasceria bloqueado em /verificar.html sem nunca
        // ter recebido nenhum token (US20 só gera/envia token no cadastro
        // self-service e no reenvio).
        const { rows: usuarioRows } = await client.query(
          `INSERT INTO usuarios (tenant_id, email, senha_hash, nome, email_verified) VALUES ($1, $2, $3, $4, true) RETURNING id, email, nome`,
          [tenant.id, usuario.email.toLowerCase().trim(), hash, usuario.nome || nome.trim()]
        );
        usuarioCriado = usuarioRows[0];
      }

      await client.query('COMMIT');
      reply.code(201);
      return { ...tenant, usuario: usuarioCriado };
    } catch (erro) {
      await client.query('ROLLBACK');
      if (erro.code === '23505') {
        return reply.code(409).send({ error: 'Já existe um usuário com esse e-mail' });
      }
      throw erro;
    } finally {
      client.release();
    }
  });

  fastify.patch('/admin/api/tenants/:id', { preHandler: [fastify.authenticateAdmin] }, async (request, reply) => {
    const { id } = request.params;
    const { nome, telefone, endereco, segmento, ativo, horario_abertura: horarioAbertura, horario_fechamento: horarioFechamento } =
      request.body || {};

    if (segmento !== undefined && !SEGMENTOS_VALIDOS.includes(segmento)) {
      return reply.code(400).send({ error: `segmento deve ser um de: ${SEGMENTOS_VALIDOS.join(', ')}` });
    }

    const { rows } = await pool.query(
      `UPDATE tenants SET
         nome = COALESCE($2, nome),
         telefone = COALESCE($3, telefone),
         endereco = COALESCE($4, endereco),
         segmento = COALESCE($5, segmento),
         ativo = COALESCE($6, ativo),
         horario_abertura = COALESCE($7, horario_abertura),
         horario_fechamento = COALESCE($8, horario_fechamento)
       WHERE id = $1
       RETURNING id, nome, telefone, endereco, segmento, ativo, horario_abertura, horario_fechamento`,
      [id, nome ? nome.trim() : null, telefone, endereco, segmento, ativo, horarioAbertura, horarioFechamento]
    );
    if (!rows[0]) {
      return reply.code(404).send({ error: 'Tenant não encontrado' });
    }
    return rows[0];
  });

  // ---------- Configurações do sistema (US38) ----------
  // Preços dos planos e configurações gerais (antes hardcoded no código) —
  // editáveis por qualquer admin da Kyvvo autenticado, sem deploy. Chaves das
  // configurações gerais que este endpoint reconhece (mesmas de
  // carregarConfiguracoesSistema/migration 028) — outras chaves no corpo são
  // ignoradas silenciosamente.
  const CONFIGURACOES_SISTEMA_CHAVES = [
    'trial_dias',
    'carencia_dias_inadimplencia',
    'max_tentativas_reenvio_token',
    'email_suporte',
    'whatsapp_suporte',
  ];

  fastify.get('/admin/api/configuracoes', { preHandler: [fastify.authenticateAdmin] }, async () => {
    const { rows: planosRows } = await pool.query(
      `SELECT chave, nome, descricao, preco_mensal, limite_disparos, ativo, atualizado_em
       FROM planos ORDER BY preco_mensal ASC`
    );
    // pg devolve NUMERIC como string (evita perda de precisão) — converte pra
    // number aqui, já que o front trata preço como valor numérico.
    const planos = planosRows.map((p) => ({ ...p, preco_mensal: Number(p.preco_mensal) }));
    const { rows: sistemaRows } = await pool.query('SELECT chave, valor FROM configuracoes_sistema');
    const sistema = Object.fromEntries(sistemaRows.map((r) => [r.chave, r.valor]));
    const { rows: log } = await pool.query(
      `SELECT l.campo, l.valor_anterior, l.valor_novo, l.alterado_em, a.nome AS alterado_por_nome
       FROM log_configuracoes l
       LEFT JOIN kyvvo_admins a ON a.id = l.alterado_por
       ORDER BY l.alterado_em DESC
       LIMIT 20`
    );
    return { planos, sistema, log };
  });

  // CA03/CA05/CA09 — atualiza um plano (descrição/preço/limite/ativo). Preço
  // mínimo de R$1 (CA03), e cada campo alterado grava uma linha própria no log
  // de auditoria (CA05/CA07) na mesma transação da atualização.
  fastify.patch('/admin/api/configuracoes/planos/:chave', { preHandler: [fastify.authenticateAdmin] }, async (request, reply) => {
    const { chave } = request.params;
    const { descricao, preco_mensal: precoMensal, limite_disparos: limiteDisparos, ativo } = request.body || {};

    if (precoMensal !== undefined && !(Number(precoMensal) >= 1)) {
      return reply.code(400).send({ error: 'Preço mensal deve ser no mínimo R$ 1,00.' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows: antesRows } = await client.query('SELECT * FROM planos WHERE chave = $1 FOR UPDATE', [chave]);
      const anterior = antesRows[0];
      if (!anterior) {
        await client.query('ROLLBACK');
        return reply.code(404).send({ error: 'Plano não encontrado' });
      }

      const { rows: atualizadoRows } = await client.query(
        `UPDATE planos SET
           descricao = COALESCE($2, descricao),
           preco_mensal = COALESCE($3, preco_mensal),
           limite_disparos = COALESCE($4, limite_disparos),
           ativo = COALESCE($5, ativo),
           atualizado_em = now(),
           atualizado_por = $6
         WHERE chave = $1
         RETURNING chave, nome, descricao, preco_mensal, limite_disparos, ativo, atualizado_em`,
        [chave, descricao, precoMensal, limiteDisparos, ativo, request.admin.adminId]
      );
      const novo = atualizadoRows[0];

      const camposComparados = [
        ['descricao', anterior.descricao, novo.descricao],
        ['preco_mensal', anterior.preco_mensal, novo.preco_mensal],
        ['limite_disparos', anterior.limite_disparos, novo.limite_disparos],
        ['ativo', anterior.ativo, novo.ativo],
      ];
      for (const [campo, valorAnterior, valorNovo] of camposComparados) {
        if (String(valorAnterior) !== String(valorNovo)) {
          await client.query(
            `INSERT INTO log_configuracoes (campo, valor_anterior, valor_novo, alterado_por)
             VALUES ($1, $2, $3, $4)`,
            [`planos.${chave}.${campo}`, valorAnterior == null ? null : String(valorAnterior), valorNovo == null ? null : String(valorNovo), request.admin.adminId]
          );
        }
      }

      await client.query('COMMIT');
      await carregarPlanos();
      // pg devolve NUMERIC como string — converte antes de devolver ao front.
      return { ...novo, preco_mensal: Number(novo.preco_mensal) };
    } catch (erro) {
      await client.query('ROLLBACK');
      throw erro;
    } finally {
      client.release();
    }
  });

  // CA06/CA07/CA09 — atualiza uma ou mais configurações gerais de uma vez;
  // recarrega o cache em memória (carregarConfiguracoesSistema) logo depois
  // de persistir, pra valer no processo já rodando sem deploy/restart.
  // Chaves numéricas alimentam constantes centrais do sistema (TRIAL_DIAS
  // etc.) — um valor inválido aqui quebraria o cálculo de trial pra todo
  // mundo, então valida antes de gravar.
  const CONFIGURACOES_SISTEMA_NUMERICAS = new Set(['trial_dias', 'carencia_dias_inadimplencia', 'max_tentativas_reenvio_token']);

  fastify.patch('/admin/api/configuracoes/sistema', { preHandler: [fastify.authenticateAdmin] }, async (request, reply) => {
    const corpo = request.body || {};
    const chavesEnviadas = CONFIGURACOES_SISTEMA_CHAVES.filter((chave) => corpo[chave] !== undefined);
    if (!chavesEnviadas.length) {
      return reply.code(400).send({ error: `Envie ao menos uma configuração válida: ${CONFIGURACOES_SISTEMA_CHAVES.join(', ')}` });
    }
    for (const chave of chavesEnviadas) {
      if (CONFIGURACOES_SISTEMA_NUMERICAS.has(chave) && !(Number.isInteger(Number(corpo[chave])) && Number(corpo[chave]) > 0)) {
        return reply.code(400).send({ error: `"${chave}" deve ser um número inteiro maior que zero.` });
      }
    }
    if (corpo.email_suporte !== undefined && !EMAIL_REGEX.test(corpo.email_suporte)) {
      return reply.code(400).send({ error: 'E-mail de suporte inválido.' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const chave of chavesEnviadas) {
        const valorNovo = String(corpo[chave]);
        const { rows: antesRows } = await client.query('SELECT valor FROM configuracoes_sistema WHERE chave = $1 FOR UPDATE', [chave]);
        const valorAnterior = antesRows[0] ? antesRows[0].valor : null;
        await client.query(
          `UPDATE configuracoes_sistema SET valor = $2, atualizado_em = now(), atualizado_por = $3 WHERE chave = $1`,
          [chave, valorNovo, request.admin.adminId]
        );
        if (valorAnterior !== valorNovo) {
          await client.query(
            `INSERT INTO log_configuracoes (campo, valor_anterior, valor_novo, alterado_por) VALUES ($1, $2, $3, $4)`,
            [`sistema.${chave}`, valorAnterior, valorNovo, request.admin.adminId]
          );
        }
      }
      await client.query('COMMIT');
    } catch (erro) {
      await client.query('ROLLBACK');
      throw erro;
    } finally {
      client.release();
    }

    await carregarConfiguracoesSistema();
    const { rows: sistemaRows } = await pool.query('SELECT chave, valor FROM configuracoes_sistema');
    return Object.fromEntries(sistemaRows.map((r) => [r.chave, r.valor]));
  });

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

  // CA09 — carrega os valores configuráveis do banco antes de aceitar
  // requisições, pra nunca servir com os literais hardcoded quando já existe
  // uma configuração diferente salva.
  await carregarConfiguracoesSistema();
  await carregarPlanos();

  await fastify.listen({ port: PORT, host: '0.0.0.0' });
  console.log(`Painel Kyvvo rodando na porta ${PORT}`);
}

start().catch((err) => {
  console.error(err);
  process.exit(1);
});
