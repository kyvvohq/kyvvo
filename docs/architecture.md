# Arquitetura Técnica — Kyvvo

## Visão geral

```
Cliente (WhatsApp)
       ↓
WhatsApp Cloud API (oficial da Meta) — AWS
       ↓ webhook
n8n — AWS
       ↓
Supabase (PostgreSQL + Auth)
       ↑
React Native App (Expo)
```

## Fluxo de agendamento

1. Cliente envia mensagem no WhatsApp do salão
2. WhatsApp Cloud API recebe e dispara webhook para o n8n
3. n8n filtra mensagens recebidas (ignora as próprias)
4. Extrai: número do remetente, texto, nome
5. Lógica do bot gerencia o estado da conversa (Static Data)
6. Bot responde via WhatsApp Cloud API → WhatsApp do cliente
7. Ao confirmar: grava agendamento no Supabase
8. Dona do salão visualiza no app React Native

## Banco de dados (PostgreSQL)

### Multi-tenancy
Cada salão é um tenant isolado via Row Level Security (Supabase).

### Tabelas principais

**tenants**
- id, nome, telefone, endereco, criado_em

**profissionais**
- id, tenant_id, nome, servicos[]

**servicos**
- id, tenant_id, nome, duracao_minutos, preco

**clientes**
- id, tenant_id, nome, telefone, criado_em

**agendamentos**
- id, tenant_id, cliente_id, profissional_id, servico_id
- data_hora, status, criado_em

## Infraestrutura (AWS)

| Serviço | Imagem | Porta |
|---|---|---|
| n8n | n8nio/n8n:latest | 5678 |
| PostgreSQL | container Docker | 5432 |

Todos os serviços rodam via Docker Compose no mesmo host EC2 que já serve a landing page e o painel (`/opt/kyvvo`, ver deploy em `.github/workflows/deploy.yml`).

## Backup e restauração do banco

Backup diário automático (US14): dump via `pg_dump` + `cron` na EC2, salvo
localmente e enviado pra um bucket S3 dedicado. Detalhes operacionais
completos (recursos AWS provisionados, como rodar/verificar manualmente,
troubleshooting) em `docs/backup.md` e na página
[Backup do banco de produção](https://app.notion.com/p/3acb5df9cb5d81828d07fcf59f7ec998)
do Wiki. Procedimento de restauração ainda não testado nem documentado
formalmente (ST14.4, pendente).

## Variáveis de ambiente sensíveis

Nunca commitar no repositório. Configurar direto no `docker-compose.yml`/`.env` do host EC2.
