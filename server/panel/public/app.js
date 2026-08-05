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
    window.location.href = '/verificar.html';
    return;
  }

  // US52/CA03 — trial vencido sem assinatura ativa: o backend já bloqueia
  // essas rotas com 403 (fastify.authenticate), mas o redirect aqui evita
  // que o painel tente renderizar e tropece nesses 403 antes de mandar o
  // cliente pra tela de regularização.
  if (status.status === 'trial' && status.trial_ativo === false) {
    window.location.href = '/bloqueio.html';
    return;
  }

  // CA08 — toast verde ao voltar da validação do token.
  if (new URLSearchParams(location.search).get('verificado') === '1') {
    mostrarToast('E-mail verificado! Seu trial de 14 dias está ativo.', 'sucesso');
    history.replaceState(null, '', location.pathname);
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
}

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

const nomeUsuario = (localStorage.getItem('kyvvo_nome') || '').split(' ')[0] || '';
document.getElementById('saudacao').textContent = `${saudacaoPorHorario()}${nomeUsuario ? ', ' + nomeUsuario : ''}!`;

const conteudo = document.getElementById('conteudo');
const menuEl = document.querySelector('.menu');
const subtabsEl = document.getElementById('subtabs');
const tabs = document.querySelectorAll('.tab');
let menuAtual = 'agendamento';
let abaAtual = 'dia';
let dataRef = new Date();
let configuracao = { dias_funcionamento: [1, 2, 3, 4, 5, 6], formato_hora: '24h' };

async function carregarConfiguracao() {
  const dados = await api('/api/configuracao');
  if (dados) configuracao = dados;
}

const menuCadastrosToggle = document.getElementById('menu-cadastros-toggle');
const menuCadastrosSubmenu = document.getElementById('menu-cadastros-submenu');

// Reaproveitada tanto pelos itens da sidebar quanto pelos itens do user
// menu (dropdown do avatar, ST-user-menu) — os dois só precisam de um jeito
// de trocar `menuAtual` e re-renderizar; a diferença é só onde o clique
// aconteceu.
function selecionarMenu(novoMenu) {
  menuEl.querySelectorAll('.menu-item').forEach((i) => i.classList.remove('active'));
  const itemSidebar = menuEl.querySelector(`.menu-item[data-menu="${novoMenu}"]`);
  if (itemSidebar) itemSidebar.classList.add('active');
  // Destaca o cabeçalho "Cadastros" quando Serviços/Profissionais (dentro
  // do submenu) fica ativo — senão nada na sidebar aparece realçado
  // enquanto uma dessas telas está aberta. Itens que vieram do user menu
  // (perfil/empresa/pagamentos/configuracao/ajuda) não têm item correspondente
  // na sidebar, então itemSidebar é null e isso vira um no-op — correto,
  // nenhum item da sidebar deve ficar "active" nessas telas.
  menuCadastrosToggle.classList.toggle('tem-filho-ativo', itemSidebar?.closest('#menu-cadastros-submenu') != null);
  menuAtual = novoMenu;
  subtabsEl.style.display = menuAtual === 'agendamento' ? 'flex' : 'none';
  dataRef = new Date();
  render();
}

function ativarMenuItem(item) {
  selecionarMenu(item.dataset.menu);
}

menuEl.querySelectorAll('.menu-item').forEach((item) => {
  item.addEventListener('click', () => ativarMenuItem(item));
});

// "Cadastros" é um cabeçalho de grupo, não um item de menu com tela própria
// — por isso usa a classe .menu-item-grupo (fora do .menu-item genérico
// acima) e só expande/recolhe o submenu, sem chamar ativarMenuItem.
menuCadastrosToggle.addEventListener('click', () => {
  menuCadastrosSubmenu.classList.toggle('aberto');
  menuCadastrosToggle.classList.toggle('expandido');
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

  resultado.modulos
    .filter((m) => m.key !== 'agenda_inteligente')
    .forEach((m) => {
      const item = document.createElement('div');
      item.className = 'menu-item';
      item.dataset.menu = `modulo:${m.key}`;
      item.textContent = m.nome;
      item.addEventListener('click', () => ativarMenuItem(item));
      menuEl.appendChild(item);
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
    window.location.href = '/login.html';
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
  const { data: dataPrefill, hora: horaPrefill } = prefill || {};
  const hoje = formatarDataISO(new Date());
  abrirModal(
    '<h3>Novo agendamento</h3>',
    `
      <form id="form-novo-agendamento" novalidate>
        <div class="modal-erro" id="novo-ag-erro"></div>

        <label for="novo-ag-nome">Nome do cliente *</label>
        <input type="text" id="novo-ag-nome" data-obrigatorio autocomplete="off">

        <label for="novo-ag-telefone">Telefone *</label>
        <input type="tel" id="novo-ag-telefone" data-obrigatorio placeholder="11999999999" autocomplete="off">

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

  // Ao corrigir um campo, remove o destaque vermelho imediatamente.
  form.querySelectorAll('[data-obrigatorio]').forEach((campo) => {
    const limpar = () => campo.classList.remove('campo-invalido');
    campo.addEventListener('input', limpar);
    campo.addEventListener('change', limpar);
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

  // Popula profissionais (GET /api/profissionais).
  api('/api/profissionais').then((resultado) => {
    const select = document.getElementById('novo-ag-profissional');
    if (!resultado || !resultado.profissionais) {
      select.innerHTML = '<option value="">Erro ao carregar profissionais</option>';
      return;
    }
    select.innerHTML = '<option value="">Selecione...</option>' +
      resultado.profissionais.map((p) => `<option value="${p.id}">${p.nome}</option>`).join('');
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
        origem: 'portal',
      }),
    });

    if (resultado && !resultado.error) {
      fecharModal();
      mostrarToast('Agendamento cadastrado com sucesso.', 'sucesso');
      render();
    } else {
      erroEl.textContent = (resultado && resultado.error) || 'Erro ao salvar agendamento.';
      btn.disabled = false;
      btn.textContent = 'Salvar agendamento';
    }
  });
}

document.getElementById('btn-novo-agendamento').addEventListener('click', () => abrirModalNovoAgendamento());

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
    `<h3>Encaixe — ${ag.profissional}</h3>`,
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
  return `
    <div class="agendamento-item${cancelado ? ' agendamento-cancelado' : ''}" data-id="${ag.id}">
      <div class="agendamento-linha-principal" ${cancelado ? '' : `data-acoes-toggle="${ag.id}"`}>
        <div>
          <div class="agendamento-hora">${formatarHora(ag.data_hora)} — ${ag.servico}</div>
          <div class="agendamento-detalhe">
            ${ag.cliente || ag.cliente_telefone} · ${ag.profissional} · ${ag.duracao_minutos}min
            ${ag.encaixe ? '<span class="badge badge-encaixe">Encaixe</span>' : ''}
            ${cancelado ? '<span class="badge badge-cancelado">Cancelado</span>' : ''}
          </div>
        </div>
        ${cancelado ? '' : '<button class="btn-acoes" aria-label="Ações">⋮</button>'}
      </div>
      ${cancelado ? '' : `
        <div class="menu-acoes" id="menu-acoes-${ag.id}">
          <button data-acao="reagendar" data-id="${ag.id}">Reagendar</button>
          <button data-acao="encaixar" data-id="${ag.id}">Encaixar</button>
          <button data-acao="cancelar" data-id="${ag.id}" class="acao-perigo">Cancelar</button>
        </div>
      `}
    </div>
  `;
}

conteudo.addEventListener('click', (e) => {
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
    if (acaoBtn.dataset.acao === 'cancelar') abrirModalCancelar(ag);
    if (acaoBtn.dataset.acao === 'reagendar') abrirModalReagendar(ag);
    if (acaoBtn.dataset.acao === 'encaixar') abrirModalEncaixe(ag);
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

document.addEventListener('click', (e) => {
  if (!e.target.closest('.agendamento-item')) {
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

// ---------- Financeiro (US18) ----------
// Livro-caixa manual simples — primeira funcionalidade real do módulo
// "financeiro" (só aparece no menu se o tenant tiver o módulo ativo, via
// carregarModulosNoMenu). Sem edição/exclusão de lançamento nesta versão —
// escopo combinado foi só registrar e listar.
let mesFinanceiroRef = new Date();

function renderLancamentoItem(l) {
  const sinal = l.tipo === 'entrada' ? '+' : '−';
  const classeTipo = l.tipo === 'entrada' ? 'financeiro-entrada' : 'financeiro-saida';
  const dataLabel = new Date(l.data + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'America/Sao_Paulo' });
  return `
    <div class="agendamento-item">
      <div class="agendamento-linha-principal">
        <div>
          <div class="agendamento-hora">${l.descricao || (l.tipo === 'entrada' ? 'Entrada' : 'Saída')}</div>
          <div class="agendamento-detalhe">${dataLabel}</div>
        </div>
        <div class="${classeTipo}">${sinal} ${formatarPreco(l.valor)}</div>
      </div>
    </div>
  `;
}

async function renderFinanceiro() {
  conteudo.innerHTML = '<div class="vazio">Carregando...</div>';
  const mesISO = formatarDataISO(mesFinanceiroRef).slice(0, 7);
  const data = await api(`/api/financeiro/lancamentos?mes=${mesISO}`);
  if (!data) return;

  const mesLabel = mesFinanceiroRef.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric', timeZone: 'America/Sao_Paulo' });

  let html = `
    <div class="nav-periodo">
      <button data-nav="-1">← Mês anterior</button>
      <strong>${mesLabel}</strong>
      <button data-nav="1">Próximo mês →</button>
    </div>
    <div class="financeiro-resumo">
      <div class="financeiro-resumo-card">
        <div class="financeiro-resumo-label">Entradas</div>
        <div class="financeiro-entrada">${formatarPreco(data.resumo.entradas)}</div>
      </div>
      <div class="financeiro-resumo-card">
        <div class="financeiro-resumo-label">Saídas</div>
        <div class="financeiro-saida">${formatarPreco(data.resumo.saidas)}</div>
      </div>
      <div class="financeiro-resumo-card">
        <div class="financeiro-resumo-label">Saldo</div>
        <div class="${data.resumo.saldo >= 0 ? 'financeiro-entrada' : 'financeiro-saida'}">${formatarPreco(data.resumo.saldo)}</div>
      </div>
    </div>
    <button class="btn-novo-agendamento" id="btn-novo-lancamento" style="margin-bottom:16px">+ Novo lançamento</button>
  `;

  html += data.lancamentos.length
    ? data.lancamentos.map(renderLancamentoItem).join('')
    : '<div class="vazio">Nenhum lançamento neste mês.</div>';

  conteudo.innerHTML = html;
  conteudo.querySelector('[data-nav="-1"]').addEventListener('click', () => {
    mesFinanceiroRef.setMonth(mesFinanceiroRef.getMonth() - 1);
    renderFinanceiro();
  });
  conteudo.querySelector('[data-nav="1"]').addEventListener('click', () => {
    mesFinanceiroRef.setMonth(mesFinanceiroRef.getMonth() + 1);
    renderFinanceiro();
  });
  document.getElementById('btn-novo-lancamento').addEventListener('click', abrirModalLancamento);
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

const PAGAMENTOS_STATUS_CARD_CLASSE = {
  ativo: 'status-card-ativo',
  inadimplente: 'status-card-pendente',
  suspenso: 'status-card-inativo',
  cancelado: 'status-card-inativo',
  expirado: 'status-card-inativo',
};

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

  let html = '<div class="nav-periodo"><strong>Pagamento</strong></div>';

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
    // "Alterar forma de pagamento" (não há mais assinatura ativa pra alterar)
    // e mostra "Reativar assinatura" no lugar; o collapse "Detalhes" (com
    // "Cancelar assinatura" dentro) só aparece com status 'ativo'/
    // inadimplente/suspenso — quem já cancelou não tem mais assinatura pra
    // alterar/cancelar de novo.
    const cancelado = dados.status === 'cancelado';
    const ativo = dados.status === 'ativo';
    const statusCardClasse = PAGAMENTOS_STATUS_CARD_CLASSE[dados.status] || 'status-card-inativo';
    const dataAlteracaoMeio = dados.meio_pagamento_alterado_em ? formatarDataCurtaISO(dados.meio_pagamento_alterado_em) : '—';

    html += `
      <div class="financeiro-resumo">
        <div class="financeiro-resumo-card financeiro-resumo-card-3linhas">
          <div class="financeiro-resumo-label">Plano Atual</div>
          <div class="financeiro-resumo-linha2">${dados.plano_nome || '—'}</div>
          <div class="financeiro-resumo-linha3">${dados.valor_plano != null ? formatarPreco(dados.valor_plano) : '—'}</div>
        </div>
        <div class="financeiro-resumo-card financeiro-resumo-card-3linhas">
          <div class="financeiro-resumo-label">Meio de pagamento</div>
          <div class="financeiro-resumo-linha2">${meioLabel}</div>
          <div class="financeiro-resumo-linha3">${dados.meio_pagamento ? `Alterado em ${dataAlteracaoMeio}` : '—'}</div>
        </div>
        <div class="financeiro-resumo-card financeiro-resumo-card-3linhas ${statusCardClasse}">
          <div class="financeiro-resumo-label">Status</div>
          <div class="financeiro-resumo-linha2">${PAGAMENTOS_STATUS_LABEL[dados.status] || dados.status}</div>
        </div>
      </div>
      ${cancelado
        ? `<p class="modal-texto">Seu acesso está ativo até ${formatarDataCurtaISO(dados.acesso_ate)}. Após essa data, o sistema será suspenso.</p>`
        : `<p class="modal-texto">
            Próxima cobrança: ${dados.proxima_cobranca ? `${formatarPreco(dados.proxima_cobranca.valor)} em ${formatarDataCurtaISO(dados.proxima_cobranca.data)}` : 'não disponível'}
          </p>`}
      ${cancelado
        ? '<button class="btn-novo-agendamento" id="btn-reativar-pagamento" style="margin-bottom:16px">Reativar assinatura</button>'
        : `
          <div class="pagamento-detalhes">
            <button type="button" class="pagamento-detalhes-toggle" id="btn-toggle-detalhes" aria-expanded="false">Detalhes ▾</button>
            <div class="pagamento-detalhes-conteudo" id="pagamento-detalhes-conteudo" hidden>
              <h4>Alterar forma de pagamento</h4>
              ${htmlFormPagamento(dados, { comBotaoCancelar: false })}
              ${ativo ? '<button type="button" class="btn-secundario acao-perigo" id="btn-cancelar-assinatura" style="margin-top:12px">Cancelar assinatura</button>' : ''}
            </div>
          </div>
        `}
      <h4 class="pagamento-historico-titulo">Histórico pagamentos</h4>
      <div class="tabela-wrapper">
        <table class="tabela-tenants">
          <thead><tr><th>Data</th><th>Valor</th><th>Status</th><th>Meio de pagamento</th></tr></thead>
          <tbody>
            ${dados.historico.length
              ? dados.historico.map((h) => `<tr><td>${formatarDataCurtaISO(h.data)}</td><td>${formatarPreco(h.valor)}</td><td>${renderHistoricoStatus(h.status)}</td><td>${formatarMeioHistorico(h.meio)}</td></tr>`).join('')
              : '<tr><td colspan="4">Nenhuma cobrança registrada ainda.</td></tr>'}
          </tbody>
        </table>
      </div>
    `;
  }

  conteudo.innerHTML = html;
  const btnCadastrar = document.getElementById('btn-cadastrar-pagamento');
  if (btnCadastrar) btnCadastrar.addEventListener('click', () => abrirModalPagamento(dados));
  const btnReativar = document.getElementById('btn-reativar-pagamento');
  if (btnReativar) btnReativar.addEventListener('click', () => abrirModalPagamento(dados));

  // Collapse "Detalhes" (US35 redesign) — substitui o antigo botão "Alterar
  // forma de pagamento" pra assinatura já ativa: o próprio formulário
  // (htmlFormPagamento) já foi renderizado (oculto) dentro do conteúdo
  // acima, só falta ligar o toggle e o wiring do formulário/cancelamento.
  const btnToggleDetalhes = document.getElementById('btn-toggle-detalhes');
  if (btnToggleDetalhes) {
    btnToggleDetalhes.addEventListener('click', () => {
      const painel = document.getElementById('pagamento-detalhes-conteudo');
      const vaiAbrir = painel.hidden;
      painel.hidden = !vaiAbrir;
      btnToggleDetalhes.setAttribute('aria-expanded', String(vaiAbrir));
    });
    wireFormPagamento(dados, { onSucesso: () => renderPagamentos() });
    const btnCancelarAssinatura = document.getElementById('btn-cancelar-assinatura');
    if (btnCancelarAssinatura) btnCancelarAssinatura.addEventListener('click', () => abrirModalCancelarAssinatura(dados));
  }
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
  conteudo.classList.toggle('conteudo-largo', menuAtual === 'inicio' || menuAtual === 'agendamento');

  if (menuAtual === 'inicio') return renderInicio();
  if (menuAtual === 'configuracao') return renderConfiguracao();
  if (menuAtual === 'perfil') return renderPerfil();
  if (menuAtual === 'empresa') return renderMinhaEmpresa();
  if (menuAtual === 'whatsapp') return renderWhatsapp();
  // "Ajuda" (user menu, PR11) reaproveita o mesmo placeholder "em breve" já
  // usado pros módulos ainda não desenvolvidos.
  if (menuAtual === 'ajuda') return renderModuloEmBreve();
  if (menuAtual === 'pagamentos') return renderPagamentos();
  if (menuAtual === 'servicos') return renderServicos();
  if (menuAtual === 'profissionais') return renderProfissionais();
  if (menuAtual === 'bloqueios') return renderBloqueios();
  if (menuAtual === 'modulo:financeiro') return renderFinanceiro();
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
        ${nomeProfissionalPreferencial ? `<div class="agendamento-detalhe">Profissional preferencial: ${nomeProfissionalPreferencial}</div>` : ''}
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
        <label for="servico-profissional-preferencial">Profissional preferencial (opcional)</label>
        <select id="servico-profissional-preferencial"><option value="">Carregando profissionais...</option></select>
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
      <strong>Bloqueios</strong>
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
  abrirModal(
    '<h3>Novo bloqueio</h3>',
    `
      <form id="form-bloqueio">
        <div class="modal-erro" id="bloqueio-erro"></div>
        <label for="bloqueio-data-inicio">Data de início *</label>
        <input type="date" id="bloqueio-data-inicio" data-obrigatorio min="${hoje}" value="${hoje}">
        <label for="bloqueio-hora-inicio">Hora de início *</label>
        <input type="time" id="bloqueio-hora-inicio" data-obrigatorio>
        <label for="bloqueio-data-fim">Data de fim *</label>
        <input type="date" id="bloqueio-data-fim" data-obrigatorio min="${hoje}" value="${hoje}">
        <label for="bloqueio-hora-fim">Hora de fim *</label>
        <input type="time" id="bloqueio-hora-fim" data-obrigatorio>
        <label for="bloqueio-profissional">Profissional (opcional)</label>
        <select id="bloqueio-profissional"><option value="">Toda a agenda</option></select>
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

  api('/api/profissionais').then((resultado) => {
    const select = document.getElementById('bloqueio-profissional');
    if (!resultado || !resultado.profissionais) return;
    select.innerHTML = '<option value="">Toda a agenda</option>' +
      resultado.profissionais.map((p) => `<option value="${p.id}">${p.nome}</option>`).join('');
  });

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
    const inicioISO = new Date(`${document.getElementById('bloqueio-data-inicio').value}T${document.getElementById('bloqueio-hora-inicio').value}:00-03:00`).toISOString();
    const fimISO = new Date(`${document.getElementById('bloqueio-data-fim').value}T${document.getElementById('bloqueio-hora-fim').value}:00-03:00`).toISOString();

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

// Card de um agendamento dentro de uma linha da grade de horários (Dia e,
// no PR3, Semana) — mesmo conteúdo/ações de renderAgendamentoItem (kebab
// com Reagendar/Encaixar/Cancelar), só que compacto o bastante pra caber
// dividido em sub-colunas quando há mais de um profissional no mesmo
// horário (CA da grade: "dividir a coluna ou dois componentes").
function renderAgendamentoGradeCard(ag) {
  const cancelado = ag.status === 'cancelado';
  return `
    <div class="grade-ag-card${cancelado ? ' agendamento-cancelado' : ''}" data-id="${ag.id}">
      <div class="grade-ag-linha-principal" ${cancelado ? '' : `data-acoes-toggle="${ag.id}"`}>
        <div>
          <div class="grade-ag-servico">${ag.servico}</div>
          <div class="grade-ag-cliente">${ag.cliente || ag.cliente_telefone}</div>
          <div class="grade-ag-meta">
            ${formatarHora(ag.data_hora)} · ${ag.duracao_minutos}min · ${formatarPreco(ag.preco)} · ${ag.profissional}
            ${ag.encaixe ? '<span class="badge badge-encaixe">Encaixe</span>' : ''}
            ${cancelado ? '<span class="badge badge-cancelado">Cancelado</span>' : ''}
          </div>
        </div>
        ${cancelado ? '' : '<button class="btn-acoes" aria-label="Ações">⋮</button>'}
      </div>
      ${cancelado ? '' : `
        <div class="menu-acoes" id="menu-acoes-${ag.id}">
          <button data-acao="reagendar" data-id="${ag.id}">Reagendar</button>
          <button data-acao="encaixar" data-id="${ag.id}">Encaixar</button>
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

  return `
    <div class="grade-horarios">
      ${horarios
        .map((hora) => {
          const agsDoHorario = porHorario[hora] || [];
          const conteudoLinha = agsDoHorario.length
            ? `<div class="grade-ag-grupo" style="grid-template-columns:repeat(${agsDoHorario.length},1fr)">${agsDoHorario.map(renderAgendamentoGradeCard).join('')}</div>`
            : '<div class="grade-linha-vazia">Disponível</div>';
          return `
            <div class="grade-linha">
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

// ---------- Início (dashboard) ----------
// Reaproveita GET /api/agendamentos?view=dia (mesmo endpoint da aba Dia) e
// renderAgendamentoItem (mesmo card com o menu de ações Reagendar/Encaixar/
// Cancelar já ligado via delegação em `conteudo`) — não precisa de endpoint
// nem de componente novo, só filtra pros agendamentos que ainda vão
// acontecer hoje.
async function renderInicio() {
  conteudo.innerHTML = '<div class="vazio">Carregando...</div>';
  const iso = formatarDataISO(new Date());
  const data = await api(`/api/agendamentos?view=dia&data=${iso}`);
  if (!data) return;

  const agora = Date.now();
  const proximos = data.agendamentos.filter((ag) => ag.status !== 'cancelado' && new Date(ag.data_hora).getTime() >= agora);
  agendamentosAtuais = proximos;

  conteudo.innerHTML = `
    <div class="inicio-cabecalho">
      <h2>Próximos agendamentos de hoje</h2>
      <button class="btn-novo-agendamento" id="btn-inicio-novo-agendamento">+ Novo agendamento</button>
    </div>
    ${proximos.length
      ? proximos.map(renderAgendamentoItem).join('')
      : '<div class="vazio">Nenhum agendamento para o restante de hoje.</div>'}
  `;
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
    html += `<div class="semana-colunas" style="grid-template-columns:repeat(${diasAbertos.length},1fr)">`;
    for (const d of diasAbertos) {
      const diaISO = formatarDataISO(d);
      const dataLabel = d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'America/Sao_Paulo' });
      html += `
        <div class="semana-coluna">
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
      <div class="dia-cel${fechado ? ' dia-cel-fechado' : ''}">
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
      renderPerfil();
    } else {
      mostrarToast((resultado && resultado.error) || 'Erro ao salvar. Tente novamente.', 'erro');
      btn.disabled = false;
      btn.textContent = 'Salvar alterações';
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
      FB.init({ appId, cookie: true, xfbml: false, version: 'v22.0' });
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

carregarConfiguracao().then(render);
carregarModulosNoMenu();
carregarUserMenu();
