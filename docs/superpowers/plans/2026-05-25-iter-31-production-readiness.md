# iter 31 · 生产就绪三件套 · 实施计划

**Spec**：[`docs/superpowers/specs/2026-05-25-iter-31-production-readiness-design.md`](../specs/2026-05-25-iter-31-production-readiness-design.md)
**分支**：`feature/iter-31-production-readiness`

---

## 目标

为 2000 人集团生产部署解决 3 个 blocker：Signed URL（防越权） + 渲染重试 (+ rate limit)（可用性 + 防滥用） + Quota & 清理（容量）。

---

## 任务清单

### T1 · Signed URL

1. 新建 `apps/api/src/uploads/file-sig.service.ts`：`sign(filename, ttlSec)` / `verify(filename, token)`
2. 新建 `apps/api/src/uploads/signed-uploads.controller.ts`：`GET /uploads/render/:filename` 验 token + `res.sendFile()`
3. 改 `app.module.ts` 的 `ServeStaticModule.exclude`，加 `/uploads/render/*`
4. 改 `apps/api/src/render/render.service.ts` 与 worker 的 callback：返 URL 时用 `FileSigService.sign()` 生成 token
5. 同步改 `apps/render/src/main.ts`（worker 写 DB 的 pdfUrl/pngUrl 处用 signed URL）
6. .env / .env.example 加 `FILE_SIG_TTL_SEC=86400`
7. 单测 `test/file-sig.spec.ts`：sign / verify 往返、篡改、过期

### T2 · 渲染失败重试

1. 改 `render.service.ts` `enqueue` 调 `queue.add('render', data, { attempts: 3, backoff: { type: 'exponential', delay: 2000 }, removeOnComplete: { count: 1000 }, removeOnFail: { count: 1000 } })`
2. 定义 `RenderPermanentError` 类（worker 抛此类时 bullmq 应停止重试）
3. worker `apps/render/src/main.ts`：catch 内对 permanent 错误抛特定 message + 标记，使用 `UnrecoverableError` from bullmq 表示永久失败
4. Prisma schema 加 `attemptsMade Int @default(1) @map("attempts_made")`，prisma migrate
5. worker 在 finish/fail 时更新 `attemptsMade = job.attemptsMade`

### T3 · API rate limit

1. `pnpm add @nestjs/throttler` in `apps/api`
2. `app.module.ts` import `ThrottlerModule.forRoot([{ ttl: 60000, limit: 60 }])`
3. 全局 `APP_GUARD` 应用 `ThrottlerGuard`（在 `ApiAuthGuard` 之前）
4. `render.controller.ts` 的 `enqueue` 加 `@Throttle({ default: { limit: 30, ttl: 60000 } })`
5. 自定义 `ThrottlerStorage` getTracker：优先 token id → user id → IP

### T4 · 渲染 quota

1. `render.service.ts` 加 `checkQuota(ownerId)`：
   ```ts
   const start = new Date();
   start.setHours(0, 0, 0, 0);
   const used = await prisma.renderJob.count({ where: { template: { ownerId }, createdAt: { gte: start } } });
   if (used >= LIMIT) throw QuotaExceeded({ used, limit, resetAt: tomorrow });
   ```
2. `enqueue` 入口调 `checkQuota`（lark webhook 路径跳过）
3. 自定义异常类 `QuotaExceededException`，转 429 + JSON `{ ok: false, error: { code: 'QUOTA_EXCEEDED', used, limit, resetAt } }`
4. ENV `RENDER_QUOTA_PER_USER_DAILY=200`，从 `env.ts` 注入

### T5 · 自动清理 cron

1. `pnpm add @nestjs/schedule` in `apps/api`
2. `app.module.ts` import `ScheduleModule.forRoot()`
3. 新建 `apps/api/src/render/render-cleanup.service.ts`，`@Cron('0 3 * * *')` 触发
4. 清理逻辑：findMany 30 天前的 done/failed job → fs.unlink → DB `cleanedAt + pdfUrl=null + pngUrl=null`
5. Prisma schema 加 `cleanedAt DateTime? @map("cleaned_at")`
6. RenderModule 注册 RenderCleanupService

### T6 · 验收 + PR

- `pnpm exec vue-tsc` / `pnpm exec tsc` 0 错误
- 单测：file-sig.spec / render-quota.spec / render-cleanup.spec / render-retry-classification.spec
- 手测 curl：
  - `/uploads/render/x.pdf` 无 token → 401
  - 真 token → 200
  - 过期 token → 401
  - `POST /api/render` 30 次/min 后 → 429
  - 单用户 201 次 → 429 QUOTA_EXCEEDED
- PROGRESS 追加 §2.12
- 单 PR：iter 31 = 三件套（5 commits + plan/spec/PROGRESS = 8 commits）

---

## 风险

- **Signed URL 兼容性**：existing render_jobs 表里的旧 pdfUrl 没有 token。worker 完成新 job 时生成 signed URL；旧 job 的 URL 需要前端 / API 动态再签（在 listJobs 返回前调用 sign）。
  - **应对**：`render.service.ts` 的 `listJobs` 和 `getJob` 返回前重新调 sign，确保任何返回到前端的 URL 都带 token。
- **bullmq 错误分类**：worker 当前可能用 try/catch 把所有错误都转 generic Error。需要审计错误抛出路径，permanent 错误的判断逻辑要清晰。
  - **应对**：先列出 permanent 错误的具体场景：`template_not_found` / data 校验失败 / unsupported orientation 等；其他默认 transient。
- **throttler 与 ApiAuthGuard 顺序**：`APP_GUARD` 顺序通过 module 的 providers 数组顺序决定。需要测试 throttler 先生效（按 token id tracker）。
- **cron 时区**：服务器默认 UTC 还是 Asia/Shanghai 影响 03:00 触发时间。`@nestjs/schedule` 默认本地。Docker 容器应配 TZ=Asia/Shanghai。

---

## 不在本 PR 范围

- 前端：除了在 `/logs` 详情对 `cleanedAt != null` 的 job 隐藏下载按钮外，UI 无大改动
- 观测性 / 审计日志 → iter 32
- Admin 用户管理 → iter 32+

---

**末**
