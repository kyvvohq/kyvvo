# Épicos e User Stories — Kyvvo MVP

---

## E1 — Agendamento via WhatsApp

**Descrição:** Cliente do salão consegue agendar um horário enviando mensagem no WhatsApp do salão. O bot conduz o fluxo, valida disponibilidade e confirma o agendamento.

**Período:** 22/06/2026 → 19/07/2026

### User Stories

**US01** — Como cliente, eu quero enviar uma mensagem no WhatsApp e escolher um serviço do salão, para que eu possa iniciar um agendamento sem sair do app que já uso.

Subtasks:
- ST01.1 — Configurar webhook de recepção de mensagens WhatsApp (BSP)
- ST01.2 — Modelar tabela de serviços no PostgreSQL (nome, duração, profissional)
- ST01.3 — Implementar fluxo conversacional: boas-vindas + listagem de serviços
- ST01.4 — Gerenciar estado da conversa (sessão do cliente)

---

**US02** — Como cliente, eu quero escolher o profissional e visualizar os horários disponíveis, para que eu possa agendar no momento que me for mais conveniente.

Subtasks:
- ST02.1 — Modelar tabela de profissionais no PostgreSQL
- ST02.2 — Implementar lógica de checagem de conflito de horário por profissional e duração
- ST02.3 — Implementar etapa do bot: seleção de profissional + exibição de horários
- ST02.4 — Implementar sugestão de horário alternativo quando slot está ocupado

---

**US03** — Como cliente, eu quero receber a confirmação do agendamento na mesma conversa do WhatsApp, para que eu tenha certeza de que meu horário foi reservado.

Subtasks:
- ST03.1 — Modelar tabela de agendamentos no PostgreSQL
- ST03.2 — Implementar endpoint de criação com validação de conflito
- ST03.3 — Implementar etapa do bot: mensagem de confirmação com resumo
- ST03.4 — Criar cadastro automático de cliente pelo número do WhatsApp

---

## E2 — App: agenda e perfil

**Descrição:** Dona do salão acessa o app mobile, visualiza os agendamentos do dia, semana e mês, e consulta as informações do seu perfil de cadastro.

**Período:** 06/07/2026 → 03/08/2026

### User Stories

**US04** — Como dona do salão, eu quero ver os agendamentos do dia em lista no app, para que eu possa me preparar para os atendimentos do dia.

Subtasks:
- ST04.1 — Configurar projeto React Native + Expo com estrutura de navegação base
- ST04.2 — Implementar autenticação no app (login com e-mail e senha via Supabase Auth)
- ST04.3 — Criar endpoint GET /agendamentos?data=hoje (filtrado por tenant)
- ST04.4 — Implementar tela de agenda do dia com lista de agendamentos

---

**US05** — Como dona do salão, eu quero ver a agenda da semana e do mês no app, para que eu possa planejar a capacidade do salão com antecedência.

Subtasks:
- ST05.1 — Criar endpoints de semana e mês
- ST05.2 — Implementar tela de grade semanal no app
- ST05.3 — Implementar tela de calendário mensal com contagem de agendamentos por dia
- ST05.4 — Implementar navegação entre views dia, semana e mês

---

**US06** — Como dona do salão, eu quero ver o meu perfil com as informações de cadastro no app, para que eu possa consultar e atualizar os dados do meu negócio.

Subtasks:
- ST06.1 — Criar endpoint GET /perfil retornando dados do tenant
- ST06.2 — Implementar tela de perfil no app
- ST06.3 — Implementar edição e salvamento dos dados de perfil (PATCH /perfil)
