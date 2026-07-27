#!/usr/bin/env bash
# Restaura um backup do banco Kyvvo (gerado por backup-db.sh).
# Ver docs/restore.md para o procedimento completo e o registro do teste
# de restauração real feito antes deste script ser adotado.
#
# Uso: restore-db.sh <arquivo .sql.gz> [nome_do_banco_destino]
#
# Por segurança, NUNCA restaura por cima do banco em uso: sempre cria um
# banco novo (default: kyvvo_restore_<timestamp>) e restaura nele, pra
# validar os dados antes de promover pra produção.
set -euo pipefail

COMPOSE_DIR="${COMPOSE_DIR:-/opt/kyvvo}"

if [ -f "$COMPOSE_DIR/.env" ]; then
  # shellcheck disable=SC1090
  set -a; source "$COMPOSE_DIR/.env"; set +a
fi

POSTGRES_SERVICE="${POSTGRES_SERVICE:-postgres}"
POSTGRES_USER="${POSTGRES_USER:-postgres}"

DUMP_FILE="${1:?Uso: restore-db.sh <arquivo .sql.gz> [nome_do_banco_destino]}"
TARGET_DB="${2:-kyvvo_restore_$(date -u +%Y%m%d_%H%M%S)}"

if [ ! -f "$DUMP_FILE" ]; then
  echo "Arquivo de dump não encontrado: $DUMP_FILE" >&2
  exit 1
fi

cd "$COMPOSE_DIR"

echo "Criando banco de destino '$TARGET_DB'..."
docker compose exec -T "$POSTGRES_SERVICE" createdb -U "$POSTGRES_USER" "$TARGET_DB"

echo "Restaurando $DUMP_FILE em '$TARGET_DB'..."
gunzip -c "$DUMP_FILE" | docker compose exec -T "$POSTGRES_SERVICE" psql -U "$POSTGRES_USER" -d "$TARGET_DB" -v ON_ERROR_STOP=1

echo "Restauração concluída em '$TARGET_DB'. Valide os dados antes de promover pra produção (ver docs/restore.md)."
