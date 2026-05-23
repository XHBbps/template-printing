#!/usr/bin/env bash
# 首次签发 Let's Encrypt 证书。用法：./init-ssl.sh example.com [email protected]
set -euo pipefail

DOMAIN="${1:?需要指定域名}"
EMAIL="${2:?需要指定邮箱}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

echo "==> 准备 webroot"
mkdir -p data/certbot/www data/certbot/conf

echo "==> 启动一个最小 nginx 处理 ACME challenge"
cat > /tmp/nginx-acme.conf <<EOF
server {
  listen 80;
  server_name $DOMAIN;
  location /.well-known/acme-challenge/ { root /var/www/certbot; }
  location / { return 200 "ok"; }
}
EOF

docker run --rm -d --name tp-acme-nginx \
  -p 80:80 \
  -v /tmp/nginx-acme.conf:/etc/nginx/conf.d/default.conf:ro \
  -v "$PWD/data/certbot/www":/var/www/certbot \
  nginx:1.27-alpine

echo "==> 申请证书"
docker run --rm \
  -v "$PWD/data/certbot/conf":/etc/letsencrypt \
  -v "$PWD/data/certbot/www":/var/www/certbot \
  certbot/certbot certonly --webroot -w /var/www/certbot \
  -d "$DOMAIN" --email "$EMAIL" --agree-tos --non-interactive

docker stop tp-acme-nginx

echo "==> 替换 nginx 配置中的 __DOMAIN__"
sed -i.bak "s|__DOMAIN__|$DOMAIN|g" docker/nginx/conf.d/template-printing.conf

echo "==> 启动 nginx"
docker compose -f docker-compose.prod.yml up -d nginx

echo "==> 完成！https://$DOMAIN 应该可访问"
echo "==> 提示：把 'certbot renew' 加到 crontab（每周一次）"
