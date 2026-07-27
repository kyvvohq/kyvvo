// US53 — shell compartilhado por todas as páginas admin (painel/whatsapp/
// configurações/detalhe do tenant): identificação do admin (nome + avatar)
// e o dropdown "Sair", no mesmo padrão visual/comportamental do user menu do
// painel do tenant (app.js). Cada página ainda faz seu próprio redirect
// síncrono no <head> se não houver token (precisa rodar antes do body
// existir); este script só cuida do que depende do DOM já montado, por isso
// é carregado no fim do body, antes do script específico da página.

const token = localStorage.getItem('kyvvo_admin_token');
const adminNome = localStorage.getItem('kyvvo_admin_nome') || '';

document.getElementById('admin-nome').textContent = adminNome;

// Iniciais do admin pro avatar — mesmo critério de iniciaisNome() no painel
// do tenant (primeira + última palavra do nome).
function iniciaisAdmin(nome) {
  const partes = (nome || '').trim().split(/\s+/).filter(Boolean);
  if (!partes.length) return '🛠';
  return (partes[0][0] + (partes.length > 1 ? partes[partes.length - 1][0] : '')).toUpperCase();
}
document.getElementById('user-menu-avatar').textContent = iniciaisAdmin(adminNome);

document.getElementById('btn-sair').addEventListener('click', () => {
  localStorage.removeItem('kyvvo_admin_token');
  localStorage.removeItem('kyvvo_admin_nome');
  window.location.href = '/admin/login.html';
});

// User menu (avatar + dropdown) — mesmo comportamento do painel do tenant
// (abre/fecha ao clicar no avatar, fecha ao clicar fora).
const userMenuToggle = document.getElementById('user-menu-toggle');
const userMenuDropdown = document.getElementById('user-menu-dropdown');

function fecharUserMenu() {
  userMenuDropdown.hidden = true;
  userMenuToggle.classList.remove('aberto');
}

userMenuToggle.addEventListener('click', (e) => {
  e.stopPropagation();
  const vaiAbrir = userMenuDropdown.hidden;
  fecharUserMenu();
  if (vaiAbrir) {
    userMenuDropdown.hidden = false;
    userMenuToggle.classList.add('aberto');
  }
});

document.addEventListener('click', (e) => {
  if (!document.getElementById('user-menu').contains(e.target)) fecharUserMenu();
});
