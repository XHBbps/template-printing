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
        p === 0 ? (await browser.pages())[0] ?? (await browser.newPage()) : await browser.newPage();
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
    // recycle(下面 maxPageUses 分支)内部也会 delete，但那是异步路径；
    // 此处 delete 是正常归还路径的单一权威，两者互不重叠。
    slot.inUse.delete(page);
    const n = (this.uses.get(page) ?? 0) + 1;
    this.uses.set(page, n);
    if (n >= this.maxPageUses) {
      void this.recycle(page).catch(() => {}); // 主动回收防内存蠕变;吞掉拒绝防 unhandledRejection
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
      // 同步清空 slot.pages：重建期间任何并发 release 旧页都会落入 stranger-drop（findSlotByPage→null），
      // 不会把死页 re-dispatch 给 waiter。
      const old = slot.pages;
      slot.pages = [];
      const oldSet = new Set(old);
      this.idleQueue = this.idleQueue.filter((p) => !oldSet.has(p));
      for (const p of old) this.uses.delete(p);
      try {
        await slot.browser.close();
      } catch {
        /* ignore */
      }
      // 2. 退避重试 launch
      let browser: Browser | null = null;
      for (let attempt = 0; attempt < RELAUNCH_RETRIES; attempt += 1) {
        try {
          browser = await this.launchFn();
          break;
        } catch {
          await delay(this.relaunchBackoffMs * 2 ** attempt);
        }
      }
      // 3. 最终失败 → reject 对应数量的 waiter,容量缩水但不挂死
      // reject 至多 pagesPerBrowser 个 FIFO waiter 是降级状态下的 fail-fast 近似；
      // acquireTimeoutMs 是终极保底，确保不会有 waiter 永久挂死。
      if (!browser) {
        slot.inUse = new Set();
        for (let i = 0; i < this.pagesPerBrowser; i += 1) {
          const w = this.waitQueue.shift();
          if (w) w.reject(new Error('browser_relaunch_failed'));
        }
        return;
      }
      // 4. 成功 → 重建页并 dispatch(逐个唤醒 waiter)
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
