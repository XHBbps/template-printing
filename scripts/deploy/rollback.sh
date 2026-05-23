#!/usr/bin/env bash
# 回滚到指定 tag
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

ROLLBACK_TAG="${1:?需要指定回滚 tag, 例如 v1.2.2}"

echo "==> 回滚到 $ROLLBACK_TAG"
sed -i.bak "s|^TAG=.*|TAG=$ROLLBACK_TAG|" .env.prod

docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d --remove-orphans

echo "==> 完成回滚到 $ROLLBACK_TAG"
