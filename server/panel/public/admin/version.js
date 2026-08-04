// Versão do front (US54) — o commit é substituído pelo workflow de deploy
// (.github/workflows/deploy.yml) antes do arquivo ser copiado pra EC2.
// Fora do deploy (dev local), fica com o placeholder mesmo — versao.js trata
// esse caso como "não implantado via pipeline".
window.KYVVO_FRONT_VERSION = '__COMMIT_SHA__';
