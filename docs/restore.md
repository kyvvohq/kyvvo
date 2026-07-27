# Restauração do banco a partir de um backup

## Procedimento (produção, EC2)

1. Copiar/baixar o dump desejado (local em `/opt/kyvvo/backups/*.sql.gz` ou
   do bucket S3, se configurado — ver `docs/backup.md`).
2. Rodar, no host EC2, dentro de `/opt/kyvvo`:
   ```bash
   server/scripts/restore-db.sh /opt/kyvvo/backups/kyvvo_<timestamp>.sql.gz
   ```
   Isso cria um banco novo (`kyvvo_restore_<timestamp>` por padrão, ou o
   nome passado como segundo argumento) e restaura o dump nele — **nunca**
   sobrescreve o banco em uso.
3. Validar os dados restaurados (contagem de linhas nas tabelas principais,
   conferir um registro conhecido, etc.) antes de promover o banco restaurado
   para produção.
4. Promoção pra produção (se necessário reverter um incidente): trocar a
   `DATABASE_URL`/apontamento do serviço Postgres do container da aplicação
   pro banco restaurado, ou renomear os bancos (`ALTER DATABASE ... RENAME
   TO ...`) — decisão operacional a ser tomada no momento do incidente, dado
   o impacto de downtime.

## Teste de restauração real — registro

Testado em 2026-07-27, usando o mesmo fluxo `pg_dump`/`psql` que os scripts
`backup-db.sh`/`restore-db.sh` executam (via Postgres 16 local, já que o
ambiente de execução não tem acesso à instância EC2 de produção — os
comandos usados são os mesmos, só a forma de invocar o Postgres muda: aqui
direto via `psql`/`pg_dump`, na EC2 via `docker compose exec`).

Passos executados:
1. Criado um banco de teste e aplicadas todas as migrations em
   `server/db/*.sql` (schema completo, 17 tabelas).
2. Inserido um registro de controle (`tenants` + `servicos` com um id
   conhecido).
3. Gerado o dump: `pg_dump --no-owner --no-privileges | gzip > dump.sql.gz`
   (mesmo comando usado por `backup-db.sh`).
4. Criado um banco novo e restaurado: `gunzip -c dump.sql.gz | psql ...`
   (mesmo fluxo de `restore-db.sh`).
5. Confirmado no banco restaurado:
   - As 17 tabelas do schema foram recriadas.
   - O registro de controle (`tenants.nome = 'Salao Teste Restore'`,
     `servicos.nome = 'Corte Teste Restore'`, `preco = 50.00`) veio íntegro.

Resultado: **restauração validada de ponta a ponta** (dump → restore →
dados íntegros). Pendência para uma validação ainda mais completa: repetir
este teste diretamente na EC2 de produção (com `docker compose exec`) na
próxima janela de manutenção, para confirmar também variáveis específicas
do ambiente real (nome do serviço Postgres, credenciais, tamanho do dump
com dados reais).

## Pendências (subtasks relacionadas)

- Rotina de retenção de backups — ver task ST14.3.
