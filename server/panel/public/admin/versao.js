// Página de Versão da área admin (US56) — mostra separadamente a versão do
// front (window.KYVVO_FRONT_VERSION, definida em admin/version.js, gravada
// no HTML/JS que o navegador já carregou) e a versão do back (GET
// /admin/api/versao, consultada ao vivo no servidor a cada carregamento).
// As duas costumam bater; quando divergem, é sinal de JS em cache
// desatualizado no navegador (mesmo tipo de problema que motivou esta
// página) — resolvido com um hard refresh.

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

function formatarDataHora(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  const data = d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const hora = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  return `${data} ${hora}`;
}

async function carregar() {
  conteudo.innerHTML = '<div class="vazio">Carregando...</div>';

  const frontCommit = window.KYVVO_FRONT_VERSION && window.KYVVO_FRONT_VERSION !== '__COMMIT_SHA__'
    ? window.KYVVO_FRONT_VERSION
    : null;
  const back = await api('/admin/api/versao');
  if (!back) return;

  const divergem = frontCommit && back.commit && frontCommit !== back.commit;

  conteudo.innerHTML = `
    <h2 class="titulo-detalhe">Versão em execução</h2>
    ${divergem ? `
      <div class="banner-aviso">
        ⚠️ O front (o que esta aba tem carregado) e o back (o que está rodando agora no servidor) estão em commits diferentes — provavelmente esta aba está com JS em cache. Dê um hard refresh (Ctrl+Shift+R) pra atualizar.
      </div>
    ` : ''}
    <section class="secao-detalhe">
      <h3>Front — o que esta aba carregou</h3>
      <div class="tabela-wrapper">
        <table class="tabela-tenants">
          <tbody>
            <tr><td>Commit</td><td>${frontCommit ? `<code>${frontCommit}</code>` : 'não implantado via pipeline (ambiente local)'}</td></tr>
          </tbody>
        </table>
      </div>
    </section>
    <section class="secao-detalhe">
      <h3>Back — o que está rodando agora no servidor</h3>
      <div class="tabela-wrapper">
        <table class="tabela-tenants">
          <tbody>
            <tr><td>Commit</td><td>${back.commit ? `<code>${back.commit}</code>` : 'não implantado via pipeline (ambiente local)'}</td></tr>
            <tr><td>Implantado em</td><td>${formatarDataHora(back.deployedAt)}</td></tr>
          </tbody>
        </table>
      </div>
    </section>
  `;
}

carregar();
