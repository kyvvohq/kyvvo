// Página de status do WhatsApp na área admin — mostra se a API oficial da
// Meta (Cloud API) está conectada de verdade (token + phone_number_id com
// permissão), sem precisar entrar no painel da Meta ou no servidor pra
// diagnosticar. Consome GET /admin/api/whatsapp/status, que chama a Graph
// API da Meta ao vivo com as credenciais configuradas no ambiente.

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

function formatarDataHora(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  const data = d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const hora = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  return `${data} ${hora}`;
}

let carregando = false;

async function carregar() {
  if (carregando) return;
  carregando = true;
  conteudo.innerHTML = '<div class="vazio">Verificando conexão com a Meta...</div>';
  const dados = await api('/admin/api/whatsapp/status');
  carregando = false;
  if (!dados) return;
  render(dados);
}

function render(dados) {
  const { meta, verificadoEm } = dados;

  let metaCardClasse = 'status-card-inativo';
  let metaLinha2 = 'Não configurado';
  let metaLinha3 = 'META_WHATSAPP_TOKEN / META_PHONE_NUMBER_ID não definidos no ambiente.';

  if (meta.configurado && meta.conectado) {
    metaCardClasse = 'status-card-ativo';
    metaLinha2 = meta.numeroExibido || 'Conectado';
    metaLinha3 = [meta.nomeVerificado, meta.qualidade ? `Qualidade: ${meta.qualidade}` : null].filter(Boolean).join(' · ') || 'Sem detalhes adicionais.';
  } else if (meta.configurado && !meta.conectado) {
    metaCardClasse = 'status-card-pendente';
    metaLinha2 = 'Erro de conexão';
    metaLinha3 = meta.erro || 'A Meta não confirmou o token/número.';
  }

  const html = `
    <h2 class="titulo-detalhe">Status do WhatsApp</h2>
    <section class="secao-detalhe">
      <h3>API oficial da Meta (Cloud API)</h3>
      <div class="financeiro-resumo" style="grid-template-columns: 1fr;">
        <div class="financeiro-resumo-card financeiro-resumo-card-3linhas ${metaCardClasse}">
          <div class="financeiro-resumo-label">${meta.configurado ? 'Meta WhatsApp Business API' : 'Meta WhatsApp Business API — não configurado'}</div>
          <div class="financeiro-resumo-linha2">${escapeHtml(metaLinha2)}</div>
          <div class="financeiro-resumo-linha3">${escapeHtml(metaLinha3)}</div>
        </div>
      </div>
      ${meta.phoneNumberId ? `<p>Phone Number ID: <strong>${escapeHtml(meta.phoneNumberId)}</strong></p>` : ''}
      <p class="vazio-inline">Última verificação: ${formatarDataHora(verificadoEm)}</p>
      <button class="btn-primario btn-tabela" id="btn-atualizar" style="margin-top: 12px;">🔄 Verificar novamente</button>
    </section>
  `;
  conteudo.innerHTML = html;
  document.getElementById('btn-atualizar').addEventListener('click', carregar);
}

carregar();
