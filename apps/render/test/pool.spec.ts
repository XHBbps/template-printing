import { describe, it, expect } from 'vitest';

// eslint-disable-next-line import/no-unresolved
import { PuppeteerPool } from '../src/puppeteer-pool.js';

// ---- 最小 fake Browser/Page,满足 pool 用到的方法 ----
interface FakePage {
  id: number;
  closed: boolean;
  close: () => Promise<void>;
}
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
    close: async () => {
      p.closed = true;
    },
  };
  return p;
}
function makeFakeBrowser(): FakeBrowser {
  const b: FakeBrowser = {
    connected: true,
    newPage: async () => makeFakePage(),
    pages: async () => [], // 强制都走 newPage 分支
    close: async () => {
      b.connected = false;
    },
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
    if (fail > 0) {
      fail -= 1;
      throw new Error('launch_failed');
    }
    const b = makeFakeBrowser();
    browsers.push(b);
    return b as unknown as import('puppeteer').Browser;
  };
  return {
    fn,
    get calls() {
      return calls;
    },
    browsers,
  };
}

/**
 * 生成一个"前 n 次成功、之后恒失败"的 launch 工厂。
 * 用于"relaunch 最终失败"测试:warmup 阶段(第 1 次)成功,
 * 随后所有 relaunch 尝试均抛出 launch_failed。
 */
function failAfter(successCount: number) {
  let calls = 0;
  const browsers: FakeBrowser[] = [];
  const fn = async () => {
    calls += 1;
    if (calls > successCount) throw new Error('launch_failed');
    const b = makeFakeBrowser();
    browsers.push(b);
    return b as unknown as import('puppeteer').Browser;
  };
  return {
    fn,
    get calls() {
      return calls;
    },
    browsers,
  };
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
    const pool = new PuppeteerPool({
      browsers: 1,
      pagesPerBrowser: 1,
      launch: l.fn,
      acquireTimeoutMs: 50,
    });
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
    const pool = new PuppeteerPool({
      browsers: 1,
      pagesPerBrowser: 1,
      launch: l.fn,
      acquireTimeoutMs: 1000,
    });
    await pool.warmup();
    const p1 = await pool.acquire();
    const waiting = pool.acquire(); // 排队等页
    await pool.recycle(p1); // 坏页回收 → 新页应派发给 waiter
    const p2 = await waiting;
    expect(p2).not.toBe(p1);
    await pool.shutdown();
  });

  it('recycle(浏览器断连): 重建槽、清旧页、唤醒 waiter', async () => {
    const l = controlledLaunch();
    const pool = new PuppeteerPool({
      browsers: 1,
      pagesPerBrowser: 1,
      launch: l.fn,
      acquireTimeoutMs: 1000,
      relaunchBackoffMs: 1,
    });
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
    // failAfter(1): 第 1 次(warmup)成功,之后所有 relaunch 尝试均失败
    const l = failAfter(1);
    const pool = new PuppeteerPool({
      browsers: 1,
      pagesPerBrowser: 1,
      launch: l.fn,
      acquireTimeoutMs: 5000,
      relaunchBackoffMs: 1,
    });
    await pool.warmup(); // 第 1 次 launch 成功
    const p1 = await pool.acquire();
    // 模拟浏览器崩溃,触发 relaunchSlot
    (l.browsers[0] as unknown as FakeBrowser).connected = false;
    const waiting = pool.acquire(); // 排队等待,期望被 reject
    // recycle 会尝试 RELAUNCH_RETRIES(3) 次,全部失败 → reject waiter
    await pool.recycle(p1);
    await expect(waiting).rejects.toThrow('browser_relaunch_failed');
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
    const pool = new PuppeteerPool({
      browsers: 1,
      pagesPerBrowser: 1,
      launch: l.fn,
      maxPageUses: 2,
      acquireTimeoutMs: 1000,
    });
    await pool.warmup();
    const a = await pool.acquire();
    pool.release(a); // use 1
    const b = await pool.acquire();
    pool.release(b); // use 2 → 触发 recycle(关旧 a/b、开新页)
    await new Promise((r) => setTimeout(r, 10)); // 等 recycle 微任务
    const c = await pool.acquire();
    expect((c as unknown as FakePage).id).not.toBe((a as unknown as FakePage).id);
    await pool.shutdown();
  });
});
