#!/usr/bin/env bash
# 拉新 image + 重启 + health check + 失败回滚
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

NEW_TAG="${1:?需要指定新版本 tag, 例如 v1.2.3}"

echo "==> 备份当前 .env.prod"
cp .env.prod ".env.prod.bak.$(date +%s)"

echo "==> 备份前先 dump 数据库"
./scripts/deploy/backup.sh

PREV_TAG=$(grep -oP '^TAG=\K.*' .env.prod || echo "latest")
echo "==> 当前版本: $PREV_TAG → 新版本: $NEW_TAG"

# Update .env.prod TAG
if grep -q '^TAG=' .env.prod; then
  sed -i.bak "s|^TAG=.*|TAG=$NEW_TAG|" .env.prod
else
  echo "TAG=$NEW_TAG" >> .env.prod
fi

echo "==> 拉新 image"
docker compose -f docker-compose.prod.yml pull

echo "==> 重启"
docker compose -f docker-compose.prod.yml up -d --remove-orphans

echo "==> 等待 api 健康（60s timeout）"
for i in {1..30}; do
  if docker compose -f docker-compose.prod.yml exec -T api wget -qO- http://localhost:3000/healthz >/dev/null 2>&1; then
    echo "✓ 部署成功"
    docker compose -f docker-compose.prod.yml exec -T api npx prisma migrate deploy
    exit 0
  fi
  sleep 2
done

echo "✗ health check 失败 — 自动回滚到 $PREV_TAG"
./scripts/deploy/rollback.sh "$PREV_TAG"
exit 1
