// Área admin — Usuários: lista todo mundo com login (uma linha por conta —
// um tenant pode ter mais de uma, dono + equipe convidada), mostrando
// tenant/plano/módulos de cada um. "Editar módulos" abre um modal que
// reaproveita GET/PATCH /admin/api/tenants/:id/... (módulo é permissão do
// TENANT, não da conta individual, então a edição sempre mira o tenant do
// usuário, não o usuário em si — ver routes/admin-usuarios.js).

// token / identificação do admin / dropdown "Sair" vivem em shell.js (US53),
// carregado antes deste script.

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
function escapeHtml(valor) {
  return String(valor ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[c]));
}

// ---------- Modal genérico + toast (mesma implementação de admin/app.js) ----------
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

function formatarDataHora(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${d.toLocaleDateString('pt-BR')} às ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
}

const ROLE_LABEL = { administrador: 'Administrador', operador: 'Operador' };

let estado = { search: '' };
let usuarios = [];
let timeoutBusca = null;

async function carregar() {
  const params = new URLSearchParams();
  if (estado.search) params.set('search', estado.search);
  const dados = await api(`/api/usuarios?${params.toString()}`);
  if (!dados) return;
  usuarios = dados.usuarios;
  render();
}

function renderLinha(u) {
  return `
    <tr>
      <td>${escapeHtml(u.nome || '—')}</td>
      <td>${escapeHtml(u.email)}</td>
      <td>${escapeHtml(ROLE_LABEL[u.role] || u.role)}</td>
      <td><span class="badge ${u.ativo ? 'badge-status-ativo' : 'badge-status-inativo'}">${u.ativo ? 'Ativo' : 'Desativado'}</span></td>
      <td>${escapeHtml(u.tenant_nome)}</td>
      <td>${escapeHtml(u.plano_nome)}</td>
      <td>${u.total_modulos_ativos} módulo${u.total_modulos_ativos === 1 ? '' : 's'} ativo${u.total_modulos_ativos === 1 ? '' : 's'}</td>
      <td>${formatarDataHora(u.criado_em)}</td>
      <td><button type="button" class="btn-secundario" data-editar-modulos="${escapeHtml(u.tenant_id)}" data-tenant-nome="${escapeHtml(u.tenant_nome)}">Editar módulos</button></td>
    </tr>
  `;
}

function render() {
  // Só refoca a busca se era ela quem tinha o foco antes de re-renderizar
  // (digitação com debounce) — render() também é chamado depois de um
  // toggle de módulo dentro do modal, e nesse caso o foco deve continuar lá,
  // não pular pra busca no fundo da tela.
  const buscaTinhaFoco = document.activeElement && document.activeElement.id === 'busca-usuarios';
  conteudo.innerHTML = `
    <h2 class="titulo-detalhe">Usuários</h2>
    <p class="vazio-inline">Todas as contas de login cadastradas na plataforma — um tenant pode ter mais de uma (dono + equipe convidada). Módulos são uma permissão do tenant: editar aqui altera pra todo mundo daquele tenant, não só pra esta conta.</p>
    <div class="clientes-filtros">
      <input type="search" id="busca-usuarios" placeholder="Buscar por nome, e-mail ou tenant..." value="${escapeHtml(estado.search)}">
    </div>
    <div class="tabela-wrapper">
      <table class="tabela-tenants">
        <thead>
          <tr>
            <th>Nome</th><th>E-mail</th><th>Papel</th><th>Status</th><th>Tenant</th><th>Plano</th><th>Módulos</th><th>Cadastrado em</th><th></th>
          </tr>
        </thead>
        <tbody>
          ${usuarios.length ? usuarios.map(renderLinha).join('') : '<tr><td colspan="9">Nenhum usuário encontrado.</td></tr>'}
        </tbody>
      </table>
    </div>
  `;

  const inputBusca = document.getElementById('busca-usuarios');
  inputBusca.addEventListener('input', (e) => {
    estado.search = e.target.value;
    clearTimeout(timeoutBusca);
    timeoutBusca = setTimeout(carregar, 350);
  });
  if (buscaTinhaFoco) {
    // Cursor no fim do campo depois de re-renderizar (senão volta pro início
    // a cada tecla, já que o innerHTML inteiro é reconstruído a cada busca).
    inputBusca.focus();
    inputBusca.setSelectionRange(inputBusca.value.length, inputBusca.value.length);
  }

  conteudo.querySelectorAll('[data-editar-modulos]').forEach((btn) => {
    btn.addEventListener('click', () => abrirModalModulos(btn.dataset.editarModulos, btn.dataset.tenantNome));
  });
}

// ---------- Modal de edição de módulos (mesmo padrão de tenant-detalhe.js, aqui só o pedaço de módulos) ----------
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

let tenantIdModal = null;
let tenantNomeModal = '';

async function abrirModalModulos(tenantId, tenantNome) {
  tenantIdModal = tenantId;
  tenantNomeModal = tenantNome;
  abrirModal(`<h3>Módulos — ${escapeHtml(tenantNome)}</h3>`, '<div class="vazio">Carregando...</div>');
  const tenant = await api(`/api/tenants/${encodeURIComponent(tenantId)}`);
  if (!tenant) return;
  renderModulosModal(tenant.modulos || []);
}

function renderModulosModal(modulos) {
  abrirModal(
    `<h3>Módulos — ${escapeHtml(tenantNomeModal)}</h3>`,
    `<div class="tabela-wrapper">
      <table class="tabela-tenants">
        <thead><tr><th>Módulo</th><th>Ativo</th></tr></thead>
        <tbody>${modulos.length ? modulos.map(renderLinhaModulo).join('') : '<tr><td colspan="2">Nenhum módulo disponível</td></tr>'}</tbody>
      </table>
    </div>`
  );
  document.querySelectorAll('.toggle-modulo').forEach((checkbox) => {
    checkbox.addEventListener('change', () => alterarModulo(checkbox.dataset.moduloKey, checkbox.checked, checkbox));
  });
}

async function alterarModulo(moduloKey, ativo, checkbox) {
  checkbox.disabled = true;
  const resultado = await api(`/api/tenants/${encodeURIComponent(tenantIdModal)}/modulos/${encodeURIComponent(moduloKey)}`, {
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
  renderModulosModal(resultado.modulos);
  // Reflete a contagem de módulos ativos na tabela de fundo sem fechar o modal.
  await carregar();
}

carregar();
