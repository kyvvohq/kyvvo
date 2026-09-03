// Resolve os claims de sessão de uma request no corte P3 (serviço
// kyvvo-platform vira a autoridade de auth).
//
// Tenta primeiro verificar o token como RS256 na plataforma
// (@kyvvohq/platform-client → JWKS local, sem round-trip). Cai pra verificação
// HS256 legada (@fastify/jwt) enquanto tokens de 7 dias emitidos pelo próprio
// painel ANTES do corte ainda circulam — esse fallback sai numa limpeza
// depois que todos expirarem.
//
// Puro/injetável pra teste: recebe o header e as duas funções de verificação,
// devolve os claims normalizados ({ userId, tenantId, email, tokenVersion,
// alg }) ou null.

async function resolverClaims({ authorizationHeader, verificarRs256, verificarHs256 }) {
  const token = String(authorizationHeader || '').replace(/^Bearer /i, '').trim();

  if (token) {
    try {
      const c = await verificarRs256(token);
      return normalizar(c, 'RS256');
    } catch {
      // não é um token da plataforma (ou inválido) — tenta o legado
    }
  }

  try {
    const c = await verificarHs256();
    return normalizar(c, 'HS256');
  } catch {
    return null;
  }
}

function normalizar(c, alg) {
  return {
    userId: c.userId,
    tenantId: c.tenantId,
    email: c.email,
    tokenVersion: c.tokenVersion,
    alg,
  };
}

module.exports = { resolverClaims };
