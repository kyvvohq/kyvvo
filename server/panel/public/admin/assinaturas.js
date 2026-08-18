// Assinaturas (área "Clientes") — visão consolidada de plano/valor/próxima
// cobrança por tenant (GET /api/assinaturas, que reaproveita
// montarResumoPagamentos no backend, mesma lógica já usada na aba de
// pagamentos do próprio tenant). Somente leitura nesta rodada: cancelar ou
// trocar plano por aqui não foi pedido e mexe com cobrança real via Asaas —
// fica pra uma rodada futura, se o Bruno pedir.

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

function escapeHtml(valor) {
  return String(valor ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[c]));
}

function formatarMoeda(valor) {
  if (valor === null || valor === undefined) return '—';
  return Number(valor).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatarData(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

const STATUS_CLASSES = {
  'Trial ativo': 'badge-trial-ativo',
  'Trial expirado': 'badge-trial-expirado',
  'Não ativado': 'badge-status-nao-ativado',
  Ativo: 'badge-status-ativo',
  Inativo: 'badge-status-inativo',
  Suspenso: 'badge-status-suspenso',
};

let assinaturasAtuais = [];

function renderLinha(a) {
  const statusClasse = STATUS_CLASSES[a.status_conta] || 'badge-status-inativo';
  return `
    <tr>
      <td>${escapeHtml(a.nome)}</td>
      <td>${escapeHtml(a.plano_nome)}</td>
      <td>${formatarMoeda(a.valor_plano)}</td>
      <td><span class="badge badge-status ${statusClasse}">${escapeHtml(a.status_conta)}</span></td>
      <td>${a.proxima_cobranca ? `${formatarData(a.proxima_cobranca.data)} · ${formatarMoeda(a.proxima_cobranca.valor)}` : '—'}</td>
      <td><a class="btn-ver-detalhes" href="/tenants/${encodeURIComponent(a.id)}">Ver tenant</a></td>
    </tr>
  `;
}

function renderLista(termo) {
  const filtradas = termo
    ? assinaturasAtuais.filter((a) => a.nome.toLowerCase().includes(termo.toLowerCase()))
    : assinaturasAtuais;

  const tabelaHtml = filtradas.length
    ? `
      <div class="tabela-wrapper">
        <table class="tabela-tenants">
          <thead><tr><th>Tenant</th><th>Plano</th><th>Valor</th><th>Status</th><th>Próxima cobrança</th><th>Ações</th></tr></thead>
          <tbody>${filtradas.map(renderLinha).join('')}</tbody>
        </table>
      </div>
    `
    : `<div class="vazio">Nenhuma assinatura encontrada${termo ? ` para '${escapeHtml(termo)}'` : ''}.</div>`;

  document.getElementById('assinaturas-lista').innerHTML = tabelaHtml;
}

async function renderAssinaturas() {
  conteudo.innerHTML = '<div class="vazio">Carregando...</div>';

  const data = await api('/api/assinaturas');
  if (!data) return;

  assinaturasAtuais = data.assinaturas || [];

  // Suporta abrir com ?busca=<nome> — usado pelo link "Gerenciar assinatura"
  // do menu "•••" da tela de Tenants, pra já cair filtrado na linha certa.
  const buscaInicial = new URLSearchParams(window.location.search).get('busca') || '';

  conteudo.innerHTML = `
    <div class="inicio-cabecalho">
      <div>
        <h2>Assinaturas</h2>
        <p class="financeiro-subtitulo">Plano, valor e próxima cobrança por tenant.</p>
      </div>
    </div>
    <div class="clientes-filtros">
      <input type="search" id="busca-assinaturas" placeholder="Buscar por tenant..." value="${escapeHtml(buscaInicial)}">
    </div>
    <div id="assinaturas-lista"></div>
  `;

  renderLista(buscaInicial);

  let debounce = null;
  document.getElementById('busca-assinaturas').addEventListener('input', (e) => {
    clearTimeout(debounce);
    const valor = e.target.value;
    debounce = setTimeout(() => renderLista(valor), 300);
  });
}

renderAssinaturas();
