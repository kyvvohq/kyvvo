const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { resolverClaims } = require('../lib/resolver-sessao');

// Corte P3 — o painel passa a aceitar token RS256 da plataforma, com fallback
// HS256 legado. `resolverClaims` é o ponto onde essa dupla verificação vive;
// é a peça de maior risco do corte (toda rota autenticada passa por aqui),
// então cobre a matriz RS256 ok/erro × HS256 ok/erro.

const CLAIMS_RS = { userId: 'u1', tenantId: 't1', email: 'a@b.c', tokenVersion: 5 };
const CLAIMS_HS = { userId: 'u9', tenantId: 't9', email: 'x@y.z', tokenVersion: 2 };

const rs = { ok: async () => CLAIMS_RS, fail: async () => { throw new Error('kid desconhecido'); } };
const hs = {
  ok: async () => CLAIMS_HS,
  fail: async () => { throw new Error('jwt malformed'); },
};

describe('resolverClaims', () => {
  test('token RS256 válido: usa a plataforma, nem tenta o legado', async () => {
    let hsChamado = false;
    const c = await resolverClaims({
      authorizationHeader: 'Bearer abc.def.ghi',
      verificarRs256: rs.ok,
      verificarHs256: async () => { hsChamado = true; return CLAIMS_HS; },
    });
    assert.equal(c.alg, 'RS256');
    assert.equal(c.userId, 'u1');
    assert.equal(c.tokenVersion, 5);
    assert.equal(hsChamado, false);
  });

  test('RS256 falha, HS256 ok: cai no legado', async () => {
    const c = await resolverClaims({
      authorizationHeader: 'Bearer legado',
      verificarRs256: rs.fail,
      verificarHs256: hs.ok,
    });
    assert.equal(c.alg, 'HS256');
    assert.equal(c.userId, 'u9');
  });

  test('os dois falham: null (→ 401 no chamador)', async () => {
    const c = await resolverClaims({
      authorizationHeader: 'Bearer lixo',
      verificarRs256: rs.fail,
      verificarHs256: hs.fail,
    });
    assert.equal(c, null);
  });

  test('sem header: pula RS256 (sem token) e tenta HS256 direto', async () => {
    let rsChamado = false;
    const c = await resolverClaims({
      authorizationHeader: undefined,
      verificarRs256: async () => { rsChamado = true; return CLAIMS_RS; },
      verificarHs256: hs.ok,
    });
    assert.equal(rsChamado, false);
    assert.equal(c.alg, 'HS256');
  });

  test('header sem "Bearer ": ainda tenta como token cru no RS256', async () => {
    const c = await resolverClaims({
      authorizationHeader: 'abc.def.ghi',
      verificarRs256: rs.ok,
      verificarHs256: hs.fail,
    });
    assert.equal(c.alg, 'RS256');
  });

  test('normaliza só os 4 claims usados pelo painel', async () => {
    const c = await resolverClaims({
      authorizationHeader: 'Bearer x',
      verificarRs256: async () => ({ ...CLAIMS_RS, iss: 'https://auth.kyvvo.com.br', exp: 123, extra: 'ignora' }),
      verificarHs256: hs.fail,
    });
    assert.deepEqual(Object.keys(c).sort(), ['alg', 'email', 'tenantId', 'tokenVersion', 'userId']);
  });
});
