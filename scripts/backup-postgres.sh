#!/usr/bin/env bash
set -euo pipefail

# Production PostgreSQL Automated Backup Script — MyOwn BillBook
# Usage: DATABASE_URL=... [BACKUP_DIR=...] [BACKUP_RETENTION_DAYS=14] [BACKUP_ENCRYPTION_KEY=...] ./scripts/backup-postgres.sh

BACKUP_DIR="${BACKUP_DIR:-/var/backups/myownbillbook}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"
TIMESTAMP="$(date -u +%Y%m%d_%H%M%SZ)"
LOG_PREFIX="[backup-postgres ${TIMESTAMP}]"

if [[ -z "${DATABASE_URL:-}" ]]; then
  if [[ -f ".env" ]]; then
    DATABASE_URL="$(grep -E '^DATABASE_URL=' .env | head -n 1 | cut -d '=' -f 2- | tr -d '"' | tr -d "'")"
  fi
fi

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "${LOG_PREFIX} ERROR: DATABASE_URL is not set." >&2
  exit 1
fi

# Strip Prisma-specific ?schema= query param so pg_dump accepts the URI
PG_URL="${DATABASE_URL%%\?*}"

mkdir -p "${BACKUP_DIR}"
chmod 700 "${BACKUP_DIR}"

RAW_DUMP="${BACKUP_DIR}/billing_db_${TIMESTAMP}.dump"
FINAL_ARTIFACT="${RAW_DUMP}"

notify_failure() {
  local msg="$1"
  echo "${LOG_PREFIX} FAILURE: ${msg}" >&2
  if [[ -n "${BACKUP_ALERT_WEBHOOK:-}" ]]; then
    curl -fsS -X POST -H "Content-Type: application/json" \
      -d "{\"text\":\"MyOwn BillBook Backup Failed (${TIMESTAMP}): ${msg}\"}" \
      "${BACKUP_ALERT_WEBHOOK}" >/dev/null 2>&1 || true
  fi
}

trap 'notify_failure "Unexpected error on line $LINENO"' ERR

echo "${LOG_PREFIX} Starting pg_dump..."
pg_dump -Fc --no-owner --no-acl "${PG_URL}" -f "${RAW_DUMP}"

echo "${LOG_PREFIX} Verifying dump archive readability..."
pg_restore --list "${RAW_DUMP}" >/dev/null

if [[ -n "${BACKUP_ENCRYPTION_KEY:-}" ]]; then
  ENC_FILE="${RAW_DUMP}.enc"
  echo "${LOG_PREFIX} Encrypting dump with AES-256-CBC (PBKDF2)..."
  openssl enc -aes-256-cbc -pbkdf2 -salt -in "${RAW_DUMP}" -out "${ENC_FILE}" -pass env:BACKUP_ENCRYPTION_KEY
  rm -f "${RAW_DUMP}"
  FINAL_ARTIFACT="${ENC_FILE}"
fi

chmod 600 "${FINAL_ARTIFACT}"
sha256sum "${FINAL_ARTIFACT}" > "${FINAL_ARTIFACT}.sha256"

if [[ -n "${BACKUP_OFFSITE_CMD:-}" ]]; then
  echo "${LOG_PREFIX} Syncing artifact to off-site target..."
  eval "${BACKUP_OFFSITE_CMD} \"${FINAL_ARTIFACT}\" \"${FINAL_ARTIFACT}.sha256\""
fi

echo "${LOG_PREFIX} Pruning backups older than ${RETENTION_DAYS} days..."
find "${BACKUP_DIR}" -maxdepth 1 -type f \( -name "billing_db_*.dump*" \) -mtime "+${RETENTION_DAYS}" -delete

echo "${LOG_PREFIX} SUCCESS: ${FINAL_ARTIFACT} ($(du -h "${FINAL_ARTIFACT}" | cut -f1))"
