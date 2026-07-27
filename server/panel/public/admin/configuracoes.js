// Página de Configurações da área admin da Kyvvo (US38) — preços dos planos
// e configurações gerais do sistema, antes hardcoded no código, agora
// editáveis aqui sem precisar de deploy. Consome GET/PATCH
// /admin/api/configuracoes*.

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
function escapeHtml(valor) {
  return String(valor ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[c]));
}

function formatarPreco(preco) {
  return preco != null ? `R$ ${Number(preco).toFixed(2).replace('.', ',')}` : '—';
}

function formatarDataHora(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  const data = d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const hora = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  return `${data} ${hora}`;
}

// CA06 — rótulos de exibição das configurações gerais (chave vem do banco,
// ver migration 029_configuracoes_sistema.sql).
const CONFIG_SISTEMA_LABELS = {
  trial_dias: 'Dias de trial',
  carencia_dias_inadimplencia: 'Dias de carência após inadimplência',
  max_tentativas_reenvio_token: 'Máximo de tentativas de reenvio de token',
  email_suporte: 'E-mail de suporte exibido no portal',
  whatsapp_suporte: 'WhatsApp de suporte',
};
const CONFIG_SISTEMA_NUMERICAS = new Set(['trial_dias', 'carencia_dias_inadimplencia', 'max_tentativas_reenvio_token']);
const CONFIG_SISTEMA_ORDEM = ['trial_dias', 'carencia_dias_inadimplencia', 'max_tentativas_reenvio_token', 'email_suporte', 'whatsapp_suporte'];

let dados = null;
// Chaves de plano/configuração atualmente em modo de edição — controla tanto
// os inputs renderizados quanto o banner de aviso (CA04, só enquanto há
// algum campo de preço em edição).
const planosEmEdicao = new Set();
const sistemaEmEdicao = new Set();

async function carregar() {
  conteudo.innerHTML = '<div class="vazio">Carregando...</div>';
  dados = await api('/admin/api/configuracoes');
  if (!dados) return;
  render();
}

function render() {
  const html = `
    <h2 class="titulo-detalhe">Configurações do sistema</h2>
    ${planosEmEdicao.size > 0 ? `
      <div class="banner-aviso">
        ⚠️ Atenção: alterações de preço afetam apenas novas assinaturas. Clientes com assinaturas ativas continuarão pagando o valor original.
      </div>
    ` : ''}
    <section class="secao-detalhe">
      <h3>Preços dos planos</h3>
      <div class="tabela-wrapper">
        <table class="tabela-tenants">
          <thead>
            <tr><th>Plano</th><th>Descrição</th><th>Preço mensal</th><th>Limite de disparos</th><th>Ativo</th><th></th></tr>
          </thead>
          <tbody>${dados.planos.map(renderLinhaPlano).join('')}</tbody>
        </table>
      </div>
    </section>
    <section class="secao-detalhe">
      <h3>Configurações gerais</h3>
      <div class="tabela-wrapper">
        <table class="tabela-tenants">
          <thead><tr><th>Configuração</th><th>Valor</th><th></th></tr></thead>
          <tbody>${CONFIG_SISTEMA_ORDEM.map(renderLinhaSistema).join('')}</tbody>
        </table>
      </div>
    </section>
    <section class="secao-detalhe">
      <h3>Log de auditoria — últimas ${dados.log.length}</h3>
      <div class="tabela-wrapper">
        <table class="tabela-tenants">
          <thead><tr><th>Campo</th><th>Valor anterior</th><th>Valor novo</th><th>Alterado por</th><th>Data</th></tr></thead>
          <tbody>
            ${dados.log.length ? dados.log.map((l) => `
              <tr>
                <td>${escapeHtml(l.campo)}</td>
                <td>${escapeHtml(l.valor_anterior ?? '—')}</td>
                <td>${escapeHtml(l.valor_novo ?? '—')}</td>
                <td>${escapeHtml(l.alterado_por_nome || '—')}</td>
                <td>${formatarDataHora(l.alterado_em)}</td>
              </tr>
            `).join('') : '<tr><td colspan="5">Nenhuma alteração registrada ainda.</td></tr>'}
          </tbody>
        </table>
      </div>
    </section>
  `;
  conteudo.innerHTML = html;
  wireEventos();
}

function renderLinhaPlano(plano) {
  const editando = planosEmEdicao.has(plano.chave);
  const toggleClasse = plano.ativo ? 'toggle-on' : 'toggle-off';

  if (editando) {
    return `
      <tr data-plano="${plano.chave}">
        <td>${escapeHtml(plano.nome)}</td>
        <td><input type="text" class="input-plano-descricao" value="${escapeHtml(plano.descricao || '')}"></td>
        <td><input type="number" step="0.01" min="1" class="input-plano-preco" value="${plano.preco_mensal}"></td>
        <td><input type="number" step="1" min="0" class="input-plano-limite" value="${plano.limite_disparos ?? ''}" placeholder="ilimitado"></td>
        <td><span class="toggle-readonly toggle-clicavel ${toggleClasse}" data-acao="toggle-ativo-plano" data-chave="${plano.chave}"></span></td>
        <td class="celula-acoes-plano">
          <div class="modal-erro" data-erro-plano="${plano.chave}"></div>
          <button class="btn-secundario btn-tabela" data-acao="cancelar-plano" data-chave="${plano.chave}">Cancelar</button>
          <button class="btn-primario btn-tabela" data-acao="salvar-plano" data-chave="${plano.chave}">Salvar</button>
        </td>
      </tr>
    `;
  }

  return `
    <tr data-plano="${plano.chave}">
      <td>${escapeHtml(plano.nome)}</td>
      <td>${escapeHtml(plano.descricao || '—')}</td>
      <td>${formatarPreco(plano.preco_mensal)}</td>
      <td>${plano.limite_disparos != null ? plano.limite_disparos : 'Ilimitado'}</td>
      <td><span class="toggle-readonly toggle-clicavel ${toggleClasse}" data-acao="toggle-ativo-plano" data-chave="${plano.chave}"></span></td>
      <td class="celula-acoes-plano">
        <button class="btn-secundario btn-tabela" data-acao="editar-plano" data-chave="${plano.chave}">Editar</button>
      </td>
    </tr>
  `;
}

function renderLinhaSistema(chave) {
  const editando = sistemaEmEdicao.has(chave);
  const valorAtual = dados.sistema[chave] ?? '';
  const tipoInput = CONFIG_SISTEMA_NUMERICAS.has(chave) ? 'number' : chave === 'email_suporte' ? 'email' : 'text';

  if (editando) {
    return `
      <tr data-config="${chave}">
        <td>${escapeHtml(CONFIG_SISTEMA_LABELS[chave] || chave)}</td>
        <td>
          <input type="${tipoInput}" class="input-config-valor" ${tipoInput === 'number' ? 'min="1" step="1"' : ''} value="${escapeHtml(valorAtual)}">
          <div class="modal-erro" data-erro-config="${chave}"></div>
        </td>
        <td class="celula-acoes-plano">
          <button class="btn-secundario btn-tabela" data-acao="cancelar-config" data-chave="${chave}">Cancelar</button>
          <button class="btn-primario btn-tabela" data-acao="salvar-config" data-chave="${chave}">Salvar</button>
        </td>
      </tr>
    `;
  }

  return `
    <tr data-config="${chave}">
      <td>${escapeHtml(CONFIG_SISTEMA_LABELS[chave] || chave)}</td>
      <td>${escapeHtml(valorAtual)}</td>
      <td class="celula-acoes-plano">
        <button class="btn-secundario btn-tabela" data-acao="editar-config" data-chave="${chave}">Editar</button>
      </td>
    </tr>
  `;
}

function wireEventos() {
  conteudo.querySelectorAll('[data-acao="editar-plano"]').forEach((btn) => {
    btn.addEventListener('click', () => { planosEmEdicao.add(btn.dataset.chave); render(); });
  });
  conteudo.querySelectorAll('[data-acao="cancelar-plano"]').forEach((btn) => {
    btn.addEventListener('click', () => { planosEmEdicao.delete(btn.dataset.chave); render(); });
  });
  conteudo.querySelectorAll('[data-acao="salvar-plano"]').forEach((btn) => {
    btn.addEventListener('click', () => salvarPlano(btn.dataset.chave));
  });
  conteudo.querySelectorAll('[data-acao="toggle-ativo-plano"]').forEach((toggle) => {
    toggle.addEventListener('click', () => alternarAtivoPlano(toggle.dataset.chave));
  });

  conteudo.querySelectorAll('[data-acao="editar-config"]').forEach((btn) => {
    btn.addEventListener('click', () => { sistemaEmEdicao.add(btn.dataset.chave); render(); });
  });
  conteudo.querySelectorAll('[data-acao="cancelar-config"]').forEach((btn) => {
    btn.addEventListener('click', () => { sistemaEmEdicao.delete(btn.dataset.chave); render(); });
  });
  conteudo.querySelectorAll('[data-acao="salvar-config"]').forEach((btn) => {
    btn.addEventListener('click', () => salvarConfigSistema(btn.dataset.chave));
  });
}

async function salvarPlano(chave) {
  const linha = conteudo.querySelector(`tr[data-plano="${chave}"]`);
  const descricao = linha.querySelector('.input-plano-descricao').value.trim();
  const precoMensal = linha.querySelector('.input-plano-preco').value;
  const limiteBruto = linha.querySelector('.input-plano-limite').value.trim();
  const erroEl = linha.querySelector(`[data-erro-plano="${chave}"]`);
  erroEl.textContent = '';

  if (!(Number(precoMensal) >= 1)) {
    erroEl.textContent = 'Preço mensal deve ser no mínimo R$ 1,00.';
    return;
  }

  const resultado = await api(`/admin/api/configuracoes/planos/${chave}`, {
    method: 'PATCH',
    body: JSON.stringify({
      descricao,
      preco_mensal: Number(precoMensal),
      limite_disparos: limiteBruto === '' ? null : Number(limiteBruto),
    }),
  });

  if (resultado && !resultado.error) {
    planosEmEdicao.delete(chave);
    mostrarToast('Preço atualizado. Novas assinaturas serão cobradas com o novo valor.', 'sucesso');
    await carregar();
  } else {
    erroEl.textContent = (resultado && resultado.error) || 'Erro ao salvar plano.';
  }
}

async function alternarAtivoPlano(chave) {
  const plano = dados.planos.find((p) => p.chave === chave);
  const resultado = await api(`/admin/api/configuracoes/planos/${chave}`, {
    method: 'PATCH',
    body: JSON.stringify({ ativo: !plano.ativo }),
  });

  if (resultado && !resultado.error) {
    mostrarToast(`Plano ${resultado.ativo ? 'ativado' : 'desativado'} com sucesso.`, 'sucesso');
    await carregar();
  } else {
    mostrarToast((resultado && resultado.error) || 'Erro ao atualizar plano.', 'erro');
  }
}

async function salvarConfigSistema(chave) {
  const linha = conteudo.querySelector(`tr[data-config="${chave}"]`);
  const valor = linha.querySelector('.input-config-valor').value.trim();
  const erroEl = linha.querySelector(`[data-erro-config="${chave}"]`);
  erroEl.textContent = '';

  if (CONFIG_SISTEMA_NUMERICAS.has(chave) && !(Number.isInteger(Number(valor)) && Number(valor) > 0)) {
    erroEl.textContent = 'Deve ser um número inteiro maior que zero.';
    return;
  }
  if (chave === 'email_suporte' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(valor)) {
    erroEl.textContent = 'Informe um e-mail válido.';
    return;
  }

  const resultado = await api('/admin/api/configuracoes/sistema', {
    method: 'PATCH',
    body: JSON.stringify({ [chave]: valor }),
  });

  if (resultado && !resultado.error) {
    sistemaEmEdicao.delete(chave);
    mostrarToast('Configuração atualizada com sucesso.', 'sucesso');
    await carregar();
  } else {
    erroEl.textContent = (resultado && resultado.error) || 'Erro ao salvar configuração.';
  }
}

// ---------- Toast (duplicado intencionalmente, ver comentário acima) ----------
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

carregar();
