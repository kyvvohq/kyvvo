// Cliente do serviço kyvvo-platform (@kyvvohq/platform-client), instância única
// pro processo. Usado hoje só por `authenticate` (verificação RS256 de token);
// entitlements/billing via SDK entram nas próximas fases do corte P3.
//
// PLATFORM_URL é a URL interna na rede do compose (http://platform:3003), não
// a pública — a verificação de token puxa o JWKS de lá. Default embutido pra
// não depender de um param novo no SSM já neste deploy.

const createClient = require('@kyvvohq/platform-client');

const PLATFORM_URL = process.env.PLATFORM_URL || 'http://platform:3003';

module.exports = createClient({ baseUrl: PLATFORM_URL });
