const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { calcularTrialTenant, calcularBloqueioAssinatura, statusContaTenant } = require('../lib/trial-conta');
const { config } = require('../lib/configuracoes-sistema');

// Fase 1 da modularização — extraído de index.js. Estas funções estavam
// fisicamente dentro do bloco "Área admin", mas decidem se `authenticate`
// bloqueia TODA rota autenticada do sistema — é o ponto de maior risco da
// extração, por isso a cobertura de testes aqui é deliberadamente ampla
// (matriz de status × dentro/fora de carência).

describe('calcularTrialTenant', () => {
  test('sem ativado_em: trial nunca começou', () => {
    const r = calcularTrialTenant({ ativado_em: null });
    assert.deepEqual(r, { trialAtivo: false, trialInicio: null, trialFim: null, trialDiasRestantes: null });
  });

  test('ativado há poucos dias, dentro do período: trial ativo', () => {
    const ativadoEm = new Date(Date.now() - 2 * 86400000).toISOString();
    const r = calcularTrialTenant({ ativado_em: ativadoEm });
    assert.equal(r.trialAtivo, true);
    assert.ok(r.trialDiasRestantes > 0);
  });

  test('ativado há mais de trialDias dias: trial expirado', () => {
    const ativadoEm = new Date(Date.now() - 30 * 86400000).toISOString();
    const r = calcularTrialTenant({ ativado_em: ativadoEm });
    assert.equal(r.trialAtivo, false);
  });

  test('respeita config.trialDias em runtime (US38 — admin edita sem deploy)', () => {
    const original = config.trialDias;
    try {
      config.trialDias = 1;
      const ativadoEm = new Date(Date.now() - 2 * 86400000).toISOString();
      const r = calcularTrialTenant({ ativado_em: ativadoEm });
      assert.equal(r.trialAtivo, false); // já passou do dia 1
    } finally {
      config.trialDias = original;
    }
  });
});

describe('calcularBloqueioAssinatura', () => {
  test('trial ativo: sem bloqueio', () => {
    const ativadoEm = new Date(Date.now() - 2 * 86400000).toISOString();
    assert.equal(calcularBloqueioAssinatura({ status: 'trial', ativado_em: ativadoEm }), null);
  });

  test('trial expirado: bloqueia', () => {
    const ativadoEm = new Date(Date.now() - 30 * 86400000).toISOString();
    assert.equal(calcularBloqueioAssinatura({ status: 'trial', ativado_em: ativadoEm }), 'trial_expirado');
  });

  test('ativo: sem bloqueio', () => {
    assert.equal(calcularBloqueioAssinatura({ status: 'ativo' }), null);
  });

  test('suspenso: bloqueia na hora, sem carência', () => {
    assert.equal(calcularBloqueioAssinatura({ status: 'suspenso' }), 'suspenso');
  });

  test('inadimplente dentro da carência: sem bloqueio', () => {
    const statusAlteradoEm = new Date(Date.now() - 1 * 86400000).toISOString(); // 1 dia atrás, carência padrão é 3
    assert.equal(calcularBloqueioAssinatura({ status: 'inadimplente', status_alterado_em: statusAlteradoEm }), null);
  });

  test('inadimplente além da carência: bloqueia', () => {
    const statusAlteradoEm = new Date(Date.now() - 10 * 86400000).toISOString();
    assert.equal(calcularBloqueioAssinatura({ status: 'inadimplente', status_alterado_em: statusAlteradoEm }), 'inadimplente');
  });

  test('inadimplente sem status_alterado_em: bloqueia direto (sem carência pra contar)', () => {
    assert.equal(calcularBloqueioAssinatura({ status: 'inadimplente', status_alterado_em: null }), 'inadimplente');
  });

  test('cancelado com acesso_ate no futuro: sem bloqueio ainda', () => {
    const acessoAte = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);
    assert.equal(calcularBloqueioAssinatura({ status: 'cancelado', acesso_ate: acessoAte }), null);
  });

  test('cancelado com acesso_ate no passado: bloqueia', () => {
    const acessoAte = new Date(Date.now() - 5 * 86400000).toISOString().slice(0, 10);
    assert.equal(calcularBloqueioAssinatura({ status: 'cancelado', acesso_ate: acessoAte }), 'cancelado');
  });
});

describe('statusContaTenant', () => {
  test('tenant desativado (ativo: false) é sempre "Inativo", independente do status', () => {
    assert.equal(statusContaTenant({ ativo: false, status: 'ativo' }), 'Inativo');
  });

  test('trial sem ativado_em: "Não ativado"', () => {
    assert.equal(statusContaTenant({ ativo: true, status: 'trial', ativado_em: null }), 'Não ativado');
  });

  test('trial ativado e dentro do período: "Trial ativo"', () => {
    const ativadoEm = new Date(Date.now() - 2 * 86400000).toISOString();
    assert.equal(statusContaTenant({ ativo: true, status: 'trial', ativado_em: ativadoEm }), 'Trial ativo');
  });

  test('status "ativo": "Ativo"', () => {
    assert.equal(statusContaTenant({ ativo: true, status: 'ativo' }), 'Ativo');
  });

  test('status "suspenso": "Suspenso"', () => {
    assert.equal(statusContaTenant({ ativo: true, status: 'suspenso' }), 'Suspenso');
  });

  // Comportamento verificado contra o código original (index.js) antes da
  // extração: 'inadimplente'/'cancelado' caem no default 'Inativo' — não é
  // um bug introduzido pela modularização, é o comportamento pré-existente.
  test('status "inadimplente"/"cancelado" caem no default "Inativo"', () => {
    assert.equal(statusContaTenant({ ativo: true, status: 'inadimplente' }), 'Inativo');
    assert.equal(statusContaTenant({ ativo: true, status: 'cancelado' }), 'Inativo');
  });
});
