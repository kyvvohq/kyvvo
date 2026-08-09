// Dashboard de consumo da IA (US68) — volume de mensagens/conversas por
// tenant e custo real estimado em R$, calculado a partir dos tokens
// capturados em cada turno do assistente. Consome GET /api/ia-uso.
// Custo é uma ESTIMATIVA: usa o preço oficial do Claude Haiku 4.5
// (US$1/US$5 por milhão de tokens de entrada/saída) e uma cotação USD→BRL
// fixa definida no servidor — não é uma cotação ao vivo.

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

function formatarReais(valor) {
  return Number(valor || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatarNumero(valor) {
  return Number(valor || 0).toLocaleString('pt-BR');
}

function formatarDia(iso) {
  const [ano, mes, dia] = iso.split('-');
  return `${dia}/${mes}`;
}

let diasSelecionado = 30;
let carregando = false;

async function carregar() {
  if (carregando) return;
  carregando = true;
  conteudo.innerHTML = '<div class="vazio">Carregando consumo da IA...</div>';
  const dados = await api(`/api/ia-uso?dias=${diasSelecionado}`);
  carregando = false;
  if (!dados) return;
  render(dados);
}

function render(dados) {
  const { resumo, porDia, porTenant, porIntent } = dados;

  const html = `
    <h2 class="titulo-detalhe">IA — Consumo</h2>
    <p class="vazio-inline">Volume de conversas e custo estimado do motor de IA (Claude Haiku 4.5) no WhatsApp, por período.</p>

    <div class="secao-detalhe" style="margin-bottom: 16px;">
      <label>Período
        <select id="select-periodo" style="margin-left: 8px;">
          <option value="7" ${diasSelecionado === 7 ? 'selected' : ''}>Últimos 7 dias</option>
          <option value="30" ${diasSelecionado === 30 ? 'selected' : ''}>Últimos 30 dias</option>
          <option value="90" ${diasSelecionado === 90 ? 'selected' : ''}>Últimos 90 dias</option>
        </select>
      </label>
    </div>

    <div class="financeiro-resumo" style="grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));">
      <div class="financeiro-resumo-card">
        <div class="financeiro-resumo-label">Mensagens da IA</div>
        <div class="financeiro-resumo-linha2">${formatarNumero(resumo.totalMensagens)}</div>
      </div>
      <div class="financeiro-resumo-card">
        <div class="financeiro-resumo-label">Salões ativos na IA</div>
        <div class="financeiro-resumo-linha2">${formatarNumero(resumo.tenantsAtivos)}</div>
      </div>
      <div class="financeiro-resumo-card">
        <div class="financeiro-resumo-label">Custo estimado</div>
        <div class="financeiro-resumo-linha2">${formatarReais(resumo.custoReaisTotal)}</div>
        <div class="financeiro-resumo-linha3">${formatarNumero(resumo.tokensEntrada)} tok. entrada · ${formatarNumero(resumo.tokensSaida)} tok. saída</div>
      </div>
      <div class="financeiro-resumo-card">
        <div class="financeiro-resumo-label">Taxa de fallback humano</div>
        <div class="financeiro-resumo-linha2">${resumo.taxaFallbackHumano}%</div>
      </div>
    </div>

    <section class="secao-detalhe">
      <h3>Por salão</h3>
      <div class="tabela-wrapper">
        <table class="tabela-tenants">
          <thead>
            <tr>
              <th>Salão</th><th>Mensagens</th><th>Conversas</th><th>Tokens (entrada/saída)</th><th>Custo estimado</th><th>Fallback humano</th>
            </tr>
          </thead>
          <tbody>
            ${porTenant.length ? porTenant.map(renderLinhaTenant).join('') : '<tr><td colspan="6">Nenhuma conversa de IA no período.</td></tr>'}
          </tbody>
        </table>
      </div>
    </section>

    <section class="secao-detalhe">
      <h3>Intenções identificadas pela IA</h3>
      ${porIntent.length ? `
        <div class="tabela-wrapper">
          <table class="tabela-tenants">
            <thead><tr><th>Intenção</th><th>Quantidade</th></tr></thead>
            <tbody>${porIntent.map((i) => `<tr><td>${escapeHtml(i.intent)}</td><td>${formatarNumero(i.quantidade)}</td></tr>`).join('')}</tbody>
          </table>
        </div>
      ` : '<p class="vazio-inline">Nenhuma conversa de IA no período.</p>'}
    </section>

    <section class="secao-detalhe">
      <h3>Por dia</h3>
      ${porDia.length ? `
        <div class="tabela-wrapper">
          <table class="tabela-tenants">
            <thead><tr><th>Dia</th><th>Mensagens</th><th>Custo estimado</th></tr></thead>
            <tbody>${porDia.slice().reverse().map((d) => `<tr><td>${formatarDia(d.dia)}</td><td>${formatarNumero(d.mensagens)}</td><td>${formatarReais(d.custoReais)}</td></tr>`).join('')}</tbody>
          </table>
        </div>
      ` : '<p class="vazio-inline">Nenhuma conversa de IA no período.</p>'}
    </section>
  `;
  conteudo.innerHTML = html;
  document.getElementById('select-periodo').addEventListener('change', (e) => {
    diasSelecionado = Number(e.target.value);
    carregar();
  });
}

function renderLinhaTenant(t) {
  return `
    <tr>
      <td>${escapeHtml(t.tenantNome)}</td>
      <td>${formatarNumero(t.mensagens)}</td>
      <td>${formatarNumero(t.conversas)}</td>
      <td>${formatarNumero(t.tokensEntrada)} / ${formatarNumero(t.tokensSaida)}</td>
      <td>${formatarReais(t.custoReais)}</td>
      <td>${t.taxaFallbackHumano}%</td>
    </tr>
  `;
}

carregar();
