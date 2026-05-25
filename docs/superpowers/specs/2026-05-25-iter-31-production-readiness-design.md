# iter 31 · 生产就绪三件套 · 设计

**日期**：2026-05-25
**作者**：Claude Code
**范围**：apps/api（生产就绪基础设施）
**目标用户规模**：扬力集团 2000+ 办公人员

---

## 1. 背景

iter 30 系列完成扬力品牌 UI 后，应用尚未具备对 2000 人开放的生产就绪条件。三个 blocker 必须在上线前解决：

### 1.1 Signed URL · 防越权（合规红线）

**问题**：当前 render 输出 URL 形如 `/uploads/render/<jobId>.pdf`，通过 `ServeStaticModule` 直接挂载到 `STORAGE_ROOT/` 下，**无任何鉴权**。

2000 人内部应用中，PDF URL 通过飞书 IM / 邮件 / 截图等渠道传播，跨部门 / 外网泄露不可避免。任何人拿到 URL = 能下载文件 = 跨权限访问敏感数据（出货单 / 验收凭证 / 合格证）= 合规违规。

**目标**：URL 携带 HMAC 签名 + 过期时间。

### 1.2 失败重试 + API rate limit · 可用性 + 防滥用

**问题 A（重试）**：当前 render worker 失败即终态。Puppeteer 在 2000 人 ~50 QPS 压力下，OOM / 浏览器崩溃 / 字体加载抖动等暂时性错误是日常。无重试 = 每次抖动用户重做 = 工单堆积。

**问题 B（rate limit）**：`POST /api/render` 无 QPS 限制。单个 Bearer token 被恶意脚本或 bug 滥用，可以瞬间打满队列 + 磁盘。

**目标**：bullmq attempts + 区分永久 vs 暂时性错误；`@nestjs/throttler` 限频 30 req/min。

### 1.3 Quota + auto cleanup · 容量

**问题 A（quota）**：单用户每日渲染无上限。2000 人 × 100/天 = 20 万次/天 = 系统压垮。

**问题 B（清理）**：render 输出文件永不清理。保守估算 10 MB/PDF × 2000 人 × 5/天 = 100 GB/天 = 几天磁盘必满。

**目标**：单用户日配额 200 次（可配置）；30 天以上输出文件自动清理（保留 DB 记录用于审计）。

---

## 2. 三个组件的详细设计

### 2.1 Signed URL

#### 架构

- 复用现有 `FILE_SIG_SECRET`（已在 `env.ts` 定义为 min 32 chars，专为此预留）。
- 把 `/uploads/render/*` 从 `ServeStaticModule` 的服务范围排除。
- 新 controller `SignedUploadsController` 监听 `GET /uploads/render/:filename`：
  - 校验 query `?token=<base64HMAC>.<expiryUnix>`
  - HMAC = `HMAC-SHA256(FILE_SIG_SECRET, filename + ':' + expiryUnix)`
  - 校验 `expiryUnix > now`
  - 通过则 `res.sendFile(STORAGE_ROOT/render/<filename>)`；否则 401
- 新工具 `FileSigService`：
  - `sign(filename: string, ttlSec: number = 86400): string` → 返 base64 token
  - `verify(filename: string, token: string): boolean`

#### URL 生成位置

`RenderService` worker 完成时把 `pdfUrl` 从 `/uploads/render/<jobId>.pdf` 升级到 `/uploads/render/<jobId>.pdf?token=<sig>`。

#### TTL 策略

- 默认 24 小时（86400 秒）
- 浏览器下载 / 飞书 IM 转发场景 24 小时够用
- 可后续按业务需求调整为 7 天等

#### 兼容性

- `/uploads/<imageHash>.<ext>`（用户上传的图片）继续走 `ServeStaticModule`，不强制签名 — 图片本身是模板素材，不含业务数据
- 只 `/uploads/render/*` 路径走签名验证

---

### 2.2 渲染失败重试

#### bullmq 配置

```ts
this.queue.add('render', jobData, {
  attempts: 3,
  backoff: { type: 'exponential', delay: 2000 },  // 2s, 4s, 8s
  removeOnComplete: { count: 1000 },  // 保留最近 1000 完成
  removeOnFail: { count: 1000 },
});
```

#### 错误分类

worker 抛错时区分两类：

- **Permanent**（不重试）：模板不存在 / data 校验失败 / 不可恢复的渲染错误
  - 抛 `RenderPermanentError` 自定义错误
  - worker 在 `try/catch` 内捕获后再 throw 普通 Error，bullmq 视作永久失败 → 立即转 failed
- **Transient**（重试）：Puppeteer crash / 字体加载超时 / 网络抖动 / Redis 临时不可用
  - 抛普通 Error → bullmq 按 attempts 重试

#### DB 字段

`render_jobs` 加 `attempts_made INT NOT NULL DEFAULT 1`，每次 retry +1。前端 `/logs` 可看到。

---

### 2.3 API rate limit

#### 包

`@nestjs/throttler` v6.x（与 nest 10 兼容）。

#### 配置

- 全局默认：60 req/min（其他 endpoint）
- `POST /api/render` 单独：**30 req/min** per identifier
- Identifier 优先级：
  1. Bearer token id（已通过 `ApiAuthGuard` 注入 req.user.sub）
  2. 用户 id（cookie 路径）
  3. fallback IP（应避免命中此路径，所有 render 调用都需鉴权）

#### 错误响应

429 Too Many Requests + header `Retry-After: <seconds>`

---

### 2.4 渲染 quota

#### 策略

- 默认 200 次/用户/日（可配置 `RENDER_QUOTA_PER_USER_DAILY=200`）
- enqueue 前 query：
  ```sql
  SELECT COUNT(*) FROM render_jobs
  WHERE owner_id = $1 AND created_at >= date_trunc('day', NOW())
  ```
- 超限 429 + body `{ ok: false, error: { code: 'QUOTA_EXCEEDED', used: 200, limit: 200, resetAt: '2026-05-26T00:00:00Z' } }`

#### 例外

- Lark webhook 触发（无 ownerId）→ 不计入用户配额
- admin / emergency_admin 不限（可后续调整）

---

### 2.5 自动清理 cron

#### 包

`@nestjs/schedule` v4.x（与 nest 10 兼容）。

#### Cron

每日 03:00 触发 `RenderCleanupService.cleanupOldOutputs()`：

```ts
@Cron('0 3 * * *')
async cleanupOldOutputs(): Promise<void> {
  const cutoff = new Date(Date.now() - 30 * 86400 * 1000);
  const oldJobs = await this.prisma.renderJob.findMany({
    where: { createdAt: { lt: cutoff }, cleanedAt: null, status: { in: ['done', 'failed'] } },
    select: { id: true, pdfUrl: true, pngUrl: true },
  });
  for (const j of oldJobs) {
    if (j.pdfUrl) await safeUnlink(path.join(STORAGE_ROOT, 'render', `${j.id}.pdf`));
    if (j.pngUrl) await safeUnlink(path.join(STORAGE_ROOT, 'render', `${j.id}.png`));
  }
  await this.prisma.renderJob.updateMany({
    where: { id: { in: oldJobs.map((j) => j.id) } },
    data: { cleanedAt: new Date(), pdfUrl: null, pngUrl: null },
  });
}
```

#### DB 字段

`render_jobs` 加 `cleaned_at TIMESTAMPTZ NULL`。

#### 行为

- 保留 DB 记录用于审计 / 渲染日志页（管理员仍能看到「30 天前 已清理」状态）
- `/logs` 详情 dialog 中 PDF / PNG 下载按钮在 `cleanedAt != null` 时不显示

---

## 3. 配置项

新增 / 沿用 ENV：

| 变量 | 默认 | 说明 |
|---|---|---|
| `FILE_SIG_SECRET` | 已有，min 32 | HMAC 签名密钥 |
| `FILE_SIG_TTL_SEC` | 86400 (24h) | signed URL 默认 TTL |
| `RENDER_QUOTA_PER_USER_DAILY` | 200 | 单用户日配额 |
| `RENDER_RATE_LIMIT_PER_MIN` | 30 | 单标识每分钟最大请求数 |
| `RENDER_CLEANUP_DAYS` | 30 | 多少天后清理输出文件 |

`.env.example` 同步加这些（值用占位）。

---

## 4. 数据库迁移

```sql
ALTER TABLE render_jobs ADD COLUMN attempts_made INT NOT NULL DEFAULT 1;
ALTER TABLE render_jobs ADD COLUMN cleaned_at TIMESTAMPTZ;
```

Prisma schema 同步加这两列；生成迁移 `add_render_attempts_and_cleanup`。

---

## 5. 不在本 PR 范围

- 观测性接入（Prometheus / Grafana / Sentry）— iter 32
- 审计日志（who did what when）— iter 32
- Admin 用户管理 CRUD — iter 32+
- 横向扩展 / k8s 部署 — 单独的 ops PR
- 生产 render Dockerfile 优化（多阶段构建）— 单独 ops PR

---

## 6. 验收 checklist

- [ ] curl `/uploads/render/<id>.pdf` 不带 token → 401
- [ ] curl `/uploads/render/<id>.pdf?token=<sig>` 带正确 token → 200 + 文件流
- [ ] 篡改 token / 过期 token → 401
- [ ] 用户上传图片 `/uploads/<hash>.png` 不需 token（保持兼容）
- [ ] bullmq job 第 1 次失败（transient）→ 自动重试到第 3 次
- [ ] permanent 错误（template_not_found）不重试
- [ ] `POST /api/render` 单 token 30 req/min 后返 429 + Retry-After
- [ ] 单用户当日 201 次 enqueue → 429 with QUOTA_EXCEEDED
- [ ] cron 触发 cleanup → 30 天前的 PDF 文件被删，DB 记录 cleanedAt 被填
- [ ] 渲染日志页对 cleanedAt != null 的 job 不显示下载按钮
- [ ] file-sig 单测：sign + verify 往返；篡改检测；过期检测
- [ ] render-retry 单测：transient vs permanent 错误分类

---

**末**
