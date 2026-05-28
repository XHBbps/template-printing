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

> **顺序说明（GAP#3 修复）**：`init.sh` 在 api 对外提供服务**之前**先用一次性容器执行 `prisma migrate deploy`——即「先起 `postgres`/`redis` → `docker compose run --rm --no-deps api npx prisma migrate deploy` → 再起 `api web render`」。空库时若先起 api，其 `EmergencyAdminBootstrap` 会触 `P2021: table … does not exist`；因此 api 侧也做了防御：表/列不存在时仅警告并跳过 bootstrap，不再崩溃循环（下次启动迁移完成后再建超管）。`update.sh` 同样在重启 api 前先 `run --rm` 迁移。两脚本会 `set -a; . ./.env.prod; set +a` 把 `REGISTRY/TAG/POSTGRES_PASSWORD` 载入 shell，保证镜像名 `${REGISTRY}/...:${TAG}` 在 `run`/`up` 时正确插值。

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

## 存储清理与保留(批次3)

API 侧 cron(`render-cleanup.service.ts`)按 env 周期清理长期增长的存储/表,默认值适合大多数部署,设 0/≤0 即关闭该项。相关 env(见 `.env.example`):

| Env | 默认 | 说明 |
|---|---|---|
| `RENDER_CLEANUP_DAYS` | 30 | 渲染产物(`cleanupOldOutputs`)保留天数,删 `STORAGE_ROOT/uploads/render/` 下 N 天前文件。≤0=关。 |
| `UPLOAD_ORPHAN_GRACE_DAYS` | 7 | 孤儿上传图片清理宽限。删 `STORAGE_ROOT/uploads/` 顶层中未被任何模板引用、且 mtime 早于 N 天的文件(render/ 子目录不在此列)。≤0=关。 |
| `AUDIT_LOG_RETENTION_DAYS` | 90 | 审计日志(`audit_log`)保留天数,删 `createdAt` 早于 N 天的行。≤0=关。 |
| `BOT_SESSION_RETENTION_DAYS` | 30 | 飞书机器人会话(`lark_bot_sessions`)中 `done`/`failed` 终态保留天数,删 `updatedAt` 早于 N 天的行(进行中会话不删)。≤0=关。 |

注意事项:
- **路径修正(批次3)**:本批修复了 `RENDER_DIR` 漏 `uploads/` 的路径 bug —— 渲染产物清理(`cleanupOldOutputs`)与签名下载现正确指向 `STORAGE_ROOT/uploads/render/`(此前清理删错路径、签名下载 404)。
- 清理 cron 与渲染对账 cron 同在 API 进程内调度;render worker 不参与清理。

## 渲染可靠性(批次4)

渲染失败/异常路径的三层加固:**状态机单调性**(杜绝重复脏写)+ **回调失败补发**(扛外部 webhook 偶发 5xx)+ **stuck_timeout 告警**(暴露 worker OOM/崩溃)。相关 env(见 `.env.example`):

| Env | 默认 | 说明 |
|---|---|---|
| `CALLBACK_RESEND_MAX_ATTEMPTS` | 5 | 回调失败补发最大次数。补发 cron(每 5 分钟)对 `callbackStatus='failed'` 的终态 job 重发回调;达上限仍失败则置永久 `failed` 不再补发。**≤0=关**(完全不补发)。 |

### 回调失败补发

渲染完成(done/failed)后 worker 回调外部 `callbackUrl`,若对方返回非 2xx/超时,仅记 `callbackStatus='failed'` —— 此前会静默丢通知。本批新增 API 侧补发 cron `resendFailedCallbacks()`(`render-cleanup.service.ts`,`@Cron(EVERY_5_MINUTES)`):

- **退避公式(钉死)**:资格 = `completedAt + (5 * 2^callbackAttempts) 分钟 <= now`。`callbackAttempts` 从 0 递增,实际补发落在 **completedAt + 5 / 10 / 20 / 40 / 80 分钟**,5 次共 **horizon ≈ 80min**。
- 超过 horizon(`callbackAttempts >= CALLBACK_RESEND_MAX_ATTEMPTS`)仍失败 → 置永久 `failed` 不再补发(扛不住消费方长于 80min 的宕机,属可接受取舍)。
- **计数语义**:`callback_attempts` 列只表达"补发 cron 已发的次数";worker 初次回调与对账 cron 的 `sendStuckCallback` 只置 `callbackStatus`、不动 `callback_attempts`。
- **外部调用方必须按 jobId 幂等去重**:补发与 bullmq stalled 重投都可能让同一 job 的回调被重复投递,消费端须以 `jobId` 为幂等键去重(如:已处理过的 jobId 直接返回 200 跳过)。
- **飞书内部回调恒 HTTP 200**(`lark-bitable.controller.ts` 的 `renderCallback` 即便内部 bitable 写失败也 `return {ok:true}`),故 worker 永远把飞书路径记为 `sent` —— 补发**实际只服务外部 `callbackUrl` 调用方**,飞书侧不会触发补发。

### 状态机单调性(P0)

**不变量:终态(done/failed)一旦写入不可被覆盖。** 修掉 bullmq stalled 晚到执行 / 对账 cron 快照窗口覆盖已有终态导致的 DB 与回调不一致、重复渲染、重复写回飞书:

- **render `db.ts`** `markDone`/`markFailed`:UPDATE 加 `AND status NOT IN ('done','failed')`(终态粘性),返回受影响行数。
- **render `main.ts`**:`fetchJob` 后若已终态直接短路 `return`(挡"开跑前已终态"的 stalled 重投);`markDone`/`markFailed` **仅当真翻转了终态(rowCount > 0)才 `sendCallback`**(挡"渲染中被 cron 抢先标 failed"后 worker 再发一次成功回调)。
- **API 对账 cron** `reconcileStuckJobs`:由逐行 update 改为 `updateMany({where:{id, status:'processing'}})`,**仅 `count===1`(真翻转)才 `sendStuckCallback`**(挡 findMany 快照与 update 之间该行已 `markDone` 的覆盖)。
- **飞书回调 handler 幂等守卫**:bitable / bot 两侧 `renderCallback` 顶部对已 `done` 的请求短路返回,杜绝 stalled 重投 / 补发导致的重复上传 PDF + 重复写回多维表格。

### stuck_timeout 告警

对账 cron 把 `processing` 超 `RENDER_STUCK_TIMEOUT_MIN` 的 job 翻成 `stuck_timeout` 失败时,会 inc 指标 `tp_render_jobs_total{status="stuck_timeout", source="cron"}`。**该指标持续 >0 是系统性信号 —— 通常代表 render worker OOM 或崩溃被 kill(任务卡在 processing 无人推进)**,而非个别业务失败,应配 Prometheus 告警:

```yaml
- alert: RenderWorkerStuckJobs
  expr: increase(tp_render_jobs_total{status="stuck_timeout"}[15m]) > 0
  for: 5m
  labels: { severity: warning }
  annotations:
    summary: "render worker 出现 stuck_timeout(疑似 OOM/崩溃)"
```

触发后应优先排查 render 容器:`docker compose -f docker-compose.prod.yml logs render`(看 OOMKilled / 崩溃栈)+ 容器内存是否撞 `mem_limit`(内存吃紧先降 `RENDER_BROWSERS`×`RENDER_PAGES_PER_BROWSER` 或 `RENDER_DEVICE_SCALE_FACTOR`,见上「渲染健壮性与并发」)。

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
# 生成：openssl rand -hex 16
LARK_BITABLE_VERIFICATION_TOKEN=<openssl rand -hex 16 的真实值>

# render worker → /lark/render-callback 内部回调专用 secret
# 与外部飞书 webhook token 分离（任一泄露不互相牵连）；常量时间比较校验
# 生成：openssl rand -hex 16
RENDER_CALLBACK_SECRET=<openssl rand -hex 16 的真实值>

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
