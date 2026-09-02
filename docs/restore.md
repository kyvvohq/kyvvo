# Restauração do banco de produção

Procedimento verificado de restaurar um backup gerado por
`server/scripts/backup-db.sh` (ver `docs/backup.md`). Fecha o ST14.4.

## O que é o backup

- `pg_dump -U postgres -d <db> --no-owner --no-privileges` → **SQL puro**,
  gzipado. Um arquivo por banco por dia: `<db>_<YYYYMMDD>_<HHMMSS>.sql.gz`
  (ex: `railway_20260903_031501.sql.gz`, `kyvvo_people_20260903_031501.sql.gz`).
- Local: `/opt/kyvvo/backups/` no host EC2. Cron diário às 03:15 UTC
  (crontab do usuário `ubuntu`), log em `/opt/kyvvo/backups/backup.log`.
- Cobre `railway` (Studio + admin) **e** `kyvvo_people` (Kyvvo People) — a
  lista está em `POSTGRES_DBS` no script. Backups anteriores a 2026-09-03
  cobrem só `railway` e têm o nome antigo `kyvvo_<ts>.sql.gz`.
- `--no-owner --no-privileges`: o restore não depende de roles/globais, roda
  como `postgres` e não precisa de `pg_dumpall`.

## Restaurar para conferência (não-destrutivo)

Restaura num banco descartável dentro do próprio container Postgres — sem subir
instância nova (a EC2 é apertada de RAM). O banco `railway` tem ~9 MB, o
restore leva segundos.

```bash
# banco a conferir: railway (Studio) ou kyvvo_people (People)
LATEST=$(ls -t /opt/kyvvo/backups/railway_*.sql.gz | head -1)
echo "usando $LATEST"

sudo docker exec kyvvo-postgres-1 psql -U postgres \
  -c "DROP DATABASE IF EXISTS restore_drill;" -c "CREATE DATABASE restore_drill;"

gunzip -c "$LATEST" | sudo docker exec -i kyvvo-postgres-1 \
  psql -U postgres -d restore_drill -v ON_ERROR_STOP=1 -q \
  && echo "RESTORE OK" || echo "RESTORE FALHOU"
```

Sanidade — comparar com o banco vivo (as contagens devem bater, a menos de
escritas feitas depois do horário do backup):

```bash
Q="SELECT (SELECT count(*) FROM information_schema.tables WHERE table_schema='public') tabelas, \
          (SELECT count(*) FROM tenants) tenants, \
          (SELECT count(*) FROM usuarios) usuarios, \
          (SELECT max(criado_em) FROM tenants) ult_tenant;"
sudo docker exec kyvvo-postgres-1 psql -U postgres -d restore_drill -c "$Q"
sudo docker exec kyvvo-postgres-1 psql -U postgres -d railway       -c "$Q"
```

Para o `kyvvo_people` a query de sanidade é outra (tabelas diferentes), ex:
`SELECT count(*) FROM assinaturas; SELECT count(*) FROM pessoas;` — compare
`restore_drill` contra o banco `kyvvo_people` vivo.

Limpar:

```bash
sudo docker exec kyvvo-postgres-1 psql -U postgres -c "DROP DATABASE restore_drill;"
```

## Restaurar de verdade (desastre — o `railway` foi perdido/corrompido)

1. Parar os serviços que escrevem no banco:
   ```bash
   cd /opt/kyvvo && sudo docker compose stop studio landing
   ```
2. Recriar o banco vazio (⚠️ destrói o `railway` atual):
   ```bash
   sudo docker exec kyvvo-postgres-1 psql -U postgres \
     -c "DROP DATABASE IF EXISTS railway WITH (FORCE);" -c "CREATE DATABASE railway;"
   ```
3. Restaurar:
   ```bash
   LATEST=$(ls -t /opt/kyvvo/backups/railway_*.sql.gz | head -1)
   gunzip -c "$LATEST" | sudo docker exec -i kyvvo-postgres-1 \
     psql -U postgres -d railway -v ON_ERROR_STOP=1 -q
   ```
4. Rodar a sanidade acima contra `railway`.
5. Subir de novo:
   ```bash
   cd /opt/kyvvo && sudo docker compose start studio landing
   ```
6. Conferir `studio.kyvvo.com.br` (login + uma tela com dados).

**Perda de dados esperada:** tudo escrito entre o último backup (03:15 UTC) e o
momento do desastre. Sem PITR hoje — ver P4 do runbook de migração (Postgres
gerenciado) para failover + point-in-time.

## Drill executado

- **2026-09-02** — restaurado o `kyvvo_20260902_031501.sql.gz` num banco
  descartável. `RESTORE OK`, sem erro com `ON_ERROR_STOP=1`. Contagens
  idênticas ao `railway` vivo: 28 tabelas · 7 tenants · 6 usuários · mesmo
  `max(tenants.criado_em)`. Backup íntegro e restaurável.

## Lacunas conhecidas

- **Sem cópia off-host.** O backup vive só em `/opt/kyvvo/backups/` na mesma
  instância que o banco — perda do disco/instância leva os dois. O script já
  suporta S3 (`BACKUP_S3_BUCKET`/`BACKUP_S3_PREFIX` no `/opt/kyvvo/.env`,
  precisa de `aws-cli` no host + IAM role/credenciais com `s3:PutObject`);
  falta criar o bucket e configurar.
- **Sem PITR.** Só snapshot diário — perde tudo entre 03:15 UTC e o desastre.
  Point-in-time + failover é o P4 do runbook de migração (Postgres gerenciado).
- **Sem retenção** — os `.sql.gz` acumulam pra sempre (ST14.3).
