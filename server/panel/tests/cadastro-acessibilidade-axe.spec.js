const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;

// Cobre US81.5 — auditoria automatizada de acessibilidade (axe) na tela de
// cadastro, bloqueando o merge no CI em caso de violação crítica (CA03).
// Onboarding (US82) ainda não existe como página própria — entra aqui assim
// que a US82 sair do bloqueio de PO e ganhar uma rota própria.

const SEGMENTOS_MOCK = { segmentos: [{ id: 1, nome: 'Salão de Beleza' }] };

test.describe('Cadastro — auditoria de acessibilidade (US81.5)', () => {
  test('não apresenta violações críticas de acessibilidade', async ({ page }) => {
    await page.route('**/api/segmentos', (route) => route.fulfill({ json: SEGMENTOS_MOCK }));
    await page.goto('/cadastro.html');

    const resultado = await new AxeBuilder({ page }).analyze();
    const criticas = resultado.violations.filter((v) => v.impact === 'critical');

    expect(criticas, JSON.stringify(criticas, null, 2)).toHaveLength(0);
  });
});
