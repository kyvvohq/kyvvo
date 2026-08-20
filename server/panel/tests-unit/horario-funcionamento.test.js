const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { dentroDoHorarioFuncionamento, empurrarProximoDiaAberto } = require('../lib/horario-funcionamento');

// Fase 1 da modularização — extraído de index.js. `buscarBloqueioConflitante`
// não é testada aqui (precisa de Postgres real via `init(pool)`, fora do
// escopo dos testes unitários DB-free).

const TENANT_BASE = {
  dias_funcionamento: [1, 2, 3, 4, 5, 6], // fechado domingo
  horario_abertura: '08:00:00',
  horario_fechamento: '20:00:00',
  horario_almoco_ativo: false,
};

describe('dentroDoHorarioFuncionamento', () => {
  test('dia fechado (domingo) é inválido', () => {
    // 2026-08-23 é um domingo.
    const r = dentroDoHorarioFuncionamento(TENANT_BASE, '2026-08-23T15:00:00-03:00', 30);
    assert.equal(r.valido, false);
    assert.match(r.motivo, /não abre nesse dia/);
  });

  test('horário dentro do expediente, sem feriado bloqueado: válido', () => {
    const r = dentroDoHorarioFuncionamento(TENANT_BASE, '2026-08-24T15:00:00-03:00', 30);
    assert.equal(r.valido, true);
  });

  test('feriado nacional bloqueado rejeita, mesmo em dia de funcionamento normal', () => {
    const tenant = { ...TENANT_BASE, feriados_bloqueados: true };
    // 2026-12-25 (Natal) cai numa sexta-feira, dia normalmente aberto.
    const r = dentroDoHorarioFuncionamento(tenant, '2026-12-25T15:00:00-03:00', 30);
    assert.equal(r.valido, false);
    assert.match(r.motivo, /feriado nacional/);
  });

  test('feriados_bloqueados desligado permite agendar num feriado', () => {
    const tenant = { ...TENANT_BASE, feriados_bloqueados: false };
    const r = dentroDoHorarioFuncionamento(tenant, '2026-12-25T15:00:00-03:00', 30);
    assert.equal(r.valido, true);
  });

  test('fora do horário de funcionamento (antes da abertura)', () => {
    const r = dentroDoHorarioFuncionamento(TENANT_BASE, '2026-08-24T07:00:00-03:00', 30);
    assert.equal(r.valido, false);
    assert.match(r.motivo, /Horário fora do funcionamento/);
  });

  test('duração empurra o fim do atendimento pra depois do fechamento: inválido', () => {
    const r = dentroDoHorarioFuncionamento(TENANT_BASE, '2026-08-24T19:45:00-03:00', 30);
    assert.equal(r.valido, false);
  });

  test('cai no intervalo de almoço quando ativo', () => {
    const tenant = { ...TENANT_BASE, horario_almoco_ativo: true, horario_almoco_inicio: '12:00:00', horario_almoco_fim: '13:00:00' };
    const r = dentroDoHorarioFuncionamento(tenant, '2026-08-24T12:30:00-03:00', 30);
    assert.equal(r.valido, false);
    assert.match(r.motivo, /intervalo de almoço/);
  });
});

describe('empurrarProximoDiaAberto', () => {
  test('mantém a data se já é um dia aberto', () => {
    // 2026-08-24 é segunda-feira (dia 1), presente em dias_funcionamento.
    const r = empurrarProximoDiaAberto({ ano: 2026, mes: 7, dia: 24, hora: 10, minuto: 0, segundo: 0 }, [1, 2, 3, 4, 5, 6]);
    assert.deepEqual(r, { ano: 2026, mes: 7, dia: 24, hora: 10, minuto: 0, segundo: 0 });
  });

  test('empurra do domingo fechado pra segunda', () => {
    // 2026-08-23 é domingo.
    const r = empurrarProximoDiaAberto({ ano: 2026, mes: 7, dia: 23, hora: 10, minuto: 0, segundo: 0 }, [1, 2, 3, 4, 5, 6]);
    assert.equal(r.dia, 24);
  });

  test('com feriadosBloqueados, também pula uma data de feriado nacional', () => {
    // 2026-12-25 (Natal, sexta) — próximo dia aberto e sem feriado é 26/12 (sábado, ainda em dias_funcionamento).
    const r = empurrarProximoDiaAberto({ ano: 2026, mes: 11, dia: 25, hora: 10, minuto: 0, segundo: 0 }, [1, 2, 3, 4, 5, 6], true);
    assert.equal(r.dia, 26);
  });

  test('sem feriadosBloqueados, não pula o feriado', () => {
    const r = empurrarProximoDiaAberto({ ano: 2026, mes: 11, dia: 25, hora: 10, minuto: 0, segundo: 0 }, [1, 2, 3, 4, 5, 6], false);
    assert.equal(r.dia, 25);
  });

  test('devolve null se dias_funcionamento está vazio (trava de segurança)', () => {
    const r = empurrarProximoDiaAberto({ ano: 2026, mes: 7, dia: 24, hora: 10, minuto: 0, segundo: 0 }, []);
    assert.equal(r, null);
  });
});
