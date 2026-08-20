// Testes unitários puros (sem banco, sem rede, sem browser) pra
// parsearIntentIA/escolherAgendamentoAlvoIA — ver ia-intent-parser.js.
// Extraídos de index.js numa avaliação do bot de IA (2026-08-19): antes
// eram funções puras presas dentro do monólito, sem nenhum teste em todo o
// projeto (todo o resto usa Playwright, que mocka a API na camada de rede
// do browser e nunca chega a exercitar o backend de verdade). Roda com
// `node --test tests-unit` (Node 20+, sem dependência nova) — diferente da
// suíte Playwright (server/panel/tests/*.spec.js), por isso fica numa pasta
// separada (Playwright varre `tests/` e tentaria rodar isso como um spec
// seu, sem o import de @playwright/test).

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { parsearIntentIA, escolherAgendamentoAlvoIA } = require('../ia-intent-parser');

describe('parsearIntentIA', () => {
  test('aceita um JSON válido e devolve intent/params/resposta', () => {
    const resultado = parsearIntentIA('{"intent":"agendar","params":{"servicoNome":"Corte","dataHoraISO":"2026-08-20T13:00:00.000Z"},"resposta":"Beleza, vamos marcar!"}');
    assert.deepEqual(resultado, {
      intent: 'agendar',
      params: { servicoNome: 'Corte', dataHoraISO: '2026-08-20T13:00:00.000Z' },
      resposta: 'Beleza, vamos marcar!',
    });
  });

  test('extrai o JSON mesmo envolto em ```json ... ``` (a IA às vezes ignora a instrução de não fazer isso)', () => {
    const resultado = parsearIntentIA('```json\n{"intent":"consultar","params":{},"resposta":"Funcionamos das 8h às 18h."}\n```');
    assert.equal(resultado.intent, 'consultar');
    assert.equal(resultado.resposta, 'Funcionamos das 8h às 18h.');
  });

  test('JSON inválido degrada pra "unknown" com resposta genérica, nunca lança', () => {
    const resultado = parsearIntentIA('isso não é JSON de jeito nenhum');
    assert.deepEqual(resultado, { intent: 'unknown', params: {}, resposta: 'Desculpa, não entendi. Pode repetir de outro jeito?' });
  });

  test('intent fora da lista válida degrada pra "unknown" (mantém a resposta da IA)', () => {
    const resultado = parsearIntentIA('{"intent":"deletar_tudo","params":{},"resposta":"ok"}');
    assert.equal(resultado.intent, 'unknown');
    assert.equal(resultado.resposta, 'ok');
  });

  test('JSON válido sem campo "resposta" usa a mensagem genérica em vez de undefined/vazio', () => {
    const resultado = parsearIntentIA('{"intent":"agendar","params":{}}');
    assert.equal(resultado.resposta, 'Desculpa, não entendi. Pode repetir de outro jeito?');
  });

  test('"resposta" vazia/só espaço também conta como faltando', () => {
    const resultado = parsearIntentIA('{"intent":"agendar","params":{},"resposta":"   "}');
    assert.equal(resultado.resposta, 'Desculpa, não entendi. Pode repetir de outro jeito?');
  });

  test('"params" ausente ou não-objeto vira {} em vez de quebrar quem consome o retorno', () => {
    assert.deepEqual(parsearIntentIA('{"intent":"consultar","resposta":"oi"}').params, {});
    assert.deepEqual(parsearIntentIA('{"intent":"consultar","params":"nao é objeto","resposta":"oi"}').params, {});
  });

  test('chama o logger fornecido quando o JSON é inválido, mas nunca lança se ele não vier', () => {
    const chamadas = [];
    parsearIntentIA('json quebrado', { log: (obj, msg) => chamadas.push({ obj, msg }) });
    assert.equal(chamadas.length, 1);
    assert.match(chamadas[0].msg, /não é JSON válido/);

    assert.doesNotThrow(() => parsearIntentIA('json quebrado de novo'));
  });
});

describe('escolherAgendamentoAlvoIA', () => {
  test('nenhum candidato: devolve null (sem nada pra reagendar/cancelar)', () => {
    assert.equal(escolherAgendamentoAlvoIA([], null), null);
  });

  test('exatamente 1 candidato: devolve ele direto, mesmo sem dataHoraAlvoISO', () => {
    const unico = { id: 'a1', data_hora: '2026-08-20T13:00:00.000Z' };
    assert.equal(escolherAgendamentoAlvoIA([unico], null), unico);
  });

  test('2+ candidatos com dataHoraAlvoISO batendo: encontra o certo', () => {
    const candidatos = [
      { id: 'a1', data_hora: '2026-08-20T13:00:00.000Z' },
      { id: 'a2', data_hora: '2026-08-27T13:00:00.000Z' },
    ];
    const escolhido = escolherAgendamentoAlvoIA(candidatos, '2026-08-27T13:00:00.000Z');
    assert.equal(escolhido.id, 'a2');
  });

  test('2+ candidatos sem dataHoraAlvoISO: lança AgendamentoAmbiguo em vez de adivinhar', () => {
    const candidatos = [
      { id: 'a1', data_hora: '2026-08-20T13:00:00.000Z' },
      { id: 'a2', data_hora: '2026-08-27T13:00:00.000Z' },
    ];
    assert.throws(() => escolherAgendamentoAlvoIA(candidatos, null), /AgendamentoAmbiguo/);
  });

  test('2+ candidatos com dataHoraAlvoISO que não bate com nenhum: também lança (nunca escolhe "o mais parecido")', () => {
    const candidatos = [
      { id: 'a1', data_hora: '2026-08-20T13:00:00.000Z' },
      { id: 'a2', data_hora: '2026-08-27T13:00:00.000Z' },
    ];
    assert.throws(() => escolherAgendamentoAlvoIA(candidatos, '2026-09-01T13:00:00.000Z'), /AgendamentoAmbiguo/);
  });
});
