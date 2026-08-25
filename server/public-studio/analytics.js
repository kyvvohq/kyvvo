// Instrumentação de funil (US47) — visita → clique no CTA → cadastro (no
// painel, outra origem). Carrega o PostHog só se o servidor tiver uma chave
// pública configurada (GET /config-publica); sem chave, kyvvoCapture() é um
// no-op silencioso e a página funciona normalmente (fail-safe, igual ao
// padrão já usado no WhatsApp self-service pra integrações pendentes de
// config em produção).
//
// cross_subdomain_cookie mantém o mesmo distinct_id entre a landing e o
// painel do Studio (ambos em studio.kyvvo.com.br) — mesmo domínio raiz — pra
// o funil continuar de visita até ativação sem virar duas pessoas diferentes
// no PostHog.
(function () {
  // URL absoluta pra API da landing (server/index.js), que roda separada na
  // EC2 (server/public-studio/** é servido por esse mesmo processo, mas via
  // nginx em studio.kyvvo.com.br, não em api.kyvvo.com.br) — mesmo padrão do
  // PANEL_ORIGIN em shared.js.
  window.KYVVO_API_ORIGIN = 'https://api.kyvvo.com.br';

  window.kyvvoCapture = function (evento, props) {
    if (window.posthog && window.posthog.__loaded) {
      window.posthog.capture(evento, props);
    }
  };

  function carregarPosthog(key, host) {
    var apiHost = host || 'https://us.i.posthog.com';
    var script = document.createElement('script');
    script.src = apiHost.replace('.i.posthog.com', '-assets.i.posthog.com') + '/static/array.js';
    script.async = true;
    script.onload = function () {
      window.posthog.init(key, {
        api_host: apiHost,
        cross_subdomain_cookie: true,
        capture_pageview: true,
      });
    };
    document.head.appendChild(script);
  }

  fetch(window.KYVVO_API_ORIGIN + '/config-publica')
    .then(function (res) { return res.json(); })
    .then(function (config) {
      if (config && config.posthogKey) carregarPosthog(config.posthogKey, config.posthogHost);
    })
    .catch(function () { /* sem analytics, página segue funcionando normalmente */ });

  // Clique nos CTAs de "criar conta" — evento nomeado (mais confiável pro
  // funil do que depender só do autocapture) pra cada entrada conhecida.
  document.addEventListener('click', function (e) {
    var el = e.target.closest('#ctaComecar, #btnCadastro, #ctaWhatsapp');
    if (!el) return;
    var origem = el.id === 'ctaWhatsapp' ? 'whatsapp' : el.id === 'btnCadastro' ? 'header' : 'hero';
    window.kyvvoCapture('cta_clicado', { origem: origem, pagina: window.location.pathname });
  });
})();
