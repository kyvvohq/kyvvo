// Feriados nacionais (Configurações > Bloqueio de agenda) — extraído de
// index.js (fase 1 da modularização).
//
// Calcula o domingo de Páscoa pelo algoritmo Anônimo Gregoriano (Meeus/Jones/
// Butcher) — os 3 feriados móveis (Carnaval seg/ter, Sexta-feira Santa,
// Corpus Christi) são deslocamentos fixos em dias a partir dela. Puro cálculo
// de calendário, sem tabela nem chamada externa — por isso o switch em
// tenants.feriados_bloqueados (migration 062) nunca "vence": o ano é sempre
// derivado da própria data checada.
function calcularPascoa(ano) {
  const a = ano % 19;
  const b = Math.floor(ano / 100);
  const c = ano % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31); // 3=março, 4=abril
  const dia = ((h + l - 7 * m + 114) % 31) + 1;
  return { mes, dia };
}

// Lista dos feriados nacionais do Brasil pro ano dado: os 8 fixos por lei
// (Lei 6.802/80 + 10.607/2002) + os 4 móveis de uso comercial consolidado
// (Carnaval, embora seja ponto facultativo e não feriado decretado por lei
// federal, entra porque é assim que qualquer calendário/comércio brasileiro
// trata). `mes` é 1-indexado (1=janeiro), pra bater com o formato DD/MM
// exibido no frontend.
function listarFeriadosNacionais(ano) {
  const pascoa = calcularPascoa(ano);
  const pascoaUtc = Date.UTC(ano, pascoa.mes - 1, pascoa.dia);
  const deslocarDaPascoa = (offsetDias) => {
    const d = new Date(pascoaUtc + offsetDias * 86400000);
    return { mes: d.getUTCMonth() + 1, dia: d.getUTCDate() };
  };
  const carnavalSegunda = deslocarDaPascoa(-48);
  const carnavalTerca = deslocarDaPascoa(-47);
  const sextaSanta = deslocarDaPascoa(-2);
  const corpusChristi = deslocarDaPascoa(60);

  return [
    { nome: 'Confraternização Universal', mes: 1, dia: 1 },
    { nome: 'Carnaval', mes: carnavalSegunda.mes, dia: carnavalSegunda.dia },
    { nome: 'Carnaval', mes: carnavalTerca.mes, dia: carnavalTerca.dia },
    { nome: 'Sexta-feira Santa', mes: sextaSanta.mes, dia: sextaSanta.dia },
    { nome: 'Tiradentes', mes: 4, dia: 21 },
    { nome: 'Dia do Trabalho', mes: 5, dia: 1 },
    { nome: 'Corpus Christi', mes: corpusChristi.mes, dia: corpusChristi.dia },
    { nome: 'Independência do Brasil', mes: 9, dia: 7 },
    { nome: 'Nossa Senhora Aparecida', mes: 10, dia: 12 },
    { nome: 'Finados', mes: 11, dia: 2 },
    { nome: 'Proclamação da República', mes: 11, dia: 15 },
    { nome: 'Natal', mes: 12, dia: 25 },
  ].sort((x, y) => x.mes - y.mes || x.dia - y.dia);
}

function ehFeriadoNacional(ano, mes, dia) {
  return listarFeriadosNacionais(ano).some((f) => f.mes === mes && f.dia === dia);
}

module.exports = { calcularPascoa, listarFeriadosNacionais, ehFeriadoNacional };
