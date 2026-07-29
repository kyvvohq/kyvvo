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
#
# Se BACKUP_S3_BUCKET estiver definido, também envia o dump pra esse bucket
# (via aws-cli) logo após criá-lo localmente. Assume credenciais AWS já
# disponíveis no host (IAM role da instância EC2, ou variáveis
# AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY no /opt/kyvvo/.env).
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
BACKUP_S3_BUCKET="${BACKUP_S3_BUCKET:-}"
BACKUP_S3_PREFIX="${BACKUP_S3_PREFIX:-kyvvo-db}"

TIMESTAMP="$(date -u +%Y%m%d_%H%M%S)"
FILENAME="kyvvo_${TIMESTAMP}.sql.gz"
DEST="$BACKUP_DIR/$FILENAME"
TMP_DEST="${DEST}.tmp"

mkdir -p "$BACKUP_DIR"
cd "$COMPOSE_DIR"

docker compose exec -T "$POSTGRES_SERVICE" \
  pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --no-privileges \
  | gzip > "$TMP_DEST"

mv "$TMP_DEST" "$DEST"
echo "Backup criado em $DEST"

if [ -n "$BACKUP_S3_BUCKET" ]; then
  if ! command -v aws >/dev/null 2>&1; then
    echo "aws-cli não encontrado no host — pulando envio pro S3 (BACKUP_S3_BUCKET=$BACKUP_S3_BUCKET definido, mas o binário 'aws' não está instalado)." >&2
    exit 1
  fi
  aws s3 cp "$DEST" "s3://${BACKUP_S3_BUCKET}/${BACKUP_S3_PREFIX}/${FILENAME}"
  echo "Backup enviado para s3://${BACKUP_S3_BUCKET}/${BACKUP_S3_PREFIX}/${FILENAME}"
else
  echo "BACKUP_S3_BUCKET não definido — mantendo backup só localmente em $BACKUP_DIR." >&2
fi
