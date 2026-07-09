// Área admin da Kyvvo (US16) — JS próprio, separado do app.js do portal do
// tenant. Usa localStorage/token/rotas totalmente distintos
// (kyvvo_admin_token, /admin/api/...), então não compartilha nada com a
// sessão de um tenant aberta no mesmo navegador.

const token = localStorage.getItem('kyvvo_admin_token');
document.getElementById('admin-nome').textContent = localStorage.getItem('kyvvo_admin_nome') || '';

document.getElementById('btn-sair').addEventListener('click', () => {
  localStorage.removeItem('kyvvo_admin_token');
  localStorage.removeItem('kyvvo_admin_nome');
  window.location.href = '/admin/login.html';
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
    localStorage.removeItem('kyvvo_admin_token');
    window.location.href = '/admin/login.html';
    return null;
  }
  return res.json();
}

const conteudo = document.getElementById('conteudo');

const SEGMENTOS_ADMIN = {
  salao_beleza: 'Salão de beleza',
  petshop: 'Pet Shop',
  psicologia: 'Psicólogo(a)',
  fisioterapia: 'Fisioterapia',
  pilates: 'Pilates',
  outro: 'Outro',
};

// ---------- Modal genérico + toast (duplicado do app.js do portal — os dois
// arquivos são intencionalmente independentes, ver decisão de isolamento em
// US16) ----------
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

function validarObrigatorios(form) {
  let primeiroInvalido = null;
  form.querySelectorAll('[data-obrigatorio]').forEach((campo) => {
    const vazio = !campo.value || !campo.value.trim();
    campo.classList.toggle('campo-invalido', vazio);
    if (vazio && !primeiroInvalido) primeiroInvalido = campo;
  });
  return primeiroInvalido;
}

// ---------- Lista de tenants ----------
let tenantsAtuais = [];

function renderTenantItem(t) {
  return `
    <div class="agendamento-item" data-id="${t.id}">
      <div class="agendamento-linha-principal" data-tenant-toggle="${t.id}">
        <div>
          <div class="agendamento-hora">${t.nome}${!t.ativo ? ' <span class="badge badge-cancelado">Desativado</span>' : ''}</div>
          <div class="agendamento-detalhe">${SEGMENTOS_ADMIN[t.segmento] || t.segmento} · ${t.total_usuarios} usuário(s)</div>
        </div>
        <button class="btn-acoes" aria-label="Ações">⋮</button>
      </div>
      <div class="menu-acoes" id="menu-tenant-${t.id}">
        <button data-tenant-acao="editar" data-id="${t.id}">Ver / editar</button>
        <button data-tenant-acao="alternar" data-id="${t.id}" class="${t.ativo ? 'acao-perigo' : ''}">${t.ativo ? 'Desativar' : 'Ativar'}</button>
      </div>
    </div>
  `;
}

async function renderTenants() {
  conteudo.innerHTML = '<div class="vazio">Carregando...</div>';
  const data = await api('/admin/api/tenants');
  if (!data) return;
  tenantsAtuais = data.tenants;

  let html = `
    <div class="nav-periodo">
      <strong>Tenants (${tenantsAtuais.length})</strong>
      <button class="btn-novo-agendamento" id="btn-novo-tenant">+ Novo tenant</button>
    </div>
  `;
  html += tenantsAtuais.length
    ? tenantsAtuais.map(renderTenantItem).join('')
    : '<div class="vazio">Nenhum tenant cadastrado ainda.</div>';

  conteudo.innerHTML = html;
  document.getElementById('btn-novo-tenant').addEventListener('click', () => abrirModalTenant(null));
}

conteudo.addEventListener('click', (e) => {
  const toggleEl = e.target.closest('[data-tenant-toggle]');
  if (toggleEl) {
    const id = toggleEl.dataset.tenantToggle;
    const menu = document.getElementById(`menu-tenant-${id}`);
    const jaAberto = menu.classList.contains('aberto');
    document.querySelectorAll('.menu-acoes.aberto').forEach((m) => m.classList.remove('aberto'));
    if (!jaAberto) menu.classList.add('aberto');
    return;
  }

  const acaoBtn = e.target.closest('[data-tenant-acao]');
  if (acaoBtn) {
    document.querySelectorAll('.menu-acoes.aberto').forEach((m) => m.classList.remove('aberto'));
    const tenant = tenantsAtuais.find((t) => t.id === acaoBtn.dataset.id);
    if (!tenant) return;
    if (acaoBtn.dataset.tenantAcao === 'editar') abrirModalTenant(tenant);
    if (acaoBtn.dataset.tenantAcao === 'alternar') alternarAtivoTenant(tenant);
  }
});

document.addEventListener('click', (e) => {
  if (!e.target.closest('.agendamento-item')) {
    document.querySelectorAll('.menu-acoes.aberto').forEach((m) => m.classList.remove('aberto'));
  }
});

async function alternarAtivoTenant(tenant) {
  const resultado = await api(`/admin/api/tenants/${tenant.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ ativo: !tenant.ativo }),
  });
  if (resultado && !resultado.error) {
    mostrarToast(`Tenant ${resultado.ativo ? 'ativado' : 'desativado'} com sucesso.`, 'sucesso');
    renderTenants();
  } else {
    mostrarToast((resultado && resultado.error) || 'Erro ao atualizar tenant.', 'erro');
  }
}

// ---------- Modal de criar/editar tenant ----------
async function abrirModalTenant(tenantResumo) {
  const editando = !!tenantResumo;
  let detalhe = tenantResumo;

  if (editando) {
    detalhe = await api(`/admin/api/tenants/${tenantResumo.id}`);
    if (!detalhe) return;
  }

  const opcoesSegmento = Object.entries(SEGMENTOS_ADMIN)
    .map(([key, label]) => `<option value="${key}" ${editando && detalhe.segmento === key ? 'selected' : ''}>${label}</option>`)
    .join('');

  const detalheHtml = editando
    ? `
      <div class="modal-texto">
        <strong>Módulos ativos:</strong> ${detalhe.modulos_ativos.length ? detalhe.modulos_ativos.map((m) => m.nome).join(', ') : 'nenhum'}<br>
        <strong>Usuários de login:</strong> ${detalhe.usuarios.length ? detalhe.usuarios.map((u) => u.email).join(', ') : 'nenhum'}<br>
        <strong>Serviços cadastrados:</strong> ${detalhe.contagens.servicos} · <strong>Profissionais:</strong> ${detalhe.contagens.profissionais}
      </div>
    `
    : '';

  const usuarioNovoHtml = !editando
    ? `
      <label class="dia-checkbox">
        <input type="checkbox" id="tenant-criar-usuario">
        Já criar o primeiro usuário de login junto
      </label>
      <div id="tenant-usuario-campos" style="display:none">
        <label for="tenant-usuario-email">E-mail do usuário *</label>
        <input type="email" id="tenant-usuario-email">
        <label for="tenant-usuario-senha">Senha do usuário *</label>
        <input type="password" id="tenant-usuario-senha">
        <label for="tenant-usuario-nome">Nome do usuário (opcional)</label>
        <input type="text" id="tenant-usuario-nome">
      </div>
    `
    : '';

  abrirModal(
    `<h3>${editando ? 'Editar tenant' : 'Novo tenant'}</h3>`,
    `
      <form id="form-tenant">
        <div class="modal-erro" id="tenant-erro"></div>
        ${detalheHtml}
        <label for="tenant-nome">Nome *</label>
        <input type="text" id="tenant-nome" data-obrigatorio value="${editando ? detalhe.nome : ''}">
        <label for="tenant-segmento">Segmento</label>
        <select id="tenant-segmento">${opcoesSegmento}</select>
        <label for="tenant-telefone">Telefone</label>
        <input type="text" id="tenant-telefone" value="${editando ? detalhe.telefone || '' : ''}">
        <label for="tenant-endereco">Endereço</label>
        <input type="text" id="tenant-endereco" value="${editando ? detalhe.endereco || '' : ''}">
        ${usuarioNovoHtml}
        <div class="modal-acoes">
          <button type="button" class="btn-secundario" id="btn-cancelar-tenant">Cancelar</button>
          <button type="submit" class="btn-primario" id="btn-salvar-tenant">${editando ? 'Salvar' : 'Criar'}</button>
        </div>
      </form>
    `
  );

  document.getElementById('btn-cancelar-tenant').addEventListener('click', fecharModal);

  if (!editando) {
    document.getElementById('tenant-criar-usuario').addEventListener('change', (e) => {
      document.getElementById('tenant-usuario-campos').style.display = e.target.checked ? 'block' : 'none';
    });
  }

  const form = document.getElementById('form-tenant');
  form.querySelectorAll('[data-obrigatorio]').forEach((campo) => {
    campo.addEventListener('input', () => campo.classList.remove('campo-invalido'));
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const erroEl = document.getElementById('tenant-erro');
    erroEl.textContent = '';
    const invalido = validarObrigatorios(form);
    if (invalido) {
      erroEl.textContent = 'Preencha os campos obrigatórios destacados em vermelho.';
      invalido.focus();
      return;
    }

    const btn = document.getElementById('btn-salvar-tenant');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>';

    const payload = {
      nome: document.getElementById('tenant-nome').value.trim(),
      segmento: document.getElementById('tenant-segmento').value,
      telefone: document.getElementById('tenant-telefone').value.trim() || null,
      endereco: document.getElementById('tenant-endereco').value.trim() || null,
    };

    if (!editando && document.getElementById('tenant-criar-usuario').checked) {
      payload.usuario = {
        email: document.getElementById('tenant-usuario-email').value.trim(),
        senha: document.getElementById('tenant-usuario-senha').value,
        nome: document.getElementById('tenant-usuario-nome').value.trim() || undefined,
      };
    }

    const resultado = await api(editando ? `/admin/api/tenants/${detalhe.id}` : '/admin/api/tenants', {
      method: editando ? 'PATCH' : 'POST',
      body: JSON.stringify(payload),
    });

    if (resultado && !resultado.error) {
      fecharModal();
      mostrarToast(editando ? 'Tenant atualizado com sucesso.' : 'Tenant criado com sucesso.', 'sucesso');
      renderTenants();
    } else {
      erroEl.textContent = (resultado && resultado.error) || 'Erro ao salvar tenant.';
      btn.disabled = false;
      btn.textContent = editando ? 'Salvar' : 'Criar';
    }
  });
}

renderTenants();
