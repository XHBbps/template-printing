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

## 渲染健壮性与并发（大批量）

渲染 worker 采用双层防御:worker 进程内实时回收(坏页/坏浏览器)+ API 侧 cron 兜底(worker 被 kill 时复位僵尸任务)。相关 env(见 `.env.example`):

| Env | 默认 | 说明 |
|---|---|---|
| `RENDER_BROWSERS` × `RENDER_PAGES_PER_BROWSER` | 2×2=4 | **并发渲染数**。按容器内存上限设:单 Chromium 实例约数百 MB,`deviceScaleFactor=2` 的大幅面 PNG 内存翻倍。内存吃紧先降并发或降 scale。 |
| `RENDER_JOB_TIMEOUT_MS` | 60000 | 单 job 渲染硬超时,超时即失败并回收该页(释放池槽)。 |
| `RENDER_ACQUIRE_TIMEOUT_MS` | 30000 | 取空闲页的等待超时;取不到即失败重试,防挂死。 |
| `RENDER_LOCK_DURATION_MS` | 120000 | bullmq 任务锁时长。**不变量:必须 ≥ `RENDER_ACQUIRE_TIMEOUT_MS + RENDER_JOB_TIMEOUT_MS + 余量`**;否则跑超锁的 job 会被判 stalled 重复派发(双倍内存 + 重复产物)。改任一超时须同步保证此式。 |
| `RENDER_PAGE_MAX_USES` | 200 | 单页服务 N 次后主动回收,防长批量 Chromium 内存蠕变。 |
| `RENDER_STUCK_TIMEOUT_MIN` | 10 | `processing` 超 N 分钟由对账 cron(每 5 分钟)标 `stuck_timeout` 失败并补发回调。须 > bullmq 重试窗口,避免误杀重试中的 job。 |
| `RENDER_DEVICE_SCALE_FACTOR` | 2 | PNG 渲染倍率。**画质/体积 vs 内存取舍,非无损**:降为 1 省内存但输出分辨率/清晰度下降。 |

注意事项:
- **跨进程一致性**:worker 与 API 的文件签名 HMAC secret env 必须一致 —— 否则 signed URL 与对账 cron 补发回调的链路验签失败。
- **Chromium 省内存**:已默认带 `--disable-dev-shm-usage`、`--disable-extensions`;`--js-flags=--max-old-space-size` **谨慎可选**(截图 OOM 主因是光栅/GPU 缓冲,不在 V8 堆,限 old-space 压不住、反而可能让重模板提前 JS OOM),真正有效的是降并发 / 降 `deviceScaleFactor`。
- 对账 cron **只标失败 + 补发通知,不自动重排**(渲染非幂等),调用方按需重试。

## 本地开发端口约定

`docker-compose.dev.yml` 为了避开 Windows 常见保留端口段，将基础服务映射到非默认宿主机端口：

- Postgres：容器内 `postgres:5432`，宿主机 `localhost:6432`
- Redis：容器内 `redis:6379`，宿主机 `localhost:6479`

Compose 内部的 `api` / `render` 仍使用容器内地址；只有在宿主机直接运行迁移、测试或本地服务时才使用 `.env` 中的 `localhost:*` 地址。

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

## 飞书多维表格自动化对接

> 把"业务人员在多维表格点按钮 → 自动渲染 PDF → 写回附件"流程接到本平台。

### 飞书开放平台

- 自建应用启用以下权限（除 SSO 已有的之外）：
  - `bitable:app` — 读写多维表格
  - `drive:drive` — 上传文件到云空间
- 同一个 app 同时承担 SSO + bitable + drive 三套权限，无需新建 app

### 环境变量

`.env.prod` 新增：

```
# 业务人员在飞书自动化 webhook body 里也填同一值（双方对齐）
# 也用作 /lark/render-callback URL query 的 token
# 生成：openssl rand -hex 16
LARK_BITABLE_VERIFICATION_TOKEN=<openssl rand -hex 16 的真实值>

# 渲染 worker 回调 api 时用的 base URL（容器内部）
# 生产建议指向公网 HTTPS：https://print.<your-company>.com
API_INTERNAL_BASE=http://api:3000
```

### 业务人员接入

在飞书多维表格按钮自动化里：

- 触发器：点击按钮
- 操作："调用 webhook" → URL `https://<your-domain>/lark/print-trigger`
- Body 含 `verificationToken`（同 `LARK_BITABLE_VERIFICATION_TOKEN`）+ `templateId` + `data` + `lark.{appToken, tableId, recordId, statusField, attachmentField}`

完整 body 模板与配置截图见 `examples/lark-bitable/README.md`。

### 验证

```bash
curl -X POST https://<your-domain>/lark/print-trigger \
  -H "Content-Type: application/json" \
  -d '{"verificationToken":"<token>","templateId":"<tpl>","data":{},"lark":{"appToken":"...","tableId":"...","recordId":"...","statusField":"打印状态","attachmentField":"PDF 附件"}}'
# 应返回 {"jobId": "xxx", "status": "pending"}，几秒后多维表格行的状态字段变 "已完成" 且附件出现
```

## 不在 iter 19 范围内（待后续 iter）

- 监控告警（Prometheus / Grafana）
- 集中日志（ELK / Loki）
- CDN 接入（如需公网图片 / 静态加速）
- 数据库分片 / 高可用（单 master 足够初期）
