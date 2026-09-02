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

| Serviço (container) | Imagem | Porta | Hostname |
|---|---|---|---|
| `landing` | node:20-alpine | 3000 | `studio.kyvvo.com.br` (landing) / `api.kyvvo.com.br` |
| `studio` (ex-`panel`) | node:20-alpine | 3001 | `studio.kyvvo.com.br` (painel) / `admin.kyvvo.com.br` |
| `people` (ex-`rh`) | node:20-alpine | 3002 | `people.kyvvo.com.br` — repo `kyvvo-people`, bind `/opt/rh` |
| `n8n` | n8nio/n8n:latest | 5678 | `n8n.kyvvo.com.br` |
| `evolution-api` | evoapicloud/evolution-api | 8080 | `manager.kyvvo.com.br` |
| `postgres` | postgres:16 | 5432 | — |

Todos rodam via Docker Compose no mesmo host EC2 (`/opt/kyvvo`, instância
`i-0488342ed54b47d7a`, Elastic IP `54.165.165.150`). nginx nativo no host
roteia por porta. Os apps usam a imagem `node` stock com o código
bind-montado (sem build de imagem). Deploy: `.github/workflows/deploy.yml`
(Studio/landing) e o `deploy.yml` do repo `kyvvo-people`.

**Migração polyrepo (2026-09)**: código comum extraído pra pacotes
`@kyvvohq/*` (GitHub Packages privado, org `kyvvohq`) — ver
`kyvvohq/kyvvo-infra` para o espelho redigido do compose/nginx, e
`project_kyvvo_polyrepo` na memória de sessão para o plano P0–P5.

## Backup e restauração do banco

Backup diário automático: `pg_dump` de `railway` **e** `kyvvo_people` via
`cron` na EC2 (03:15 UTC), gzip local em `/opt/kyvvo/backups/` + bucket S3
`kyvvo-db-backups-241019175404`. Retenção local 30 dias
(`BACKUP_RETENTION_DAYS`). Restauração testada e documentada em
`docs/restore.md` (drill 2026-09-02, ST14.4 fechado). Detalhes em
`docs/backup.md`.

## Variáveis de ambiente sensíveis

Nunca commitar. Vivem no **AWS SSM Parameter Store** como `SecureString` em
`/kyvvo/<serviço>/<KEY>`; `server/scripts/gen-env-from-ssm.sh` gera os
`/opt/kyvvo/env/<serviço>.env` que o `docker-compose.yml` consome via
`env_file`. Ver `docs/ssm-cutover.md`.
