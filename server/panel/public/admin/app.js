// Área admin da Kyvvo — CRUD, busca, ordenação e paginação de tenants, tudo
// numa única tela. Clicar numa linha da tabela navega pro detalhe
// consolidado do tenant em /admin/tenants/:id.

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

const SEGMENTOS_ADMIN = {
  salao_beleza: 'Salão de beleza',
  petshop: 'Pet Shop',
  psicologia: 'Psicólogo(a)',
  fisioterapia: 'Fisioterapia',
  pilates: 'Pilates',
  outro: 'Outro',
};

// `nome`/`responsavel`/`email` vêm do cadastro self-service (US20), que só
// valida tamanho mínimo e um regex frouxo de e-mail — não impedem `<`, `>`
// ou `"`. Escapa antes de interpolar no innerHTML pra não abrir XSS
// armazenado contra a sessão do admin (que guarda o token no localStorage).
function escapeHtml(valor) {
  return String(valor ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[c]));
}

// ---------- Modal genérico + toast ----------
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

// ---------- Listagem de tenants (busca, ordenação, paginação) ----------
// Precisa bater exatamente com a ordem das células em `renderLinha` — cada
// coluna aqui vira um <th>, ordenável (botão) ou não (texto simples).
const COLUNAS_TABELA = [
  { key: 'nome', label: 'Nome da empresa', ordenavel: true },
  { key: 'responsavel', label: 'Responsável' },
  { key: 'email', label: 'E-mail' },
  { key: 'whatsapp', label: 'WhatsApp' },
  { key: 'cadastrado_em', label: 'Data de cadastro', ordenavel: true },
  { key: 'ativado_em', label: 'Data de ativação', ordenavel: true },
  { key: 'status', label: 'Status', ordenavel: true },
  { key: 'tecnologia', label: 'Modo de atendimento' },
];

// US69/CA01 — rótulo e classe de badge do modo de atendimento (bot/ia).
const MODO_ATENDIMENTO = {
  bot: { label: '🤖 Bot', classe: 'badge-modo-bot' },
  ia: { label: '✨ IA', classe: 'badge-modo-ia' },
};

const STATUS_CLASSES = {
  'Trial ativo': 'badge-trial-ativo',
  'Trial expirado': 'badge-trial-expirado',
  'Não ativado': 'badge-status-nao-ativado',
  Ativo: 'badge-status-ativo',
  Inativo: 'badge-status-inativo',
  Suspenso: 'badge-status-suspenso',
};

const estado = {
  page: 1,
  limit: 20,
  orderBy: 'cadastrado_em',
  orderDir: 'desc',
  search: '',
};

let tenantsAtuais = [];

// WhatsApp é guardado só com dígitos (DDD + número, sem DDI) — formata pra
// exibição: (XX) XXXXX-XXXX ou (XX) XXXX-XXXX pra fixo de 8 dígitos.
function formatarWhatsapp(digitos) {
  if (!digitos) return '—';
  const d = String(digitos).replace(/\D/g, '');
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return digitos;
}

function formatarData(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function renderCabecalho() {
  return COLUNAS_TABELA.map((col) => {
    if (!col.ordenavel) return `<th>${col.label}</th>`;
    const ativa = estado.orderBy === col.key;
    const seta = ativa ? (estado.orderDir === 'asc' ? ' ▲' : ' ▼') : '';
    return `<th><button type="button" class="th-ordenar${ativa ? ' th-ordenar-ativo' : ''}" data-order-by="${col.key}">${col.label}${seta}</button></th>`;
  }).join('');
}

// Status "Trial ativo" ganha a contagem de dias restantes ao lado — só
// quando o backend manda `trial_dias_restantes` (ausente em tenants que
// nunca chegaram a esse estado).
function renderStatusLabel(t) {
  if (t.status_conta === 'Trial ativo' && t.trial_dias_restantes !== undefined && t.trial_dias_restantes !== null) {
    return `Trial ativo (${t.trial_dias_restantes} dias)`;
  }
  return t.status_conta;
}

function renderLinha(t) {
  const statusClasse = STATUS_CLASSES[t.status_conta] || 'badge-status-inativo';
  const modo = MODO_ATENDIMENTO[t.tecnologia] || MODO_ATENDIMENTO.bot;
  return `
    <tr data-id="${escapeHtml(t.id)}">
      <td>${escapeHtml(t.nome)}</td>
      <td>${t.responsavel ? escapeHtml(t.responsavel) : '—'}</td>
      <td>${t.email ? escapeHtml(t.email) : '—'}</td>
      <td>${formatarWhatsapp(t.whatsapp)}</td>
      <td>${formatarData(t.cadastrado_em)}</td>
      <td>${formatarData(t.ativado_em)}</td>
      <td><span class="badge badge-status ${statusClasse}">${escapeHtml(renderStatusLabel(t))}</span></td>
      <td data-testid="modo-${escapeHtml(t.id)}">
        <span class="badge ${modo.classe}">${modo.label}</span>
        ${t.ativo ? `<button type="button" class="btn-acao-tabela" data-testid="btn-alterar-modo-${escapeHtml(t.id)}" data-tenant-acao="alterar-modo" data-id="${escapeHtml(t.id)}">Alterar</button>` : ''}
      </td>
      <td class="td-acoes">
        <a class="btn-ver-detalhes" href="/admin/tenants/${encodeURIComponent(t.id)}">Ver detalhes</a>
        <button type="button" class="btn-acao-tabela" data-tenant-acao="editar" data-id="${escapeHtml(t.id)}">Editar</button>
        <button type="button" class="btn-acao-tabela${t.ativo ? ' acao-perigo' : ''}" data-tenant-acao="alternar" data-id="${escapeHtml(t.id)}">${t.ativo ? 'Desativar' : 'Ativar'}</button>
      </td>
    </tr>
  `;
}

function renderPaginacao(meta) {
  const paginaAtual = meta.page || 1;
  const totalPaginas = meta.total_paginas || 1;
  return `
    <div class="nav-periodo">
      <button type="button" id="btn-pagina-anterior" ${paginaAtual <= 1 ? 'disabled' : ''}>← Anterior</button>
      <span>Página ${paginaAtual} de ${totalPaginas}</span>
      <button type="button" id="btn-pagina-proxima" ${paginaAtual >= totalPaginas ? 'disabled' : ''}>Próximo →</button>
    </div>
  `;
}

async function renderTenants() {
  conteudo.innerHTML = '<div class="vazio">Carregando...</div>';

  const params = new URLSearchParams({
    page: estado.page,
    limit: estado.limit,
    order_by: estado.orderBy,
    order_dir: estado.orderDir,
  });
  if (estado.search) {
    params.set('search', estado.search);
  }
  const data = await api(`/admin/api/tenants?${params.toString()}`);
  if (!data) return;

  tenantsAtuais = data.tenants || [];

  const totalLabel = estado.search
    ? `${data.total ?? tenantsAtuais.length} tenants encontrados`
    : `Tenants (${data.total ?? tenantsAtuais.length})`;

  const cabecalhoLista = `
    <div class="nav-periodo">
      <strong>${totalLabel}</strong>
      <button type="button" class="btn-novo-agendamento" id="btn-novo-tenant">+ Novo tenant</button>
    </div>
  `;

  if (tenantsAtuais.length === 0) {
    const mensagemVazia = estado.search
      ? `Nenhum tenant encontrado para '${escapeHtml(estado.search)}'.`
      : 'Nenhum tenant cadastrado ainda.';
    conteudo.innerHTML = `${cabecalhoLista}<div class="vazio">${mensagemVazia}</div>`;
    document.getElementById('btn-novo-tenant').addEventListener('click', () => abrirModalTenant(null));
    return;
  }

  conteudo.innerHTML = `
    ${cabecalhoLista}
    <div class="tabela-wrapper">
      <table class="tabela-tenants">
        <thead><tr>${renderCabecalho()}<th>Ações</th></tr></thead>
        <tbody>${tenantsAtuais.map(renderLinha).join('')}</tbody>
      </table>
    </div>
    ${renderPaginacao(data)}
  `;

  document.getElementById('btn-novo-tenant').addEventListener('click', () => abrirModalTenant(null));

  conteudo.querySelectorAll('.th-ordenar').forEach((btn) => {
    btn.addEventListener('click', () => {
      const orderBy = btn.dataset.orderBy;
      if (estado.orderBy === orderBy) {
        estado.orderDir = estado.orderDir === 'asc' ? 'desc' : 'asc';
      } else {
        estado.orderBy = orderBy;
        estado.orderDir = 'desc';
      }
      estado.page = 1;
      renderTenants();
    });
  });

  const btnAnterior = document.getElementById('btn-pagina-anterior');
  const btnProxima = document.getElementById('btn-pagina-proxima');
  if (btnAnterior) {
    btnAnterior.addEventListener('click', () => {
      if (estado.page > 1) {
        estado.page -= 1;
        renderTenants();
      }
    });
  }
  if (btnProxima) {
    btnProxima.addEventListener('click', () => {
      if (estado.page < (data.total_paginas || 1)) {
        estado.page += 1;
        renderTenants();
      }
    });
  }
}

// Delegado em `conteudo` (não recriado a cada render, ao contrário das linhas
// da tabela): clicar numa linha navega pro detalhe do tenant, exceto quando
// o clique já foi num link ou botão de ação ("Ver detalhes"/"Editar"/
// "Ativar"/"Desativar"/mailto), que cuidam da própria ação.
conteudo.addEventListener('click', (e) => {
  const acaoBtn = e.target.closest('[data-tenant-acao]');
  if (acaoBtn) {
    const tenant = tenantsAtuais.find((t) => t.id === acaoBtn.dataset.id);
    if (!tenant) return;
    if (acaoBtn.dataset.tenantAcao === 'editar') abrirModalTenant(tenant);
    if (acaoBtn.dataset.tenantAcao === 'alternar') alternarAtivoTenant(tenant);
    if (acaoBtn.dataset.tenantAcao === 'alterar-modo') abrirModalTrocaModo(tenant);
    return;
  }

  const tr = e.target.closest('.tabela-tenants tbody tr');
  if (tr && !e.target.closest('a') && !e.target.closest('button')) {
    window.location.href = `/admin/tenants/${encodeURIComponent(tr.dataset.id)}`;
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

// ---------- Modal de troca de modo de atendimento (US69/CA02) ----------
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

    const resultado = await api(`/admin/api/tenants/${tenant.id}/modo`, {
      method: 'PATCH',
      body: JSON.stringify({ tecnologia: destino }),
    });

    if (resultado && !resultado.error) {
      fecharModal();
      mostrarToast(`Modo de atendimento alterado para ${modoDestino.label}.`, 'sucesso');
      renderTenants();
    } else {
      document.getElementById('modo-erro').textContent = (resultado && resultado.error) || 'Erro ao alterar modo de atendimento.';
      btn.disabled = false;
      btn.textContent = 'Confirmar troca';
    }
  });
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
        <strong>Módulos ativos:</strong> ${detalhe.modulos_ativos.length ? detalhe.modulos_ativos.map((m) => escapeHtml(m.nome)).join(', ') : 'nenhum'}<br>
        <strong>Usuários de login:</strong> ${detalhe.usuarios.length ? detalhe.usuarios.map((u) => escapeHtml(u.email)).join(', ') : 'nenhum'}<br>
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
        <input type="text" id="tenant-nome" data-obrigatorio value="${editando ? escapeHtml(detalhe.nome) : ''}">
        <label for="tenant-segmento">Segmento</label>
        <select id="tenant-segmento">${opcoesSegmento}</select>
        <label for="tenant-telefone">Telefone</label>
        <input type="text" id="tenant-telefone" value="${editando ? escapeHtml(detalhe.telefone || '') : ''}">
        <label for="tenant-endereco">Endereço</label>
        <input type="text" id="tenant-endereco" value="${editando ? escapeHtml(detalhe.endereco || '') : ''}">
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

// ---------- Busca (US27) ----------
const inputBusca = document.getElementById('busca-tenants');
const btnLimparBusca = document.getElementById('btn-limpar-busca');
let debounceBusca = null;

inputBusca.addEventListener('input', () => {
  btnLimparBusca.hidden = inputBusca.value.length === 0;
  clearTimeout(debounceBusca);
  debounceBusca = setTimeout(() => {
    estado.search = inputBusca.value.trim();
    estado.page = 1;
    renderTenants();
  }, 400);
});

btnLimparBusca.addEventListener('click', () => {
  inputBusca.value = '';
  btnLimparBusca.hidden = true;
  clearTimeout(debounceBusca);
  estado.search = '';
  estado.page = 1;
  renderTenants();
});

renderTenants();
