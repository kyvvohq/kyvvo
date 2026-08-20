const token = localStorage.getItem('kyvvo_token');

document.getElementById('btn-sair').addEventListener('click', async () => {
  try {
    await fetch('/api/auth/logout', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch (e) {
    // Sem conexão: prossegue com o logout local mesmo assim.
  }
  localStorage.removeItem('kyvvo_token');
  localStorage.removeItem('kyvvo_nome');
  localStorage.removeItem('kyvvo_email');
  window.location.href = 'https://kyvvo.com.br';
});

// US20 — guarda de e-mail não validado (CA10) + banner de trial (CA09) + toast
// de sucesso pós-validação (CA08). Falha na chamada de status não bloqueia o
// portal (fail-open): usuários antigos já são email_verified=true na migration.
// mostrarToast() é definido mais abaixo (seção Toasts).
// contaStatus fica disponível pro resto do app.js (ex.: renderWhatsapp)
// reaproveitar dados já buscados aqui, como o contato de suporte, sem
// precisar de uma segunda chamada à API.
let contaStatus = null;

async function verificarStatusConta() {
  let status;
  try {
    const res = await fetch('/api/tenant/status', { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return;
    status = await res.json();
    contaStatus = status;
  } catch (e) {
    return;
  }

  // CA10 — conta não validada: acesso ao portal bloqueado até validar.
  if (status.email_verified === false) {
    window.location.href = '/verificar';
    return;
  }

  // US52/CA03 + bloqueio por inadimplência/suspensão/cancelamento vencido —
  // o backend já bloqueia essas rotas com 403 (fastify.authenticate,
  // calcularBloqueioAssinatura), mas o redirect aqui evita que o painel
  // tente renderizar e tropece nesses 403 antes de mandar o cliente pra tela
  // de regularização.
  if (status.bloqueio_motivo) {
    window.location.href = '/bloqueio';
    return;
  }

  // CA08 — toast verde ao voltar da validação do token.
  if (new URLSearchParams(location.search).get('verificado') === '1') {
    mostrarToast('E-mail verificado! Seu trial de 14 dias está ativo.', 'sucesso');
    history.replaceState(null, '', location.pathname);
  }

  // US66 — modal de primeiros passos exibido automaticamente só no primeiro
  // acesso elegível, sem ocupar espaço fixo na sidebar (substitui a tela
  // dedicada + item fixo da US56). `menuAtual === 'inicio'` (não só
  // `!== algo`) de propósito: 'inicio' é o valor inicial intocado antes
  // de qualquer navegação (tela pós-login) — essa checagem só abre o modal
  // sozinho se o usuário ainda não clicou em nada desde que a página
  // carregou. Como essa chamada de status é assíncrona, ela pode resolver
  // depois de o usuário já ter navegado manualmente pra outra tela; nesse
  // caso `menuAtual` já mudou e o onboarding não deve interromper a
  // navegação em andamento.
  if (onboardingElegivel(status) && menuAtual === 'inicio') {
    mostrarModalOnboarding(status);
  }

  // CA09 — banner de trial com contador de dias restantes.
  const banner = document.getElementById('trial-banner');
  if (banner && status.status === 'trial' && status.dias_restantes != null) {
    const dias = status.dias_restantes;
    const texto = dias === 1 ? '1 dia restante' : `${dias} dias restantes`;
    banner.textContent = `🎉 Trial ativo — ${texto}. Escolha seu plano antes que expire.`;
    banner.hidden = false;
    document.body.classList.add('com-trial-banner');
    registrarEventoAnalytics('aviso_trial_exibido');
  }

  // US59 — avisos contextuais de cobrança pendente e configuração
  // incompleta. Separados do #trial-banner de propósito: aquele é um único
  // aviso crítico não-dispensável (CA09/US52); estes podem se acumular (mais
  // de uma pendência de configuração ao mesmo tempo) e alguns são
  // dispensáveis pelo usuário.
  renderAvisos(construirAvisos(status));

  // US62 — itens de menu restritos ao administrador (Equipe, Minha Empresa,
  // Cobrança, Preferências) somem pro operador. É só a camada de UX — quem
  // de fato bloqueia a ação é o backend (fastify.requireAdmin), então um
  // operador que force a navegação (ou um payload antigo sem `role`) ainda
  // recebe 403 real das rotas, nunca só "esconder e confiar".
  document.querySelectorAll('[data-somente-admin]').forEach((el) => {
    el.hidden = status.role === 'operador';
  });

  // Menu Profissionais e Equipe são exclusivos do plano Kyvvo Custom (chave
  // 'custom' na tabela planos). Equipe também é somente-admin — `el.hidden ||`
  // acumula em vez de sobrescrever, senão um admin em plano não-Custom via
  // esse segundo loop reapareceria escondido pelo primeiro (dois gates
  // independentes têm que combinar com E, nunca um substituir o outro).
  document.querySelectorAll('[data-somente-plano-custom]').forEach((el) => {
    el.hidden = el.hidden || status.plano !== 'custom';
  });
}

// Mensagem + rótulo/destino do botão de ação de cada tipo de aviso. `critico:
// true` = sem botão de dispensar, some só quando a pendência é resolvida
// (CA "avisos críticos permanecem visíveis enquanto pendência existir").
function construirAvisos(status) {
  const avisos = [];
  if (status.pagamento_pendente) {
    avisos.push({
      id: 'pagamento_pendente',
      critico: true,
      mensagem: '⚠️ Não conseguimos confirmar seu último pagamento. Atualize sua forma de pagamento para evitar a suspensão do acesso.',
      acaoLabel: 'Resolver agora',
      acaoMenu: 'pagamentos',
    });
  }
  const configuracao = status.configuracao || {};
  if (configuracao.sem_servicos) {
    avisos.push({
      id: 'sem_servicos',
      critico: false,
      mensagem: 'Cadastre seus serviços para começar a receber agendamentos.',
      acaoLabel: 'Cadastrar serviços',
      acaoMenu: 'servicos',
    });
  }
  if (configuracao.sem_profissionais) {
    avisos.push({
      id: 'sem_profissionais',
      critico: false,
      mensagem: 'Cadastre seus profissionais para organizar a agenda.',
      acaoLabel: 'Cadastrar profissionais',
      acaoMenu: 'profissionais',
    });
  }
  if (configuracao.whatsapp_desconectado) {
    avisos.push({
      id: 'whatsapp_desconectado',
      critico: false,
      mensagem: 'Conecte seu WhatsApp para receber agendamentos automaticamente pelo bot.',
      acaoLabel: 'Conectar WhatsApp',
      acaoMenu: 'whatsapp',
    });
  }
  return avisos;
}

// US56 — checklist mínimo de onboarding: serviços, horário de funcionamento
// e WhatsApp, nessa ordem (ordem natural de configuração — não faz sentido
// revisar horário ou conectar WhatsApp antes de ter serviço nenhum pra
// oferecer). Mesma fonte de dados que os avisos (US59) e as pendências do
// Início (US63), só reorganizada em passos sequenciais com "próximo passo
// recomendado" em vez de uma lista plana.
function construirPassosOnboarding(status) {
  const configuracao = (status && status.configuracao) || {};
  return [
    {
      id: 'servicos',
      titulo: 'Cadastre seus serviços',
      descricao: 'Defina os serviços que seu negócio oferece, com duração e preço.',
      feito: !configuracao.sem_servicos,
      acaoMenu: 'servicos',
      acaoLabel: 'Cadastrar serviços',
    },
    {
      id: 'horario',
      titulo: 'Confirme seu horário de funcionamento',
      descricao: 'Revise os dias e horários em que seu negócio atende (já vem com um padrão sugerido).',
      feito: !configuracao.horario_nao_confirmado,
      acaoMenu: 'configuracao',
      acaoLabel: 'Revisar horário',
    },
    {
      id: 'whatsapp',
      titulo: 'Conecte seu WhatsApp',
      descricao: 'Conecte o número do seu negócio para receber agendamentos automaticamente pelo bot.',
      feito: !configuracao.whatsapp_desconectado,
      acaoMenu: 'whatsapp',
      acaoLabel: 'Conectar WhatsApp',
    },
  ];
}

let avisosAtuais = [];

function idsAvisosDispensados() {
  try {
    return JSON.parse(localStorage.getItem('kyvvo_avisos_dispensados') || '[]');
  } catch (e) {
    return [];
  }
}

// Auto-recupera avisos dispensados cuja pendência já não existe mais nesta
// consulta — assim, se o usuário excluir todos os serviços de novo no
// futuro, o aviso de "sem_servicos" volta a aparecer em vez de ficar
// escondido pra sempre pela dispensa antiga.
function renderAvisos(avisos) {
  const idsAtuais = new Set(avisos.map((a) => a.id));
  const dispensadosValidos = idsAvisosDispensados().filter((id) => idsAtuais.has(id));
  localStorage.setItem('kyvvo_avisos_dispensados', JSON.stringify(dispensadosValidos));
  avisosAtuais = avisos;
  renderAvisosNaTela();
}

function renderAvisosNaTela() {
  const painel = document.getElementById('avisos-painel');
  if (!painel) return;
  const dispensados = new Set(idsAvisosDispensados());
  const visiveis = avisosAtuais.filter((a) => a.critico || !dispensados.has(a.id));
  painel.innerHTML = visiveis.map((a) => `
    <div class="aviso-item ${a.critico ? 'aviso-critico' : 'aviso-info'}" data-aviso-id="${a.id}">
      <span>${a.mensagem}</span>
      <div class="aviso-acoes">
        ${a.acaoMenu ? `<button class="aviso-acao" data-acao-aviso-menu="${a.acaoMenu}">${a.acaoLabel}</button>` : ''}
        ${a.critico ? '' : `<button class="aviso-dispensar" data-acao-dispensar-aviso="${a.id}" aria-label="Dispensar aviso">×</button>`}
      </div>
    </div>
  `).join('');
}

function dispensarAviso(id) {
  const atuais = idsAvisosDispensados();
  if (!atuais.includes(id)) atuais.push(id);
  localStorage.setItem('kyvvo_avisos_dispensados', JSON.stringify(atuais));
  renderAvisosNaTela();
}

document.getElementById('avisos-painel').addEventListener('click', (e) => {
  const dispensarBtn = e.target.closest('[data-acao-dispensar-aviso]');
  if (dispensarBtn) {
    dispensarAviso(dispensarBtn.dataset.acaoDispensarAviso);
    return;
  }
  const acaoBtn = e.target.closest('[data-acao-aviso-menu]');
  if (acaoBtn) selecionarMenu(acaoBtn.dataset.acaoAvisoMenu);
});

// US52 — funil de conversão pós-trial: dispara em "melhor esforço", sem
// travar a UI nem exigir tratamento de erro (perder uma métrica de
// analytics não pode quebrar a experiência do tenant).
function registrarEventoAnalytics(tipo) {
  api('/api/eventos', { method: 'POST', body: JSON.stringify({ tipo }) });
}
verificarStatusConta();

function saudacaoPorHorario() {
  const hora = new Date().toLocaleString('pt-BR', { hour: 'numeric', hour12: false, timeZone: 'America/Sao_Paulo' });
  const h = parseInt(hora, 10);
  if (h < 12) return 'Bom dia';
  if (h < 18) return 'Boa tarde';
  return 'Boa noite';
}

// US57 — extraído em função pra poder re-renderizar a saudação assim que o
// nome muda em "Meu Perfil", sem precisar de logout/login pra refletir
// (antes só `kyvvo_nome` no localStorage era lido, e só uma vez, no load).
function atualizarSaudacao() {
  const nomeUsuario = (localStorage.getItem('kyvvo_nome') || '').split(' ')[0] || '';
  document.getElementById('saudacao').textContent = `${saudacaoPorHorario()}${nomeUsuario ? ', ' + nomeUsuario : ''}!`;
}
atualizarSaudacao();

const conteudo = document.getElementById('conteudo');
const menuEl = document.querySelector('.menu');
const subtabsEl = document.getElementById('subtabs');
const tabs = document.querySelectorAll('.tab');
let menuAtual = 'inicio';
let abaAtual = 'dia';
let dataRef = new Date();
let configuracao = { dias_funcionamento: [1, 2, 3, 4, 5, 6], formato_hora: '24h' };

async function carregarConfiguracao() {
  const dados = await api('/api/configuracao');
  if (dados) configuracao = dados;
}

// Cabeçalhos de grupo expansível da sidebar (Agenda, Configurações) —
// genérico via data-submenu em vez de um par de consts fixo por grupo, pra
// suportar quantos grupos a sidebar precisar sem repetir a mesma lógica.
const gruposMenu = Array.from(document.querySelectorAll('.menu-item-grupo[data-submenu]')).map((toggle) => ({
  toggle,
  submenu: document.getElementById(toggle.dataset.submenu),
}));

// URL própria por seção do menu (favoritar/compartilhar/recarregar direto
// numa seção, botão voltar funcionando entre elas — antes só /painel
// existia, trocar de menu nunca mudava a URL). Cada rota aqui tem um
// fastify.get(...) correspondente no backend (index.js) servindo o mesmo
// painel.html — é só o app.js que decide o que renderizar a partir do path.
const ROTAS_MENU = {
  inicio: '/painel',
  agendamento: '/agenda',
  servicos: '/servicos',
  profissionais: '/profissionais',
  clientes: '/clientes',
  bloqueios: '/bloqueios',
  whatsapp: '/whatsapp',
  pagamentos: '/cobranca',
  perfil: '/perfil',
  empresa: '/empresa',
  equipe: '/equipe',
  configuracao: '/preferencias',
  ajuda: '/ajuda',
};
const CAMINHO_PARA_MENU = Object.fromEntries(Object.entries(ROTAS_MENU).map(([menu, caminho]) => [caminho, menu]));

// Módulos (menuAtual = 'modulo:chave', ver render()) não entram no mapa
// fixo acima — a chave é dinâmica (tenant_modulos), por isso uma regra à
// parte em vez de mais entradas fixas.
function caminhoDoMenu(menu) {
  if (menu.startsWith('modulo:')) return '/modulo/' + menu.slice('modulo:'.length);
  return ROTAS_MENU[menu] || null;
}
function menuDoCaminho(caminho) {
  if (CAMINHO_PARA_MENU[caminho]) return CAMINHO_PARA_MENU[caminho];
  const moduloMatch = caminho.match(/^\/modulo\/([a-z0-9_-]+)$/);
  return moduloMatch ? 'modulo:' + moduloMatch[1] : null;
}

// Reaproveitada tanto pelos itens da sidebar quanto pelos itens do user
// menu (dropdown do avatar, ST-user-menu) — os dois só precisam de um jeito
// de trocar `menuAtual` e re-renderizar; a diferença é só onde o clique
// aconteceu.
// `atualizarUrl: false` é usado só pelo listener de popstate e pela leitura
// inicial da URL no carregamento (abaixo) — nesses dois casos a URL já é a
// fonte da verdade, empurrar de novo criaria uma entrada redundante no
// histórico (ou um loop, no caso do popstate).
function selecionarMenu(novoMenu, { atualizarUrl = true } = {}) {
  menuEl.querySelectorAll('.menu-item').forEach((i) => i.classList.remove('active'));
  const itemSidebar = menuEl.querySelector(`.menu-item[data-menu="${novoMenu}"]`);
  if (itemSidebar) itemSidebar.classList.add('active');
  // Destaca o cabeçalho do grupo (hoje só Configurações — Agenda foi
  // promovida de submenu a item fixo) quando um item de dentro do submenu
  // fica ativo — senão nada na sidebar aparece realçado enquanto uma dessas
  // telas está aberta. Itens que vieram do user menu
  // (perfil/equipe/ajuda) não têm item correspondente na sidebar, então
  // itemSidebar é null e isso vira um no-op — correto, nenhum item da
  // sidebar deve ficar "active" nessas telas.
  gruposMenu.forEach(({ toggle, submenu }) => {
    const dentroDoGrupo = itemSidebar != null && submenu.contains(itemSidebar);
    toggle.classList.toggle('tem-filho-ativo', dentroDoGrupo);
    // Navegação direta por URL (ex.: carregar /bloqueios) pula o clique no
    // cabeçalho do grupo que normalmente abre o submenu — sem isso, o item
    // ficava "active" escondido dentro de um submenu ainda fechado.
    if (dentroDoGrupo) {
      submenu.classList.add('aberto');
      toggle.classList.add('expandido');
    }
  });
  menuAtual = novoMenu;
  subtabsEl.style.display = menuAtual === 'agendamento' ? 'flex' : 'none';
  dataRef = new Date();
  if (atualizarUrl) {
    const caminho = caminhoDoMenu(novoMenu);
    if (caminho && window.location.pathname !== caminho) {
      history.pushState({ menu: novoMenu }, '', caminho);
    }
  }
  render();
}

// Botão voltar/avançar do navegador — reflete a URL sem empurrar de novo
// (atualizarUrl: false). Cai em 'inicio' se o path não bater com nenhuma
// rota conhecida (nunca deveria acontecer vindo de dentro do próprio app,
// mas cobre alguém editando a URL à mão).
window.addEventListener('popstate', () => {
  selecionarMenu(menuDoCaminho(window.location.pathname) || 'inicio', { atualizarUrl: false });
});

function ativarMenuItem(item) {
  selecionarMenu(item.dataset.menu);
}

menuEl.querySelectorAll('.menu-item').forEach((item) => {
  item.addEventListener('click', () => ativarMenuItem(item));
});

// Cabeçalhos de grupo (hoje só Configurações) não são item de menu com tela
// própria — por isso usam a classe .menu-item-grupo (fora do .menu-item
// genérico acima) e só expandem/recolhem o submenu, sem chamar ativarMenuItem.
gruposMenu.forEach(({ toggle, submenu }) => {
  toggle.addEventListener('click', () => {
    submenu.classList.toggle('aberto');
    toggle.classList.toggle('expandido');
  });
});

// Logo no cabeçalho (saiu da sidebar) — sempre volta pro Início, sem reload
// de página, reaproveitando o mesmo caminho de navegação dos itens de menu.
const topbarLogo = document.getElementById('topbar-logo');
if (topbarLogo) topbarLogo.addEventListener('click', () => selecionarMenu('inicio'));

// Ocultar/exibir a sidebar — estado persistido em localStorage pra
// sobreviver a reload. O botão de alternar fica no topbar (fora da
// sidebar), então continua acessível mesmo com o menu oculto.
const painelSidebar = document.getElementById('painel-sidebar');
const btnToggleSidebar = document.getElementById('btn-toggle-sidebar');
function aplicarSidebarOculta(oculta) {
  painelSidebar.classList.toggle('sidebar-oculta', oculta);
  btnToggleSidebar.textContent = oculta ? '>' : '<';
  btnToggleSidebar.setAttribute('aria-label', oculta ? 'Exibir menu' : 'Ocultar menu');
  btnToggleSidebar.title = oculta ? 'Exibir menu' : 'Ocultar menu';
}
aplicarSidebarOculta(localStorage.getItem('kyvvo_sidebar_oculta') === '1');
btnToggleSidebar.addEventListener('click', () => {
  const oculta = !painelSidebar.classList.contains('sidebar-oculta');
  aplicarSidebarOculta(oculta);
  localStorage.setItem('kyvvo_sidebar_oculta', oculta ? '1' : '0');
});

// ---------- User menu (avatar + dropdown) ----------
const userMenuToggle = document.getElementById('user-menu-toggle');
const userMenuDropdown = document.getElementById('user-menu-dropdown');

function fecharUserMenu() {
  userMenuDropdown.hidden = true;
  userMenuToggle.classList.remove('aberto');
}

userMenuToggle.addEventListener('click', (e) => {
  e.stopPropagation();
  const vaiAbrir = userMenuDropdown.hidden;
  fecharUserMenu();
  if (vaiAbrir) {
    userMenuDropdown.hidden = false;
    userMenuToggle.classList.add('aberto');
  }
});

// Fecha ao clicar fora — mesmo espírito do fechamento de .menu-acoes.aberto
// já usado nos itens de agendamento/serviço/profissional.
document.addEventListener('click', (e) => {
  if (!document.getElementById('user-menu').contains(e.target)) fecharUserMenu();
});

document.querySelectorAll('.user-menu-item').forEach((item) => {
  item.addEventListener('click', () => {
    selecionarMenu(item.dataset.menu);
    fecharUserMenu();
  });
});

// Iniciais do responsável (primeiro + último nome) pro avatar do user menu
// — só isso por enquanto, sem foto (upload de foto de perfil fica fora
// deste pacote de mudanças).
function iniciaisNome(nomeCompleto) {
  const partes = (nomeCompleto || '').trim().split(/\s+/).filter(Boolean);
  if (!partes.length) return '';
  return (partes[0][0] + (partes.length > 1 ? partes[partes.length - 1][0] : '')).toUpperCase();
}

function truncarTexto(texto, max) {
  return texto && texto.length > max ? texto.slice(0, max) + '…' : (texto || '');
}

function preencherUserMenu(perfil) {
  document.getElementById('user-menu-avatar').textContent = iniciaisNome(perfil.nome_responsavel);
  document.getElementById('user-menu-nome').textContent = perfil.nome_responsavel || '';
  document.getElementById('user-menu-empresa').textContent = truncarTexto(perfil.nome_segmento, 30);
}

async function carregarUserMenu() {
  const perfil = await api('/api/perfil');
  if (perfil) preencherUserMenu(perfil);
}

// ---------- Menu dinâmico por módulo (ST10.3) ----------
// Os itens fixos (Agendamento/Perfil/Configuração) continuam sempre visíveis
// (CA05). Aqui só acrescentamos um item de menu por módulo ativo do tenant,
// além do "agenda_inteligente" (que já é coberto pelo item fixo
// "Agendamento"). As telas de cada módulo (financeiro, dashboards etc.) são
// escopo de USs futuras — o clique mostra só um aviso de "em breve".
async function carregarModulosNoMenu() {
  const resultado = await api('/api/tenant/modulos');
  if (!resultado || !Array.isArray(resultado.modulos)) return;

  // Inserido antes da âncora (entre Clientes e Configurações), não no fim
  // da sidebar — senão módulos como Financeiro/Relatórios apareceriam depois
  // de Configurações. GET /api/tenant/modulos já ordena por nome, então
  // Financeiro cai antes de Relatórios sozinho (F < R).
  const ancora = document.getElementById('menu-modulos-anchor');
  resultado.modulos
    .filter((m) => m.key !== 'agenda_inteligente')
    .forEach((m) => {
      const item = document.createElement('div');
      item.className = 'menu-item';
      item.dataset.menu = `modulo:${m.key}`;
      item.textContent = m.nome;
      item.addEventListener('click', () => ativarMenuItem(item));
      ancora.parentNode.insertBefore(item, ancora);
    });
}

tabs.forEach((tab) => {
  tab.addEventListener('click', () => {
    tabs.forEach((t) => t.classList.remove('active'));
    tab.classList.add('active');
    abaAtual = tab.dataset.tab;
    dataRef = new Date();
    render();
  });
});

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(options.headers || {}),
    },
  });
  if (res.status === 401) {
    localStorage.removeItem('kyvvo_token');
    window.location.href = '/login';
    return null;
  }
  return res.json();
}

// BUG HISTÓRICO (achado testando o "+" da grade de horários em produção):
// toISOString() sempre converte pra UTC, então "vira o dia" 3h antes da
// meia-noite real de Brasília (21h) — de 21h às 23h59, formatarDataISO(new
// Date()) devolvia a data de AMANHÃ, e como esse valor alimenta direto a
// query de GET /api/agendamentos?data=..., a agenda de Dia/Semana/Mês
// buscava o dia errado nesse intervalo todo santo dia. toLocaleDateString
// com locale sv-SE (formato ISO 8601 nativo do sueco) e timeZone explícito
// resolve isso sem depender do fuso do sistema operacional do navegador.
function formatarDataISO(d) {
  return d.toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
}

function formatarHora(dataHoraISO) {
  const d = new Date(dataHoraISO);
  if (configuracao.formato_hora === '12h') {
    return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'America/Sao_Paulo' });
  }
  return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Sao_Paulo' });
}

function nomeDiaSemana(d) {
  return d.toLocaleDateString('pt-BR', { weekday: 'long', timeZone: 'America/Sao_Paulo' });
}

// "HH:MM" em 24h de um data_hora ISO, sempre nesse formato independente da
// preferência de exibição (formatarHora abaixo) — usado só internamente,
// nunca pra exibir na tela.
function horaChave24h(dataHoraISO) {
  return new Date(dataHoraISO).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Sao_Paulo' });
}

function horarioParaMinutosFrontend(horario) {
  const [h, m] = horario.slice(0, 5).split(':').map(Number);
  return h * 60 + m;
}

// "HH:MM" do início do bucket de SLOT_INTERVALO_MINUTOS em que o horário de
// um agendamento cai — usado pra bater um agendamento com a linha certa da
// grade (Dia/Semana). Com a grade de hora em hora (PR8), um agendamento às
// 14:30 precisa cair na linha "14:00" (não existe linha "14:30"); igualdade
// exata de horaChave24h deixaria esse agendamento sem nenhuma linha pra
// entrar e ele sumiria da grade — a criação de agendamento continua em
// blocos de 30min no backend, só a granularidade de EXIBIÇÃO da grade mudou.
function horaChaveGradeBucket(dataHoraISO) {
  const minutosNoDia = horarioParaMinutosFrontend(horaChave24h(dataHoraISO));
  const bucketMin = Math.floor(minutosNoDia / SLOT_INTERVALO_MINUTOS) * SLOT_INTERVALO_MINUTOS;
  return `${String(Math.floor(bucketMin / 60)).padStart(2, '0')}:${String(bucketMin % 60).padStart(2, '0')}`;
}

// Granularidade da grade de horários (Dia e Semana, PR8) — gera só os
// RÓTULOS "HH:MM" do intervalo abertura→fechamento configurado, excluindo o
// horário de almoço se ativo. Não depende de serviço/profissional (ao
// contrário da disponibilidade real de criação, que continua em blocos de
// 30min no backend), então dá pra montar a grade inteira só com o que já
// está em `configuracao`.
const SLOT_INTERVALO_MINUTOS = 60;
function gerarHorariosGrade() {
  const aberturaMin = horarioParaMinutosFrontend(configuracao.horario_abertura || '08:00');
  const fechamentoMin = horarioParaMinutosFrontend(configuracao.horario_fechamento || '20:00');
  const almocoAtivo = configuracao.horario_almoco_ativo;
  const almocoInicioMin = almocoAtivo ? horarioParaMinutosFrontend(configuracao.horario_almoco_inicio) : null;
  const almocoFimMin = almocoAtivo ? horarioParaMinutosFrontend(configuracao.horario_almoco_fim) : null;

  const horarios = [];
  for (let m = aberturaMin; m < fechamentoMin; m += SLOT_INTERVALO_MINUTOS) {
    if (almocoAtivo && m >= almocoInicioMin && m < almocoFimMin) continue;
    horarios.push(`${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`);
  }
  return horarios;
}

// Anterior/Próximo na view Dia nunca param num dia fora de
// configuracao.dias_funcionamento — pula direto pro próximo dia aberto na
// direção da navegação (+1/-1). Limite de 14 tentativas é só uma trava de
// segurança contra loop infinito se dias_funcionamento vier vazio.
function proximoDiaAberto(base, direcao) {
  const diasFuncionamento = configuracao.dias_funcionamento || [1, 2, 3, 4, 5, 6];
  const d = new Date(base);
  let tentativas = 0;
  while (!diasFuncionamento.includes(d.getDay()) && tentativas < 14) {
    d.setDate(d.getDate() + direcao);
    tentativas++;
  }
  return d;
}

function formatarDataCurta(dataHoraISO) {
  return new Date(dataHoraISO).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'America/Sao_Paulo' });
}

// "DD/MM/YYYY" a partir de uma data pura "YYYY-MM-DD" (sem hora), ex.: as
// datas puladas de uma recorrência (POST /api/agendamentos). Não usa
// formatarDataCurta/Date aqui de propósito: `new Date('YYYY-MM-DD')` é
// interpretado como meia-noite UTC, e convertida de volta pra
// America/Sao_Paulo (-03:00) viraria o dia anterior — bug sutil de fuso que
// esse formatador evita simplesmente reordenando os componentes do texto.
function formatarDataSimples(dataISO) {
  const [ano, mes, dia] = dataISO.split('-');
  return `${dia}/${mes}/${ano}`;
}

// "DD/MM às HH:mm" — usado onde o ano não agrega (próximo atendimento na
// tela de Clientes, sempre num horizonte curto o bastante pra não precisar
// do ano pra desambiguar).
function formatarDataHoraCurta(dataHoraISO) {
  const d = new Date(dataHoraISO);
  const dataStr = d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'America/Sao_Paulo' });
  return `${dataStr} às ${formatarHora(dataHoraISO)}`;
}

// ---------- Toasts ----------
function mostrarToast(mensagem, tipo = 'sucesso') {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.className = 'toast-container';
    document.body.appendChild(container);
  }
  const toast = document.createElement('div');
  toast.className = `toast toast-${tipo}`;
  toast.textContent = (tipo === 'sucesso' ? '✅ ' : '❌ ') + mensagem;
  container.appendChild(toast);
  setTimeout(() => {
    toast.classList.add('toast-saindo');
    setTimeout(() => toast.remove(), 250);
  }, 4000);
}

// ---------- Modal genérico ----------
function escFecharModal(e) {
  if (e.key === 'Escape') fecharModal();
}

function fecharModal() {
  const overlay = document.getElementById('modal-overlay');
  if (overlay) overlay.remove();
  document.removeEventListener('keydown', escFecharModal);
}

function abrirModal(tituloHtml, conteudoHtml, classeExtra) {
  fecharModal();
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-card${classeExtra ? ` ${classeExtra}` : ''}">
      <button class="modal-close" id="modal-close" aria-label="Fechar">✕</button>
      ${tituloHtml}
      ${conteudoHtml}
    </div>
  `;
  document.body.appendChild(overlay);
  document.getElementById('modal-close').addEventListener('click', fecharModal);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) fecharModal(); });
  document.addEventListener('keydown', escFecharModal);
  return overlay;
}

// ---------- Modal: novo agendamento (ST09.1 a ST09.5) ----------
// Ponto de entrada do fluxo de cadastro manual (US09). A ST09.1 entregou o
// botão em destaque na agenda e a abertura do modal; a ST09.2 montou o
// formulário com todos os campos e a validação de obrigatórios com destaque
// visual em vermelho; a ST09.3 integra o dropdown de horário com
// GET /agendamentos/disponibilidade — slots ocupados desabilitados, skeleton
// loader durante a carga e aviso quando não há horário livre na data; a
// ST09.5 (submit) salva via POST /api/agendamentos (origem "portal", que a
// ST09.4 já faz upsert de cliente por telefone), fecha o modal, atualiza a
// agenda e exibe o toast de sucesso.

// Marca em vermelho os campos [data-obrigatorio] vazios e devolve o primeiro
// inválido (ou null se estiver tudo preenchido).
function validarObrigatorios(form) {
  let primeiroInvalido = null;
  form.querySelectorAll('[data-obrigatorio]').forEach((campo) => {
    const vazio = !campo.value || !campo.value.trim();
    campo.classList.toggle('campo-invalido', vazio);
    if (vazio && !primeiroInvalido) primeiroInvalido = campo;
  });
  return primeiroInvalido;
}

function abrirModalNovoAgendamento(prefill) {
  const { data: dataPrefill, hora: horaPrefill, telefone: telefonePrefill, nome: nomePrefill } = prefill || {};
  const hoje = formatarDataISO(new Date());
  abrirModal(
    '<h3>Novo agendamento</h3>',
    `
      <form id="form-novo-agendamento" novalidate>
        <div class="modal-erro" id="novo-ag-erro"></div>

        <label for="novo-ag-telefone">Telefone *</label>
        <input type="tel" id="novo-ag-telefone" data-obrigatorio placeholder="11999999999" autocomplete="off" value="${telefonePrefill || ''}">
        <div class="campo-aviso" id="novo-ag-cliente-aviso"></div>

        <label for="novo-ag-nome">Nome do cliente *</label>
        <input type="text" id="novo-ag-nome" data-obrigatorio autocomplete="off" value="${nomePrefill || ''}">

        <label for="novo-ag-servico">Serviço *</label>
        <select id="novo-ag-servico" data-obrigatorio><option value="">Carregando serviços...</option></select>

        <label for="novo-ag-profissional">Profissional *</label>
        <select id="novo-ag-profissional" data-obrigatorio><option value="">Carregando profissionais...</option></select>

        <label for="novo-ag-data">Data *</label>
        <input type="date" id="novo-ag-data" min="${hoje}" value="${dataPrefill || ''}" data-obrigatorio>

        <label for="novo-ag-horario">Horário *</label>
        <select id="novo-ag-horario" data-obrigatorio><option value="">Selecione serviço, profissional e data</option></select>
        <div class="skeleton-horario" id="novo-ag-horario-skeleton" hidden aria-hidden="true"></div>
        <div class="campo-aviso" id="novo-ag-horario-aviso"></div>

        <label for="novo-ag-observacoes">Observações</label>
        <textarea id="novo-ag-observacoes" rows="3" placeholder="Anotações internas sobre o agendamento"></textarea>

        <label class="toggle-linha">
          <span class="toggle-switch">
            <input type="checkbox" id="novo-ag-recorrencia-switch">
            <span class="toggle-switch-trilho"></span>
          </span>
          Recorrência
        </label>

        <div id="novo-ag-recorrencia-campos" style="display:none">
          <label for="novo-ag-recorrencia-tipo">Repetir</label>
          <select id="novo-ag-recorrencia-tipo">
            <option value="">Selecione...</option>
            <option value="semanal">Semanal</option>
            <option value="quinzenal">Quinzenal</option>
            <option value="mensal">Mensal</option>
          </select>

          <div id="novo-ag-recorrencia-ate-wrapper" style="display:none">
            <label for="novo-ag-recorrencia-ate">Repetir até *</label>
            <input type="date" id="novo-ag-recorrencia-ate" min="${hoje}">
          </div>
        </div>

        <div class="modal-acoes">
          <button type="button" class="btn-secundario" id="btn-cancelar-novo-ag">Cancelar</button>
          <button type="submit" class="btn-primario" id="btn-salvar-novo-ag">Salvar agendamento</button>
        </div>
      </form>
    `
  );

  const form = document.getElementById('form-novo-agendamento');
  const erroEl = document.getElementById('novo-ag-erro');

  document.getElementById('btn-cancelar-novo-ag').addEventListener('click', fecharModal);

  // Recorrência: o switch revela "Repetir" (tipo); só depois de escolher um
  // tipo é que "Repetir até" aparece — mesma progressão descrita pelo Bruno
  // (habilitar > escolher frequência > só então informar o limite).
  document.getElementById('novo-ag-recorrencia-switch').addEventListener('change', (e) => {
    document.getElementById('novo-ag-recorrencia-campos').style.display = e.target.checked ? 'block' : 'none';
    if (!e.target.checked) {
      document.getElementById('novo-ag-recorrencia-tipo').value = '';
      document.getElementById('novo-ag-recorrencia-ate-wrapper').style.display = 'none';
      document.getElementById('novo-ag-recorrencia-ate').value = '';
    }
  });
  document.getElementById('novo-ag-recorrencia-tipo').addEventListener('change', (e) => {
    document.getElementById('novo-ag-recorrencia-ate-wrapper').style.display = e.target.value ? 'block' : 'none';
    if (!e.target.value) document.getElementById('novo-ag-recorrencia-ate').value = '';
  });

  // Ao corrigir um campo, remove o destaque vermelho imediatamente.
  form.querySelectorAll('[data-obrigatorio]').forEach((campo) => {
    const limpar = () => campo.classList.remove('campo-invalido');
    campo.addEventListener('input', limpar);
    campo.addEventListener('change', limpar);
  });

  // Telefone já é chave única por tenant na tabela clientes (001_init.sql) —
  // ao digitar um telefone já cadastrado, carrega o nome existente
  // automaticamente. Evita redigitar o nome de um cliente recorrente e evita
  // que um nome digitado errado sobrescreva o nome já salvo (POST
  // /api/agendamentos faz ON CONFLICT DO UPDATE do nome pelo telefone).
  const nomeInput = document.getElementById('novo-ag-nome');
  const telefoneInput = document.getElementById('novo-ag-telefone');
  const clienteAvisoEl = document.getElementById('novo-ag-cliente-aviso');
  let buscaClienteTimeout;
  let ultimoTelefoneBuscado = '';
  telefoneInput.addEventListener('input', () => {
    clearTimeout(buscaClienteTimeout);
    const digitos = telefoneInput.value.replace(/\D/g, '');
    if (digitos === ultimoTelefoneBuscado) return;
    clienteAvisoEl.textContent = '';
    if (digitos.length < 10) return;
    buscaClienteTimeout = setTimeout(async () => {
      ultimoTelefoneBuscado = digitos;
      const resultado = await api(`/api/clientes/buscar-por-telefone?telefone=${digitos}`);
      if (resultado && resultado.cliente) {
        nomeInput.value = resultado.cliente.nome || '';
        clienteAvisoEl.textContent = 'Cliente já cadastrado — nome carregado automaticamente.';
      }
    }, 400);
  });

  // Popula serviços (reutiliza GET /api/servicos, como no encaixe da ST08.6).
  // Serviços desabilitados (PR4/US17) continuam existindo mas não são
  // oferecidos pra novos agendamentos.
  let servicosCarregados = [];
  api('/api/servicos').then((resultado) => {
    const select = document.getElementById('novo-ag-servico');
    if (!resultado || !resultado.servicos) {
      select.innerHTML = '<option value="">Erro ao carregar serviços</option>';
      return;
    }
    servicosCarregados = resultado.servicos;
    const disponiveis = servicosCarregados.filter((s) => s.ativo !== false);
    select.innerHTML = '<option value="">Selecione...</option>' +
      disponiveis.map((s) => `<option value="${s.id}">${s.nome} (${s.duracao_minutos}min)</option>`).join('');
  });

  // Popula profissionais (GET /api/profissionais). Fora do plano Custom o
  // tenant tem 1 único profissional (garantido pelo backend) — nesse caso o
  // campo some do formulário: escolher entre uma única opção não é uma
  // decisão real do usuário. Só reaparece quando há 2+ (plano Custom).
  const labelProfissional = document.querySelector('label[for="novo-ag-profissional"]');
  const selectProfissional = document.getElementById('novo-ag-profissional');
  api('/api/profissionais').then((resultado) => {
    if (!resultado || !resultado.profissionais) {
      selectProfissional.innerHTML = '<option value="">Erro ao carregar profissionais</option>';
      return;
    }
    const profissionais = resultado.profissionais;
    selectProfissional.innerHTML = '<option value="">Selecione...</option>' +
      profissionais.map((p) => `<option value="${p.id}">${p.nome}</option>`).join('');
    if (profissionais.length <= 1) {
      // `label { display: block }` (style.css) é regra de autor e vence o
      // `[hidden]` do user-agent stylesheet independente de especificidade
      // (mesma pegadinha já documentada em .cadastro-plano[hidden]) — por
      // isso o display:none precisa ser explícito aqui, não só o atributo.
      labelProfissional.hidden = true;
      labelProfissional.style.display = 'none';
      selectProfissional.hidden = true;
      selectProfissional.style.display = 'none';
      selectProfissional.removeAttribute('data-obrigatorio');
      if (profissionais.length === 1) {
        selectProfissional.value = profissionais[0].id;
        selectProfissional.dispatchEvent(new Event('change'));
      }
    }
  });

  // Profissional preferencial (PR4/US17): escolher um serviço que tenha um
  // marcado pré-seleciona ele no campo Profissional — o usuário ainda pode
  // trocar manualmente depois. Registrado antes do listener de
  // carregarSlotsNovoAgendamento (abaixo) pra já valer na mesma mudança.
  document.getElementById('novo-ag-servico').addEventListener('change', () => {
    const servico = servicosCarregados.find((s) => s.id === document.getElementById('novo-ag-servico').value);
    if (!servico || !servico.profissional_preferencial_id) return;
    const profissionalSelect = document.getElementById('novo-ag-profissional');
    if ([...profissionalSelect.options].some((o) => o.value === servico.profissional_preferencial_id)) {
      profissionalSelect.value = servico.profissional_preferencial_id;
    }
  });

  // ST09.3 — Carrega os slots reais de GET /agendamentos/disponibilidade sempre
  // que serviço, profissional e data estiverem selecionados (os três parâmetros
  // exigidos pelo endpoint; o serviço define a duração usada para montar os
  // slots). Reutiliza o mesmo endpoint da ST08.2 e o helper popularSelectHorarios
  // do reagendamento/encaixe. Slots ocupados ficam desabilitados com "(ocupado)".
  async function carregarSlotsNovoAgendamento() {
    const servicoId = document.getElementById('novo-ag-servico').value;
    const profissionalId = document.getElementById('novo-ag-profissional').value;
    const data = document.getElementById('novo-ag-data').value;
    const select = document.getElementById('novo-ag-horario');
    const skeleton = document.getElementById('novo-ag-horario-skeleton');
    const aviso = document.getElementById('novo-ag-horario-aviso');

    aviso.textContent = '';

    if (!servicoId || !profissionalId || !data) {
      select.hidden = false;
      skeleton.hidden = true;
      select.innerHTML = '<option value="">Selecione serviço, profissional e data</option>';
      return;
    }

    // Skeleton loader (CA08): esconde o select e mostra a barra de carregamento.
    select.hidden = true;
    select.innerHTML = '<option value="">Carregando horários...</option>';
    skeleton.hidden = false;

    // O select e o skeleton precisam voltar ao estado visível mesmo se a
    // chamada falhar (erro de rede, backend fora do ar etc.) — sem o
    // try/finally, uma falha aqui deixava o dropdown escondido pra sempre e o
    // formulário ficava impossível de preencher/salvar.
    let disponibilidade;
    try {
      disponibilidade = await api(
        `/api/agendamentos/disponibilidade?data=${data}&profissional=${profissionalId}&servico=${servicoId}`
      );
    } catch (erro) {
      disponibilidade = null;
    } finally {
      skeleton.hidden = true;
      select.hidden = false;
    }

    if (!disponibilidade || disponibilidade.error || !Array.isArray(disponibilidade.slots)) {
      select.innerHTML = '<option value="">Erro ao carregar horários</option>';
      aviso.textContent = (disponibilidade && disponibilidade.error) || 'Não foi possível carregar os horários. Tente novamente.';
      return;
    }

    // CA03: sem nenhum horário livre na data selecionada.
    if (!disponibilidade.slots.some((s) => s.disponivel)) {
      select.innerHTML = '<option value="">Nenhum horário disponível</option>';
      aviso.textContent = 'Nenhum horário disponível nesta data. Tente outra data.';
      return;
    }

    popularSelectHorarios(select, disponibilidade.slots);
    // Hover "+" na grade de Dia/Semana (PR2/PR3) pode pré-preencher um
    // horário específico — prefere esse horário se ele seguir disponível,
    // em vez do primeiro disponível que popularSelectHorarios já selecionou.
    if (horaPrefill) {
      const alvo = disponibilidade.slots.find((s) => s.disponivel && horaChave24h(s.hora) === horaPrefill);
      if (alvo) select.value = alvo.hora;
    }
    // O valor é definido programaticamente (não dispara "change"), então limpa
    // o destaque de erro manualmente caso a validação já o tivesse marcado.
    select.classList.remove('campo-invalido');
  }

  ['novo-ag-servico', 'novo-ag-profissional', 'novo-ag-data'].forEach((id) => {
    document.getElementById(id).addEventListener('change', carregarSlotsNovoAgendamento);
  });
  // O calendário nativo já dispara "change" ao escolher uma data. Para quem
  // prefere digitar a data direto no campo, o "input" garante que os horários
  // recarreguem assim que a data digitada ficar completa/válida, sem precisar
  // esperar o campo perder o foco.
  document.getElementById('novo-ag-data').addEventListener('input', carregarSlotsNovoAgendamento);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    erroEl.textContent = '';
    const invalido = validarObrigatorios(form);
    if (invalido) {
      erroEl.textContent = 'Preencha os campos obrigatórios destacados em vermelho.';
      invalido.focus();
      return;
    }

    // Recorrência: só entra no payload se o switch estiver ligado E um tipo
    // tiver sido escolhido — "Repetir até" é obrigatório nesse caso (CA do
    // Bruno), validado aqui porque não tem data-obrigatorio (só existe/é
    // exigido condicionalmente, ao contrário dos campos sempre obrigatórios
    // de cima que validarObrigatorios já cobre).
    let recorrencia;
    if (document.getElementById('novo-ag-recorrencia-switch').checked) {
      const tipo = document.getElementById('novo-ag-recorrencia-tipo').value;
      if (!tipo) {
        erroEl.textContent = 'Selecione a frequência da recorrência.';
        document.getElementById('novo-ag-recorrencia-tipo').focus();
        return;
      }
      const ateInput = document.getElementById('novo-ag-recorrencia-ate');
      const dataAgendamento = document.getElementById('novo-ag-data').value;
      if (!ateInput.value) {
        erroEl.textContent = 'Informe até quando a recorrência deve se repetir.';
        ateInput.classList.add('campo-invalido');
        ateInput.focus();
        return;
      }
      if (ateInput.value <= dataAgendamento) {
        erroEl.textContent = 'A data de "Repetir até" deve ser depois da data do agendamento.';
        ateInput.classList.add('campo-invalido');
        ateInput.focus();
        return;
      }
      recorrencia = { tipo, ate: ateInput.value };
    }

    const btn = document.getElementById('btn-salvar-novo-ag');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>';

    const resultado = await api('/api/agendamentos', {
      method: 'POST',
      body: JSON.stringify({
        cliente_nome: document.getElementById('novo-ag-nome').value.trim(),
        cliente_telefone: document.getElementById('novo-ag-telefone').value.trim(),
        servico_id: document.getElementById('novo-ag-servico').value,
        profissional_id: document.getElementById('novo-ag-profissional').value,
        data_hora: document.getElementById('novo-ag-horario').value,
        observacoes: document.getElementById('novo-ag-observacoes').value.trim() || null,
        recorrencia,
        origem: 'portal',
      }),
    });

    if (resultado && !resultado.error) {
      fecharModal();
      // Recorrência (US: switch "Recorrência") — a resposta já vem com quantas
      // ocorrências extras foram criadas e quais foram puladas por conflito;
      // um segundo toast avisa isso separado do toast de sucesso, sem travar
      // o fluxo (as demais ocorrências já foram criadas normalmente).
      if (resultado.recorrencia) {
        const { criados, pulados, limite_atingido: limiteAtingido } = resultado.recorrencia;
        const repeticoesCriadas = criados === 1 ? '1 repetição criada' : `${criados} repetições criadas`;
        mostrarToast(`Agendamento cadastrado — ${repeticoesCriadas}.`, 'sucesso');
        if (pulados && pulados.length) {
          const datas = pulados.map((p) => formatarDataSimples(p.data)).join(', ');
          const repeticoesPuladas = pulados.length === 1 ? '1 repetição pulada' : `${pulados.length} repetições puladas`;
          mostrarToast(`${repeticoesPuladas} por conflito: ${datas}.`, 'erro');
        }
        if (limiteAtingido) {
          mostrarToast('Limite de repetições atingido — ajuste a data "Repetir até" se precisar de mais datas.', 'erro');
        }
      } else {
        mostrarToast('Agendamento cadastrado com sucesso.', 'sucesso');
      }
      render();
    } else {
      erroEl.textContent = (resultado && resultado.error) || 'Erro ao salvar agendamento.';
      btn.disabled = false;
      btn.textContent = 'Salvar agendamento';
    }
  });
}

document.getElementById('btn-novo-agendamento').addEventListener('click', () => abrirModalNovoAgendamento());

// ---------- Modal: concluir atendimento (US64) ----------
// Marca o agendamento como concluído — converte a receita prevista do
// lançamento financeiro vinculado em realizada (CA "Cenário 5"), feito no
// backend por sincronizarLancamentoFinanceiro dentro do mesmo PATCH.
function abrirModalConcluir(ag) {
  abrirModal(
    '<h3>Concluir atendimento</h3>',
    `
      <p class="modal-texto">Confirmar que o atendimento de <strong>${ag.cliente || ag.cliente_telefone}</strong> — ${ag.servico} — ${formatarDataCurta(ag.data_hora)} às ${formatarHora(ag.data_hora)} foi concluído?</p>
      <div class="modal-acoes">
        <button class="btn-secundario" id="btn-voltar-concluir">Voltar</button>
        <button class="btn-primario" id="btn-confirmar-concluir">Confirmar conclusão</button>
      </div>
    `
  );

  document.getElementById('btn-voltar-concluir').addEventListener('click', fecharModal);
  document.getElementById('btn-confirmar-concluir').addEventListener('click', async () => {
    const btn = document.getElementById('btn-confirmar-concluir');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>';

    const resultado = await api(`/api/agendamentos/${ag.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'concluido' }),
    });

    if (resultado && !resultado.error) {
      fecharModal();
      mostrarToast('Agendamento atualizado com sucesso.', 'sucesso');
      render();
    } else {
      mostrarToast((resultado && resultado.error) || 'Erro ao concluir agendamento.', 'erro');
      btn.disabled = false;
      btn.textContent = 'Confirmar conclusão';
    }
  });
}

// ---------- Modal: marcar falta (no-show) ----------
// Distinto de cancelar: falta é quando o cliente simplesmente não apareceu,
// não uma decisão avisada com antecedência — sincronizarLancamentoFinanceiro
// (backend) trata os dois igual pro financeiro (a receita prevista não
// acontece de qualquer jeito), mas o status do agendamento fica separado
// pra medir taxa de comparecimento e faturamento perdido por no-show no
// menu Relatórios.
function abrirModalMarcarFalta(ag) {
  abrirModal(
    '<h3>Marcar falta</h3>',
    `
      <p class="modal-texto">Confirmar que <strong>${ag.cliente || ag.cliente_telefone}</strong> não compareceu ao atendimento de ${ag.servico} — ${formatarDataCurta(ag.data_hora)} às ${formatarHora(ag.data_hora)}?</p>
      <div class="modal-acoes">
        <button class="btn-secundario" id="btn-voltar-falta">Voltar</button>
        <button class="btn-primario" id="btn-confirmar-falta">Confirmar falta</button>
      </div>
    `
  );

  document.getElementById('btn-voltar-falta').addEventListener('click', fecharModal);
  document.getElementById('btn-confirmar-falta').addEventListener('click', async () => {
    const btn = document.getElementById('btn-confirmar-falta');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>';

    const resultado = await api(`/api/agendamentos/${ag.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'falta' }),
    });

    if (resultado && !resultado.error) {
      fecharModal();
      mostrarToast('Falta registrada.', 'sucesso');
      render();
    } else {
      mostrarToast((resultado && resultado.error) || 'Erro ao registrar falta.', 'erro');
      btn.disabled = false;
      btn.textContent = 'Confirmar falta';
    }
  });
}

// ---------- Modal: cancelamento (ST08.4) ----------
function abrirModalCancelar(ag) {
  abrirModal(
    '<h3>Cancelar agendamento</h3>',
    `
      <p class="modal-texto">Tem certeza que deseja cancelar o agendamento de <strong>${ag.cliente || ag.cliente_telefone}</strong> — ${ag.servico} — ${formatarDataCurta(ag.data_hora)} às ${formatarHora(ag.data_hora)}?</p>
      <div class="modal-acoes">
        <button class="btn-secundario" id="btn-voltar-cancelar">Voltar</button>
        <button class="btn-perigo" id="btn-confirmar-cancelar">Confirmar cancelamento</button>
      </div>
    `
  );

  document.getElementById('btn-voltar-cancelar').addEventListener('click', fecharModal);
  document.getElementById('btn-confirmar-cancelar').addEventListener('click', async () => {
    const btn = document.getElementById('btn-confirmar-cancelar');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>';

    const resultado = await api(`/api/agendamentos/${ag.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'cancelado' }),
    });

    if (resultado && !resultado.error) {
      fecharModal();
      mostrarToast('Agendamento atualizado com sucesso.', 'sucesso');
      render();
    } else {
      mostrarToast((resultado && resultado.error) || 'Erro ao cancelar agendamento.', 'erro');
      btn.disabled = false;
      btn.textContent = 'Confirmar cancelamento';
    }
  });
}

// ---------- Modal: reagendamento (ST08.5) ----------
function popularSelectHorarios(select, slots, bloquearOcupado = true) {
  select.innerHTML = slots
    .map((s) => `<option value="${s.hora}" ${!s.disponivel && bloquearOcupado ? 'disabled' : ''}>${formatarHora(s.hora)}${!s.disponivel ? ' (ocupado)' : ''}</option>`)
    .join('');
  const primeiraSelecionavel = bloquearOcupado ? slots.find((s) => s.disponivel) : slots[0];
  if (primeiraSelecionavel) select.value = primeiraSelecionavel.hora;
  return !!primeiraSelecionavel;
}

function abrirModalReagendar(ag) {
  const hoje = formatarDataISO(new Date());
  abrirModal(
    '<h3>Reagendar</h3>',
    `
      <div class="modal-erro" id="reagendar-erro"></div>
      <label for="reagendar-data">Nova data</label>
      <input type="date" id="reagendar-data" min="${hoje}" value="${ag.data_hora.slice(0, 10)}">
      <label for="reagendar-horario">Novo horário</label>
      <select id="reagendar-horario"><option>Carregando horários...</option></select>
      <div class="modal-acoes">
        <button class="btn-secundario" id="btn-voltar-reagendar">Voltar</button>
        <button class="btn-primario" id="btn-confirmar-reagendar" disabled>Confirmar</button>
      </div>
    `
  );

  document.getElementById('btn-voltar-reagendar').addEventListener('click', fecharModal);

  async function carregarSlots() {
    const data = document.getElementById('reagendar-data').value;
    const select = document.getElementById('reagendar-horario');
    const btnConfirmar = document.getElementById('btn-confirmar-reagendar');
    select.innerHTML = '<option>Carregando horários...</option>';
    btnConfirmar.disabled = true;

    const disponibilidade = await api(`/api/agendamentos/disponibilidade?data=${data}&profissional=${ag.profissional_id}&servico=${ag.servico_id}`);
    if (!disponibilidade || disponibilidade.error) {
      select.innerHTML = '<option>Erro ao carregar horários</option>';
      return;
    }
    btnConfirmar.disabled = !popularSelectHorarios(select, disponibilidade.slots);
  }

  document.getElementById('reagendar-data').addEventListener('change', carregarSlots);
  document.getElementById('reagendar-horario').addEventListener('change', (e) => {
    const opt = e.target.selectedOptions[0];
    document.getElementById('btn-confirmar-reagendar').disabled = !opt || opt.disabled;
  });

  document.getElementById('btn-confirmar-reagendar').addEventListener('click', async () => {
    const erroEl = document.getElementById('reagendar-erro');
    erroEl.textContent = '';
    const btn = document.getElementById('btn-confirmar-reagendar');
    btn.disabled = true;
    btn.textContent = 'Confirmando...';

    const resultado = await api(`/api/agendamentos/${ag.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ data_hora: document.getElementById('reagendar-horario').value }),
    });

    if (resultado && !resultado.error) {
      fecharModal();
      mostrarToast('Agendamento atualizado com sucesso.', 'sucesso');
      render();
    } else {
      erroEl.textContent = (resultado && resultado.error) || 'Erro ao reagendar.';
      btn.disabled = false;
      btn.textContent = 'Confirmar';
    }
  });

  carregarSlots();
}

// ---------- Modal: encaixe (ST08.6) ----------
function abrirModalEncaixe(ag) {
  const hoje = formatarDataISO(new Date());
  abrirModal(
    `<h3>Encaixe${contaStatus && contaStatus.mostrar_profissional ? ` — ${ag.profissional}` : ''}</h3>`,
    `
      <div class="modal-erro" id="encaixe-erro"></div>
      <label for="encaixe-nome">Nome do cliente (opcional)</label>
      <input type="text" id="encaixe-nome">
      <label for="encaixe-whatsapp">WhatsApp</label>
      <input type="tel" id="encaixe-whatsapp" placeholder="11999999999">
      <label for="encaixe-servico">Serviço</label>
      <select id="encaixe-servico"><option value="">Carregando serviços...</option></select>
      <label for="encaixe-data">Data</label>
      <input type="date" id="encaixe-data" min="${hoje}" value="${ag.data_hora.slice(0, 10)}">
      <label for="encaixe-horario">Horário</label>
      <select id="encaixe-horario"><option>Selecione um serviço primeiro</option></select>
      <p class="modal-texto">Encaixe pode sobrepor um horário já ocupado — os marcados "(ocupado)" continuam selecionáveis de propósito.</p>
      <div class="modal-acoes">
        <button class="btn-secundario" id="btn-voltar-encaixe">Voltar</button>
        <button class="btn-primario" id="btn-confirmar-encaixe" disabled>Confirmar encaixe</button>
      </div>
    `
  );

  document.getElementById('btn-voltar-encaixe').addEventListener('click', fecharModal);

  async function carregarSlotsEncaixe() {
    const servicoId = document.getElementById('encaixe-servico').value;
    const data = document.getElementById('encaixe-data').value;
    const selectHorario = document.getElementById('encaixe-horario');
    const btnConfirmar = document.getElementById('btn-confirmar-encaixe');
    if (!servicoId) {
      selectHorario.innerHTML = '<option>Selecione um serviço primeiro</option>';
      btnConfirmar.disabled = true;
      return;
    }
    selectHorario.innerHTML = '<option>Carregando horários...</option>';
    btnConfirmar.disabled = true;

    const disponibilidade = await api(`/api/agendamentos/disponibilidade?data=${data}&profissional=${ag.profissional_id}&servico=${servicoId}`);
    if (!disponibilidade || disponibilidade.error) {
      selectHorario.innerHTML = '<option>Erro ao carregar horários</option>';
      return;
    }
    btnConfirmar.disabled = !popularSelectHorarios(selectHorario, disponibilidade.slots, false);
  }

  api('/api/servicos').then((resultado) => {
    const select = document.getElementById('encaixe-servico');
    if (!resultado || !resultado.servicos) {
      select.innerHTML = '<option value="">Erro ao carregar serviços</option>';
      return;
    }
    select.innerHTML = '<option value="">Selecione...</option>' +
      resultado.servicos.map((s) => `<option value="${s.id}">${s.nome} (${s.duracao_minutos}min)</option>`).join('');
  });

  document.getElementById('encaixe-servico').addEventListener('change', carregarSlotsEncaixe);
  document.getElementById('encaixe-data').addEventListener('change', carregarSlotsEncaixe);
  document.getElementById('encaixe-horario').addEventListener('change', (e) => {
    const opt = e.target.selectedOptions[0];
    document.getElementById('btn-confirmar-encaixe').disabled = !opt || opt.disabled;
  });

  document.getElementById('btn-confirmar-encaixe').addEventListener('click', async () => {
    const erroEl = document.getElementById('encaixe-erro');
    erroEl.textContent = '';
    const whatsapp = document.getElementById('encaixe-whatsapp').value.trim();
    if (!whatsapp) {
      erroEl.textContent = 'Informe o WhatsApp do cliente.';
      return;
    }
    const btn = document.getElementById('btn-confirmar-encaixe');
    btn.disabled = true;
    btn.textContent = 'Confirmando...';

    const resultado = await api('/api/agendamentos', {
      method: 'POST',
      body: JSON.stringify({
        cliente_nome: document.getElementById('encaixe-nome').value.trim() || null,
        cliente_telefone: whatsapp,
        profissional_id: ag.profissional_id,
        servico_id: document.getElementById('encaixe-servico').value,
        data_hora: document.getElementById('encaixe-horario').value,
        encaixe: true,
      }),
    });

    if (resultado && !resultado.error) {
      fecharModal();
      mostrarToast('Agendamento atualizado com sucesso.', 'sucesso');
      render();
    } else {
      erroEl.textContent = (resultado && resultado.error) || 'Erro ao criar encaixe.';
      btn.disabled = false;
      btn.textContent = 'Confirmar encaixe';
    }
  });

  carregarSlotsEncaixe();
}

// ---------- Menu de ações inline (ST08.3) ----------
let agendamentosAtuais = [];

function renderAgendamentoItem(ag) {
  const cancelado = ag.status === 'cancelado';
  // US64 — concluído também não tem mais o que fazer (mesmo raciocínio do
  // cancelado): sem menu de ações, só o badge indicando o estado final.
  const concluido = ag.status === 'concluido';
  // Falta (no-show, migration 060) é estado final igual concluído/cancelado
  // — nada mais a fazer com um agendamento já marcado como falta.
  const falta = ag.status === 'falta';
  const semAcoes = cancelado || concluido || falta;
  return `
    <div class="agendamento-item${cancelado ? ' agendamento-cancelado' : ''}" data-id="${ag.id}">
      <div class="agendamento-linha-principal" ${semAcoes ? '' : `data-acoes-toggle="${ag.id}"`}>
        <div>
          <div class="agendamento-hora">${formatarHora(ag.data_hora)} — ${ag.servico}</div>
          <div class="agendamento-detalhe">
            ${ag.cliente || ag.cliente_telefone}${contaStatus && contaStatus.mostrar_profissional ? ` · ${ag.profissional}` : ''} · ${ag.duracao_minutos}min
            ${ag.encaixe ? '<span class="badge badge-encaixe">Encaixe</span>' : ''}
            ${cancelado ? '<span class="badge badge-cancelado">Cancelado</span>' : ''}
            ${concluido ? '<span class="badge badge-concluido">Concluído</span>' : ''}
            ${falta ? '<span class="badge badge-falta">Falta</span>' : ''}
          </div>
        </div>
        ${semAcoes ? '' : '<button class="btn-acoes" aria-label="Ações">⋮</button>'}
      </div>
      ${semAcoes ? '' : `
        <div class="menu-acoes" id="menu-acoes-${ag.id}">
          <button data-acao="concluir" data-id="${ag.id}">Concluir</button>
          <button data-acao="reagendar" data-id="${ag.id}">Reagendar</button>
          <button data-acao="encaixar" data-id="${ag.id}">Encaixar</button>
          <button data-acao="falta" data-id="${ag.id}">Marcar falta</button>
          <button data-acao="cancelar" data-id="${ag.id}" class="acao-perigo">Cancelar</button>
        </div>
      `}
    </div>
  `;
}

conteudo.addEventListener('click', (e) => {
  // "Cliente" nos Próximos atendimentos do Início, e qualquer linha da
  // tabela do menu Clientes — abrem o mesmo modal de perfil
  // (abrirModalClienteDetalhe).
  const clienteItemEl = e.target.closest('[data-cliente-id]');
  if (clienteItemEl) {
    abrirModalClienteDetalhe(clienteItemEl.dataset.clienteId);
    return;
  }
  // Botão WhatsApp na tabela de Clientes — checado antes de
  // data-cliente-abrir (fica dentro da mesma <tr data-cliente-abrir>), senão
  // o clique também abriria o perfil junto.
  const whatsappClienteBtn = e.target.closest('[data-cliente-whatsapp]');
  if (whatsappClienteBtn) {
    window.open(`https://wa.me/${whatsappClienteBtn.dataset.clienteWhatsapp}`, '_blank');
    return;
  }
  const linhaClienteEl = e.target.closest('[data-cliente-abrir]');
  if (linhaClienteEl) {
    abrirModalClienteDetalhe(linhaClienteEl.dataset.clienteAbrir);
    return;
  }

  // Menu Clientes — pills de filtro por status (Todos/Ativos/Novos/Inativos).
  const statusClienteBtn = e.target.closest('[data-clientes-status]');
  if (statusClienteBtn) {
    clientesFiltro.status = statusClienteBtn.dataset.clientesStatus;
    clientesFiltro.pagina = 1;
    clientesCampoFocado = null;
    renderClientes();
    return;
  }
  const paginaClientesBtn = e.target.closest('[data-clientes-pagina]');
  if (paginaClientesBtn) {
    if (paginaClientesBtn.dataset.clientesPagina === 'anterior') clientesFiltro.pagina--;
    else clientesFiltro.pagina++;
    clientesCampoFocado = null;
    renderClientes();
    return;
  }

  // US63 — atalhos e ações de pendência do dashboard (Início) navegam
  // direto pro menu de destino.
  const atalhoInicioBtn = e.target.closest('[data-acao-atalho-inicio]');
  if (atalhoInicioBtn) {
    selecionarMenu(atalhoInicioBtn.dataset.acaoAtalhoInicio);
    return;
  }

  // "Conversa" na lista de Próximos atendimentos do Início — abre o
  // WhatsApp direto com o número do cliente (telefone já normalizado com
  // DDI 55, formato que o wa.me espera).
  const conversaInicioBtn = e.target.closest('[data-acao-inicio-conversa]');
  if (conversaInicioBtn) {
    const telefone = conversaInicioBtn.dataset.acaoInicioConversa;
    if (telefone) window.open(`https://wa.me/${telefone}`, '_blank');
    return;
  }

  // Paginação (3 por página) da lista de Próximos atendimentos do Início —
  // reusa a lista já carregada em memória, sem precisar rebuscar a API.
  const paginaInicioBtn = e.target.closest('[data-inicio-pagina]');
  if (paginaInicioBtn) {
    if (paginaInicioBtn.dataset.inicioPagina === 'anterior') inicioPaginaAtendimentos--;
    else inicioPaginaAtendimentos++;
    const corpo = document.getElementById('inicio-secao-proximos-corpo');
    if (corpo) corpo.innerHTML = renderInicioProximosCorpo();
    return;
  }

  // US71 — abas Mês/Semana/Dia do Financeiro.
  const tabFinanceiro = e.target.closest('[data-financeiro-aba]');
  if (tabFinanceiro) {
    abaFinanceiroAtiva = tabFinanceiro.dataset.financeiroAba;
    renderFinanceiro();
    return;
  }

  // Pills de filtro por tipo (Todas/Receitas/Despesas) nas Movimentações.
  const tipoLancamentoBtn = e.target.closest('[data-financeiro-filtro-tipo]');
  if (tipoLancamentoBtn) {
    financeiroFiltroTipo = tipoLancamentoBtn.dataset.financeiroFiltroTipo;
    financeiroCampoFocado = null;
    renderFinanceiro();
    return;
  }

  // US70/CA03+US71/CA05 — cards do resumo financeiro na tela inicial abrem
  // o Financeiro já na aba/referência do card clicado (hoje → aba Dia, mês → aba Mês).
  const cardFinanceiroBtn = e.target.closest('[data-card-financeiro-nav]');
  if (cardFinanceiroBtn) {
    abrirFinanceiroComFiltro(cardFinanceiroBtn.dataset.financeiroPeriodo, cardFinanceiroBtn.dataset.financeiroReferencia);
    return;
  }

  // "+" ao passar o mouse numa linha de horário (Dia/Semana) ou numa
  // célula de dia (Semana/Mês) — abre Novo agendamento pré-preenchido.
  const addHorarioBtn = e.target.closest('[data-add-horario]');
  if (addHorarioBtn) {
    abrirModalNovoAgendamento({ data: addHorarioBtn.dataset.data, hora: addHorarioBtn.dataset.addHorario });
    return;
  }
  const addDiaBtn = e.target.closest('[data-add-dia]');
  if (addDiaBtn) {
    abrirModalNovoAgendamento({ data: addDiaBtn.dataset.addDia });
    return;
  }

  const toggleEl = e.target.closest('[data-acoes-toggle]');
  if (toggleEl) {
    const id = toggleEl.dataset.acoesToggle;
    const menu = document.getElementById(`menu-acoes-${id}`);
    const jaAberto = menu.classList.contains('aberto');
    document.querySelectorAll('.menu-acoes.aberto').forEach((m) => m.classList.remove('aberto'));
    if (!jaAberto) menu.classList.add('aberto');
    return;
  }

  const acaoBtn = e.target.closest('[data-acao]');
  if (acaoBtn) {
    document.querySelectorAll('.menu-acoes.aberto').forEach((m) => m.classList.remove('aberto'));
    const ag = agendamentosAtuais.find((a) => a.id === acaoBtn.dataset.id);
    if (!ag) return;
    if (acaoBtn.dataset.acao === 'concluir') abrirModalConcluir(ag);
    if (acaoBtn.dataset.acao === 'cancelar') abrirModalCancelar(ag);
    if (acaoBtn.dataset.acao === 'reagendar') abrirModalReagendar(ag);
    if (acaoBtn.dataset.acao === 'encaixar') abrirModalEncaixe(ag);
    if (acaoBtn.dataset.acao === 'falta') abrirModalMarcarFalta(ag);
  }

  // Menu de ações por linha de lançamento no Financeiro — todo lançamento
  // não-cancelado tem menu agora (ver menuAcoesLancamento/renderLancamentoItem):
  // Confirmar/Cancelar pagamento/Reagendar só em agendamento ainda previsto;
  // Editar em qualquer um; Cancelar despesa só em saída manual.
  const acaoLancamentoBtn = e.target.closest('[data-acao-lancamento]');
  if (acaoLancamentoBtn) {
    document.querySelectorAll('.menu-acoes.aberto').forEach((m) => m.classList.remove('aberto'));
    const l = lancamentosAtuais.find((x) => x.id === acaoLancamentoBtn.dataset.id);
    if (!l) return;
    const acao = acaoLancamentoBtn.dataset.acaoLancamento;
    if (acao === 'confirmar') confirmarPagamentoLancamento(l);
    if (acao === 'cancelar') abrirModalCancelarPagamentoLancamento(l);
    if (acao === 'editar') abrirModalEditarLancamento(l);
    if (acao === 'cancelar-despesa') abrirModalCancelarDespesaLancamento(l);
    if (acao === 'reagendar') {
      abrirModalReagendar({ id: l.agendamento_id, data_hora: l.data, profissional_id: l.profissional_id, servico_id: l.servico_id });
    }
  }

  // US17 — ações de editar/excluir nas listas de Serviços e Profissionais.
  // Usam atributos próprios (data-acao-servico/data-acao-profissional), não
  // "data-acao", pra não colidir com a busca em agendamentosAtuais acima.
  const acaoServicoBtn = e.target.closest('[data-acao-servico]');
  if (acaoServicoBtn) {
    document.querySelectorAll('.menu-acoes.aberto').forEach((m) => m.classList.remove('aberto'));
    const servico = servicosAtuais.find((s) => s.id === acaoServicoBtn.dataset.id);
    if (!servico) return;
    if (acaoServicoBtn.dataset.acaoServico === 'editar') abrirModalServico(servico);
    if (acaoServicoBtn.dataset.acaoServico === 'excluir') abrirModalExcluirServico(servico);
    if (acaoServicoBtn.dataset.acaoServico === 'desabilitar' || acaoServicoBtn.dataset.acaoServico === 'habilitar') {
      alternarAtivoServico(servico);
    }
  }

  const acaoProfissionalBtn = e.target.closest('[data-acao-profissional]');
  if (acaoProfissionalBtn) {
    document.querySelectorAll('.menu-acoes.aberto').forEach((m) => m.classList.remove('aberto'));
    const profissional = profissionaisAtuais.find((p) => p.id === acaoProfissionalBtn.dataset.id);
    if (!profissional) return;
    if (acaoProfissionalBtn.dataset.acaoProfissional === 'editar') abrirModalProfissional(profissional);
    if (acaoProfissionalBtn.dataset.acaoProfissional === 'excluir') abrirModalExcluirProfissional(profissional);
  }

  // US61 — exclusão de bloqueio manual de agenda.
  const acaoBloqueioBtn = e.target.closest('[data-acao-bloqueio]');
  if (acaoBloqueioBtn) {
    document.querySelectorAll('.menu-acoes.aberto').forEach((m) => m.classList.remove('aberto'));
    const bloqueio = bloqueiosAtuais.find((b) => b.id === acaoBloqueioBtn.dataset.id);
    if (!bloqueio) return;
    if (acaoBloqueioBtn.dataset.acaoBloqueio === 'excluir') abrirModalExcluirBloqueio(bloqueio);
  }
});

// BUG (achado testando a US64) — só checava '.agendamento-item' (usado em
// Início/Clientes/Financeiro), nunca '.grade-ag-card' (usado nas views
// Dia/Semana, o card de agendamento mais comum do painel). Resultado: o
// clique que abre o menu de ações (Reagendar/Encaixar/Cancelar/Concluir)
// também "clica fora" na visão desse listener, fechando o menu no mesmo
// evento em que acabou de abrir — o menu de ações nunca funcionava de fato
// nas views Dia/Semana, só em Início/Clientes (onde o card usa a outra
// classe). Ninguém tinha pego porque nenhum teste clicava nesse menu antes.
document.addEventListener('click', (e) => {
  if (!e.target.closest('.agendamento-item, .grade-ag-card')) {
    document.querySelectorAll('.menu-acoes.aberto').forEach((m) => m.classList.remove('aberto'));
  }
});

const NOMES_DIAS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];

// Segmento de negócio do tenant — só adapta a terminologia do texto de "dias
// de funcionamento" na Configuração, sem mudar comportamento. Mesma lista
// fixa validada no backend.
const SEGMENTOS = {
  salao_beleza: { dias: 'o salão', nomeCampo: 'Nome do salão' },
  petshop: { dias: 'o petshop', nomeCampo: 'Nome do petshop' },
  psicologia: { dias: 'o consultório', nomeCampo: 'Nome do consultório' },
  fisioterapia: { dias: 'a clínica', nomeCampo: 'Nome da clínica' },
  pilates: { dias: 'o studio', nomeCampo: 'Nome do studio' },
  outro: { dias: 'o negócio', nomeCampo: 'Nome do negócio' },
};
function infoSegmento(segmento) {
  return SEGMENTOS[segmento] || SEGMENTOS.outro;
}

// ---------- Financeiro (US18/US71) ----------
// Livro-caixa manual simples — primeira funcionalidade real do módulo
// "financeiro" (só aparece no menu se o tenant tiver o módulo ativo, via
// carregarModulosNoMenu). Sem edição/exclusão de lançamento nesta versão —
// escopo combinado foi só registrar e listar.
let mesFinanceiroRef = new Date();
// US71 — abas Mês/Semana/Dia da página /financeiro. `semanaFinanceiroRef`/
// `diaFinanceiroRef` guardam só uma data qualquer dentro do período (o
// início real da semana é sempre recalculado via inicioDaSemana()).
let abaFinanceiroAtiva = 'dia';
let semanaFinanceiroRef = new Date();
let diaFinanceiroRef = new Date();
let lancamentosAtuais = [];
// Movimentações: filtro por tipo (pills Todas/Receitas/Despesas) + busca
// livre (descrição/serviço/cliente), sempre client-side em cima da lista já
// carregada pro período ativo — sem endpoint próprio, a lista de um
// dia/semana/mês nunca é grande o bastante pra justificar paginação server-side.
let financeiroFiltroTipo = 'todas';
let financeiroFiltroBusca = '';
let financeiroFiltroDebounce;
let financeiroCampoFocado = null;

const MESES_ABREV_FINANCEIRO = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

// "04–10 AGO 2026" — label de intervalo pra aba Semana; `inicio` já é a
// segunda-feira da semana (ver inicioDaSemana()).
function labelIntervaloSemanaFinanceiro(inicio) {
  const fim = new Date(inicio);
  fim.setDate(fim.getDate() + 6);
  const diaIni = String(inicio.getDate()).padStart(2, '0');
  const diaFim = String(fim.getDate()).padStart(2, '0');
  return `${diaIni}–${diaFim} ${MESES_ABREV_FINANCEIRO[fim.getMonth()].toUpperCase()} ${fim.getFullYear()}`;
}

// US71/CA05 — abre o Financeiro já na aba/período desejado. Pensada pra ser
// chamada pelos cards do resumo financeiro na tela inicial (US70): quando as
// duas USs estiverem juntas na main, o clique de cada card troca
// `selecionarMenu('modulo:financeiro')` por esta função.
function abrirFinanceiroComFiltro(periodo, referencia) {
  abaFinanceiroAtiva = periodo === 'dia' ? 'dia' : 'mes';
  if (abaFinanceiroAtiva === 'dia' && referencia) {
    diaFinanceiroRef = new Date(`${referencia}T12:00:00`);
  } else if (abaFinanceiroAtiva === 'mes' && referencia) {
    mesFinanceiroRef = new Date(`${referencia}-01T12:00:00`);
  }
  selecionarMenu('modulo:financeiro');
}

function tabsFinanceiroHtml() {
  const abas = [['dia', 'Dia'], ['semana', 'Semana'], ['mes', 'Mês']];
  return `
    <div class="subtabs-financeiro" role="tablist" data-testid="tabs-financeiro">
      ${abas.map(([chave, rotulo]) => `
        <div class="tab ${abaFinanceiroAtiva === chave ? 'active' : ''}" role="tab" aria-selected="${abaFinanceiroAtiva === chave}" data-financeiro-aba="${chave}">${rotulo}</div>
      `).join('')}
    </div>
  `;
}

// Indicador de status por círculo colorido — cobre todo lançamento (não só
// os vinculados a agendamento como antes): despesa (saída) sempre aparece
// como "Despesa" independente de status; entrada usa o status real
// (previsto/recebido); cancelado (qualquer tipo) sobrepõe os dois, já que
// deixou de valer pro resumo mas continua visível na lista pra conferência.
function statusLancamento(l) {
  if (l.status === 'cancelado') return { emoji: '⚪', texto: 'Cancelado' };
  if (l.tipo === 'saida') return { emoji: '🔴', texto: 'Despesa' };
  if (l.status === 'previsto') return { emoji: '🟡', texto: 'Previsto' };
  return { emoji: '🟢', texto: 'Recebido' };
}

// l.data vem do driver pg como Date (coluna tipo `date`), que serializa em
// JSON como ISO completo ("...T00:00:00.000Z"), não "YYYY-MM-DD" puro —
// .slice(0, 10) normaliza os dois formatos antes de montar a data local ao
// meio-dia (evita virada de dia por fuso, mesmo padrão de formatarDataCurtaISO).
// Compartilhada entre o item da lista e o filtro de busca (lancamentosFiltrados).
function dataLancamentoLabel(l) {
  return new Date(l.data.slice(0, 10) + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'America/Sao_Paulo' });
}

// Ações disponíveis por lançamento, na ordem de exibição do menu — varia
// por origem/tipo/status. Cancelado é estado final (só leitura, fica na
// lista pra conferência); todo o resto ganha pelo menos "Editar".
function acoesLancamento(l) {
  if (l.status === 'cancelado') return [];
  const acoes = [];
  if (l.origem === 'agendamento' && l.status === 'previsto') {
    acoes.push({ acao: 'confirmar', label: 'Confirmar pagamento' });
    acoes.push({ acao: 'cancelar', label: 'Cancelar pagamento', perigo: true });
    acoes.push({ acao: 'reagendar', label: 'Reagendar' });
  }
  acoes.push({ acao: 'editar', label: 'Editar' });
  if (l.origem === 'manual' && l.tipo === 'saida') {
    acoes.push({ acao: 'cancelar-despesa', label: 'Cancelar despesa', perigo: true });
  }
  return acoes;
}

function renderLancamentoItem(l) {
  const classeTipo = l.tipo === 'entrada' ? 'financeiro-entrada' : 'financeiro-saida';
  const origemAgendamento = l.origem === 'agendamento';

  // Na aba Dia o período já está óbvio pelo nav — mostra a hora real do
  // atendimento em vez da data (só existe pra lançamento de agendamento,
  // via a.data_hora; manual não tem hora, mostra a data mesmo). Nas abas
  // Semana/Mês (múltiplos dias na mesma lista) sempre mostra a data.
  const horaOuData = (abaFinanceiroAtiva === 'dia' && origemAgendamento && l.data_hora) ? formatarHora(l.data_hora) : dataLancamentoLabel(l);

  // CA "Cenário 8" — lançamento de agendamento identifica cliente/serviço/
  // data do atendimento; l.descricao (editável via "Editar", ver
  // abrirModalEditarLancamento) sobrepõe o nome do serviço quando presente.
  // CAVEAT: num lançamento de agendamento, sincronizarLancamentoFinanceiro
  // reescreve descricao/valor pro nome/preço do serviço sempre que o
  // agendamento muda de estado de novo (reagendar, por exemplo) — uma
  // descrição/valor editados manualmente aqui podem ser sobrescritos nesse
  // caso. Aceitável: é raro editar e depois reagendar o mesmo atendimento.
  const titulo = l.descricao || (origemAgendamento ? l.servico : (l.tipo === 'entrada' ? 'Entrada' : 'Saída'));
  const detalhe = origemAgendamento ? `${l.cliente || 'Cliente'} · Agendamento` : '';
  const valorLabel = l.tipo === 'saida' ? `- ${formatarPreco(l.valor)}` : formatarPreco(l.valor);
  const status = statusLancamento(l);
  const acoes = acoesLancamento(l);

  return `
    <div class="agendamento-item financeiro-item" data-testid="lancamento-item">
      <div class="agendamento-linha-principal" ${acoes.length ? `data-acoes-toggle="lancamento-${l.id}"` : ''}>
        <div class="financeiro-item-hora">${horaOuData}</div>
        <div class="financeiro-item-corpo">
          <div class="agendamento-hora">${titulo}</div>
          ${detalhe ? `<div class="agendamento-detalhe">${detalhe}</div>` : ''}
        </div>
        <div class="financeiro-item-valor">
          <div class="${classeTipo}">${valorLabel}</div>
          <div class="financeiro-item-status">${status.emoji} ${status.texto}</div>
        </div>
        ${acoes.length ? '<button class="btn-acoes" aria-label="Ações">⋮</button>' : ''}
      </div>
      ${acoes.length ? `
        <div class="menu-acoes" id="menu-acoes-lancamento-${l.id}">
          ${acoes.map((a) => `<button data-acao-lancamento="${a.acao}" data-id="${l.id}"${a.perigo ? ' class="acao-perigo"' : ''}>${a.label}</button>`).join('')}
        </div>
      ` : ''}
    </div>
  `;
}

// Confirmar pagamento pede a forma de pagamento antes de confirmar — fica
// registrada no lançamento e aparece no histórico de atendimentos do
// cliente (menu Clientes). Reaproveita o mesmo PATCH que abrirModalConcluir
// usa no menu da Agenda — sincronizarLancamentoFinanceiro (US64) já converte
// o lançamento de previsto pra realizado sozinho, sem endpoint próprio.
function confirmarPagamentoLancamento(l) {
  abrirModal(
    '<h3>Confirmar pagamento</h3>',
    `
      <p class="modal-texto">Qual foi a forma de pagamento?</p>
      <div class="forma-pagamento-opcoes">
        <label class="forma-pagamento-opcao"><input type="radio" name="forma-pagamento" value="pix" checked> Pix</label>
        <label class="forma-pagamento-opcao"><input type="radio" name="forma-pagamento" value="cartao"> Cartão</label>
        <label class="forma-pagamento-opcao"><input type="radio" name="forma-pagamento" value="dinheiro"> Dinheiro</label>
        <label class="forma-pagamento-opcao"><input type="radio" name="forma-pagamento" value="outro"> Outro</label>
      </div>
      <div class="modal-erro" id="confirmar-pagamento-erro"></div>
      <div class="modal-acoes">
        <button class="btn-secundario" id="btn-sair-confirmar-pagamento">Sair</button>
        <button class="btn-primario" id="btn-confirmar-pagamento-lancamento">Confirmar</button>
      </div>
    `
  );

  document.getElementById('btn-sair-confirmar-pagamento').addEventListener('click', fecharModal);
  document.getElementById('btn-confirmar-pagamento-lancamento').addEventListener('click', async () => {
    const formaPagamento = document.querySelector('input[name="forma-pagamento"]:checked').value;
    const btn = document.getElementById('btn-confirmar-pagamento-lancamento');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>';

    const resultado = await api(`/api/agendamentos/${l.agendamento_id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'concluido', forma_pagamento: formaPagamento }),
    });

    if (resultado && !resultado.error) {
      fecharModal();
      mostrarToast('Pagamento confirmado.', 'sucesso');
      render();
    } else {
      document.getElementById('confirmar-pagamento-erro').textContent = (resultado && resultado.error) || 'Erro ao confirmar pagamento.';
      btn.disabled = false;
      btn.textContent = 'Confirmar';
    }
  });
}

// PR4 — Cancelar pagamento segue o mesmo padrão de abrirModalCancelar (ST08.4),
// com o texto de aviso pedido explicitamente ("operação não pode ser
// desfeita"). Mesmo PATCH — sincronizarLancamentoFinanceiro remove o valor
// do previsto quando o agendamento é cancelado.
function abrirModalCancelarPagamentoLancamento(l) {
  abrirModal(
    '<h3>Cancelar pagamento</h3>',
    `
      <p class="modal-texto">Deseja cancelar, essa operação não pode ser desfeita?</p>
      <div class="modal-acoes">
        <button class="btn-secundario" id="btn-sair-cancelar-pagamento">Sair</button>
        <button class="btn-perigo" id="btn-confirmar-cancelar-pagamento">Confirmar</button>
      </div>
    `
  );

  document.getElementById('btn-sair-cancelar-pagamento').addEventListener('click', fecharModal);
  document.getElementById('btn-confirmar-cancelar-pagamento').addEventListener('click', async () => {
    const btn = document.getElementById('btn-confirmar-cancelar-pagamento');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>';

    const resultado = await api(`/api/agendamentos/${l.agendamento_id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'cancelado' }),
    });

    if (resultado && !resultado.error) {
      fecharModal();
      mostrarToast('Pagamento cancelado.', 'sucesso');
      render();
    } else {
      mostrarToast((resultado && resultado.error) || 'Erro ao cancelar pagamento.', 'erro');
      btn.disabled = false;
      btn.textContent = 'Confirmar';
    }
  });
}

// "Editar" (valor/descrição) — disponível em todo lançamento não-cancelado
// (menu de 3 pontos, ver acoesLancamento). PATCH /api/financeiro/lancamentos/:id
// aceita os dois campos direto na linha, sem depender do agendamento de origem.
function abrirModalEditarLancamento(l) {
  abrirModal(
    '<h3>Editar lançamento</h3>',
    `
      <form id="form-editar-lancamento">
        <div class="modal-erro" id="editar-lancamento-erro"></div>
        <label for="editar-lancamento-valor">Valor em R$ *</label>
        <input type="number" id="editar-lancamento-valor" data-obrigatorio min="0.01" step="0.01" value="${l.valor}">
        <label for="editar-lancamento-descricao">Descrição</label>
        <input type="text" id="editar-lancamento-descricao" value="${l.descricao || ''}" placeholder="${l.origem === 'agendamento' ? l.servico : (l.tipo === 'entrada' ? 'Entrada' : 'Saída')}">
        <div class="modal-acoes">
          <button type="button" class="btn-secundario" id="btn-cancelar-editar-lancamento">Cancelar</button>
          <button type="submit" class="btn-primario" id="btn-salvar-editar-lancamento">Salvar</button>
        </div>
      </form>
    `
  );

  document.getElementById('btn-cancelar-editar-lancamento').addEventListener('click', fecharModal);
  const form = document.getElementById('form-editar-lancamento');
  form.querySelectorAll('[data-obrigatorio]').forEach((campo) => {
    campo.addEventListener('input', () => campo.classList.remove('campo-invalido'));
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const erroEl = document.getElementById('editar-lancamento-erro');
    erroEl.textContent = '';
    const invalido = validarObrigatorios(form);
    if (invalido) {
      invalido.focus();
      return;
    }
    const btn = document.getElementById('btn-salvar-editar-lancamento');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>';

    const resultado = await api(`/api/financeiro/lancamentos/${l.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        valor: parseFloat(document.getElementById('editar-lancamento-valor').value),
        descricao: document.getElementById('editar-lancamento-descricao').value.trim() || null,
      }),
    });

    if (resultado && !resultado.error) {
      fecharModal();
      mostrarToast('Lançamento atualizado.', 'sucesso');
      renderFinanceiro();
    } else {
      erroEl.textContent = (resultado && resultado.error) || 'Erro ao salvar lançamento.';
      btn.disabled = false;
      btn.textContent = 'Salvar';
    }
  });
}

// "Cancelar despesa" — só existe em lançamento manual de saída (menu de 3
// pontos). Mesmo padrão de abrirModalCancelarPagamentoLancamento, mas marca
// o próprio lançamento como cancelado direto (não depende de agendamento).
function abrirModalCancelarDespesaLancamento(l) {
  abrirModal(
    '<h3>Cancelar despesa</h3>',
    `
      <p class="modal-texto">Deseja cancelar, essa operação não pode ser desfeita?</p>
      <div class="modal-acoes">
        <button class="btn-secundario" id="btn-sair-cancelar-despesa">Sair</button>
        <button class="btn-perigo" id="btn-confirmar-cancelar-despesa">Confirmar</button>
      </div>
    `
  );

  document.getElementById('btn-sair-cancelar-despesa').addEventListener('click', fecharModal);
  document.getElementById('btn-confirmar-cancelar-despesa').addEventListener('click', async () => {
    const btn = document.getElementById('btn-confirmar-cancelar-despesa');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>';

    const resultado = await api(`/api/financeiro/lancamentos/${l.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'cancelado' }),
    });

    if (resultado && !resultado.error) {
      fecharModal();
      mostrarToast('Despesa cancelada.', 'sucesso');
      renderFinanceiro();
    } else {
      mostrarToast((resultado && resultado.error) || 'Erro ao cancelar despesa.', 'erro');
      btn.disabled = false;
      btn.textContent = 'Confirmar';
    }
  });
}

function referenciaFinanceiroAtiva() {
  if (abaFinanceiroAtiva === 'semana') return formatarDataISO(inicioDaSemana(semanaFinanceiroRef));
  if (abaFinanceiroAtiva === 'dia') return formatarDataISO(diaFinanceiroRef);
  return formatarDataISO(mesFinanceiroRef).slice(0, 7);
}

// Nav do período compacto — "← RÓTULO →", só setas (sem "Dia anterior"/"Mês
// anterior" por extenso, texto vira aria-label pra acessibilidade).
function navPeriodoFinanceiroHtml() {
  if (abaFinanceiroAtiva === 'semana') {
    const inicio = inicioDaSemana(semanaFinanceiroRef);
    return `
      <div class="nav-periodo">
        <button data-nav="-1" aria-label="Semana anterior" data-testid="nav-semana-anterior">←</button>
        <strong>${labelIntervaloSemanaFinanceiro(inicio)}</strong>
        <button data-nav="1" aria-label="Próxima semana" data-testid="nav-semana-proxima">→</button>
      </div>
    `;
  }
  if (abaFinanceiroAtiva === 'dia') {
    const dataLabel = `${String(diaFinanceiroRef.getDate()).padStart(2, '0')} ${MESES_ABREV_FINANCEIRO[diaFinanceiroRef.getMonth()].toUpperCase()} ${diaFinanceiroRef.getFullYear()}`;
    return `
      <div class="nav-periodo">
        <button data-nav="-1" aria-label="Dia anterior" data-testid="nav-dia-anterior">←</button>
        <div class="nav-periodo-data">
          <strong>${dataLabel}</strong>
          <div class="nav-periodo-dia-semana">${nomeDiaSemana(diaFinanceiroRef)}</div>
        </div>
        <button data-nav="1" aria-label="Próximo dia" data-testid="nav-dia-proximo">→</button>
      </div>
    `;
  }
  const mesLabel = `${mesFinanceiroRef.toLocaleDateString('pt-BR', { month: 'long', timeZone: 'America/Sao_Paulo' }).toUpperCase()} ${mesFinanceiroRef.getFullYear()}`;
  return `
    <div class="nav-periodo">
      <button data-nav="-1" aria-label="Mês anterior" data-testid="nav-mes-anterior">←</button>
      <strong>${mesLabel}</strong>
      <button data-nav="1" aria-label="Próximo mês" data-testid="nav-mes-proximo">→</button>
    </div>
  `;
}

function bindNavPeriodoFinanceiro() {
  const btnAnterior = conteudo.querySelector('[data-nav="-1"]');
  const btnProximo = conteudo.querySelector('[data-nav="1"]');
  if (abaFinanceiroAtiva === 'semana') {
    btnAnterior.addEventListener('click', () => { semanaFinanceiroRef.setDate(semanaFinanceiroRef.getDate() - 7); renderFinanceiro(); });
    btnProximo.addEventListener('click', () => { semanaFinanceiroRef.setDate(semanaFinanceiroRef.getDate() + 7); renderFinanceiro(); });
  } else if (abaFinanceiroAtiva === 'dia') {
    btnAnterior.addEventListener('click', () => { diaFinanceiroRef.setDate(diaFinanceiroRef.getDate() - 1); renderFinanceiro(); });
    btnProximo.addEventListener('click', () => { diaFinanceiroRef.setDate(diaFinanceiroRef.getDate() + 1); renderFinanceiro(); });
  } else {
    btnAnterior.addEventListener('click', () => { mesFinanceiroRef.setMonth(mesFinanceiroRef.getMonth() - 1); renderFinanceiro(); });
    btnProximo.addEventListener('click', () => { mesFinanceiroRef.setMonth(mesFinanceiroRef.getMonth() + 1); renderFinanceiro(); });
  }
}

const FINANCEIRO_FILTRO_TIPO_PILLS = [
  ['todas', 'Todas'],
  ['entrada', 'Receitas'],
  ['saida', 'Despesas'],
];

// Filtra a lista já carregada do período ativo por tipo (pill) + busca livre
// por data, nome do cliente, descrição do lançamento (serviço ou descrição
// manual) ou valor — nunca refaz a chamada à API, só reaplica em cima de
// lancamentosAtuais.
function lancamentosFiltrados() {
  const busca = financeiroFiltroBusca.trim().toLowerCase();
  return lancamentosAtuais.filter((l) => {
    if (financeiroFiltroTipo !== 'todas' && l.tipo !== financeiroFiltroTipo) return false;
    if (!busca) return true;
    const alvo = `${dataLancamentoLabel(l)} ${l.cliente || ''} ${l.servico || ''} ${l.descricao || ''} ${formatarPreco(l.valor)}`.toLowerCase();
    return alvo.includes(busca);
  });
}

// PR4 — as 3 abas (Dia/Semana/Mês) usam o mesmo endpoint unificado
// (?periodo=dia|semana|mes&referencia=...) e os mesmos 4 cards (Prevista/
// Recebida/Despesas/Resultado) — só nav do período e o gráfico (só Mês)
// mudam por aba. Movimentações (lista) sempre visível, com filtro por tipo
// e busca — sem colapso "ver detalhamento" como antes.
async function renderFinanceiro() {
  conteudo.innerHTML = '<div class="vazio">Carregando...</div>';
  const periodo = abaFinanceiroAtiva;
  const referencia = referenciaFinanceiroAtiva();
  const data = await api(`/api/financeiro/lancamentos?periodo=${periodo}&referencia=${referencia}`);
  if (!data) return;

  lancamentosAtuais = data.lancamentos;
  // Decisão confirmada com o Bruno: Resultado = Previsto − Saídas (literal,
  // não soma a Receita Recebida, que já aparece separada no card ao lado).
  const resultado = data.resumo.previsto - data.resumo.saidas;

  let html = `
    <div class="inicio-cabecalho">
      <div>
        <h2>Financeiro</h2>
        <p class="financeiro-subtitulo">Acompanhe as finanças do seu salão.</p>
      </div>
      <button class="btn-novo-agendamento" id="btn-novo-lancamento">+ Novo lançamento</button>
    </div>
  ` + tabsFinanceiroHtml() + navPeriodoFinanceiroHtml() + `
    <div class="financeiro-resumo">
      <div class="financeiro-resumo-card" data-testid="card-previsto">
        <div class="financeiro-resumo-label">Prevista</div>
        <div class="financeiro-previsto">${formatarPreco(data.resumo.previsto)}</div>
      </div>
      <div class="financeiro-resumo-card" data-testid="card-realizado">
        <div class="financeiro-resumo-label">Recebida</div>
        <div class="financeiro-entrada">${formatarPreco(data.resumo.realizado)}</div>
      </div>
      <div class="financeiro-resumo-card" data-testid="card-saidas">
        <div class="financeiro-resumo-label">Despesas</div>
        <div class="financeiro-saida">${formatarPreco(data.resumo.saidas)}</div>
      </div>
      <div class="financeiro-resumo-card" data-testid="card-total">
        <div class="financeiro-resumo-label">Resultado</div>
        <div class="${resultado >= 0 ? 'financeiro-entrada' : 'financeiro-saida'}">${formatarPreco(resultado)}</div>
      </div>
    </div>
  `;

  // Mesmo layout do menu Clientes: busca full-width numa linha, pills de
  // filtro logo abaixo numa grid de colunas iguais (lado a lado).
  const filtrados = lancamentosFiltrados();
  html += `
    <h3 class="inicio-secao-titulo">Movimentações</h3>
    <div class="financeiro-filtros">
      <input type="text" id="financeiro-filtro-busca" placeholder="🔎 Buscar por data, cliente, descrição ou valor" value="${financeiroFiltroBusca}">
    </div>
    <div class="financeiro-filtro-pills">
      ${FINANCEIRO_FILTRO_TIPO_PILLS.map(([valor, label]) => `<button type="button" class="chip-status${financeiroFiltroTipo === valor ? ' chip-status-ativo' : ''}" data-financeiro-filtro-tipo="${valor}">${label}</button>`).join('')}
    </div>
  `;

  if (!data.lancamentos.length) {
    html += '<div class="vazio">Nenhuma movimentação no período.</div>';
  } else if (!filtrados.length) {
    html += '<div class="vazio">Nenhuma movimentação encontrada.</div>';
  } else {
    html += `<div data-testid="lista-lancamentos">${filtrados.map(renderLancamentoItem).join('')}</div>`;
  }

  conteudo.innerHTML = html;
  bindNavPeriodoFinanceiro();
  document.getElementById('btn-novo-lancamento').addEventListener('click', abrirModalLancamento);

  if (financeiroCampoFocado) {
    const campoEl = document.getElementById(financeiroCampoFocado);
    if (campoEl) {
      campoEl.focus();
      campoEl.setSelectionRange(campoEl.value.length, campoEl.value.length);
    }
  }
  document.getElementById('financeiro-filtro-busca').addEventListener('input', (e) => {
    const valor = e.target.value;
    clearTimeout(financeiroFiltroDebounce);
    financeiroFiltroDebounce = setTimeout(() => {
      financeiroFiltroBusca = valor;
      financeiroCampoFocado = 'financeiro-filtro-busca';
      renderFinanceiro();
    }, 400);
  });
}

function abrirModalLancamento() {
  const hoje = formatarDataISO(new Date());
  abrirModal(
    '<h3>Novo lançamento</h3>',
    `
      <form id="form-lancamento">
        <div class="modal-erro" id="lancamento-erro"></div>
        <label for="lancamento-tipo">Tipo *</label>
        <select id="lancamento-tipo" data-obrigatorio>
          <option value="entrada">Entrada</option>
          <option value="saida">Saída</option>
        </select>
        <label for="lancamento-valor">Valor em R$ *</label>
        <input type="number" id="lancamento-valor" data-obrigatorio min="0.01" step="0.01">
        <label for="lancamento-data">Data *</label>
        <input type="date" id="lancamento-data" data-obrigatorio value="${hoje}">
        <label for="lancamento-descricao">Descrição (opcional)</label>
        <input type="text" id="lancamento-descricao" placeholder="Ex: venda do dia, compra de material...">
        <div class="modal-acoes">
          <button type="button" class="btn-secundario" id="btn-cancelar-lancamento">Cancelar</button>
          <button type="submit" class="btn-primario" id="btn-salvar-lancamento">Salvar</button>
        </div>
      </form>
    `
  );

  document.getElementById('btn-cancelar-lancamento').addEventListener('click', fecharModal);

  const form = document.getElementById('form-lancamento');
  form.querySelectorAll('[data-obrigatorio]').forEach((campo) => {
    campo.addEventListener('input', () => campo.classList.remove('campo-invalido'));
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const erroEl = document.getElementById('lancamento-erro');
    erroEl.textContent = '';
    const invalido = validarObrigatorios(form);
    if (invalido) {
      erroEl.textContent = 'Preencha os campos obrigatórios destacados em vermelho.';
      invalido.focus();
      return;
    }

    const btn = document.getElementById('btn-salvar-lancamento');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>';

    const payload = {
      tipo: document.getElementById('lancamento-tipo').value,
      valor: parseFloat(document.getElementById('lancamento-valor').value),
      data: document.getElementById('lancamento-data').value,
      descricao: document.getElementById('lancamento-descricao').value.trim() || null,
    };

    const resultado = await api('/api/financeiro/lancamentos', {
      method: 'POST',
      body: JSON.stringify(payload),
    });

    if (resultado && !resultado.error) {
      fecharModal();
      mostrarToast('Lançamento registrado com sucesso.', 'sucesso');
      renderFinanceiro();
    } else {
      erroEl.textContent = (resultado && resultado.error) || 'Erro ao salvar lançamento.';
      btn.disabled = false;
      btn.textContent = 'Salvar';
    }
  });
}

// ---------- Pagamentos / Asaas (US32) ----------
const PAGAMENTOS_STATUS_LABEL = {
  trial: 'Trial',
  ativo: 'Ativo',
  inadimplente: 'Inadimplente',
  suspenso: 'Suspenso',
  expirado: 'Expirado',
  cancelado: 'Cancelado',
};
const PAGAMENTOS_STATUS_BADGE = {
  trial: 'badge-trial-ativo',
  ativo: 'badge-status-ativo',
  inadimplente: 'badge-status-inadimplente',
  suspenso: 'badge-status-suspenso',
  expirado: 'badge-trial-expirado',
  cancelado: 'badge-status-inativo',
};

// Status de cada cobrança individual no histórico (vem direto da Asaas,
// diferente do status da assinatura acima). PENDING = amarelo, CONFIRMED/
// RECEIVED = verde, OVERDUE/CANCELED/REFUNDED = vermelho.
const HISTORICO_STATUS_LABEL = {
  PENDING: 'Pendente',
  CONFIRMED: 'Confirmado',
  RECEIVED: 'Confirmado',
  OVERDUE: 'Vencido',
  CANCELED: 'Cancelado',
  CANCELLED: 'Cancelado',
  REFUNDED: 'Cancelado',
};
const HISTORICO_STATUS_BADGE = {
  PENDING: 'badge-pagamento-pending',
  CONFIRMED: 'badge-pagamento-confirmado',
  RECEIVED: 'badge-pagamento-confirmado',
  OVERDUE: 'badge-pagamento-cancelado',
  CANCELED: 'badge-pagamento-cancelado',
  CANCELLED: 'badge-pagamento-cancelado',
  REFUNDED: 'badge-pagamento-cancelado',
};
function renderHistoricoStatus(status) {
  const classe = HISTORICO_STATUS_BADGE[status] || 'badge-status-inativo';
  const label = HISTORICO_STATUS_LABEL[status] || status;
  return `<span class="badge ${classe}">${label}</span>`;
}

// formatarDataCurtaISO agora vive em pagamento-form.js (US52).

// CA01-CA06 (US36) — bloco de status do trial na aba de pagamentos: badge +
// barra de progresso + CTA, com 3 estados (ativo / expirando ≤3 dias /
// expirado) derivados de trial_ativo e trial_dias_restantes.
function renderBlocoTrial(trialInfo) {
  const diasRestantes = trialInfo.trial_dias_restantes;
  const percentual = trialInfo.trial_percentual != null ? Math.min(100, Math.max(0, trialInfo.trial_percentual)) : 0;
  const corBarra = percentual > 80 ? 'trial-barra-vermelha' : percentual > 50 ? 'trial-barra-amarela' : 'trial-barra-verde';

  let badgeClasse = 'badge-trial-ativo';
  let badgeTexto = 'TRIAL ATIVO';
  let mensagem = 'Você está no período gratuito de 14 dias.';
  let cta = trialInfo.trial_fim
    ? `Garanta seu acesso — cadastre uma forma de pagamento agora e não pague nada até ${formatarDataCurtaISO(trialInfo.trial_fim)}.`
    : '';

  if (!trialInfo.trial_ativo) {
    badgeClasse = 'badge-trial-expirado';
    badgeTexto = 'TRIAL EXPIRADO';
    mensagem = 'Seu período gratuito encerrou. Cadastre uma forma de pagamento para continuar usando o Kyvvo.';
    cta = '';
  } else if (diasRestantes != null && diasRestantes <= 3) {
    badgeClasse = 'badge-trial-expirando';
    badgeTexto = 'TRIAL EXPIRANDO';
    mensagem = `Seu trial expira em ${diasRestantes} dia${diasRestantes === 1 ? '' : 's'}. Cadastre um pagamento para não perder o acesso.`;
  }

  const progresso = trialInfo.trial_inicio && trialInfo.trial_fim
    ? `
      <div class="trial-progresso">
        <div class="trial-progresso-barra"><div class="trial-progresso-preenchido ${corBarra}" style="width:${percentual}%"></div></div>
        <div class="trial-progresso-legenda">
          <span>Início: ${formatarDataCurtaISO(trialInfo.trial_inicio)}</span>
          <span>Término: ${formatarDataCurtaISO(trialInfo.trial_fim)}</span>
        </div>
        <div class="trial-progresso-dias">
          <strong>${trialInfo.trial_ativo ? `${diasRestantes} dias restantes` : 'Trial encerrado'}</strong>
          <span>${trialInfo.trial_dias_utilizados} de 14 dias utilizados</span>
        </div>
      </div>
    `
    : '';

  return `
    <div class="trial-status-bloco">
      <span class="badge ${badgeClasse}">${badgeTexto}</span>
      <p class="modal-texto">${mensagem}</p>
      ${progresso}
      ${cta ? `<p class="modal-texto">${cta}</p>` : ''}
    </div>
  `;
}

function formatarMeioHistorico(meio) {
  if (meio === 'PIX') return 'Pix';
  if (meio === 'CREDIT_CARD') return 'Cartão de crédito';
  return meio || '—';
}

async function renderPagamentos() {
  conteudo.innerHTML = '<div class="vazio">Carregando...</div>';
  const dados = await api('/api/pagamentos');
  if (!dados) return;

  const meioLabel = dados.meio_pagamento === 'cartao'
    ? `Cartão •••• ${dados.cartao_final || '----'}`
    : dados.meio_pagamento === 'pix'
      ? 'Pix recorrente'
      : 'Não cadastrado';

  let html = '<div class="nav-periodo"><strong>Plano</strong></div>';

  if (dados.status === 'trial' && dados.meio_pagamento) {
    // CA05 (US37) — pagamento já cadastrado durante o trial: a cobrança está
    // agendada pro fim do trial, mas ainda não aconteceu (por isso o tenant
    // continua em 'trial', não 'ativo' — ver /api/pagamentos/cadastrar).
    html += `
      <div class="financeiro-resumo">
        <div class="financeiro-resumo-card financeiro-resumo-card-3linhas">
          <div class="financeiro-resumo-label">Plano Atual</div>
          <div class="financeiro-resumo-linha2">${dados.plano_nome || 'A definir'}</div>
          <div class="financeiro-resumo-linha3">${dados.valor_plano != null ? formatarPreco(dados.valor_plano) : '—'}</div>
        </div>
        <div class="financeiro-resumo-card financeiro-resumo-card-3linhas">
          <div class="financeiro-resumo-label">Meio de pagamento</div>
          <div class="financeiro-resumo-linha2">${meioLabel}</div>
          <div class="financeiro-resumo-linha3">—</div>
        </div>
        <div class="financeiro-resumo-card financeiro-resumo-card-3linhas status-card-pendente">
          <div class="financeiro-resumo-label">Status</div>
          <div class="financeiro-resumo-linha2">Trial com pagamento agendado</div>
        </div>
      </div>
      <p class="modal-texto">
        Próxima cobrança: ${dados.proxima_cobranca ? `${formatarPreco(dados.proxima_cobranca.valor)} em ${formatarDataCurtaISO(dados.proxima_cobranca.data)}` : 'não disponível'}
      </p>
      <button class="btn-secundario" id="btn-cadastrar-pagamento" style="margin-bottom:16px">Alterar forma de pagamento</button>
    `;
  } else if (dados.status === 'trial') {
    const trialInfo = await api('/api/pagamentos/status');
    if (!trialInfo) return;

    html += `
      <div class="financeiro-resumo-card" style="margin-bottom:16px">
        <div class="financeiro-resumo-label">Plano atual</div>
        <div>${dados.plano_nome || 'A definir'}${dados.valor_plano != null ? ` — ${formatarPreco(dados.valor_plano)}/mês após o trial` : ''}</div>
      </div>
      ${renderBlocoTrial(trialInfo)}
      <button class="btn-novo-agendamento" id="btn-cadastrar-pagamento">${trialInfo.trial_ativo ? 'Cadastrar pagamento' : 'Escolher plano'}</button>
    `;
  } else if (!dados.meio_pagamento) {
    html += `
      <p class="modal-texto">Nenhum meio de pagamento cadastrado.</p>
      <button class="btn-novo-agendamento" id="btn-cadastrar-pagamento">Cadastrar forma de pagamento</button>
    `;
  } else {
    // CA01/CA04/CA06 (US35) — cancelado é um estado à parte: some o botão de
    // "Alterar plano" (não há mais assinatura ativa pra alterar) e mostra
    // "Reativar assinatura" no lugar; o collapse "Alterar forma de pagar"
    // (com "Cancelar assinatura" dentro) só aparece com status 'ativo'/
    // inadimplente/suspenso — quem já cancelou não tem mais assinatura pra
    // alterar/cancelar de novo.
    const cancelado = dados.status === 'cancelado';
    const ativo = dados.status === 'ativo';
    const statusBadgeClasse = PAGAMENTOS_STATUS_BADGE[dados.status] || 'badge-status-inativo';

    html += `
      <div class="pagamento-plano-card">
        <div class="pagamento-plano-linha">
          <span class="pagamento-plano-nome">${dados.plano_nome || '—'}</span>
          <span class="pagamento-plano-valor">${dados.valor_plano != null ? formatarPreco(dados.valor_plano) : '—'}</span>
        </div>
        <div class="pagamento-plano-linha pagamento-plano-linha-secundaria">
          <span>${meioLabel}</span>
          <span>${dados.ciclo || 'Mensal'}</span>
        </div>
        <div class="pagamento-plano-linha pagamento-plano-linha-secundaria">
          <span class="badge ${statusBadgeClasse}">${PAGAMENTOS_STATUS_LABEL[dados.status] || dados.status}</span>
          ${cancelado
            ? '<button type="button" class="btn-primario btn-pequeno" id="btn-reativar-pagamento">Reativar assinatura</button>'
            : '<button type="button" class="btn-secundario btn-pequeno" id="btn-trocar-plano">Alterar plano</button>'}
        </div>
      </div>

      <div class="pagamento-secao-divisor"></div>
      <h3 class="inicio-secao-titulo">Cobrança</h3>

      ${cancelado
        ? `<p class="modal-texto">Seu acesso está ativo até ${formatarDataCurtaISO(dados.acesso_ate)}. Após essa data, o sistema será suspenso.</p>`
        : `<p class="modal-texto">
            Próxima cobrança: ${dados.proxima_cobranca
              ? `${dados.proxima_cobranca.plano_nome || dados.plano_nome || 'Plano'}, ${formatarPreco(dados.proxima_cobranca.valor)} em ${formatarDataCurtaISO(dados.proxima_cobranca.data)}`
              : 'não disponível'}
          </p>`}

      <h4 class="pagamento-historico-titulo">Histórico de cobranças</h4>
      <div class="tabela-wrapper">
        <table class="tabela-tenants">
          <thead><tr><th>Data da cobrança</th><th>Plano</th><th>Valor</th><th>Tipo</th><th>Meio de pagamento</th><th>Status</th></tr></thead>
          <tbody>
            ${dados.historico.length
              ? dados.historico.map((h) => `<tr><td>${formatarDataCurtaISO(h.data)}</td><td>${h.plano_nome || '—'}</td><td>${formatarPreco(h.valor)}</td><td>${h.ciclo || 'Mensal'}</td><td>${formatarMeioHistorico(h.meio)}</td><td>${renderHistoricoStatus(h.status)}</td></tr>`).join('')
              : '<tr><td colspan="6">Nenhuma cobrança registrada ainda.</td></tr>'}
          </tbody>
        </table>
      </div>

      ${cancelado ? '' : `
        <div class="pagamento-detalhes">
          <button type="button" class="pagamento-detalhes-toggle" id="btn-toggle-detalhes" aria-expanded="false">
            <span class="menu-chevron" aria-hidden="true"></span><span>Alterar forma de pagar</span>
          </button>
          <div class="pagamento-detalhes-conteudo" id="pagamento-detalhes-conteudo" hidden>
            ${htmlFormPagamento(dados, {
              comBotaoCancelar: false,
              botoesPequenos: true,
              botaoExtraHtml: ativo ? '<button type="button" class="btn-perigo btn-pequeno" id="btn-cancelar-assinatura">Cancelar assinatura</button>' : '',
            })}
          </div>
        </div>
      `}
    `;
  }

  conteudo.innerHTML = html;
  const btnCadastrar = document.getElementById('btn-cadastrar-pagamento');
  if (btnCadastrar) btnCadastrar.addEventListener('click', () => abrirModalPagamento(dados));
  const btnReativar = document.getElementById('btn-reativar-pagamento');
  if (btnReativar) btnReativar.addEventListener('click', () => abrirModalPagamento(dados));
  const btnTrocarPlano = document.getElementById('btn-trocar-plano');
  if (btnTrocarPlano) btnTrocarPlano.addEventListener('click', () => abrirModalTrocarPlano(dados));

  // Collapse "Alterar forma de pagar" (redesenho "Plano") — substitui o
  // antigo "Detalhes ▾"; o próprio formulário (htmlFormPagamento) já foi
  // renderizado (oculto) dentro do conteúdo acima, só falta ligar o toggle e
  // o wiring do formulário/cancelamento. `.expandido` no botão troca o
  // glifo do `.menu-chevron` (> recolhido / ⌵ expandido, mesma convenção do
  // menu lateral — ver style.css).
  const btnToggleDetalhes = document.getElementById('btn-toggle-detalhes');
  if (btnToggleDetalhes) {
    btnToggleDetalhes.addEventListener('click', () => {
      const painel = document.getElementById('pagamento-detalhes-conteudo');
      const vaiAbrir = painel.hidden;
      painel.hidden = !vaiAbrir;
      btnToggleDetalhes.setAttribute('aria-expanded', String(vaiAbrir));
      btnToggleDetalhes.classList.toggle('expandido', vaiAbrir);
    });
    wireFormPagamento(dados, { onSucesso: () => renderPagamentos() });
    const btnCancelarAssinatura = document.getElementById('btn-cancelar-assinatura');
    if (btnCancelarAssinatura) btnCancelarAssinatura.addEventListener('click', () => abrirModalCancelarAssinatura(dados));
  }
}

// Rótulos dos limites vindos de GET /api/planos (plano.limites) — mesmo
// conteúdo/categorias já usadas na grade de preços da landing
// (server/public/index.html, PLANO_LIMITE_ROTULOS), duplicado aqui porque as
// duas telas vivem em origens diferentes.
const PLANO_TROCA_LIMITE_ROTULOS = {
  conversas_mes: { icone: '💬', singular: 'conversa/mês', plural: 'conversas/mês', ilimitado: 'Conversas ilimitadas' },
  profissionais: { icone: '👤', singular: 'profissional', plural: 'profissionais', ilimitado: 'Profissionais ilimitados' },
  unidades: { icone: '🏢', singular: 'unidade', plural: 'unidades', ilimitado: 'Unidades ilimitadas' },
};
const PLANO_TROCA_ICONES = ['⭐', '👑', '⚡', '🚀'];

function badgesLimitesPlano(limites) {
  if (!limites) return '';
  return Object.entries(PLANO_TROCA_LIMITE_ROTULOS)
    .filter(([chave]) => limites[chave] !== undefined)
    .map(([chave, rotulo]) => {
      const valor = limites[chave];
      const texto = valor == null || valor === -1
        ? rotulo.ilimitado
        : Number(valor) === 1 ? `1 ${rotulo.singular}` : `Até ${valor} ${rotulo.plural}`;
      return `<span class="plano-opcao-badge">${rotulo.icone} ${texto}</span>`;
    }).join('');
}

// Modal de troca de plano — lista só os planos ativos (GET /api/planos já
// filtra por ativo=true), com o plano atual marcado e desabilitado. Sem
// proration: a troca vale a partir da próxima cobrança (ver comentário em
// PATCH /api/pagamentos/plano no backend). Ícone/cor por posição são só
// decoração (não vêm do banco); descrição e badges de limite usam os dados
// reais já cadastrados (frase_beneficio/limites), sem inventar número novo.
async function abrirModalTrocarPlano(dadosAtuais) {
  abrirModal('<h3>Trocar de plano</h3>', '<div class="vazio">Carregando planos...</div>', 'modal-card-pagamento');
  const planos = await api('/api/planos');
  if (!planos) return;

  const opcoesHtml = planos.map((p, i) => {
    const atual = p.slug === dadosAtuais.plano_slug;
    return `
      <label class="plano-opcao${atual ? ' plano-opcao-atual' : ''}">
        <input type="radio" name="plano-novo" value="${p.slug}" ${atual ? 'checked disabled' : ''}>
        <span class="plano-opcao-icone plano-opcao-icone-${i % PLANO_TROCA_ICONES.length}" aria-hidden="true">${PLANO_TROCA_ICONES[i % PLANO_TROCA_ICONES.length]}</span>
        <span class="plano-opcao-corpo">
          <span class="plano-opcao-nome">${p.nome}</span>
          ${p.frase_beneficio ? `<span class="plano-opcao-desc">${p.frase_beneficio}</span>` : ''}
          <span class="plano-opcao-badges">${badgesLimitesPlano(p.limites)}</span>
        </span>
        <span class="plano-opcao-preco">
          <span class="plano-opcao-preco-valor">${formatarPreco(Number(p.preco_mensal))}<small>/mês</small></span>
          <span class="plano-opcao-preco-nota">Cobrados mensalmente</span>
        </span>
      </label>
    `;
  }).join('');

  const conteudo = `
    <p class="modal-texto">A troca vale a partir da próxima cobrança — o ciclo atual não muda.</p>
    <div class="plano-opcoes">${opcoesHtml}</div>
    <div class="plano-troca-aviso">
      <span class="plano-troca-aviso-icone" aria-hidden="true">🔄</span>
      <span class="plano-troca-aviso-texto">
        <strong>A troca vale a partir da próxima cobrança</strong>
        <span class="plano-troca-aviso-desc">O valor do novo plano será aplicado no próximo ciclo. O ciclo atual continuará normalmente, sem alterações.</span>
      </span>
    </div>
    <div class="modal-erro" id="trocar-plano-erro"></div>
    <div class="modal-acoes">
      <button class="btn-secundario" id="btn-sair-trocar-plano">Sair</button>
      <button class="btn-primario" id="btn-confirmar-trocar-plano">Confirmar troca →</button>
    </div>
  `;
  abrirModal('<h3>Trocar de plano</h3>', conteudo, 'modal-card-pagamento modal-card-trocar-plano');

  document.getElementById('btn-sair-trocar-plano').addEventListener('click', fecharModal);
  document.getElementById('btn-confirmar-trocar-plano').addEventListener('click', async () => {
    const escolhido = document.querySelector('input[name="plano-novo"]:checked:not(:disabled)');
    if (!escolhido) {
      document.getElementById('trocar-plano-erro').textContent = '⚠️ Escolha um plano diferente do atual.';
      return;
    }
    const btn = document.getElementById('btn-confirmar-trocar-plano');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>';

    const resultado = await api('/api/pagamentos/plano', {
      method: 'PATCH',
      body: JSON.stringify({ plano: escolhido.value }),
    });

    if (resultado && !resultado.error) {
      fecharModal();
      mostrarToast('Plano alterado com sucesso.', 'sucesso');
      renderPagamentos();
    } else {
      document.getElementById('trocar-plano-erro').textContent = '⚠️ ' + ((resultado && resultado.error) || 'Erro ao trocar de plano.');
      btn.disabled = false;
      btn.textContent = 'Confirmar troca →';
    }
  });
}

// CA02/CA03/CA04 (US35.2) — modal de confirmação de cancelamento de
// assinatura, no mesmo padrão de abrirModalExcluirServico/abrirModalCancelar.
// Mostra a data de fim do período já pago (calculada a partir da próxima
// cobrança, já que o cancelamento não estorna o período corrente).
function abrirModalCancelarAssinatura(dados) {
  const dataAcesso = dados.proxima_cobranca ? formatarDataCurtaISO(dados.proxima_cobranca.data) : 'o fim do período já pago';

  abrirModal(
    '<h3>Cancelar assinatura</h3>',
    `
      <p class="modal-texto">Sua assinatura será encerrada. Você continuará com acesso até ${dataAcesso}. Após essa data, seu acesso será suspenso.</p>
      <div class="modal-erro" id="cancelar-assinatura-erro"></div>
      <div class="modal-acoes">
        <button class="btn-secundario" id="btn-manter-assinatura">Manter assinatura</button>
        <button class="btn-perigo" id="btn-confirmar-cancelamento">Confirmar cancelamento</button>
      </div>
    `
  );

  document.getElementById('btn-manter-assinatura').addEventListener('click', fecharModal);
  document.getElementById('btn-confirmar-cancelamento').addEventListener('click', async () => {
    const btn = document.getElementById('btn-confirmar-cancelamento');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>';

    const resultado = await api('/api/pagamentos/assinatura', { method: 'DELETE' });

    if (resultado && !resultado.error) {
      fecharModal();
      const dataFinal = resultado.acesso_ate ? formatarDataCurtaISO(resultado.acesso_ate) : dataAcesso;
      mostrarToast(`Assinatura cancelada. Seu acesso continua até ${dataFinal}.`, 'sucesso');
      renderPagamentos();
    } else {
      document.getElementById('cancelar-assinatura-erro').textContent = (resultado && resultado.error) || 'Erro ao cancelar assinatura.';
      btn.disabled = false;
      btn.textContent = 'Confirmar cancelamento';
    }
  });
}

// htmlFormPagamento/wireFormPagamento agora vivem em pagamento-form.js
// (US52) — reaproveitadas também pela tela de bloqueio pós-trial.

function abrirModalPagamento(dadosAtuais) {
  abrirModal('<h3>Forma de pagamento</h3>', htmlFormPagamento(dadosAtuais), 'modal-card-pagamento');
  wireFormPagamento(dadosAtuais, {
    onFechar: fecharModal,
    onSucesso: () => {
      fecharModal();
      renderPagamentos();
    },
  });
}

async function render() {
  // Telas de agenda (Início/Dia/Semana/Mês) precisam de mais largura pra
  // grade de horários e, principalmente, pras colunas da Semana caberem sem
  // scroll horizontal — as demais telas (Perfil, Fatura, Serviços...)
  // continuam nos 720px padrão, estreitos de propósito pra formulário.
  conteudo.classList.toggle('conteudo-largo', menuAtual === 'inicio' || menuAtual === 'agendamento' || menuAtual === 'clientes' || menuAtual === 'modulo:dashboards');

  if (menuAtual === 'inicio') return renderInicio();
  if (menuAtual === 'configuracao') return renderConfiguracao();
  if (menuAtual === 'perfil') return renderPerfil();
  if (menuAtual === 'empresa') return renderMinhaEmpresa();
  if (menuAtual === 'equipe') return renderEquipe();
  if (menuAtual === 'whatsapp') return renderWhatsapp();
  // "Ajuda" (user menu, PR11) reaproveita o mesmo placeholder "em breve" já
  // usado pros módulos ainda não desenvolvidos.
  if (menuAtual === 'ajuda') return renderModuloEmBreve();
  if (menuAtual === 'pagamentos') return renderPagamentos();
  if (menuAtual === 'servicos') return renderServicos();
  if (menuAtual === 'profissionais') return renderProfissionais();
  if (menuAtual === 'clientes') return renderClientes();
  if (menuAtual === 'bloqueios') return renderBloqueios();
  if (menuAtual === 'modulo:financeiro') return renderFinanceiro();
  if (menuAtual === 'modulo:dashboards') return renderRelatorios();
  if (menuAtual.startsWith('modulo:')) return renderModuloEmBreve();

  if (abaAtual === 'dia') return renderDia();
  if (abaAtual === 'semana') return renderSemana();
  if (abaAtual === 'mes') return renderMes();
}

// ---------- Serviços (US17/ST17.3) ----------
let servicosAtuais = [];
// formatarPreco agora vive em pagamento-form.js (US52).

// `nomeProfissionalPreferencial` já vem resolvido de renderServicos (evita
// cada card refazer a mesma busca em profissionaisAtuais).
function renderServicoItem(s, nomeProfissionalPreferencial) {
  const desabilitado = s.ativo === false;
  return `
    <div class="agendamento-item servico-item${desabilitado ? ' servico-desabilitado' : ''}" data-id="${s.id}">
      <div class="servico-info">
        <div class="agendamento-detalhe">Serviço: <strong>${s.nome}</strong></div>
        <div class="agendamento-detalhe">Duração: ${s.duracao_minutos} min</div>
        <div class="agendamento-detalhe">Valor: ${formatarPreco(s.preco)}</div>
        ${s.descricao ? `<div class="agendamento-detalhe servico-descricao">${s.descricao}</div>` : ''}
        ${nomeProfissionalPreferencial && contaStatus && contaStatus.mostrar_profissional ? `<div class="agendamento-detalhe">Profissional preferencial: ${nomeProfissionalPreferencial}</div>` : ''}
        ${desabilitado ? '<span class="badge badge-status-inativo">Desabilitado</span>' : ''}
      </div>
      <div class="servico-acoes">
        <button class="btn-secundario" data-acao-servico="editar" data-id="${s.id}">Editar</button>
        <button class="btn-secundario" data-acao-servico="${desabilitado ? 'habilitar' : 'desabilitar'}" data-id="${s.id}">${desabilitado ? 'Habilitar' : 'Desabilitar'}</button>
        <button class="btn-secundario acao-perigo" data-acao-servico="excluir" data-id="${s.id}">Excluir</button>
      </div>
    </div>
  `;
}

async function alternarAtivoServico(servico) {
  const resultado = await api(`/api/servicos/${servico.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ ativo: !servico.ativo }),
  });
  if (resultado && !resultado.error) {
    mostrarToast(resultado.ativo ? 'Serviço habilitado.' : 'Serviço desabilitado.', 'sucesso');
    renderServicos();
  } else {
    mostrarToast((resultado && resultado.error) || 'Erro ao atualizar serviço.', 'erro');
  }
}

async function renderServicos() {
  conteudo.innerHTML = '<div class="vazio">Carregando...</div>';
  const [dataServicos, dataProfissionais] = await Promise.all([api('/api/servicos'), api('/api/profissionais')]);
  if (!dataServicos) return;
  servicosAtuais = dataServicos.servicos;
  const profissionaisPorId = new Map((dataProfissionais?.profissionais || []).map((p) => [p.id, p.nome]));

  let html = `
    <div class="nav-periodo">
      <strong>Serviços</strong>
      <button class="btn-novo-agendamento" id="btn-novo-servico">+ Novo serviço</button>
    </div>
  `;
  html += servicosAtuais.length
    ? servicosAtuais.map((s) => renderServicoItem(s, profissionaisPorId.get(s.profissional_preferencial_id))).join('')
    : '<div class="vazio">Nenhum serviço cadastrado ainda.</div>';

  conteudo.innerHTML = html;
  document.getElementById('btn-novo-servico').addEventListener('click', () => abrirModalServico(null));
}

function abrirModalServico(servico) {
  const editando = !!servico;
  abrirModal(
    `<h3>${editando ? 'Editar serviço' : 'Novo serviço'}</h3>`,
    `
      <form id="form-servico">
        <div class="modal-erro" id="servico-erro"></div>
        <label for="servico-nome">Nome *</label>
        <input type="text" id="servico-nome" data-obrigatorio value="${editando ? servico.nome : ''}">
        <label for="servico-duracao">Duração (minutos) *</label>
        <input type="number" id="servico-duracao" data-obrigatorio min="1" value="${editando ? servico.duracao_minutos : ''}">
        <label for="servico-preco">Preço em R$ (opcional)</label>
        <input type="number" id="servico-preco" min="0" step="0.01" value="${editando && servico.preco != null ? servico.preco : ''}">
        <label for="servico-descricao">Descrição curta (opcional)</label>
        <textarea id="servico-descricao" rows="2" maxlength="280" placeholder="Ex: inclui lavagem e finalização">${editando && servico.descricao ? servico.descricao : ''}</textarea>
        <label for="servico-profissional-preferencial"${contaStatus && contaStatus.mostrar_profissional ? '' : ' hidden style="display:none"'}>Profissional preferencial (opcional)</label>
        <select id="servico-profissional-preferencial"${contaStatus && contaStatus.mostrar_profissional ? '' : ' hidden style="display:none"'}><option value="">Carregando profissionais...</option></select>
        <div class="modal-acoes">
          <button type="button" class="btn-secundario" id="btn-cancelar-servico">Cancelar</button>
          <button type="submit" class="btn-primario" id="btn-salvar-servico">${editando ? 'Salvar' : 'Criar'}</button>
        </div>
      </form>
    `
  );

  document.getElementById('btn-cancelar-servico').addEventListener('click', fecharModal);

  api('/api/profissionais').then((resultado) => {
    const select = document.getElementById('servico-profissional-preferencial');
    if (!resultado || !resultado.profissionais) {
      select.innerHTML = '<option value="">Erro ao carregar profissionais</option>';
      return;
    }
    select.innerHTML = '<option value="">Nenhum</option>' +
      resultado.profissionais.map((p) => `<option value="${p.id}">${p.nome}</option>`).join('');
    if (editando && servico.profissional_preferencial_id) select.value = servico.profissional_preferencial_id;
  });

  const form = document.getElementById('form-servico');
  form.querySelectorAll('[data-obrigatorio]').forEach((campo) => {
    campo.addEventListener('input', () => campo.classList.remove('campo-invalido'));
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const erroEl = document.getElementById('servico-erro');
    erroEl.textContent = '';
    const invalido = validarObrigatorios(form);
    if (invalido) {
      erroEl.textContent = 'Preencha os campos obrigatórios destacados em vermelho.';
      invalido.focus();
      return;
    }

    const btn = document.getElementById('btn-salvar-servico');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>';

    const precoValor = document.getElementById('servico-preco').value;
    const payload = {
      nome: document.getElementById('servico-nome').value.trim(),
      duracao_minutos: parseInt(document.getElementById('servico-duracao').value, 10),
      preco: precoValor ? parseFloat(precoValor) : null,
      descricao: document.getElementById('servico-descricao').value.trim() || null,
      profissional_preferencial_id: document.getElementById('servico-profissional-preferencial').value || null,
    };

    const resultado = await api(editando ? `/api/servicos/${servico.id}` : '/api/servicos', {
      method: editando ? 'PATCH' : 'POST',
      body: JSON.stringify(payload),
    });

    if (resultado && !resultado.error) {
      fecharModal();
      mostrarToast(editando ? 'Serviço atualizado com sucesso.' : 'Serviço criado com sucesso.', 'sucesso');
      renderServicos();
    } else {
      erroEl.textContent = (resultado && resultado.error) || 'Erro ao salvar serviço.';
      btn.disabled = false;
      btn.textContent = editando ? 'Salvar' : 'Criar';
    }
  });
}

function abrirModalExcluirServico(servico) {
  abrirModal(
    '<h3>Excluir serviço</h3>',
    `
      <p class="modal-texto">Ao confirmar essa exclusão, este serviço não estará mais disponível para novos agendamentos. Deseja excluir mesmo assim?</p>
      <div class="modal-erro" id="excluir-servico-erro"></div>
      <div class="modal-acoes">
        <button class="btn-secundario" id="btn-voltar-excluir-servico">Cancelar</button>
        <button class="btn-perigo" id="btn-confirmar-excluir-servico">Confirmar</button>
      </div>
    `
  );

  document.getElementById('btn-voltar-excluir-servico').addEventListener('click', fecharModal);
  document.getElementById('btn-confirmar-excluir-servico').addEventListener('click', async () => {
    const btn = document.getElementById('btn-confirmar-excluir-servico');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>';

    const resultado = await api(`/api/servicos/${servico.id}`, { method: 'DELETE' });

    if (resultado && !resultado.error) {
      fecharModal();
      mostrarToast('Serviço excluído com sucesso.', 'sucesso');
      renderServicos();
    } else {
      document.getElementById('excluir-servico-erro').textContent = (resultado && resultado.error) || 'Erro ao excluir serviço.';
      btn.disabled = false;
      btn.textContent = 'Confirmar';
    }
  });
}

// ---------- Profissionais (US17/ST17.4) ----------
let profissionaisAtuais = [];

function renderProfissionalItem(p) {
  const qtd = (p.servicos || []).length;
  return `
    <div class="agendamento-item" data-id="${p.id}">
      <div class="agendamento-linha-principal" data-acoes-toggle="${p.id}">
        <div>
          <div class="agendamento-hora">${p.nome}</div>
          <div class="agendamento-detalhe">${qtd} serviço${qtd === 1 ? '' : 's'} atendido${qtd === 1 ? '' : 's'}</div>
        </div>
        <button class="btn-acoes" aria-label="Ações">⋮</button>
      </div>
      <div class="menu-acoes" id="menu-acoes-${p.id}">
        <button data-acao-profissional="editar" data-id="${p.id}">Editar</button>
        <button data-acao-profissional="excluir" data-id="${p.id}" class="acao-perigo">Excluir</button>
      </div>
    </div>
  `;
}

async function renderProfissionais() {
  conteudo.innerHTML = '<div class="vazio">Carregando...</div>';
  const data = await api('/api/profissionais');
  if (!data) return;
  profissionaisAtuais = data.profissionais;

  let html = `
    <div class="nav-periodo">
      <strong>Profissionais</strong>
      <button class="btn-novo-agendamento" id="btn-novo-profissional">+ Novo profissional</button>
    </div>
  `;
  html += profissionaisAtuais.length
    ? profissionaisAtuais.map(renderProfissionalItem).join('')
    : '<div class="vazio">Nenhum profissional cadastrado ainda.</div>';

  conteudo.innerHTML = html;
  document.getElementById('btn-novo-profissional').addEventListener('click', () => abrirModalProfissional(null));
}

async function abrirModalProfissional(profissional) {
  const editando = !!profissional;
  const listaServicosResultado = await api('/api/servicos');
  const listaServicos = (listaServicosResultado && listaServicosResultado.servicos) || [];
  const servicosVinculados = editando ? profissional.servicos || [] : [];

  const checkboxesServicos = listaServicos.length
    ? listaServicos
        .map(
          (s) => `
        <label class="dia-checkbox">
          <input type="checkbox" value="${s.id}" ${servicosVinculados.includes(s.id) ? 'checked' : ''}>
          ${s.nome}
        </label>
      `
        )
        .join('')
    : '<div class="modal-texto">Nenhum serviço cadastrado ainda — cadastre um serviço primeiro.</div>';

  abrirModal(
    `<h3>${editando ? 'Editar profissional' : 'Novo profissional'}</h3>`,
    `
      <form id="form-profissional">
        <div class="modal-erro" id="profissional-erro"></div>
        <label for="profissional-nome">Nome *</label>
        <input type="text" id="profissional-nome" data-obrigatorio value="${editando ? profissional.nome : ''}">
        <label>Serviços atendidos</label>
        <div class="dias-grid" id="profissional-servicos">${checkboxesServicos}</div>
        <div class="modal-acoes">
          <button type="button" class="btn-secundario" id="btn-cancelar-profissional">Cancelar</button>
          <button type="submit" class="btn-primario" id="btn-salvar-profissional">${editando ? 'Salvar' : 'Criar'}</button>
        </div>
      </form>
    `
  );

  document.getElementById('btn-cancelar-profissional').addEventListener('click', fecharModal);

  const form = document.getElementById('form-profissional');
  form.querySelectorAll('[data-obrigatorio]').forEach((campo) => {
    campo.addEventListener('input', () => campo.classList.remove('campo-invalido'));
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const erroEl = document.getElementById('profissional-erro');
    erroEl.textContent = '';
    const invalido = validarObrigatorios(form);
    if (invalido) {
      erroEl.textContent = 'Preencha os campos obrigatórios destacados em vermelho.';
      invalido.focus();
      return;
    }

    const btn = document.getElementById('btn-salvar-profissional');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>';

    const servicosSelecionados = Array.from(document.querySelectorAll('#profissional-servicos input:checked')).map((el) => el.value);
    const payload = {
      nome: document.getElementById('profissional-nome').value.trim(),
      servicos: servicosSelecionados,
    };

    const resultado = await api(editando ? `/api/profissionais/${profissional.id}` : '/api/profissionais', {
      method: editando ? 'PATCH' : 'POST',
      body: JSON.stringify(payload),
    });

    if (resultado && !resultado.error) {
      fecharModal();
      mostrarToast(editando ? 'Profissional atualizado com sucesso.' : 'Profissional criado com sucesso.', 'sucesso');
      renderProfissionais();
    } else {
      erroEl.textContent = (resultado && resultado.error) || 'Erro ao salvar profissional.';
      btn.disabled = false;
      btn.textContent = editando ? 'Salvar' : 'Criar';
    }
  });
}

function abrirModalExcluirProfissional(profissional) {
  abrirModal(
    '<h3>Excluir profissional</h3>',
    `
      <p class="modal-texto">Tem certeza que deseja excluir <strong>${profissional.nome}</strong>? Essa ação não pode ser desfeita.</p>
      <div class="modal-erro" id="excluir-profissional-erro"></div>
      <div class="modal-acoes">
        <button class="btn-secundario" id="btn-voltar-excluir-profissional">Voltar</button>
        <button class="btn-perigo" id="btn-confirmar-excluir-profissional">Excluir</button>
      </div>
    `
  );

  document.getElementById('btn-voltar-excluir-profissional').addEventListener('click', fecharModal);
  document.getElementById('btn-confirmar-excluir-profissional').addEventListener('click', async () => {
    const btn = document.getElementById('btn-confirmar-excluir-profissional');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>';

    const resultado = await api(`/api/profissionais/${profissional.id}`, { method: 'DELETE' });

    if (resultado && !resultado.error) {
      fecharModal();
      mostrarToast('Profissional excluído com sucesso.', 'sucesso');
      renderProfissionais();
    } else {
      document.getElementById('excluir-profissional-erro').textContent = (resultado && resultado.error) || 'Erro ao excluir profissional.';
      btn.disabled = false;
      btn.textContent = 'Excluir';
    }
  });
}

// ---------- Clientes (US63) ----------
// Tela só de leitura: clientes nascem automaticamente ao agendar (POST
// /agendamentos), não existe cadastro manual nem edição/exclusão aqui.
function formatarFormaPagamento(forma) {
  const rotulos = { pix: 'Pix', cartao: 'Cartão', dinheiro: 'Dinheiro', outro: 'Outro' };
  return rotulos[forma] || 'Não informado';
}

// Perfil do cliente (menu Clientes: clicar numa linha da tabela; Início:
// atalho "Cliente" nos Próximos atendimentos) — próximo agendamento, último
// atendimento, histórico completo, observações livres, e um formulário de
// edição (nome/e-mail/nascimento) + exclusão (telefone não é editável: é a
// chave que liga o cliente às mensagens do WhatsApp).
async function abrirModalClienteDetalhe(clienteId) {
  abrirModal('<h3>Cliente</h3>', '<div class="vazio">Carregando...</div>', 'modal-card-pagamento');
  const dados = await api(`/api/clientes/${clienteId}`);
  if (!dados) return;
  const { cliente, proximo_atendimento: proximo, historico } = dados;
  const ultimo = historico[0];

  const conteudo = `
    <div class="cliente-perfil-telefone">${cliente.telefone}</div>
    <div class="cliente-perfil-acoes-topo">
      <button class="btn-secundario" id="btn-cliente-whatsapp" type="button">WhatsApp</button>
      <button class="btn-primario" id="btn-cliente-novo-agendamento" type="button">Novo agendamento</button>
    </div>

    ${proximo ? `
      <div class="cliente-perfil-secao">
        <h4>Próximo agendamento</h4>
        <p>${formatarDataHoraCurta(proximo.data_hora)} · ${proximo.servico_nome}${proximo.profissional_nome ? ` · ${proximo.profissional_nome}` : ''}</p>
      </div>
    ` : ''}

    <div class="cliente-perfil-secao">
      <h4>Último atendimento</h4>
      <p>${ultimo ? `${formatarDataCurta(ultimo.data_hora)} · ${ultimo.servico_nome}${ultimo.valor != null ? ` · ${formatarPreco(Number(ultimo.valor))}` : ''}` : 'Nenhum atendimento registrado ainda.'}</p>
    </div>

    <div class="cliente-perfil-secao">
      <h4>Histórico</h4>
      ${historico.length
        ? `<ul class="cliente-perfil-historico">${historico.map((h) => `<li>${formatarDataCurta(h.data_hora)} &nbsp; ${h.servico_nome}</li>`).join('')}</ul>`
        : '<p class="vazio-inline">Nenhum atendimento registrado ainda.</p>'}
    </div>

    <div class="cliente-perfil-secao">
      <h4>Observações</h4>
      <textarea id="cliente-observacoes" rows="3" placeholder="Anotações livres sobre o cliente">${cliente.observacoes || ''}</textarea>
    </div>

    <h4 class="cliente-perfil-secao-titulo-editar">Editar cadastro</h4>
    <label for="cliente-nome">Nome</label>
    <input type="text" id="cliente-nome" value="${cliente.nome || ''}" placeholder="Nome do cliente">
    <label for="cliente-email">E-mail</label>
    <input type="email" id="cliente-email" value="${cliente.email || ''}" placeholder="cliente@email.com">
    <label for="cliente-nascimento">Data de nascimento</label>
    <input type="date" id="cliente-nascimento" value="${cliente.data_nascimento || ''}">
    <div class="modal-erro" id="cliente-detalhe-erro"></div>
    <div class="modal-acoes">
      <button class="btn-secundario acao-perigo" id="btn-excluir-cliente-detalhe" type="button">Excluir</button>
      <button class="btn-primario" id="btn-salvar-cliente-detalhe" type="button">Salvar</button>
    </div>
  `;
  abrirModal(`<h3>${cliente.nome || 'Cliente'}</h3>`, conteudo, 'modal-card-pagamento modal-cliente-perfil');

  document.getElementById('btn-cliente-whatsapp').addEventListener('click', () => {
    window.open(`https://wa.me/${cliente.telefone}`, '_blank');
  });
  document.getElementById('btn-cliente-novo-agendamento').addEventListener('click', () => {
    fecharModal();
    abrirModalNovoAgendamento({ telefone: cliente.telefone.replace(/^55/, ''), nome: cliente.nome });
  });
  document.getElementById('btn-excluir-cliente-detalhe').addEventListener('click', () => abrirModalExcluirCliente(cliente));
  document.getElementById('btn-salvar-cliente-detalhe').addEventListener('click', async () => {
    const nomeNovo = document.getElementById('cliente-nome').value.trim();
    if (!nomeNovo) {
      document.getElementById('cliente-detalhe-erro').textContent = 'Nome não pode ficar em branco.';
      return;
    }
    const btn = document.getElementById('btn-salvar-cliente-detalhe');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>';

    const resultado = await api(`/api/clientes/${clienteId}`, {
      method: 'PATCH',
      body: JSON.stringify({
        nome: nomeNovo,
        data_nascimento: document.getElementById('cliente-nascimento').value || null,
        email: document.getElementById('cliente-email').value.trim() || null,
        observacoes: document.getElementById('cliente-observacoes').value || null,
      }),
    });

    if (resultado && !resultado.error) {
      fecharModal();
      mostrarToast('Cliente atualizado.', 'sucesso');
      renderClientes();
    } else {
      document.getElementById('cliente-detalhe-erro').textContent = (resultado && resultado.error) || 'Erro ao salvar cliente.';
      btn.disabled = false;
      btn.textContent = 'Salvar';
    }
  });
}

function abrirModalNovoCliente() {
  abrirModal(
    '<h3>Novo cliente</h3>',
    `
      <form id="form-novo-cliente" novalidate>
        <div class="modal-erro" id="novo-cliente-erro"></div>
        <label for="novo-cliente-nome">Nome *</label>
        <input type="text" id="novo-cliente-nome" data-obrigatorio autocomplete="off">
        <label for="novo-cliente-telefone">Telefone *</label>
        <input type="tel" id="novo-cliente-telefone" data-obrigatorio placeholder="11999999999" autocomplete="off">
        <label for="novo-cliente-email">E-mail</label>
        <input type="email" id="novo-cliente-email" placeholder="cliente@email.com" autocomplete="off">
        <div class="modal-acoes">
          <button type="button" class="btn-secundario" id="btn-cancelar-novo-cliente">Cancelar</button>
          <button type="submit" class="btn-primario" id="btn-salvar-novo-cliente">Salvar</button>
        </div>
      </form>
    `,
    'modal-card-pagamento'
  );
  document.getElementById('btn-cancelar-novo-cliente').addEventListener('click', fecharModal);
  const form = document.getElementById('form-novo-cliente');
  form.querySelectorAll('[data-obrigatorio]').forEach((campo) => {
    campo.addEventListener('input', () => campo.classList.remove('campo-invalido'));
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const primeiroInvalido = validarObrigatorios(form);
    if (primeiroInvalido) {
      primeiroInvalido.focus();
      return;
    }
    const btn = document.getElementById('btn-salvar-novo-cliente');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>';

    const resultado = await api('/api/clientes', {
      method: 'POST',
      body: JSON.stringify({
        nome: document.getElementById('novo-cliente-nome').value.trim(),
        telefone: document.getElementById('novo-cliente-telefone').value,
        email: document.getElementById('novo-cliente-email').value.trim() || null,
      }),
    });

    if (resultado && !resultado.error) {
      fecharModal();
      mostrarToast('Cliente cadastrado.', 'sucesso');
      renderClientes();
    } else {
      document.getElementById('novo-cliente-erro').textContent = (resultado && resultado.error) || 'Erro ao cadastrar cliente.';
      btn.disabled = false;
      btn.textContent = 'Salvar';
    }
  });
}

function abrirModalExcluirCliente(cliente) {
  abrirModal(
    '<h3>Excluir cliente</h3>',
    `
      <p class="modal-texto">Essa operação não pode ser desfeita. Deseja confirmar a exclusão de <strong>${cliente.nome || cliente.telefone}</strong>?</p>
      <div class="modal-erro" id="excluir-cliente-erro"></div>
      <div class="modal-acoes">
        <button class="btn-secundario" id="btn-cancelar-excluir-cliente">Cancelar</button>
        <button class="btn-perigo" id="btn-confirmar-excluir-cliente">Confirmar</button>
      </div>
    `
  );
  document.getElementById('btn-cancelar-excluir-cliente').addEventListener('click', fecharModal);
  document.getElementById('btn-confirmar-excluir-cliente').addEventListener('click', async () => {
    const btn = document.getElementById('btn-confirmar-excluir-cliente');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>';

    const resultado = await api(`/api/clientes/${cliente.id}`, { method: 'DELETE' });
    if (resultado && !resultado.error) {
      fecharModal();
      mostrarToast('Cliente excluído com sucesso.', 'sucesso');
      renderClientes();
    } else {
      document.getElementById('excluir-cliente-erro').textContent = (resultado && resultado.error) || 'Erro ao excluir cliente.';
      btn.disabled = false;
      btn.textContent = 'Confirmar';
    }
  });
}

// ---------- Menu Clientes: cabeçalho + busca unificada + filtro por status +
// indicadores + tabela paginada. Clicar numa linha abre o perfil completo em
// modal (abrirModalClienteDetalhe, acima) — não há mais expansão inline. ----------
let clientesAtuais = [];
let clientesFiltro = { busca: '', status: 'todos', pagina: 1, tamanho: 10 };
let clientesFiltroDebounce;
let clientesCampoFocado = null;

const CLIENTES_STATUS_PILLS = [
  ['todos', 'Todos'],
  ['ativo', 'Ativos'],
  ['novo', 'Novos'],
  ['inativo', 'Inativos'],
];
const CLIENTES_STATUS_LABEL = { ativo: 'Ativo', novo: 'Novo', inativo: 'Inativo' };

function renderClienteLinha(c) {
  return `
    <tr class="linha-clicavel" data-cliente-abrir="${c.id}">
      <td>
        <div>${c.nome || 'Sem nome'}</div>
        <div class="cliente-linha-telefone">${c.telefone}</div>
      </td>
      <td><button type="button" class="btn-tabela" data-cliente-whatsapp="${c.telefone}">WhatsApp</button></td>
      <td>${c.ultimo_atendimento_data ? formatarDataCurta(c.ultimo_atendimento_data) : '—'}</td>
      <td>${c.proximo_atendimento_data ? formatarDataHoraCurta(c.proximo_atendimento_data) : '—'}</td>
      <td>${formatarPreco(Number(c.total_gasto))}</td>
      <td><span class="badge badge-cliente-${c.status}">${CLIENTES_STATUS_LABEL[c.status]}</span></td>
    </tr>
  `;
}

async function renderClientes() {
  conteudo.innerHTML = '<div class="vazio">Carregando...</div>';
  const query = new URLSearchParams({
    busca: clientesFiltro.busca,
    status: clientesFiltro.status,
    pagina: String(clientesFiltro.pagina),
    tamanho: String(clientesFiltro.tamanho),
  });
  const data = await api(`/api/clientes?${query}`);
  if (!data) return;
  clientesAtuais = data.clientes;

  const totalPaginas = Math.max(1, Math.ceil(data.total / clientesFiltro.tamanho));
  if (clientesFiltro.pagina > totalPaginas) clientesFiltro.pagina = totalPaginas;

  let html = `
    <div class="inicio-cabecalho">
      <h2>Clientes</h2>
      <button class="btn-novo-agendamento" id="btn-novo-cliente">+ Novo cliente</button>
    </div>

    <div class="clientes-filtros">
      <input type="text" id="clientes-filtro-busca" placeholder="Buscar por nome, telefone ou e-mail" value="${clientesFiltro.busca}">
    </div>

    <div class="clientes-status-pills">
      ${CLIENTES_STATUS_PILLS.map(([valor, label]) => `<button type="button" class="chip-status${clientesFiltro.status === valor ? ' chip-status-ativo' : ''}" data-clientes-status="${valor}">${label}</button>`).join('')}
    </div>

    <div class="inicio-cards" style="grid-template-columns:repeat(3,1fr)">
      ${inicioCard('Clientes', data.kpis.total.toLocaleString('pt-BR'))}
      ${inicioCard('Novos este mês', data.kpis.novos_mes.toLocaleString('pt-BR'))}
      ${inicioCard('Para retornar', data.kpis.para_retornar.toLocaleString('pt-BR'))}
    </div>
  `;

  if (!data.clientes.length) {
    html += '<div class="vazio">Nenhum cliente encontrado.</div>';
  } else {
    html += `
      <div class="tabela-wrapper">
        <table class="tabela-tenants tabela-clientes">
          <thead>
            <tr>
              <th>Cliente</th>
              <th>WhatsApp</th>
              <th>Último atendimento</th>
              <th>Próx. atendimento</th>
              <th>Total gasto</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            ${data.clientes.map(renderClienteLinha).join('')}
          </tbody>
        </table>
      </div>
      <div class="inicio-paginacao">
        <select id="clientes-tamanho">
          <option value="10" ${clientesFiltro.tamanho === 10 ? 'selected' : ''}>10 por página</option>
          <option value="50" ${clientesFiltro.tamanho === 50 ? 'selected' : ''}>50 por página</option>
          <option value="100" ${clientesFiltro.tamanho === 100 ? 'selected' : ''}>100 por página</option>
        </select>
        <button class="btn-secundario" data-clientes-pagina="anterior" ${clientesFiltro.pagina <= 1 ? 'disabled' : ''}>← Anterior</button>
        <span>${clientesFiltro.pagina} de ${totalPaginas}</span>
        <button class="btn-secundario" data-clientes-pagina="proxima" ${clientesFiltro.pagina >= totalPaginas ? 'disabled' : ''}>Próximo →</button>
      </div>
    `;
  }

  conteudo.innerHTML = html;
  document.getElementById('btn-novo-cliente').addEventListener('click', abrirModalNovoCliente);

  // O re-render (conteudo.innerHTML) recria o campo de busca do zero — sem
  // isso, o campo perde o foco/cursor no meio da digitação assim que o
  // debounce dispara. Restaura o foco (e a posição do cursor, no fim do
  // texto) no campo que estava sendo editado, se for o caso.
  if (clientesCampoFocado) {
    const campoEl = document.getElementById(clientesCampoFocado);
    if (campoEl) {
      campoEl.focus();
      campoEl.setSelectionRange(campoEl.value.length, campoEl.value.length);
    }
  }

  // Busca com debounce (não busca a cada tecla) — volta pra página 1 sempre
  // que o filtro muda, senão uma página 3 filtrada pode ficar vazia sem
  // explicação nenhuma.
  document.getElementById('clientes-filtro-busca').addEventListener('input', (e) => {
    const valor = e.target.value;
    clearTimeout(clientesFiltroDebounce);
    clientesFiltroDebounce = setTimeout(() => {
      clientesFiltro.busca = valor;
      clientesFiltro.pagina = 1;
      clientesCampoFocado = 'clientes-filtro-busca';
      renderClientes();
    }, 400);
  });
  // Só existe quando há resultados (fica junto da paginação, ver acima) —
  // lista vazia não renderiza esse select.
  const tamanhoEl = document.getElementById('clientes-tamanho');
  if (tamanhoEl) {
    tamanhoEl.addEventListener('change', (e) => {
      clientesCampoFocado = null;
      clientesFiltro.tamanho = Number(e.target.value);
      clientesFiltro.pagina = 1;
      renderClientes();
    });
  }
}

// ---------- Bloqueios manuais de agenda (US61) ----------
let bloqueiosAtuais = [];

function renderBloqueioItem(b) {
  const periodo = `${formatarDataCurta(b.inicio)} ${formatarHora(b.inicio)} – ${formatarDataCurta(b.fim)} ${formatarHora(b.fim)}`;
  return `
    <div class="agendamento-item servico-item" data-id="${b.id}">
      <div class="servico-info">
        <div class="agendamento-detalhe">Período: <strong>${periodo}</strong></div>
        <div class="agendamento-detalhe">${b.profissional ? `Profissional: ${b.profissional}` : 'Toda a agenda'}</div>
        ${b.motivo ? `<div class="agendamento-detalhe">${b.motivo}</div>` : ''}
      </div>
      <div class="servico-acoes">
        <button class="btn-secundario acao-perigo" data-acao-bloqueio="excluir" data-id="${b.id}">Excluir</button>
      </div>
    </div>
  `;
}

async function renderBloqueios() {
  conteudo.innerHTML = '<div class="vazio">Carregando...</div>';
  const dataBloqueios = await api('/api/bloqueios');
  if (!dataBloqueios) return;
  bloqueiosAtuais = dataBloqueios.bloqueios;

  let html = `
    <div class="nav-periodo">
      <strong>Bloqueio de agenda</strong>
      <button class="btn-novo-agendamento" id="btn-novo-bloqueio">+ Novo bloqueio</button>
    </div>
  `;
  html += bloqueiosAtuais.length
    ? bloqueiosAtuais.map(renderBloqueioItem).join('')
    : '<div class="vazio">Nenhum bloqueio cadastrado ainda.</div>';

  conteudo.innerHTML = html;
  document.getElementById('btn-novo-bloqueio').addEventListener('click', () => abrirModalBloqueio());
}

function abrirModalBloqueio() {
  const hoje = formatarDataISO(new Date());
  // Campo de profissional é uma diferenciação por plano (não pela contagem
  // de profissionais como em mostrar_profissional, usado no resto do app) —
  // decisão do Bruno: todo plano exceto o Essencial (chave 'starter') pode
  // bloquear a agenda de um profissional específico; no Essencial o bloqueio
  // sempre vale pra agenda inteira.
  const mostrarProfissional = contaStatus && contaStatus.plano !== 'starter';
  abrirModal(
    '<h3>Novo bloqueio</h3>',
    `
      <form id="form-bloqueio">
        <div class="modal-erro" id="bloqueio-erro"></div>
        <label for="bloqueio-periodo-inicio">Período *</label>
        <div class="campo-periodo">
          <input type="date" id="bloqueio-periodo-inicio" data-obrigatorio min="${hoje}" value="${hoje}">
          <span class="periodo-separador">até</span>
          <input type="date" id="bloqueio-periodo-fim" data-obrigatorio min="${hoje}" value="${hoje}">
        </div>
        <label for="bloqueio-hora-inicio">Hora de início *</label>
        <input type="time" id="bloqueio-hora-inicio" data-obrigatorio>
        <label for="bloqueio-hora-fim">Hora de fim *</label>
        <input type="time" id="bloqueio-hora-fim" data-obrigatorio>
        <div class="campo-aviso" id="bloqueio-horario-aviso"></div>
        <label for="bloqueio-profissional"${mostrarProfissional ? '' : ' hidden style="display:none"'}>Profissional (opcional)</label>
        <select id="bloqueio-profissional"${mostrarProfissional ? '' : ' hidden style="display:none"'}><option value="">Toda a agenda</option></select>
        <label for="bloqueio-motivo">Motivo (opcional)</label>
        <input type="text" id="bloqueio-motivo" placeholder="Ex: Férias, Feriado, Compromisso pessoal">
        <div class="modal-acoes">
          <button type="button" class="btn-secundario" id="btn-cancelar-bloqueio">Cancelar</button>
          <button type="submit" class="btn-primario" id="btn-salvar-bloqueio">Criar bloqueio</button>
        </div>
      </form>
    `
  );

  document.getElementById('btn-cancelar-bloqueio').addEventListener('click', fecharModal);

  if (mostrarProfissional) {
    api('/api/profissionais').then((resultado) => {
      const select = document.getElementById('bloqueio-profissional');
      if (!resultado || !resultado.profissionais) return;
      select.innerHTML = '<option value="">Toda a agenda</option>' +
        resultado.profissionais.map((p) => `<option value="${p.id}">${p.nome}</option>`).join('');
    });
  }

  // Horário só faz sentido quando o período é um único dia — um bloqueio de
  // vários dias (ex: férias) cobre o dia inteiro em cada um deles. Fora
  // desse caso os campos de hora ficam desabilitados (e saem da validação
  // obrigatória); o payload usa 00:00–23:59:59 pro período inteiro.
  const periodoInicioEl = document.getElementById('bloqueio-periodo-inicio');
  const periodoFimEl = document.getElementById('bloqueio-periodo-fim');
  const horaInicioEl = document.getElementById('bloqueio-hora-inicio');
  const horaFimEl = document.getElementById('bloqueio-hora-fim');
  const horarioAvisoEl = document.getElementById('bloqueio-horario-aviso');

  function atualizarHabilitacaoHorario() {
    // Fim nunca pode ficar antes do início — ajusta o mínimo permitido e
    // empurra o valor pra frente se o usuário mudou o início pra depois do
    // fim já escolhido.
    periodoFimEl.min = periodoInicioEl.value || hoje;
    if (periodoFimEl.value && periodoInicioEl.value && periodoFimEl.value < periodoInicioEl.value) {
      periodoFimEl.value = periodoInicioEl.value;
    }

    const mesmoDia = periodoInicioEl.value && periodoInicioEl.value === periodoFimEl.value;
    [horaInicioEl, horaFimEl].forEach((campo) => {
      campo.disabled = !mesmoDia;
      campo.classList.remove('campo-invalido');
      if (mesmoDia) {
        campo.setAttribute('data-obrigatorio', '');
      } else {
        campo.removeAttribute('data-obrigatorio');
        campo.value = '';
      }
    });
    horarioAvisoEl.textContent = mesmoDia ? '' : 'Período de mais de um dia — o bloqueio vale o dia inteiro, sem horário específico.';
  }
  periodoInicioEl.addEventListener('change', atualizarHabilitacaoHorario);
  periodoFimEl.addEventListener('change', atualizarHabilitacaoHorario);
  atualizarHabilitacaoHorario();

  const form = document.getElementById('form-bloqueio');
  form.querySelectorAll('[data-obrigatorio]').forEach((campo) => {
    campo.addEventListener('input', () => campo.classList.remove('campo-invalido'));
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const erroEl = document.getElementById('bloqueio-erro');
    erroEl.textContent = '';
    const invalido = validarObrigatorios(form);
    if (invalido) {
      erroEl.textContent = 'Preencha os campos obrigatórios destacados em vermelho.';
      invalido.focus();
      return;
    }

    // Ancorado em Brasília (-03:00), mesmo padrão do resto do sistema —
    // nunca deixar o fuso do navegador do usuário influenciar o horário.
    // Período de mais de um dia ignora os campos de hora (desabilitados,
    // ver atualizarHabilitacaoHorario) e cobre o dia inteiro em cada ponta.
    const mesmoDiaAoSalvar = periodoInicioEl.value === periodoFimEl.value;
    const horaInicio = mesmoDiaAoSalvar ? `${horaInicioEl.value}:00` : '00:00:00';
    const horaFim = mesmoDiaAoSalvar ? `${horaFimEl.value}:00` : '23:59:59';
    const inicioISO = new Date(`${periodoInicioEl.value}T${horaInicio}-03:00`).toISOString();
    const fimISO = new Date(`${periodoFimEl.value}T${horaFim}-03:00`).toISOString();

    if (fimISO <= inicioISO) {
      erroEl.textContent = 'O fim do bloqueio deve ser depois do início.';
      return;
    }

    const btn = document.getElementById('btn-salvar-bloqueio');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>';

    const payload = {
      inicio: inicioISO,
      fim: fimISO,
      profissional_id: document.getElementById('bloqueio-profissional').value || null,
      motivo: document.getElementById('bloqueio-motivo').value.trim() || null,
    };

    const resultado = await api('/api/bloqueios', { method: 'POST', body: JSON.stringify(payload) });

    if (resultado && !resultado.error) {
      fecharModal();
      mostrarToast('Bloqueio criado com sucesso.', 'sucesso');
      renderBloqueios();
    } else {
      erroEl.textContent = (resultado && resultado.error) || 'Erro ao criar bloqueio.';
      btn.disabled = false;
      btn.textContent = 'Criar bloqueio';
    }
  });
}

function abrirModalExcluirBloqueio(bloqueio) {
  abrirModal(
    '<h3>Excluir bloqueio</h3>',
    `
      <p class="modal-texto">Tem certeza que deseja excluir esse bloqueio? A agenda volta a ficar disponível nesse período.</p>
      <div class="modal-erro" id="excluir-bloqueio-erro"></div>
      <div class="modal-acoes">
        <button class="btn-secundario" id="btn-voltar-excluir-bloqueio">Cancelar</button>
        <button class="btn-perigo" id="btn-confirmar-excluir-bloqueio">Excluir</button>
      </div>
    `
  );

  document.getElementById('btn-voltar-excluir-bloqueio').addEventListener('click', fecharModal);
  document.getElementById('btn-confirmar-excluir-bloqueio').addEventListener('click', async () => {
    const btn = document.getElementById('btn-confirmar-excluir-bloqueio');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>';

    const resultado = await api(`/api/bloqueios/${bloqueio.id}`, { method: 'DELETE' });

    if (resultado && !resultado.error) {
      fecharModal();
      mostrarToast('Bloqueio excluído com sucesso.', 'sucesso');
      renderBloqueios();
    } else {
      document.getElementById('excluir-bloqueio-erro').textContent = (resultado && resultado.error) || 'Erro ao excluir bloqueio.';
      btn.disabled = false;
      btn.textContent = 'Excluir';
    }
  });
}

function renderModuloEmBreve() {
  conteudo.innerHTML = '<div class="vazio">🚧 Em breve — este módulo ainda está em desenvolvimento.</div>';
}

// ---------- Relatórios (menu "Relatórios", modulo_key='dashboards') ----------
// Dashboard mensal de negócio — GET /api/relatorios/resumo devolve tudo de
// uma vez (KPIs, gráfico diário, agenda, serviços, clientes, financeiro,
// insights); o frontend só formata e distribui num grid multi-coluna (não
// uma pilha vertical — pedido explícito do Bruno, com uma imagem de
// dashboard como referência de estrutura, não de paleta).
let mesRelatorioRef = new Date();
let relatoriosDados = null;

function referenciaRelatorioAtiva() {
  return formatarDataISO(mesRelatorioRef).slice(0, 7);
}

function navPeriodoRelatoriosHtml() {
  const mesLabel = `${mesRelatorioRef.toLocaleDateString('pt-BR', { month: 'long', timeZone: 'America/Sao_Paulo' }).toUpperCase()} ${mesRelatorioRef.getFullYear()}`;
  return `
    <div class="nav-periodo">
      <button data-nav-relatorios="-1" aria-label="Mês anterior">←</button>
      <strong>${mesLabel}</strong>
      <button data-nav-relatorios="1" aria-label="Próximo mês">→</button>
    </div>
  `;
}

function bindNavPeriodoRelatorios() {
  conteudo.querySelector('[data-nav-relatorios="-1"]').addEventListener('click', () => {
    mesRelatorioRef.setMonth(mesRelatorioRef.getMonth() - 1);
    renderRelatorios();
  });
  conteudo.querySelector('[data-nav-relatorios="1"]').addEventListener('click', () => {
    mesRelatorioRef.setMonth(mesRelatorioRef.getMonth() + 1);
    renderRelatorios();
  });
}

// Seta + porcentagem coloridas (verde/vermelho, reaproveitando .financeiro-
// entrada/.financeiro-saida) — "—" quando não há mês anterior pra comparar
// (variacao_pct null: tenant novo, sem dado no mês anterior).
function relatoriosVariacaoHtml(pct) {
  if (pct == null) return '<div class="relatorios-kpi-variacao vazio-inline">sem comparação</div>';
  const seta = pct >= 0 ? '↑' : '↓';
  const classe = pct >= 0 ? 'financeiro-entrada' : 'financeiro-saida';
  return `<div class="relatorios-kpi-variacao ${classe}">${seta} ${Math.abs(pct).toFixed(1)}%</div>`;
}

function relatoriosKpiCard(label, valor, variacaoPct, formato) {
  const valorHtml = valor == null
    ? '—'
    : (formato === 'moeda' ? formatarPreco(valor) : Number(valor).toLocaleString('pt-BR'));
  return `
    <div class="financeiro-resumo-card">
      <div class="financeiro-resumo-label">${label}</div>
      <div class="financeiro-previsto">${valorHtml}</div>
      ${relatoriosVariacaoHtml(variacaoPct)}
    </div>
  `;
}

// Gráfico de tendência diária de faturamento — SVG puro (sem lib), uma
// polyline com um ponto por dia do mês (faturamento_diario já vem do
// backend com todos os dias preenchidos, zeros incluídos).
function renderGraficoFaturamentoDiario(faturamentoDiario) {
  const max = Math.max(1, ...faturamentoDiario.map((d) => d.valor));
  const totalDias = faturamentoDiario.length;
  const largura = 600;
  const altura = 140;
  const pontos = faturamentoDiario.map((d, i) => {
    const x = totalDias > 1 ? (i / (totalDias - 1)) * largura : 0;
    const y = altura - (d.valor / max) * (altura - 12) - 4;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  // Rótulos só em alguns dias (1, 5, 10, 15, 20, 25 e o último), pra não
  // poluir o eixo — mesmo espírito do mockup original.
  const diasRotulados = [...new Set([1, 5, 10, 15, 20, 25, totalDias].filter((d) => d <= totalDias))];
  return `
    <div class="relatorios-grafico-diario">
      <svg viewBox="0 0 ${largura} ${altura}" preserveAspectRatio="none" class="relatorios-svg-linha">
        <polyline points="${pontos}" fill="none" stroke="var(--accent)" stroke-width="2" />
      </svg>
      <div class="relatorios-grafico-eixo">
        ${diasRotulados.map((d) => `<span>${d}</span>`).join('')}
      </div>
    </div>
  `;
}

// "Agosto 2026: R$ 750,00 / Julho 2026: R$ 700,00 / ↓ 42,3%" numa linha só.
function relatoriosComparacaoMensalHtml(kpiFaturamento) {
  const mesAnteriorRef = new Date(mesRelatorioRef);
  mesAnteriorRef.setMonth(mesAnteriorRef.getMonth() - 1);
  const labelAtual = mesRelatorioRef.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric', timeZone: 'America/Sao_Paulo' });
  const labelAnterior = mesAnteriorRef.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric', timeZone: 'America/Sao_Paulo' });
  const variacaoHtml = kpiFaturamento.variacao_pct == null
    ? ''
    : ` · <span class="${kpiFaturamento.variacao_pct >= 0 ? 'financeiro-entrada' : 'financeiro-saida'}">${kpiFaturamento.variacao_pct >= 0 ? '↑' : '↓'} ${Math.abs(kpiFaturamento.variacao_pct).toFixed(1)}%</span>`;
  return `<p class="relatorios-comparacao-mensal">${labelAtual}: <strong>${formatarPreco(kpiFaturamento.valor)}</strong> · ${labelAnterior}: ${formatarPreco(kpiFaturamento.anterior)}${variacaoHtml}</p>`;
}

const RELATORIOS_STATUS_AGENDA = [
  ['realizados', '🟢', 'Realizados'],
  ['agendados', '🔵', 'Agendados'],
  ['cancelados', '🟡', 'Cancelados'],
  ['faltas', '🔴', 'Faltas'],
];

function renderDesempenhoAgenda(agenda) {
  const perdidos = agenda.cancelados + agenda.faltas;
  return `
    <div class="relatorios-status-lista">
      ${RELATORIOS_STATUS_AGENDA.map(([chave, emoji, label]) => `
        <div class="relatorios-status-linha">
          <span>${emoji} ${label}</span>
          <strong>${agenda[chave]}</strong>
        </div>
      `).join('')}
    </div>
    <div class="relatorios-barra-bloco">
      <div class="relatorios-barra-label">Ocupação da agenda</div>
      ${agenda.ocupacao_pct == null
        ? '<div class="vazio-inline">Sem dados suficientes pra calcular (cadastre profissionais e horário de funcionamento).</div>'
        : `
          <div class="onboarding-progresso-barra"><div class="onboarding-progresso-preenchido" style="width:${Math.round(agenda.ocupacao_pct)}%"></div></div>
          <div class="relatorios-barra-valor">${Math.round(agenda.ocupacao_pct)}%</div>
        `}
    </div>
    ${agenda.taxa_comparecimento_pct != null ? `<p class="relatorios-comparacao-mensal">Taxa de comparecimento: <strong>${Math.round(agenda.taxa_comparecimento_pct)}%</strong></p>` : ''}
    ${perdidos > 0 ? `<p class="relatorios-aviso">Você teve ${perdidos} horário${perdidos === 1 ? '' : 's'} perdido${perdidos === 1 ? '' : 's'} este mês.</p>` : ''}
  `;
}

function renderTabelaServicosRelatorio(servicos) {
  if (!servicos.length) return '<div class="vazio">Nenhum atendimento registrado neste mês.</div>';
  return `
    <div class="tabela-wrapper">
      <table class="tabela-tenants">
        <thead><tr><th>Serviço</th><th>Atendimentos</th><th>Faturamento</th></tr></thead>
        <tbody>
          ${servicos.map((s) => `<tr><td>${s.nome}</td><td>${s.atendimentos}</td><td>${formatarPreco(s.faturamento)}</td></tr>`).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function renderSecaoClientesRelatorio(clientes, ticketMedio) {
  return `
    <p class="relatorios-comparacao-mensal"><strong>${clientes.total}</strong> cliente${clientes.total === 1 ? '' : 's'} atendido${clientes.total === 1 ? '' : 's'}</p>
    <div class="relatorios-status-lista">
      <div class="relatorios-status-linha"><span>Novos clientes</span><strong>${clientes.novos}</strong></div>
      <div class="relatorios-status-linha"><span>Clientes recorrentes</span><strong>${clientes.recorrentes}</strong></div>
    </div>
    <div class="relatorios-barra-bloco">
      <div class="relatorios-barra-label">Taxa de retorno</div>
      ${clientes.taxa_retorno_pct == null
        ? '<div class="vazio-inline">Sem dados suficientes.</div>'
        : `
          <div class="onboarding-progresso-barra"><div class="onboarding-progresso-preenchido" style="width:${Math.round(clientes.taxa_retorno_pct)}%"></div></div>
          <div class="relatorios-barra-valor">${Math.round(clientes.taxa_retorno_pct)}%</div>
        `}
    </div>
    <p class="relatorios-comparacao-mensal">Ticket médio: <strong>${clientes.total > 0 ? formatarPreco(ticketMedio) : '—'}</strong></p>
    ${clientes.sem_retorno_60d > 0 ? `<p class="relatorios-aviso">${clientes.sem_retorno_60d} cliente${clientes.sem_retorno_60d === 1 ? '' : 's'} ${clientes.sem_retorno_60d === 1 ? 'está' : 'estão'} há mais de 60 dias sem agendar.</p>` : ''}
  `;
}

// Resumo financeiro do mês — mesma fórmula já confirmada no Financeiro
// (Resultado = Faturamento − Despesas), só que aqui é texto corrido em vez
// dos 4 cards, seguindo o mockup: "não duplicaria toda a tela de
// Financeiro". Mini-gráfico de 2 barras (Receitas × Despesas) fecha a seção.
function renderSecaoFinanceiroRelatorio(financeiro) {
  const resultadoPositivo = financeiro.resultado >= 0;
  const maxBarra = Math.max(1, financeiro.faturamento, financeiro.despesas);
  return `
    <div class="relatorios-financeiro-linhas">
      <div class="relatorios-financeiro-linha"><span>Receita</span><strong class="financeiro-entrada">${formatarPreco(financeiro.faturamento)}</strong></div>
      <div class="relatorios-financeiro-linha"><span>Despesas</span><strong class="financeiro-saida">− ${formatarPreco(financeiro.despesas)}</strong></div>
      <div class="relatorios-financeiro-divisor"></div>
      <div class="relatorios-financeiro-linha relatorios-financeiro-resultado"><span>Resultado</span><strong class="${resultadoPositivo ? 'financeiro-entrada' : 'financeiro-saida'}">${formatarPreco(financeiro.resultado)}</strong></div>
    </div>
    ${financeiro.margem_pct != null ? `<p class="relatorios-comparacao-mensal">Margem: <strong>${financeiro.margem_pct.toFixed(1)}%</strong></p>` : ''}
    <div class="relatorios-mini-grafico">
      <div class="relatorios-mini-barra-coluna">
        <div class="relatorios-mini-barra relatorios-mini-barra-entrada" style="height:${Math.round((financeiro.faturamento / maxBarra) * 100)}%"></div>
        <div class="relatorios-mini-barra-label">Receitas</div>
      </div>
      <div class="relatorios-mini-barra-coluna">
        <div class="relatorios-mini-barra relatorios-mini-barra-saida" style="height:${Math.round((financeiro.despesas / maxBarra) * 100)}%"></div>
        <div class="relatorios-mini-barra-label">Despesas</div>
      </div>
    </div>
  `;
}

// Insights — regra determinística no backend (nunca IA/LLM), o frontend só
// mapeia tipo → emoji e imprime o texto já pronto.
const RELATORIOS_INSIGHT_ICONE = {
  faturamento: '📈',
  perdas: '⚠️',
  clientes_inativos: '💜',
  ocupacao_semanal: '💡',
};

function renderInsightsRelatorio(insights) {
  if (!insights.length) return '<div class="vazio-inline">Sem observações pra este mês.</div>';
  return insights.map((i) => `
    <div class="relatorios-insight-item">
      <span class="relatorios-insight-icone">${RELATORIOS_INSIGHT_ICONE[i.tipo] || '✨'}</span>
      <span>${i.texto}</span>
    </div>
  `).join('');
}

async function renderRelatorios() {
  conteudo.innerHTML = '<div class="vazio">Carregando...</div>';
  const data = await api(`/api/relatorios/resumo?mes=${referenciaRelatorioAtiva()}`);
  if (!data) return;
  relatoriosDados = data;

  let html = `
    <div class="inicio-cabecalho">
      <h2>Relatórios</h2>
    </div>
  ` + navPeriodoRelatoriosHtml() + `
    <div class="relatorios-kpis">
      ${relatoriosKpiCard('Faturamento', data.kpis.faturamento.valor, data.kpis.faturamento.variacao_pct, 'moeda')}
      ${relatoriosKpiCard('Recebido', data.kpis.recebido.valor, data.kpis.recebido.variacao_pct, 'moeda')}
      ${relatoriosKpiCard('Atendimentos', data.kpis.atendimentos.valor, data.kpis.atendimentos.variacao_pct, 'numero')}
      ${relatoriosKpiCard('Clientes', data.kpis.clientes.valor, data.kpis.clientes.variacao_pct, 'numero')}
      ${relatoriosKpiCard('Ticket médio', data.kpis.ticket_medio.valor, data.kpis.ticket_medio.variacao_pct, 'moeda')}
    </div>

    <div class="relatorios-grid-2col">
      <div class="relatorios-secao">
        <h3 class="inicio-secao-titulo">Faturamento</h3>
        ${renderGraficoFaturamentoDiario(data.faturamento_diario)}
        ${relatoriosComparacaoMensalHtml(data.kpis.faturamento)}
      </div>
      <div class="relatorios-secao">
        <h3 class="inicio-secao-titulo">Desempenho da agenda — ${data.agenda.atendimentos_total} atendimento${data.agenda.atendimentos_total === 1 ? '' : 's'}</h3>
        ${renderDesempenhoAgenda(data.agenda)}
      </div>
    </div>

    <div class="relatorios-grid-2col">
      <div class="relatorios-secao">
        <h3 class="inicio-secao-titulo">Faturamento por serviço</h3>
        ${renderTabelaServicosRelatorio(data.servicos)}
      </div>
      <div class="relatorios-secao">
        <h3 class="inicio-secao-titulo">Clientes</h3>
        ${renderSecaoClientesRelatorio(data.clientes, data.kpis.ticket_medio.valor)}
      </div>
    </div>

    <div class="relatorios-secao relatorios-secao-larga">
      <h3 class="inicio-secao-titulo">Resultado financeiro</h3>
      ${renderSecaoFinanceiroRelatorio(data.financeiro)}
    </div>

    <div class="relatorios-secao relatorios-secao-larga relatorios-insights">
      <h3 class="inicio-secao-titulo">✨ Insights da Kyvvo</h3>
      ${renderInsightsRelatorio(data.insights)}
    </div>
  `;

  conteudo.innerHTML = html;
  bindNavPeriodoRelatorios();
}

// Card de um agendamento dentro de uma linha da grade de horários (Dia e,
// no PR3, Semana) — mesmo conteúdo/ações de renderAgendamentoItem (kebab
// com Reagendar/Encaixar/Cancelar), só que compacto o bastante pra caber
// dividido em sub-colunas quando há mais de um profissional no mesmo
// horário (CA da grade: "dividir a coluna ou dois componentes").
function renderAgendamentoGradeCard(ag) {
  const cancelado = ag.status === 'cancelado';
  const concluido = ag.status === 'concluido';
  const falta = ag.status === 'falta';
  const semAcoes = cancelado || concluido || falta;
  return `
    <div class="grade-ag-card${cancelado ? ' agendamento-cancelado' : ''}" data-id="${ag.id}">
      <div class="grade-ag-linha-principal" ${semAcoes ? '' : `data-acoes-toggle="${ag.id}"`}>
        <div>
          <div class="grade-ag-servico">${ag.servico}</div>
          <div class="grade-ag-cliente">${ag.cliente || ag.cliente_telefone}</div>
          <div class="grade-ag-meta">
            ${formatarHora(ag.data_hora)} · ${ag.duracao_minutos}min · ${formatarPreco(ag.preco)}${contaStatus && contaStatus.mostrar_profissional ? ` · ${ag.profissional}` : ''}
            ${ag.encaixe ? '<span class="badge badge-encaixe">Encaixe</span>' : ''}
            ${cancelado ? '<span class="badge badge-cancelado">Cancelado</span>' : ''}
            ${concluido ? '<span class="badge badge-concluido">Concluído</span>' : ''}
            ${falta ? '<span class="badge badge-falta">Falta</span>' : ''}
          </div>
        </div>
        ${semAcoes ? '' : '<button class="btn-acoes" aria-label="Ações">⋮</button>'}
      </div>
      ${semAcoes ? '' : `
        <div class="menu-acoes" id="menu-acoes-${ag.id}">
          <button data-acao="concluir" data-id="${ag.id}">Concluir</button>
          <button data-acao="reagendar" data-id="${ag.id}">Reagendar</button>
          <button data-acao="encaixar" data-id="${ag.id}">Encaixar</button>
          <button data-acao="falta" data-id="${ag.id}">Marcar falta</button>
          <button data-acao="cancelar" data-id="${ag.id}" class="acao-perigo">Cancelar</button>
        </div>
      `}
    </div>
  `;
}

// Grade de horários (abertura→fechamento, menos almoço) de um único dia —
// reaproveitada pela view Dia aqui e pela view Semana (PR3), uma coluna por
// dia. `agendamentos` já deve vir filtrado pro dia em questão.
function renderGradeHorariosDoDia(dataISO, agendamentos) {
  const porHorario = {};
  for (const ag of agendamentos) {
    const chave = horaChaveGradeBucket(ag.data_hora);
    if (!porHorario[chave]) porHorario[chave] = [];
    porHorario[chave].push(ag);
  }

  const horarios = gerarHorariosGrade();
  if (horarios.length === 0) {
    return '<div class="vazio">Nenhum horário configurado (confira Abertura/Fechamento em Configuração).</div>';
  }

  // Destaque de "agora" (PR2) — só quando o dia da grade é hoje, marca a
  // linha cujo bucket de hora contém o horário atual em Brasília.
  const ehHoje = dataISO === formatarDataISO(new Date());
  const horaAtualBucket = ehHoje ? horaChaveGradeBucket(new Date().toISOString()) : null;

  return `
    <div class="grade-horarios">
      ${horarios
        .map((hora) => {
          const agsDoHorario = porHorario[hora] || [];
          const conteudoLinha = agsDoHorario.length
            ? `<div class="grade-ag-grupo" style="grid-template-columns:repeat(${agsDoHorario.length},1fr)">${agsDoHorario.map(renderAgendamentoGradeCard).join('')}</div>`
            : '<div class="grade-linha-vazia">Disponível</div>';
          const horaAtual = hora === horaAtualBucket;
          return `
            <div class="grade-linha${horaAtual ? ' grade-linha-hora-atual' : ''}">
              <div class="grade-linha-hora">${hora}</div>
              <div class="grade-linha-conteudo">${conteudoLinha}</div>
              <button class="grade-linha-add" data-add-horario="${hora}" data-data="${dataISO}" aria-label="Novo agendamento às ${hora}">+</button>
            </div>
          `;
        })
        .join('')}
    </div>
  `;
}

// ---------- Onboarding (US56/US66) ----------
// Modal de "primeiros passos", separado do painel de avisos (US59) e das
// pendências do Início (US63): aqueles são nudges passivos que convivem com
// o resto do painel, este é um modal com progresso e "próximo passo
// recomendado" — pensado pra guiar o primeiro acesso sem virar tela nem item
// fixo de menu (US66 substitui a tela dedicada + item fixo da US56).
function onboardingElegivel(status) {
  return construirPassosOnboarding(status).some((p) => !p.feito) && !status.onboarding_dispensado;
}

function mostrarModalOnboarding(status) {
  const passos = construirPassosOnboarding(status);
  const concluidos = passos.filter((p) => p.feito).length;
  const proximoPasso = passos.find((p) => !p.feito);
  const percentual = Math.round((concluidos / passos.length) * 100);

  const conteudoHtml = `
    <div class="onboarding-cabecalho">
      <h2>Primeiros passos</h2>
      <p>Complete esses passos para deixar o Kyvvo pronto pra receber agendamentos.</p>
      <div class="onboarding-progresso">
        <div class="onboarding-progresso-barra"><div class="onboarding-progresso-preenchido" style="width:${percentual}%"></div></div>
        <span>${concluidos} de ${passos.length} concluídos</span>
      </div>
    </div>
    <ul class="onboarding-lista">
      ${passos.map((p) => {
        const recomendado = !p.feito && proximoPasso && p.id === proximoPasso.id;
        return `
        <li class="onboarding-passo ${p.feito ? 'onboarding-passo-feito' : ''} ${recomendado ? 'onboarding-passo-recomendado' : ''}">
          <div class="onboarding-passo-check" aria-hidden="true">${p.feito ? '✓' : ''}</div>
          <div class="onboarding-passo-texto">
            <strong>${p.titulo}</strong>
            <p>${p.descricao}</p>
            ${recomendado ? '<span class="onboarding-passo-tag">Próximo passo recomendado</span>' : ''}
          </div>
          ${p.feito ? '' : `<button class="btn-secundario" data-acao-onboarding-passo="${p.acaoMenu}">${p.acaoLabel}</button>`}
        </li>
      `;
      }).join('')}
    </ul>
    <button class="link-pular-onboarding" id="btn-pular-onboarding">Pular por agora</button>
  `;

  const overlay = abrirModal('', conteudoHtml, 'modal-card-onboarding');
  overlay.querySelectorAll('[data-acao-onboarding-passo]').forEach((btn) => {
    btn.addEventListener('click', () => {
      fecharModal();
      selecionarMenu(btn.dataset.acaoOnboardingPasso);
    });
  });
  const btnPular = document.getElementById('btn-pular-onboarding');
  if (btnPular) {
    btnPular.addEventListener('click', async () => {
      // Persiste a dispensa pro modal não reaparecer em novos acessos
      // (US66/Cenário 3) — diferente de fechar pelo X/clique fora/Esc sem
      // decidir, que não persiste nada e deixa o modal elegível de novo no
      // próximo carregamento (US66/Cenário 5).
      await api('/api/onboarding/dispensar', { method: 'POST' });
      if (contaStatus) contaStatus.onboarding_dispensado = true;
      fecharModal();
    });
  }
}

// ---------- Início (dashboard, 5 seções) ----------
// Pendências de configuração (sem serviço, sem WhatsApp etc.) e o aviso de
// trial já aparecem globalmente (#avisos-painel/#trial-banner, US59,
// disparados em verificarStatusConta() pra toda tela) — não duplica mais
// isso aqui dentro do conteúdo do Início.
let inicioProximosAtuais = [];
let inicioPaginaAtendimentos = 0;
const INICIO_ATENDIMENTOS_POR_PAGINA = 3;

function renderInicioProximosCorpo() {
  const totalPaginas = Math.max(1, Math.ceil(inicioProximosAtuais.length / INICIO_ATENDIMENTOS_POR_PAGINA));
  if (inicioPaginaAtendimentos >= totalPaginas) inicioPaginaAtendimentos = totalPaginas - 1;
  const inicioIdx = inicioPaginaAtendimentos * INICIO_ATENDIMENTOS_POR_PAGINA;
  const pagina = inicioProximosAtuais.slice(inicioIdx, inicioIdx + INICIO_ATENDIMENTOS_POR_PAGINA);

  if (!pagina.length) {
    return '<div class="vazio">Nenhum agendamento para o restante de hoje.</div>';
  }

  return `
    <div class="inicio-atendimentos-lista">
      ${pagina.map((ag) => `
        <div class="inicio-atendimento-item" data-id="${ag.id}">
          <div class="inicio-atendimento-info">
            <strong>${formatarHora(ag.data_hora)}</strong>
            <span>${ag.cliente || ag.cliente_telefone}</span>
            <span class="inicio-atendimento-servico">${ag.servico}</span>
          </div>
          <div class="inicio-atendimento-acoes">
            <button class="btn-secundario" data-cliente-id="${ag.cliente_id}">Cliente</button>
            <button class="btn-secundario" data-acao-inicio-conversa="${ag.cliente_telefone}">Conversa</button>
          </div>
        </div>
      `).join('')}
    </div>
    ${totalPaginas > 1 ? `
      <div class="inicio-paginacao">
        <button class="btn-secundario" data-inicio-pagina="anterior" ${inicioPaginaAtendimentos === 0 ? 'disabled' : ''}>← Anterior</button>
        <span>${inicioPaginaAtendimentos + 1} de ${totalPaginas}</span>
        <button class="btn-secundario" data-inicio-pagina="proxima" ${inicioPaginaAtendimentos >= totalPaginas - 1 ? 'disabled' : ''}>Próximo →</button>
      </div>
    ` : ''}
  `;
}

function inicioCard(label, valorHtml) {
  return `
    <div class="financeiro-resumo-card">
      <div class="financeiro-resumo-label">${label}</div>
      <div>${valorHtml}</div>
    </div>
  `;
}

async function renderInicio() {
  conteudo.innerHTML = '<div class="vazio">Carregando...</div>';
  const iso = formatarDataISO(new Date());
  const [data, resumo] = await Promise.all([
    api(`/api/agendamentos?view=dia&data=${iso}`),
    api('/api/inicio/resumo'),
  ]);
  if (!data || !resumo) return;

  const agora = Date.now();
  const proximos = data.agendamentos.filter((ag) => ag.status !== 'cancelado' && new Date(ag.data_hora).getTime() >= agora);
  agendamentosAtuais = proximos;
  inicioProximosAtuais = proximos;
  inicioPaginaAtendimentos = 0;

  let html = `
    <div class="inicio-cabecalho">
      <h2>Início</h2>
      <button class="btn-novo-agendamento" id="btn-inicio-novo-agendamento">+ Novo agendamento</button>
    </div>

    <section class="inicio-secao">
      <h3 class="inicio-secao-titulo">Seu dia</h3>
      <div class="inicio-cards" style="grid-template-columns:repeat(3,1fr)">
        ${inicioCard('Atendimentos', resumo.atendimentos_hoje)}
        ${inicioCard('Horários livres', resumo.horarios_livres_hoje)}
        ${inicioCard('Previsto', `<span class="financeiro-previsto">${formatarPreco(resumo.previsto_hoje)}</span>`)}
      </div>
    </section>

    <section class="inicio-secao">
      <h3 class="inicio-secao-titulo">Próximos atendimentos</h3>
      <div id="inicio-secao-proximos-corpo">${renderInicioProximosCorpo()}</div>
    </section>
  `;

  // Atendimento agente Kyvvo — só existe pra tecnologia='ia' (o bot de menu
  // no n8n não grava conversas_ia); o backend já devolve null nesse caso.
  if (resumo.atendimento_ia) {
    html += `
      <section class="inicio-secao">
        <h3 class="inicio-secao-titulo">Atendimento agente Kyvvo</h3>
        <div class="inicio-cards" style="grid-template-columns:repeat(4,1fr)">
          ${inicioCard('Conversas hoje', resumo.atendimento_ia.conversas_hoje)}
          ${inicioCard('Não concluíram', resumo.atendimento_ia.nao_concluiram_hoje)}
          ${inicioCard('Concluídos', resumo.atendimento_ia.concluidos_hoje)}
          ${inicioCard('Min. economizados', resumo.atendimento_ia.minutos_economizados_hoje)}
        </div>
      </section>
    `;
  }

  html += `
    <section class="inicio-secao">
      <h3 class="inicio-secao-titulo">Oportunidades</h3>
      <div class="inicio-oportunidade-item">
        <span>${resumo.oportunidades.clientes_sem_retorno} clientes sem retorno há mais de 30 dias</span>
        <button class="btn-secundario" data-acao-atalho-inicio="clientes">Ver clientes</button>
      </div>
      <div class="inicio-oportunidade-item">
        <span>${resumo.oportunidades.horarios_livres_amanha} horários livres amanhã</span>
        <button class="btn-secundario" data-acao-atalho-inicio="agendamento">Preencher agenda</button>
      </div>
    </section>
  `;

  // Financeiro — só pra quem tem o módulo ativo e pode ver dinheiro (mesma
  // restrição do endpoint /api/inicio/resumo); o backend já devolve null
  // nesse caso, então o resto da tela funciona normalmente sem essa seção.
  if (resumo.financeiro) {
    const variacao = resumo.financeiro.variacao_pct;
    html += `
      <section class="inicio-secao">
        <h3 class="inicio-secao-titulo">Financeiro</h3>
        <div class="inicio-financeiro-mes">
          <span class="financeiro-entrada inicio-financeiro-mes-valor">${formatarPreco(resumo.financeiro.faturado_mes)}</span>
          <span class="inicio-financeiro-mes-legenda">faturado este mês</span>
          ${variacao != null ? `<span class="badge ${variacao >= 0 ? 'badge-variacao-positiva' : 'badge-variacao-negativa'}">${variacao >= 0 ? '+' : ''}${variacao.toFixed(0)}%</span>` : ''}
        </div>
      </section>
    `;
  }

  conteudo.innerHTML = html;
  document.getElementById('btn-inicio-novo-agendamento').addEventListener('click', () => abrirModalNovoAgendamento());
}

async function renderDia() {
  // Anterior/Próximo (e a primeira carga da aba) nunca param num dia fora
  // do horário de funcionamento configurado — pula direto pro próximo dia
  // aberto. Sem direção explícita (primeira carga), pula pra frente.
  dataRef = proximoDiaAberto(dataRef, 1);

  const iso = formatarDataISO(dataRef);
  conteudo.innerHTML = '<div class="vazio">Carregando...</div>';
  const data = await api(`/api/agendamentos?view=dia&data=${iso}`);
  if (!data) return;

  const dataLabel = dataRef.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric', timeZone: 'America/Sao_Paulo' });

  // US02.5 — nome do dia da semana logo abaixo da data, mesmo padrão que a
  // view Semana já usa nos cabeçalhos de cada dia.
  let html = `
    <div class="nav-periodo">
      <button data-nav="-1">← Anterior</button>
      <div class="nav-periodo-data">
        <strong>${dataLabel}</strong>
        <div class="nav-periodo-dia-semana">${nomeDiaSemana(dataRef)}</div>
      </div>
      <button data-nav="1">Próximo →</button>
    </div>
  `;

  agendamentosAtuais = data.agendamentos;
  html += renderGradeHorariosDoDia(iso, data.agendamentos);

  conteudo.innerHTML = html;
  conteudo.querySelector('[data-nav="-1"]').addEventListener('click', () => {
    dataRef.setDate(dataRef.getDate() - 1);
    dataRef = proximoDiaAberto(dataRef, -1);
    renderDia();
  });
  conteudo.querySelector('[data-nav="1"]').addEventListener('click', () => {
    dataRef.setDate(dataRef.getDate() + 1);
    dataRef = proximoDiaAberto(dataRef, 1);
    renderDia();
  });
}

// Segunda-feira (início da semana pro backend — GET /agendamentos?view=semana
// usa date_trunc('week', ...), que no Postgres começa na segunda) da semana
// que contém `dataRef`. Ancora ao meio-dia LOCAL da data já convertida pra
// Brasília via formatarDataISO — nunca usa a instância real de `dataRef`
// direto (mesmo bug do histórico de formatarDataISO: perto da virada do dia
// em UTC, dar setDate/getDay numa instância "de verdade" pode cair no dia
// errado dependendo do fuso do navegador). Meio-dia local nunca cruza a
// virada de dia ao formatar de volta pra Brasília (formatarDataISO/
// nomeDiaSemana), então é seguro reusar essas funções no resto da view.
function inicioDaSemana(dataRef) {
  const [ano, mes, dia] = formatarDataISO(dataRef).split('-').map(Number);
  const d = new Date(ano, mes - 1, dia, 12);
  const diaSemana = d.getDay();
  const diff = diaSemana === 0 ? -6 : 1 - diaSemana;
  d.setDate(d.getDate() + diff);
  return d;
}

async function renderSemana() {
  const iso = formatarDataISO(dataRef);
  conteudo.innerHTML = '<div class="vazio">Carregando...</div>';
  const data = await api(`/api/agendamentos?view=semana&data=${iso}`);
  if (!data) return;

  agendamentosAtuais = data.agendamentos;

  const porDia = {};
  for (const ag of data.agendamentos) {
    const diaISO = ag.data_hora.slice(0, 10);
    if (!porDia[diaISO]) porDia[diaISO] = [];
    porDia[diaISO].push(ag);
  }

  let html = `
    <div class="nav-periodo">
      <button data-nav="-7">← Semana anterior</button>
      <strong>Semana de ${dataRef.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })}</strong>
      <button data-nav="7">Próxima semana →</button>
    </div>
  `;

  // Uma coluna por dia da semana (segunda→domingo) que o negócio funciona —
  // dias fechados nem aparecem (diferente do Mês, que mostra desabilitado).
  // Ao contrário da versão antiga (só listava dias que já tinham
  // agendamento), toda semana aberta mostra as 7 (ou menos) colunas, cada
  // uma com a grade de horários completa, igual à view Dia.
  const diasFuncionamento = configuracao.dias_funcionamento || [1, 2, 3, 4, 5, 6];
  const segunda = inicioDaSemana(dataRef);
  const diasAbertos = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(segunda);
    d.setDate(d.getDate() + i);
    if (diasFuncionamento.includes(d.getDay())) diasAbertos.push(d);
  }

  if (diasAbertos.length === 0) {
    html += '<div class="vazio">Nenhum dia de funcionamento configurado nessa semana.</div>';
  } else {
    // Número de colunas setado inline (CSS puro não sabe quantos dias
    // dias_funcionamento tem) — grid fluido sem min-width fixo, pra caber
    // todos os dias abertos na tela sem precisar de scroll horizontal (PR8).
    const hojeISO = formatarDataISO(new Date());
    html += `<div class="semana-colunas" style="grid-template-columns:repeat(${diasAbertos.length},1fr)">`;
    for (const d of diasAbertos) {
      const diaISO = formatarDataISO(d);
      const dataLabel = d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'America/Sao_Paulo' });
      html += `
        <div class="semana-coluna${diaISO === hojeISO ? ' semana-coluna-hoje' : ''}">
          <div class="semana-coluna-cabecalho">
            <div>
              <strong>${nomeDiaSemana(d)}</strong>
              <span>${dataLabel}</span>
            </div>
            <button class="semana-coluna-add" data-add-dia="${diaISO}" aria-label="Novo agendamento em ${dataLabel}">+</button>
          </div>
          ${renderGradeHorariosDoDia(diaISO, porDia[diaISO] || [])}
        </div>
      `;
    }
    html += '</div>';
  }

  conteudo.innerHTML = html;
  conteudo.querySelector('[data-nav="-7"]').addEventListener('click', () => {
    dataRef.setDate(dataRef.getDate() - 7);
    renderSemana();
  });
  conteudo.querySelector('[data-nav="7"]').addEventListener('click', () => {
    dataRef.setDate(dataRef.getDate() + 7);
    renderSemana();
  });
}

async function renderMes() {
  const mesISO = formatarDataISO(dataRef).slice(0, 7);
  conteudo.innerHTML = '<div class="vazio">Carregando...</div>';
  const data = await api(`/api/agendamentos?view=mes&data=${mesISO}`);
  if (!data) return;

  // US02.6 — antes mostrava só a contagem de agendamentos por dia; agora
  // agrupa por dia e lista horário-duração de cada um, empilhados na célula.
  const porDia = {};
  for (const ag of data.agendamentos) {
    const diaISO = ag.data_hora.slice(0, 10);
    if (!porDia[diaISO]) porDia[diaISO] = [];
    porDia[diaISO].push(ag);
  }

  const ano = dataRef.getFullYear();
  const mes = dataRef.getMonth();
  const primeiroDia = new Date(ano, mes, 1);
  const ultimoDia = new Date(ano, mes + 1, 0);
  const offsetSemana = primeiroDia.getDay();

  const mesLabel = dataRef.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric', timeZone: 'America/Sao_Paulo' });

  let html = `
    <div class="nav-periodo">
      <button data-nav="-1">← Mês anterior</button>
      <strong>${mesLabel}</strong>
      <button data-nav="1">Próximo mês →</button>
    </div>
    <div class="calendario-cabecalho">
      ${NOMES_DIAS.map((nome) => `<div class="calendario-cabecalho-dia">${nome.slice(0, 3)}</div>`).join('')}
    </div>
    <div class="calendario">
  `;

  for (let i = 0; i < offsetSemana; i++) {
    html += '<div class="dia-cel vazio-cel"></div>';
  }
  const diasFuncionamentoMes = configuracao.dias_funcionamento || [1, 2, 3, 4, 5, 6];
  const hojeISOMes = formatarDataISO(new Date());
  for (let dia = 1; dia <= ultimoDia.getDate(); dia++) {
    const diaISO = `${ano}-${String(mes + 1).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
    const agsDoDia = porDia[diaISO] || [];
    const diaSemana = new Date(ano, mes, dia).getDay();
    const fechado = !diasFuncionamentoMes.includes(diaSemana);
    const listaAgendamentos = agsDoDia.length
      ? `<div class="dia-cel-agendamentos">${agsDoDia
          .map(
            (ag) =>
              `<div class="dia-cel-ag${ag.status === 'cancelado' ? ' dia-cel-ag-cancelado' : ''}">${formatarHora(ag.data_hora)}-${ag.duracao_minutos}min</div>`
          )
          .join('')}</div>`
      : '';
    html += `
      <div class="dia-cel${fechado ? ' dia-cel-fechado' : ''}${diaISO === hojeISOMes ? ' dia-cel-hoje' : ''}">
        <div class="num">${dia}</div>
        ${listaAgendamentos}
        ${fechado ? '' : `<button class="dia-cel-add" data-add-dia="${diaISO}" aria-label="Novo agendamento em ${dia}">+</button>`}
      </div>
    `;
  }

  html += '</div>';
  conteudo.innerHTML = html;
  conteudo.querySelector('[data-nav="-1"]').addEventListener('click', () => {
    dataRef.setMonth(dataRef.getMonth() - 1);
    renderMes();
  });
  conteudo.querySelector('[data-nav="1"]').addEventListener('click', () => {
    dataRef.setMonth(dataRef.getMonth() + 1);
    renderMes();
  });
}

// ---------- Perfil (US33) ----------
// UF_OPCOES agora vive em pagamento-form.js (US52).

// Máscara de telefone brasileiro (fixo ou celular) enquanto o usuário digita —
// mesmo raciocínio de exibição do WhatsApp em cadastro.html, mas aqui aplicado
// ao vivo no campo em vez de só no placeholder.
function formatarTelefoneMascara(valor) {
  const digitos = (valor || '').replace(/\D/g, '').slice(0, 11);
  if (digitos.length <= 2) return digitos ? `(${digitos}` : '';
  const ddd = digitos.slice(0, 2);
  const resto = digitos.slice(2);
  if (digitos.length <= 10) {
    return resto.length > 4 ? `(${ddd}) ${resto.slice(0, 4)}-${resto.slice(4)}` : `(${ddd}) ${resto}`;
  }
  return `(${ddd}) ${resto.slice(0, 5)}-${resto.slice(5)}`;
}

function formatarCepMascara(valor) {
  const digitos = (valor || '').replace(/\D/g, '').slice(0, 8);
  return digitos.length > 5 ? `${digitos.slice(0, 5)}-${digitos.slice(5)}` : digitos;
}

// Meu Perfil (dados pessoais, PR12) — Nome do Responsável, Telefone+WhatsApp,
// E-mail. Nome do negócio/Endereço saíram pra renderMinhaEmpresa() logo
// abaixo; as duas telas salvam via PATCH /api/perfil, cada uma enviando só
// o grupo de campo que lhe cabe (o backend trata cada grupo como opcional).
async function renderPerfil() {
  conteudo.innerHTML = '<div class="vazio">Carregando...</div>';
  const perfil = await api('/api/perfil');
  if (!perfil) return;

  // Telefone/WhatsApp continuam sendo colunas separadas no banco (ver PATCH
  // /api/perfil) — o checkbox só reflete se elas já batem, pra não obrigar o
  // dono a digitar o número duas vezes quando são o mesmo.
  const telefoneEhWhatsapp = !!perfil.whatsapp && perfil.whatsapp === perfil.telefone;

  conteudo.innerHTML = `
    <form class="perfil-form" id="form-perfil" novalidate>
      <label for="nome_responsavel">Nome do Responsável <span class="obrigatorio">*</span></label>
      <input type="text" id="nome_responsavel" value="${perfil.nome_responsavel || ''}">
      <div class="field-error" id="erro-nome_responsavel"></div>

      <label for="telefone">Telefone <span class="obrigatorio">*</span></label>
      <div class="campo-com-toggle">
        <input type="tel" id="telefone" placeholder="(11) 99999-9999" value="${formatarTelefoneMascara(perfil.telefone)}">
        <label class="toggle-linha">
          <span class="toggle-switch">
            <input type="checkbox" id="telefone-e-whatsapp" ${telefoneEhWhatsapp ? 'checked' : ''}>
            <span class="toggle-switch-trilho"></span>
          </span>
          Também é WhatsApp?
        </label>
      </div>
      <div class="field-error" id="erro-telefone"></div>

      <label>E-mail</label>
      <input type="text" value="${perfil.email || ''}" disabled>

      <button type="submit" id="btn-salvar-perfil">Salvar alterações</button>
    </form>
  `;

  const telefoneInput = document.getElementById('telefone');
  telefoneInput.addEventListener('input', () => {
    telefoneInput.value = formatarTelefoneMascara(telefoneInput.value);
  });

  document.getElementById('form-perfil').addEventListener('submit', async (e) => {
    e.preventDefault();

    const nomeResponsavel = document.getElementById('nome_responsavel').value;
    const telefone = document.getElementById('telefone').value;

    const erros = {
      nome_responsavel: nomeResponsavel.trim().length >= 2 ? '' : 'Informe o nome do responsável.',
      telefone: telefone.replace(/\D/g, '').length >= 10 ? '' : 'Informe um telefone válido com DDD.',
    };

    let primeiroInvalido = null;
    ['nome_responsavel', 'telefone'].forEach((campo) => {
      document.getElementById(campo).classList.toggle('invalid', !!erros[campo]);
      document.getElementById('erro-' + campo).textContent = erros[campo];
      if (erros[campo] && !primeiroInvalido) primeiroInvalido = document.getElementById(campo);
    });

    if (Object.values(erros).some(Boolean)) {
      if (primeiroInvalido) primeiroInvalido.focus();
      return;
    }

    const btn = document.getElementById('btn-salvar-perfil');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>';

    const resultado = await api('/api/perfil', {
      method: 'PATCH',
      body: JSON.stringify({
        nome_responsavel: nomeResponsavel,
        telefone,
        telefone_e_whatsapp: document.getElementById('telefone-e-whatsapp').checked,
      }),
    });

    if (resultado && !resultado.error) {
      mostrarToast('Perfil atualizado com sucesso.', 'sucesso');
      preencherUserMenu(resultado);
      // US57 — sem isso, a saudação do topo ("Bom dia, {nome antigo}!")
      // ficava com o nome desatualizado até um novo login, mesmo com o
      // resto da tela (user menu) já refletindo o nome novo.
      localStorage.setItem('kyvvo_nome', resultado.nome_responsavel || '');
      atualizarSaudacao();
      renderPerfil();
    } else {
      mostrarToast((resultado && resultado.error) || 'Erro ao salvar. Tente novamente.', 'erro');
      btn.disabled = false;
      btn.textContent = 'Salvar alterações';
    }
  });
}

// ---------- Equipe (US62) ----------
const EQUIPE_ROLE_LABEL = { administrador: 'Administrador', operador: 'Operador' };
const EQUIPE_CONVITE_STATUS_LABEL = { pendente: 'Pendente', expirado: 'Expirado', aceito: 'Aceito', cancelado: 'Cancelado' };
const EQUIPE_CONVITE_STATUS_BADGE = { pendente: 'badge-status-nao-ativado', expirado: 'badge-status-suspenso', aceito: 'badge-status-ativo', cancelado: 'badge-status-inativo' };

async function renderEquipe() {
  conteudo.innerHTML = '<div class="vazio">Carregando...</div>';
  const dados = await api('/api/equipe');
  if (!dados) return;

  let html = `
    <div class="nav-periodo">
      <strong>Equipe</strong>
      <button class="btn-novo-agendamento" id="btn-convidar-membro">+ Convidar membro</button>
    </div>
    <h4 class="pagamento-historico-titulo">Membros</h4>
    <div class="tabela-wrapper tabela-equipe-wrapper">
      <table class="tabela-tenants tabela-equipe">
        <thead><tr><th>Nome</th><th>E-mail</th><th>Perfil</th><th>Status</th><th></th></tr></thead>
        <tbody>
          ${dados.membros.length ? dados.membros.map(renderEquipeMembroLinha).join('') : '<tr><td colspan="5">Nenhum membro cadastrado.</td></tr>'}
        </tbody>
      </table>
    </div>
    <h4 class="pagamento-historico-titulo">Convites</h4>
    <div class="tabela-wrapper tabela-equipe-wrapper">
      <table class="tabela-tenants tabela-equipe">
        <thead><tr><th>E-mail</th><th>Perfil</th><th>Status</th><th>Expira em</th><th></th></tr></thead>
        <tbody>
          ${dados.convites.length ? dados.convites.map(renderEquipeConviteLinha).join('') : '<tr><td colspan="5">Nenhum convite pendente.</td></tr>'}
        </tbody>
      </table>
    </div>
  `;

  conteudo.innerHTML = html;
  document.getElementById('btn-convidar-membro').addEventListener('click', abrirModalConvidarMembro);

  conteudo.querySelectorAll('[data-acao-membro]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const membro = dados.membros.find((m) => m.id === btn.dataset.id);
      if (!membro) return;
      if (btn.dataset.acaoMembro === 'desativar' || btn.dataset.acaoMembro === 'reativar') {
        abrirModalAlterarAtivoMembro(membro);
      }
      if (btn.dataset.acaoMembro === 'remover') abrirModalRemoverMembro(membro);
    });
  });
  conteudo.querySelectorAll('[data-acao-convite]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (btn.dataset.acaoConvite !== 'cancelar') return;
      btn.disabled = true;
      const resultado = await api(`/api/equipe/convites/${btn.dataset.id}`, { method: 'DELETE' });
      if (resultado && !resultado.error) {
        mostrarToast('Convite cancelado.', 'sucesso');
        renderEquipe();
      } else {
        mostrarToast((resultado && resultado.error) || 'Erro ao cancelar convite.', 'erro');
        btn.disabled = false;
      }
    });
  });
}

function renderEquipeMembroLinha(m) {
  return `
    <tr>
      <td>${m.nome || '—'}</td>
      <td>${m.email}</td>
      <td>${EQUIPE_ROLE_LABEL[m.role] || m.role}</td>
      <td><span class="badge badge-status ${m.ativo ? 'badge-status-ativo' : 'badge-status-inativo'}">${m.ativo ? 'Ativo' : 'Desativado'}</span></td>
      <td>
        <button class="btn-secundario btn-tabela" data-acao-membro="${m.ativo ? 'desativar' : 'reativar'}" data-id="${m.id}">${m.ativo ? 'Desativar' : 'Reativar'}</button>
        <button class="btn-secundario btn-tabela acao-perigo" data-acao-membro="remover" data-id="${m.id}">Remover</button>
      </td>
    </tr>
  `;
}

function renderEquipeConviteLinha(c) {
  return `
    <tr>
      <td>${c.email}</td>
      <td>${EQUIPE_ROLE_LABEL[c.role] || c.role}</td>
      <td><span class="badge badge-status ${EQUIPE_CONVITE_STATUS_BADGE[c.status] || 'badge-status-inativo'}">${EQUIPE_CONVITE_STATUS_LABEL[c.status] || c.status}</span></td>
      <td>${formatarDataCurtaISO(c.expires_at.slice(0, 10))}</td>
      <td>${c.status === 'pendente' ? `<button class="btn-secundario btn-tabela acao-perigo" data-acao-convite="cancelar" data-id="${c.id}">Cancelar</button>` : ''}</td>
    </tr>
  `;
}

function abrirModalConvidarMembro() {
  abrirModal(
    '<h3>Convidar membro</h3>',
    `
      <form id="form-convidar-membro">
        <div class="modal-erro" id="convidar-membro-erro"></div>
        <label for="convite-email">E-mail *</label>
        <input type="email" id="convite-email" data-obrigatorio>
        <label for="convite-role">Perfil de acesso *</label>
        <select id="convite-role" data-obrigatorio>
          <option value="operador">Operador — acesso operacional (agenda, clientes, cadastros)</option>
          <option value="administrador">Administrador — acesso completo</option>
        </select>
        <div class="modal-acoes">
          <button type="button" class="btn-secundario" id="btn-cancelar-convite">Cancelar</button>
          <button type="submit" class="btn-primario" id="btn-enviar-convite">Enviar convite</button>
        </div>
      </form>
    `
  );

  document.getElementById('btn-cancelar-convite').addEventListener('click', fecharModal);

  const form = document.getElementById('form-convidar-membro');
  form.querySelectorAll('[data-obrigatorio]').forEach((campo) => {
    campo.addEventListener('input', () => campo.classList.remove('campo-invalido'));
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const erroEl = document.getElementById('convidar-membro-erro');
    erroEl.textContent = '';
    const invalido = validarObrigatorios(form);
    if (invalido) {
      erroEl.textContent = 'Preencha os campos obrigatórios destacados em vermelho.';
      invalido.focus();
      return;
    }

    const btn = document.getElementById('btn-enviar-convite');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>';

    const resultado = await api('/api/equipe/convites', {
      method: 'POST',
      body: JSON.stringify({
        email: document.getElementById('convite-email').value.trim(),
        role: document.getElementById('convite-role').value,
      }),
    });

    if (resultado && !resultado.error) {
      fecharModal();
      mostrarToast('Convite enviado com sucesso.', 'sucesso');
      renderEquipe();
    } else {
      erroEl.textContent = (resultado && resultado.error) || 'Erro ao enviar convite.';
      btn.disabled = false;
      btn.textContent = 'Enviar convite';
    }
  });
}

function abrirModalAlterarAtivoMembro(membro) {
  const desativando = membro.ativo;
  abrirModal(
    `<h3>${desativando ? 'Desativar' : 'Reativar'} membro</h3>`,
    `
      <p class="modal-texto">${desativando
        ? `<strong>${membro.nome || membro.email}</strong> perderá o acesso ao Kyvvo imediatamente. Você pode reativar o acesso quando quiser.`
        : `<strong>${membro.nome || membro.email}</strong> volta a ter acesso ao Kyvvo.`}</p>
      <div class="modal-erro" id="alterar-ativo-membro-erro"></div>
      <div class="modal-acoes">
        <button class="btn-secundario" id="btn-voltar-alterar-ativo">Voltar</button>
        <button class="${desativando ? 'btn-perigo' : 'btn-primario'}" id="btn-confirmar-alterar-ativo">Confirmar</button>
      </div>
    `
  );

  document.getElementById('btn-voltar-alterar-ativo').addEventListener('click', fecharModal);
  document.getElementById('btn-confirmar-alterar-ativo').addEventListener('click', async () => {
    const btn = document.getElementById('btn-confirmar-alterar-ativo');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>';

    const resultado = await api(`/api/equipe/membros/${membro.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ ativo: !desativando }),
    });

    if (resultado && !resultado.error) {
      fecharModal();
      mostrarToast(`Membro ${desativando ? 'desativado' : 'reativado'} com sucesso.`, 'sucesso');
      renderEquipe();
    } else {
      document.getElementById('alterar-ativo-membro-erro').textContent = (resultado && resultado.error) || 'Erro ao atualizar membro.';
      btn.disabled = false;
      btn.textContent = 'Confirmar';
    }
  });
}

function abrirModalRemoverMembro(membro) {
  abrirModal(
    '<h3>Remover membro</h3>',
    `
      <p class="modal-texto">Remover <strong>${membro.nome || membro.email}</strong> da equipe? Esta ação não pode ser desfeita — a pessoa perde o acesso imediatamente e precisaria de um novo convite pra voltar.</p>
      <div class="modal-erro" id="remover-membro-erro"></div>
      <div class="modal-acoes">
        <button class="btn-secundario" id="btn-voltar-remover-membro">Voltar</button>
        <button class="btn-perigo" id="btn-confirmar-remover-membro">Remover</button>
      </div>
    `
  );

  document.getElementById('btn-voltar-remover-membro').addEventListener('click', fecharModal);
  document.getElementById('btn-confirmar-remover-membro').addEventListener('click', async () => {
    const btn = document.getElementById('btn-confirmar-remover-membro');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>';

    const resultado = await api(`/api/equipe/membros/${membro.id}`, { method: 'DELETE' });

    if (resultado && !resultado.error) {
      fecharModal();
      mostrarToast('Membro removido com sucesso.', 'sucesso');
      renderEquipe();
    } else {
      document.getElementById('remover-membro-erro').textContent = (resultado && resultado.error) || 'Erro ao remover membro.';
      btn.disabled = false;
      btn.textContent = 'Remover';
    }
  });
}

// Minha Empresa (dados do negócio, PR12) — Nome do [segmento] + Endereço
// completo. Reaproveita a mesma máscara de CEP/autocomplete ViaCEP que
// antes vivia em renderPerfil.
async function renderMinhaEmpresa() {
  conteudo.innerHTML = '<div class="vazio">Carregando...</div>';
  const perfil = await api('/api/perfil');
  if (!perfil) return;

  const opcoesUF = UF_OPCOES.map((uf) => `<option value="${uf}" ${uf === perfil.endereco_uf ? 'selected' : ''}>${uf}</option>`).join('');
  const nomeCampoSegmento = infoSegmento(perfil.segmento).nomeCampo;

  conteudo.innerHTML = `
    <form class="perfil-form" id="form-empresa" novalidate>
      <label for="nome_segmento">${nomeCampoSegmento} <span class="obrigatorio">*</span></label>
      <input type="text" id="nome_segmento" value="${perfil.nome_segmento || ''}">
      <div class="field-error" id="erro-nome_segmento"></div>

      <label>Endereço</label>
      <div class="endereco-grid">
        <div>
          <label for="endereco-cep" class="endereco-sublabel">CEP <span class="obrigatorio">*</span></label>
          <input type="text" id="endereco-cep" placeholder="00000-000" value="${formatarCepMascara(perfil.endereco_cep)}">
        </div>
        <div>
          <label for="endereco-numero" class="endereco-sublabel">Número <span class="obrigatorio">*</span></label>
          <input type="text" id="endereco-numero" value="${perfil.endereco_numero || ''}">
        </div>
      </div>
      <label for="endereco-logradouro" class="endereco-sublabel">Rua / Logradouro <span class="obrigatorio">*</span></label>
      <input type="text" id="endereco-logradouro" value="${perfil.endereco_logradouro || ''}">
      <div class="endereco-grid">
        <div>
          <label for="endereco-complemento" class="endereco-sublabel">Complemento (opcional)</label>
          <input type="text" id="endereco-complemento" value="${perfil.endereco_complemento || ''}">
        </div>
        <div>
          <label for="endereco-bairro" class="endereco-sublabel">Bairro <span class="obrigatorio">*</span></label>
          <input type="text" id="endereco-bairro" value="${perfil.endereco_bairro || ''}">
        </div>
      </div>
      <div class="endereco-grid">
        <div>
          <label for="endereco-cidade" class="endereco-sublabel">Cidade <span class="obrigatorio">*</span></label>
          <input type="text" id="endereco-cidade" value="${perfil.endereco_cidade || ''}">
        </div>
        <div>
          <label for="endereco-uf" class="endereco-sublabel">Estado <span class="obrigatorio">*</span></label>
          <select id="endereco-uf">${opcoesUF}</select>
        </div>
      </div>
      <div class="field-error" id="erro-endereco"></div>

      <button type="submit" id="btn-salvar-empresa">Salvar alterações</button>
    </form>
  `;

  const cepInput = document.getElementById('endereco-cep');
  cepInput.addEventListener('input', () => {
    cepInput.value = formatarCepMascara(cepInput.value);
  });

  // CA04 — ao sair do campo CEP, autopreenche o resto do endereço via ViaCEP.
  cepInput.addEventListener('blur', async () => {
    const cep = cepInput.value.replace(/\D/g, '');
    if (cep.length !== 8) return;
    try {
      const res = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
      const dados = await res.json();
      if (dados.erro) {
        document.getElementById('erro-endereco').textContent = 'CEP não encontrado. Preencha o endereço manualmente.';
        return;
      }
      document.getElementById('erro-endereco').textContent = '';
      document.getElementById('endereco-logradouro').value = dados.logradouro || '';
      document.getElementById('endereco-bairro').value = dados.bairro || '';
      document.getElementById('endereco-cidade').value = dados.localidade || '';
      document.getElementById('endereco-uf').value = dados.uf || '';
    } catch (erro) {
      // Falha de rede na consulta ao ViaCEP: deixa o usuário preencher os
      // subcampos manualmente em vez de bloquear o formulário.
    }
  });

  document.getElementById('form-empresa').addEventListener('submit', async (e) => {
    e.preventDefault();

    const nomeSegmento = document.getElementById('nome_segmento').value;
    const cep = document.getElementById('endereco-cep').value;
    const logradouro = document.getElementById('endereco-logradouro').value;
    const numero = document.getElementById('endereco-numero').value;
    const complemento = document.getElementById('endereco-complemento').value;
    const bairro = document.getElementById('endereco-bairro').value;
    const cidade = document.getElementById('endereco-cidade').value;
    const uf = document.getElementById('endereco-uf').value;

    const erros = {
      nome_segmento: nomeSegmento.trim().length >= 2 ? '' : 'Informe o nome do seu negócio.',
      endereco:
        cep.replace(/\D/g, '').length === 8 && logradouro.trim() && numero.trim() && bairro.trim() && cidade.trim() && uf
          ? ''
          : 'Preencha todos os campos do endereço.',
    };

    let primeiroInvalido = null;
    document.getElementById('nome_segmento').classList.toggle('invalid', !!erros.nome_segmento);
    document.getElementById('erro-nome_segmento').textContent = erros.nome_segmento;
    if (erros.nome_segmento) primeiroInvalido = document.getElementById('nome_segmento');
    document.getElementById('erro-endereco').textContent = erros.endereco;
    if (erros.endereco && !primeiroInvalido) primeiroInvalido = document.getElementById('endereco-cep');

    if (Object.values(erros).some(Boolean)) {
      if (primeiroInvalido) primeiroInvalido.focus();
      return;
    }

    const btn = document.getElementById('btn-salvar-empresa');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>';

    const resultado = await api('/api/perfil', {
      method: 'PATCH',
      body: JSON.stringify({
        nome_segmento: nomeSegmento,
        endereco: { cep, logradouro, numero, complemento, bairro, cidade, uf },
      }),
    });

    if (resultado && !resultado.error) {
      mostrarToast('Dados da empresa atualizados com sucesso.', 'sucesso');
      preencherUserMenu(resultado);
      renderMinhaEmpresa();
    } else {
      mostrarToast((resultado && resultado.error) || 'Erro ao salvar. Tente novamente.', 'erro');
      btn.disabled = false;
      btn.textContent = 'Salvar alterações';
    }
  });
}

// Confirmação antes de desabilitar um dia de funcionamento que estava
// marcado — o próprio PATCH /api/configuracao já move (sem checar colisão,
// decisão confirmada) os agendamentos futuros confirmados desse dia pro
// próximo dia que continua aberto, então essa confirmação só avisa a
// consequência antes de disparar o salvamento em si (mesmo padrão visual
// dos outros popups de confirmação desta sessão).
function abrirModalConfirmarDiasFechados(onContinuar) {
  abrirModal(
    '<h3>Desabilitar dia de funcionamento</h3>',
    `
      <p class="modal-texto">Se houver algum agendamento marcado nesse(s) dia(s), ele será movido automaticamente para o próximo dia útil disponível. Deseja continuar?</p>
      <div class="modal-acoes">
        <button class="btn-secundario" id="btn-cancelar-dias-fechados">Cancelar</button>
        <button class="btn-primario" id="btn-continuar-dias-fechados">Continuar</button>
      </div>
    `
  );

  document.getElementById('btn-cancelar-dias-fechados').addEventListener('click', fecharModal);
  document.getElementById('btn-continuar-dias-fechados').addEventListener('click', () => {
    fecharModal();
    onContinuar();
  });
}

// Único texto exibido em renderWhatsapp() que não vem do próprio backend do
// Kyvvo (nome verificado / mensagem de erro vêm da Graph API da Meta) — por
// isso escapado explicitamente, diferente do resto do app.js que confia nos
// dados já validados do próprio perfil do tenant.
function escapeHtml(valor) {
  return String(valor ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[c]));
}

let fbSdkPromise = null;
function carregarFacebookSdk(appId) {
  if (fbSdkPromise) return fbSdkPromise;
  fbSdkPromise = new Promise((resolve) => {
    window.fbAsyncInit = function () {
      FB.init({ appId, cookie: true, xfbml: false, version: 'v26.0' });
      resolve();
    };
    const script = document.createElement('script');
    script.src = 'https://connect.facebook.net/pt_BR/sdk.js';
    script.async = true;
    script.defer = true;
    document.body.appendChild(script);
  });
  return fbSdkPromise;
}

// Self-service de conexão do WhatsApp (Embedded Signup da Meta) — mostra o
// status atual (GET /api/whatsapp/status, mesma lógica do card de status já
// usado em Fatura/Admin) e, se ainda não conectado, um botão que abre o
// popup de login do Facebook pra o tenant escolher/criar a WhatsApp Business
// Account dele. Ver plano em .claude/plans — nenhum token de tenant é salvo
// aqui, só waba_id/phone_number_id (POST /api/whatsapp/conectar).
async function renderWhatsapp() {
  conteudo.innerHTML = '<div class="vazio">Carregando...</div>';
  const status = await api('/api/whatsapp/status');
  if (!status) return;

  let cardClasse = 'status-card-inativo';
  let linha2 = 'Não conectado';
  let linha3 = 'Conecte o WhatsApp do seu negócio pra ativar o agendamento automático pelo bot.';

  if (status.conectado) {
    cardClasse = 'status-card-ativo';
    linha2 = status.numeroExibido || 'Conectado';
    linha3 = [status.nomeVerificado, status.qualidade ? `Qualidade: ${status.qualidade}` : null].filter(Boolean).join(' · ') || 'Sem detalhes adicionais.';
  } else if (status.erro) {
    cardClasse = 'status-card-pendente';
    linha2 = 'Erro de conexão';
    linha3 = status.erro;
  }

  // US46.1 — antes de mostrar o botão de self-service, explica que ele é uma
  // das duas formas de conectar o WhatsApp. US39.1 trocou o antigo link "fale
  // com o suporte" pro caminho "Número pronto" por um pedido de verdade
  // (POST /api/whatsapp/solicitar-numero-novo), registrado no tenant pra a
  // operação (Bruno) ver quem está esperando — ver checklist da jornada na
  // task US39.1 do Notion. Continua sem prometer prazo fechado.
  const pedido = status.pedidoNumeroNovo;
  const planosInfo = status.conectado ? '' : `
    <div class="whatsapp-planos-info">
      <p><strong>Traga seu número</strong> — disponível agora: conecte o WhatsApp Business que sua empresa já usa clicando no botão abaixo, pelo Embedded Signup oficial da Meta. A ativação depende só da verificação da Meta ser concluída.</p>
      ${pedido
        ? `<p><strong>Número pronto</strong> — pedido recebido em ${formatarDataHoraCurta(pedido.solicitadoEm)}. Nossa equipe vai configurar um número novo pra você e avisar assim que estiver pronto (ainda não temos um prazo fechado pra isso).</p>`
        : `<p><strong>Número pronto</strong> — prefere que a Kyvvo configure um número novo pra você, sem esforço técnico? O time confirma disponibilidade e ativa o número; hoje esse caminho ainda depende de configuração manual, não é automático.</p>
           <button type="button" class="btn-secundario btn-tabela" id="btn-pedir-numero-novo" style="margin-top:4px">Pedir número novo</button>`}
    </div>
  `;

  conteudo.innerHTML = `
    <h2 class="titulo-detalhe">WhatsApp</h2>
    <div class="financeiro-resumo" style="grid-template-columns: 1fr">
      <div class="financeiro-resumo-card financeiro-resumo-card-3linhas ${cardClasse}">
        <div class="financeiro-resumo-label">${status.conectado ? 'WhatsApp conectado' : 'WhatsApp'}</div>
        <div class="financeiro-resumo-linha2">${escapeHtml(linha2)}</div>
        <div class="financeiro-resumo-linha3">${escapeHtml(linha3)}</div>
      </div>
    </div>
    ${planosInfo}
    ${status.conectado ? '' : '<button class="btn-primario" id="btn-conectar-whatsapp" disabled style="margin-top:16px">Carregando conexão...</button>'}
  `;

  if (!status.conectado) {
    iniciarConexaoWhatsapp();
    const btnPedirNumeroNovo = document.getElementById('btn-pedir-numero-novo');
    if (btnPedirNumeroNovo) btnPedirNumeroNovo.addEventListener('click', abrirModalPedirNumeroNovo);
  }
}

// Formata timestamp completo (data + hora) em pt-BR curto, ex.: "03/08/2026
// às 14:30" — usado só no pedido de número novo, distinto de
// formatarDataCurtaISO (que só recebe "YYYY-MM-DD" sem hora).
function formatarDataHoraCurta(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  const data = d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const hora = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  return `${data} às ${hora}`;
}

// CA (US39.1) — passos 2/3 da jornada "Novo número": os outros dados mínimos
// (nome do negócio, telefone, segmento, horário) já foram coletados no
// cadastro, então o formulário só pede o que ainda falta (preferência de DDD)
// e a confirmação de que o tenant aceita usar um número novo fornecido pela
// Kyvvo. Depois de enviar, mostra a mensagem de expectativa (sem prometer
// prazo) no lugar do formulário.
function abrirModalPedirNumeroNovo() {
  abrirModal(
    '<h3>Pedir número novo</h3>',
    `
      <p class="modal-texto">A Kyvvo configura um número de WhatsApp novo pro seu negócio — você não precisa fazer nada técnico. Prazo é confirmado depois que a gente validar disponibilidade.</p>
      <label for="numero-novo-ddd">DDD de preferência (opcional)</label>
      <input type="text" id="numero-novo-ddd" placeholder="Ex.: 34" maxlength="3" inputmode="numeric">
      <label class="dia-checkbox" style="margin-top:12px">
        <input type="checkbox" id="numero-novo-aceite">
        Entendo que o número será fornecido pelo time Kyvvo e serei avisado quando estiver pronto.
      </label>
      <div class="modal-erro" id="numero-novo-erro"></div>
      <div class="modal-acoes">
        <button class="btn-secundario" id="btn-cancelar-numero-novo">Cancelar</button>
        <button class="btn-primario" id="btn-confirmar-numero-novo">Enviar pedido</button>
      </div>
    `
  );

  document.getElementById('btn-cancelar-numero-novo').addEventListener('click', fecharModal);
  document.getElementById('btn-confirmar-numero-novo').addEventListener('click', async () => {
    const erroEl = document.getElementById('numero-novo-erro');
    erroEl.textContent = '';

    if (!document.getElementById('numero-novo-aceite').checked) {
      erroEl.textContent = 'Confirme que você entendeu como funciona antes de enviar.';
      return;
    }

    const btn = document.getElementById('btn-confirmar-numero-novo');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>';

    const dddPreferencia = document.getElementById('numero-novo-ddd').value.trim();
    const resultado = await api('/api/whatsapp/solicitar-numero-novo', {
      method: 'POST',
      body: JSON.stringify({ ddd_preferencia: dddPreferencia || null }),
    });

    if (resultado && !resultado.error) {
      fecharModal();
      mostrarToast('Pedido enviado! A gente avisa assim que o número estiver pronto.', 'sucesso');
      renderWhatsapp();
    } else {
      erroEl.textContent = (resultado && resultado.error) || 'Erro ao enviar o pedido.';
      btn.disabled = false;
      btn.textContent = 'Enviar pedido';
    }
  });
}

async function iniciarConexaoWhatsapp() {
  const btn = document.getElementById('btn-conectar-whatsapp');
  const config = await api('/api/whatsapp/config-publica');
  if (!btn) return; // usuário já navegou pra outra tela enquanto isso carregava

  if (!config || !config.appId || !config.configId) {
    btn.textContent = 'Conexão indisponível no momento';
    return;
  }

  await carregarFacebookSdk(config.appId);
  btn.textContent = 'Conectar WhatsApp';
  btn.disabled = false;

  let dadosSignup = null;
  function ouvirMensagem(event) {
    if (event.origin !== 'https://www.facebook.com' && event.origin !== 'https://web.facebook.com') return;
    try {
      const dados = JSON.parse(event.data);
      if (dados.type === 'WA_EMBEDDED_SIGNUP' && dados.event === 'FINISH') {
        dadosSignup = dados.data;
      }
    } catch (erro) {
      // mensagem de outra origem/formato inesperado — ignora
    }
  }
  window.addEventListener('message', ouvirMensagem);

  btn.addEventListener('click', () => {
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>';
    FB.login(
      (response) => {
        window.removeEventListener('message', ouvirMensagem);
        const code = response.authResponse && response.authResponse.code;
        if (!code || !dadosSignup) {
          mostrarToast('Conexão cancelada ou incompleta. Tente novamente.', 'erro');
          renderWhatsapp();
          return;
        }
        conectarWhatsapp(code, dadosSignup.waba_id, dadosSignup.phone_number_id);
      },
      { config_id: config.configId, response_type: 'code', override_default_response_type: true, extras: { setup: {} } }
    );
  }, { once: true });
}

async function conectarWhatsapp(code, wabaId, phoneNumberId) {
  const resultado = await api('/api/whatsapp/conectar', {
    method: 'POST',
    body: JSON.stringify({ code, wabaId, phoneNumberId }),
  });
  if (resultado && !resultado.error) {
    mostrarToast('WhatsApp conectado com sucesso!', 'sucesso');
  } else {
    mostrarToast((resultado && resultado.error) || 'Erro ao conectar o WhatsApp.', 'erro');
  }
  renderWhatsapp();
}

async function renderConfiguracao() {
  conteudo.innerHTML = '<div class="vazio">Carregando...</div>';
  await carregarConfiguracao();
  const dias = configuracao.dias_funcionamento || [1, 2, 3, 4, 5, 6];
  const formato = configuracao.formato_hora || '24h';
  // "time" do Postgres vem com segundos ("08:00:00"); <input type="time">
  // espera "HH:MM".
  const horarioAbertura = (configuracao.horario_abertura || '08:00').slice(0, 5);
  const horarioFechamento = (configuracao.horario_fechamento || '20:00').slice(0, 5);
  const almocoAtivo = !!configuracao.horario_almoco_ativo;
  const almocoInicio = (configuracao.horario_almoco_inicio || '12:00').slice(0, 5);
  const almocoFim = (configuracao.horario_almoco_fim || '13:00').slice(0, 5);

  // US69/CA06 — modo de atendimento é somente leitura aqui: quem altera é o
  // admin Kyvvo (vinculado ao plano contratado), não o dono do salão.
  const modoIa = configuracao.tecnologia === 'ia';
  const modoAtendimentoHtml = `
    <div class="perfil-form" style="margin-bottom:24px">
      <label>Modo de atendimento</label>
      <div class="modal-texto">
        <span class="badge ${modoIa ? 'badge-modo-ia' : 'badge-modo-bot'}">
          ${modoIa ? '✨ IA — Linguagem natural' : '🤖 Bot — Menus numerados'}
        </span>
      </div>
      <div class="modal-texto">${escapeHtml(configuracao.plano_atual || '')}</div>
      ${modoIa ? '' : '<div class="modal-texto"><a href="mailto:suporte@kyvvo.com.br">Fale conosco para fazer upgrade</a></div>'}
    </div>
  `;

  const toggleDias = NOMES_DIAS.map((nome, idx) => `
    <label class="dia-toggle-cel">
      <span class="dia-toggle-nome">${nome.slice(0, 3)}</span>
      <span class="toggle-switch">
        <input type="checkbox" value="${idx}" ${dias.includes(idx) ? 'checked' : ''}>
        <span class="toggle-switch-trilho"></span>
      </span>
    </label>
  `).join('');

  conteudo.innerHTML = `
    ${modoAtendimentoHtml}
    <form class="perfil-form" id="form-config">
      <label>Dias em que ${infoSegmento(configuracao.segmento).dias} funciona (aparecem na agenda)</label>
      <div class="dias-grid">${toggleDias}</div>

      <label>Formato de hora</label>
      <div class="formato-hora-opcoes">
        <label class="dia-checkbox">
          <input type="radio" name="formato" value="24h" ${formato === '24h' ? 'checked' : ''}>
          24h (ex: 14:00)
        </label>
        <label class="dia-checkbox">
          <input type="radio" name="formato" value="12h" ${formato === '12h' ? 'checked' : ''}>
          AM/PM (ex: 2:00 PM)
        </label>
      </div>

      <label>Horário de funcionamento</label>
      <div class="formato-hora-opcoes">
        <div>
          <label for="config-horario-abertura">Abertura</label>
          <input type="time" id="config-horario-abertura" value="${horarioAbertura}">
        </div>
        <div>
          <label for="config-horario-fechamento">Fechamento</label>
          <input type="time" id="config-horario-fechamento" value="${horarioFechamento}">
        </div>
      </div>
      <div class="modal-texto">Agendamentos só podem ser feitos dentro desse intervalo.</div>

      <label class="toggle-linha" style="margin-top:16px">
        <span class="toggle-switch">
          <input type="checkbox" id="config-almoco-ativo" ${almocoAtivo ? 'checked' : ''}>
          <span class="toggle-switch-trilho"></span>
        </span>
        Habilitar horário de almoço
      </label>
      <div class="formato-hora-opcoes" id="config-almoco-campos" style="${almocoAtivo ? '' : 'display:none'}">
        <div>
          <label for="config-almoco-inicio">Início</label>
          <input type="time" id="config-almoco-inicio" value="${almocoInicio}">
        </div>
        <div>
          <label for="config-almoco-fim">Término</label>
          <input type="time" id="config-almoco-fim" value="${almocoFim}">
        </div>
      </div>

      <button type="submit">Salvar</button>
      <div class="erro" id="config-msg"></div>
    </form>
  `;

  const almocoAtivoInput = document.getElementById('config-almoco-ativo');
  const almocoCampos = document.getElementById('config-almoco-campos');
  almocoAtivoInput.addEventListener('change', () => {
    almocoCampos.style.display = almocoAtivoInput.checked ? '' : 'none';
  });

  async function salvarConfiguracao(payload) {
    const msg = document.getElementById('config-msg');
    msg.style.color = '';
    msg.textContent = 'Salvando...';

    const resultado = await api('/api/configuracao', { method: 'PATCH', body: JSON.stringify(payload) });

    if (resultado && !resultado.error) {
      configuracao = resultado;
      msg.style.color = '#4ade80';
      msg.textContent = resultado.agendamentos_movidos > 0
        ? `Salvo com sucesso! ${resultado.agendamentos_movidos} agendamento(s) movido(s) para o próximo dia disponível.`
        : 'Salvo com sucesso!';
    } else {
      msg.style.color = '#ff6b6b';
      msg.textContent = (resultado && resultado.error) || 'Erro ao salvar configuração.';
    }
  }

  document.getElementById('form-config').addEventListener('submit', (e) => {
    e.preventDefault();

    const diasFuncionamento = Array.from(document.querySelectorAll('.dias-grid input:checked')).map((el) => parseInt(el.value, 10));
    const formatoHora = document.querySelector('input[name="formato"]:checked').value;
    const horarioAbertura = document.getElementById('config-horario-abertura').value;
    const horarioFechamento = document.getElementById('config-horario-fechamento').value;
    const horarioAlmocoAtivo = almocoAtivoInput.checked;
    const horarioAlmocoInicio = horarioAlmocoAtivo ? document.getElementById('config-almoco-inicio').value : null;
    const horarioAlmocoFim = horarioAlmocoAtivo ? document.getElementById('config-almoco-fim').value : null;

    const payload = {
      diasFuncionamento, formatoHora, horarioAbertura, horarioFechamento,
      horarioAlmocoAtivo, horarioAlmocoInicio, horarioAlmocoFim,
    };

    // Só avisa/confirma quando algum dia que ANTES estava marcado foi
    // desmarcado agora — adicionar dia ou salvar sem mexer nos dias segue
    // direto pro salvamento, sem popup.
    const diasAtuais = configuracao.dias_funcionamento || [1, 2, 3, 4, 5, 6];
    const desmarcouAlgumDia = diasAtuais.some((d) => !diasFuncionamento.includes(d));

    if (desmarcouAlgumDia) {
      abrirModalConfirmarDiasFechados(() => salvarConfiguracao(payload));
    } else {
      salvarConfiguracao(payload);
    }
  });
}

// Lê a seção a partir da URL de carregamento (ex.: /agenda) em vez de sempre
// abrir em Início — selecionarMenu (não só render()) porque também precisa
// corrigir o "active" da sidebar, que o HTML estático sempre marca em
// Início. atualizarUrl:false porque a URL já É a fonte — não tem o que
// empurrar de novo.
carregarConfiguracao().then(() => {
  selecionarMenu(menuDoCaminho(window.location.pathname) || 'inicio', { atualizarUrl: false });
});
carregarModulosNoMenu();
carregarUserMenu();
