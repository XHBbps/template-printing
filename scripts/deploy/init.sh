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

echo "==> 拉取镜像"
docker compose -f docker-compose.prod.yml pull

echo "==> 启动 stack（除 nginx，因为还没 SSL 证书）"
docker compose -f docker-compose.prod.yml up -d postgres redis api web render

echo "==> 等待 api 健康"
for i in {1..30}; do
  if docker compose -f docker-compose.prod.yml exec -T api wget -qO- http://localhost:3000/healthz >/dev/null 2>&1; then
    echo "✓ api healthy"
    break
  fi
  sleep 2
done

echo "==> 运行数据库 migration"
docker compose -f docker-compose.prod.yml exec -T api npx prisma migrate deploy

echo "==> 完成首次部署 — 接下来运行 ./init-ssl.sh <domain> 申请 SSL 证书"
