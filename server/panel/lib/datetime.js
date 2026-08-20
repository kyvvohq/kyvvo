// Conversões de/para horário de Brasília — extraído de index.js (fase 1 da
// modularização, ver plano "Kyvvo — modularizar server/panel/index.js").
//
// O servidor roda em UTC (container Docker), mas todo horário de
// funcionamento/agenda é pensado em horário de Brasília. Brasil não observa
// horário de verão desde 2019, então o offset fixo -3h é seguro (sem precisar
// de lib de timezone). BUG HISTÓRICO: código anterior usava new Date(...) e
// os métodos locais (getHours/setMinutes) assumindo que "horário local do
// processo" era Brasília — como o processo roda em UTC, isso deslocava todo
// slot gerado em 3h pra trás (um slot rotulado "09:00" era na verdade 06:00
// em Brasília) e podia até cruzar a virada do dia. Toda conversão de/para
// horário de Brasília deve passar pelas funções abaixo, nunca por
// getHours/setMinutes/toISOString direto num Date.
const OFFSET_BRASILIA_MINUTOS = 180;

// Converte um "time" do Postgres ("08:00:00" ou "08:00") em minutos desde a
// meia-noite, pra comparar com o horário (também em minutos) de um
// agendamento — usado tanto na geração de slots quanto na validação de
// horário de funcionamento em POST/PATCH de agendamentos.
function horarioParaMinutos(horario) {
  const [h, m] = horario.split(':').map(Number);
  return h * 60 + m;
}

// Minutos desde a meia-noite (em horário de Brasília) de um timestamp de
// agendamento — usado na validação de horário de funcionamento em
// POST/PATCH de agendamentos.
function minutosNoDia(dataISO) {
  const d = new Date(dataISO);
  const minutosUtc = d.getUTCHours() * 60 + d.getUTCMinutes();
  return ((minutosUtc - OFFSET_BRASILIA_MINUTOS) % 1440 + 1440) % 1440;
}

// Dia da semana (0=domingo..6=sábado) de um timestamp de agendamento, já
// ajustado pro dia civil de Brasília (mesmo raciocínio de offset fixo de
// minutosNoDia acima).
function diaDaSemanaBrasilia(dataISO) {
  return new Date(new Date(dataISO).getTime() - OFFSET_BRASILIA_MINUTOS * 60000).getUTCDay();
}

// "Componentes de Brasília" (ano/mês/dia/hora/minuto/segundo já ajustados
// pelo offset fixo, mesmo raciocínio de diaDaSemanaBrasilia/minutosNoDia
// acima) pra nunca calcular dia-do-mês/dia-da-semana em cima do UTC cru — um
// agendamento às 23h de Brasília já vira o dia seguinte em UTC.
function componentesBrasilia(dataISO) {
  const deslocado = new Date(new Date(dataISO).getTime() - OFFSET_BRASILIA_MINUTOS * 60000);
  return {
    ano: deslocado.getUTCFullYear(),
    mes: deslocado.getUTCMonth(),
    dia: deslocado.getUTCDate(),
    hora: deslocado.getUTCHours(),
    minuto: deslocado.getUTCMinutes(),
    segundo: deslocado.getUTCSeconds(),
  };
}

function isoDeComponentesBrasilia({ ano, mes, dia, hora, minuto, segundo }) {
  return new Date(Date.UTC(ano, mes, dia, hora, minuto, segundo) + OFFSET_BRASILIA_MINUTOS * 60000).toISOString();
}

// "YYYY-MM-DD" do calendário civil de Brasília — pra comparar com limites que
// chegam do frontend nesse mesmo formato, sem hora.
function dataDiaISO({ ano, mes, dia }) {
  return `${ano}-${String(mes + 1).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

// Data (YYYY-MM-DD) de "agora" em horário de Brasília — usada como fallback
// quando a view de agenda é consultada sem o parâmetro "data" explícito.
function dataAtualBrasilia() {
  return new Date(Date.now() - OFFSET_BRASILIA_MINUTOS * 60000).toISOString().slice(0, 10);
}

// "YYYY-MM" do mês corrente em Brasília — usado como referência padrão do
// Financeiro quando a tela não especifica mês.
function mesAtualBrasilia() {
  return new Date(Date.now() - OFFSET_BRASILIA_MINUTOS * 60000).toISOString().slice(0, 7);
}

module.exports = {
  OFFSET_BRASILIA_MINUTOS,
  horarioParaMinutos,
  minutosNoDia,
  diaDaSemanaBrasilia,
  componentesBrasilia,
  isoDeComponentesBrasilia,
  dataDiaISO,
  dataAtualBrasilia,
  mesAtualBrasilia,
};
