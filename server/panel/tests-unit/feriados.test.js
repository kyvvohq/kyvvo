const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { calcularPascoa, listarFeriadosNacionais, ehFeriadoNacional } = require('../lib/feriados');

// Datas conferidas contra o calendário oficial brasileiro (fase 1 da
// modularização — extraído de index.js, primeira vez que esse cálculo fica
// testável sem precisar subir o Fastify inteiro).
describe('calcularPascoa', () => {
  test('bate com as datas reais de Páscoa 2024-2027', () => {
    assert.deepEqual(calcularPascoa(2024), { mes: 3, dia: 31 });
    assert.deepEqual(calcularPascoa(2025), { mes: 4, dia: 20 });
    assert.deepEqual(calcularPascoa(2026), { mes: 4, dia: 5 });
    assert.deepEqual(calcularPascoa(2027), { mes: 3, dia: 28 });
  });
});

describe('listarFeriadosNacionais', () => {
  test('2026: 12 feriados, incluindo os móveis calculados a partir da Páscoa (05/04/2026)', () => {
    const feriados = listarFeriadosNacionais(2026);
    assert.equal(feriados.length, 12);
    const porNome = Object.fromEntries(feriados.map((f) => [`${f.nome}:${f.mes}/${f.dia}`, f]));
    assert.ok(porNome['Carnaval:2/16']);
    assert.ok(porNome['Carnaval:2/17']);
    assert.ok(porNome['Sexta-feira Santa:4/3']);
    assert.ok(porNome['Corpus Christi:6/4']);
  });

  test('feriados fixos por lei aparecem em qualquer ano', () => {
    const feriados = listarFeriadosNacionais(2030);
    const datas = feriados.map((f) => `${f.mes}/${f.dia}`);
    assert.ok(datas.includes('1/1')); // Confraternização Universal
    assert.ok(datas.includes('4/21')); // Tiradentes
    assert.ok(datas.includes('5/1')); // Dia do Trabalho
    assert.ok(datas.includes('9/7')); // Independência
    assert.ok(datas.includes('10/12')); // Nossa Senhora Aparecida
    assert.ok(datas.includes('11/2')); // Finados
    assert.ok(datas.includes('11/15')); // Proclamação da República
    assert.ok(datas.includes('12/25')); // Natal
  });

  test('vem ordenado por mês/dia', () => {
    const feriados = listarFeriadosNacionais(2026);
    for (let i = 1; i < feriados.length; i++) {
      const anterior = feriados[i - 1];
      const atual = feriados[i];
      assert.ok(anterior.mes < atual.mes || (anterior.mes === atual.mes && anterior.dia <= atual.dia));
    }
  });
});

describe('ehFeriadoNacional', () => {
  test('Natal (25/12) é feriado em qualquer ano', () => {
    assert.equal(ehFeriadoNacional(2026, 12, 25), true);
  });

  test('um dia comum não é feriado', () => {
    assert.equal(ehFeriadoNacional(2026, 12, 28), false);
  });

  test('Carnaval muda de data ano a ano (móvel)', () => {
    assert.equal(ehFeriadoNacional(2026, 2, 16), true);
    assert.equal(ehFeriadoNacional(2025, 2, 16), false);
  });
});
