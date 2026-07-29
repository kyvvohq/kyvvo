#!/usr/bin/env bash
# Backup do banco Postgres de produção (Kyvvo).
# Roda na EC2 via cron — ver .github/workflows/deploy-backup.yml para o
# deploy do script e instalação do agendamento, e docs/backup.md para
# detalhes operacionais.
#
# Assume que o Postgres roda como serviço "postgres" no docker-compose.yml
# do host (/opt/kyvvo). Ajuste POSTGRES_SERVICE/POSTGRES_USER/POSTGRES_DB
# via variáveis de ambiente (ou no /opt/kyvvo/.env carregado abaixo) se o
# nome real do serviço/credenciais forem diferentes.
set -euo pipefail

COMPOSE_DIR="${COMPOSE_DIR:-/opt/kyvvo}"

if [ -f "$COMPOSE_DIR/.env" ]; then
  # shellcheck disable=SC1090
  set -a; source "$COMPOSE_DIR/.env"; set +a
fi

POSTGRES_SERVICE="${POSTGRES_SERVICE:-postgres}"
POSTGRES_USER="${POSTGRES_USER:-postgres}"
POSTGRES_DB="${POSTGRES_DB:-railway}"
BACKUP_DIR="${BACKUP_DIR:-/opt/kyvvo/backups}"

TIMESTAMP="$(date -u +%Y%m%d_%H%M%S)"
DEST="$BACKUP_DIR/kyvvo_${TIMESTAMP}.sql.gz"
TMP_DEST="${DEST}.tmp"

mkdir -p "$BACKUP_DIR"
cd "$COMPOSE_DIR"

docker compose exec -T "$POSTGRES_SERVICE" \
  pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --no-privileges \
  | gzip > "$TMP_DEST"

mv "$TMP_DEST" "$DEST"
echo "Backup criado em $DEST"
