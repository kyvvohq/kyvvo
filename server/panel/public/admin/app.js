// Área admin da Kyvvo — CRUD, busca, filtros, ordenação e paginação de
// tenants, tudo numa única tela. "Ver detalhes" abre um painel lateral
// compacto (drawer); a página cheia com módulos/histórico/atividade
// (/tenants/:id) fica um clique atrás, via o botão "Gerenciar tenant" do
// próprio drawer.

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

// ---------- Painel lateral "Ver detalhes" (drawer) ----------
function escFecharDrawer(e) {
  if (e.key === 'Escape') fecharDrawer();
}

function fecharDrawer() {
  const overlay = document.getElementById('drawer-overlay');
  if (overlay) overlay.remove();
  document.removeEventListener('keydown', escFecharDrawer);
}

function abrirDrawer(conteudoHtml) {
  fecharDrawer();
  const overlay = document.createElement('div');
  overlay.className = 'drawer-overlay';
  overlay.id = 'drawer-overlay';
  overlay.innerHTML = `
    <div class="drawer-painel">
      <button class="drawer-close" id="drawer-close" aria-label="Fechar">✕</button>
      ${conteudoHtml}
    </div>
  `;
  document.body.appendChild(overlay);
  document.getElementById('drawer-close').addEventListener('click', fecharDrawer);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) fecharDrawer(); });
  document.addEventListener('keydown', escFecharDrawer);
  return overlay;
}

// ---------- Listagem de tenants (busca, filtros, ordenação, paginação) ----------
const MODO_ATENDIMENTO = {
  bot: { label: 'Bot', classe: 'badge-modo-bot' },
  ia: { label: 'IA', classe: 'badge-modo-ia' },
};

const STATUS_CLASSES = {
  'Trial ativo': 'badge-trial-ativo',
  'Trial expirado': 'badge-trial-expirado',
  'Não ativado': 'badge-status-nao-ativado',
  Ativo: 'badge-status-ativo',
  Inativo: 'badge-status-inativo',
  Suspenso: 'badge-status-suspenso',
};

const COLUNAS_TABELA = [
  { key: 'nome', label: 'Tenant', ordenavel: true },
  { key: 'contato', label: 'Contato' },
  { key: 'cadastrado_em', label: 'Data de cadastro', ordenavel: true },
  { key: 'status', label: 'Status', ordenavel: true },
  { key: 'plano', label: 'Plano' },
];

const estado = {
  page: 1,
  limit: 20,
  orderBy: 'cadastrado_em',
  orderDir: 'desc',
  search: '',
  status: '',
  plano: '',
  modo: '',
};

let tenantsAtuais = [];
let planosCatalogo = [];

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

function formatarMoeda(valor) {
  if (valor === null || valor === undefined) return '—';
  return Number(valor).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
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
  return `
    <tr data-id="${escapeHtml(t.id)}">
      <td>${escapeHtml(t.nome)}</td>
      <td>
        <div class="tabela-contato-nome">${t.responsavel ? escapeHtml(t.responsavel) : '—'}</div>
        <div class="tabela-contato-email">${t.email ? escapeHtml(t.email) : '—'}</div>
      </td>
      <td>${formatarData(t.cadastrado_em)}</td>
      <td><span class="badge badge-status ${statusClasse}">${escapeHtml(renderStatusLabel(t))}</span></td>
      <td>${escapeHtml(t.plano_nome)}</td>
      <td class="td-acoes">
        <div class="tabela-acoes-wrapper">
          <button type="button" class="btn-acoes" data-testid="btn-acoes-${escapeHtml(t.id)}" aria-label="Ações">⋯</button>
          <div class="tabela-acoes-dropdown" id="dropdown-${escapeHtml(t.id)}">
            <button type="button" data-tenant-acao="ver-detalhes" data-id="${escapeHtml(t.id)}">Ver detalhes</button>
            <button type="button" data-tenant-acao="editar" data-id="${escapeHtml(t.id)}">Editar tenant</button>
            <div class="tabela-acoes-divisor"></div>
            <button type="button" data-tenant-acao="alterar-modo" data-id="${escapeHtml(t.id)}">Alterar modo de atendimento</button>
            <button type="button" data-tenant-acao="gerenciar-assinatura" data-id="${escapeHtml(t.id)}">Gerenciar assinatura</button>
            <div class="tabela-acoes-divisor"></div>
            <button type="button" data-tenant-acao="alternar" data-id="${escapeHtml(t.id)}">${t.ativo ? 'Desativar acesso' : 'Ativar acesso'}</button>
            <button type="button" class="acao-perigo" data-tenant-acao="excluir" data-id="${escapeHtml(t.id)}">Excluir tenant</button>
          </div>
        </div>
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

function renderCardsResumo(resumo) {
  return `
    <div class="financeiro-resumo">
      <div class="financeiro-resumo-card">
        <div class="financeiro-resumo-label">Total</div>
        <div>${resumo.total}</div>
        ${resumo.novos_mes > 0 ? `<div class="resumo-delta">↑ ${resumo.novos_mes} este mês</div>` : ''}
      </div>
      <div class="financeiro-resumo-card">
        <div class="financeiro-resumo-label">Ativos</div>
        <div>${resumo.ativos}</div>
      </div>
      <div class="financeiro-resumo-card">
        <div class="financeiro-resumo-label">Em trial</div>
        <div>${resumo.em_trial}</div>
      </div>
      <div class="financeiro-resumo-card">
        <div class="financeiro-resumo-label">Inativos</div>
        <div>${resumo.inativos}</div>
      </div>
    </div>
  `;
}

function renderFiltros() {
  const opcoesPlano = planosCatalogo
    .map((p) => `<option value="${escapeHtml(p.chave)}" ${estado.plano === p.chave ? 'selected' : ''}>${escapeHtml(p.nome)}</option>`)
    .join('');
  return `
    <div class="clientes-filtros">
      <input type="search" id="busca-tenants" placeholder="Buscar por e-mail ou WhatsApp..." value="${escapeHtml(estado.search)}">
      <select id="filtro-status">
        <option value="">Status</option>
        <option value="ativo" ${estado.status === 'ativo' ? 'selected' : ''}>Ativo</option>
        <option value="trial" ${estado.status === 'trial' ? 'selected' : ''}>Em trial</option>
        <option value="inativo" ${estado.status === 'inativo' ? 'selected' : ''}>Inativo</option>
      </select>
      <select id="filtro-plano">
        <option value="">Plano</option>
        ${opcoesPlano}
      </select>
      <select id="filtro-modo">
        <option value="">Modo</option>
        <option value="bot" ${estado.modo === 'bot' ? 'selected' : ''}>Bot</option>
        <option value="ia" ${estado.modo === 'ia' ? 'selected' : ''}>IA</option>
      </select>
      <button type="button" class="btn-novo-agendamento" id="btn-novo-tenant">+ Novo tenant</button>
    </div>
  `;
}

async function carregarPlanosCatalogo() {
  if (planosCatalogo.length) return;
  const data = await api('/api/planos');
  if (data && data.planos) planosCatalogo = data.planos;
}

async function renderTenants() {
  conteudo.innerHTML = '<div class="vazio">Carregando...</div>';

  await carregarPlanosCatalogo();

  const params = new URLSearchParams({
    page: estado.page,
    limit: estado.limit,
    order_by: estado.orderBy,
    order_dir: estado.orderDir,
  });
  if (estado.search) params.set('search', estado.search);
  if (estado.status) params.set('status', estado.status);
  if (estado.plano) params.set('plano', estado.plano);
  if (estado.modo) params.set('modo', estado.modo);

  const [resumo, data] = await Promise.all([api('/api/tenants/resumo'), api(`/api/tenants?${params.toString()}`)]);
  if (!data) return;

  tenantsAtuais = data.tenants || [];

  const totalLabel = estado.search || estado.status || estado.plano || estado.modo
    ? `${data.total ?? tenantsAtuais.length} tenants encontrados`
    : `Tenants (${data.total ?? tenantsAtuais.length})`;

  conteudo.innerHTML = `
    <div class="inicio-cabecalho">
      <div>
        <h2>Tenants</h2>
        <p class="financeiro-subtitulo">Gerencie clientes, planos e status da plataforma.</p>
      </div>
    </div>
    ${resumo ? renderCardsResumo(resumo) : ''}
    ${renderFiltros()}
    <div class="nav-periodo">
      <strong>${totalLabel}</strong>
    </div>
  `;

  if (tenantsAtuais.length === 0) {
    const mensagemVazia = estado.search || estado.status || estado.plano || estado.modo
      ? 'Nenhum tenant encontrado para os filtros aplicados.'
      : 'Nenhum tenant cadastrado ainda.';
    conteudo.insertAdjacentHTML('beforeend', `<div class="vazio">${mensagemVazia}</div>`);
  } else {
    conteudo.insertAdjacentHTML(
      'beforeend',
      `
      <div class="tabela-wrapper">
        <table class="tabela-tenants">
          <thead><tr>${renderCabecalho()}<th>Ações</th></tr></thead>
          <tbody>${tenantsAtuais.map(renderLinha).join('')}</tbody>
        </table>
      </div>
      ${renderPaginacao(data)}
    `
    );
  }

  wireEventosTenants(data);
}

function wireEventosTenants(data) {
  document.getElementById('btn-novo-tenant').addEventListener('click', () => abrirModalTenant(null));

  const inputBusca = document.getElementById('busca-tenants');
  let debounceBusca = null;
  inputBusca.addEventListener('input', () => {
    clearTimeout(debounceBusca);
    debounceBusca = setTimeout(() => {
      estado.search = inputBusca.value.trim();
      estado.page = 1;
      renderTenants();
    }, 400);
  });

  document.getElementById('filtro-status').addEventListener('change', (e) => {
    estado.status = e.target.value;
    estado.page = 1;
    renderTenants();
  });
  document.getElementById('filtro-plano').addEventListener('change', (e) => {
    estado.plano = e.target.value;
    estado.page = 1;
    renderTenants();
  });
  document.getElementById('filtro-modo').addEventListener('change', (e) => {
    estado.modo = e.target.value;
    estado.page = 1;
    renderTenants();
  });

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

// Delegado em `conteudo` (não recriado a cada render): o botão "⋯" abre/
// fecha o dropdown daquela linha (só um aberto por vez); um clique num item
// do dropdown executa a ação e fecha o menu.
conteudo.addEventListener('click', (e) => {
  const btnAcoes = e.target.closest('.btn-acoes');
  if (btnAcoes) {
    const dropdown = btnAcoes.nextElementSibling;
    const jaAberto = dropdown.classList.contains('aberto');
    document.querySelectorAll('.tabela-acoes-dropdown.aberto').forEach((d) => d.classList.remove('aberto'));
    if (!jaAberto) dropdown.classList.add('aberto');
    return;
  }

  const acaoBtn = e.target.closest('[data-tenant-acao]');
  if (acaoBtn) {
    document.querySelectorAll('.tabela-acoes-dropdown.aberto').forEach((d) => d.classList.remove('aberto'));
    const tenant = tenantsAtuais.find((t) => t.id === acaoBtn.dataset.id);
    if (!tenant) return;
    const acao = acaoBtn.dataset.tenantAcao;
    if (acao === 'ver-detalhes') abrirDrawerTenant(tenant);
    if (acao === 'editar') abrirModalTenant(tenant);
    if (acao === 'alternar') alternarAtivoTenant(tenant);
    if (acao === 'alterar-modo') abrirModalTrocaModo(tenant);
    if (acao === 'gerenciar-assinatura') window.location.href = `/assinaturas.html?busca=${encodeURIComponent(tenant.nome)}`;
    if (acao === 'excluir') abrirModalExcluirTenant(tenant);
    return;
  }

  if (!e.target.closest('.tabela-acoes-wrapper')) {
    document.querySelectorAll('.tabela-acoes-dropdown.aberto').forEach((d) => d.classList.remove('aberto'));
  }
});

// Fecha qualquer dropdown de ações aberto ao clicar fora da tabela.
document.addEventListener('click', (e) => {
  if (!e.target.closest('.tabela-acoes-wrapper')) {
    document.querySelectorAll('.tabela-acoes-dropdown.aberto').forEach((d) => d.classList.remove('aberto'));
  }
});

async function alternarAtivoTenant(tenant) {
  const resultado = await api(`/api/tenants/${tenant.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ ativo: !tenant.ativo }),
  });
  if (resultado && !resultado.error) {
    mostrarToast(`Acesso do tenant ${resultado.ativo ? 'ativado' : 'desativado'} com sucesso.`, 'sucesso');
    renderTenants();
  } else {
    mostrarToast((resultado && resultado.error) || 'Erro ao atualizar tenant.', 'erro');
  }
}

// ---------- Painel lateral "Ver detalhes" ----------
async function abrirDrawerTenant(tenantResumo) {
  abrirDrawer('<div class="vazio">Carregando...</div>');

  const detalhe = await api(`/api/tenants/${tenantResumo.id}/assinatura-resumo`);
  if (!detalhe || detalhe.error) {
    abrirDrawer(`<div class="vazio">${escapeHtml((detalhe && detalhe.error) || 'Erro ao carregar tenant.')}</div>`);
    return;
  }

  const statusClasse = STATUS_CLASSES[detalhe.status_conta] || 'badge-status-inativo';
  const statusLabel = detalhe.status_conta === 'Trial ativo' && detalhe.trial_dias_restantes != null
    ? `Trial ativo · ${detalhe.trial_dias_restantes} dias`
    : detalhe.status_conta;

  abrirDrawer(`
    <h3>${escapeHtml(detalhe.nome)}</h3>
    <span class="badge badge-status ${statusClasse}">${escapeHtml(statusLabel)}</span>

    <div class="drawer-secao">
      <h4>Informações</h4>
      <p><strong>Responsável:</strong> ${detalhe.responsavel ? escapeHtml(detalhe.responsavel.nome) : '—'}</p>
      <p><strong>E-mail:</strong> ${detalhe.responsavel ? escapeHtml(detalhe.responsavel.email) : '—'}</p>
      <p><strong>WhatsApp:</strong> ${formatarWhatsapp(detalhe.whatsapp)}</p>
    </div>

    <div class="drawer-secao">
      <h4>Assinatura</h4>
      <p><strong>Plano:</strong> ${escapeHtml(detalhe.plano_nome)}</p>
      <p><strong>Valor:</strong> ${formatarMoeda(detalhe.valor_plano)}/mês</p>
      <p><strong>Próxima cobrança:</strong> ${detalhe.proxima_cobranca ? formatarData(detalhe.proxima_cobranca.data) : '—'}</p>
    </div>

    <div class="drawer-secao">
      <h4>WhatsApp</h4>
      <p><strong>Status:</strong> ${detalhe.whatsapp_conectado ? 'Conectado' : 'Não conectado'}</p>
      <p><strong>Número:</strong> ${formatarWhatsapp(detalhe.whatsapp_numero)}</p>
    </div>

    <div class="modal-acoes">
      <button type="button" class="btn-primario" id="drawer-btn-gerenciar">Gerenciar tenant</button>
    </div>
  `);

  document.getElementById('drawer-btn-gerenciar').addEventListener('click', () => {
    window.location.href = `/tenants/${encodeURIComponent(detalhe.id)}`;
  });
}

// ---------- Modal de confirmação de exclusão (soft delete) ----------
function abrirModalExcluirTenant(tenant) {
  abrirModal(
    '<h3>Excluir tenant</h3>',
    `
      <div class="modal-texto">
        Tem certeza que quer excluir <strong>${escapeHtml(tenant.nome)}</strong>? O tenant deixa de aparecer na listagem e o acesso é desativado — os dados continuam guardados, mas restaurar depende de uma ação manual da equipe.
      </div>
      <div class="modal-erro" id="excluir-erro"></div>
      <div class="modal-acoes">
        <button type="button" class="btn-secundario" id="btn-cancelar-excluir">Cancelar</button>
        <button type="button" class="btn-perigo" id="btn-confirmar-excluir">Excluir tenant</button>
      </div>
    `
  );

  document.getElementById('btn-cancelar-excluir').addEventListener('click', fecharModal);
  document.getElementById('btn-confirmar-excluir').addEventListener('click', async () => {
    const btn = document.getElementById('btn-confirmar-excluir');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>';

    const resultado = await api(`/api/tenants/${tenant.id}`, { method: 'DELETE' });

    if (resultado && !resultado.error) {
      fecharModal();
      mostrarToast('Tenant excluído com sucesso.', 'sucesso');
      renderTenants();
    } else {
      document.getElementById('excluir-erro').textContent = (resultado && resultado.error) || 'Erro ao excluir tenant.';
      btn.disabled = false;
      btn.textContent = 'Excluir tenant';
    }
  });
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

    const resultado = await api(`/api/tenants/${tenant.id}/modo`, {
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
    detalhe = await api(`/api/tenants/${tenantResumo.id}`);
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

    const resultado = await api(editando ? `/api/tenants/${detalhe.id}` : '/api/tenants', {
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
