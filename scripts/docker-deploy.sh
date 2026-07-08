#!/usr/bin/env bash
# Build & (re)deploy the app as a Docker container on the target server.
#
#   ./scripts/docker-deploy.sh            # pull latest code, build, start
#   ./scripts/docker-deploy.sh --no-pull  # build & start from the checked-out code
#
# First run also migrates existing state into ./data (the container volume):
#   database/transfermarket.db  -> data/transfermarket.db
#   public/images/uploads/      -> data/uploads/
# and stops the old systemd service (transfermarket.service) if it is running,
# so the DB isn't copied mid-write and port 3000 is free.

set -euo pipefail
cd "$(dirname "$0")/.."

BRANCH="claude/transfermarket-clone-app-7Tkma"
DATA_DIR="data"

log() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
die() { printf '\033[1;31mERROR: %s\033[0m\n' "$*" >&2; exit 1; }

# ── Prerequisites ────────────────────────────────────────────────────────────
command -v docker >/dev/null || die "docker is not installed"

# Support both the V2 plugin ("docker compose") and the legacy standalone
# binary ("docker-compose", e.g. the 1.29.x Ubuntu package).
if docker compose version >/dev/null 2>&1; then
  DC="docker compose"
elif command -v docker-compose >/dev/null 2>&1; then
  DC="docker-compose"
else
  die "Neither 'docker compose' (V2 plugin) nor 'docker-compose' (V1) is available"
fi
log "Using compose command: $DC"

[ -f .env ] || die ".env not found. Create it first (JWT_SECRET is required), e.g.:
  JWT_SECRET=$(openssl rand -hex 32 2>/dev/null || echo '<random-secret>')
  TELEGRAM_BOT_TOKEN=...
  TELEGRAM_CHAT_ID=...
  TELEGRAM_LIVE_CHANNEL_ID=..."
grep -q '^JWT_SECRET=..*' .env || die "JWT_SECRET is missing or empty in .env"

# ── Update code ──────────────────────────────────────────────────────────────
# fetch + reset (not pull) so a mis-tracked branch or stray local edits on the
# deploy box can't block the update. Untracked files (./data, .env) are left
# untouched by reset.
if [ "${1:-}" != "--no-pull" ]; then
  log "Fetching latest code ($BRANCH)"
  git fetch origin "$BRANCH"
  git checkout -B "$BRANCH" "origin/$BRANCH"
  git reset --hard "origin/$BRANCH"
fi

# ── One-time migration of existing state into the volume ────────────────────
mkdir -p "$DATA_DIR"

if [ -f database/transfermarket.db ] && [ ! -f "$DATA_DIR/transfermarket.db" ]; then
  log "Migrating existing database into $DATA_DIR/"
  # Stop the old systemd service so we don't copy a DB that's being written.
  if command -v systemctl >/dev/null && systemctl is-active --quiet transfermarket.service; then
    echo "Stopping old transfermarket.service (needs sudo)..."
    sudo systemctl stop transfermarket.service
    sudo systemctl disable transfermarket.service || true
  fi
  cp -v database/transfermarket.db "$DATA_DIR/"
  # WAL sidecar files hold not-yet-checkpointed writes — must travel with the DB.
  for f in database/transfermarket.db-wal database/transfermarket.db-shm; do
    [ -f "$f" ] && cp -v "$f" "$DATA_DIR/"
  done
fi

if [ -d public/images/uploads ] && [ ! -d "$DATA_DIR/uploads" ]; then
  log "Migrating existing uploads into $DATA_DIR/uploads/"
  cp -rv public/images/uploads "$DATA_DIR/uploads"
fi

# The container runs as the unprivileged 'node' user (uid 1000).
if [ "$(stat -c %u "$DATA_DIR")" != "1000" ] && [ "$(id -u)" != "1000" ]; then
  echo "Fixing $DATA_DIR ownership for the container user (needs sudo)..."
  sudo chown -R 1000:1000 "$DATA_DIR"
fi

# ── Build & start ────────────────────────────────────────────────────────────
log "Building image"
$DC build

log "Starting container"
$DC up -d

log "Waiting for the app to become healthy"
for i in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:3000/api/health >/dev/null 2>&1; then
    log "Deployed OK — app is up on http://127.0.0.1:3000"
    $DC ps
    exit 0
  fi
  sleep 2
done

die "App did not become healthy within 60s. Check logs: $DC logs --tail=100"
