import fs from 'fs/promises';
import path from 'path';

// eslint-disable-next-line import/no-unresolved
import type { Page } from 'puppeteer';

const WEB_BASE = process.env.WEB_BASE ?? 'http://web:5173';
const STORAGE_ROOT = process.env.STORAGE_ROOT ?? '/storage';
// PNG 渲染倍率;降为 1 可省内存但降低输出清晰度/分辨率(非无损)。默认 2。
const DEVICE_SCALE_FACTOR = Number(process.env.RENDER_DEVICE_SCALE_FACTOR ?? 2);

export interface RenderOutput {
  pdfPath: string | null;
  pngPath: string | null;
  pdfUrl: string | null;
  pngUrl: string | null;
}

export async function renderJobOnPage(
  page: Page,
  args: {
    jobId: string;
    template: object;
    data: Record<string, unknown>;
    formats: string[];
    paperMm: { w: number; h: number };
  },
): Promise<RenderOutput> {
  // 1. Set viewport to natural paper size first so the page lays out correctly.
  const widthPx = Math.round(args.paperMm.w * 4); // 4 px/mm canonical (matches PX_PER_MM)
  const heightPx = Math.round(args.paperMm.h * 4);
  await page.setViewport({
    width: widthPx,
    height: heightPx,
    deviceScaleFactor: DEVICE_SCALE_FACTOR,
  });

  // Surface browser-side errors / warnings + diagnostic `[ph] ...` logs
  // from PrintHeadlessView to worker stdout. Other Vite HMR noise muted.
  const onConsole = (msg: { type: () => string; text: () => string }): void => {
    const type = msg.type();
    const text = msg.text();
    if (type === 'error' || type === 'warning' || text.startsWith('[ph]')) {
      // eslint-disable-next-line no-console
      console.log(`[render][page.${type}] ${text}`);
    }
  };
  const onPageError = (err: Error): void => {
    // eslint-disable-next-line no-console
    console.error(`[render][page.error] ${err.message}`);
  };
  page.on('console', onConsole);
  page.on('pageerror', onPageError);

  let pdfPath: string | null = null;
  let pngPath: string | null = null;

  try {
    // 2. Navigate to /print-headless route — also resets window state from
    //    any previous render on this reused page.
    await page.goto(`${WEB_BASE}/print-headless/${args.jobId}`, { waitUntil: 'networkidle0' });

    // 3. Inject template + data into the page
    await page.evaluate(
      (template, data) => {
        (window as unknown as { __renderInput: object }).__renderInput = { template, data };
      },
      args.template,
      args.data,
    );

    // 4. Wait for the page to signal ready (Vue rendered).
    // polling: 100 — explicit ms polling. Default 'raf' (requestAnimationFrame)
    // is throttled in headless / non-visible pages so it can miss __renderReady
    // even after it's set; see iter 26 / iter 27 debugging.
    await page.waitForFunction(
      () => (window as unknown as { __renderReady?: boolean }).__renderReady === true,
      { timeout: 30_000, polling: 100 },
    );

    // 5. Generate outputs
    const outDir = path.join(STORAGE_ROOT, 'uploads', 'render');
    await fs.mkdir(outDir, { recursive: true });

    if (args.formats.includes('pdf')) {
      pdfPath = path.join(outDir, `${args.jobId}.pdf`);
      await page.pdf({
        path: pdfPath,
        width: `${args.paperMm.w}mm`,
        height: `${args.paperMm.h}mm`,
        printBackground: true,
        margin: { top: 0, right: 0, bottom: 0, left: 0 },
      });
    }

    if (args.formats.includes('png')) {
      pngPath = path.join(outDir, `${args.jobId}.png`);
      await page.screenshot({
        path: pngPath,
        type: 'png',
        clip: { x: 0, y: 0, width: widthPx, height: heightPx },
      });
    }
  } finally {
    // Always detach listeners — otherwise they accumulate on the pooled page
    // and cross-job console events get logged multiple times.
    page.off('console', onConsole);
    page.off('pageerror', onPageError);
  }

  return {
    pdfPath,
    pngPath,
    pdfUrl: pdfPath ? `/uploads/render/${args.jobId}.pdf` : null,
    pngUrl: pngPath ? `/uploads/render/${args.jobId}.png` : null,
  };
}

export function resolvePaperMm(template: unknown): { w: number; h: number } {
  // Resolve from template.canvas.paper / orientation. Use the same presets as store.
  type T = { canvas: { paper: string | { w_mm: number; h_mm: number }; orientation: string } };
  const t = template as T;
  const presets: Record<string, { w: number; h: number }> = {
    A3: { w: 297, h: 420 },
    A4: { w: 210, h: 297 },
    A5: { w: 148, h: 210 },
    B4: { w: 250, h: 353 },
    B5: { w: 176, h: 250 },
  };
  let w = 210;
  let h = 297;
  const paper = t.canvas.paper;
  if (typeof paper === 'string') {
    const preset = presets[paper];
    if (preset) {
      w = preset.w;
      h = preset.h;
    }
  } else if (typeof paper === 'object' && 'w_mm' in paper) {
    w = paper.w_mm;
    h = paper.h_mm;
  }
  return t.canvas.orientation === 'landscape' ? { w: h, h: w } : { w, h };
}
