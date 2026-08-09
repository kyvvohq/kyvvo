const { test, expect } = require('@playwright/test');

// Cobre US69/CA06: a seção "Modo de atendimento" na aba Preferências do
// portal do salão é somente leitura — o dono do salão vê o modo atual e o
// plano, mas não tem como alterá-lo (quem altera é o admin Kyvvo). API
// mockada via page.route — sem dependência de Postgres real.

async function entrarNaConfiguracao(page, configuracaoInicial) {
  await page.route('**/api/configuracao', (route) => {
    if (route.request().method() === 'PATCH') return route.fallback();
    return route.fulfill({ json: configuracaoInicial });
  });
  await page.route('**/api/agendamentos**', (route) =>
    route.fulfill({ json: { view: 'dia', data: '2026-07-08', agendamentos: [] } })
  );
  await page.addInitScript(() => {
    window.localStorage.setItem('kyvvo_token', 'fake-jwt-token');
    window.localStorage.setItem('kyvvo_nome', 'Ana');
  });
  await page.goto('/painel.html');
  await page.click('#user-menu-toggle');
  await page.click('.user-menu-item[data-menu="configuracao"]');
}

test.describe('Configuração — modo de atendimento (US69/CA06)', () => {
  test('exibe modo IA e o plano, sem opção de edição', async ({ page }) => {
    await entrarNaConfiguracao(page, {
      dias_funcionamento: [1, 2, 3, 4, 5, 6],
      formato_hora: '24h',
      horario_abertura: '08:00:00',
      horario_fechamento: '20:00:00',
      tecnologia: 'ia',
      plano_atual: 'Professional',
    });

    await expect(page.getByText('Linguagem natural')).toBeVisible();
    await expect(page.getByText('Professional')).toBeVisible();
    await expect(page.getByRole('button', { name: /alterar/i })).toHaveCount(0);
  });

  test('exibe modo Bot e link de upgrade', async ({ page }) => {
    await entrarNaConfiguracao(page, {
      dias_funcionamento: [1, 2, 3, 4, 5, 6],
      formato_hora: '24h',
      horario_abertura: '08:00:00',
      horario_fechamento: '20:00:00',
      tecnologia: 'bot',
      plano_atual: 'Starter',
    });

    await expect(page.getByText('Menus numerados')).toBeVisible();
    await expect(page.getByText('Fale conosco')).toBeVisible();
  });
});
