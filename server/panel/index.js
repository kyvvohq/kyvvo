// CA01/CA03 (US15) — captura de erros em produção (Sentry). Sentry precisa
// ser exigido antes de qualquer outro módulo pra instrumentar chamadas
// HTTP/DB automaticamente (guia oficial do SDK Node). Só ativa se
// SENTRY_DSN estiver configurado no ambiente — sem DSN, o painel roda
// exatamente como hoje, mesmo raciocínio de "sem credencial, recurso fica
// inerte" já usado em META_WHATSAPP_TOKEN/POSTHOG_KEY.
const Sentry = require('@sentry/node');
// CA03 — nunca manda payload de erro com senha/token/cartão em texto puro.
// Aplica recursivamente porque `event.request.data` pode aninhar o corpo da
// requisição (ex.: `usuario.senha` no POST /admin/api/tenants).
const CAMPOS_SENSIVEIS_SENTRY = /senha|password|token|jwt|authorization|cookie|cvv|numero_cartao|card_number/i;
function limparDadosSensiveisSentry(event) {
  const limpar = (obj) => {
    if (!obj || typeof obj !== 'object') return;
    for (const chave of Object.keys(obj)) {
      if (CAMPOS_SENSIVEIS_SENTRY.test(chave)) obj[chave] = '[redacted]';
      else if (obj[chave] && typeof obj[chave] === 'object') limpar(obj[chave]);
    }
  };
  if (event.request) {
    limpar(event.request.data);
    limpar(event.request.headers);
    delete event.request.cookies;
  }
  return event;
}
if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || 'development',
    sendDefaultPii: false,
    beforeSend: limparDadosSensiveisSentry,
  });
}

// trustProxy: nginx (na frente do processo) já repassa X-Forwarded-For real —
// necessário pra `request.ip` refletir o IP do cliente, não o do proxy
// interno. Usado pelo `remoteIp` exigido na tokenização de cartão (US32).
const fastify = require('fastify')({ logger: true, trustProxy: true });
// Precisa vir logo após criar a instância, antes de registrar plugins/rotas —
// é o que faz exceções não tratadas em qualquer rota chegarem no Sentry
// (CA01), sem precisar de try/catch manual espalhado pelo código.
if (process.env.SENTRY_DSN) Sentry.setupFastifyErrorHandler(fastify);
const jwt = require('@fastify/jwt');
const cors = require('@fastify/cors');
const staticPlugin = require('@fastify/static');
const path = require('path');
const fsPromises = require('fs/promises');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');
const tokenService = require('./token-service');
const asaasService = require('./asaas-service');
const metaWhatsappService = require('./meta-whatsapp-service');
const evolutionService = require('./evolution-service');
const anthropicService = require('./anthropic-service');
const { parsearIntentIA, escolherAgendamentoAlvoIA, IA_INTENTS_VALIDOS } = require('./ia-intent-parser');
// Fase 1 da modularização (ver plano "Kyvvo — modularizar server/panel/index.js")
const datetime = require('./lib/datetime');
const feriados = require('./lib/feriados');
const validadores = require('./lib/validadores');
const horarioFuncionamento = require('./lib/horario-funcionamento');
const configSistema = require('./lib/configuracoes-sistema');
const trialConta = require('./lib/trial-conta');
const planos = require('./lib/planos');
const { sincronizarLancamentoFinanceiro } = require('./lib/financeiro');
const eventos = require('./lib/eventos');
const { registerBloqueiosRoutes } = require('./routes/bloqueios');
// Fase 2 da modularização
const profissionaisLib = require('./lib/profissionais');
const { registerServicosRoutes } = require('./routes/servicos');
const { registerProfissionaisRoutes } = require('./routes/profissionais');
const { garantirProfissionalPadrao } = profissionaisLib;
// Fase 3 da modularização
const { registerAgendaRoutes } = require('./routes/agenda');
// Fase 4 da modularização
const { registerClientesRoutes } = require('./routes/clientes');
// Fase 5 da modularização
const { registerFinanceiroRoutes } = require('./routes/financeiro');
const { registerRelatoriosRoutes } = require('./routes/relatorios');
// Fase 6 da modularização
const { registerPerfilRoutes } = require('./routes/perfil');
const { registerEquipeRoutes } = require('./routes/equipe');
const { normalizarWhatsapp } = require('./lib/whatsapp');
// Fase 7 da modularização
const { registerWhatsappConfigRoutes } = require('./routes/whatsapp-config');
const { registerConfiguracaoRoutes } = require('./routes/configuracao');
// Fase 8 da modularização
const { registerPagamentosRoutes } = require('./routes/pagamentos');
// Fase 9 da modularização — montarResumoPagamentos não é mais usada direto
// em index.js (só pelas rotas admin, já extraídas).
const { registerAdminAuthRoutes } = require('./routes/admin-auth');
const { registerAdminTenantsRoutes } = require('./routes/admin-tenants');
const { registerAdminConfiguracoesRoutes } = require('./routes/admin-configuracoes');
const { registerAdminMonitoramentoRoutes } = require('./routes/admin-monitoramento');
const { registerAdminNumerosProntosRoutes } = require('./routes/admin-numeros-prontos');
const {
  horarioParaMinutos, minutosNoDia, diaDaSemanaBrasilia, componentesBrasilia,
  isoDeComponentesBrasilia, dataDiaISO, dataAtualBrasilia, mesAtualBrasilia,
} = datetime;
const { calcularPascoa, listarFeriadosNacionais, ehFeriadoNacional } = feriados;
const { EMAIL_REGEX, SENHA_REGEX, UF_VALIDAS } = validadores;
const { dentroDoHorarioFuncionamento, buscarBloqueioConflitante, empurrarProximoDiaAberto } = horarioFuncionamento;
const { calcularTrialTenant, calcularBloqueioAssinatura, statusContaTenant, BLOQUEIO_MENSAGENS } = trialConta;
const { EVENTOS_ANALYTICS_TIPOS, EVENTOS_ANALYTICS_TIPOS_FRONTEND, registrarEvento, registrarEventoTrialExpiradoUmaVez } = eventos;

// ---------- Cadastro self-service (US20) ----------
// TRIAL_DIAS/MAX_REENVIOS_HORA/CARENCIA_DIAS_INADIMPLENCIA/EMAIL_SUPORTE/
// WHATSAPP_SUPORTE viraram `configSistema.config` (lib/configuracoes-sistema.js,
// fase 1 da modularização) — editáveis em runtime via
// /admin/api/configuracoes/sistema, sem deploy.
// Cooldown entre pedidos de reenvio — não faz parte da lista de
// configurações editáveis da CA06, então continua fixo no código.
const REENVIO_COOLDOWN_SEGUNDOS = 60;
// Módulos liberados durante o trial ("plano Profissional" — CA09). Todo
// tenant novo precisa ao menos da agenda; os demais dão a experiência
// completa enquanto o trial está ativo.
const MODULOS_TRIAL = ['agenda_inteligente', 'financeiro', 'dashboards'];

// EMAIL_REGEX/SENHA_REGEX viraram lib/validadores.js (fase 1 da modularização).
// US79 — versão vigente dos documentos legais aceitos no cadastro, gravada
// junto com o consentimento (CA03). É a data de "Última atualização" exibida
// em /termos.html e /privacidade.html — atualizar aqui junto com o texto
// publicado sempre que o jurídico revisar algum dos dois documentos.
const TERMOS_VERSAO = '2026-07-22';
const PRIVACIDADE_VERSAO = '2026-07-22';
// SEGMENTOS_VALIDOS/TECNOLOGIA_VALIDA viraram constantes privadas de
// routes/admin-tenants.js (fase 9 da modularização) — únicos call sites
// eram no CRUD de tenants do admin, já extraído.

// normalizarWhatsapp virou lib/whatsapp.js (fase 6 da modularização) —
// usada por Perfil (já extraído) e por POST /api/auth/register (ainda aqui).
// normalizarTelefoneCliente virou lib/clientes.js (fase 3 da modularização)
// — usada por Agenda (já extraída) e pelo grupo Clientes (ainda aqui).

const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) throw new Error('JWT_SECRET não configurado');
// Secret separado do JWT de tenant (US16) — isolamento real entre os dois
// sistemas de autenticação, não só uma diferença de rota.
const ADMIN_JWT_SECRET = process.env.ADMIN_JWT_SECRET;
if (!ADMIN_JWT_SECRET) throw new Error('ADMIN_JWT_SECRET não configurado');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
tokenService.init(pool);
horarioFuncionamento.init(pool);
configSistema.init(pool);
planos.init(pool);
eventos.init(pool);
profissionaisLib.init(pool);

// proximaOcorrenciaRecorrencia virou função privada de routes/agenda.js
// (fase 3 da modularização) — único call site era dentro de
// POST /api/agendamentos, já extraído.

// proximaCobrancaRespeitandoTrial virou função privada de
// routes/pagamentos.js (fase 8 da modularização) — único call site era
// dentro de POST /api/pagamentos/cadastrar, já extraído.

// EVENTOS_ANALYTICS_TIPOS/EVENTOS_ANALYTICS_TIPOS_FRONTEND/registrarEvento/
// registrarEventoTrialExpiradoUmaVez viraram lib/eventos.js (fase 1 da
// modularização).

// ---------- US68 — IA Engine (motor conversacional Claude Haiku 4.5) ----------
// Substitui o fluxo de bot por menus (n8n) pra tenants com tecnologia='ia'.
// O roteador (rota /webhook/whatsapp, registrada em start()) intercepta o
// webhook da Evolution API antes do n8n: tenants 'bot' são repassados sem
// alteração (n8n continua funcionando exatamente como hoje); tenants 'ia'
// são processados por este bloco.

// IA_INTENTS_VALIDOS agora vem de ./ia-intent-parser (extraído numa
// avaliação do bot, 2026-08-19, pra poder testar parsearIntentIA/
// escolherAgendamentoAlvoIA sem subir o app inteiro).
// Mesma mensagem/critério do fluxo n8n (workflow v4, nó "Formatar lista de
// serviços"): tenant sem serviço ativo ou sem confirmar o horário de
// funcionamento (onboarding_horario_revisado) ainda não está pronto pra
// atender — resposta fixa, não deixa a IA decidir o que dizer.
const MENSAGEM_TENANT_NAO_PRONTO_IA = 'Estamos finalizando os últimos ajustes por aqui! 🛠️\n\nEm breve vamos te atender com muito carinho — tente novamente mais tarde.';
// Achado numa avaliação do bot (2026-08-19): antes, qualquer exceção não
// tratada no pipeline (Anthropic fora do ar, timeout, erro de banco) só
// era logada — o cliente nunca recebia nada de volta, parecendo que o
// salão tinha ignorado a mensagem dele. Ver uso no handler POST
// /webhook/whatsapp.
const MENSAGEM_ERRO_GENERICO_IA = 'Desculpa, tive um probleminha aqui agora. Pode mandar sua mensagem de novo em instantes? 🙏';
const IA_HISTORICO_MENSAGENS = 10;
// Depois desse intervalo sem nenhuma mensagem (de qualquer papel), a
// próxima mensagem do cliente conta como abertura de conversa nova pra fins
// de saudação — cliente que já conversou há dias e manda "oi" de novo
// também merece ser cumprimentado pelo nome, não só quem nunca falou com o
// salão (bug real: historico.length sozinho nunca zera pra quem já tem
// histórico salvo, então a saudação com nome só disparava na primeiríssima
// mensagem da vida do cliente).
const IA_GAP_NOVA_CONVERSA_MS = 2 * 60 * 60 * 1000;
const IA_DIAS_DISPONIBILIDADE = 7;
const IA_SLOTS_POR_DIA_PROFISSIONAL = 3;
const IA_DURACAO_PADRAO_MINUTOS = 30;
// Depois de aceitar uma sugestão, pula essa quantidade de minutos antes de
// procurar a próxima no mesmo dia — sem isso, os 30min de passo do loop
// sempre encontram os primeiros horários livres em sequência a partir da
// abertura (ex.: 09:00, 09:30, 10:00), o que na prática só sugere manhã.
// Com o pulo, as sugestões saem espalhadas pelo dia (manhã/tarde).
const IA_INTERVALO_ENTRE_SUGESTOES_MINUTOS = 120;

// US68/CA02 — disponibilidade real dos próximos N dias por profissional,
// calculada contra a agenda do banco (nunca hardcoded/alucinada pela IA).
// Reaproveita dentroDoHorarioFuncionamento/buscarBloqueioConflitante — mesma
// validação já usada em POST/PATCH /api/agendamentos — pra não ter dois
// critérios de "horário válido" divergentes no sistema.
async function calcularDisponibilidadeIA(tenant) {
  const { rows: profissionais } = await pool.query(
    'SELECT id, nome FROM profissionais WHERE tenant_id = $1 ORDER BY nome',
    [tenant.id]
  );
  if (!profissionais.length) return [];

  const { rows: agendamentosFuturos } = await pool.query(
    `SELECT profissional_id, data_hora FROM agendamentos
     WHERE tenant_id = $1 AND status = 'confirmado' AND data_hora > now()
       AND data_hora < now() + ($2 * interval '1 day')`,
    [tenant.id, IA_DIAS_DISPONIBILIDADE]
  );
  const ocupadosPorProfissional = new Map();
  for (const ag of agendamentosFuturos) {
    const lista = ocupadosPorProfissional.get(ag.profissional_id) || [];
    lista.push(new Date(ag.data_hora).getTime());
    ocupadosPorProfissional.set(ag.profissional_id, lista);
  }

  const aberturaMinutos = horarioParaMinutos(tenant.horario_abertura);
  const fechamentoMinutos = horarioParaMinutos(tenant.horario_fechamento);
  const resultado = [];

  for (const prof of profissionais) {
    const slots = [];
    for (let dia = 0; dia < IA_DIAS_DISPONIBILIDADE && slots.length < IA_SLOTS_POR_DIA_PROFISSIONAL * IA_DIAS_DISPONIBILIDADE; dia++) {
      const dataBase = new Date(Date.now() - OFFSET_BRASILIA_MINUTOS * 60000 + dia * 86400000);
      const dataISO = dataBase.toISOString().slice(0, 10);
      let encontradosNoDia = 0;
      for (let minutos = aberturaMinutos; minutos < fechamentoMinutos && encontradosNoDia < IA_SLOTS_POR_DIA_PROFISSIONAL; minutos += IA_DURACAO_PADRAO_MINUTOS) {
        const hh = String(Math.floor(minutos / 60)).padStart(2, '0');
        const mm = String(minutos % 60).padStart(2, '0');
        const candidatoISO = `${dataISO}T${hh}:${mm}:00-03:00`;
        const candidatoMs = new Date(candidatoISO).getTime();
        if (candidatoMs <= Date.now()) continue;
        const { valido } = dentroDoHorarioFuncionamento(tenant, candidatoISO, IA_DURACAO_PADRAO_MINUTOS);
        if (!valido) continue;
        const ocupados = ocupadosPorProfissional.get(prof.id) || [];
        if (ocupados.some((ts) => Math.abs(ts - candidatoMs) < IA_DURACAO_PADRAO_MINUTOS * 60000)) continue;
        // eslint-disable-next-line no-await-in-loop
        const bloqueio = await buscarBloqueioConflitante(tenant.id, prof.id, candidatoISO, IA_DURACAO_PADRAO_MINUTOS);
        if (bloqueio) continue;
        slots.push({ profissionalId: prof.id, profissionalNome: prof.nome, dataHoraISO: candidatoISO });
        encontradosNoDia++;
        minutos += IA_INTERVALO_ENTRE_SUGESTOES_MINUTOS;
      }
    }
    if (slots.length) resultado.push({ profissional: prof.nome, slots });
  }
  return resultado;
}

// garantirProfissionalPadrao virou lib/profissionais.js (fase 2 da
// modularização) — fica lá, não em routes/profissionais.js, porque também é
// chamada pelo IA Engine (logo abaixo) e por POST /api/agendamentos.

// Conta o total de horários livres de um dia, somando todos os profissionais
// do tenant — usado pelo card "horários livres" do Início (dashboard). Mesmo
// raciocínio de slot do calcularDisponibilidadeIA (grade de
// IA_DURACAO_PADRAO_MINUTOS em minutos, checando expediente/almoço, conflito
// com agendamento confirmado e bloqueio manual), mas pra 1 dia só, sem o
// corte artificial de IA_SLOTS_POR_DIA_PROFISSIONAL (ali é só pra caber no
// prompt da IA; aqui o número precisa ser o total real).
async function contarHorariosLivresNoDia(tenant, dataISO) {
  const { rows: profissionais } = await pool.query(
    'SELECT id FROM profissionais WHERE tenant_id = $1',
    [tenant.id]
  );
  if (!profissionais.length) return 0;

  const { rows: agendamentosDia } = await pool.query(
    `SELECT profissional_id, data_hora FROM agendamentos
     WHERE tenant_id = $1 AND status = 'confirmado'
       AND (data_hora AT TIME ZONE 'America/Sao_Paulo')::date = $2::date`,
    [tenant.id, dataISO]
  );
  const ocupadosPorProfissional = new Map();
  for (const ag of agendamentosDia) {
    const lista = ocupadosPorProfissional.get(ag.profissional_id) || [];
    lista.push(new Date(ag.data_hora).getTime());
    ocupadosPorProfissional.set(ag.profissional_id, lista);
  }

  const aberturaMinutos = horarioParaMinutos(tenant.horario_abertura);
  const fechamentoMinutos = horarioParaMinutos(tenant.horario_fechamento);
  let total = 0;
  for (const prof of profissionais) {
    for (let minutos = aberturaMinutos; minutos < fechamentoMinutos; minutos += IA_DURACAO_PADRAO_MINUTOS) {
      const hh = String(Math.floor(minutos / 60)).padStart(2, '0');
      const mm = String(minutos % 60).padStart(2, '0');
      const candidatoISO = `${dataISO}T${hh}:${mm}:00-03:00`;
      const candidatoMs = new Date(candidatoISO).getTime();
      if (candidatoMs <= Date.now()) continue;
      const { valido } = dentroDoHorarioFuncionamento(tenant, candidatoISO, IA_DURACAO_PADRAO_MINUTOS);
      if (!valido) continue;
      const ocupados = ocupadosPorProfissional.get(prof.id) || [];
      if (ocupados.some((ts) => Math.abs(ts - candidatoMs) < IA_DURACAO_PADRAO_MINUTOS * 60000)) continue;
      // eslint-disable-next-line no-await-in-loop
      const bloqueio = await buscarBloqueioConflitante(tenant.id, prof.id, candidatoISO, IA_DURACAO_PADRAO_MINUTOS);
      if (bloqueio) continue;
      total++;
    }
  }
  return total;
}

// US68/CA02 — monta o system prompt com o contexto real do tenant (serviços,
// profissionais, disponibilidade) — a IA nunca inventa preço/horário porque
// tudo que ela pode oferecer já vem pronto aqui.
// `cliente` traz nome/data_nascimento (pra saudação e o gate de aniversário)
// e `primeiraMensagem` (historico.length <= 1 em processarMensagemIA) diz se
// é a abertura da conversa, pra IA só cumprimentar pelo nome uma vez.
async function montarContextoIA(tenant, cliente, primeiraMensagem) {
  const { rows: servicos } = await pool.query(
    'SELECT nome, duracao_minutos, preco FROM servicos WHERE tenant_id = $1 AND ativo = true AND excluido_em IS NULL ORDER BY nome',
    [tenant.id]
  );
  const disponibilidade = await calcularDisponibilidadeIA(tenant);
  // Fora do plano Custom o tenant tem 1 único profissional (garantido por
  // garantirProfissionalPadrao) — nesse caso o "com quem" nunca é uma decisão
  // real do cliente, então a IA não deve perguntar nem mencionar nome de
  // profissional (pedido explícito: não aparecer no bot fora do Custom).
  const { unico: profissionalUnico } = await garantirProfissionalPadrao(tenant.id);

  // Atendimentos futuros (não só o mais próximo) — usado tanto pra IA
  // confirmar QUAL atendimento reagendar/cancelar antes de executar, quanto
  // pra perguntar se um pedido de "agendar" é um atendimento A MAIS (não
  // confundir com reagendamento do que já existe). Corrigido numa avaliação
  // do bot (2026-08-19): antes só trazia o mais próximo (LIMIT 1) — com a
  // recorrência de agendamento (Novo agendamento > Recorrência) um cliente
  // pode ter vários atendimentos confirmados ao mesmo tempo, e "o mais
  // próximo" deixava de ser necessariamente o que o cliente quis dizer.
  // Limite de 10 é só uma trava de bom senso.
  const { rows: atendimentosFuturosRows } = await pool.query(
    `SELECT a.data_hora, s.nome AS servico_nome
       FROM agendamentos a
       LEFT JOIN servicos s ON s.id = a.servico_id
      WHERE a.tenant_id = $1 AND a.cliente_id = $2 AND a.status = 'confirmado' AND a.data_hora > now()
      ORDER BY a.data_hora ASC LIMIT 10`,
    [tenant.id, cliente.id]
  );
  // Mesmo padrão de HORÁRIOS LIVRES: texto amigável + ISO exato entre
  // colchetes, pra IA copiar em "dataHoraAlvoISO" sem nunca reconstruir a
  // data sozinha.
  const textoAtendimentosFuturos = atendimentosFuturosRows.length
    ? atendimentosFuturosRows.map((a) => {
        const texto = new Date(a.data_hora).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
        return `- ${a.servico_nome || 'Atendimento'} em ${texto} [${new Date(a.data_hora).toISOString()}]`;
      }).join('\n')
    : '(nenhum)';

  const listaServicos = servicos.length
    ? servicos.map((s) => `- ${s.nome} (${s.duracao_minutos}min, R$ ${Number(s.preco).toFixed(2)})`).join('\n')
    : '(nenhum serviço cadastrado ainda)';

  // Cada slot lista o texto amigável E o ISO exato lado a lado — a IA nunca
  // reconstrói o ISO sozinha (já causou bug real: ano errado, "2024" em vez
  // do ano corrente, quando só o texto formatado era mostrado). Ela só copia
  // o valor entre colchetes. Com 1 único profissional, a lista fica achatada
  // (sem o prefixo "- Nome:") pra IA nem saber que existe uma escolha aqui.
  const listaDisponibilidade = disponibilidade.length
    ? disponibilidade.map((p) => {
        // Sem corte artificial aqui — o cálculo já limita a
        // IA_SLOTS_POR_DIA_PROFISSIONAL × IA_DIAS_DISPONIBILIDADE (21 no
        // padrão atual), então mostrar tudo cobre a janela de dias inteira em
        // vez de truncar nos primeiros ~2 dias (bug encontrado em produção).
        const horarios = p.slots.map((s) => {
          const d = new Date(s.dataHoraISO);
          const texto = d.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
          return `${texto} [${s.dataHoraISO}]`;
        }).join(', ');
        return profissionalUnico ? `- ${horarios}` : `- ${p.profissional}: ${horarios}`;
      }).join('\n')
    : '(sem horários livres nos próximos dias)';

  const agoraBrasilia = new Date(Date.now() - OFFSET_BRASILIA_MINUTOS * 60000);
  const hojeFormatado = agoraBrasilia.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' });

  return `Você é a atendente virtual do salão "${tenant.nome}", via WhatsApp. Responda em português do Brasil, de forma breve, calorosa e direta — como uma recepcionista experiente, nunca como um robô.

Hoje é ${hojeFormatado}.

DADOS DO CLIENTE:
- Nome: ${cliente.nome || '(não informado ainda)'}
- Data de nascimento: ${cliente.data_nascimento ? 'já informada' : 'não informada'}

ATENDIMENTOS FUTUROS CONFIRMADOS (cada um mostra o texto e, entre colchetes, o valor ISO exato — copie literalmente em "dataHoraAlvoISO" quando precisar identificar QUAL atendimento é; nunca invente):
${textoAtendimentosFuturos}

SERVIÇOS DISPONÍVEIS:
${listaServicos}

HORÁRIOS LIVRES (próximos ${IA_DIAS_DISPONIBILIDADE} dias — cada horário mostra o texto e, entre colchetes, o valor ISO exato que você deve copiar em "dataHoraISO"; nunca invente ou monte um ISO por conta própria):
${listaDisponibilidade}

Sua tarefa é ajudar o cliente a AGENDAR, REAGENDAR ou CANCELAR um horário, CONSULTAR informações do salão, ou registrar a DATA DE NASCIMENTO dele. Você NUNCA executa a ação diretamente — você só entende a intenção do cliente e devolve um JSON estruturado; quem executa é o sistema.

Responda SEMPRE e SOMENTE com um objeto JSON válido (sem texto antes/depois, sem markdown), no formato exato:
{"intent": "agendar" | "reagendar" | "cancelar" | "consultar" | "informar_nascimento" | "unknown" | "fallback_humano", "params": {"servicoNome": string|null, "profissionalNome": string|null, "dataHoraISO": string|null, "dataHoraAlvoISO": string|null, "dataNascimento": string|null}, "resposta": "texto natural pra enviar ao cliente"}

Regras:
- Use intent "unknown" quando a mensagem não deixar clara a intenção — nesse caso "resposta" deve pedir o esclarecimento que falta.
${primeiraMensagem ? `- Esta é a PRIMEIRA mensagem da conversa. ${cliente.nome ? `Cumprimente o cliente pelo nome (${cliente.nome.split(' ')[0]}) logo no início da resposta.` : 'O nome do cliente ainda não é conhecido — cumprimente normalmente, sem inventar um nome.'}` : '- Já é uma conversa em andamento — não repita a saudação completa de novo, vá direto ao ponto.'}
- Se o cliente pedir pra REAGENDAR ou CANCELAR:
  - Se ATENDIMENTOS FUTUROS CONFIRMADOS tiver só 1: apresente esse atendimento (serviço, data e hora) e pergunte se é esse mesmo — use intent "unknown" nessa pergunta. SÓ USE intent "reagendar"/"cancelar" depois que o cliente confirmar explicitamente (ex.: "sim", "isso mesmo").
  - Se tiver MAIS DE 1: liste todos (data e serviço de cada) e pergunte qual deles o cliente quer — use intent "unknown" nessa pergunta. SÓ USE intent "reagendar"/"cancelar" depois que o cliente identificar claramente qual (por data, dia da semana ou serviço), e inclua o ISO exato desse atendimento (copiado literalmente da lista) em "dataHoraAlvoISO".
  - Se não tiver nenhum: não há o que reagendar/cancelar — avise o cliente (intent "unknown").
- Se o cliente pedir pra AGENDAR algo novo e já houver pelo menos 1 em ATENDIMENTOS FUTUROS CONFIRMADOS, pergunte primeiro se é um atendimento A MAIS além do(s) que já existe(m) (não assuma que é reagendamento) — use intent "unknown" nessa pergunta, e só depois de confirmado siga coletando serviço/data/hora normalmente.
${profissionalUnico
  ? '- Use intent "agendar"/"reagendar" SÓ quando já tiver serviço e data/hora confirmados pelo cliente na conversa — antes disso, pergunte o que falta usando intent "unknown". Este salão tem só 1 profissional: NUNCA pergunte "com quem" nem mencione nome de profissional, deixe "profissionalNome" sempre null.'
  : '- Use intent "agendar"/"reagendar" SÓ quando já tiver serviço, profissional (ou "qualquer um") e data/hora confirmados pelo cliente na conversa — antes disso, pergunte o que falta usando intent "unknown".'}
- "dataHoraISO" deve ser exatamente um dos valores entre colchetes [ ] listados acima em HORÁRIOS LIVRES — copie o texto entre colchetes literalmente, nunca monte ou invente um ISO novo.
- "dataHoraAlvoISO" só é necessário quando há MAIS DE 1 atendimento em ATENDIMENTOS FUTUROS CONFIRMADOS e o cliente está reagendando/cancelando um deles — copie o ISO exato entre colchetes daquela lista, nunca invente. Deixe null nos outros casos (só 1 atendimento confirmado, nenhum, ou intent diferente de "reagendar"/"cancelar").
${cliente.data_nascimento ? '' : `- IMPORTANTE — antes de usar intent "agendar" ou "reagendar" de verdade (com tudo já confirmado pelo cliente), se você ainda não perguntou a data de nascimento nesta conversa, pergunte primeiro (use intent "unknown"): deixe bem claro que é totalmente opcional, só pra cadastro, sem nenhum problema se ele não quiser informar. Se o cliente informar uma data, use intent "informar_nascimento" com "dataNascimento" no formato AAAA-MM-DD (calcule o ano a partir do que o cliente disser, usando o ano atual como referência quando ele não disser o ano). Se o cliente disser que prefere não informar (ou já tiver respondido isso antes nesta conversa, mesmo que só "não"), prossiga normalmente com intent "agendar"/"reagendar" sem perguntar de novo.`}
- Use intent "cancelar" quando o cliente quiser cancelar um agendamento existente (não precisa de dataHoraISO nesse caso, e não precisa perguntar data de nascimento pra cancelar).
- Use intent "fallback_humano" quando o cliente pedir explicitamente para falar com uma pessoa, reclamar de forma que a IA não deva resolver sozinha, ou quando a conversa estiver claramente travada após tentativas de esclarecimento.
- "resposta" é sempre em linguagem natural, nunca contém JSON nem menciona "intent"/"params".`;
}

// US68/CA05 — histórico persistido por tenant+cliente; carregado a cada
// mensagem nova pra dar contexto de conversa à IA (sem estado em memória).
async function buscarHistoricoIA(tenantId, clienteId) {
  const { rows } = await pool.query(
    `SELECT role, conteudo FROM conversas_ia
     WHERE tenant_id = $1 AND cliente_id = $2
     ORDER BY criado_em DESC LIMIT $3`,
    [tenantId, clienteId, IA_HISTORICO_MENSAGENS]
  );
  return rows.reverse().map((r) => ({ role: r.role, content: r.conteudo }));
}

// US68 dashboard de consumo — tokensEntrada/tokensSaida só fazem sentido pra
// role='assistant' (a única que chama a Anthropic API); ficam null nos
// outros casos, que é o default da coluna.
async function salvarMensagemIA(tenantId, clienteId, role, conteudo, intent = null, tokensEntrada = null, tokensSaida = null) {
  await pool.query(
    'INSERT INTO conversas_ia (tenant_id, cliente_id, role, conteudo, intent, tokens_entrada, tokens_saida) VALUES ($1, $2, $3, $4, $5, $6, $7)',
    [tenantId, clienteId, role, conteudo, intent, tokensEntrada, tokensSaida]
  );
}

// parsearIntentIA/escolherAgendamentoAlvoIA agora vêm de
// ./ia-intent-parser (extraído numa avaliação do bot, 2026-08-19) — ver
// esse arquivo pro raciocínio completo de cada um.

// US68/CA04 — executor de ação: só roda depois do parser validar o JSON.
// Resolve nomes (serviço/profissional) recebidos em texto livre da IA pros
// IDs reais do tenant; nunca deleta agendamento, só troca status (mesmo
// padrão já usado no resto do sistema, ex. DELETE /api/agendamentos).
// Recebe o tenant inteiro (não só tenantId) — precisa validar horário de
// funcionamento antes de agendar (ver abaixo), achado numa avaliação do bot.
async function executarAcaoIA({ intent, params, tenant, clienteId }) {
  const tenantId = tenant.id;

  if (intent === 'agendar' || intent === 'reagendar') {
    if (!params.dataHoraISO) throw new Error('HorarioNaoInformado');
    const { rows: servicoRows } = params.servicoNome
      ? await pool.query('SELECT id, nome, preco, duracao_minutos FROM servicos WHERE tenant_id = $1 AND ativo = true AND nome ILIKE $2 LIMIT 1', [tenantId, `%${params.servicoNome}%`])
      : { rows: [] };
    const servico = servicoRows[0] || null;
    const { rows: profRows } = params.profissionalNome
      ? await pool.query('SELECT id, nome FROM profissionais WHERE tenant_id = $1 AND nome ILIKE $2 LIMIT 1', [tenantId, `%${params.profissionalNome}%`])
      : { rows: [] };
    let profissional = profRows[0] || null;
    if (!profissional) {
      const { rows: qualquer } = await pool.query('SELECT id, nome FROM profissionais WHERE tenant_id = $1 ORDER BY nome LIMIT 1', [tenantId]);
      profissional = qualquer[0] || null;
    }
    if (!profissional) throw new Error('SemProfissionalDisponivel');

    const duracao = servico ? servico.duracao_minutos : IA_DURACAO_PADRAO_MINUTOS;

    // Defesa em profundidade (achado numa avaliação do bot, 2026-08-19): o
    // prompt já instrui a IA a só copiar horários de HORÁRIOS LIVRES (que já
    // respeitam expediente/dias abertos/almoço), mas uma decisão de negócio
    // nunca pode depender só da palavra do modelo — mesma validação que
    // POST/PATCH /api/agendamentos sempre fizeram, e que este caminho nunca
    // tinha feito.
    const validacaoHorario = dentroDoHorarioFuncionamento(tenant, params.dataHoraISO, duracao);
    if (!validacaoHorario.valido) throw new Error('HorarioForaDoFuncionamento');

    const bloqueioConflitante = await buscarBloqueioConflitante(tenantId, profissional.id, params.dataHoraISO, duracao);
    if (bloqueioConflitante) throw new Error('HorarioIndisponivel');

    // Bug corrigido numa avaliação do bot (2026-08-19): antes comparava a
    // duração do agendamento NOVO ($4, correta) contra uma duração FIXA de
    // 30min pro agendamento JÁ EXISTENTE (interpolada direto no SQL) — um
    // serviço mais longo (ex.: Coloração, 90min) só "ocupava" 30min aos
    // olhos da IA, permitindo encaixar outro cliente no meio de um
    // atendimento em andamento. LEFT JOIN (não INNER) + COALESCE: um
    // agendamento sem serviço vinculado (servico_id null, possível neste
    // mesmo fluxo, linha do INSERT abaixo) cai no padrão de 30min em vez de
    // sumir da checagem de conflito inteira.
    const { rows: conflito } = await pool.query(
      `SELECT a.id
         FROM agendamentos a
         LEFT JOIN servicos s ON s.id = a.servico_id
        WHERE a.tenant_id = $1 AND a.profissional_id = $2 AND a.status = 'confirmado'
          AND a.data_hora < $3::timestamptz + ($4 * interval '1 minute')
          AND $3::timestamptz < a.data_hora + (COALESCE(s.duracao_minutos, $5) * interval '1 minute')`,
      [tenantId, profissional.id, params.dataHoraISO, duracao, IA_DURACAO_PADRAO_MINUTOS]
    );
    if (conflito.length) throw new Error('HorarioIndisponivel');

    // US64 (mesmo padrão de POST/PATCH /api/agendamentos) — o agendamento e o
    // lançamento financeiro precisam nascer/atualizar juntos, atomicamente.
    // Sem isso, agendamentos criados pela IA nunca apareciam em
    // /api/financeiro/resumo (que soma lancamentos_financeiros, não
    // agendamentos direto) — bug relatado em produção.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      if (intent === 'reagendar') {
        const { rows: candidatos } = await client.query(
          `SELECT a.id, s.nome AS servico_nome, s.preco AS servico_preco, a.data_hora
             FROM agendamentos a
             LEFT JOIN servicos s ON s.id = a.servico_id
            WHERE a.tenant_id = $1 AND a.cliente_id = $2 AND a.status = 'confirmado' AND a.data_hora > now()
            ORDER BY a.data_hora ASC`,
          [tenantId, clienteId]
        );
        const existente = escolherAgendamentoAlvoIA(candidatos, params.dataHoraAlvoISO);
        if (existente) {
          await client.query('UPDATE agendamentos SET data_hora = $1, profissional_id = $2, updated_at = now() WHERE id = $3', [params.dataHoraISO, profissional.id, existente.id]);
          await sincronizarLancamentoFinanceiro(client, {
            tenantId,
            agendamentoId: existente.id,
            servicoNome: existente.servico_nome,
            servicoPreco: existente.servico_preco,
            dataHora: params.dataHoraISO,
            statusAgendamento: 'confirmado',
          });
          await client.query('COMMIT');
          return { ok: true, agendamentoId: existente.id };
        }
        // candidatos.length === 0: nenhum atendimento existente pra
        // reagendar — segue pro INSERT abaixo, mesmo comportamento de
        // "agendar" (já era assim antes desta revisão).
      }

      const { rows: novo } = await client.query(
        `INSERT INTO agendamentos (tenant_id, cliente_id, profissional_id, servico_id, data_hora, status, origem)
         VALUES ($1, $2, $3, $4, $5, 'confirmado', 'whatsapp')
         RETURNING id`,
        [tenantId, clienteId, profissional.id, servico ? servico.id : null, params.dataHoraISO]
      );
      await sincronizarLancamentoFinanceiro(client, {
        tenantId,
        agendamentoId: novo[0].id,
        servicoNome: servico ? servico.nome : null,
        servicoPreco: servico ? servico.preco : null,
        dataHora: params.dataHoraISO,
        statusAgendamento: 'confirmado',
      });
      await client.query('COMMIT');
      return { ok: true, agendamentoId: novo[0].id };
    } catch (erro) {
      await client.query('ROLLBACK');
      throw erro;
    } finally {
      client.release();
    }
  }

  if (intent === 'cancelar') {
    const { rows: candidatos } = await pool.query(
      `SELECT a.id, a.data_hora, s.nome AS servico_nome, s.preco AS servico_preco
         FROM agendamentos a
         LEFT JOIN servicos s ON s.id = a.servico_id
        WHERE a.tenant_id = $1 AND a.cliente_id = $2 AND a.status = 'confirmado' AND a.data_hora > now()
        ORDER BY a.data_hora ASC`,
      [tenantId, clienteId]
    );
    if (!candidatos.length) throw new Error('NenhumAgendamentoParaCancelar');
    const existente = escolherAgendamentoAlvoIA(candidatos, params.dataHoraAlvoISO);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("UPDATE agendamentos SET status = 'cancelado', updated_at = now() WHERE id = $1", [existente.id]);
      // Sincroniza o lançamento pra 'cancelado' (sai da soma de previsto/
      // realizado) — mesmo padrão de PATCH /api/agendamentos ao cancelar.
      await sincronizarLancamentoFinanceiro(client, {
        tenantId,
        agendamentoId: existente.id,
        servicoNome: existente.servico_nome,
        servicoPreco: existente.servico_preco,
        dataHora: existente.data_hora,
        statusAgendamento: 'cancelado',
      });
      await client.query('COMMIT');
      return { ok: true, agendamentoId: existente.id };
    } catch (erro) {
      await client.query('ROLLBACK');
      throw erro;
    } finally {
      client.release();
    }
  }

  // Data de nascimento é opcional e de baixo risco — nunca lança erro pro
  // cliente ver; data ausente/mal formatada (a IA "inventou" algo fora do
  // padrão AAAA-MM-DD) só fica sem salvar, silenciosamente.
  if (intent === 'informar_nascimento') {
    if (params.dataNascimento && /^\d{4}-\d{2}-\d{2}$/.test(params.dataNascimento)) {
      await pool.query('UPDATE clientes SET data_nascimento = $1 WHERE id = $2', [params.dataNascimento, clienteId]);
    } else {
      fastify.log.warn({ params }, 'Executor de ação IA — dataNascimento ausente/inválida em informar_nascimento');
    }
    return { ok: true };
  }

  // 'consultar', 'unknown' e 'fallback_humano' não têm efeito no banco —
  // a resposta da IA já é suficiente (ou o handler de fallback, à parte).
  return { ok: true };
}

// US68/CA06 — fallback humano: marca a conversa e notifica o salão via
// WhatsApp (número do responsável já cadastrado em tenants.telefone).
// `enviarResposta` é o mesmo canal (Meta Cloud API ou Evolution API,
// conforme o webhook que originou a mensagem) usado pra responder o
// cliente — reaproveitado aqui pra notificar o salão. Nunca lança — uma
// falha aqui não pode derrubar a resposta já dada ao cliente.
async function acionarFallbackHumanoIA(tenant, cliente, enviarResposta) {
  await pool.query("UPDATE clientes SET status_conversa = 'aguardando_humano' WHERE id = $1", [cliente.id]);
  if (!tenant.telefone) return;
  try {
    await enviarResposta(
      tenant.telefone,
      `⚠️ Atendimento assumido pela IA precisa da sua ajuda.\nCliente: ${cliente.nome || cliente.telefone}\nEntre em contato direto pelo WhatsApp do salão pra continuar o atendimento.`
    );
  } catch (erro) {
    fastify.log.error({ erro: erro.message, tenantId: tenant.id }, 'Falha ao notificar salão sobre fallback humano (US68.6)');
  }
}

// US68 — orquestra uma mensagem recebida de um tenant com tecnologia='ia':
// busca/cria o cliente, monta contexto+histórico, chama Claude, valida a
// intenção, executa a ação (com fallback textual se der conflito) e persiste
// a conversa. Sempre responde algo ao cliente — mesmo em erro.
// `enviarResposta(numeroDestino, texto)` abstrai o canal de envio (Meta Cloud
// API ou Evolution API) — quem decide qual usar é o roteador, conforme o
// formato do webhook recebido; a lógica da IA em si é a mesma pros dois.
async function processarMensagemIA({ tenant, telefone, mensagem, pushName, enviarResposta }) {
  // Antes de qualquer coisa (nem resolve/cria o cliente ainda): tenant sem
  // horário confirmado ou sem serviço ativo não está pronto pra atender de
  // verdade — corta aqui em vez de deixar a IA seguir com dado incompleto/
  // padrão (montarContextoIA só avisava "(nenhum serviço cadastrado ainda)"
  // no prompt e a resposta ficava ao critério da IA, sem garantia nenhuma).
  if (!tenant.onboarding_horario_revisado) {
    await enviarResposta(telefone, MENSAGEM_TENANT_NAO_PRONTO_IA);
    return;
  }
  const { rows: servicosAtivos } = await pool.query(
    'SELECT 1 FROM servicos WHERE tenant_id = $1 AND ativo = true AND excluido_em IS NULL LIMIT 1',
    [tenant.id]
  );
  if (servicosAtivos.length === 0) {
    await enviarResposta(telefone, MENSAGEM_TENANT_NAO_PRONTO_IA);
    return;
  }

  let { rows: clienteRows } = await pool.query(
    'SELECT id, nome, status_conversa, data_nascimento, excluido_em FROM clientes WHERE tenant_id = $1 AND telefone = $2 LIMIT 1',
    [tenant.id, telefone]
  );
  let cliente = clienteRows[0];
  if (!cliente) {
    const { rows: criado } = await pool.query(
      'INSERT INTO clientes (tenant_id, nome, telefone) VALUES ($1, $2, $3) RETURNING id, nome, status_conversa, data_nascimento, excluido_em',
      [tenant.id, pushName || null, telefone]
    );
    cliente = criado[0];
  } else if (cliente.excluido_em) {
    // Cliente que tinha sido excluído (soft delete, menu Clientes) e volta a
    // mandar mensagem reaparece na listagem — mesma lógica do ON CONFLICT em
    // POST /api/agendamentos.
    await pool.query('UPDATE clientes SET excluido_em = NULL WHERE id = $1', [cliente.id]);
  }

  // US68/CA06 — não processa via IA enquanto aguarda retomada humana.
  if (cliente.status_conversa === 'aguardando_humano') return;

  // Calculado ANTES de salvar a mensagem atual — senão a mensagem atual
  // viraria "a última", e o intervalo seria sempre zero.
  const { rows: ultimaMensagemRows } = await pool.query(
    'SELECT criado_em FROM conversas_ia WHERE tenant_id = $1 AND cliente_id = $2 ORDER BY criado_em DESC LIMIT 1',
    [tenant.id, cliente.id]
  );
  const gapDesdeUltimaMensagemMs = ultimaMensagemRows[0]
    ? Date.now() - new Date(ultimaMensagemRows[0].criado_em).getTime()
    : Infinity;
  const primeiraMensagem = gapDesdeUltimaMensagemMs > IA_GAP_NOVA_CONVERSA_MS;

  await salvarMensagemIA(tenant.id, cliente.id, 'user', mensagem);

  const historico = await buscarHistoricoIA(tenant.id, cliente.id);
  const system = await montarContextoIA(tenant, cliente, primeiraMensagem);
  const { texto: respostaBruta, tokensEntrada, tokensSaida } = await anthropicService.chamarClaude({ system, mensagens: [...historico, { role: 'user', content: mensagem }] });
  const { intent, params, resposta } = parsearIntentIA(respostaBruta, { log: (obj, msg) => fastify.log.warn(obj, msg) });

  let textoFinal = resposta;
  if (intent === 'fallback_humano') {
    await acionarFallbackHumanoIA(tenant, cliente, enviarResposta);
  } else if (intent === 'agendar' || intent === 'reagendar' || intent === 'cancelar' || intent === 'informar_nascimento') {
    try {
      await executarAcaoIA({ intent, params, tenant, clienteId: cliente.id });
    } catch (erro) {
      const mensagensErro = {
        HorarioIndisponivel: 'Poxa, esse horário acabou de ficar indisponível. Pode escolher outro dos que te passei?',
        HorarioNaoInformado: 'Não peguei direito o horário — pode me dizer de novo, por favor?',
        // Achado numa avaliação do bot (2026-08-19): antes não existia essa
        // validação (só a instrução no prompt) — ver executarAcaoIA.
        HorarioForaDoFuncionamento: 'Esse horário ficou fora do nosso expediente. Pode escolher um dos horários que te passei certinho?',
        SemProfissionalDisponivel: 'No momento não temos profissional disponível pra esse atendimento. Posso te ajudar de outra forma?',
        NenhumAgendamentoParaCancelar: 'Não encontrei nenhum agendamento seu pra cancelar. Confere pra mim o que você gostaria?',
        // Achado numa avaliação do bot (2026-08-19): cliente com mais de 1
        // atendimento confirmado (possível com a recorrência de
        // agendamento) e a IA não conseguiu identificar qual — ver
        // escolherAgendamentoAlvoIA.
        AgendamentoAmbiguo: 'Vi que você tem mais de um agendamento marcado — pode me dizer a data ou o serviço de qual você quer, pra eu ter certeza?',
      };
      textoFinal = mensagensErro[erro.message] || 'Tive um problema pra confirmar isso agora. Pode tentar de novo em instantes?';
      if (!mensagensErro[erro.message]) {
        fastify.log.warn({ erro: erro.message, intent, params, tenantId: tenant.id }, 'Executor de ação IA (US68.5) falhou com erro não mapeado');
      }
    }
  }

  // Salva o turno do assistente sempre no MESMO formato JSON que o system
  // prompt exige da IA — nunca o texto final em linguagem natural. Motivo:
  // esse histórico é replayed de volta pra Claude nas próximas mensagens
  // (buscarHistoricoIA); se salvássemos texto puro aqui, a IA veria seus
  // próprios turnos passados em linguagem natural e passaria a imitar esse
  // padrão nas respostas seguintes, ignorando a instrução de responder só em
  // JSON — foi exatamente esse loop que causou a IA "esquecer" o formato
  // depois do primeiro turno em produção.
  await salvarMensagemIA(tenant.id, cliente.id, 'assistant', JSON.stringify({ intent, params, resposta: textoFinal }), intent, tokensEntrada, tokensSaida);

  try {
    await enviarResposta(telefone, textoFinal);
  } catch (erro) {
    // Falha no envio (ex.: token expirado, instância desconectada) não pode
    // apagar o que já foi persistido (agendamento criado, conversa salva) —
    // só loga.
    fastify.log.error({ erro: erro.message, tenantId: tenant.id }, 'Falha ao enviar resposta da IA (US68)');
  }
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
    // Permite acessar /painel em vez de /painel.html (URLs limpas no portal
    // do tenant) — o `send` por trás do @fastify/static tenta essa extensão
    // quando o caminho exato não bate com nenhum arquivo. Não quebra links
    // antigos com `.html`: continuam resolvendo normalmente também.
    extensions: ['html'],
  });

  // Página de detalhe do tenant (US28/CA01) — rota dinâmica que o
  // @fastify/static não resolve sozinho, já que não existe um arquivo físico
  // `/admin/tenants/<id>.html`. Autenticação é feita do mesmo jeito das
  // outras páginas admin: client-side (token no localStorage) + servidor via
  // a API JSON que a página consome.
  fastify.get('/admin/tenants/:id', async (request, reply) => {
    return reply.type('text/html').sendFile('admin/tenant-detalhe.html');
  });

  // Roteamento client-side do portal do tenant (SPA) — cada seção do menu
  // ganha URL própria (favoritar/compartilhar/recarregar direto numa seção,
  // botão voltar funcionando entre elas). Antes só /painel existia; clicar
  // em qualquer item do menu não mudava a URL. O HTML servido é sempre o
  // mesmo painel.html — app.js lê o path no carregamento e decide qual
  // seção mostrar (ver ROTAS_MENU/menuDoCaminho em app.js). Mantém o mesmo
  // padrão do /admin/tenants/:id acima: sem arquivo físico, sem auth aqui
  // (client-side, igual todo o resto do painel).
  const ROTAS_PAINEL_TENANT = [
    '/agenda', '/servicos', '/profissionais', '/clientes', '/bloqueios',
    '/whatsapp', '/cobranca', '/perfil', '/empresa', '/equipe',
    '/preferencias', '/ajuda',
  ];
  for (const rota of ROTAS_PAINEL_TENANT) {
    fastify.get(rota, async (request, reply) => reply.type('text/html').sendFile('painel.html'));
  }
  // Módulos (Financeiro hoje, outros a caminho — agenda_inteligente,
  // campanhas_proativas, comissao, dashboards, estoque) — uma rota dinâmica
  // só, em vez de registrar uma por módulo.
  fastify.get('/modulo/:chave', async (request, reply) => reply.type('text/html').sendFile('painel.html'));

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

  // US52/CA03 — acessíveis mesmo com trial vencido e sem assinatura ativa:
  // só o necessário pra regularizar a conta (sair, ver o próprio status/
  // perfil básico, consultar e cadastrar meio de pagamento, e o endpoint de
  // analytics que a própria tela de bloqueio usa). Todo o resto (agenda,
  // clientes, serviços, configuração...) fica bloqueado até reativar.
  const ROTAS_LIVRES_SEM_ASSINATURA = new Set([
    'POST /api/auth/logout',
    'GET /api/tenant/status',
    'GET /api/perfil',
    'GET /api/pagamentos',
    'GET /api/pagamentos/status',
    'POST /api/pagamentos/cadastrar',
    'POST /api/eventos',
  ]);

  fastify.decorate('authenticate', async (request, reply) => {
    try {
      await request.jwtVerify();
    } catch (err) {
      return reply.code(401).send({ error: 'Não autenticado' });
    }

    const { rows } = await pool.query(
      `SELECT u.token_version, u.email_verified, u.role, u.ativo,
              t.status AS tenant_status, t.ativado_em, t.status_alterado_em, t.acesso_ate
       FROM usuarios u JOIN tenants t ON t.id = u.tenant_id
       WHERE u.id = $1`,
      [request.user.userId]
    );
    const usuario = rows[0];
    if (!usuario || usuario.token_version !== request.user.tokenVersion) {
      return reply.code(401).send({ error: 'Sessão expirada. Faça login novamente.' });
    }
    // US62 — membro desativado pelo administrador da equipe perde acesso na
    // próxima requisição, mesmo com um JWT ainda válido (mesmo espírito do
    // token_version acima, só que pra "conta inteira desligada" em vez de
    // "essa sessão específica").
    if (!usuario.ativo) {
      return reply.code(401).send({ error: 'Acesso desativado. Fale com o administrador da sua equipe.' });
    }
    // Sempre a fonte de verdade do banco, nunca um claim do JWT — uma
    // mudança de perfil feita pelo administrador vale já na próxima
    // requisição, sem esperar o membro deslogar e logar de novo.
    request.user.role = usuario.role;

    const rotaAtual = `${request.method} ${request.routeOptions.url}`;
    if (!usuario.email_verified) {
      if (!ROTAS_LIVRES_SEM_VERIFICACAO.has(rotaAtual)) {
        return reply.code(403).send({ error: 'Confirme seu cadastro para continuar. Verifique seu e-mail ou WhatsApp.' });
      }
      return;
    }

    // US52/CA01-CA07 + bloqueio por inadimplência/suspensão/cancelamento
    // vencido (calcularBloqueioAssinatura, mesma fonte de verdade usada em
    // GET /api/tenant/status e na Cobrança): bloqueia módulos operacionais,
    // mantém acesso à regularização. Só avaliado depois da verificação de
    // e-mail acima — um tenant recém-cadastrado (ativado_em ainda nulo)
    // sempre bate em `!trialAtivo`, mas nesse caso email_verified também é
    // false e o early return acima já resolveu a rota.
    const bloqueioMotivo = calcularBloqueioAssinatura({
      status: usuario.tenant_status,
      ativado_em: usuario.ativado_em,
      status_alterado_em: usuario.status_alterado_em,
      acesso_ate: usuario.acesso_ate,
    });
    if (bloqueioMotivo && !ROTAS_LIVRES_SEM_ASSINATURA.has(rotaAtual)) {
      if (bloqueioMotivo === 'trial_expirado') {
        await registrarEventoTrialExpiradoUmaVez(request.user.tenantId);
      }
      return reply.code(403).send({
        error: BLOQUEIO_MENSAGENS[bloqueioMotivo],
        bloqueio: bloqueioMotivo,
      });
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

  // Versão do backend atualmente rodando (US66) — lê version.json gravado
  // pelo próprio workflow de deploy (commit + horário), fora de public/ pra
  // não virar arquivo estático público. Comparado no front com
  // window.KYVVO_FRONT_VERSION (admin/version.js) pra detectar quando o
  // navegador está com JS em cache desatualizado em relação ao backend.
  fastify.get('/admin/api/versao', { preHandler: [fastify.authenticateAdmin] }, async () => {
    try {
      const conteudo = await fsPromises.readFile(path.join(__dirname, 'version.json'), 'utf8');
      return JSON.parse(conteudo);
    } catch {
      return { commit: null, deployedAt: null };
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

  // US62 — restringe rotas ao perfil administrador (gestão de equipe,
  // cobrança/financeiro, configurações do negócio). Encadear sempre depois
  // de fastify.authenticate, que já resolve request.user.role a partir do
  // banco (nunca do JWT).
  fastify.decorate('requireAdmin', async (request, reply) => {
    if (request.user.role !== 'administrador') {
      return reply.code(403).send({ error: 'Ação restrita ao administrador da conta.' });
    }
  });

  // ---------- Auth ----------
  fastify.post('/api/auth/login', async (request, reply) => {
    const { email, senha } = request.body || {};
    if (!email || !senha) {
      return reply.code(400).send({ error: 'E-mail e senha são obrigatórios' });
    }

    const { rows } = await pool.query(
      `SELECT u.id, u.tenant_id, u.email, u.senha_hash, u.nome, u.token_version, u.email_verified,
              u.role, u.ativo AS usuario_ativo, t.ativo AS tenant_ativo
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
    // US62 — membro desativado pelo administrador da equipe (distinto do
    // tenant inteiro desativado pela Kyvvo acima).
    if (!usuario.usuario_ativo) {
      return reply.code(403).send({ error: 'Acesso desativado. Fale com o administrador da sua equipe.' });
    }

    const token = fastify.jwt.sign(
      { userId: usuario.id, tenantId: usuario.tenant_id, email: usuario.email, tokenVersion: usuario.token_version },
      { expiresIn: '7d' }
    );

    // email_verified informa ao front se deve redirecionar pra tela de
    // validação (CA10) em vez de entrar direto no portal. role (US62)
    // informa se mostra itens de menu restritos ao administrador.
    return { token, nome: usuario.nome, email: usuario.email, email_verified: usuario.email_verified, role: usuario.role };
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

  // ---------- Recuperação de senha (US54) ----------
  // Solicita o código de recuperação por e-mail. Sem preHandler: quem
  // esqueceu a senha não tem sessão. Resposta sempre genérica (CA02): não
  // revela se o e-mail existe, senão o endpoint vira um jeito de enumerar
  // contas cadastradas.
  fastify.post('/api/auth/esqueci-senha', async (request, reply) => {
    const email = ((request.body || {}).email || '').toLowerCase().trim();
    if (!EMAIL_REGEX.test(email)) {
      return reply.code(400).send({ error: 'Digite um e-mail válido.' });
    }

    const respostaGenerica = {
      ok: true,
      message: 'Se este e-mail estiver cadastrado, enviamos um código de recuperação.',
    };

    const { rows } = await pool.query('SELECT id, nome FROM usuarios WHERE email = $1', [email]);
    const usuario = rows[0];
    if (!usuario) {
      return respostaGenerica;
    }

    // Mesmo cooldown de 60s do reenvio de verificação de e-mail (CA11) —
    // evita disparar um e-mail novo a cada re-submit do formulário, sem
    // precisar de infra extra de rate limit.
    const { rows: ultimoRows } = await pool.query(
      `SELECT criado_em FROM tokens_validacao
       WHERE user_id = $1 AND tipo = 'recuperacao_senha'
       ORDER BY criado_em DESC LIMIT 1`,
      [usuario.id]
    );
    const emCooldown = ultimoRows[0]
      && Date.now() - new Date(ultimoRows[0].criado_em).getTime() < REENVIO_COOLDOWN_SEGUNDOS * 1000;
    if (emCooldown) {
      return respostaGenerica;
    }

    const codigo = await tokenService.criarToken(pool, { userId: usuario.id, tipo: 'recuperacao_senha' });
    tokenService.enviarPorCanais({ token: codigo, canais: ['email'], email, nome: usuario.nome });

    return respostaGenerica;
  });

  // Confirma o código de 6 dígitos e define a nova senha. Sem preHandler:
  // authenticate — quem está aqui não tem sessão válida (é justamente o
  // caso de esquecer a senha).
  fastify.post('/api/auth/redefinir-senha', async (request, reply) => {
    const { email: emailBruto, token: tokenBruto, senha } = request.body || {};
    const email = (emailBruto || '').toLowerCase().trim();
    const codigo = String(tokenBruto || '').trim();

    if (!EMAIL_REGEX.test(email)) {
      return reply.code(400).send({ error: 'Digite um e-mail válido.' });
    }
    if (!/^\d{6}$/.test(codigo)) {
      return reply.code(400).send({ error: 'Código inválido ou expirado. Solicite um novo.' });
    }
    if (!SENHA_REGEX.test(senha || '')) {
      return reply.code(400).send({
        error: 'A senha deve ter no mínimo 8 caracteres, 1 número e 1 letra maiúscula.',
      });
    }

    const mensagens = {
      nao_encontrado: 'Código inválido ou expirado. Solicite um novo.',
      expirado: 'Código expirado. Solicite um novo.',
      bloqueado: 'Número máximo de tentativas atingido. Solicite um novo código.',
      incorreto: 'Código incorreto. Tente novamente.',
    };

    const { rows } = await pool.query('SELECT id FROM usuarios WHERE email = $1', [email]);
    const usuario = rows[0];
    // E-mail não encontrado cai na mesma mensagem de código inválido (CA02)
    // — não revela se a conta existe.
    if (!usuario) {
      return reply.code(400).send({ error: mensagens.nao_encontrado });
    }

    const { valido, motivo } = await tokenService.validate({
      userId: usuario.id,
      tipo: 'recuperacao_senha',
      token: codigo,
    });
    if (!valido) {
      return reply.code(400).send({ error: mensagens[motivo] || mensagens.incorreto });
    }

    const hash = await bcrypt.hash(senha, 10);
    // token_version++ derruba qualquer sessão JWT ativa (mesmo efeito do
    // logout) — sessões abertas em outro lugar não devem sobreviver a uma
    // redefinição de senha.
    await pool.query(
      'UPDATE usuarios SET senha_hash = $1, token_version = token_version + 1 WHERE id = $2',
      [hash, usuario.id]
    );

    return { ok: true, message: 'Senha redefinida com sucesso. Faça login com a nova senha.' };
  });

  // GET /api/config-publica — expõe só a chave pública do PostHog pro front do
  // painel (US47/CA de rastreamento de conversão). Não autenticada de
  // propósito: precisa estar disponível em login.html/cadastro.html, antes de
  // qualquer sessão existir. Sem POSTHOG_KEY configurada, o front recebe
  // posthogKey: null e analytics.js não inicializa o tracking (fail-safe).
  fastify.get('/api/config-publica', async () => ({
    posthogKey: process.env.POSTHOG_KEY || null,
    posthogHost: process.env.POSTHOG_HOST || 'https://us.i.posthog.com',
  }));

  // ---------- Cadastro self-service (US20/US34) ----------
  // Segmentos disponíveis pro dropdown do cadastro (CA02/US34) — tabela
  // dinâmica (035), consultada sem autenticação já que roda antes do login.
  fastify.get('/api/segmentos', async () => {
    const { rows } = await pool.query('SELECT id, nome FROM segmentos WHERE ativo = true ORDER BY id');
    return { segmentos: rows };
  });

  // US67/CA01 — catálogo público de planos (grade 2x2), consultado sem
  // autenticação tanto pela landing (outra origem) quanto pelo cadastro
  // (CA06, pra pré-selecionar o plano vindo de ?plano=). Só planos ativos —
  // os desativados pela migration 045 (chaves legadas) não aparecem aqui,
  // mas continuam resolvendo preço no checkout de quem já os tem.
  // US74/CA02 — monta features (ordenadas) e limites por plano a partir de
  // linhas soltas (plano_features/plano_limites) — mais simples que fazer o
  // agrupamento em SQL (json_agg) e mantém a mesma forma de query usada no
  // resto do arquivo.
  async function anexarFeaturesELimites(planosRows) {
    const chaves = planosRows.map((p) => p.chave);
    if (!chaves.length) return planosRows.map(({ chave, ...resto }) => resto);

    const [{ rows: featuresRows }, { rows: limitesRows }] = await Promise.all([
      pool.query(
        `SELECT plano_chave, label, ordem FROM plano_features WHERE plano_chave = ANY($1) ORDER BY ordem ASC`,
        [chaves]
      ),
      pool.query(`SELECT plano_chave, chave, valor FROM plano_limites WHERE plano_chave = ANY($1)`, [chaves]),
    ]);

    return planosRows.map((p) => {
      const { chave, herda_de, herda_de_nome, ...resto } = p;
      return {
        ...resto,
        preco_mensal: Number(p.preco_mensal),
        herda_de_nome: herda_de_nome || null,
        features: featuresRows.filter((f) => f.plano_chave === chave).map((f) => ({ label: f.label, ordem: f.ordem })),
        limites: Object.fromEntries(limitesRows.filter((l) => l.plano_chave === chave).map((l) => [l.chave, l.valor])),
      };
    });
  }

  const TENANT_CAMPOS_WEBHOOK = `id, nome, telefone, instancia_whatsapp, meta_phone_number_id, tecnologia,
                dias_funcionamento, horario_abertura, horario_fechamento,
                horario_almoco_ativo, horario_almoco_inicio, horario_almoco_fim,
                onboarding_horario_revisado, feriados_bloqueados`;

  // US68.2 — handshake de verificação do webhook da Meta (App Dashboard →
  // WhatsApp → Configuração → Webhook, chamado uma vez ao salvar a URL e
  // sempre que a Meta reconfirma a assinatura). Mesma lógica que já existia
  // dentro do n8n (workflow v4) — token comparado com META_VERIFY_TOKEN,
  // resposta é o challenge cru (texto puro, não JSON).
  fastify.get('/webhook/whatsapp', async (request, reply) => {
    const query = request.query || {};
    const valido = query['hub.mode'] === 'subscribe'
      && !!process.env.META_VERIFY_TOKEN
      && query['hub.verify_token'] === process.env.META_VERIFY_TOKEN;
    if (!valido) return reply.code(403).send('Forbidden');
    return reply.code(200).type('text/plain').send(query['hub.challenge'] || '');
  });

  // US68.2 — roteador: recebe o webhook (Meta Cloud API ou, se algum dia
  // voltar a existir, Evolution API) no lugar do n8n e decide, por
  // tenant.tecnologia, se processa pelo IA Engine (US68) ou repassa sem
  // alteração pro n8n (fluxo de bot atual, intocado). Sem auth — é um
  // webhook externo, mesmo padrão de rota pública já usado em /api/planos.
  // Tenant desconhecido/inativo, evento sem mensagem (ex.: status de
  // entrega) ou qualquer erro no processamento cai no repasse pro n8n —
  // nunca perde o evento silenciosamente nem quebra o fluxo de bot.
  fastify.post('/webhook/whatsapp', async (request, reply) => {
    const body = request.body || {};
    const ehMeta = body.object === 'whatsapp_business_account';
    const change = ehMeta ? (((body.entry || [])[0] || {}).changes || [])[0] : null;
    const value = change ? change.value : null;

    let tenant = null;
    let telefone = null;
    let mensagem = null;
    let pushName = null;
    let enviarResposta = null;

    if (ehMeta && value) {
      const phoneNumberId = value.metadata && value.metadata.phone_number_id;
      const msg = (value.messages || [])[0];
      if (phoneNumberId && msg && msg.type === 'text') {
        const { rows } = await pool.query(
          `SELECT ${TENANT_CAMPOS_WEBHOOK} FROM tenants WHERE meta_phone_number_id = $1 AND ativo = true LIMIT 1`,
          [phoneNumberId]
        );
        tenant = rows[0] || null;
        telefone = msg.from;
        mensagem = (msg.text && msg.text.body) || '';
        const contato = (value.contacts || [])[0];
        pushName = (contato && contato.profile && contato.profile.name) || null;
        enviarResposta = (numero, texto) => metaWhatsappService.enviarTexto(tenant.meta_phone_number_id, numero, texto);
      }
      // Sem messages[0] (ex.: webhook de status "delivered"/"read") ou sem
      // phone_number_id: não há o que processar — cai no repasse abaixo, que
      // é inofensivo (o n8n também ignora esses eventos na mesma condição).
    } else if (body.instance) {
      // Compat: Evolution API não está mais em uso, mas o repasse continua
      // funcionando caso volte a existir — mesma lógica de antes.
      const { rows } = await pool.query(
        `SELECT ${TENANT_CAMPOS_WEBHOOK} FROM tenants WHERE instancia_whatsapp = $1 AND ativo = true LIMIT 1`,
        [body.instance]
      );
      tenant = rows[0] || null;
      const data = body.data || {};
      if (data.key && !data.key.fromMe) {
        telefone = (data.key.remoteJid || '').replace('@s.whatsapp.net', '').replace('@lid', '').replace('@g.us', '');
        mensagem = (data.message && (data.message.conversation || (data.message.extendedTextMessage && data.message.extendedTextMessage.text))) || '';
        pushName = data.pushName || null;
        enviarResposta = (numero, texto) => evolutionService.enviarTexto(tenant.instancia_whatsapp, numero, texto);
      }
    }

    if (tenant && tenant.tecnologia === 'ia' && telefone && mensagem && mensagem.trim()) {
      try {
        await processarMensagemIA({ tenant, telefone, mensagem: mensagem.trim(), pushName, enviarResposta });
        return reply.code(200).send({ ok: true });
      } catch (erro) {
        fastify.log.error({ erro: erro.message, tenantId: tenant.id }, 'Falha no IA Engine (US68) — mensagem não processada');
        // Achado numa avaliação do bot (2026-08-19): antes esse catch só
        // logava e respondia 200 pro webhook da Meta — o cliente nunca
        // recebia nada de volta, parecendo que o salão tinha ignorado a
        // mensagem dele. `enviarResposta` também pode falhar (token
        // expirado, instância desconectada) — nunca deixa essa segunda
        // falha derrubar a resposta do webhook.
        try {
          await enviarResposta(telefone, MENSAGEM_ERRO_GENERICO_IA);
        } catch (erroEnvio) {
          fastify.log.error({ erro: erroEnvio.message, tenantId: tenant.id }, 'Falha ao enviar mensagem de erro genérica da IA (US68)');
        }
        return reply.code(200).send({ ok: true });
      }
    }

    // tecnologia='bot', tenant não encontrado/inativo, evento sem mensagem,
    // ou N8N_WEBHOOK_URL ausente em dev: repassa o payload original sem
    // alteração — exatamente o que já acontecia antes deste roteador
    // existir (Meta → n8n direto, mesma URL configurada no App Dashboard).
    const n8nUrl = process.env.N8N_WEBHOOK_URL;
    if (!n8nUrl) return reply.code(200).send({ ok: true });
    try {
      const resposta = await fetch(n8nUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15000),
      });
      const texto = await resposta.text();
      reply.code(resposta.status);
      try {
        return reply.send(JSON.parse(texto));
      } catch {
        return reply.send(texto);
      }
    } catch (erro) {
      fastify.log.error({ erro: erro.message }, 'Falha ao repassar webhook pro n8n (US68.2)');
      return reply.code(200).send({ ok: true });
    }
  });

  fastify.get('/api/planos', async () => {
    const { rows } = await pool.query(
      `SELECT p.chave, p.slug, p.nome, p.descricao, p.tecnologia, p.tipo_numero, p.preco_mensal,
              p.limite_disparos, p.destaque, p.badge, p.headline_diferencial, p.frase_beneficio,
              p.herda_de, base.nome AS herda_de_nome
         FROM planos p
         LEFT JOIN planos base ON base.chave = p.herda_de
        WHERE p.ativo = true
        ORDER BY p.preco_mensal ASC`
    );
    return anexarFeaturesELimites(rows);
  });

  // US72/CA02 — resolve um slug pra um plano único, aceitando tanto o slug
  // atual quanto a `chave` (identificador interno, imutável — era o slug
  // antes da US72 renomear pra eixo de valor). Isso mantém links antigos
  // (?plano=starter) funcionando sem precisar de uma tabela extra de
  // aliases: `chave` nunca muda, então basta aceitar os dois. Não filtra
  // por `ativo` — é uma consulta pontual (não a lista pra grade de preços),
  // então resolve mesmo plano legado desativado (ex: pra não devolver 404 de
  // um link publicado antes da desativação em 045_planos_2x2.sql).
  fastify.get('/api/planos/:slug', async (request, reply) => {
    const { slug } = request.params;
    const { rows } = await pool.query(
      `SELECT slug, nome, descricao, tecnologia, tipo_numero, preco_mensal,
              limite_disparos, destaque, badge
         FROM planos
        WHERE slug = $1 OR chave = $1`,
      [slug]
    );
    if (!rows[0]) {
      return reply.code(404).send({ error: 'Plano não encontrado' });
    }
    return { ...rows[0], preco_mensal: Number(rows[0].preco_mensal) };
  });


  fastify.post('/api/auth/register', async (request, reply) => {
    const {
      nome_empresa: nomeEmpresa,
      nome_responsavel: nomeResponsavel,
      email,
      senha,
      segmento_id: segmentoIdBruto,
      telefone: telefoneBruto,
      whatsapp: whatsappBruto,
      aceite_termos: aceiteTermosBruto,
      aceita_marketing: aceitaMarketingBruto,
      plano_slug: planoSlugBruto,
    } = request.body || {};

    const nomeEmpresaLimpo = (nomeEmpresa || '').trim();
    const nomeLimpo = (nomeResponsavel || '').trim();
    const emailLimpo = (email || '').toLowerCase().trim();

    if (nomeEmpresaLimpo.length < 2) {
      return reply.code(400).send({ error: 'Informe o nome da empresa.' });
    }
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
    // US77/CA04 — segmento sai do formulário de cadastro (migra pro
    // onboarding, US82) e passa a ser opcional aqui; sem ele, a conta nasce
    // com onboarding_pendente=true. Continua aceito quando enviado, pra não
    // quebrar nenhum outro chamador que ainda mande o campo.
    let segmentoId = null;
    if (segmentoIdBruto !== undefined && segmentoIdBruto !== null && segmentoIdBruto !== '') {
      segmentoId = parseInt(segmentoIdBruto, 10);
      if (!Number.isInteger(segmentoId)) {
        return reply.code(400).send({ error: 'Selecione um segmento válido.' });
      }
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
    // US79/CA01/CA03 — aceite dos Termos de Uso e da Política de Privacidade
    // é condição pra usar o serviço (não é opcional como o consentimento de
    // marketing) e fica registrado numa trilha de auditoria própria e
    // imutável (CA03). Validado no servidor como rede de segurança — o
    // formulário já bloqueia o envio sem o aceite marcado.
    const aceiteTermos = aceiteTermosBruto === true;
    if (!aceiteTermos) {
      return reply.code(422).send({
        error: 'Você precisa aceitar os Termos de Uso e a Política de Privacidade para criar a conta.',
        erros: { aceite_termos: 'Aceite obrigatório.' },
      });
    }
    const aceitaMarketing = aceitaMarketingBruto === true;

    // Verificação de unicidade antes de criar qualquer registro (CA03).
    const { rows: emailRows } = await pool.query('SELECT 1 FROM usuarios WHERE email = $1', [emailLimpo]);
    if (emailRows.length > 0) {
      return reply.code(409).send({ error: 'Este e-mail já está cadastrado. Faça login ou use outro e-mail.' });
    }
    const { rows: whatsappRows } = await pool.query('SELECT 1 FROM tenants WHERE whatsapp = $1', [whatsapp]);
    if (whatsappRows.length > 0) {
      return reply.code(409).send({ error: 'Este número de WhatsApp já está associado a uma conta.' });
    }
    let segmentoSlug = null;
    if (segmentoId !== null) {
      const { rows: segmentoRows } = await pool.query(
        'SELECT slug FROM segmentos WHERE id = $1 AND ativo = true',
        [segmentoId]
      );
      if (!segmentoRows[0]) {
        return reply.code(400).send({ error: 'Selecione um segmento válido.' });
      }
      segmentoSlug = segmentoRows[0].slug;
    }
    // US77/CA04 — sem segmento no cadastro, a conta fica pendente de
    // onboarding (US82 recolhe segmento + nome do negócio depois do login).
    const onboardingPendente = segmentoId === null;

    // US78/CA04 — plano escolhido na landing (?plano=) ou trocado na própria
    // tela de cadastro, pra não perder a referência de preço entre o card e
    // a cobrança. Opcional: sem ele, o tenant nasce sem plano (`'trial'`,
    // igual antes do US78) e escolhe depois no checkout (US32). Aceita tanto
    // o slug atual quanto uma chave legada (mesma resolução do US72), já que
    // o link pode vir de uma página cacheada com o slug antigo.
    let planoChave = null;
    let planoSlugResolvido = null;
    const planoSlugLimpo = typeof planoSlugBruto === 'string' ? planoSlugBruto.trim() : '';
    if (planoSlugLimpo) {
      const { rows: planoRows } = await pool.query(
        'SELECT chave, slug FROM planos WHERE slug = $1 OR chave = $1',
        [planoSlugLimpo]
      );
      if (!planoRows[0]) {
        return reply.code(422).send({ error: 'Plano selecionado inválido.' });
      }
      planoChave = planoRows[0].chave;
      planoSlugResolvido = planoRows[0].slug;
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Trial começa imediatamente, antes mesmo da validação do token (CA04).
      // `nome` (nome comercial exibido em "Minha Empresa" e usado pelo bot/IA
      // em toda comunicação com o cliente final) volta a ser coletado no
      // próprio cadastro (nome_empresa), separado do nome do responsável —
      // antes os dois eram o mesmo valor, misturando pessoa física com nome
      // do negócio nas mensagens do WhatsApp. O tenant pode ajustá-lo depois
      // em Minha Empresa (US33).
      const trialExpira = new Date(Date.now() + configSistema.config.trialDias * 24 * 60 * 60 * 1000);
      const { rows: tenantRows } = await client.query(
        `INSERT INTO tenants (nome, telefone, whatsapp, segmento, segmento_id, plano, status, trial_expires_at, onboarding_pendente)
         VALUES ($1, $2, $3, $4, $5, $6, 'trial', $7, $8)
         RETURNING id`,
        [nomeEmpresaLimpo, telefone, whatsapp, segmentoSlug, segmentoId, planoChave || 'trial', trialExpira.toISOString(), onboardingPendente]
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

      // US79/CA03 — trilha de auditoria do consentimento: versão dos
      // documentos aceitos, IP de origem e o consentimento (opcional) de
      // marketing, na mesma transação da criação da conta.
      await client.query(
        `INSERT INTO consentimentos_cadastro (tenant_id, termos_versao, privacidade_versao, aceita_marketing, ip)
         VALUES ($1, $2, $3, $4, $5)`,
        [tenantId, TERMOS_VERSAO, PRIVACIDADE_VERSAO, aceitaMarketing, request.ip]
      );

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
        plano_slug: planoSlugResolvido,
        segmento: segmentoSlug,
        onboarding_pendente: onboardingPendente,
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
    if (contagem[0].na_hora >= configSistema.config.maxReenviosHora) {
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
      `SELECT u.email, u.email_verified, u.role, t.status, t.plano, t.trial_expires_at, t.ativado_em,
              t.status_alterado_em, t.acesso_ate,
              t.onboarding_horario_revisado, t.onboarding_dispensado
       FROM usuarios u JOIN tenants t ON t.id = u.tenant_id
       WHERE u.id = $1`,
      [userId]
    );
    const info = rows[0] || {};
    // BUG (achado na US52) — `dias_restantes` era calculado a partir de
    // `trial_expires_at` (fixado no momento do cadastro), enquanto o trial
    // que de fato vale pra cobrança/bloqueio é `ativado_em + TRIAL_DIAS`
    // (US31/calcularTrialTenant, `ativado_em` só é setado quando o e-mail é
    // verificado). Um tenant que demorasse pra verificar via aqui um trial
    // mais curto (ou já "expirado") do que o que realmente estava valendo.
    // Unifica no mesmo cálculo usado no resto do sistema.
    const trial = calcularTrialTenant(info);
    // Motivo de bloqueio (mesma fonte de verdade de `authenticate`) — o
    // frontend usa isso pra redirecionar pra /bloqueio.html antes mesmo de
    // tropeçar num 403 de alguma outra rota.
    const bloqueioMotivo = calcularBloqueioAssinatura(info);

    // US59 — dados pros avisos contextuais do painel (CA "trial, configuração
    // incompleta e cobrança pendente"): sem serviço/profissional cadastrado
    // ou WhatsApp desconectado, o tenant não consegue receber agendamento
    // nenhum pelo bot, então vale nudge mesmo fora do dashboard.
    const { rows: contagem } = await pool.query(
      `SELECT
         (SELECT COUNT(*)::int FROM servicos WHERE tenant_id = $1 AND ativo = true AND excluido_em IS NULL) AS servicos,
         (SELECT COUNT(*)::int FROM profissionais WHERE tenant_id = $1) AS profissionais,
         (SELECT meta_phone_number_id FROM tenants WHERE id = $1) AS meta_phone_number_id`,
      [tenantId]
    );
    const configInfo = contagem[0];

    return {
      tenant_id: tenantId,
      email: info.email,
      email_mascarado: info.email ? tokenService.mascararEmail(info.email) : null,
      email_verified: !!info.email_verified,
      role: info.role,
      status: info.status,
      plano: info.plano,
      trial_ativo: trial.trialAtivo,
      dias_restantes: trial.trialDiasRestantes,
      bloqueio_motivo: bloqueioMotivo,
      suporte_email: configSistema.config.emailSuporte,
      suporte_whatsapp: configSistema.config.whatsappSuporte,
      pagamento_pendente: info.status === 'inadimplente',
      // horario_nao_confirmado (US56): diferente de sem_servicos/
      // whatsapp_desconectado, o horário de funcionamento sempre tem um
      // valor (default 08:00-20:00 da migration 014) — não dá pra detectar
      // "incompleto" por ausência de dado, só se o tenant já passou pela
      // tela de Configuração ao menos uma vez (onboarding_horario_revisado,
      // setado em PATCH /api/configuracao).
      configuracao: {
        sem_servicos: configInfo.servicos === 0,
        sem_profissionais: configInfo.profissionais === 0,
        whatsapp_desconectado: !configInfo.meta_phone_number_id,
        horario_nao_confirmado: !info.onboarding_horario_revisado,
      },
      // Com 0 ou 1 profissional, "qual profissional" nunca é uma decisão
      // real — o campo/nome só faz sentido mostrar pra quem realmente tem
      // 2+ (plano Custom). Usado pelo frontend pra esconder o campo em todo
      // lugar que mostra/pede profissional (Novo agendamento, Agenda,
      // Bloqueios, Encaixe), não só no menu Profissionais.
      mostrar_profissional: configInfo.profissionais > 1,
      onboarding_dispensado: !!info.onboarding_dispensado,
    };
  });

  // US56 — o usuário optou por pular o checklist de onboarding por agora.
  // Só afasta o redirecionamento automático pro checklist no próximo acesso
  // (CA "usuário pode retomar o onboarding depois") — o item "Primeiros
  // passos" continua na sidebar enquanto algum passo estiver pendente.
  fastify.post('/api/onboarding/dispensar', { preHandler: [fastify.authenticate] }, async (request) => {
    await pool.query('UPDATE tenants SET onboarding_dispensado = true WHERE id = $1', [request.user.tenantId]);
    return { ok: true };
  });

  // US52 — endpoint genérico pro frontend registrar impressões do funil de
  // conversão pós-trial (aviso de vencimento, tela de bloqueio). Sem
  // requireModulo/ROTAS_LIVRES_SEM_ASSINATURA parcial: fica liberado mesmo
  // com o tenant bloqueado (é assim que "bloqueio_exibido" é registrado).
  fastify.post('/api/eventos', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tipo } = request.body || {};
    if (!EVENTOS_ANALYTICS_TIPOS_FRONTEND.has(tipo)) {
      return reply.code(400).send({ error: 'Tipo de evento inválido.' });
    }
    await registrarEvento(request.user.tenantId, tipo);
    return { ok: true };
  });

  // Agenda — extraído pra routes/agenda.js (fase 3 da modularização):
  // GET/PATCH /api/agendamentos[/:id], GET /api/agendamentos/disponibilidade
  // e POST /api/agendamentos (mais abaixo, onde vivia antes — ver comentário
  // lá).
  registerAgendaRoutes(fastify, pool);

  // CRUD de Serviços (US17/ST17.1) — extraído pra routes/servicos.js (fase 2
  // da modularização): GET/POST/PATCH/DELETE /api/servicos[/:id].
  registerServicosRoutes(fastify, pool);

  // Clientes (menu Clientes) — extraído pra routes/clientes.js (fase 4 da
  // modularização): GET/POST/DELETE /api/clientes[/:id], GET
  // /api/clientes/buscar-por-telefone, GET/PATCH /api/clientes/:id.
  registerClientesRoutes(fastify, pool);

  // CRUD de Profissionais (US17/ST17.2, incluindo GET pro dropdown do
  // formulário de agendamento) — extraído pra routes/profissionais.js (fase
  // 2 da modularização): GET/POST/PATCH/DELETE /api/profissionais[/:id].
  registerProfissionaisRoutes(fastify, pool);

  // Bloqueios manuais de agenda (US61) + Feriados nacionais (Configurações >
  // Bloqueio de agenda) — extraídos pra routes/bloqueios.js (fase 1 da
  // modularização): GET/POST/DELETE /api/bloqueios, GET/PATCH /api/feriados.
  registerBloqueiosRoutes(fastify, pool);

  // POST /api/agendamentos (âncora + recorrência) também foi pra
  // routes/agenda.js — registerAgendaRoutes já cobre as 4 rotas de Agenda de
  // uma vez só, mais acima (onde GET/PATCH/disponibilidade viviam).

  // Perfil — extraído pra routes/perfil.js (fase 6 da modularização):
  // GET/PATCH /api/perfil, PATCH /api/perfil/senha.
  registerPerfilRoutes(fastify, pool);

  // Equipe — extraído pra routes/equipe.js (fase 6 da modularização):
  // GET /api/equipe, POST/DELETE /api/equipe/convites[/:id],
  // GET /api/equipe/convites/:token, POST /api/equipe/convites/:token/aceitar,
  // PATCH/DELETE /api/equipe/membros/:id.
  registerEquipeRoutes(fastify, pool);

  // WhatsApp (self-service) — extraído pra routes/whatsapp-config.js (fase
  // 7 da modularização): GET /api/whatsapp/config-publica|status|conversas,
  // POST /api/whatsapp/solicitar-numero-novo|conectar.
  registerWhatsappConfigRoutes(fastify, pool);

  // Configuração — extraído pra routes/configuracao.js (fase 7 da
  // modularização): GET/PATCH /api/configuracao, GET /api/tenant/modulos.
  registerConfiguracaoRoutes(fastify, pool);


  // Financeiro — extraído pra routes/financeiro.js (fase 5 da modularização):
  // GET /api/financeiro/resumo, GET /api/financeiro/resumo-dashboard,
  // GET/POST/PATCH /api/financeiro/lancamentos[/:id].
  registerFinanceiroRoutes(fastify, pool);

  // Início (dashboard) reformulado em 5 seções — um único endpoint agregando
  // tudo (em vez de N chamadas), já que a tela renderiza tudo de uma vez.
  // Seção "Atendimento agente Kyvvo" só existe pra tecnologia='ia' (bot de
  // menu no n8n não grava conversas_ia); Seção "Financeiro" só pra quem tem
  // o módulo financeiro ativo E é administrador (mesmo critério de
  // /api/financeiro/resumo-dashboard, só que sem 403 — aqui o resto da tela
  // continua funcionando pra quem não pode ver dinheiro, só essa seção some).
  fastify.get('/api/inicio/resumo', { preHandler: [fastify.authenticate] }, async (request) => {
    const { tenantId, role } = request.user;
    const hoje = dataAtualBrasilia();
    const amanha = new Date(new Date(`${hoje}T12:00:00-03:00`).getTime() + 86400000).toISOString().slice(0, 10);

    const { rows: tenantRows } = await pool.query(
      `SELECT id, tecnologia, dias_funcionamento, horario_abertura, horario_fechamento,
              horario_almoco_ativo, horario_almoco_inicio, horario_almoco_fim
       FROM tenants WHERE id = $1`,
      [tenantId]
    );
    const tenant = tenantRows[0];

    const [
      { rows: atendimentosRows },
      { rows: previstoRows },
      horariosLivresHoje,
      horariosLivresAmanha,
      { rows: semRetornoRows },
    ] = await Promise.all([
      pool.query(
        `SELECT count(*)::int AS total FROM agendamentos
         WHERE tenant_id = $1 AND status != 'cancelado'
           AND (data_hora AT TIME ZONE 'America/Sao_Paulo')::date = $2::date`,
        [tenantId, hoje]
      ),
      pool.query(
        `SELECT COALESCE(SUM(valor) FILTER (WHERE status = 'previsto' AND data = $2), 0) AS previsto
         FROM lancamentos_financeiros WHERE tenant_id = $1 AND tipo = 'entrada'`,
        [tenantId, hoje]
      ),
      contarHorariosLivresNoDia(tenant, hoje),
      contarHorariosLivresNoDia(tenant, amanha),
      // "Sem retorno" exige que o cliente já tenha tido pelo menos 1
      // atendimento antes — cliente novo que nunca agendou não é "sem
      // retorno" (nunca teve retorno nenhum pra medir).
      pool.query(
        `SELECT count(*)::int AS total FROM clientes c
         WHERE c.tenant_id = $1
           AND EXISTS (SELECT 1 FROM agendamentos a WHERE a.cliente_id = c.id AND a.status != 'cancelado')
           AND (SELECT max(a.data_hora) FROM agendamentos a WHERE a.cliente_id = c.id AND a.status != 'cancelado') < now() - interval '30 days'`,
        [tenantId]
      ),
    ]);

    let atendimentoIa = null;
    if (tenant.tecnologia === 'ia') {
      const { rows } = await pool.query(
        `WITH conversas AS (
           SELECT DISTINCT cliente_id FROM conversas_ia
           WHERE tenant_id = $1 AND role = 'user'
             AND (criado_em AT TIME ZONE 'America/Sao_Paulo')::date = $2::date
         ),
         agendados AS (
           SELECT DISTINCT cliente_id FROM agendamentos
           WHERE tenant_id = $1 AND origem = 'whatsapp' AND status != 'cancelado'
             AND (criado_em AT TIME ZONE 'America/Sao_Paulo')::date = $2::date
         )
         SELECT
           (SELECT count(*) FROM conversas) AS conversas_hoje,
           (SELECT count(*) FROM (SELECT cliente_id FROM conversas EXCEPT SELECT cliente_id FROM agendados) t) AS nao_concluiram_hoje,
           (SELECT count(*) FROM agendamentos
             WHERE tenant_id = $1 AND origem = 'whatsapp' AND status != 'cancelado'
               AND (criado_em AT TIME ZONE 'America/Sao_Paulo')::date = $2::date) AS concluidos_hoje,
           (SELECT COALESCE(SUM(s.duracao_minutos), 0) FROM agendamentos a JOIN servicos s ON s.id = a.servico_id
             WHERE a.tenant_id = $1 AND a.origem = 'whatsapp' AND a.status != 'cancelado'
               AND (a.criado_em AT TIME ZONE 'America/Sao_Paulo')::date = $2::date) AS minutos_economizados_hoje`,
        [tenantId, hoje]
      );
      const r = rows[0];
      atendimentoIa = {
        conversas_hoje: Number(r.conversas_hoje),
        nao_concluiram_hoje: Number(r.nao_concluiram_hoje),
        concluidos_hoje: Number(r.concluidos_hoje),
        minutos_economizados_hoje: Number(r.minutos_economizados_hoje),
      };
    }

    let financeiro = null;
    if (role === 'administrador') {
      const { rows: moduloRows } = await pool.query(
        "SELECT 1 FROM tenant_modulos WHERE tenant_id = $1 AND modulo_key = 'financeiro' AND ativo LIMIT 1",
        [tenantId]
      );
      if (moduloRows.length) {
        const { rows } = await pool.query(
          `SELECT
             COALESCE(SUM(valor) FILTER (WHERE status = 'realizado' AND to_char(data, 'YYYY-MM') = to_char($2::date, 'YYYY-MM')), 0) AS faturado_mes,
             COALESCE(SUM(valor) FILTER (WHERE status = 'realizado' AND to_char(data, 'YYYY-MM') = to_char($2::date - interval '1 month', 'YYYY-MM')), 0) AS faturado_mes_anterior
           FROM lancamentos_financeiros WHERE tenant_id = $1 AND tipo = 'entrada'`,
          [tenantId, hoje]
        );
        const r = rows[0];
        const faturadoMes = Number(r.faturado_mes);
        const faturadoMesAnterior = Number(r.faturado_mes_anterior);
        financeiro = {
          faturado_mes: faturadoMes,
          variacao_pct: faturadoMesAnterior > 0 ? ((faturadoMes - faturadoMesAnterior) / faturadoMesAnterior) * 100 : null,
        };
      }
    }

    return {
      atendimentos_hoje: atendimentosRows[0].total,
      horarios_livres_hoje: horariosLivresHoje,
      previsto_hoje: Number(previstoRows[0].previsto),
      oportunidades: {
        clientes_sem_retorno: semRetornoRows[0].total,
        horarios_livres_amanha: horariosLivresAmanha,
      },
      atendimento_ia: atendimentoIa,
      financeiro,
    };
  });

  // Relatórios — extraído pra routes/relatorios.js (fase 5 da
  // modularização): GET /api/relatorios/resumo (dashboard mensal de
  // negócio, modulo_key='dashboards').
  registerRelatoriosRoutes(fastify, pool);

  // Pagamentos / Asaas — extraído pra routes/pagamentos.js (fase 8 da
  // modularização): GET /api/pagamentos[/status], POST /api/pagamentos/cadastrar,
  // PATCH /api/pagamentos/plano, DELETE /api/pagamentos/assinatura,
  // POST /webhooks/asaas.
  registerPagamentosRoutes(fastify, pool);

  // Área admin da Kyvvo (US16) — extraída pra vários routes/admin-*.js
  // (fase 9 da modularização): auth, tenants (CRUD + assinaturas + módulos),
  // configurações do sistema/planos, monitoramento (whatsapp/status +
  // ia-uso) e números prontos.
  registerAdminAuthRoutes(fastify, pool);
  registerAdminTenantsRoutes(fastify, pool);
  registerAdminConfiguracoesRoutes(fastify, pool);
  registerAdminMonitoramentoRoutes(fastify, pool);
  registerAdminNumerosProntosRoutes(fastify, pool);


  // CA09 — carrega os valores configuráveis do banco antes de aceitar
  // requisições, pra nunca servir com os literais hardcoded quando já existe
  // uma configuração diferente salva.
  await configSistema.carregar();
  await planos.carregar();

  await fastify.listen({ port: PORT, host: '0.0.0.0' });
  console.log(`Painel Kyvvo rodando na porta ${PORT}`);
}

start().catch((err) => {
  console.error(err);
  process.exit(1);
});
