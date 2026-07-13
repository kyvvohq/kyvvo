// Injeta o header e o rodapé padrão da Kyvvo (partials/header.html e
// partials/footer.html) nos placeholders #site-header / #site-footer —
// fonte única pra não duplicar essa marcação em cada página HTML da landing.
// Também concentra a lógica do modal de login, usada pelo botão "Entrar"
// injetado no header.

const PANEL_ORIGIN = 'https://app.kyvvo.com.br';

async function injectPartial(url, targetId) {
  const target = document.getElementById(targetId);
  if (!target) return;
  const res = await fetch(url);
  target.outerHTML = await res.text();
}

function openLoginModal() {
  const overlay = document.getElementById('loginModalOverlay');
  const iframe = document.getElementById('loginIframe');
  iframe.src = PANEL_ORIGIN + '/login.html';
  overlay.classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeLoginModal() {
  const overlay = document.getElementById('loginModalOverlay');
  const iframe = document.getElementById('loginIframe');
  overlay.classList.remove('open');
  document.body.style.overflow = '';
  iframe.src = 'about:blank';
}

window.addEventListener('keydown', (e) => {
  const overlay = document.getElementById('loginModalOverlay');
  if (e.key === 'Escape' && overlay && overlay.classList.contains('open')) {
    closeLoginModal();
  }
});

window.addEventListener('message', (e) => {
  if (e.origin !== PANEL_ORIGIN) return;
  if (e.data && e.data.source === 'kyvvo-login' && e.data.status === 'success') {
    // Login sem e-mail validado (US20/CA10) vai pra tela de validação do token.
    const destino = e.data.admin
      ? '/admin/painel.html'
      : e.data.verificar
        ? '/verificar.html'
        : '/painel.html';
    window.top.location.href = PANEL_ORIGIN + destino;
  }
});

// Resolve links que apontam pro portal (ex: "Criar conta" → cadastro), já que
// o portal roda em outra origem (PANEL_ORIGIN). Qualquer elemento com
// data-panel-path recebe o href absoluto após a injeção do header.
function resolverLinksDoPortal() {
  document.querySelectorAll('[data-panel-path]').forEach((el) => {
    el.setAttribute('href', PANEL_ORIGIN + el.getAttribute('data-panel-path'));
  });
}

Promise.all([
  injectPartial('/partials/header.html', 'site-header'),
  injectPartial('/partials/footer.html', 'site-footer'),
]).then(() => {
  resolverLinksDoPortal();
  if (typeof onSharedReady === 'function') onSharedReady();
});
