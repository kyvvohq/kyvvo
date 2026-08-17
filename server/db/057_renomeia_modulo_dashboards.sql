-- Menu do painel reorganizado: "Dashboards" vira "Relatórios" (mesmo módulo,
-- key continua 'dashboards' — só o nome exibido muda). GET /api/tenant/modulos
-- ordena por nome (ORDER BY m.nome), então isso também resolve "Financeiro
-- passa pra cima de Relatórios" de graça (F vem antes de R alfabeticamente).
update modulos set nome = 'Relatórios' where key = 'dashboards';
