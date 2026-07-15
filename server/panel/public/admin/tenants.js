// Listagem de tenants da área admin da Kyvvo (US26) — tela dedicada,
// separada do CRUD simples de tenants em painel.html (US16). Usa o mesmo
// endpoint (/admin/api/tenants), mas passando page/limit/order_by/order_dir
// pra acionar o modo paginado do backend.

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

const COLUNAS_ORDENAVEIS = [
  { key: 'nome', label: 'Nome da empresa' },
  { key: 'cadastrado_em', label: 'Data de cadastro' },
  { key: 'ativado_em', label: 'Data de ativação' },
  { key: 'status', label: 'Status' },
];

const STATUS_CLASSES = {
  'Trial ativo': 'badge-trial-ativo',
  'Trial expirado': 'badge-trial-expirado',
  Ativo: 'badge-status-ativo',
  Inativo: 'badge-status-inativo',
};

const estado = {
  page: 1,
  limit: 20,
  orderBy: 'cadastrado_em',
  orderDir: 'desc',
};

let tenantsAtuais = [];

// WhatsApp é guardado só com dígitos (DDD + número, sem DDI) — formata pra
// exibição (CA02): (XX) XXXXX-XXXX ou (XX) XXXX-XXXX pra fixo de 8 dígitos.
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
  return COLUNAS_ORDENAVEIS.map((col) => {
    const ativa = estado.orderBy === col.key;
    const seta = ativa ? (estado.orderDir === 'asc' ? ' ▲' : ' ▼') : '';
    return `<th><button type="button" class="th-ordenar${ativa ? ' th-ordenar-ativo' : ''}" data-order-by="${col.key}">${col.label}${seta}</button></th>`;
  }).join('');
}

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

function renderLinha(t) {
  const statusClasse = STATUS_CLASSES[t.status_conta] || 'badge-status-inativo';
  const email = escapeHtml(t.email);
  return `
    <tr data-id="${escapeHtml(t.id)}">
      <td>${escapeHtml(t.nome)}</td>
      <td>${t.responsavel ? escapeHtml(t.responsavel) : '—'}</td>
      <td>${t.email ? `<a href="mailto:${email}">${email}</a>` : '—'}</td>
      <td>${formatarWhatsapp(t.whatsapp)}</td>
      <td>${formatarData(t.cadastrado_em)}</td>
      <td>${formatarData(t.ativado_em)}</td>
      <td><span class="badge badge-status ${statusClasse}">${escapeHtml(t.status_conta)}</span></td>
      <td><a class="btn-ver-detalhes" href="/admin/tenants/${encodeURIComponent(t.id)}">Ver detalhes</a></td>
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
  const data = await api(`/admin/api/tenants?${params.toString()}`);
  if (!data) return;

  tenantsAtuais = data.tenants || [];

  if (tenantsAtuais.length === 0) {
    conteudo.innerHTML = `
      <div class="nav-periodo"><strong>Tenants</strong></div>
      <div class="vazio">Nenhum tenant cadastrado ainda.</div>
    `;
    return;
  }

  conteudo.innerHTML = `
    <div class="nav-periodo"><strong>Tenants (${data.total ?? tenantsAtuais.length})</strong></div>
    <div class="tabela-wrapper">
      <table class="tabela-tenants">
        <thead><tr>${renderCabecalho()}<th>Ações</th></tr></thead>
        <tbody>${tenantsAtuais.map(renderLinha).join('')}</tbody>
      </table>
    </div>
    ${renderPaginacao(data)}
  `;

  // Clicar em qualquer parte da linha navega pro detalhe do tenant (US28/CA01)
  // — exceto quando o clique já foi num link (mailto:/"Ver detalhes"), que
  // cuida da própria navegação.
  conteudo.querySelectorAll('.tabela-tenants tbody tr').forEach((tr) => {
    tr.addEventListener('click', (e) => {
      if (e.target.closest('a')) return;
      window.location.href = `/admin/tenants/${encodeURIComponent(tr.dataset.id)}`;
    });
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

renderTenants();
