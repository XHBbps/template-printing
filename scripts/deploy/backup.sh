#!/usr/bin/env bash
# 备份 postgres + storage 到 ./backups/
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

TIMESTAMP=$(date +%Y%m%d-%H%M%S)
BACKUP_DIR="./backups/$TIMESTAMP"
mkdir -p "$BACKUP_DIR"

echo "==> 备份 postgres"
source .env.prod
docker compose -f docker-compose.prod.yml exec -T postgres \
  pg_dump -U "${POSTGRES_USER:-postgres}" "${POSTGRES_DB:-template_printing}" \
  | gzip > "$BACKUP_DIR/postgres.sql.gz"

echo "==> 备份 storage"
tar czf "$BACKUP_DIR/storage.tar.gz" -C data storage

echo "==> 清理 7 天前的旧备份"
find ./backups -mindepth 1 -maxdepth 1 -type d -mtime +7 -exec rm -rf {} +

echo "==> 完成：$BACKUP_DIR"
du -sh "$BACKUP_DIR"
