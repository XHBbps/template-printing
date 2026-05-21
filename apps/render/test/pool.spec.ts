import { describe, it, expect } from 'vitest';

// eslint-disable-next-line import/no-unresolved
import { PuppeteerPool } from '../src/puppeteer-pool.js';

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
});
