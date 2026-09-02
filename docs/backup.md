# Backup do banco de produção

## O que existe hoje

- `server/scripts/backup-db.sh` — roda `pg_dump` dentro do container Postgres
  (`docker compose exec`) para cada banco em `POSTGRES_DBS` (default:
  `railway` e `kyvvo_people`), comprime cada resultado (`gzip`), salva em
  `/opt/kyvvo/backups/<db>_<timestamp>.sql.gz` no host EC2 e, se
  `BACKUP_S3_BUCKET` estiver configurado, também envia cada dump pra esse
  bucket S3 (via `aws-cli`) logo em seguida. Descarta dump < 200 bytes
  (falha silenciosa) e sai com status != 0 se qualquer banco ou upload
  falhar. Ver `docs/restore.md` para o procedimento de restauração.
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
`POSTGRES_SERVICE`, `POSTGRES_USER`, `POSTGRES_DBS` (lista separada por
espaço), `BACKUP_DIR`.

### Envio para S3

Para habilitar o envio do backup pro S3, defina no `/opt/kyvvo/.env` do host:
- `BACKUP_S3_BUCKET` — nome do bucket destino (obrigatório para habilitar o
  envio; se ausente, o script mantém o backup só localmente).
- `BACKUP_S3_PREFIX` — prefixo/pasta dentro do bucket (default: `kyvvo-db`).

O script usa `aws s3 cp` e espera que o `aws-cli` esteja instalado no host e
que existam credenciais AWS válidas disponíveis (idealmente uma IAM role
anexada à instância EC2 com permissão de `s3:PutObject` no bucket; como
alternativa, `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` no `.env`).

## Rodar manualmente na EC2

```bash
/opt/kyvvo/scripts/backup-db.sh
```

## Pendências (subtasks relacionadas)

- Rotina de retenção, descartando backups locais/remotos além do período
  definido — ver task ST14.3.
- ~~Teste de restauração real + procedimento documentado — ver task ST14.4.~~
  **Feito 2026-09-02** — ver `docs/restore.md` (drill executado, backup íntegro).
- ~~Cobrir o banco `kyvvo_people`~~ — **feito 2026-09-03** (`POSTGRES_DBS`).
- Enviar o backup pro S3: o script já suporta, mas a EC2 hoje **não tem
  `aws-cli` nem IAM role**, e o `.env` não tem `BACKUP_S3_BUCKET` — o backup
  vive só no disco da própria instância. Falta: criar o bucket, dar
  `s3:PutObject` à instância (IAM role) ou pôr credenciais no `.env`,
  instalar o `aws-cli`, e setar `BACKUP_S3_BUCKET`.
