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

# 载入 .env.prod 到 shell（供 compose 插值 ${REGISTRY}/${TAG}/${POSTGRES_PASSWORD}，GAP #2）
set -a
# shellcheck disable=SC1091
. ./.env.prod
set +a

echo "==> 拉新 image"
docker compose -f docker-compose.prod.yml pull

# 与 init.sh 一致（GAP #3）：在新 api 起服务「之前」跑 migration。
# 若新版本含针对运行中旧 api 还不认识的列的迁移，先 migrate 更安全。
echo "==> 确保数据存储就绪"
docker compose -f docker-compose.prod.yml up -d --wait postgres redis

echo "==> 在重启 api 前用一次性容器执行数据库 migration"
docker compose -f docker-compose.prod.yml run --rm --no-deps api npx prisma migrate deploy

echo "==> 重启"
docker compose -f docker-compose.prod.yml up -d --remove-orphans

echo "==> 等待 api 健康（60s timeout）"
for i in {1..30}; do
  if docker compose -f docker-compose.prod.yml exec -T api wget -qO- http://localhost:3000/healthz >/dev/null 2>&1; then
    echo "✓ 部署成功"
    exit 0
  fi
  sleep 2
done

echo "✗ health check 失败 — 自动回滚到 $PREV_TAG"
./scripts/deploy/rollback.sh "$PREV_TAG"
exit 1
