// US53 — shell compartilhado por todas as páginas admin (painel/whatsapp/
// configurações/detalhe do tenant): identificação do admin (nome + avatar)
// e o dropdown "Sair", no mesmo padrão visual/comportamental do user menu do
// painel do tenant (app.js). Cada página ainda faz seu próprio redirect
// síncrono no <head> se não houver token (precisa rodar antes do body
// existir); este script só cuida do que depende do DOM já montado, por isso
// é carregado no fim do body, antes do script específico da página.

// US57 — ícones do menu lateral (Kyvvo DS, biblioteca lucide). Só os paths
// dos ícones usados aqui, copiados de lucide-static — sem trazer a lib
// inteira pra um site sem bundler. stroke="currentColor" herda a cor do
// próprio .menu-item/.btn-topbar-icone, então hover/active pintam o ícone
// de graça, sem CSS extra.
const LUCIDE_ICONS = {
  'layout-dashboard': '<rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/>',
  'building-2': '<path d="M10 12h4"/><path d="M10 8h4"/><path d="M14 21v-3a2 2 0 0 0-4 0v3"/><path d="M6 10H4a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-2"/><path d="M6 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><path d="M16 3.128a4 4 0 0 1 0 7.744"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><circle cx="9" cy="7" r="4"/>',
  'credit-card': '<rect width="20" height="14" x="2" y="5" rx="2"/><line x1="2" x2="22" y1="10" y2="10"/>',
  'message-circle': '<path d="M2.992 16.342a2 2 0 0 1 .094 1.167l-1.065 3.29a1 1 0 0 0 1.236 1.168l3.413-.998a2 2 0 0 1 1.099.092 10 10 0 1 0-4.777-4.719"/>',
  sparkles: '<path d="M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z"/><path d="M20 2v4"/><path d="M22 4h-4"/><circle cx="4" cy="20" r="2"/>',
  settings: '<path d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915"/><circle cx="12" cy="12" r="3"/>',
  history: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/>',
  code: '<path d="m16 18 6-6-6-6"/><path d="m8 6-6 6 6 6"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>',
  moon: '<path d="M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401"/>',
};

function svgIcone(nome, classe) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  if (classe) svg.setAttribute('class', classe);
  svg.innerHTML = LUCIDE_ICONS[nome] || '';
  return svg;
}

document.querySelectorAll('.menu-item[data-icon]').forEach((item) => {
  item.insertBefore(svgIcone(item.dataset.icon, 'menu-icon'), item.firstChild);
});

// Tema claro/escuro (US57) — só o portal admin expõe o toggle; o painel do
// tenant nunca seta data-theme e continua sempre escuro. O valor já foi
// aplicado ao <html> por um script síncrono no <head> de cada página (evita
// flash do tema errado); aqui só cuidamos do botão e de persistir a troca.
const btnTema = document.getElementById('btn-tema-toggle');
if (btnTema) {
  function temaAtual() {
    return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
  }
  function pintarBotaoTema() {
    btnTema.innerHTML = '';
    btnTema.appendChild(svgIcone(temaAtual() === 'light' ? 'moon' : 'sun'));
    btnTema.setAttribute('aria-label', temaAtual() === 'light' ? 'Mudar para tema escuro' : 'Mudar para tema claro');
    btnTema.title = btnTema.getAttribute('aria-label');
  }
  pintarBotaoTema();
  btnTema.addEventListener('click', () => {
    const novoTema = temaAtual() === 'light' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', novoTema);
    localStorage.setItem('kyvvo_admin_tema', novoTema);
    pintarBotaoTema();
  });
}

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
  window.location.href = '/login.html';
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
