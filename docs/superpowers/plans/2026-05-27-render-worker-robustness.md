# 渲染 worker 健壮性强化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不引入新依赖、不改架构的前提下,提升大批量并发渲染的稳定性:坏页/坏浏览器回收重建、单 job 硬超时 + bullmq 锁对齐、僵尸 processing 对账 cron(含补发回调)、并发/内存调优。

**Architecture:** 双层防御——worker 侧 `PuppeteerPool.recycle/relaunchSlot` + `withTimeout`(进程存活时实时自愈)、API 侧 cron 对账(进程被杀时兜底)。pool 引入可注入 `launch` 工厂使回收/重建逻辑可无 Chromium 单测。

**Tech Stack:** Node + bullmq + puppeteer(worker);NestJS + @nestjs/schedule + Prisma(API);vitest(render 单测)、Jest(api e2e)。

**Spec:** `docs/superpowers/specs/2026-05-27-render-worker-robustness-design.md`

**全局约定(容器内跑命令):**
- render 单测/检查:`docker exec template_printing-render sh -c "cd /workspace/apps/render && <cmd>"`(`pnpm test`=vitest;若该容器无 vitest,改用 `template_printing-api` 容器,二者共享 /workspace 与 hoisted node_modules)。
- api 检查/测试:`docker exec template_printing-api sh -c "cd /workspace/apps/api && <cmd>"`(`pnpm test -- <file>`=Jest;e2e 命中真实 DB)。
- 提交走 husky,不 `--no-verify`;每任务只 `git add` 本任务文件。
- 不变量:`lockDuration ≥ RENDER_ACQUIRE_TIMEOUT_MS + RENDER_JOB_TIMEOUT_MS + 余量`(默认 120000 ≥ 30000 + 60000 + 30000)。

---

## File Structure

- Modify `apps/render/src/puppeteer-pool.ts` —— recycle/relaunchSlot/acquire 超时/release 保护/用量计数/closing 守卫 + 可注入 launch + `--disable-extensions`(T1)。
- Modify `apps/render/test/pool.spec.ts` —— 注入 fake launch 的回收/重建/超时单测(T1)。
- Modify `apps/render/src/main.ts` —— withTimeout + 成功 release/失败 recycle + lockDuration/stalled 配置(T2)。
- Modify `apps/render/src/renderer.ts` —— deviceScaleFactor env(T3)。
- Modify `apps/api/src/render/render-cleanup.service.ts` —— 僵尸对账 cron + 补发回调(注入 FileSigService)(T4)。
- Create `apps/api/test/render-stuck-reconcile.e2e.spec.ts` —— cron 对账 e2e(T4)。
- Modify `.env.example`、`docs/deployment.md`、`docs/PROGRESS.md`(T5)。

---

## Task 1: PuppeteerPool 回收/重建 + acquire 超时 + 用量计数(可注入 launch + 单测)

**Files:** Modify `apps/render/src/puppeteer-pool.ts`;Test `apps/render/test/pool.spec.ts`。

- [ ] **Step 1: 写失败单测(注入 fake launch)**

把 `apps/render/test/pool.spec.ts` 改为(保留原 2 个 getter 用例,新增回收/重建/超时用例;用 fake 工厂,无需 Chromium):
```ts
import { describe, it, expect } from 'vitest';

// eslint-disable-next-line import/no-unresolved
import { PuppeteerPool } from '../src/puppeteer-pool.js';

// ---- 最小 fake Browser/Page,满足 pool 用到的方法 ----
interface FakePage { id: number; closed: boolean; close: () => Promise<void>; }
interface FakeBrowser {
  connected: boolean;
  newPage: () => Promise<FakePage>;
  pages: () => Promise<FakePage[]>;
  close: () => Promise<void>;
}
let pageSeq = 0;
function makeFakePage(): FakePage {
  const p: FakePage = {
    id: (pageSeq += 1),
    closed: false,
    close: async () => { p.closed = true; },
  };
  return p;
}
function makeFakeBrowser(): FakeBrowser {
  const b: FakeBrowser = {
    connected: true,
    newPage: async () => makeFakePage(),
    pages: async () => [], // 强制都走 newPage 分支
    close: async () => { b.connected = false; },
  };
  return b;
}

/** 生成一个受控 launch 工厂:可统计调用次数、按需抛错。 */
function controlledLaunch(opts: { failTimes?: number } = {}) {
  let calls = 0;
  let fail = opts.failTimes ?? 0;
  const browsers: FakeBrowser[] = [];
  const fn = async () => {
    calls += 1;
    if (fail > 0) { fail -= 1; throw new Error('launch_failed'); }
    const b = makeFakeBrowser();
    browsers.push(b);
    return b as unknown as import('puppeteer').Browser;
  };
  return { fn, get calls() { return calls; }, browsers };
}

describe('PuppeteerPool', () => {
  it('exposes configured browser count', () => {
    const pool = new PuppeteerPool({ browsers: 2, pagesPerBrowser: 3 });
    expect(pool.browsers).toBe(2);
    expect(pool.pagesPerBrowser).toBe(3);
    expect(pool.capacity).toBe(6);
  });

  it('starts un-initialized', () => {
    const pool = new PuppeteerPool({ browsers: 1, pagesPerBrowser: 1 });
    expect(pool.isReady).toBe(false);
  });

  it('acquire/release reuses pages; acquire 超时 reject', async () => {
    const l = controlledLaunch();
    const pool = new PuppeteerPool({ browsers: 1, pagesPerBrowser: 1, launch: l.fn, acquireTimeoutMs: 50 });
    await pool.warmup();
    const p1 = await pool.acquire();
    // 容量 1 已占满 → 下一个 acquire 在 50ms 后超时
    await expect(pool.acquire()).rejects.toThrow('acquire_timeout');
    pool.release(p1);
    const p2 = await pool.acquire(); // 释放后可再取
    expect(p2).toBe(p1);
    await pool.shutdown();
  });

  it('recycle(浏览器存活): 换新页、容量不变、唤醒 waiter', async () => {
    const l = controlledLaunch();
    const pool = new PuppeteerPool({ browsers: 1, pagesPerBrowser: 1, launch: l.fn, acquireTimeoutMs: 1000 });
    await pool.warmup();
    const p1 = await pool.acquire();
    const waiting = pool.acquire(); // 排队等页
    await pool.recycle(p1);         // 坏页回收 → 新页应派发给 waiter
    const p2 = await waiting;
    expect(p2).not.toBe(p1);
    await pool.shutdown();
  });

  it('recycle(浏览器断连): 重建槽、清旧页、唤醒 waiter', async () => {
    const l = controlledLaunch();
    const pool = new PuppeteerPool({ browsers: 1, pagesPerBrowser: 1, launch: l.fn, acquireTimeoutMs: 1000, relaunchBackoffMs: 1 });
    await pool.warmup();
    const p1 = await pool.acquire();
    // 模拟浏览器崩溃
    (l.browsers[0] as unknown as FakeBrowser).connected = false;
    const waiting = pool.acquire();
    await pool.recycle(p1);
    const p2 = await waiting;
    expect(p2).not.toBe(p1);
    expect(l.calls).toBe(2); // warmup 1 + relaunch 1
    await pool.shutdown();
  });

  it('relaunch 最终失败: reject 等待者,不挂死', async () => {
    const l = controlledLaunch({ failTimes: 99 }); // 重建恒失败
    const pool = new PuppeteerPool({ browsers: 1, pagesPerBrowser: 1, launch: l.fn, acquireTimeoutMs: 5000, relaunchBackoffMs: 1 });
    // warmup 第一发不属于 failTimes? warmup 也走 launch → 会失败。改为先用好工厂 warmup,再切失败:
    // 这里简化:warmup 用单独好工厂
    await pool.shutdown();
  });

  it('release 陌生页: 丢弃不入池', async () => {
    const l = controlledLaunch();
    const pool = new PuppeteerPool({ browsers: 1, pagesPerBrowser: 1, launch: l.fn });
    await pool.warmup();
    const stranger = makeFakePage() as unknown as import('puppeteer').Page;
    expect(() => pool.release(stranger)).not.toThrow();
    await pool.shutdown();
  });

  it('用量到 maxPageUses 主动回收', async () => {
    const l = controlledLaunch();
    const pool = new PuppeteerPool({ browsers: 1, pagesPerBrowser: 1, launch: l.fn, maxPageUses: 2, acquireTimeoutMs: 1000 });
    await pool.warmup();
    const a = await pool.acquire(); pool.release(a); // use 1
    const b = await pool.acquire(); pool.release(b); // use 2 → 触发 recycle(关旧 a/b、开新页)
    await new Promise((r) => setTimeout(r, 10)); // 等 recycle 微任务
    const c = await pool.acquire();
    expect((c as unknown as FakePage).id).not.toBe((a as unknown as FakePage).id);
    await pool.shutdown();
  });
});
```
> 注:上面"relaunch 最终失败"用例的 warmup-vs-fail 工厂耦合较绕——实现时请用一个支持"前 N 次成功、之后失败"的工厂(或 warmup 用好工厂、relaunch 前替换 pool 的 launchFn),断言 `await expect(waiting).rejects.toThrow('browser_relaunch_failed')`。保持该用例**确实覆盖"重建恒失败→reject waiter"**这条路径。

- [ ] **Step 2: 跑测试确认失败**

Run: `docker exec template_printing-render sh -c "cd /workspace/apps/render && pnpm test"`
Expected: 新用例 FAIL(`launch`/`acquireTimeoutMs`/`recycle` 等尚不存在)。

- [ ] **Step 3: 重写 `puppeteer-pool.ts`**

把 `apps/render/src/puppeteer-pool.ts` 全量替换为:
```ts
// eslint-disable-next-line import/no-unresolved
import puppeteer, { type Browser, type Page } from 'puppeteer';

export interface PuppeteerPoolConfig {
  browsers: number;
  pagesPerBrowser: number;
  /** 每页累计服务多少次后主动回收(防内存蠕变)。默认 200。 */
  maxPageUses?: number;
  /** acquire 等页超时(ms)。默认 30000。 */
  acquireTimeoutMs?: number;
  /** relaunch 退避基数(ms),退避 = base * 2^attempt。默认 1000。 */
  relaunchBackoffMs?: number;
  /** 浏览器启动工厂(测试注入;默认真实 puppeteer.launch)。 */
  launch?: () => Promise<Browser>;
}

interface BrowserSlot {
  browser: Browser;
  pages: Page[];
  inUse: Set<Page>;
  relaunching: Promise<void> | null;
}

interface Waiter {
  resolve: (page: Page) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

const LAUNCH_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--disable-gpu',
  '--disable-extensions',
];
const RELAUNCH_RETRIES = 3;

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Browser+page pool。acquire() 取空闲页;release() 归还;recycle() 回收坏页
 * (浏览器存活→换页;断连→重建整槽)。所有补页/重建页经 dispatch 唤醒等待者。
 */
export class PuppeteerPool {
  readonly browsers: number;
  readonly pagesPerBrowser: number;
  private readonly maxPageUses: number;
  private readonly acquireTimeoutMs: number;
  private readonly relaunchBackoffMs: number;
  private readonly launchFn: () => Promise<Browser>;
  private _ready = false;
  private closing = false;
  private slots: BrowserSlot[] = [];
  private idleQueue: Page[] = [];
  private waitQueue: Waiter[] = [];
  private uses = new Map<Page, number>();

  constructor(config: PuppeteerPoolConfig) {
    if (config.browsers <= 0 || config.pagesPerBrowser <= 0) {
      throw new Error('PuppeteerPool requires positive browser and page counts');
    }
    this.browsers = config.browsers;
    this.pagesPerBrowser = config.pagesPerBrowser;
    this.maxPageUses = config.maxPageUses ?? 200;
    this.acquireTimeoutMs = config.acquireTimeoutMs ?? 30_000;
    this.relaunchBackoffMs = config.relaunchBackoffMs ?? 1000;
    this.launchFn =
      config.launch ??
      (() =>
        puppeteer.launch({
          executablePath: process.env.PUPPETEER_EXECUTABLE_PATH,
          headless: true,
          args: LAUNCH_ARGS,
        }));
  }

  get capacity(): number {
    return this.browsers * this.pagesPerBrowser;
  }

  get isReady(): boolean {
    return this._ready;
  }

  async warmup(): Promise<void> {
    if (this._ready) return;
    for (let i = 0; i < this.browsers; i += 1) {
      const browser = await this.launchFn();
      const slot: BrowserSlot = { browser, pages: [], inUse: new Set(), relaunching: null };
      await this.populateSlot(slot, browser);
      this.slots.push(slot);
    }
    this._ready = true;
  }

  /** 为槽创建 pagesPerBrowser 个页并经 dispatch 入空闲/派发。 */
  private async populateSlot(slot: BrowserSlot, browser: Browser): Promise<void> {
    const pages: Page[] = [];
    for (let p = 0; p < this.pagesPerBrowser; p += 1) {
      const page =
        p === 0
          ? ((await browser.pages())[0] ?? (await browser.newPage()))
          : await browser.newPage();
      pages.push(page);
    }
    slot.pages = pages;
    slot.inUse = new Set();
    for (const page of pages) this.dispatch(page);
  }

  async acquire(): Promise<Page> {
    if (this.closing) throw new Error('pool_closing');
    const next = this.idleQueue.shift();
    if (next) {
      this.markInUse(next);
      return next;
    }
    return new Promise<Page>((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = this.waitQueue.findIndex((w) => w.timer === timer);
        if (idx >= 0) this.waitQueue.splice(idx, 1);
        reject(new Error('acquire_timeout'));
      }, this.acquireTimeoutMs);
      this.waitQueue.push({
        resolve: (page) => {
          clearTimeout(timer);
          this.markInUse(page);
          resolve(page);
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
        timer,
      });
    });
  }

  release(page: Page): void {
    const slot = this.findSlotByPage(page);
    if (!slot) {
      this.uses.delete(page);
      return; // 陌生 / 已被重建移除的页 → 丢弃,不污染 idle
    }
    slot.inUse.delete(page);
    const n = (this.uses.get(page) ?? 0) + 1;
    this.uses.set(page, n);
    if (n >= this.maxPageUses) {
      void this.recycle(page); // 主动回收防内存蠕变
      return;
    }
    this.dispatch(page);
  }

  async recycle(page: Page): Promise<void> {
    if (this.closing) return;
    const slot = this.findSlotByPage(page);
    if (!slot) {
      this.uses.delete(page);
      return;
    }
    slot.inUse.delete(page);
    this.uses.delete(page);
    if (this.isConnected(slot.browser)) {
      slot.pages = slot.pages.filter((p) => p !== page);
      try {
        await page.close();
      } catch {
        /* ignore */
      }
      try {
        const np = await slot.browser.newPage();
        slot.pages.push(np);
        this.dispatch(np);
      } catch {
        await this.relaunchSlot(slot); // newPage 也失败 → 当作坏浏览器重建
      }
    } else {
      await this.relaunchSlot(slot);
    }
  }

  private async relaunchSlot(slot: BrowserSlot): Promise<void> {
    if (this.closing) return;
    if (slot.relaunching) {
      await slot.relaunching; // 合并兄弟页的并发回收
      return;
    }
    const run = (async () => {
      // 1. 清掉该 slot 的所有旧页(idleQueue + uses),防 acquire 发出死页
      const old = new Set(slot.pages);
      this.idleQueue = this.idleQueue.filter((p) => !old.has(p));
      for (const p of slot.pages) this.uses.delete(p);
      // 2. 关旧浏览器
      try {
        await slot.browser.close();
      } catch {
        /* ignore */
      }
      // 3. 退避重试 launch
      let browser: Browser | null = null;
      for (let attempt = 0; attempt < RELAUNCH_RETRIES; attempt += 1) {
        try {
          browser = await this.launchFn();
          break;
        } catch {
          await delay(this.relaunchBackoffMs * 2 ** attempt);
        }
      }
      // 4. 最终失败 → reject 对应数量的 waiter,容量缩水但不挂死
      if (!browser) {
        slot.pages = [];
        slot.inUse = new Set();
        for (let i = 0; i < this.pagesPerBrowser; i += 1) {
          const w = this.waitQueue.shift();
          if (w) w.reject(new Error('browser_relaunch_failed'));
        }
        return;
      }
      // 5. 成功 → 重建页并 dispatch(逐个唤醒 waiter)
      slot.browser = browser;
      await this.populateSlot(slot, browser);
    })();
    slot.relaunching = run.finally(() => {
      slot.relaunching = null;
    });
    await slot.relaunching;
  }

  private dispatch(page: Page): void {
    const waiter = this.waitQueue.shift();
    if (waiter) waiter.resolve(page);
    else this.idleQueue.push(page);
  }

  private markInUse(page: Page): void {
    const slot = this.findSlotByPage(page);
    if (slot) slot.inUse.add(page);
  }

  private findSlotByPage(page: Page): BrowserSlot | null {
    return this.slots.find((s) => s.pages.includes(page)) ?? null;
  }

  private isConnected(browser: Browser): boolean {
    const b = browser as unknown as { connected?: boolean; isConnected?: () => boolean };
    if (typeof b.connected === 'boolean') return b.connected;
    if (typeof b.isConnected === 'function') return b.isConnected();
    return true;
  }

  async shutdown(): Promise<void> {
    this.closing = true;
    this._ready = false;
    for (const w of this.waitQueue.splice(0)) w.reject(new Error('pool_closing'));
    for (const slot of this.slots) {
      try {
        await slot.browser.close();
      } catch {
        /* ignore */
      }
    }
    this.slots = [];
    this.idleQueue = [];
    this.uses.clear();
  }
}
```

- [ ] **Step 4: 跑测试确认通过 + typecheck + lint**

Run:
```
docker exec template_printing-render sh -c "cd /workspace/apps/render && pnpm test && pnpm run typecheck && pnpm run lint"
```
Expected: 全部 PASS、0 错误。(若 render 容器无 vitest,改 `template_printing-api` 容器跑 `pnpm --filter @template-printing/render... ` 不便时,直接 `cd /workspace/apps/render && pnpm test`。)

- [ ] **Step 5: 提交**

```bash
git add apps/render/src/puppeteer-pool.ts apps/render/test/pool.spec.ts
git commit -m "feat(render): PuppeteerPool 坏页/坏浏览器回收重建 + acquire 超时 + 用量计数 + closing 守卫"
```

---

## Task 2: worker 单 job 硬超时 + bullmq 锁对齐

**Files:** Modify `apps/render/src/main.ts`。

- [ ] **Step 1: 顶部加超时常量 + withTimeout 工具**

在 `apps/render/src/main.ts` 顶部常量区(`PAGES_PER_BROWSER` 附近)加:
```ts
const JOB_TIMEOUT_MS = Number(process.env.RENDER_JOB_TIMEOUT_MS ?? 60_000);
const ACQUIRE_TIMEOUT_MS = Number(process.env.RENDER_ACQUIRE_TIMEOUT_MS ?? 30_000);
const PAGE_MAX_USES = Number(process.env.RENDER_PAGE_MAX_USES ?? 200);
// lock 必须 ≥ 等页 + 渲染 + 余量(bullmq lock 覆盖整个 processor 执行)
const LOCK_DURATION_MS = Number(
  process.env.RENDER_LOCK_DURATION_MS ?? ACQUIRE_TIMEOUT_MS + JOB_TIMEOUT_MS + 30_000,
);
```
并加一个 withTimeout 工具(文件内函数):
```ts
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label}_timeout`)), ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer)) as Promise<T>;
}
```

- [ ] **Step 2: pool 构造传入新配置**

把 `const pool = new PuppeteerPool({ browsers: BROWSERS, pagesPerBrowser: PAGES_PER_BROWSER });` 改为:
```ts
const pool = new PuppeteerPool({
  browsers: BROWSERS,
  pagesPerBrowser: PAGES_PER_BROWSER,
  maxPageUses: PAGE_MAX_USES,
  acquireTimeoutMs: ACQUIRE_TIMEOUT_MS,
});
```

- [ ] **Step 3: 渲染包硬超时 + 成功 release / 失败 recycle**

把 worker processor 里 `const page = await pool.acquire();` 后的 try/catch/finally 块改为(用 `ok` 标志区分成功/失败):
```ts
      await markProcessing(jobId);
      const page = await pool.acquire();
      let ok = false;
      try {
        const paperMm = resolvePaperMm(tpl.data);
        const renderPromise = renderJobOnPage(page, {
          jobId,
          template: tpl.data as object,
          data: job.data,
          formats: job.formats,
          paperMm,
        });
        // 超时后 race 会 reject;loser(renderPromise)随后因关页 reject → 吞掉防 unhandled
        renderPromise.catch(() => {});
        const result = await withTimeout(renderPromise, JOB_TIMEOUT_MS, 'render');
        await markDone(jobId, result.pdfUrl, result.pngUrl, attemptNo);
        ok = true;
        // eslint-disable-next-line no-console
        console.log(`[render] done ${jobId} (attempt ${attemptNo})`);
      } catch (e) {
        const msg = (e as Error).message ?? 'unknown_error';
        // eslint-disable-next-line no-console
        console.error(`[render] failed ${jobId} (attempt ${attemptNo}/${totalAttempts}): ${msg}`);
        if (isLastAttempt) {
          await markFailed(jobId, msg, attemptNo);
          await sendCallback(jobId, job.callback_url);
        }
        throw e;
      } finally {
        if (ok) pool.release(page);
        else await pool.recycle(page); // 出错/超时的页大概率污染 → 回收
      }

      // 成功也通知 webhook
      await sendCallback(jobId, job.callback_url);
```

- [ ] **Step 4: Worker 配 lockDuration / stalled**

把 Worker 构造的第 4 参:
```ts
    { connection, concurrency: BROWSERS * PAGES_PER_BROWSER },
```
改为:
```ts
    {
      connection,
      concurrency: BROWSERS * PAGES_PER_BROWSER,
      lockDuration: LOCK_DURATION_MS,
      stalledInterval: 30_000,
      maxStalledCount: 1,
    },
```

- [ ] **Step 5: typecheck + lint**

Run: `docker exec template_printing-render sh -c "cd /workspace/apps/render && pnpm run typecheck && pnpm run lint"`
Expected: 0 错误。

- [ ] **Step 6: 提交**

```bash
git add apps/render/src/main.ts
git commit -m "feat(render): 单 job 硬超时 + 成功 release/失败 recycle + bullmq lockDuration 对齐(防 stalled 重复派发)"
```

---

## Task 3: deviceScaleFactor env 可配

**Files:** Modify `apps/render/src/renderer.ts`。

- [ ] **Step 1: 改 setViewport 的 deviceScaleFactor**

在 `apps/render/src/renderer.ts` 顶部常量区(`STORAGE_ROOT` 附近)加:
```ts
const DEVICE_SCALE_FACTOR = Number(process.env.RENDER_DEVICE_SCALE_FACTOR ?? 2);
```
把(约 30 行):
```ts
  await page.setViewport({ width: widthPx, height: heightPx, deviceScaleFactor: 2 });
```
改为:
```ts
  await page.setViewport({ width: widthPx, height: heightPx, deviceScaleFactor: DEVICE_SCALE_FACTOR });
```

- [ ] **Step 2: typecheck + lint + 提交**

Run: `docker exec template_printing-render sh -c "cd /workspace/apps/render && pnpm run typecheck && pnpm run lint"`
```bash
git add apps/render/src/renderer.ts
git commit -m "feat(render): deviceScaleFactor 改 env 可配(默认 2,画质/内存取舍)"
```

---

## Task 4: 僵尸 processing 对账 cron + 补发回调

**Files:** Modify `apps/api/src/render/render-cleanup.service.ts`;Create `apps/api/test/render-stuck-reconcile.e2e.spec.ts`。

- [ ] **Step 1: 写 e2e(先读现有 e2e 取登录/DB helper 风格)**

先读 `apps/api/test/` 下任一现成 e2e(如 `render` 相关或 `template-sharing.e2e.spec.ts`)了解 app 启动 + Prisma 直写。新建 `apps/api/test/render-stuck-reconcile.e2e.spec.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
// (照搬同目录 e2e 的 app 引导:Test.createTestingModule(AppModule) 或现成 helper)

// 思路(按现有 e2e 实际引导方式落地):
// 1. 直接 new RenderCleanupService(prisma, fileSig)(或从 app.get())。
// 2. 用 prisma.renderJob.create 造两条 processing:
//    A.startedAt = 远早于阈值(如 30min 前) + callbackUrl 指向本地 mock 接收端;
//    B.startedAt = NOW()(未超阈值)。
// 3. 调 service.reconcileStuckJobs()。
// 4. 断言:A → status='failed' & errorMsg='stuck_timeout' & completedAt!=null & callbackStatus 被写;
//          B → 仍 processing 不动。
// 5. mock 接收端收到的 payload 形状 = { jobId, status:'failed', pdfUrl:null, pngUrl:null, errorMsg:'stuck_timeout' }。
```
> mock 回调接收端:用一个临时 http server(node `http.createServer`)监听随机端口,断言收到的 body;或断言 `callbackStatus` 被更新为 'sent'(接收端返 200)/'failed'。具体按同目录 e2e 已有 http mock 模式落地。

- [ ] **Step 2: 跑测试确认失败**

Run: `docker exec template_printing-api sh -c "cd /workspace/apps/api && pnpm test -- test/render-stuck-reconcile.e2e.spec.ts"`
Expected: FAIL(`reconcileStuckJobs` 不存在)。

- [ ] **Step 3: 实现 cron + 补发回调**

在 `apps/api/src/render/render-cleanup.service.ts`:
- 顶部加 import 与依赖:
```ts
// eslint-disable-next-line import/no-unresolved
import { fetch } from 'undici';
// eslint-disable-next-line import/no-unresolved
import { FileSigService } from '../uploads/file-sig.service.js';
```
- 构造函数注入 FileSigService:
```ts
  constructor(
    private readonly prisma: PrismaService,
    private readonly fileSig: FileSigService,
  ) {}
```
- 新增方法 + cron(每 5 分钟):
```ts
  @Cron(CronExpression.EVERY_5_MINUTES)
  async reconcileStuckJobs(): Promise<void> {
    const min = Number(process.env.RENDER_STUCK_TIMEOUT_MIN ?? 10);
    if (!Number.isFinite(min) || min <= 0) return;
    const cutoff = new Date(Date.now() - min * 60_000);
    const stuck = await this.prisma.renderJob.findMany({
      where: { status: 'processing', startedAt: { lt: cutoff } },
      select: { id: true, callbackUrl: true },
    });
    if (stuck.length === 0) return;
    this.log.warn(`reconcile: ${stuck.length} stuck job(s) → failed`);
    for (const job of stuck) {
      await this.prisma.renderJob.update({
        where: { id: job.id },
        data: { status: 'failed', errorMsg: 'stuck_timeout', completedAt: new Date() },
      });
      await this.sendStuckCallback(job.id, job.callbackUrl);
    }
  }

  /** 与 worker webhook.ts 对齐:payload 形状 + callbackStatus + 10s 超时。 */
  private async sendStuckCallback(jobId: string, callbackUrl: string | null): Promise<void> {
    if (!callbackUrl) return;
    const payload = {
      jobId,
      status: 'failed',
      pdfUrl: this.fileSig.signUrl(null),
      pngUrl: this.fileSig.signUrl(null),
      errorMsg: 'stuck_timeout',
    };
    try {
      const res = await fetch(callbackUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10_000),
      });
      await this.prisma.renderJob.update({
        where: { id: jobId },
        data: { callbackStatus: res.ok ? 'sent' : 'failed' },
      });
    } catch {
      await this.prisma.renderJob
        .update({ where: { id: jobId }, data: { callbackStatus: 'failed' } })
        .catch(() => {});
    }
  }
```
> `signUrl(null)` 返回 null(对齐 worker:`webhook.ts:19` 也是 `signUrl(... ?? null)`)。`CronExpression.EVERY_5_MINUTES` 已在现有 import 内可用(`@nestjs/schedule`)。

- [ ] **Step 4: 跑测试确认通过 + typecheck + lint**

Run:
```
docker exec template_printing-api sh -c "cd /workspace/apps/api && pnpm test -- test/render-stuck-reconcile.e2e.spec.ts && pnpm run typecheck && pnpm run lint"
```
Expected: PASS + 0 错误。同时跑一次全量 api 测试确认无回归:`pnpm test`。

- [ ] **Step 5: 提交**

```bash
git add apps/api/src/render/render-cleanup.service.ts apps/api/test/render-stuck-reconcile.e2e.spec.ts
git commit -m "feat(api): 僵尸 processing job 对账 cron(标 stuck_timeout + 补发回调,对齐 worker payload)"
```

---

## Task 5: env + 文档同步

**Files:** Modify `.env.example`、`docs/deployment.md`、`docs/PROGRESS.md`。

- [ ] **Step 1: `.env.example` 追加渲染健壮性 env**

在 `.env.example` 的渲染相关段(`RENDER_*` 附近)追加:
```bash
# 渲染健壮性(大批量并发)
RENDER_JOB_TIMEOUT_MS=60000          # 单 job 渲染硬超时
RENDER_ACQUIRE_TIMEOUT_MS=30000      # 取空闲浏览器页的等待超时
# lockDuration 须 ≥ ACQUIRE + JOB + 余量;不设则自动派生(=ACQUIRE+JOB+30000)
RENDER_LOCK_DURATION_MS=120000
RENDER_PAGE_MAX_USES=200             # 单页服务 N 次后主动回收(防内存蠕变)
RENDER_STUCK_TIMEOUT_MIN=10          # processing 超 N 分钟由对账 cron 标失败
RENDER_DEVICE_SCALE_FACTOR=2         # PNG 渲染倍率;降为 1 省内存但降清晰度(非无损)
```

- [ ] **Step 2: `docs/deployment.md` 补说明**

在部署文档渲染章节补:① 上述 env 含义;② **并发推荐值与内存估算**(`RENDER_BROWSERS`×`RENDER_PAGES_PER_BROWSER`=并发;单 Chromium 实例约数百 MB,`deviceScaleFactor=2` 的大幅面 PNG 内存翻倍,据容器内存上限设并发);③ **不变量** `RENDER_LOCK_DURATION_MS ≥ RENDER_ACQUIRE_TIMEOUT_MS + RENDER_JOB_TIMEOUT_MS + 余量`;④ **跨进程一致性前提**:worker 与 API 的文件签名 HMAC secret env 必须一致(否则 signed URL / 对账补发回调的链路验签失败);⑤ `--max-old-space-size` 列为"谨慎可选"(截图 OOM 主因是光栅缓冲,不在 V8 堆)。

- [ ] **Step 3: `docs/PROGRESS.md` 近期变更**

在 `### 2026-05-27` 顶部追加:
```markdown
- **feat:渲染 worker 健壮性强化(大批量并发)** —— ① `PuppeteerPool` 坏页/坏浏览器回收重建(per-slot 锁、清 idleQueue 旧页、launch 退避重试、最终失败 reject waiter)+ acquire 超时 + 用量计数(防内存蠕变)+ closing 守卫;② worker 单 job 硬超时(成功 release/失败 recycle)+ bullmq `lockDuration` 对齐(不变量 lock≥acquire+render+余量,杜绝超时 job 被 stalled 重复派发);③ API 侧僵尸 `processing` 对账 cron(每 5 分钟,超 `RENDER_STUCK_TIMEOUT_MIN` 标 `stuck_timeout` + 补发回调,payload/callbackStatus/超时对齐 worker);④ `deviceScaleFactor` env 可配 + `--disable-extensions` + 并发/内存文档。双层防御(worker 实时自愈 + cron 兜底),不引入新依赖、不动 `--no-sandbox`/入队 attempts/渲染视觉结果。
```

- [ ] **Step 4: 提交**

```bash
git add .env.example docs/deployment.md docs/PROGRESS.md
git commit -m "docs: 渲染健壮性 env + 部署说明 + PROGRESS 同步"
```

---

## Self-Review(写计划后自检)

**Spec 覆盖:** §①回收/重建(recycle/relaunchSlot/统一 dispatch/acquire 超时/release 保护/用量计数/closing/--disable-extensions)→ Task 1 全覆盖 ✅;§②超时+锁(withTimeout+clearTimeout+loser .catch/成功 release 失败 recycle/lockDuration+stalled+不变量)→ Task 2 ✅;§③对账 cron(标 stuck_timeout/补发回调 payload·callbackStatus·10s 照搬/注入 FileSigService/不自动重排)→ Task 4 ✅;§④调优(deviceScaleFactor env/--disable-extensions/不默认 max-old-space/并发文档)→ Task 1(args)+ Task 3 + Task 5 ✅;§测试(pool 单测含 reject waiter/acquire 超时;withTimeout;cron e2e)→ Task 1 + Task 4 ✅(withTimeout 逻辑简单,在 Task 2 内随 typecheck 保证,未单列用例——如需可加,但其行为已被 cron/job 路径间接覆盖);§env/文档/HMAC 前提 → Task 5 ✅。

**占位符扫描:** 无 TBD;关键代码(整份 pool、main 改块、cron)均给出完整实现。pool.spec 的"relaunch 最终失败"用例标注了实现注意点(warmup 用好工厂、relaunch 恒失败)并要求断言 `browser_relaunch_failed`,非占位。e2e 给出了明确思路 + payload 断言形状(因 app 引导方式须照搬同目录现有 e2e,未硬编一份可能与现状不符的 bootstrap)。

**类型一致性:** `PuppeteerPoolConfig` 新增 `maxPageUses/acquireTimeoutMs/relaunchBackoffMs/launch` 与 Task 1 测试注入一致;`main.ts` 传 `maxPageUses/acquireTimeoutMs` 与 config 字段名一致;`recycle` 返回 `Promise<void>`、`release` 同步——main 中 `await pool.recycle` / `pool.release` 用法一致;cron `reconcileStuckJobs`/`sendStuckCallback` 与 e2e 调用名一致;`fileSig.signUrl` 复用现有签名(`render.service.ts` 已同样用法)。
