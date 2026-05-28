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

## P0 — 状态机单调性(终态粘性,核心)✅ 已实现(Plan 1)

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

## P1a — backoff jitter ✅ 已实现(Plan 2)

> ✅ **Plan 2 落地**:bullmq 5.10.4 无 `jitter` 选项,初稿的一行 `jitter:0.5` 不成立;改由 render Worker 注册自定义 `settings.backoffStrategy`(`backoff.ts` 的 `jitterBackoff`,退避 = `RENDER_BACKOFF_BASE_MS(默认2000) × 2^(n-1) × [0.5,1.5)` 指数+±50% jitter 防惊群)+ API 入队改 `backoff:{type:'custom'}`。⚠️ 跨进程 + **部署耦合:api 与 render 必须同版本部署**(旧 worker 收 custom 抛 "Unknown backoff strategy")。Plan 1 跳过、保持 exponential 2/4/8s,本项与 P2a 一并 Plan 2 完成。

`apps/api/src/render/render.service.ts:100`:~~`backoff: { type: 'exponential', delay: 2000, jitter: 0.5 }`~~(jitter 选项不存在,见上)。
**测试:** 入队选项断言 `jitter:0.5`(沿用现有 enqueue 单测)。

---

## P1b — 回调失败补发 ✅ 已实现(Plan 1)

1. **schema/migration:** `RenderJob` 加 `callbackAttempts Int @default(0) @map("callback_attempts")`;`prisma migrate dev --name add_callback_attempts`(仓库内不 reset,只新增列)。
2. **计数语义(钉死):** `callbackAttempts` = **补发 cron 已发的次数**(默认 0)。worker `webhook.ts` 初次发回调、API `sendStuckCallback` **只置 `callbackStatus`(sent/failed),不动 `callbackAttempts`**;**仅补发 cron 每发一次 `callbackAttempts += 1`**。这样计数只表达"已补发几次",公式才干净。
3. **补发 cron(API,`render-cleanup.service.ts`):** 新增 `resendFailedCallbacks()` @Cron(**EVERY_5_MINUTES**):
   - 扫 `status IN ('done','failed') AND callbackUrl IS NOT NULL AND callbackStatus='failed' AND callbackAttempts < CALLBACK_RESEND_MAX_ATTEMPTS(5)`;
   - 退避公式(**钉死,不加新时间列**):资格 = `completedAt + (5 * 2^callbackAttempts) 分钟 <= now`。base 设为 5min(= cron 粒度)才让间隔真有意义,否则 <5min 的档全塌到同一 tick。`callbackAttempts` 0→4 共 5 次补发,实际落在 **completedAt + 5/10/20/40/80 分钟**,总 horizon **≈80min**。可在候选 SQL 取回后 JS 过滤(语义以本式为准)。
   - 复用 worker 同款 payload(signed URL);POST 后:2xx → `callbackStatus='sent'`(下次扫不到,停);非 2xx/超时 → 保持 `failed` 且 `callbackAttempts += 1`。
   - 与 `reconcileStuckJobs` 对称,best-effort、不抛。
   - **取舍(已确认):** horizon ≈80min,够扛飞书/外部 webhook 偶发 5xx;消费方宕机超 80min 则 5 次耗尽 → 永久 `failed` 不再补发(扛不住长时间宕机,可接受)。
4. **env:** `CALLBACK_RESEND_MAX_ATTEMPTS`(默认 5,≤0 关)入 `.env.example`/`.env.prod.example` + `env-example-sync.spec.ts` 的 `NON_ENVTS_ALLOWED`(process.env-only,同批次3 模式)。
5. **P1b 真实受益方 = 外部 API 调用方,不是飞书(精度注解):** `lark-bitable.controller.ts` 的 `renderCallback` **即便内部 bitable 写失败也 `return {ok:true}`(HTTP 200)**(`:191-198`)→ worker 记 `callbackStatus='sent'` → **P1b 永远不会对飞书路径触发**。所以 P1b 只服务"外部 callbackUrl 端点返回 5xx/超时"的调用方;飞书侧的内部写失败是另一类(handler 已 best-effort 写"失败"状态,不在本批)。**P1b 测试必须以外部 mock 端点为对象,别用飞书 handler 验。** 与 P0 第 4 步飞书幂等守卫(防 stalled 重投/重复 POST 的二次上传)服务**不同投递路径**,两者都保留。
6. **幂等前提:** 外部调用方需按 jobId 幂等去重(补发 + stalled 都可能重复投递)——`deployment.md` 文档明确要求。
7. **测试:** e2e——造 `callbackStatus='failed'` + `callbackAttempts<MAX` 且 `completedAt` 已过退避档的 done job + **外部 mock 回调端点**,cron 跑后回调被重发、2xx 则 `callbackStatus='sent'`、非 2xx 则 `callbackAttempts+1`;超 MAX 不再发;未到退避档不发;`callbackUrl IS NULL` 跳过。

---

## P2a-worker — 永久错误细分:worker zod 预校验 ✅ 已实现(Plan 2)

**目标(已达成):** 把"模板结构非法"从"白重试 3 次 × 各占 60s 渲染槽"降为立即 `UnrecoverableError('schema_invalid')`。

> ✅ **Plan 2 落地(选项 a)**:给 `@template-printing/schema` 加 build + `exports["./template"]→dist`(`.` 仍 src),render 导航前用完整 `TemplateSchema.safeParse(tpl.data)`(`schema-precheck.ts`),畸形 → `UnrecoverableError('schema_invalid')`;`docker/render.Dockerfile` 构建阶段先 build schema 再 build/deploy render(生产 runtime-verify `node` 可解析 `./template`,避下述 raw-TS 陷阱)。

**(规划期发现的打包陷阱 + 低命中率,已由上述方案解决):**
- ❌ 初稿说"`@template-printing/schema` 纯 zod,可在 Node worker 内直接用"——**错**。该包 `main: ./src/index.ts`(raw TS,无 build);render 生产镜像 `docker/render.Dockerfile:59` 跑 `node dist/main.js`,`pnpm deploy` 把 schema 当 raw TS 拷入 → Node 20 无法执行 `.ts` → `ERR_UNKNOWN_FILE_EXTENSION` 崩。而 vitest/tsx(dev/测试)即时转译 → **绿**。典型 batch-2「build≠runs」陷阱。全仓**无任何 Node 侧运行时消费 schema**(`apps/api/src` 声明依赖却从不 import)。
- 要全 zod 在 worker 跑通生产,须给 schema 加 build(dist + `exports`)并接入 render Dockerfile 构建阶段(改 web/designer 共用包 + 需生产 runtime-verify),或 bundle worker / 改 tsx 运行——均比"一次 safeParse"大。
- `tpl.data` 是 DB 里的已发布模板结构(设计器作者),若作者/保存侧已校验,畸形模板抵达 worker 近乎零频 → 任何形态的 T7 命中率都低。

**Plan 2 的选项(待定,与 P2a-web 同批决策):** (a) 给 schema 加 build 后用完整 `TemplateSchema.safeParse`;或 (b) worker 内手写极小结构守卫(canvas 存在 + elements 是数组 + 每元素有 type/anchor)零依赖零打包风险但保真度低。Plan 2 启动时定。

## P2a-web — 条码/渲染期错误细分 ✅ 已实现(Plan 2)

> ✅ **Plan 2 落地**:先修就绪 barrier —— `PrintHeadlessView` 改为「渲染-settle 注册表」(所有异步元件 settle 才置就绪)+ 错误 sink,消除 50ms race;Barcode/Qr/Image 元件 **designMode 门控**上报(`barcode_invalid`/`qr_invalid`/`image_404`,不回归设计器编辑);worker `renderer.ts` `waitForFunction(__renderReady || __renderError)` + `main.ts` 读 `window.__renderError` → `UnrecoverableError`(**不出残图**)。产品口径已采 fail-fast(非法条码/图片 404 → 整个 job failed,不出带空条码/残缺 PDF)。端到端已验:图片404 job→failed/`image_404`/attempts=1、正常→done。

**(规划期 review 发现的设计风险,已由上述方案逐条解决):**
1. **检测寄生在 50ms 心跳上 → 本身 racy。** worker 读 `window.__renderError` 的时机由 `waitForFunction(__renderReady || __renderError)` 决定,而 `__renderReady` 是 `PrintHeadlessView.vue:25-43` 固定 50ms 定时器**无条件**置的,不等异步元件渲染完。Barcode 的 `render()` 在 `await nextTick()` 后的 async watch 里跑,bwip-js 抛错→sink 上报的时刻**不保证早于 50ms**。结果:模板重一点 / CI 慢一点,worker 先看到 `__renderReady=true` 就 `page.pdf`,漏掉 `__renderError`。→ **会做出一个时灵时不灵的非确定性永久错误分类器,比不做更糟。**
2. **要做对得先修"渲染真正结束"的 barrier**(元件上报渲染完成 / render-settle 信号,替代 50ms 心跳)——这触碰 headless 渲染的核心**就绪契约**,比"加 sink + 读信号"大一圈。
3. **产品口径取舍待定:** 非法条码现状是"出 PDF、条码留空";P2a-web 会升级成"整个 job failed"。打印场景下少个条码的标签或许确实不该印(fail-fast 更对),但这是有意识取舍,需产品确认要"失败"而非"出带空条码 PDF"。
4. **价值最低、爆炸半径最大:** "合法结构 + 非法条码内容"较罕见;改动落在 `template-renderer` 共享包(设计器 + 打印共用)→ 唯一有设计器回归风险的一项。

**Plan 2 的内容(留作后续,先记录设计点位,避免重走):**
- 先修就绪 barrier:`PrintHeadlessView` 改为等"所有异步元件 settle"再置 `__renderReady`(或元件上报完成计数),消除 50ms race —— **这是 Plan 2 的实现前置条件**。
- `BarcodeElement.vue` / `QrElement.vue`:`inject` **必须在 setup 顶层** `const sink = inject(renderErrorSinkKey, null)`,catch 内调 `sink?.({reason, detail})`(不能在 catch 里 `inject(...)`,inject 只能 setup 顶层调);`renderErrorSinkKey` 用 `template-renderer` 导出的 typed `InjectionKey` 保证两端契约;**非 designMode 才上报**(两元件已有 `designMode` prop:`BarcodeElement.vue:15`/`QrElement.vue:11`,门控不用新增 prop)。
- `PrintHeadlessView` `provide(renderErrorSinkKey, fn)`,fn 设 `window.__renderError`;`onErrorCaptured` 兜同步渲染抛错。
- worker `renderer.ts` `waitForFunction(__renderReady || __renderError)` + `main.ts` 读到永久错误 → `UnrecoverableError(reason)`。
- 必带**设计器手动走查**硬门(改了共享元件)。

---

## P2b — 终态可观测(方案 A:API cron 出 stuck_timeout)✅ 已实现(Plan 1)

- `RenderCleanupService` 注入 `MetricsService`;`reconcileStuckJobs` 每翻转一个 stuck job(`count===1`)→ `metrics.renderJobs.inc({ status:'stuck_timeout', source:'cron' })`。
- `done`/`failed` 逐 attempts 计数需 worker 端点,本批不做(已在 P2 决策中确认)。
- **告警:** `deployment.md` 文档化:`tp_render_jobs_total{status="stuck_timeout"}` 持续 >0 代表 render worker OOM/崩溃,是系统性信号,应配 Prometheus 告警规则(规则示例写入文档)。
- **测试:** e2e——造 stuck job,cron 跑后 `MetricsService.expose()` 含 `tp_render_jobs_total{...status="stuck_timeout"...}` 计数增。

---

## 不变量与边界(实现须守)

- `lockDuration ≥ RENDER_ACQUIRE_TIMEOUT_MS + RENDER_JOB_TIMEOUT_MS + 余量`(现状已守)。
- `RENDER_STUCK_TIMEOUT_MIN(10min)` 须 > bullmq 重试窗口(2+4+8s + 渲染耗时),否则 cron 误杀重试中 job(现状已守;jitter 略增窗口但仍 ≪ 10min)。
- P0 终态粘性后,边界 3"单 job 实际执行 >3 次"(stalled 独立计数)从"可能脏写"降为"无害空转"。
- (Plan 2)P2a-web 错误上报必须 designMode 门控,不回归设计器编辑体验;且须先修 50ms 就绪 barrier。

## Plan 拆分(按"碰不碰 `template-renderer` 共享包"切爆炸半径)

- **Plan 1(服务端,低回归,先发):** P0 + P1a + P1b + P2b。全部纯服务端、**零打包风险、零设计器手测依赖**;验证统一为 typecheck / 单测 / 渲染往返 + cron e2e。P0 是 correctness bug,应尽早上线,不被回归/打包风险项拖累。→ 本 spec 收尾即进 Plan 1 的 writing-plans。
- **Plan 2(后续,碰共享包 / 打包 / 设计器回归):** P2a-worker(先定 schema 打包方案:加 build 用全 zod,或 worker 内手写结构守卫)+ P2a-web(先修 50ms render-settle barrier + Barcode/Qr sink + 设计器手动走查 + 产品确认"非法条码 → fail-fast"口径)。单独 plan、单独发布、单独可回滚。

## 文档同步(AGENTS.md §9)

`docs/PROGRESS.md`(近期变更 + 最近更新日期)、`docs/deployment.md`(回调补发 env + stuck_timeout 告警规则 + 永久错误分类说明)、`.env.example` / `.env.prod.example`(`CALLBACK_RESEND_MAX_ATTEMPTS`)、`apps/api/test/env-example-sync.spec.ts`(NON_ENVTS_ALLOWED)。

## 任务分解预判(交 writing-plans)

**Plan 1(本批):** T1 P0 db.ts 粘性 + rowCount → T2 P0 main.ts 短路(`return` 非 throw)/rowCount 决定 `sendCallback` → T3 P0 cron updateMany 守卫(`count===1` 才回调)→ T4 P0 飞书 handler 幂等守卫(bitable + bot)→ T5 P1a jitter → T6 P1b 列+migration+补发 cron(计数语义/退避公式见 P1b)+env → T7 P2b stuck_timeout metric → T8 文档 + 全量回归。(P0 四步耦合度高,plan 期可酌情合并 task。)

**Plan 2(后续):** schema 打包方案定夺 → P2a-worker(zod 或结构守卫)→ 就绪 barrier 修复 → Barcode/Qr sink + PrintHeadlessView provide/onErrorCaptured + worker 读信号 → 设计器走查。
