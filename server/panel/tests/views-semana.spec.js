const { test, expect } = require('@playwright/test');

// Cobre o PR3: a aba Semana deixou de ser uma lista vertical agrupada por
// dia (só mostrando dias que já tinham agendamento) e passou a ser um grid
// de colunas lado a lado, uma por dia de funcionamento — cada coluna com a
// mesma grade de horários da view Dia. As chamadas de API são mockadas via
// page.route — sem dependência de Postgres real.

// Segunda-feira da semana atual em horário de Brasília (mesmo cálculo de
// inicioDaSemana em app.js, ancorado ao meio-dia local pra nunca virar o dia)
// — os fixtures de agendamento precisam cair nessa data pra baterem com a
// coluna que a view Semana efetivamente renderiza (baseada em "hoje" real,
// não numa data fixa).
function segundaFeiraDaSemanaAtual() {
  const [ano, mes, dia] = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' }).split('-').map(Number);
  const d = new Date(ano, mes - 1, dia, 12);
  const diaSemana = d.getDay();
  const diff = diaSemana === 0 ? -6 : 1 - diaSemana;
  d.setDate(d.getDate() + diff);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function entrarNoPainel(page, { semana, configuracao } = {}) {
  await page.route('**/api/configuracao', (route) =>
    route.fulfill({
      json: {
        dias_funcionamento: [1, 2, 3, 4, 5, 6],
        formato_hora: '24h',
        horario_abertura: '09:00:00',
        horario_fechamento: '11:00:00',
        horario_almoco_ativo: false,
        ...configuracao,
      },
    })
  );
  await page.route('**/api/agendamentos**', (route) => {
    const url = new URL(route.request().url());
    const view = url.searchParams.get('view');
    if (view !== 'semana') return route.fulfill({ json: { view, data: url.searchParams.get('data'), agendamentos: [] } });
    return route.fulfill({ json: { view: 'semana', data: url.searchParams.get('data'), agendamentos: semana || [] } });
  });
  await page.addInitScript(() => {
    window.localStorage.setItem('kyvvo_token', 'fake-jwt-token');
    window.localStorage.setItem('kyvvo_nome', 'Ana');
  });
  await page.goto('/painel.html');
  await page.click('.tab[data-tab="semana"]');
}

test.describe('View Semana — colunas lado a lado (PR3)', () => {
  test('mostra uma coluna só pros dias de funcionamento configurados', async ({ page }) => {
    await entrarNoPainel(page, { configuracao: { dias_funcionamento: [1, 2, 3, 4, 5] } }); // sem sábado/domingo
    const colunas = page.locator('.semana-coluna');
    await expect(colunas).toHaveCount(5);
    const cabecalhos = await page.locator('.semana-coluna-cabecalho strong').allTextContents();
    expect(cabecalhos.map((c) => c.toLowerCase())).toEqual(['segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira']);
  });

  test('cada coluna tem a grade de horários com o agendamento certo (serviço, cliente, duração, valor, profissional)', async ({ page }) => {
    await entrarNoPainel(page, {
      configuracao: { dias_funcionamento: [1] }, // só segunda, pra isolar a coluna
      semana: [{
        id: 'ag1', data_hora: `${segundaFeiraDaSemanaAtual()}T13:00:00.000Z`, status: 'confirmado', encaixe: false,
        cliente: 'Maria Silva', profissional: 'Bruna', servico: 'Corte', duracao_minutos: 30, preco: '50.00',
      }],
    });
    const coluna = page.locator('.semana-coluna');
    await expect(coluna).toHaveCount(1);
    const linha = coluna.locator('.grade-linha').filter({ hasText: '10:00' }); // 13:00 UTC = 10:00 Brasília
    await expect(linha.locator('.grade-ag-servico')).toHaveText('Corte');
    await expect(linha.locator('.grade-ag-cliente')).toHaveText('Maria Silva');
    await expect(linha.locator('.grade-ag-meta')).toContainText('30min');
    await expect(linha.locator('.grade-ag-meta')).toContainText('R$ 50,00');
    await expect(linha.locator('.grade-ag-meta')).toContainText('Bruna');
  });

  test('dois agendamentos no mesmo horário (profissionais diferentes) aparecem os dois na linha', async ({ page }) => {
    await entrarNoPainel(page, {
      configuracao: { dias_funcionamento: [1] },
      semana: [
        { id: 'ag1', data_hora: `${segundaFeiraDaSemanaAtual()}T13:00:00.000Z`, status: 'confirmado', cliente: 'Maria', profissional: 'Bruna', servico: 'Corte', duracao_minutos: 30, preco: '50.00' },
        { id: 'ag2', data_hora: `${segundaFeiraDaSemanaAtual()}T13:00:00.000Z`, status: 'confirmado', cliente: 'Joana', profissional: 'Ana', servico: 'Escova', duracao_minutos: 45, preco: '40.00' },
      ],
    });
    const linha = page.locator('.semana-coluna .grade-linha').filter({ hasText: '10:00' });
    await expect(linha.locator('.grade-ag-card')).toHaveCount(2);
  });

  test('hover no cabeçalho da coluna mostra "+" que abre novo agendamento pré-preenchido só com a data', async ({ page }) => {
    await entrarNoPainel(page, { configuracao: { dias_funcionamento: [1] } });
    const coluna = page.locator('.semana-coluna');
    await coluna.hover();
    await coluna.locator('.semana-coluna-add').click();
    await expect(page.locator('#form-novo-agendamento')).toBeVisible();
    const dataValue = await page.locator('#novo-ag-data').inputValue();
    expect(dataValue).toBeTruthy();
  });

  test('semana sem nenhum dia de funcionamento mostra mensagem vazia', async ({ page }) => {
    await entrarNoPainel(page, { configuracao: { dias_funcionamento: [] } });
    await expect(page.locator('.vazio')).toContainText('Nenhum dia de funcionamento configurado');
    await expect(page.locator('.semana-coluna')).toHaveCount(0);
  });
});
