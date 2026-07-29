# Backup do banco de produção

## O que existe hoje

- `server/scripts/backup-db.sh` — roda `pg_dump` dentro do container Postgres
  (`docker compose exec`), comprime o resultado (`gzip`) e salva em
  `/opt/kyvvo/backups/kyvvo_<timestamp>.sql.gz` no host EC2.
- `.github/workflows/deploy-backup.yml` — ao alterar o script na branch
  `main`, copia o arquivo pra EC2 (`/opt/kyvvo/scripts/backup-db.sh`) e
  (re)instala o agendamento via `cron`, rodando todos os dias às 03:15 UTC.
  Pode também ser disparado manualmente (`workflow_dispatch`).

## Configuração

O script usa por padrão (confirmado contra o `docker-compose.yml` real da
EC2):
- Serviço do Postgres chamado `postgres`.
- Usuário `postgres` e banco `railway` (nome herdado da migração do Railway
  pra AWS — ver `docs/architecture.md` — não é o nome do projeto).

Se algum desses valores mudar no `docker-compose.yml`/`.env` reais da EC2,
ajuste via variáveis de ambiente antes de rodar o script, ou defina-as no
`/opt/kyvvo/.env` (o script carrega esse arquivo automaticamente se existir):
`POSTGRES_SERVICE`, `POSTGRES_USER`, `POSTGRES_DB`, `BACKUP_DIR`.

## Rodar manualmente na EC2

```bash
/opt/kyvvo/scripts/backup-db.sh
```

## Pendências (subtasks relacionadas)

- Envio dos dumps gerados para um bucket S3 (ou equivalente durável) —
  ver task ST14.2.
- Rotina de retenção, descartando backups locais/remotos além do período
  definido — ver task ST14.3.
- Teste de restauração real + procedimento documentado — ver task ST14.4.
