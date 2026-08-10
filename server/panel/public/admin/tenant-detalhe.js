// Página de detalhe do tenant da área admin da Kyvvo (US28) — consome
// GET /api/tenants/:id (dados consolidados). Chegou aqui a partir de
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
    window.location.href = '/login.html';
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

// Duplicado intencionalmente do app.js do painel admin (mesmo raciocínio de
// isolamento entre as telas admin — ver comentário no topo do arquivo).
// US85 — a ação de troca de modo (antes na listagem) mudou pra cá.
const MODO_ATENDIMENTO = {
  bot: { label: '🤖 Bot', classe: 'badge-modo-bot' },
  ia: { label: '✨ IA', classe: 'badge-modo-ia' },
};

// ---------- Modal genérico + toast ----------
// Duplicado intencionalmente do app.js do painel admin (mesmo raciocínio de
// isolamento entre as telas admin — ver comentário no topo do arquivo).
function escFecharModal(e) {
  if (e.key === 'Escape') fecharModal();
}

function fecharModal() {
  const overlay = document.getElementById('modal-overlay');
  if (overlay) overlay.remove();
  document.removeEventListener('keydown', escFecharModal);
}

function abrirModal(tituloHtml, conteudoHtml) {
  fecharModal();
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-card">
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

// Duplicado intencionalmente do app.js do painel admin (mesmo raciocínio de
// isolamento entre as telas admin — ver comentário no topo do arquivo).
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

// CA (US39.1) — pedido de "Novo número" ainda não atendido: o tenant já
// confirmou que quer um número fornecido pela Kyvvo (POST
// /api/whatsapp/solicitar-numero-novo) e ainda não tem meta_phone_number_id
// (i.e., nenhum número foi vinculado ainda via /whatsapp.html — ver
// migration 037/US39.2). Só aparece enquanto o pedido está pendente.
function renderSecaoNumeroNovo(t) {
  if (!t.novo_numero_solicitado_em || t.meta_phone_number_id) return '';
  return `
    <section class="secao-detalhe">
      <h3>Pedido de número novo</h3>
      <p><strong>Solicitado em:</strong> ${formatarDataHora(t.novo_numero_solicitado_em)}</p>
      <p><strong>DDD de preferência:</strong> ${t.novo_numero_ddd_preferencia ? escapeHtml(t.novo_numero_ddd_preferencia) : 'Sem preferência'}</p>
      <p class="vazio-inline">Vincule um número em <a class="topbar-nav-link" href="/whatsapp.html">Admin → WhatsApp → Números prontos</a> quando houver um disponível.</p>
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

// US85/CA03 — a ação "Alterar modo de atendimento" (antes na listagem, US69)
// mudou pra cá, perto do histórico completo do tenant. Igual já acontecia na
// listagem, tenant inativo só mostra o badge, sem botão de alterar.
function renderSecaoModoAtendimento(t) {
  const modo = MODO_ATENDIMENTO[t.tecnologia] || MODO_ATENDIMENTO.bot;
  return `
    <section class="secao-detalhe">
      <h3>Modo de atendimento</h3>
      <p>
        <strong>Modo atual:</strong> <span class="badge ${modo.classe}">${modo.label}</span>
        ${t.ativo ? '<button type="button" class="btn-acao-tabela" data-testid="btn-alterar-modo-detalhe">Alterar</button>' : ''}
      </p>
    </section>
  `;
}

function renderLinhaHistoricoModo(h) {
  const anterior = MODO_ATENDIMENTO[h.valor_anterior] || MODO_ATENDIMENTO.bot;
  const novo = MODO_ATENDIMENTO[h.valor_novo] || MODO_ATENDIMENTO.bot;
  return `
    <tr>
      <td>${anterior.label} → ${novo.label}</td>
      <td>${escapeHtml(h.alterado_por_nome || '—')}</td>
      <td>${formatarDataHora(h.alterado_em)}</td>
    </tr>
  `;
}

// US85/CA04 — histórico de trocas de modo, mesmo padrão visual do histórico
// de módulos (US65/CA05), consumindo GET .../modo/historico.
function renderSecaoHistoricoModo(historico) {
  return `
    <section class="secao-detalhe">
      <h3>Histórico de modo de atendimento</h3>
      <div class="tabela-wrapper">
        <table class="tabela-tenants" data-testid="historico-modo">
          <thead><tr><th>Alteração</th><th>Alterado por</th><th>Data</th></tr></thead>
          <tbody>${
            historico.length
              ? historico.map(renderLinhaHistoricoModo).join('')
              : '<tr><td colspan="3">Nenhuma alteração registrada ainda.</td></tr>'
          }</tbody>
        </table>
      </div>
    </section>
  `;
}

// US65 — cada módulo do catálogo aparece com seu estado (ativo/inativo) e um
// toggle pra alterar. Módulo obrigatório (CA04) vem sempre ativo, com o
// toggle desabilitado e uma explicação no title.
function renderLinhaModulo(m) {
  const bloqueado = Boolean(m.obrigatorio);
  return `
    <tr data-modulo="${escapeHtml(m.key)}">
      <td>
        ${escapeHtml(m.nome)}
        ${bloqueado ? '<span class="badge-obrigatorio" title="Módulo obrigatório: não pode ser desativado">obrigatório</span>' : ''}
      </td>
      <td>
        <label class="toggle-switch" title="${bloqueado ? 'Módulo obrigatório não pode ser desativado' : ''}">
          <input
            type="checkbox"
            class="toggle-modulo"
            data-modulo-key="${escapeHtml(m.key)}"
            ${m.ativo ? 'checked' : ''}
            ${bloqueado ? 'disabled' : ''}
          >
          <span class="toggle-switch-trilho"></span>
        </label>
      </td>
    </tr>
  `;
}

function renderSecaoModulos(t) {
  const modulos = t.modulos || [];
  return `
    <section class="secao-detalhe">
      <h3>Módulos</h3>
      ${
        modulos.length
          ? `
        <div class="tabela-wrapper">
          <table class="tabela-tenants">
            <thead><tr><th>Módulo</th><th>Ativo</th></tr></thead>
            <tbody>${modulos.map(renderLinhaModulo).join('')}</tbody>
          </table>
        </div>
      `
          : '<span class="vazio-inline">Nenhum módulo disponível</span>'
      }
    </section>
  `;
}

function renderLinhaHistoricoModulo(h) {
  return `
    <tr>
      <td>${escapeHtml(h.modulo_nome)}</td>
      <td>${h.acao === 'ativado' ? 'Ativado' : 'Desativado'}</td>
      <td>${escapeHtml(h.alterado_por_nome || '—')}</td>
      <td>${formatarDataHora(h.alterado_em)}</td>
    </tr>
  `;
}

function renderSecaoHistoricoModulos(historico) {
  return `
    <section class="secao-detalhe">
      <h3>Histórico de alterações de módulos</h3>
      <div class="tabela-wrapper">
        <table class="tabela-tenants">
          <thead><tr><th>Módulo</th><th>Ação</th><th>Alterado por</th><th>Data</th></tr></thead>
          <tbody>${
            historico.length
              ? historico.map(renderLinhaHistoricoModulo).join('')
              : '<tr><td colspan="4">Nenhuma alteração registrada ainda.</td></tr>'
          }</tbody>
        </table>
      </div>
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

// Estado da tela mantido em memória pra poder re-renderizar só as seções de
// módulos/histórico depois de um toggle, sem refazer o GET completo do
// tenant (que não muda com a alteração de módulo).
let tenantAtual = null;
let idTenantAtual = null;

async function carregarHistoricoModulos(id) {
  const resultado = await api(`/api/tenants/${encodeURIComponent(id)}/modulos/historico`).catch(() => null);
  return (resultado && resultado.historico) || [];
}

async function carregarHistoricoModo(id) {
  const resultado = await api(`/api/tenants/${encodeURIComponent(id)}/modo/historico`).catch(() => null);
  return (resultado && resultado.historico) || [];
}

function renderPagina(data, historicoModulos, historicoModo) {
  conteudo.innerHTML = `
    <a class="topbar-nav-link" href="/painel.html">← Voltar para lista</a>
    <h2 class="titulo-detalhe">${escapeHtml(data.nome)}</h2>
    ${renderSecaoNegocio(data)}
    ${renderSecaoNumeroNovo(data)}
    ${renderSecaoResponsavel(data)}
    ${renderSecaoStatus(data)}
    ${renderSecaoModoAtendimento(data)}
    ${renderSecaoHistoricoModo(historicoModo)}
    ${renderSecaoModulos(data)}
    ${renderSecaoHistoricoModulos(historicoModulos)}
    ${renderSecaoAtividade(data)}
  `;
  wireEventosModulos();
  wireEventosModoAtendimento();
}

// US65 — alterna um módulo pro tenant da tela atual. Em caso de sucesso,
// atualiza só os módulos (resposta do PATCH já vem com o catálogo
// atualizado) e recarrega o histórico, sem refazer o GET completo do
// tenant. Em caso de erro (ex.: módulo obrigatório), reverte o toggle
// visualmente.
async function alterarModulo(moduloKey, ativo, checkbox) {
  checkbox.disabled = true;
  const resultado = await api(`/api/tenants/${encodeURIComponent(idTenantAtual)}/modulos/${encodeURIComponent(moduloKey)}`, {
    method: 'PATCH',
    body: JSON.stringify({ ativo }),
  });
  checkbox.disabled = false;
  if (!resultado) return;

  if (resultado.error) {
    checkbox.checked = !ativo;
    mostrarToast(resultado.error, 'erro');
    return;
  }

  mostrarToast(`Módulo ${ativo ? 'ativado' : 'desativado'} com sucesso.`, 'sucesso');
  tenantAtual.modulos = resultado.modulos;
  const [historicoModulos, historicoModo] = await Promise.all([
    carregarHistoricoModulos(idTenantAtual),
    carregarHistoricoModo(idTenantAtual),
  ]);
  renderPagina(tenantAtual, historicoModulos, historicoModo);
}

function wireEventosModulos() {
  conteudo.querySelectorAll('.toggle-modulo').forEach((checkbox) => {
    checkbox.addEventListener('change', () => {
      alterarModulo(checkbox.dataset.moduloKey, checkbox.checked, checkbox);
    });
  });
}

// ---------- Troca de modo de atendimento (US69/CA02, movida pra cá na US85/CA03) ----------
// Só quem faz essa troca é o admin Kyvvo: o modo está vinculado ao plano
// contratado, então liberar edição pro salão quebraria a lógica de
// cobrança (US69/Contexto). O dono do salão só visualiza (CA06, portal).
async function abrirModalTrocaModo(tenant) {
  const destino = tenant.tecnologia === 'ia' ? 'bot' : 'ia';
  const modoAtual = MODO_ATENDIMENTO[tenant.tecnologia] || MODO_ATENDIMENTO.bot;
  const modoDestino = MODO_ATENDIMENTO[destino];

  const avisoConversas = destino === 'bot'
    ? '<div class="modal-erro" style="display:block">⚠️ Conversas em andamento serão encerradas.</div>'
    : '';

  abrirModal(
    `<h3>Alterar modo de atendimento</h3>`,
    `
      <div class="modal-texto">
        <strong>${escapeHtml(tenant.nome)}</strong><br>
        Modo atual: <span class="badge ${modoAtual.classe}">${modoAtual.label}</span><br>
        Novo modo: <span class="badge ${modoDestino.classe}">${modoDestino.label}</span>
      </div>
      <div class="modal-texto">A próxima mensagem recebida no WhatsApp deste salão já usará o novo modo.</div>
      ${avisoConversas}
      <div class="modal-erro" id="modo-erro"></div>
      <div class="modal-acoes">
        <button type="button" class="btn-secundario" id="btn-cancelar-modo">Cancelar</button>
        <button type="button" class="btn-primario" id="btn-confirmar-modo">Confirmar troca</button>
      </div>
    `
  );

  document.getElementById('btn-cancelar-modo').addEventListener('click', fecharModal);
  document.getElementById('btn-confirmar-modo').addEventListener('click', async () => {
    const btn = document.getElementById('btn-confirmar-modo');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>';

    const resultado = await api(`/api/tenants/${tenant.id}/modo`, {
      method: 'PATCH',
      body: JSON.stringify({ tecnologia: destino }),
    });

    if (resultado && !resultado.error) {
      fecharModal();
      mostrarToast(`Modo de atendimento alterado para ${modoDestino.label}.`, 'sucesso');
      tenantAtual.tecnologia = resultado.tecnologia;
      const [historicoModulos, historicoModo] = await Promise.all([
        carregarHistoricoModulos(idTenantAtual),
        carregarHistoricoModo(idTenantAtual),
      ]);
      renderPagina(tenantAtual, historicoModulos, historicoModo);
    } else {
      document.getElementById('modo-erro').textContent = (resultado && resultado.error) || 'Erro ao alterar modo de atendimento.';
      btn.disabled = false;
      btn.textContent = 'Confirmar troca';
    }
  });
}

function wireEventosModoAtendimento() {
  const btnAlterar = conteudo.querySelector('[data-testid="btn-alterar-modo-detalhe"]');
  if (btnAlterar) {
    btnAlterar.addEventListener('click', () => abrirModalTrocaModo(tenantAtual));
  }
}

async function renderDetalhe() {
  conteudo.innerHTML = '<div class="vazio">Carregando...</div>';

  const id = idDaUrl();
  idTenantAtual = id;
  const [data, historicoModulos, historicoModo] = await Promise.all([
    api(`/api/tenants/${encodeURIComponent(id)}`),
    carregarHistoricoModulos(id),
    carregarHistoricoModo(id),
  ]);
  if (!data) return;

  if (data.error) {
    conteudo.innerHTML = `
      <a class="topbar-nav-link" href="/painel.html">← Voltar para lista</a>
      <div class="vazio">${escapeHtml(data.error)}</div>
    `;
    return;
  }

  tenantAtual = data;
  renderPagina(data, historicoModulos, historicoModo);
}

renderDetalhe();
