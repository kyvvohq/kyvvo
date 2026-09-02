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
espaço), `BACKUP_DIR`, `BACKUP_RETENTION_DAYS` (default 30, `0` desativa).

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

## Retenção

- **Local** (ST14.3): o script apaga `*.sql.gz` em `BACKUP_DIR` com mais de
  `BACKUP_RETENTION_DAYS` dias (default 30; `0` desativa). Ajuste no
  `/opt/kyvvo/.env`.
- **S3**: feita por *lifecycle policy* no bucket (lida melhor com
  versionamento), não pelo script. Aplicar uma vez, no CloudShell:
  ```bash
  aws s3api put-bucket-lifecycle-configuration \
    --bucket kyvvo-db-backups-241019175404 \
    --lifecycle-configuration '{"Rules":[{"ID":"expire-kyvvo-db","Filter":{"Prefix":"kyvvo-db/"},"Status":"Enabled","Expiration":{"Days":90},"NoncurrentVersionExpiration":{"NoncurrentDays":30}}]}'
  ```
  (mantém 90 dias no S3, mais folga que os 30 locais.)

## Estado (2026-09-03)

- ✅ Restauração testada + documentada (`docs/restore.md`, ST14.4).
- ✅ `kyvvo_people` coberto (`POSTGRES_DBS`).
- ✅ Envio pro S3 ligado — bucket `kyvvo-db-backups-241019175404`, instance
  profile `kyvvo-ec2-backup-role` (`s3:PutObject`), `aws-cli` no host,
  `BACKUP_S3_BUCKET` no `.env`.
- ✅ Retenção local (`BACKUP_RETENTION_DAYS`).
- Pendente: aplicar a lifecycle policy no S3 (comando acima).
