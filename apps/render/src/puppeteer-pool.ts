export interface PuppeteerPoolConfig {
  browsers: number;
  pagesPerBrowser: number;
}

/**
 * Placeholder pool — real Browser/Page allocation lands in Plan 4.
 * For Plan 0 we just want a typed shape and basic config validation.
 */
export class PuppeteerPool {
  readonly browsers: number;
  readonly pagesPerBrowser: number;
  private _ready = false;

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
    // Real implementation in Plan 4.
    this._ready = true;
  }

  async shutdown(): Promise<void> {
    this._ready = false;
  }
}
