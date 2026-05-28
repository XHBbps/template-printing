# 批次4 Plan 1:渲染可靠性加固(服务端) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development(推荐)或 superpowers:executing-plans 逐 task 实现。步骤用 `- [ ]` 跟踪。

**Goal:** 修渲染状态机非单调真 bug(P0)+ 回调可靠性(P1a jitter / P1b 失败补发)+ 终态可观测(P2b stuck_timeout 指标)。纯服务端,零打包风险,零设计器手测依赖。

**Architecture:** 终态粘性靠一条 SQL 不变量(`WHERE ... AND status NOT IN ('done','failed')`)+ worker/cron/飞书 handler 三处幂等守卫;回调补发复用现有 `RenderCleanupService` @Cron 模式;终态指标挂在 API 侧 cron(worker 无 Prometheus 端点)。

**Tech Stack:** worker `apps/render`(TS + vitest + pg)、API `apps/api`(NestJS + Prisma + Jest)、Prisma migration。

**Spec:** `docs/superpowers/specs/2026-05-28-render-reliability-hardening-design.md`(P0/P1a/P1b/P2b;P2a 整体已划到 Plan 2)。

---

## 全局约定

- **测试命令:** API `docker exec template_printing-api sh -c "cd /workspace/apps/api && pnpm test -- <file>"`;render `docker exec template_printing-render sh -c "cd /workspace/apps/render && pnpm test -- <file>"`(vitest)。typecheck/lint 同容器 `pnpm run typecheck` / `pnpm run lint`。
- **ESM:** 两端相对 import 必须带 `.js` 后缀。API e2e 用 `@jest/globals`;render 用 vitest 全局(照搬 `apps/render/test/pool.spec.ts`)。
- **DB:** e2e/render-DB 测试命中真实 dev DB,造的行用唯一前缀,afterAll/afterEach 清干净,绝不误删真实数据。
- **Git:** 不 `--no-verify`、不跳 husky/签名;每 task 只 `git add` 本 task 文件,commit 前 `git status` 核对。
- **不改:** 渲染视觉、入队 attempts/退避次数(仅加 jitter)、前端、`template-renderer` 共享包(那是 Plan 2)。

## File Structure

- `apps/render/src/db.ts` — `markDone`/`markFailed` 加粘性守卫 + 返回 rowCount(T1)
- `apps/render/test/db-sticky.spec.ts` — 新,render-DB vitest(T1)
- `apps/render/src/main.ts` — 终态短路 `return` + rowCount 决定 `sendCallback`(T2)
- `apps/api/src/render/render-cleanup.service.ts` — cron updateMany 守卫(T3)+ stuck_timeout 指标(T7)+ 回调补发 cron(T6)
- `apps/api/test/render-stuck-reconcile.e2e.spec.ts` — 既有,扩断言(T3/T7)
- `apps/api/src/lark/lark-bitable.controller.ts` / `lark-bot.controller.ts` — 回调幂等守卫(T4)
- `apps/api/test/render-callback-idempotency.e2e.spec.ts` — 新(T4)
- `apps/api/src/render/render.service.ts` — backoff jitter(T5)
- `apps/api/prisma/schema.prisma` + migration — `callbackAttempts` 列(T6)
- `apps/api/test/callback-resend.e2e.spec.ts` — 新(T6)
- `.env.example` / `.env.prod.example` / `apps/api/test/env-example-sync.spec.ts` / `docs/deployment.md` / `docs/PROGRESS.md`(T6/T8)

---

## Task 1(P0):db.ts 终态粘性 + 返回 rowCount

**Files:** Modify `apps/render/src/db.ts`;Test `apps/render/test/db-sticky.spec.ts`(新)。

- [ ] **Step 1: 写失败测试**

新建 `apps/render/test/db-sticky.spec.ts`。照搬 `pool.spec.ts` 的 vitest 写法(`import { describe, it, expect, beforeAll, afterAll } from 'vitest'` 若该文件用显式 import;否则用全局)。`import { pool, markProcessing, markDone, markFailed } from '../src/db.js'`。

测试需一个 `render_jobs` 行(FK `template_id → templates`,onDelete Cascade)。先 Read `apps/api/prisma/schema.prisma` 的 `Template` / `User` model 确认 `templates` / `users` 必填列,用 `pool.query` 造**最小** owner user + template + render_job(唯一 id 前缀 `dbsticky-<ts>`)。三条断言:
1. **markDone 返回 1 且翻转**:对一个 `pending`/`processing` job 调 `markDone(id, '/uploads/render/x.pdf', null, 1)` → 返回 `1`,DB status 变 `done`。
2. **终态不可被覆盖**:对同一已 `done` 的 job 调 `markFailed(id, 'boom', 2)` → 返回 `0`,DB status **仍 `done`**、error_msg 仍空(未被覆盖)。
3. **failed 也粘性**:另造一个 job → `markFailed(id,'e',1)` 返回 `1`、status=`failed`;再 `markDone(id,...)` 返回 `0`、status 仍 `failed`。

afterAll:按前缀 `deleteMany`/`DELETE` 清 render_job + template + user,`pool.end()` 或保持(照搬 pool.spec.ts 收尾)。

- [ ] **Step 2: 跑测试确认失败**

Run: `docker exec template_printing-render sh -c "cd /workspace/apps/render && pnpm test -- test/db-sticky.spec.ts"`
Expected: FAIL(当前 `markDone`/`markFailed` 返回 `void` 且无粘性 → 断言 2/3 失败:覆盖发生、返回非 0/undefined)。

- [ ] **Step 3: 改 db.ts**

把 `markDone`/`markFailed` 改为(返回 `Promise<number>` + `AND status NOT IN ('done','failed')`):
```ts
export async function markDone(
  id: string,
  pdfUrl: string | null,
  pngUrl: string | null,
  attemptsMade = 1,
): Promise<number> {
  const r = await pool.query(
    `UPDATE render_jobs SET status = 'done', pdf_url = $1, png_url = $2, completed_at = NOW(), attempts_made = $3
     WHERE id = $4 AND status NOT IN ('done','failed')`,
    [pdfUrl, pngUrl, attemptsMade, id],
  );
  return r.rowCount ?? 0;
}

export async function markFailed(id: string, errorMsg: string, attemptsMade = 1): Promise<number> {
  const r = await pool.query(
    `UPDATE render_jobs SET status = 'failed', error_msg = $1, completed_at = NOW(), attempts_made = $2
     WHERE id = $3 AND status NOT IN ('done','failed')`,
    [errorMsg, attemptsMade, id],
  );
  return r.rowCount ?? 0;
}
```
> `markProcessing` 不动(它从 pending/重试态刷 processing,不是终态)。

- [ ] **Step 4: 测试通过 + typecheck + lint**

Run: `docker exec template_printing-render sh -c "cd /workspace/apps/render && pnpm test -- test/db-sticky.spec.ts && pnpm run typecheck && pnpm run lint"`

- [ ] **Step 5: 提交**
```bash
git add apps/render/src/db.ts apps/render/test/db-sticky.spec.ts
git commit -m "fix(render): markDone/markFailed 终态粘性(AND status NOT IN done,failed)+ 返回 rowCount(P0)"
```

---

## Task 2(P0):main.ts 终态短路 + rowCount 决定回调

**Files:** Modify `apps/render/src/main.ts`。依赖 T1(`markDone`/`markFailed` 现返回 number)。

> 说明:`main.ts` 的 processor 是 `new Worker('render', async (bullJob)=>{...})` 内联闭包,不易单测。本 task 行为正确性由 T1(SQL 层粘性+rowCount 已测)+ 代码评审 + 一次真实渲染往返冒烟保证;不新增单测(避免为内联闭包做大重构,超出最小改动)。Step 2 的"验证"是 typecheck + 真实渲染往返。

- [ ] **Step 1: 改 main.ts**

(a) `fetchJob` 后、模板 fetch 前,加终态短路(**用 `return`,不是 throw** —— bullmq 视为成功完成、不再重试):
```ts
      const job = await fetchJob(jobId);
      if (!job) {
        // eslint-disable-next-line no-console
        console.warn(`[render] job ${jobId} not found in db — permanent failure`);
        throw new UnrecoverableError(`job ${jobId} not found in db`);
      }
      // P0:已终态 → stalled 重投/重复派发,直接跳过,杜绝重复渲染+重复回调
      if (job.status === 'done' || job.status === 'failed') {
        // eslint-disable-next-line no-console
        console.log(`[render] job ${jobId} already ${job.status} — skip (stalled re-exec)`);
        return;
      }
```

(b) `template_not_found` 分支:`markFailed` 现返回 number,rowCount>0 才回调:
```ts
      if (!tpl) {
        const changed = await markFailed(jobId, 'template_not_found', attemptNo);
        if (changed > 0) await sendCallback(jobId, job.callback_url);
        throw new UnrecoverableError('template_not_found');
      }
```

(c) 成功路径:在 `try` 外声明 `let doneChanged = 0;`,try 内 `doneChanged = await markDone(...)`;最后的成功回调改为按 rowCount 决定:
```ts
      await markProcessing(jobId);
      const page = await pool.acquire();
      let ok = false;
      let doneChanged = 0;
      try {
        const paperMm = resolvePaperMm(tpl.data);
        const renderPromise = renderJobOnPage(page, { /* 不变 */ });
        renderPromise.catch(() => {});
        const result = await withTimeout(renderPromise, JOB_TIMEOUT_MS, 'render');
        doneChanged = await markDone(jobId, result.pdfUrl, result.pngUrl, attemptNo);
        ok = true;
        // eslint-disable-next-line no-console
        console.log(`[render] done ${jobId} (attempt ${attemptNo})`);
      } catch (e) {
        const msg = (e as Error).message ?? 'unknown_error';
        // eslint-disable-next-line no-console
        console.error(`[render] failed ${jobId} (attempt ${attemptNo}/${totalAttempts}): ${msg}`);
        if (isLastAttempt) {
          const failChanged = await markFailed(jobId, msg, attemptNo);
          if (failChanged > 0) await sendCallback(jobId, job.callback_url);
        }
        throw e;
      } finally {
        if (ok) pool.release(page);
        else await withTimeout(pool.recycle(page), 15_000, 'recycle').catch(() => {});
      }

      // 成功才到这（失败已 throw）：仅当本次真翻转了 done 才回调（防与 cron 抢先标 failed 后重复成功回调）
      if (doneChanged > 0) await sendCallback(jobId, job.callback_url);
```

- [ ] **Step 2: typecheck + lint + 渲染往返冒烟**

Run: `docker exec template_printing-render sh -c "cd /workspace/apps/render && pnpm run typecheck && pnpm run lint"`
渲染往返冒烟:确保 render 容器加载新代码(Windows 挂载不热重载 → `docker restart template_printing-render`),用已发布模板 `41fcaaf0-7ece-4930-b93b-2afc325f1f49` 经 API 入队一个 job,确认 job 走到 `done` 且产物可下载(回归未破)。

- [ ] **Step 3: 提交**
```bash
git add apps/render/src/main.ts
git commit -m "fix(render): 终态短路 return + rowCount 决定 sendCallback,杜绝 stalled 重投重复渲染/重复回调(P0)"
```

---

## Task 3(P0):cron reconcileStuckJobs updateMany 守卫

**Files:** Modify `apps/api/src/render/render-cleanup.service.ts`;Test `apps/api/test/render-stuck-reconcile.e2e.spec.ts`(既有,扩断言)。

- [ ] **Step 1: 写失败断言**

先 Read 既有 `apps/api/test/render-stuck-reconcile.e2e.spec.ts` 摸清造 stuck job 的写法。加一条 case:造一个 `status='done'`(非 processing)且 `startedAt` 很旧的 job,跑 `reconcileStuckJobs()` 后断言它**仍 `done`、未被标 failed**(验证 `where.status='processing'` 守卫);并断言对真正 `processing` 超时的 job 仍被标 `stuck_timeout`(既有行为不回归)。

- [ ] **Step 2: 跑测试确认失败**

Run: `docker exec template_printing-api sh -c "cd /workspace/apps/api && pnpm test -- test/render-stuck-reconcile.e2e.spec.ts"`
Expected: 新 case FAIL(当前无条件 `update({where:{id}})` 会把 done 覆盖成 failed)。

- [ ] **Step 3: 改 reconcileStuckJobs 循环**

把循环体的无条件 `update` 改为带状态守卫的 `updateMany` + `count===1` 才回调:
```ts
    for (const job of stuck) {
      const { count } = await this.prisma.renderJob.updateMany({
        where: { id: job.id, status: 'processing' },
        data: { status: 'failed', errorMsg: 'stuck_timeout', completedAt: new Date() },
      });
      if (count === 1) await this.sendStuckCallback(job.id, job.callbackUrl);
    }
```
> `count===1` 表示本 cron 真把它从 processing 翻成 failed(findMany 快照与此刻之间它若已 `markDone` → count=0 → 不覆盖、不回调)。

- [ ] **Step 4: 测试通过 + typecheck + lint**

Run: `docker exec template_printing-api sh -c "cd /workspace/apps/api && pnpm test -- test/render-stuck-reconcile.e2e.spec.ts && pnpm run typecheck && pnpm run lint"`

- [ ] **Step 5: 提交**
```bash
git add apps/api/src/render/render-cleanup.service.ts apps/api/test/render-stuck-reconcile.e2e.spec.ts
git commit -m "fix(api): 对账 cron 改 updateMany+status=processing 守卫,count===1 才回调,不覆盖已终态(P0)"
```

---

## Task 4(P0):飞书回调 handler 幂等守卫

**Files:** Modify `apps/api/src/lark/lark-bitable.controller.ts`、`apps/api/src/lark/lark-bot.controller.ts`;Test `apps/api/test/render-callback-idempotency.e2e.spec.ts`(新)。

- [ ] **Step 1: 写失败 e2e**

新建 `apps/api/test/render-callback-idempotency.e2e.spec.ts`(照搬 `apps/api/test/render-callback-token.e2e.spec.ts` 的 bootstrap + 调用方式)。重点验 bitable 路径幂等:
- 造一个 `larkPrintRequest`(`callbackStatus='done'`,renderJobId=某 job)+ 对应 render_job;mock/spy `BitableService.uploadMaterial`(或用 nock 拦飞书 API);
- 用合法 `RENDER_CALLBACK_SECRET` token POST `/lark/render-callback` body `{jobId, status:'done', pdfUrl:'/uploads/render/x.pdf'}`;
- 断言:**`uploadMaterial` / `updateRecord` 未被调用**(因已 `done`),HTTP 200 `{ok:true}`。
(bot 路径同理可加一条:`larkBotSession.state='done'` 时 POST `/lark/bot/render-callback` 不再 `uploadIMFile`/`sendFileMessage`。token env 为 `LARK_BOT_VERIFICATION_TOKEN`。)
afterAll 清造的行。

- [ ] **Step 2: 跑测试确认失败**

Run: `docker exec template_printing-api sh -c "cd /workspace/apps/api && pnpm test -- test/render-callback-idempotency.e2e.spec.ts"`
Expected: FAIL(当前无守卫 → 二次 done 仍重传 PDF、断言"未调用"失败)。

- [ ] **Step 3: 加幂等守卫**

`lark-bitable.controller.ts` `renderCallback`,在 `if (!req) { return { ok: true }; }` 之后加:
```ts
    // P0:已成功回写过 → 幂等,杜绝 stalled 重投/补发导致重复上传 PDF + 重复写回
    if (req.callbackStatus === 'done') return { ok: true };
```
`lark-bot.controller.ts` `renderCallback`,在 `if (!session) return { ok: true };` 之后加:
```ts
    if (session.state === 'done') return { ok: true };
```

- [ ] **Step 4: 测试通过 + typecheck + lint**

Run: `docker exec template_printing-api sh -c "cd /workspace/apps/api && pnpm test -- test/render-callback-idempotency.e2e.spec.ts && pnpm run typecheck && pnpm run lint"`

- [ ] **Step 5: 提交**
```bash
git add apps/api/src/lark/lark-bitable.controller.ts apps/api/src/lark/lark-bot.controller.ts apps/api/test/render-callback-idempotency.e2e.spec.ts
git commit -m "fix(api): 飞书回调 handler 幂等守卫(callbackStatus/state==='done' 短路),防重复上传 PDF/写回(P0)"
```

---

## Task 5(P1a):backoff jitter

**Files:** Modify `apps/api/src/render/render.service.ts`。

- [ ] **Step 1: 改入队选项**

`render.service.ts` 入队 `backoff` 加 `jitter`:
```ts
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000, jitter: 0.5 },
```

- [ ] **Step 2: 验证**

若有现成 enqueue 单测则加断言 `jitter:0.5`;否则 `docker exec template_printing-api sh -c "cd /workspace/apps/api && pnpm run typecheck && pnpm run lint"` 即可(bullmq 类型接受 `jitter`)。

- [ ] **Step 3: 提交**
```bash
git add apps/api/src/render/render.service.ts
git commit -m "perf(api): 渲染重试 backoff 加 jitter:0.5,防并发同步齐步重试惊群(P1a)"
```

---

## Task 6(P1b):回调失败补发(列 + migration + cron + env)

**Files:** Modify `apps/api/prisma/schema.prisma`(+ migration)、`apps/api/src/render/render-cleanup.service.ts`、`.env.example`、`.env.prod.example`、`apps/api/test/env-example-sync.spec.ts`;Test `apps/api/test/callback-resend.e2e.spec.ts`(新)。

- [ ] **Step 1: schema 加列 + migration**

`schema.prisma` `RenderJob` 在 `callbackStatus` 行下加:
```prisma
  callbackAttempts Int      @default(0) @map("callback_attempts")     // 批次4:补发 cron 已发次数
```
生成迁移(容器内,非 reset):
```bash
docker exec template_printing-api sh -c "cd /workspace/apps/api && npx prisma migrate dev --name add_callback_attempts"
```
确认生成 `migration.sql` 含 `ALTER TABLE "render_jobs" ADD COLUMN "callback_attempts" INTEGER NOT NULL DEFAULT 0;`,且 prisma client 重新生成(migrate dev 自动 generate)。

- [ ] **Step 2: 写失败 e2e**

新建 `apps/api/test/callback-resend.e2e.spec.ts`(照搬 render-stuck-reconcile bootstrap)。**用外部 mock 回调端点**(本机起一个 http server 或用 supertest 的 app 自身一个临时路由;最简:用 Node `http.createServer` 监听随机端口收 POST,断言收到):
- 造 done job:`status='done'`、`pdfUrl='/uploads/render/x.pdf'`、`callbackStatus='failed'`、`callbackAttempts=0`、`callbackUrl=http://127.0.0.1:<port>/cb`、`completedAt` 设为 10 分钟前(过 `5*2^0=5min` 退避档);
- `process.env.CALLBACK_RESEND_MAX_ATTEMPTS='5'`;调 `app.get(RenderCleanupService).resendFailedCallbacks()`;
- 断言:mock 端点**收到一次 POST**(payload 含 jobId/status/pdfUrl 带签名);若 mock 返 200 → job `callbackStatus='sent'`;再调一次 cron → 不再发(因 sent)。
- 反例:`completedAt=now`(未过退避档)→ 不发;`callbackAttempts>=5` → 不发;`callbackUrl=null` → 不发。
afterAll 关 server + 清行。

Run 确认失败:`... pnpm test -- test/callback-resend.e2e.spec.ts` → FAIL(`resendFailedCallbacks` 不存在)。

- [ ] **Step 3: 实现 resendFailedCallbacks**

在 `render-cleanup.service.ts` 加(`reconcileStuckJobs`/`sendStuckCallback` 附近;复用已 import 的 `fetch`(undici)、`Cron`、`this.fileSig`):
```ts
  /**
   * P1b(批次4):回调失败补发。对已终态、有 callbackUrl、callbackStatus='failed'、
   * 且未超 CALLBACK_RESEND_MAX_ATTEMPTS(默认5,≤0关)的 job,按指数退避重发。
   * 退避资格:completedAt + 5 * 2^callbackAttempts 分钟 <= now(base=5min=cron粒度;
   * 实际落在 completedAt 后 5/10/20/40/80min,horizon≈80min,5 次耗尽即永久 failed)。
   * 计数:仅本 cron 每发一次 callbackAttempts += 1(worker 初发/sendStuckCallback 不动它)。
   * 注:飞书内部回调始终 HTTP 200(写失败也 ack)→ 本 cron 实际只服务"外部 callbackUrl 返 5xx/超时"的调用方。
   */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async resendFailedCallbacks(): Promise<void> {
    const max = Number(process.env.CALLBACK_RESEND_MAX_ATTEMPTS ?? 5);
    if (!Number.isFinite(max) || max <= 0) return;
    const candidates = await this.prisma.renderJob.findMany({
      where: {
        status: { in: ['done', 'failed'] },
        callbackUrl: { not: null },
        callbackStatus: 'failed',
        callbackAttempts: { lt: max },
      },
      select: {
        id: true, status: true, pdfUrl: true, pngUrl: true, errorMsg: true,
        callbackUrl: true, completedAt: true, callbackAttempts: true,
      },
    });
    const now = Date.now();
    for (const job of candidates) {
      if (!job.completedAt || !job.callbackUrl) continue;
      const eligibleAt = job.completedAt.getTime() + 5 * Math.pow(2, job.callbackAttempts) * 60_000;
      if (now < eligibleAt) continue;
      await this.resendOne(job.id, job.callbackUrl, job.status, job.pdfUrl, job.pngUrl, job.errorMsg);
    }
  }

  /** 与 worker webhook.ts payload 对齐;发后必 callbackAttempts+1,2xx→sent 否则 failed。 */
  private async resendOne(
    jobId: string,
    callbackUrl: string,
    status: string,
    pdfUrl: string | null,
    pngUrl: string | null,
    errorMsg: string | null,
  ): Promise<void> {
    const payload = {
      jobId,
      status,
      pdfUrl: this.fileSig.signUrl(pdfUrl),
      pngUrl: this.fileSig.signUrl(pngUrl),
      errorMsg,
    };
    let ok = false;
    try {
      const res = await fetch(callbackUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10_000),
      });
      ok = res.ok;
    } catch {
      ok = false;
    }
    await this.prisma.renderJob.update({
      where: { id: jobId },
      data: { callbackStatus: ok ? 'sent' : 'failed', callbackAttempts: { increment: 1 } },
    });
  }
```
> 确认 `FileSigService.signUrl(null)` 接受 null(现有 `sendStuckCallback` 已这样用)。

- [ ] **Step 4: env + 双向校验白名单**

`.env.example` 渲染/清理段、`.env.prod.example` 对应段加:
```bash
CALLBACK_RESEND_MAX_ATTEMPTS=5   # 回调失败补发最大次数(≤0=关),退避 completedAt+5*2^n 分钟
```
`apps/api/test/env-example-sync.spec.ts` 的 `NON_ENVTS_ALLOWED` 加 `'CALLBACK_RESEND_MAX_ATTEMPTS'`。

- [ ] **Step 5: 测试通过 + typecheck + lint**

Run: `docker exec template_printing-api sh -c "cd /workspace/apps/api && pnpm test -- test/callback-resend.e2e.spec.ts test/env-example-sync.spec.ts && pnpm run typecheck && pnpm run lint"`

- [ ] **Step 6: 提交**
```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations apps/api/src/render/render-cleanup.service.ts .env.example .env.prod.example apps/api/test/env-example-sync.spec.ts apps/api/test/callback-resend.e2e.spec.ts
git commit -m "feat(api): 回调失败补发 cron(callback_attempts 列 + 指数退避 5*2^n,horizon≈80min)(P1b)"
```

---

## Task 7(P2b):stuck_timeout 终态指标

**Files:** Modify `apps/api/src/render/render-cleanup.service.ts`;Test `apps/api/test/render-stuck-reconcile.e2e.spec.ts`(扩断言)。依赖 T3(updateMany + count===1 分支)。

- [ ] **Step 1: 写失败断言**

在 `render-stuck-reconcile.e2e.spec.ts` 加:跑 `reconcileStuckJobs()`(造一个真 stuck processing job)后,`const text = await app.get(MetricsService).expose();` 断言含 `tp_render_jobs_total{` 且 `status="stuck_timeout"` 计数 ≥1。

- [ ] **Step 2: 跑测试确认失败**

Run: `docker exec template_printing-api sh -c "cd /workspace/apps/api && pnpm test -- test/render-stuck-reconcile.e2e.spec.ts"`
Expected: 新断言 FAIL(当前 cron 不 inc metrics)。

- [ ] **Step 3: 注入 MetricsService + inc**

`render-cleanup.service.ts` 顶部 import `MetricsService`(`../metrics/metrics.service.js`);构造函数加 `private readonly metrics: MetricsService`(MetricsModule 是 `@Global`,无需改 render.module imports)。T3 的 `count===1` 分支改为:
```ts
      if (count === 1) {
        this.metrics.renderJobs.inc({ status: 'stuck_timeout', source: 'cron' });
        await this.sendStuckCallback(job.id, job.callbackUrl);
      }
```

- [ ] **Step 4: 测试通过 + typecheck + lint**

Run: `docker exec template_printing-api sh -c "cd /workspace/apps/api && pnpm test -- test/render-stuck-reconcile.e2e.spec.ts && pnpm run typecheck && pnpm run lint"`

- [ ] **Step 5: 提交**
```bash
git add apps/api/src/render/render-cleanup.service.ts apps/api/test/render-stuck-reconcile.e2e.spec.ts
git commit -m "feat(api): 对账 cron 翻转 stuck job 时 inc tp_render_jobs_total{status=stuck_timeout}(P2b)"
```

---

## Task 8:文档 + 全量回归

**Files:** Modify `docs/deployment.md`、`docs/PROGRESS.md`。

- [ ] **Step 1: deployment.md**

在渲染/运维段补:
- `CALLBACK_RESEND_MAX_ATTEMPTS` 含义 + 默认5 + ≤0关 + 退避公式 + horizon≈80min(超时即永久 failed,要求外部调用方按 jobId 幂等去重)。
- P0 终态粘性说明(markDone/markFailed/cron/飞书 handler 幂等,杜绝 stalled 重投脏写)。
- **stuck_timeout 告警:** `tp_render_jobs_total{status="stuck_timeout"}` 持续 >0 = render worker OOM/崩溃,给一段 Prometheus 告警规则示例(如 `increase(tp_render_jobs_total{status="stuck_timeout"}[15m]) > 0`)。

- [ ] **Step 2: 全量回归**

Run: `docker exec template_printing-api sh -c "cd /workspace/apps/api && pnpm test && pnpm run typecheck && pnpm run lint"`(全绿、无回归)
Run: `docker exec template_printing-render sh -c "cd /workspace/apps/render && pnpm test && pnpm run typecheck && pnpm run lint"`

- [ ] **Step 3: PROGRESS**

`docs/PROGRESS.md` `### 2026-05-28` 追加批次4 Plan1 条目(P0 状态机单调性 / P1a jitter / P1b 回调补发 + `CALLBACK_RESEND_MAX_ATTEMPTS` / P2b stuck_timeout 指标);更新"最近更新"日期。注明 P2a 整体留待 Plan 2。

- [ ] **Step 4: 提交**
```bash
git add docs/deployment.md docs/PROGRESS.md
git commit -m "docs: 批次4 Plan1 同步(P0 状态机单调性 + P1 回调可靠性 + P2b stuck_timeout 告警)"
```

---

## Self-Review

**Spec 覆盖:** P0→T1(db 粘性)+T2(main 短路/rowCount)+T3(cron 守卫)+T4(飞书幂等)✅;P1a→T5 ✅;P1b→T6 ✅;P2b→T7 ✅;文档/回归→T8 ✅。P2a 不在本 plan(已划 Plan 2)✅。

**占位符扫描:** 源码改动均给完整代码;测试给断言意图 + 命令 + 期望(DB 造行细节引用 schema,沿用 batch3 已验证的"照搬 bootstrap"粒度)。无 TBD。

**类型/一致性:** `markDone`/`markFailed` 由 `Promise<void>`→`Promise<number>`(T1),main.ts(T2)按返回值用 `doneChanged`/`failChanged`/`changed`,一致;cron `count===1` 分支被 T3 建立、T7 复用(T7 依赖 T3);`callbackAttempts` 键在 schema/cron/.env.example/.env.prod.example/NON_ENVTS_ALLOWED 五处一致;退避公式 `5*2^callbackAttempts`(spec 与 plan 一致)。

**顺序依赖:** T2 依赖 T1(返回值);T7 依赖 T3(count 分支);T6 与 T7 都改 `render-cleanup.service.ts`,subagent-driven 顺序执行无冲突。

**风险点:** T2 内联闭包不单测(已说明,靠 T1+评审+渲染往返);T6 migrate dev 在共享 dev DB 加列(仅 ADD COLUMN DEFAULT,无数据损失,不违反禁 reset/db push);render 容器须 up 且改后端代码需 `docker restart` 才生效(测试不受影响,编译新鲜)。
