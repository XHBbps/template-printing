#!/usr/bin/env bash
# 首次部署 — 在干净 Ubuntu 服务器上跑一次
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

echo "==> 检查依赖"
command -v docker >/dev/null || { echo "请先安装 docker"; exit 1; }
command -v docker compose >/dev/null || { echo "请先安装 docker-compose v2"; exit 1; }

echo "==> 创建数据目录"
mkdir -p data/postgres data/redis data/storage data/certbot/conf data/certbot/www backups logs

echo "==> 校验 .env.prod 存在"
[[ -f .env.prod ]] || { echo "请先创建 .env.prod (参考 .env.prod.example)"; exit 1; }

# compose 用 env_file 注入容器内变量，但 ${REGISTRY}/${TAG}/${POSTGRES_PASSWORD}
# 这类「镜像 tag / URL 插值」发生在 shell→compose 层，必须存在于 shell 环境里，
# run/up 才能正确解析镜像名。这里显式 source 一次（GAP #2）。
echo "==> 载入 .env.prod 到 shell 环境（供 compose 插值 ${REGISTRY}/${TAG}）"
set -a
# shellcheck disable=SC1091
. ./.env.prod
set +a

echo "==> 拉取镜像"
docker compose -f docker-compose.prod.yml pull

# 关键顺序（GAP #3）：先起数据库 → 在 api 对外提供服务「之前」跑 migration →
# 再起应用层。否则空库时 api onModuleInit 触 P2021 崩溃循环，
# 而旧逻辑等 api healthy 才 migrate，会死锁在「永远不 healthy」。
echo "==> 先只启动数据存储（postgres / redis），等待 healthy"
docker compose -f docker-compose.prod.yml up -d --wait postgres redis

echo "==> 在 api 起服务前用一次性容器执行数据库 migration（--no-deps 不带起 web/render）"
docker compose -f docker-compose.prod.yml run --rm --no-deps api npx prisma migrate deploy

echo "==> migration 完成，启动应用层（除 nginx，因为还没 SSL 证书）"
docker compose -f docker-compose.prod.yml up -d api web render

echo "==> 等待 api 健康"
for i in {1..30}; do
  if docker compose -f docker-compose.prod.yml exec -T api wget -qO- http://localhost:3000/healthz >/dev/null 2>&1; then
    echo "✓ api healthy"
    break
  fi
  sleep 2
done

echo "==> 完成首次部署 — 接下来运行 ./init-ssl.sh <domain> 申请 SSL 证书"
