# 渲染可靠性加固 设计（批次4）

> 状态:设计待用户评审 → writing-plans
> 来源:用户对失败重试机制的全链路 review(2026-05-28),非系统 review 报告项。

## 背景

当前渲染失败重试为两层:worker 内 bullmq 自动重试(`attempts:3` 指数退避 2/4/8s,永久错误 `UnrecoverableError` 短路)+ API 侧 cron 兜底对账(`reconcileStuckJobs`,processing>10min 标 `stuck_timeout`)。机制完整,但有 5 个边缘需加固,按收益排序:

| 项 | 级别 | 问题一句话 |
|---|---|---|
| P0 | 真 bug | 状态机非单调:`markDone`/`markFailed`/cron 都是无条件 UPDATE,stalled 晚到执行 / cron 快照窗口会覆盖已有终态 → DB 与回调不一致 + 重复渲染/重复写回飞书 |
| P1a | 优化 | backoff 无 jitter,并发 8 时同步齐步重试放大外部依赖尖峰 |
| P1b | 优化 | 渲染成功但回调遇飞书 5xx/超时仅记 `callbackStatus='failed'` 不重发 → 静默丢通知 |
| P2a | 优化 | 永久错误只分"行不存在/template_not_found"两类;模板结构非法、条码非法仍白重试 3 次,各占 60s 渲染槽 |
| P2b | 优化 | `tp_render_jobs_total` 仅入队 inc;`stuck_timeout`(worker OOM/崩溃信号)无计数/告警 |

**关键架构事实(已核实,影响设计形态):**
- 渲染全在浏览器:worker `goto` web `/print-headless` → 注入 `__renderInput` → 等 `window.__renderReady`(`renderer.ts:61-79`)。`PrintHeadlessView.vue:25-43` **无条件在注入后 50ms 置 `__renderReady=true`,不校验渲染成功**。
- `BarcodeElement.vue:45-77` / `QrElement.vue:36-55` 在 **async watch/onMounted 里渲染,且 `try/catch` 吞掉 bwip-js/qrcode 错误**(仅 `console.error`)→ `onErrorCaptured` **抓不到**条码/二维码编码失败。要细分这类永久错误,必须改这两个元件**上报**而非吞掉。
- 飞书回调 handler `lark-bitable.controller.ts:138-199` 每收一次 `done` 就**重传 PDF + 重写多维表格**(非幂等),无幂等守卫;但 `larkPrintRequest.callbackStatus` 字段已存在,可作幂等标记。`lark-bot` 侧回调同理(plan 期核实其字段)。
- `metrics.service.ts:34` 的 `renderJobs: Counter<'status'|'source'>` 在 API 进程;render worker 是独立进程、**无 Prometheus 端点**。
- schema 校验入口:`@template-printing/schema` 导出 `TemplateSchema`(`template.ts:252`),纯 zod 无 Vue,可在 Node worker 内 `TemplateSchema.safeParse(tpl.data)`。

---

## P0 — 状态机单调性(终态粘性,核心)

**不变量:终态(done/failed)一旦写入不可被覆盖。** 一处 SQL 守卫收掉全部竞态。

1. **`apps/render/src/db.ts`** `markDone` / `markFailed`:UPDATE 加 `AND status NOT IN ('done','failed')`,返回受影响行数 `rowCount`。
   > 注意:必须用 `NOT IN ('done','failed')` 而非用户初稿的 `= 'processing'`——因为 `template_not_found` 分支在 `markProcessing` **之前**调 `markFailed`(此刻 status 仍 `pending`),`='processing'` 会漏掉这条永久失败。`NOT IN 终态` 同时满足 `pending→failed`、`processing→done/failed`,且挡住 `failed→done` 覆盖。
2. **`apps/render/src/main.ts`**:
   - `fetchJob` 后加幂等短路:`if (job.status === 'done' || job.status === 'failed') { log; return; }` —— 挡 stalled 重投在"开跑前已终态"。
   - `markDone`/`markFailed` 返回 `rowCount`;**仅当 `rowCount > 0`(本次真翻转了终态)才 `sendCallback`** —— 挡"渲染中被 cron 抢先标 failed"时 worker 再发一次成功回调。短路与 rowCount 守卫覆盖**不同窗口**,两者都保留。
3. **`apps/api/src/render/render-cleanup.service.ts`** `reconcileStuckJobs`:逐行 `update({where:{id}})` 改为 `updateMany({where:{id, status:'processing'}, data:{...}})`,**仅 `count===1`(真翻转)才 `sendStuckCallback`** —— 挡 findMany 快照与 update 之间该行已 `markDone` 的覆盖。
4. **飞书回调幂等守卫**:`lark-bitable.controller.ts` `renderCallback` 顶部(查到 `req` 之后)加 `if (req.callbackStatus === 'done') return { ok: true };` —— 杜绝 stalled 重投 / P1b 补发导致的重复上传 PDF + 重复写回。`lark-bot` 侧同样加(plan 期核实其幂等字段)。

**测试:** worker e2e/单测——已 done 的 job 再跑 `markDone` rowCount=0、不覆盖、不回调;cron updateMany 对已 done 行 count=0 不发回调;lark `renderCallback` 对 `callbackStatus='done'` 的 req 第二次调用不再 `uploadMaterial`(mock 断言调用次数)。

---

## P1a — backoff jitter(一行)

`apps/api/src/render/render.service.ts:100`:`backoff: { type: 'exponential', delay: 2000, jitter: 0.5 }`。
**测试:** 入队选项断言 `jitter:0.5`(沿用现有 enqueue 单测)。

---

## P1b — 回调失败补发

1. **schema/migration:** `RenderJob` 加 `callbackAttempts Int @default(0) @map("callback_attempts")`;`prisma migrate dev --name add_callback_attempts`(仓库内不 reset,只新增列)。
2. **计数:** worker `webhook.ts` 与 API `sendStuckCallback` 每次发回调后 `callback_attempts += 1`(`markCallbackStatus` 扩展或新增 raw UPDATE)。
3. **补发 cron(API,`render-cleanup.service.ts`):** 新增 `resendFailedCallbacks()` @Cron(频率 plan 定,如 EVERY_5_MINUTES 或 10_MINUTES):
   - 扫 `status IN ('done','failed') AND callbackUrl IS NOT NULL AND callbackStatus='failed' AND callbackAttempts < CALLBACK_RESEND_MAX_ATTEMPTS`;
   - 退避(**不加新时间列**):资格 = `completedAt + (2^callbackAttempts) 分钟 <= now`。`callbackAttempts` 每次补发 +1 → 阈值随尝试次数指数后移(attempts=1→completedAt+2min、=2→+4min、=3→+8min…),用既有 `completedAt` 即可实现指数间隔,无需 `lastCallbackAt` 列。可在 SQL where 直接算或取候选后 JS 过滤(plan 定,语义以本式为准)。
   - 复用 worker 同款 payload(signed URL),`sent` 即停、`failed` 则 attempts+1;
   - 与 `reconcileStuckJobs` 对称,best-effort、不抛。
4. **env:** `CALLBACK_RESEND_MAX_ATTEMPTS`(默认 5,≤0 关)入 `.env.example`/`.env.prod.example` + `env-example-sync.spec.ts` 的 `NON_ENVTS_ALLOWED`(process.env-only,同批次3 模式)。
5. **幂等前提:** 接收方需按 jobId 幂等——飞书侧由 P0 的 `callbackStatus='done'` 守卫保证;外部 API 调用方在 `deployment.md` 文档明确要求"按 jobId 幂等去重"。
6. **测试:** e2e——造 `callbackStatus='failed'` + `callbackAttempts<MAX` 的 done job + mock 回调端点,cron 跑后回调被重发、成功则 `callbackStatus='sent'`;超 MAX 不再发;`callbackUrl IS NULL` 跳过。

---

## P2a — 永久错误细分(方案 γ:worker zod 预校验 + web 错误上报切片)

**目标:** 把"模板结构非法"、"条码/二维码编码非法"从"白重试 3 次"降为立即 `UnrecoverableError`。图片 404 暂留瞬时(多为临时,且需逐图 onerror 跟踪较碎,本批不做)。

1. **worker zod 预校验(in-process,抓 schema_invalid):**
   - `apps/render` 加 workspace 依赖 `@template-printing/schema`。
   - `main.ts` 取到 `tpl.data` 后、`markProcessing` 前:`const v = TemplateSchema.safeParse(tpl.data); if (!v.success) { await markFailed(jobId, 'schema_invalid', attemptNo); await sendCallback(...); throw new UnrecoverableError('schema_invalid'); }`(与 `template_not_found` 同形)。
2. **web 渲染抛错上报(抓渲染期同步抛错):**
   - `PrintHeadlessView.vue` 加 `onErrorCaptured((err)=>{ window.__renderError = { permanent:true, reason:'render_error', detail: err.message }; return false; })` —— 捕获 `TemplateRenderer` 子树**同步渲染/ setup 抛错**(通用安全网)。
3. **条码/二维码错误上报(改吞为报):**
   - `BarcodeElement.vue` / `QrElement.vue`:catch 块除 `console.error` 外,**非 designMode 时**通过 `inject` 的错误 sink 上报(如 `inject('renderErrorSink', null)?.( {reason:'barcode_invalid', detail} )`);designMode(设计器内)行为不变(仍只 console,显占位,不打断编辑)。
   - `PrintHeadlessView.vue` `provide('renderErrorSink', fn)`,fn 设 `window.__renderError = {permanent:true, reason, detail}`。
   - 注意:这两个元件在 `template-renderer` 包,被设计器与打印共用——改动必须 designMode 门控,不回归设计器。
4. **worker 读错误信号:**
   - `renderer.ts` 的 `waitForFunction` 改为 `() => window.__renderReady === true || window.__renderError != null`;返回后读 `window.__renderError`,非空则把 `{reason}` 透出。
   - `main.ts`:渲染返回带永久错误 → `markFailed(jobId, reason, attemptNo)` + `sendCallback` + `throw new UnrecoverableError(reason)`。
5. **测试:** worker 单测——非法 `tpl.data` → zod 短路、UnrecoverableError、不重试;web 组件测试——非法条码触发 sink → `__renderError` 置位;(端到端"非法条码 job → failed 不重试"可作 render 包 e2e,plan 定可行性)。

---

## P2b — 终态可观测(方案 A:API cron 出 stuck_timeout)

- `RenderCleanupService` 注入 `MetricsService`;`reconcileStuckJobs` 每翻转一个 stuck job(`count===1`)→ `metrics.renderJobs.inc({ status:'stuck_timeout', source:'cron' })`。
- `done`/`failed` 逐 attempts 计数需 worker 端点,本批不做(已在 P2 决策中确认)。
- **告警:** `deployment.md` 文档化:`tp_render_jobs_total{status="stuck_timeout"}` 持续 >0 代表 render worker OOM/崩溃,是系统性信号,应配 Prometheus 告警规则(规则示例写入文档)。
- **测试:** e2e——造 stuck job,cron 跑后 `MetricsService.expose()` 含 `tp_render_jobs_total{...status="stuck_timeout"...}` 计数增。

---

## 不变量与边界(实现须守)

- `lockDuration ≥ RENDER_ACQUIRE_TIMEOUT_MS + RENDER_JOB_TIMEOUT_MS + 余量`(现状已守)。
- `RENDER_STUCK_TIMEOUT_MIN(10min)` 须 > bullmq 重试窗口(2+4+8s + 渲染耗时),否则 cron 误杀重试中 job(现状已守;jitter 略增窗口但仍 ≪ 10min)。
- P0 终态粘性后,边界 3"单 job 实际执行 >3 次"(stalled 独立计数)从"可能脏写"降为"无害空转"。
- P2a 错误上报必须 designMode 门控,不回归设计器编辑体验。

## 文档同步(AGENTS.md §9)

`docs/PROGRESS.md`(近期变更 + 最近更新日期)、`docs/deployment.md`(回调补发 env + stuck_timeout 告警规则 + 永久错误分类说明)、`.env.example` / `.env.prod.example`(`CALLBACK_RESEND_MAX_ATTEMPTS`)、`apps/api/test/env-example-sync.spec.ts`(NON_ENVTS_ALLOWED)。

## 任务分解预判(交 writing-plans)

T1 P0 db.ts 粘性 + rowCount → T2 P0 main.ts 短路/rowCount 回调 → T3 P0 cron updateMany 守卫 → T4 P0 飞书 handler 幂等 → T5 P1a jitter → T6 P1b 列+migration+计数+补发 cron+env → T7 P2a worker zod 预校验 → T8 P2a web 错误上报(PrintHeadlessView + Barcode/Qr sink + worker 读信号)→ T9 P2b stuck_timeout metric → T10 文档 + 全量回归。(P0 四步可视耦合度合并;P2a-web 是最大/最有回归风险的一项。)
