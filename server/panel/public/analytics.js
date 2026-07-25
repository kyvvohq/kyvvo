// Instrumentação de funil (US47) — continuação, no painel, do rastreamento
// iniciado na landing (server/public/analytics.js). Mesma lógica fail-safe:
// sem POSTHOG_KEY configurada no servidor, kyvvoCapture() é um no-op e a
// página funciona normalmente.
//
// cross_subdomain_cookie mantém o mesmo distinct_id da landing (mesmo
// domínio raiz kyvvo.com.br) — o clique no CTA e o cadastro que vem em
// seguida contam como a mesma pessoa no funil.
(function () {
  window.kyvvoCapture = function (evento, props) {
    if (window.posthog && window.posthog.__loaded) {
      window.posthog.capture(evento, props);
    }
  };
  window.kyvvoIdentify = function (id, props) {
    if (window.posthog && window.posthog.__loaded) {
      window.posthog.identify(id, props);
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

  fetch('/api/config-publica')
    .then(function (res) { return res.json(); })
    .then(function (config) {
      if (config && config.posthogKey) carregarPosthog(config.posthogKey, config.posthogHost);
    })
    .catch(function () { /* sem analytics, página segue funcionando normalmente */ });
})();
