// Dashboard admin (área "Visão geral") — visão geral rápida da plataforma:
// os mesmos 4 cards de estatística da tela de Tenants (GET
// /api/tenants/resumo) e os 5 tenants mais recentes, com atalho pra lista
// completa. Sem edição — é só visão + atalho.

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
function escapeHtml(valor) {
  return String(valor ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[c]));
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

function renderLinhaRecente(t) {
  const statusClasse = STATUS_CLASSES[t.status_conta] || 'badge-status-inativo';
  return `
    <tr>
      <td>${escapeHtml(t.nome)}</td>
      <td>${formatarData(t.criado_em)}</td>
      <td><span class="badge badge-status ${statusClasse}">${escapeHtml(t.status_conta)}</span></td>
      <td><a class="btn-ver-detalhes" href="/painel.html">Ver na lista</a></td>
    </tr>
  `;
}

async function renderDashboard() {
  conteudo.innerHTML = '<div class="vazio">Carregando...</div>';

  const [resumo, listagem] = await Promise.all([
    api('/api/tenants/resumo'),
    api('/api/tenants?page=1&limit=5&order_by=cadastrado_em&order_dir=desc'),
  ]);
  if (!resumo || !listagem) return;

  const recentes = listagem.tenants || [];

  conteudo.innerHTML = `
    <div class="inicio-cabecalho">
      <div>
        <h2>Dashboard</h2>
        <p class="financeiro-subtitulo">Visão geral da plataforma.</p>
      </div>
    </div>
    ${renderCardsResumo(resumo)}
    <div class="inicio-secao">
      <div class="nav-periodo">
        <strong>Tenants recentes</strong>
        <a class="topbar-nav-link" href="/painel.html">Ver todos → Tenants</a>
      </div>
      ${
        recentes.length
          ? `
        <div class="tabela-wrapper">
          <table class="tabela-tenants">
            <thead><tr><th>Tenant</th><th>Cadastrado em</th><th>Status</th><th>Ações</th></tr></thead>
            <tbody>${recentes.map(renderLinhaRecente).join('')}</tbody>
          </table>
        </div>
      `
          : '<div class="vazio">Nenhum tenant cadastrado ainda.</div>'
      }
    </div>
  `;
}

renderDashboard();
