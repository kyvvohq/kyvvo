// Página de detalhe do tenant da área admin da Kyvvo (US28) — consome
// GET /admin/api/tenants/:id (dados consolidados). Chegou aqui a partir de
// um clique na linha/"Ver detalhes" da listagem (US26/US27).

// token / identificação do admin / dropdown "Sair" agora vivem em shell.js
// (US53), carregado antes deste script em todas as páginas admin.

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
    localStorage.removeItem('kyvvo_admin_token');
    window.location.href = '/admin/login.html';
    return null;
  }
  return res.json();
}

const conteudo = document.getElementById('conteudo');

// Duplicado intencionalmente do app.js do painel admin (mesmo raciocínio de
// isolamento entre as telas admin — ver comentário em admin/app.js).
const SEGMENTOS_ADMIN = {
  salao_beleza: 'Salão de beleza',
  petshop: 'Pet Shop',
  psicologia: 'Psicólogo(a)',
  fisioterapia: 'Fisioterapia',
  pilates: 'Pilates',
  outro: 'Outro',
};

const STATUS_CLASSES = {
  'Trial ativo': 'badge-trial-ativo',
  'Trial expirado': 'badge-trial-expirado',
  'Não ativado': 'badge-status-nao-ativado',
  Ativo: 'badge-status-ativo',
  Inativo: 'badge-status-inativo',
  Suspenso: 'badge-status-suspenso',
};

function escapeHtml(valor) {
  return String(valor ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[c]));
}

// WhatsApp é guardado só com dígitos (DDD + número, sem DDI) — mesmo
// formatador da listagem (US26/CA02).
function formatarWhatsapp(digitos) {
  if (!digitos) return '—';
  const d = String(digitos).replace(/\D/g, '');
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return digitos;
}

// CA03/CA06 pedem data + hora (a listagem, em US26, só mostra a data).
function formatarDataHora(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  const data = d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const hora = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  return `${data} ${hora}`;
}

function idDaUrl() {
  const partes = window.location.pathname.split('/').filter(Boolean);
  return decodeURIComponent(partes[partes.length - 1]);
}

function renderSecaoNegocio(t) {
  return `
    <section class="secao-detalhe">
      <h3>Dados do negócio</h3>
      <p><strong>Nome da empresa:</strong> ${escapeHtml(t.nome)}</p>
      <p><strong>Segmento:</strong> ${t.segmento ? escapeHtml(SEGMENTOS_ADMIN[t.segmento] || t.segmento) : '—'}</p>
      <p><strong>WhatsApp:</strong> ${
        t.whatsapp
          ? `<a href="https://wa.me/55${String(t.whatsapp).replace(/\D/g, '')}" target="_blank" rel="noopener">${formatarWhatsapp(t.whatsapp)}</a>`
          : '—'
      }</p>
    </section>
  `;
}

function renderSecaoResponsavel(t) {
  const email = t.responsavel ? escapeHtml(t.responsavel.email) : null;
  return `
    <section class="secao-detalhe">
      <h3>Dados do responsável</h3>
      <p><strong>Nome:</strong> ${t.responsavel ? escapeHtml(t.responsavel.nome) : '—'}</p>
      <p><strong>E-mail:</strong> ${email ? `<a href="mailto:${email}">${email}</a>` : '—'}</p>
      <p><strong>Data de cadastro:</strong> ${formatarDataHora(t.cadastrado_em)}</p>
      <p><strong>Data de ativação:</strong> ${t.ativado_em ? formatarDataHora(t.ativado_em) : 'Não ativado'}</p>
    </section>
  `;
}

// Indicador de trial somente leitura (US31/CA01-CA04) — toggle + badge, sem
// nenhum handler de clique/edição. Todo o cálculo (trial_ativo/trial_inicio/
// trial_fim/trial_dias_restantes) vem pronto do backend (CA05).
function renderIndicadorTrial(t) {
  const ativado = Boolean(t.trial_inicio);
  const classeToggle = t.trial_ativo ? 'toggle-on' : 'toggle-off';
  const rotulo = !ativado ? 'Não ativado' : t.trial_ativo ? 'Trial ativo' : 'Trial expirado';
  const classeBadge = !ativado ? 'badge-status-nao-ativado' : t.trial_ativo ? 'badge-trial-ativo' : 'badge-trial-expirado';
  const diasHtml = ativado
    ? `<p><strong>Dias restantes:</strong> ${
        t.trial_ativo ? t.trial_dias_restantes : `Expirado há ${Math.abs(t.trial_dias_restantes)} dias`
      }</p>`
    : '';
  return `
    <p>
      <strong>Trial:</strong>
      <span class="toggle-readonly ${classeToggle}" aria-hidden="true"></span>
      <span class="badge badge-trial-indicador ${classeBadge}">${escapeHtml(rotulo)}</span>
    </p>
    ${ativado ? `<p><strong>Início do trial:</strong> ${formatarDataHora(t.trial_inicio)}</p>` : ''}
    ${ativado ? `<p><strong>Término do trial:</strong> ${formatarDataHora(t.trial_fim)}</p>` : ''}
    ${diasHtml}
  `;
}

function renderSecaoStatus(t) {
  const statusClasse = STATUS_CLASSES[t.status_conta] || 'badge-status-inativo';
  return `
    <section class="secao-detalhe">
      <h3>Status da conta</h3>
      <p><strong>Status atual:</strong> <span class="badge badge-status ${statusClasse}">${escapeHtml(t.status_conta)}</span></p>
      ${renderIndicadorTrial(t)}
      <p><strong>Plano atual:</strong> ${escapeHtml(t.plano_atual)}</p>
    </section>
  `;
}

function renderSecaoModulos(t) {
  const chips = t.modulos_ativos.length
    ? t.modulos_ativos.map((m) => `<span class="chip-modulo">${escapeHtml(m.nome)}</span>`).join('')
    : '<span class="vazio-inline">Nenhum módulo ativo</span>';
  return `
    <section class="secao-detalhe">
      <h3>Módulos ativos</h3>
      <div class="chips-modulos">${chips}</div>
    </section>
  `;
}

function renderSecaoAtividade(t) {
  const c = t.contagens || {};
  return `
    <section class="secao-detalhe">
      <h3>Atividade recente</h3>
      <p><strong>Total de agendamentos:</strong> ${c.total_agendamentos ?? 0}</p>
      <p><strong>Último agendamento:</strong> ${c.ultimo_agendamento ? formatarDataHora(c.ultimo_agendamento) : '—'}</p>
      <p><strong>Total de clientes cadastrados:</strong> ${c.total_clientes ?? 0}</p>
    </section>
  `;
}

async function renderDetalhe() {
  conteudo.innerHTML = '<div class="vazio">Carregando...</div>';

  const id = idDaUrl();
  const data = await api(`/admin/api/tenants/${encodeURIComponent(id)}`);
  if (!data) return;

  if (data.error) {
    conteudo.innerHTML = `
      <a class="topbar-nav-link" href="/admin/painel.html">← Voltar para lista</a>
      <div class="vazio">${escapeHtml(data.error)}</div>
    `;
    return;
  }

  conteudo.innerHTML = `
    <a class="topbar-nav-link" href="/admin/painel.html">← Voltar para lista</a>
    <h2 class="titulo-detalhe">${escapeHtml(data.nome)}</h2>
    ${renderSecaoNegocio(data)}
    ${renderSecaoResponsavel(data)}
    ${renderSecaoStatus(data)}
    ${renderSecaoModulos(data)}
    ${renderSecaoAtividade(data)}
  `;
}

renderDetalhe();
