#!/usr/bin/env bash
set -euo pipefail

# Isolated PostgreSQL Restore & Integrity Verification Script — MyOwn BillBook
# Usage: ./scripts/verify-restore.sh /path/to/billing_db_YYYYMMDD.dump[.enc]

DUMP_INPUT="${1:-}"
if [[ -z "${DUMP_INPUT}" || ! -f "${DUMP_INPUT}" ]]; then
  echo "Usage: $0 <path-to-backup.dump-or-.enc>" >&2
  exit 1
fi

if [[ -z "${DATABASE_URL:-}" && -f ".env" ]]; then
  DATABASE_URL="$(grep -E '^DATABASE_URL=' .env | head -n 1 | cut -d '=' -f 2- | tr -d '"' | tr -d "'")"
fi

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "ERROR: DATABASE_URL is not set." >&2
  exit 1
fi

if [[ -f "${DUMP_INPUT}.sha256" ]]; then
  sha256sum -c "${DUMP_INPUT}.sha256"
fi

TMP_DUMP="/tmp/verify_restore_$$.dump"
TMP_DB="billing_restore_verify_$$"
PG_URL="${DATABASE_URL%%\?*}"
ADMIN_URL="$(node -e "const u = new URL(process.argv[1]); u.pathname='/postgres'; u.search=''; console.log(u.toString());" "${PG_URL}")"
TARGET_URL="$(node -e "const u = new URL(process.argv[1]); u.pathname='/${TMP_DB}'; u.search=''; console.log(u.toString());" "${PG_URL}")"

cleanup() {
  rm -f "${TMP_DUMP}"
  psql "${ADMIN_URL}" -c "DROP DATABASE IF EXISTS \"${TMP_DB}\";" >/dev/null 2>&1 || true
}
trap cleanup EXIT

if [[ "${DUMP_INPUT}" == *.enc ]]; then
  if [[ -z "${BACKUP_ENCRYPTION_KEY:-}" ]]; then
    echo "ERROR: BACKUP_ENCRYPTION_KEY required to decrypt ${DUMP_INPUT}" >&2
    exit 1
  fi
  openssl enc -d -aes-256-cbc -pbkdf2 -in "${DUMP_INPUT}" -out "${TMP_DUMP}" -pass env:BACKUP_ENCRYPTION_KEY
else
  cp "${DUMP_INPUT}" "${TMP_DUMP}"
fi

psql "${ADMIN_URL}" -c "CREATE DATABASE \"${TMP_DB}\";" >/dev/null
pg_restore --no-owner --no-acl -d "${TARGET_URL}" "${TMP_DUMP}"

COUNTS="$(psql "${TARGET_URL}" -tAc "SELECT (SELECT count(*) FROM companies), (SELECT count(*) FROM sales_invoices), (SELECT count(*) FROM vouchers), (SELECT count(*) FROM journal_entries);")"
UNBALANCED="$(psql "${TARGET_URL}" -tAc "SELECT count(*) FROM (SELECT voucher_id FROM journal_entries GROUP BY voucher_id HAVING SUM(debit_amount) != SUM(credit_amount)) t;")"

echo "RESTORE_VERIFY_OK db=${TMP_DB} counts(companies|invoices|vouchers|entries)=${COUNTS} unbalanced_vouchers=${UNBALANCED}"
if [[ "${UNBALANCED}" != "0" ]]; then
  echo "ERROR: Unbalanced vouchers detected in restored database!" >&2
  exit 1
fi
