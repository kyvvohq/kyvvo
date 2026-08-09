// Página de Configurações da área admin da Kyvvo (US38) — preços dos planos
// e configurações gerais do sistema, antes hardcoded no código, agora
// editáveis aqui sem precisar de deploy. Consome GET/PATCH
// /api/configuracoes*.

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

function formatarPreco(preco) {
  return preco != null ? `R$ ${Number(preco).toFixed(2).replace('.', ',')}` : '—';
}

// US67/CA04 — rótulos de exibição dos eixos estruturais da grade 2x2
// (somente leitura no admin, ver renderLinhaPlano).
const TECNOLOGIA_LABELS = { bot: 'Bot', ia: 'IA' };
const TIPO_NUMERO_LABELS = { proprio: 'Número próprio', kyvvo: 'Número Kyvvo' };

// US74 — chaves/rótulos dos 3 limites de uso editáveis por plano (CA01: só
// essas 3 são aceitas pelo backend).
const PLANO_LIMITE_CHAVES = ['conversas_mes', 'profissionais', 'unidades'];
const PLANO_LIMITE_ROTULOS = { conversas_mes: 'Conversas/mês', profissionais: 'Profissionais', unidades: 'Unidades' };

function formatarLimiteAdmin(valor) {
  return valor == null ? 'Ilimitado' : String(valor);
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
  dados = await api('/api/configuracoes');
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
            <tr>
              <th>Plano</th><th>Descrição</th><th>Headline (diferencial)</th><th>Frase de benefício</th><th>Diferenciais (até 3)</th><th>Limites de uso</th><th>Slug</th><th>Tecnologia</th><th>Tipo número</th>
              <th>Preço mensal</th><th>Limite de disparos</th><th>Destaque</th><th>Badge</th><th>Ativo</th><th></th>
            </tr>
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
  const toggleAtivoClasse = plano.ativo ? 'toggle-on' : 'toggle-off';
  const toggleDestaqueClasse = plano.destaque ? 'toggle-on' : 'toggle-off';
  // Slug/Tecnologia/Tipo número são identificadores estruturais da grade
  // 2x2 — somente leitura em qualquer modo (US67/CA04).
  const colunasSomenteLeitura = `
    <td data-testid="slug-${plano.chave}">${escapeHtml(plano.slug || plano.chave)}</td>
    <td>${escapeHtml(TECNOLOGIA_LABELS[plano.tecnologia] || plano.tecnologia || '—')}</td>
    <td>${escapeHtml(TIPO_NUMERO_LABELS[plano.tipo_numero] || plano.tipo_numero || '—')}</td>
  `;

  // US74/CA05 — 3 campos fixos (não uma lista dinâmica) já garantem o
  // máximo de 3 diferenciais por plano sem precisar de validação extra de
  // UI; slot vazio simplesmente não é salvo (ver salvarPlano).
  const features = plano.features || [];
  const limites = plano.limites || {};

  if (editando) {
    const camposFeatures = [0, 1, 2].map((i) => `
      <input type="text" class="input-plano-feature" data-testid="input-feature-${i + 1}-${plano.chave}"
             value="${escapeHtml(features[i] ? features[i].label : '')}" placeholder="Diferencial ${i + 1}">
    `).join('');
    const camposLimites = PLANO_LIMITE_CHAVES.map((chaveLimite) => `
      <div class="limite-editor-linha">
        <input type="number" min="0" class="input-plano-limite-${chaveLimite}" data-testid="input-limite-${chaveLimite}-${plano.chave}"
               value="${limites[chaveLimite] ?? ''}" placeholder="ilimitado">
        <label>${PLANO_LIMITE_ROTULOS[chaveLimite]}</label>
      </div>
    `).join('');

    return `
      <tr data-plano="${plano.chave}">
        <td><input type="text" class="input-plano-nome" data-testid="input-nome-${plano.chave}" value="${escapeHtml(plano.nome)}"></td>
        <td><input type="text" class="input-plano-descricao" value="${escapeHtml(plano.descricao || '')}"></td>
        <td>
          <input type="text" class="input-plano-headline" data-testid="input-headline-${plano.chave}" value="${escapeHtml(plano.headline_diferencial || '')}">
          <div class="contador-caracteres" data-contador="headline-${plano.chave}"></div>
        </td>
        <td>
          <input type="text" class="input-plano-frase" data-testid="input-frase-${plano.chave}" value="${escapeHtml(plano.frase_beneficio || '')}">
          <div class="contador-caracteres" data-contador="frase-${plano.chave}"></div>
        </td>
        <td class="celula-features-plano">${camposFeatures}</td>
        <td class="celula-limites-plano">${camposLimites}</td>
        ${colunasSomenteLeitura}
        <td><input type="number" step="0.01" min="1" class="input-plano-preco" value="${plano.preco_mensal}"></td>
        <td><input type="number" step="1" min="0" class="input-plano-limite" value="${plano.limite_disparos ?? ''}" placeholder="ilimitado"></td>
        <td><span class="toggle-readonly toggle-clicavel ${toggleDestaqueClasse}" data-acao="toggle-destaque-plano" data-chave="${plano.chave}"></span></td>
        <td><input type="text" class="input-plano-badge" value="${escapeHtml(plano.badge || '')}" placeholder="ex: Mais popular"></td>
        <td><span class="toggle-readonly toggle-clicavel ${toggleAtivoClasse}" data-acao="toggle-ativo-plano" data-chave="${plano.chave}"></span></td>
        <td class="celula-acoes-plano">
          <div class="modal-erro" data-erro-plano="${plano.chave}"></div>
          <button class="btn-secundario btn-tabela" data-acao="cancelar-plano" data-chave="${plano.chave}">Cancelar</button>
          <button class="btn-primario btn-tabela" data-testid="salvar-${plano.chave}" data-acao="salvar-plano" data-chave="${plano.chave}">Salvar</button>
        </td>
      </tr>
    `;
  }

  return `
    <tr data-plano="${plano.chave}">
      <td>${escapeHtml(plano.nome)}</td>
      <td>${escapeHtml(plano.descricao || '—')}</td>
      <td>${escapeHtml(plano.headline_diferencial || '—')}</td>
      <td>${escapeHtml(plano.frase_beneficio || '—')}</td>
      <td>${features.length ? `<ul class="lista-features-plano">${features.map((f) => `<li>${escapeHtml(f.label)}</li>`).join('')}</ul>` : '—'}</td>
      <td>${PLANO_LIMITE_CHAVES.map((k) => `${PLANO_LIMITE_ROTULOS[k]}: ${formatarLimiteAdmin(limites[k])}`).join('<br>')}</td>
      ${colunasSomenteLeitura}
      <td>${formatarPreco(plano.preco_mensal)}</td>
      <td>${plano.limite_disparos != null ? plano.limite_disparos : 'Ilimitado'}</td>
      <td><span class="toggle-readonly toggle-clicavel ${toggleDestaqueClasse}" data-acao="toggle-destaque-plano" data-chave="${plano.chave}"></span></td>
      <td>${escapeHtml(plano.badge || '—')}</td>
      <td><span class="toggle-readonly toggle-clicavel ${toggleAtivoClasse}" data-acao="toggle-ativo-plano" data-chave="${plano.chave}"></span></td>
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
  // US73/CA04 — contador de caracteres + bloqueio do Salvar em tempo real
  // (não só no submit) quando headline/frase passam de 120 caracteres.
  conteudo.querySelectorAll('tr[data-plano] .input-plano-headline, tr[data-plano] .input-plano-frase').forEach((input) => {
    const chave = input.closest('tr').dataset.plano;
    input.addEventListener('input', () => validarLimitesCopyPlano(chave));
    validarLimitesCopyPlano(chave);
  });
  conteudo.querySelectorAll('[data-acao="toggle-ativo-plano"]').forEach((toggle) => {
    toggle.addEventListener('click', () => alternarAtivoPlano(toggle.dataset.chave));
  });
  conteudo.querySelectorAll('[data-acao="toggle-destaque-plano"]').forEach((toggle) => {
    toggle.addEventListener('click', () => alternarDestaquePlano(toggle.dataset.chave));
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

// US73/CA04 — contador + bloqueio de Salvar quando headline/frase passam de
// 120 (mesmo limite do CHECK da migration 048); não mexe no texto do erro se
// ele veio de outra validação (preço, erro do backend).
function validarLimitesCopyPlano(chave) {
  const linha = conteudo.querySelector(`tr[data-plano="${chave}"]`);
  if (!linha) return;
  const headline = linha.querySelector('.input-plano-headline');
  const frase = linha.querySelector('.input-plano-frase');
  if (!headline || !frase) return;
  const erroEl = linha.querySelector(`[data-erro-plano="${chave}"]`);
  const salvarBtn = linha.querySelector('[data-acao="salvar-plano"]');
  const contadorHeadline = linha.querySelector(`[data-contador="headline-${chave}"]`);
  const contadorFrase = linha.querySelector(`[data-contador="frase-${chave}"]`);
  if (contadorHeadline) contadorHeadline.textContent = `${headline.value.length}/120`;
  if (contadorFrase) contadorFrase.textContent = `${frase.value.length}/120`;

  const acimaDoLimite = headline.value.length > 120 || frase.value.length > 120;
  if (acimaDoLimite) {
    erroEl.textContent = 'Headline e frase de benefício têm o máximo de 120 caracteres.';
    salvarBtn.disabled = true;
  } else if (erroEl.textContent.startsWith('Headline e frase')) {
    erroEl.textContent = '';
    salvarBtn.disabled = false;
  }
}

async function salvarPlano(chave) {
  const linha = conteudo.querySelector(`tr[data-plano="${chave}"]`);
  const nome = linha.querySelector('.input-plano-nome').value.trim();
  const descricao = linha.querySelector('.input-plano-descricao').value.trim();
  const headlineDiferencial = linha.querySelector('.input-plano-headline').value.trim();
  const fraseBeneficio = linha.querySelector('.input-plano-frase').value.trim();
  const precoMensal = linha.querySelector('.input-plano-preco').value;
  const limiteBruto = linha.querySelector('.input-plano-limite').value.trim();
  const badge = linha.querySelector('.input-plano-badge').value.trim();
  // US74/CA05 — slots vazios não viram feature; os 3 campos fixos garantem o
  // máximo de 3.
  const features = Array.from(linha.querySelectorAll('.input-plano-feature'))
    .map((input) => input.value.trim())
    .filter(Boolean);
  const limites = Object.fromEntries(
    PLANO_LIMITE_CHAVES.map((chaveLimite) => {
      const valorBruto = linha.querySelector(`.input-plano-limite-${chaveLimite}`).value.trim();
      return [chaveLimite, valorBruto === '' ? null : Number(valorBruto)];
    })
  );
  const erroEl = linha.querySelector(`[data-erro-plano="${chave}"]`);
  erroEl.textContent = '';

  // US72/CA04 — nome editável, mas o slug (identificador público usado em
  // links) nunca é enviado aqui — continua estrutural, só muda por migration.
  if (!nome) {
    erroEl.textContent = 'Nome do plano não pode ficar em branco.';
    return;
  }
  if (headlineDiferencial.length > 120 || fraseBeneficio.length > 120) {
    erroEl.textContent = 'Headline e frase de benefício têm o máximo de 120 caracteres.';
    return;
  }
  if (!(Number(precoMensal) >= 1)) {
    erroEl.textContent = 'Preço mensal deve ser no mínimo R$ 1,00.';
    return;
  }

  const resultado = await api(`/api/configuracoes/planos/${chave}`, {
    method: 'PATCH',
    body: JSON.stringify({
      nome,
      descricao,
      headline_diferencial: headlineDiferencial,
      frase_beneficio: fraseBeneficio,
      preco_mensal: Number(precoMensal),
      limite_disparos: limiteBruto === '' ? null : Number(limiteBruto),
      badge: badge === '' ? null : badge,
      features,
      limites,
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
  const resultado = await api(`/api/configuracoes/planos/${chave}`, {
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

async function alternarDestaquePlano(chave) {
  const plano = dados.planos.find((p) => p.chave === chave);
  const resultado = await api(`/api/configuracoes/planos/${chave}`, {
    method: 'PATCH',
    body: JSON.stringify({ destaque: !plano.destaque }),
  });

  if (resultado && !resultado.error) {
    mostrarToast(`Destaque ${resultado.destaque ? 'ativado' : 'desativado'} com sucesso.`, 'sucesso');
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

  const resultado = await api('/api/configuracoes/sistema', {
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
