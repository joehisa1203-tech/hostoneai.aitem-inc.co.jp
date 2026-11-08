#!/usr/bin/env bash
# 最新版へ更新: sudo bash /opt/hostoneai/deploy/update.sh
set -euo pipefail
cd "${APP_DIR:-/opt/hostoneai}"
cp data/hostone.db "data/backup-$(date +%Y%m%d%H%M%S).db" 2>/dev/null || true
git pull --ff-only
docker compose up -d --build
docker image prune -f
