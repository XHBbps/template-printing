// eslint-disable-next-line import/no-unresolved
import puppeteer, { type Browser, type Page } from 'puppeteer';

export interface PuppeteerPoolConfig {
  browsers: number;
  pagesPerBrowser: number;
}

interface BrowserSlot {
  browser: Browser;
  pages: Page[];
  inUse: Set<Page>;
}

/**
 * Browser+page pool for headless rendering.
 * `acquire()` returns a free Page; `release(page)` returns it for reuse.
 */
export class PuppeteerPool {
  readonly browsers: number;
  readonly pagesPerBrowser: number;
  private _ready = false;
  private slots: BrowserSlot[] = [];
  private idleQueue: Page[] = [];
  private waitQueue: Array<(page: Page) => void> = [];

  constructor(config: PuppeteerPoolConfig) {
    if (config.browsers <= 0 || config.pagesPerBrowser <= 0) {
      throw new Error('PuppeteerPool requires positive browser and page counts');
    }
    this.browsers = config.browsers;
    this.pagesPerBrowser = config.pagesPerBrowser;
  }

  get capacity(): number {
    return this.browsers * this.pagesPerBrowser;
  }

  get isReady(): boolean {
    return this._ready;
  }

  async warmup(): Promise<void> {
    if (this._ready) return;
    const execPath = process.env.PUPPETEER_EXECUTABLE_PATH;
    for (let i = 0; i < this.browsers; i += 1) {
      const browser = await puppeteer.launch({
        executablePath: execPath,
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
        ],
      });
      const pages: Page[] = [];
      for (let p = 0; p < this.pagesPerBrowser; p += 1) {
        const page: Page =
          p === 0
            ? (await browser.pages())[0] ?? (await browser.newPage())
            : await browser.newPage();
        pages.push(page);
        this.idleQueue.push(page);
      }
      this.slots.push({ browser, pages, inUse: new Set() });
    }
    this._ready = true;
  }

  async acquire(): Promise<Page> {
    const next = this.idleQueue.shift();
    if (next) {
      this.markInUse(next);
      return next;
    }
    return new Promise<Page>((resolve) => {
      this.waitQueue.push((page) => {
        this.markInUse(page);
        resolve(page);
      });
    });
  }

  release(page: Page): void {
    for (const slot of this.slots) {
      if (slot.inUse.has(page)) {
        slot.inUse.delete(page);
        break;
      }
    }
    const waiter = this.waitQueue.shift();
    if (waiter) {
      waiter(page);
    } else {
      this.idleQueue.push(page);
    }
  }

  private markInUse(page: Page): void {
    for (const slot of this.slots) {
      if (slot.pages.includes(page)) {
        slot.inUse.add(page);
        return;
      }
    }
  }

  async shutdown(): Promise<void> {
    this._ready = false;
    for (const slot of this.slots) {
      try {
        await slot.browser.close();
      } catch {
        // ignore
      }
    }
    this.slots = [];
    this.idleQueue = [];
    this.waitQueue = [];
  }
}
