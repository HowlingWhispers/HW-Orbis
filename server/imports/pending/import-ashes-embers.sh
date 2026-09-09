#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
PENDING_DIR="$ROOT_DIR/server/imports/pending"
BACKUP_FILE="$PENDING_DIR/ashes-embers-2026-09-09.hw-world.json"
EXPECTED_SHA256="33a9d6806beb0ce3bb9af5451b6f0292a2f02f188ab6ceedb4ce9529266526ef"
OWNER_DISCORD_ID="1083764312490905650"

cat \
  "$PENDING_DIR/ashes-embers.part01.b64" \
  "$PENDING_DIR/ashes-embers.part02.b64" \
  "$PENDING_DIR/ashes-embers.part03.b64" \
  "$PENDING_DIR/ashes-embers.part04.b64" \
  "$PENDING_DIR/ashes-embers.part05.b64" \
  "$PENDING_DIR/ashes-embers.part06.b64" \
  "$PENDING_DIR/ashes-embers.part07.b64" \
  "$PENDING_DIR/ashes-embers.part08.b64" \
  | base64 -d | gzip -d > "$BACKUP_FILE"

ACTUAL_SHA256="$(sha256sum "$BACKUP_FILE" | awk '{print $1}')"
if [[ "$ACTUAL_SHA256" != "$EXPECTED_SHA256" ]]; then
  echo "Ashes & Embers reconstruction SHA mismatch." >&2
  echo "Expected: $EXPECTED_SHA256" >&2
  echo "Actual:   $ACTUAL_SHA256" >&2
  rm -f "$BACKUP_FILE"
  exit 1
fi

echo "Ashes & Embers backup reconstructed and verified."
echo "File: $BACKUP_FILE"
echo "SHA256: $ACTUAL_SHA256"

cd "$ROOT_DIR"

if [[ "${1:-}" == "--apply" ]]; then
  echo "Running transactional PRIVATE import for Nova..."
  npm run import:world-backup -- \
    --file "$BACKUP_FILE" \
    --owner-discord-id "$OWNER_DISCORD_ID" \
    --visibility private \
    --apply
else
  echo "Running DRY RUN only..."
  npm run import:world-backup -- \
    --file "$BACKUP_FILE" \
    --owner-discord-id "$OWNER_DISCORD_ID" \
    --visibility private
  echo
  echo "Dry run complete. If clean, rerun:"
  echo "  bash server/imports/pending/import-ashes-embers.sh --apply"
fi
