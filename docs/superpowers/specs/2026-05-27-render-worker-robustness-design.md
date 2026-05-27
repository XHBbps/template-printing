# 渲染 worker 健壮性强化(大批量并发) 设计文档

> 状态:已与用户确认设计(经两轮评审吸收),进入实现计划阶段。
> 日期:2026-05-27
> 范围:在不改架构、不引入新依赖的前提下,提升大批量并发渲染/打印的稳定性。四块:① PuppeteerPool 坏页/坏浏览器回收与重建;② worker 单 job 硬超时 + bullmq lockDuration 对齐;③ 僵尸 `processing` job 对账 cron(含补发回调);④ 并发/内存调优(env 可配 + 文档)。

---

## 背景

API 入队 bullmq `render` 队列(`attempts:3`,指数退避 2s)。worker(`apps/render`)用 `PuppeteerPool`(默认 `RENDER_BROWSERS=4` × `RENDER_PAGES_PER_BROWSER=2` = 容量 8,Worker `concurrency` 也 = 8)。每个 job:`acquire()` 取复用 page → goto `print-headless` → 注入 → `waitForFunction(__renderReady, 30s)` → `page.pdf/screenshot` → 完成后**无条件 `release()` 回池**。回调有 10s 超时。

大批量并发下的失败模式:
1. **坏页污染级联**:渲染出错/崩溃/残留状态的 page 被原样放回池;浏览器 OOM 崩溃后其名下 page 永久变砖 → 后续 job 持续失败、容量静默下降。
2. **池槽饿死**:页卡住(networkidle0 不收敛、pdf 挂起)无硬超时 → 槽位无限占用 → 8 槽被几个卡死 job 占满 → 吞吐崩塌。
3. **僵尸 `processing`**:worker 被 `kill -9` 中途死亡,DB 行永远停 `processing`(`markDone/Failed` 未跑)。
4. **OOM 无护栏**:容量 8 + `deviceScaleFactor:2`,大批量并发可能 OOM(进而触发 #1)。

设计采用**双层防御**:worker 侧实时 `recycle`(进程存活时)+ API 侧 cron 对账(进程被杀时的兜底,两条独立安全网不重叠)。

---

## ① PuppeteerPool 回收 / 重建

文件:`apps/render/src/puppeteer-pool.ts`。

新增/修改:

- **`recycle(page)`**:从所属 slot 的 `inUse` 删除该页。
  - 浏览器存活(`browser.connected !== false`)→ 关闭坏页、`browser.newPage()` 开新页补回,经**统一 dispatch** 派发。
  - 浏览器断连(OOM 崩溃)→ 调 `relaunchSlot(slot)`。
  - 未知 page(已不属任何 slot)→ no-op。
- **`relaunchSlot(slot)`**:per-slot 锁(`relaunching: Promise|null`)合并兄弟页的并发回收(只重建一次)。步骤:
  1. **先把该 slot 的所有旧页从 `idleQueue` 移除**(防 `acquire()` shift 到死页);
  2. 尝试关旧浏览器(忽略错误);
  3. `puppeteer.launch` 包**退避重试**(默认 3 次,间隔递增如 1s/2s/4s,给内存回收时间);
  4. 成功 → 重建 `pagesPerBrowser` 个新页,经统一 dispatch **逐个派发**(可一次唤醒最多 N 个 waiter);
  5. 最终失败 → 记录容量下降告警,并 `reject` 对应数量的 waiter(其 job 抛错,由 bullmq 稍后重试),**不让 waiter 永挂**。
- **统一 dispatch**:补页/重建页一律"有 waiter 先喂 waiter,否则进 idleQueue"(与 `release` 同款),不能只 `idleQueue.push`。
- **`acquire()` 加超时**:`RENDER_ACQUIRE_TIMEOUT_MS`(默认 **30000**,仅为等页兜底,取较小值以保证「等页 + 渲染」总预算 < lockDuration,见 ②)。取不到页即 reject → job 失败重试,杜绝挂死。
- **`release(page)` 保护**:page 已不属任何 slot(重建期间被清)→ 丢弃,不进 idle。
- **主动回收**:每页累计服务 `RENDER_PAGE_MAX_USES`(默认 200)次后,在 `release` 时改走 `recycle`,防长批量 Chromium 内存蠕变。用 `Map<Page, number>` 计数。
- **`closing` 守卫**:`shutdown()` 置 `closing=true`;此后 `recycle`/`relaunchSlot` 直接 no-op,避免重建一个马上要关的浏览器。

---

## ② worker 硬超时 + lockDuration

文件:`apps/render/src/main.ts`。

- **硬超时**:`withTimeout(renderJobOnPage(...), RENDER_JOB_TIMEOUT_MS)`(默认 60000)。
  - 实现:`Promise.race([p, timeoutReject])`;成功/失败路径都 `clearTimeout`(防迟发 timeout 误触发);超时后 loser(`renderJobOnPage`)因后续关页而 reject → 给它挂 `.catch(()=>{})` 吞掉,防 unhandledRejection。
- **finally 改为**:成功 → `pool.release(page)`;**出错或超时 → `await pool.recycle(page)`**(超时页大概率卡死/污染;`recycle` 关页会让悬挂的 puppeteer 操作中止)。
- **Worker 配置补**:
  - `lockDuration`:默认 **120000**,**必须 ≥ 单 job 持锁总预算 = 等页(`RENDER_ACQUIRE_TIMEOUT_MS` 30s)+ 渲染(`RENDER_JOB_TIMEOUT_MS` 60s)+ 余量**(bullmq lock 覆盖整个 processor 执行,含 `acquire` 等待与渲染两段)。否则跑超 lock 的 job 会被判 stalled 重复派发 → 同 job 并发跑两遍(双倍内存 + 重复产物 + 抢同一 `render_jobs` 行)。
  - `stalledInterval`(如 30000)、`maxStalledCount`(如 1)显式设置,语义清晰。
  - **不变量**:`lockDuration ≥ RENDER_ACQUIRE_TIMEOUT_MS + RENDER_JOB_TIMEOUT_MS + 余量`;改任一超时 env 须同步保证此式成立(文档/`.env` 注释点明)。
- 不改:`attempts:3`/backoff(在 API 入队侧)、`UnrecoverableError` 永久失败逻辑、成功/失败 `sendCallback`。

> 说明:`markProcessing` 每次 attempt 都 `started_at=NOW()`(`db.ts:54`),故正常重试期间 `started_at` 持续刷新,③ 的 10min 阈值不会误杀重试中的 job。

---

## ③ 僵尸 `processing` 对账 cron(API 侧,含补发回调)

文件:`apps/api/src/render/render-cleanup.service.ts`(沿用其 `@Cron` 模式;`ScheduleModule` 已注册)+ 必要时 `render.service.ts`。

- 新增定时任务:把 `status='processing'` 且 `started_at` 早于 `now - RENDER_STUCK_TIMEOUT_MIN`(默认 10,远大于 bullmq 重试窗口,避免与正常重投打架)的 job 复位为 `status='failed'`、`errorMsg='stuck_timeout'`、`completedAt=NOW()`。
- **补发回调**(关闭 webhook 消费方收不到通知的缺口),三个落地细节**照搬 worker 端**(`apps/render/src/webhook.ts`),防跨进程漂移:
  1. **payload 形状照搬** `webhook.ts:16-22`:`{ jobId, status, pdfUrl, pngUrl, errorMsg }`。stuck job 即 `status:'failed'`、`pdfUrl/pngUrl: signUrl(null)=null`、`errorMsg:'stuck_timeout'`。
  2. **同步 `callbackStatus`**:发完按结果 `callback_status = 'sent' | 'failed'`(对齐 `webhook.ts:33/37`),否则渲染日志页看不出这条是 cron 补发、状态停在 null。
  3. **fetch 超时照搬** `AbortSignal.timeout(10_000)`,两端行为一致。
  - 仅对有 `callbackUrl` 的 stuck job 补发;best-effort(失败仅记 `callback_status='failed'`,不阻塞 cron)。
- **DI**:`render-cleanup.service` 注入 `FileSigService`(用 `signUrl`)。`RenderModule` 已 `import UploadsModule`(`render.module.ts:9`),`UploadsModule` 已 `exports: [FileSigService]`(`uploads.module.ts:16`)→ 直接可注入,无需额外接线。
- **不自动重排**:渲染非幂等,只标失败 + 通知,调用方按需重试。

**跨进程一致性前提**(部署须满足):worker(`apps/render/src/file-sig.ts`)与 API(`FileSigService`)的 `signUrl` 必须用**同一 HMAC secret env**,token 才互验通过——本就该一致,cron 引入 API 侧签名后此隐含依赖在文档点明。

---

## ④ 并发 / 内存调优

文件:`apps/render/src/renderer.ts`、`puppeteer-pool.ts`(启动参数)、`.env.example`、`docs/deployment.md`。

- `deviceScaleFactor` 改 env 可配 `RENDER_DEVICE_SCALE_FACTOR`(**默认 2 不变**)。文档写明:降到 1 会**降低 PNG 输出分辨率/清晰度**(`renderer.ts:30`),是"画质/体积 vs 内存"取舍,非无损旋钮。
- Chromium 启动参数补 `--disable-extensions`;保留已有 `--no-sandbox --disable-setuid-sandbox --disable-dev-shm-usage --disable-gpu`。
- **不**默认加 `--js-flags=--max-old-space-size`:截图 OOM 主因是光栅/GPU 缓冲(不在 V8 堆),限 old-space 压不住、反而可能让重模板提前 JS OOM。文档列为"谨慎可选"。
- 并发数仍由 `RENDER_BROWSERS`/`RENDER_PAGES_PER_BROWSER` 控制(不强改默认),文档给**推荐值 + 单浏览器内存估算**指引。

---

## 影响文件

- `apps/render/src/puppeteer-pool.ts` —— recycle/relaunchSlot + 统一 dispatch + acquire 超时 + release 保护 + 使用计数 + closing 守卫 + 启动参数。
- `apps/render/src/main.ts` —— withTimeout + 成功 release/失败 recycle + lockDuration/stalled 配置。
- `apps/render/src/renderer.ts` —— deviceScaleFactor env 可配。
- `apps/api/src/render/render-cleanup.service.ts` —— 僵尸对账 cron + 补发回调(注入 FileSigService)。
- `.env.example` —— 新增 `RENDER_JOB_TIMEOUT_MS`/`RENDER_ACQUIRE_TIMEOUT_MS`/`RENDER_PAGE_MAX_USES`/`RENDER_STUCK_TIMEOUT_MIN`/`RENDER_DEVICE_SCALE_FACTOR`(+ lockDuration 由 job 超时派生或单列)。
- `docs/deployment.md` —— 新 env 说明、并发/内存推荐值、HMAC secret 两端一致前提、deviceScaleFactor 取舍。
- `docs/PROGRESS.md` —— 近期变更。

## 测试

- **PuppeteerPool 单测**(worker 侧用现有测试框架):
  - recycle:浏览器存活→换单页、容量不变;新页经 dispatch 能被等待中的 acquire 拿到。
  - relaunchSlot:模拟 `browser.connected=false`→重建;旧页从 idleQueue 清除;launch 失败重试;最终失败 reject waiter(不挂死)。
  - release 拿到陌生 page → 丢弃不入 idle。
  - 使用计数到 `RENDER_PAGE_MAX_USES` → release 触发 recycle。
  - acquire 超时 → reject。
- **withTimeout** 单测:超时 reject + clearTimeout;成功清定时器。
- **cron 对账**(API e2e 或单测):造一条 `processing` 且 `started_at` 超阈值的 job → cron 后变 `failed`/`stuck_timeout`;有 callbackUrl 的补发回调(mock 接收端)且 `callback_status` 更新;未超阈值的不动。
- typecheck + lint(render + api)。
- 不破坏现有渲染 e2e / 全链路。

## 不做 / 约束

- 不引入新依赖(用现有 bullmq / puppeteer / @nestjs/schedule / pg / undici)。
- 不动 `--no-sandbox`:容器内常规取舍;recycle 只缩小爆炸半径(坏页即弃),**不构成隔离**;未来要隔离的方向是 per-job 独立 BrowserContext,不在本迭代。
- 对账 cron 只标失败 + 补发通知,不自动重排(渲染非幂等)。
- 不改渲染视觉结果与 `PX_PER_MM=4` 基准;`deviceScaleFactor` 默认仍 2。
- 不改入队 attempts/backoff、模板数据、前端。
