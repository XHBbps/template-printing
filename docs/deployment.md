# 部署手册

> 目标：把项目部署到一台干净的 Ubuntu 22.04+ 服务器，公网可访问。

## 前置条件

- 服务器：Ubuntu 22.04+ / 2 核 4G / 50GB 磁盘起
- 公网 IP + 已解析的域名（A 记录）
- 已安装 `docker` + `docker-compose v2`
- 已开放 80 / 443 端口

## 一键首次部署

```bash
# 1. clone 项目到 /opt/template-printing
sudo git clone <repo> /opt/template-printing
cd /opt/template-printing

# 2. 准备环境变量
cp .env.prod.example .env.prod
vi .env.prod   # 填入实际值（密钥、域名等）

# 3. 跑首次部署脚本
./scripts/deploy/init.sh

# 4. 申请 SSL 证书 + 启动 nginx
./scripts/deploy/init-ssl.sh your-domain.com [email protected]
```

完成后 https://your-domain.com 即可访问。

## 后续更新

推荐通过 GitHub Actions 自动部署：

1. 在 GitHub repo Settings → Secrets 配置：
   - `DEPLOY_HOST` = 服务器 IP / 域名
   - `DEPLOY_USER` = 部署用户（通常是 `deploy` 或 `ubuntu`）
   - `DEPLOY_SSH_KEY` = 部署用户的 SSH 私钥
2. 给 commit 打 tag：`git tag v1.2.3 && git push --tags`
3. release workflow 自动 build + push image 到 GHCR
4. release published 自动触发 deploy workflow → SSH 到服务器执行 `update.sh`
5. update.sh 自动备份 + 拉新 image + 重启 + health check + 失败回滚

手动触发：GitHub 的 Actions → Deploy → Run workflow → 输入 tag。

## 备份

- 自动：每次部署前 `update.sh` 会先备份
- 手动：`./scripts/deploy/backup.sh`
- 保留：本地 7 天，更长期备份建议挂到外部存储

## 回滚

```bash
./scripts/deploy/rollback.sh v1.2.2
```

## 监控

- 日志：`docker compose -f docker-compose.prod.yml logs -f <service>`
- 容器状态：`docker compose -f docker-compose.prod.yml ps`
- 健康检查：`curl https://your-domain.com/api/healthz`

## SSL 证书续期

添加到 crontab：

```cron
0 3 * * 1 cd /opt/template-printing && docker run --rm -v "$PWD/data/certbot/conf:/etc/letsencrypt" -v "$PWD/data/certbot/www:/var/www/certbot" certbot/certbot renew && docker compose -f docker-compose.prod.yml exec nginx nginx -s reload
```

## 紧急情况

- **服务不可访问**：`docker compose -f docker-compose.prod.yml restart nginx api web`
- **数据库异常**：`docker compose -f docker-compose.prod.yml logs postgres`
- **回滚到上个 tag**：`./scripts/deploy/rollback.sh <prev-tag>`
- **完全重启 stack**：`docker compose -f docker-compose.prod.yml down && docker compose -f docker-compose.prod.yml up -d`

## 不在 iter 19 范围内（待后续 iter）

- 监控告警（Prometheus / Grafana）
- 集中日志（ELK / Loki）
- CDN 接入（如需公网图片 / 静态加速）
- 数据库分片 / 高可用（单 master 足够初期）
