# Escopo do MVP — Kyvvo

**Nicho piloto:** Salão de beleza  
**Meta:** Primeiro cliente pagante até 31/08/2026  
**Critério de corte:** Uma funcionalidade entra no MVP se sem ela o negócio não consegue operar, o cliente não pagaria, ou ela é pré-requisito para outra coisa essencial.

---

## ✅ Entra no MVP

### E1 — Agendamento via WhatsApp
- Recepção de mensagem via BSP (Evolution API / Baileys)
- Fluxo conversacional: serviço → data → horário
- Validação de disponibilidade em tempo real
- Sugestão de horário alternativo se ocupado
- Confirmação e gravação no banco
- Cadastro automático do cliente pelo número do WhatsApp

### E2 — App mobile
- Login do dono do negócio
- View dia — agendamentos em lista
- View semana — grade semanal
- View mês — calendário com contagem por dia
- Perfil do negócio (consulta e edição)

### Infra mínima
- Supabase Auth + PostgreSQL multi-tenant
- Deploy AWS
- React Native + Expo

---

## ❌ Fora do MVP

| Funcionalidade | Motivo |
|---|---|
| Notificações / lembretes | Fase 2 |
| Pagamentos (Pix, boleto) | Fase 2 |
| Open Finance | Fase 2 |
| E-mail marketing | Fase 2 |
| Google Calendar sync | Fase 2 |
| Múltiplos profissionais | Fase 2 |
| NPS automático | Fase 2 |
| Programa de fidelidade | Parking Lot |
| API pública | Escala |
| White-label | Escala |

---

## Stack do MVP

| Camada | Tecnologia |
|---|---|
| Bot | n8n + Evolution API |
| Backend | Node.js + Fastify |
| Banco | PostgreSQL (Supabase) |
| Auth | Supabase Auth |
| Mobile | React Native + Expo |
| Infra | AWS |
| Monitoramento | Sentry + PostHog |
