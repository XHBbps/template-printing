# Iter 26 — Async Render Service Plan

> **For agentic workers:** Use superpowers:subagent-driven-development.

**Goal:** 实现异步渲染管道：调用方 POST /api/render 入队 → worker 用 puppeteer 渲染 PDF + PNG → 完成后通过 webhook 回调告知调用方（含成功 URL 或错误信息）。

**用户场景：** 飞书机器人调用方传入 `{templateId, data, callbackUrl}`，无需阻塞等待。Worker 完成后 POST 到 callbackUrl，body 含 `{jobId, status, pdfUrl, pngUrl, errorMsg}`。

**Pre-state:**
- ✅ `apps/render/` worker 骨架已建（bullmq + ioredis + puppeteer-pool）— 但 handler 是 placeholder
- ✅ `docker/render.Dockerfile` 已配 Chromium + 中文字体
- ✅ `docker-compose.dev.yml` 有 render 服务、redis 服务
- ❌ 没有 `/api/render` 端点
- ❌ 没有 `render_jobs` 表
- ❌ 没有 `/print-headless` 前端路由
- ❌ Worker 没有实际渲染逻辑 / webhook 回调

**Tech Stack:** NestJS + Prisma + Pinia + Puppeteer + bullmq + ioredis + undici (HTTP for webhook).

Type-check:
```bash
docker compose -f docker-compose.dev.yml exec -T web sh -c 'cd /workspace/apps/web && NODE_OPTIONS=--max-old-space-size=4096 ./node_modules/.bin/vue-tsc --noEmit'
docker compose -f docker-compose.dev.yml exec -T api sh -c 'cd /workspace/apps/api && npx tsc --noEmit'
docker compose -f docker-compose.dev.yml exec -T render sh -c 'cd /workspace/apps/render && npx tsc --noEmit'
```

---

## File Structure

| 文件 | 任务 |
|---|---|
| `apps/api/prisma/schema.prisma` | T1 |
| `apps/api/prisma/migrations/.../migration.sql` (new) | T1 |
| `apps/api/src/render/render.module.ts` (new) | T2 |
| `apps/api/src/render/render.controller.ts` (new) | T2 |
| `apps/api/src/render/render.service.ts` (new) | T2 |
| `apps/api/src/app.module.ts` | T2 |
| `apps/web/src/views/PrintHeadlessView.vue` (new) | T3 |
| `apps/web/src/router/index.ts` | T3 |
| `apps/render/src/main.ts` | T4, T5 |
| `apps/render/src/renderer.ts` (new) | T4 |
| `apps/render/src/webhook.ts` (new) | T5 |
| `apps/render/src/db.ts` (new) | T4 |
| `apps/render/package.json` | T4 (deps) |
| `apps/web/src/views/ApiDocsView.vue` | T6 |
| — | T7 acceptance |

---

### Task 1: DB schema — `render_jobs` 表

**File:** `apps/api/prisma/schema.prisma`

- [ ] **Step 1:** 在 schema.prisma 末尾追加：
  ```prisma
  model RenderJob {
    id           String    @id @default(uuid())
    templateId   String    @map("template_id")
    template     Template  @relation(fields: [templateId], references: [id], onDelete: Cascade)
    data         Json
    formats      String[]                                    // 例如 ['pdf', 'png']
    status       String    @default("pending")               // pending / processing / done / failed
    pdfUrl       String?   @map("pdf_url")
    pngUrl       String?   @map("png_url")
    errorMsg     String?   @map("error_msg")
    callbackUrl  String?   @map("callback_url")
    callbackStatus String? @map("callback_status")           // sent / failed / null (no callback)
    createdAt    DateTime  @default(now()) @map("created_at")
    startedAt    DateTime? @map("started_at")
    completedAt  DateTime? @map("completed_at")
    @@index([templateId, createdAt(sort: Desc)])
    @@index([status, createdAt])
    @@map("render_jobs")
  }
  ```

  另在 `model Template { ... }` 内追加反向关系字段：
  ```prisma
  renderJobs RenderJob[]
  ```

- [ ] **Step 2:** 跑 migration：
  ```bash
  docker compose -f docker-compose.dev.yml exec -T api sh -c 'cd /workspace/apps/api && npx prisma migrate dev --name add_render_jobs'
  ```

- [ ] **Step 3:** commit：
  ```bash
  git add apps/api/prisma/
  git commit -m "feat(db): render_jobs 表 — 异步渲染任务模型（status / urls / callbackUrl）"
  ```

---

### Task 2: API — POST/GET /api/render

**Files:**
- `apps/api/src/render/render.module.ts`
- `apps/api/src/render/render.controller.ts`
- `apps/api/src/render/render.service.ts`
- `apps/api/src/app.module.ts`

- [ ] **Step 1: render.service.ts**

  ```ts
  // eslint-disable-next-line import/no-unresolved
  import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
  import { Queue } from 'bullmq';
  import IORedis from 'ioredis';

  // eslint-disable-next-line import/no-unresolved
  import { PrismaService } from '../prisma/prisma.service.js';

  export interface EnqueueArgs {
    templateId: string;
    data: Record<string, unknown>;
    formats?: ('pdf' | 'png')[];
    callbackUrl?: string;
  }

  @Injectable()
  export class RenderService {
    private readonly queue: Queue;

    constructor(private readonly prisma: PrismaService) {
      const url = process.env.REDIS_URL ?? 'redis://localhost:6379';
      this.queue = new Queue('render', { connection: new IORedis(url, { maxRetriesPerRequest: null }) });
    }

    async enqueue(ownerId: string, args: EnqueueArgs): Promise<{ jobId: string; status: string }> {
      // 校验 template 存在 + ownership
      const tpl = await this.prisma.template.findFirst({
        where: { id: args.templateId, ownerId },
      });
      if (!tpl) throw new NotFoundException('template_not_found');
      const formats = args.formats?.length ? args.formats : ['pdf', 'png'];
      const job = await this.prisma.renderJob.create({
        data: {
          templateId: args.templateId,
          data: args.data as object,
          formats,
          status: 'pending',
          callbackUrl: args.callbackUrl ?? null,
        },
      });
      await this.queue.add('render', { jobId: job.id }, { jobId: job.id });
      return { jobId: job.id, status: job.status };
    }

    async get(jobId: string) {
      const job = await this.prisma.renderJob.findUnique({ where: { id: jobId } });
      if (!job) throw new NotFoundException('job_not_found');
      return {
        jobId: job.id,
        status: job.status,
        pdfUrl: job.pdfUrl,
        pngUrl: job.pngUrl,
        errorMsg: job.errorMsg,
        createdAt: job.createdAt,
        completedAt: job.completedAt,
      };
    }
  }
  ```

- [ ] **Step 2: render.controller.ts**

  ```ts
  // eslint-disable-next-line import/no-unresolved
  import {
    Body,
    Controller,
    Get,
    Param,
    Post,
    BadRequestException,
  } from '@nestjs/common';
  // eslint-disable-next-line import/no-unresolved
  import { z } from 'zod';

  // eslint-disable-next-line import/no-unresolved
  import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
  // eslint-disable-next-line import/no-unresolved
  import { RenderService } from './render.service.js';

  const EnqueueDto = z.object({
    templateId: z.string().min(1),
    data: z.record(z.unknown()).default({}),
    formats: z.array(z.enum(['pdf', 'png'])).optional(),
    callbackUrl: z.string().url().optional(),
  });

  @Controller('render')
  export class RenderController {
    constructor(private readonly svc: RenderService) {}

    @Post()
    async enqueue(@CurrentUser() me: { sub: string }, @Body() rawBody: unknown) {
      const parsed = EnqueueDto.safeParse(rawBody);
      if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
      return this.svc.enqueue(me.sub, parsed.data);
    }

    @Get(':jobId')
    async get(@Param('jobId') jobId: string) {
      return this.svc.get(jobId);
    }
  }
  ```

- [ ] **Step 3: render.module.ts**

  ```ts
  // eslint-disable-next-line import/no-unresolved
  import { Module } from '@nestjs/common';

  // eslint-disable-next-line import/no-unresolved
  import { RenderController } from './render.controller.js';
  // eslint-disable-next-line import/no-unresolved
  import { RenderService } from './render.service.js';

  @Module({
    controllers: [RenderController],
    providers: [RenderService],
  })
  export class RenderModule {}
  ```

- [ ] **Step 4: 注册到 AppModule**

  在 `apps/api/src/app.module.ts` 的 imports 数组添加：
  ```ts
  import { RenderModule } from './render/render.module.js';
  // imports: [..., RenderModule]
  ```

- [ ] **Step 5: nginx-like static for render outputs**

  Render outputs 落到 `/storage/render/<jobId>.{pdf,png}`。nginx 已有 `/uploads/` 静态。需要扩展 nginx 或后端 routes 给 `/render-outputs/<id>.<ext>`。

  最简方案：在 NestJS 内部用 `@nestjs/serve-static` 提供 `/render-outputs/*` 服务 from `/storage/render/`. 但 dev 环境 vite 已经代理 /api/* 到 api，其他不代理。

  其实简化版：让 worker 把文件写到 `/storage/uploads/render/<jobId>.{pdf,png}` —— 复用现有 `/uploads/` 静态服务（已经通过 nginx 服务）。

  在 RenderService 里返回 `pdfUrl: \`/uploads/render/${job.id}.pdf\``。

  注意 controller 接 `me.sub` 是 user.id；render output 静态服务不需要 ownership check (URL 含 jobId 已经足够混淆；后续 iter 可加 signed URL)。

- [ ] **Step 6: type-check + restart api + commit**

  ```bash
  docker compose -f docker-compose.dev.yml exec -T api sh -c 'cd /workspace/apps/api && npx tsc --noEmit'
  docker compose -f docker-compose.dev.yml restart api
  sleep 8
  docker compose -f docker-compose.dev.yml logs --tail 20 api | grep -i "mapped\|started"
  ```
  确认 `/render POST`、`/render/:jobId GET` 路由已注册。

  ```bash
  git add apps/api/src/render apps/api/src/app.module.ts
  git commit -m "feat(api): POST/GET /api/render 端点 — 异步任务入队 + 状态查询"
  ```

---

### Task 3: 前端 /print-headless/:id 视图

**Files:**
- `apps/web/src/views/PrintHeadlessView.vue` (new)
- `apps/web/src/router/index.ts`

- [ ] **Step 1: PrintHeadlessView.vue**

  这个视图供 puppeteer 加载。它从 query 拿 `templateData`（base64 JSON 或通过 window.__renderInput 注入），用 TemplateRenderer 渲染。

  实现策略：worker 用 `page.evaluate` 注入 template + data 到 `window.__renderInput`，再监听准备好后渲染。

  ```vue
  <script setup lang="ts">
  // eslint-disable-next-line import/no-unresolved
  import { TemplateRenderer } from '@template-printing/template-renderer';
  import { ref, onMounted } from 'vue';
  // eslint-disable-next-line import/no-unresolved
  import type { Template } from '@template-printing/schema';

  interface RenderInput {
    template: Template;
    data: Record<string, unknown>;
  }
  declare global {
    interface Window {
      __renderInput?: RenderInput;
      __renderReady?: boolean;
    }
  }

  const template = ref<Template | null>(null);
  const data = ref<Record<string, unknown>>({});
  const ready = ref(false);

  // Wait for the worker (puppeteer) to inject window.__renderInput via page.evaluate.
  // The worker calls evaluate AFTER goto, so we poll briefly.
  onMounted(() => {
    const poll = (): void => {
      if (window.__renderInput) {
        template.value = window.__renderInput.template;
        data.value = window.__renderInput.data;
        // Allow Vue to render, then signal puppeteer to take screenshot/PDF.
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            ready.value = true;
            window.__renderReady = true;
          });
        });
      } else {
        setTimeout(poll, 50);
      }
    };
    poll();
  });
  </script>

  <template>
    <div class="ph-host" :class="{ 'ph-host--ready': ready }">
      <TemplateRenderer v-if="template" :template="template" :data="data" />
    </div>
  </template>

  <style scoped>
  .ph-host {
    background: #fff;
    width: 100vw;
    height: 100vh;
    overflow: hidden;
  }
  /* Hide all UI chrome that might leak from global styles */
  </style>

  <style>
  /* Global overrides for headless mode — ensure no scrollbars, no body padding */
  html, body {
    margin: 0 !important;
    padding: 0 !important;
    background: #fff !important;
    overflow: hidden !important;
  }
  </style>
  ```

- [ ] **Step 2: 加路由**

  `apps/web/src/router/index.ts` 加 route：

  ```ts
  {
    path: '/print-headless/:id',
    name: 'print-headless',
    meta: { requiresAuth: false, fullscreen: true },
    component: () => import('../views/PrintHeadlessView.vue'),
  },
  ```

  注意 `requiresAuth: false` —— 让 puppeteer 不需要 auth。后续 iter 可加 internal token 校验。

- [ ] **Step 3:** type-check + commit
  ```bash
  docker compose -f docker-compose.dev.yml exec -T web sh -c 'cd /workspace/apps/web && NODE_OPTIONS=--max-old-space-size=4096 ./node_modules/.bin/vue-tsc --noEmit'
  git add apps/web/src/views/PrintHeadlessView.vue apps/web/src/router/index.ts
  git commit -m "feat(web): /print-headless/:id 路由 — 供 puppeteer 加载、注入 template+data 渲染纯净 paper"
  ```

---

### Task 4: Worker — 实际渲染逻辑（postgres + puppeteer）

**Files:**
- `apps/render/package.json` (deps)
- `apps/render/src/db.ts` (new)
- `apps/render/src/renderer.ts` (new)
- `apps/render/src/main.ts`

- [ ] **Step 1: 加 deps**

  ```bash
  docker compose -f docker-compose.dev.yml exec -T render sh -c 'cd /workspace/apps/render && pnpm add @prisma/client pg'
  ```

  或如果 worker 选择直接用 pg 不通过 prisma client：
  ```bash
  docker compose -f docker-compose.dev.yml exec -T render sh -c 'cd /workspace/apps/render && pnpm add pg'
  ```

  我推荐 prisma client（已有 schema 定义复用，type-safe），但需要 worker 也跑 prisma generate。

  简化方案：worker 用裸 `pg` 客户端 + 直接 SQL。SQL 简单（select template by id, update job status）。

- [ ] **Step 2: db.ts**

  ```ts
  import pg from 'pg';

  const url = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@postgres:5432/template_printing';
  export const pool = new pg.Pool({ connectionString: url });

  export interface JobRow {
    id: string;
    template_id: string;
    data: Record<string, unknown>;
    formats: string[];
    status: string;
    callback_url: string | null;
  }
  export interface TemplateRow {
    id: string;
    name: string;
    data: unknown;
  }

  export async function fetchJob(id: string): Promise<JobRow | null> {
    const r = await pool.query<JobRow>(
      'SELECT id, template_id, data, formats, status, callback_url FROM render_jobs WHERE id = $1',
      [id],
    );
    return r.rows[0] ?? null;
  }

  export async function fetchTemplate(id: string): Promise<TemplateRow | null> {
    const r = await pool.query<TemplateRow>(
      'SELECT id, name, data FROM templates WHERE id = $1',
      [id],
    );
    return r.rows[0] ?? null;
  }

  export async function markProcessing(id: string): Promise<void> {
    await pool.query('UPDATE render_jobs SET status = $1, started_at = NOW() WHERE id = $2', [
      'processing',
      id,
    ]);
  }

  export async function markDone(
    id: string,
    pdfUrl: string | null,
    pngUrl: string | null,
  ): Promise<void> {
    await pool.query(
      'UPDATE render_jobs SET status = $1, pdf_url = $2, png_url = $3, completed_at = NOW() WHERE id = $4',
      ['done', pdfUrl, pngUrl, id],
    );
  }

  export async function markFailed(id: string, errorMsg: string): Promise<void> {
    await pool.query(
      'UPDATE render_jobs SET status = $1, error_msg = $2, completed_at = NOW() WHERE id = $3',
      ['failed', errorMsg, id],
    );
  }

  export async function markCallbackStatus(id: string, status: 'sent' | 'failed'): Promise<void> {
    await pool.query('UPDATE render_jobs SET callback_status = $1 WHERE id = $2', [status, id]);
  }
  ```

- [ ] **Step 3: renderer.ts**

  ```ts
  import fs from 'fs/promises';
  import path from 'path';

  import type { Page } from 'puppeteer';

  const WEB_BASE = process.env.WEB_BASE ?? 'http://web';
  const STORAGE_ROOT = process.env.STORAGE_ROOT ?? '/storage';

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
    // 1. Navigate to /print-headless route
    await page.goto(`${WEB_BASE}/print-headless/${args.jobId}`, { waitUntil: 'networkidle0' });

    // 2. Inject template + data into the page
    await page.evaluate(
      (template, data) => {
        (window as unknown as { __renderInput: object }).__renderInput = { template, data };
      },
      args.template,
      args.data,
    );

    // 3. Wait for the page to signal ready (Vue rendered)
    await page.waitForFunction(() => (window as unknown as { __renderReady?: boolean }).__renderReady === true, {
      timeout: 30_000,
    });

    // 4. Generate outputs
    const outDir = path.join(STORAGE_ROOT, 'uploads', 'render');
    await fs.mkdir(outDir, { recursive: true });

    let pdfPath: string | null = null;
    let pngPath: string | null = null;

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
      const widthPx = Math.round(args.paperMm.w * 4); // 4 px/mm canonical
      const heightPx = Math.round(args.paperMm.h * 4);
      await page.setViewport({ width: widthPx, height: heightPx, deviceScaleFactor: 2 });
      await page.screenshot({
        path: pngPath,
        type: 'png',
        clip: { x: 0, y: 0, width: widthPx, height: heightPx },
      });
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
    let w = 210, h = 297;
    if (typeof t.canvas.paper === 'string' && presets[t.canvas.paper]) {
      w = presets[t.canvas.paper].w;
      h = presets[t.canvas.paper].h;
    } else if (typeof t.canvas.paper === 'object' && 'w_mm' in t.canvas.paper) {
      w = t.canvas.paper.w_mm;
      h = t.canvas.paper.h_mm;
    }
    return t.canvas.orientation === 'landscape' ? { w: h, h: w } : { w, h };
  }
  ```

- [ ] **Step 4: 重写 main.ts worker handler**

  ```ts
  import { Worker } from 'bullmq';
  import IORedis from 'ioredis';

  import { PuppeteerPool } from './puppeteer-pool.js';
  import { fetchJob, fetchTemplate, markDone, markFailed, markProcessing } from './db.js';
  import { renderJobOnPage, resolvePaperMm } from './renderer.js';
  import { sendCallback } from './webhook.js';

  const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';
  const BROWSERS = Number(process.env.RENDER_BROWSERS ?? 4);
  const PAGES_PER_BROWSER = Number(process.env.RENDER_PAGES_PER_BROWSER ?? 2);

  async function main(): Promise<void> {
    const connection = new IORedis(REDIS_URL, { maxRetriesPerRequest: null });
    const pool = new PuppeteerPool({ browsers: BROWSERS, pagesPerBrowser: PAGES_PER_BROWSER });
    await pool.warmup();
    console.log(`[render] pool ready (capacity=${pool.capacity})`);

    const worker = new Worker(
      'render',
      async (bullJob) => {
        const jobId = (bullJob.data as { jobId: string }).jobId;
        console.log(`[render] start job ${jobId}`);

        const job = await fetchJob(jobId);
        if (!job) {
          console.warn(`[render] job ${jobId} not found in db`);
          return;
        }
        const tpl = await fetchTemplate(job.template_id);
        if (!tpl) {
          await markFailed(jobId, 'template_not_found');
          await sendCallback(jobId, job.callback_url);
          return;
        }

        await markProcessing(jobId);
        const page = await pool.acquire();
        try {
          const paperMm = resolvePaperMm(tpl.data);
          const result = await renderJobOnPage(page, {
            jobId,
            template: tpl.data as object,
            data: job.data,
            formats: job.formats,
            paperMm,
          });
          await markDone(jobId, result.pdfUrl, result.pngUrl);
          console.log(`[render] done ${jobId}`);
        } catch (e) {
          const msg = (e as Error).message ?? 'unknown_error';
          console.error(`[render] failed ${jobId}: ${msg}`);
          await markFailed(jobId, msg);
        } finally {
          pool.release(page);
        }

        // Webhook (success or failure both reported)
        await sendCallback(jobId, job.callback_url);
      },
      { connection, concurrency: BROWSERS * PAGES_PER_BROWSER },
    );

    const shutdown = async (): Promise<void> => {
      console.log('[render] shutting down…');
      await worker.close();
      await pool.shutdown();
      await connection.quit();
      process.exit(0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  }

  main().catch((err) => {
    console.error('[render] fatal:', err);
    process.exit(1);
  });
  ```

- [ ] **Step 5: type-check + restart render + commit**

  ```bash
  docker compose -f docker-compose.dev.yml exec -T render sh -c 'cd /workspace/apps/render && npx tsc --noEmit'
  docker compose -f docker-compose.dev.yml restart render
  sleep 5
  docker compose -f docker-compose.dev.yml logs --tail 10 render | tail -10
  ```

  ```bash
  git add apps/render/
  git commit -m "feat(render): worker 实际渲染 — postgres 拉 template + puppeteer 生成 PDF/PNG + 落地 storage"
  ```

---

### Task 5: Worker — webhook callback

**File:** `apps/render/src/webhook.ts` (new)

- [ ] **Step 1: webhook.ts**

  ```ts
  import { fetch } from 'undici';

  import { fetchJob, markCallbackStatus } from './db.js';

  export async function sendCallback(jobId: string, callbackUrl: string | null): Promise<void> {
    if (!callbackUrl) return;

    // Fetch the final job state to get URLs + status
    const job = await fetchJob(jobId);
    if (!job) return;

    const payload = {
      jobId,
      status: job.status,
      pdfUrl: (job as { pdf_url?: string }).pdf_url ?? null,
      pngUrl: (job as { png_url?: string }).png_url ?? null,
      errorMsg: (job as { error_msg?: string }).error_msg ?? null,
    };

    try {
      const res = await fetch(callbackUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        // Don't block too long on slow webhook receivers
        signal: AbortSignal.timeout(10_000),
      });
      if (res.ok) {
        await markCallbackStatus(jobId, 'sent');
      } else {
        console.warn(`[render] callback ${callbackUrl} returned ${res.status}`);
        await markCallbackStatus(jobId, 'failed');
      }
    } catch (e) {
      console.warn(`[render] callback ${callbackUrl} threw: ${(e as Error).message}`);
      await markCallbackStatus(jobId, 'failed');
    }
  }
  ```

  注意：`fetchJob` 返回的 row 类型里有 pdf_url 等 SQL snake_case 列。`db.ts` 的 JobRow 接口需要补这些。回去 db.ts 把 fetchJob 的查询 SELECT 字段补上：

  ```ts
  'SELECT id, template_id, data, formats, status, pdf_url, png_url, error_msg, callback_url FROM render_jobs WHERE id = $1'
  ```

  以及 JobRow 接口补字段。

- [ ] **Step 2: undici 已在 puppeteer 依赖里间接可用？或额外加：**

  ```bash
  docker compose -f docker-compose.dev.yml exec -T render sh -c 'cd /workspace/apps/render && pnpm add undici'
  ```

- [ ] **Step 3: type-check + restart render + commit**

  ```bash
  docker compose -f docker-compose.dev.yml exec -T render sh -c 'cd /workspace/apps/render && npx tsc --noEmit'
  docker compose -f docker-compose.dev.yml restart render
  git add apps/render/
  git commit -m "feat(render): webhook 回调 — 完成 / 失败均 POST 调用方提供的 callbackUrl，含 jobId/status/urls/errorMsg"
  ```

---

### Task 6: API docs 页内容

**File:** `apps/web/src/views/ApiDocsView.vue`

- [ ] **Step 1: 完整重写**

  ```vue
  <script setup lang="ts">
  import { ref } from 'vue';

  const tab = ref<'curl' | 'js' | 'python'>('curl');
  </script>

  <template>
    <div class="page-wrap">
      <h1 class="page-title">API 说明</h1>

      <section class="api-section">
        <h2>异步渲染 API</h2>
        <p class="api-intro">
          调用方传入 templateId + data（变量值），平台进入异步队列渲染，完成后通过 callback URL 通知调用方。
        </p>

        <h3>端点</h3>
        <div class="api-endpoint">
          <code>POST /api/render</code>
          <span class="api-auth-note">需要登录（cookie 或 CSRF）</span>
        </div>

        <h3>请求体</h3>
        <pre class="api-code">{
    "templateId": "tpl_xxx",
    "data": {
      "name": "张三",
      "amount": 1200,
      "logo_url": "https://..."
    },
    "formats": ["pdf", "png"],
    "callbackUrl": "https://your-server.com/print-callback"
  }</pre>

        <h3>同步返回</h3>
        <pre class="api-code">{
    "jobId": "abc-123-...",
    "status": "pending"
  }</pre>

        <h3>查询任务状态</h3>
        <div class="api-endpoint">
          <code>GET /api/render/:jobId</code>
        </div>
        <pre class="api-code">{
    "jobId": "abc-123-...",
    "status": "done",
    "pdfUrl": "/uploads/render/abc-123.pdf",
    "pngUrl": "/uploads/render/abc-123.png",
    "errorMsg": null,
    "completedAt": "2026-05-23T10:30:00Z"
  }</pre>

        <h3>Webhook 回调 payload</h3>
        <p>渲染完成后，平台会 POST 以下结构到你的 callbackUrl：</p>
        <pre class="api-code">{
    "jobId": "abc-123-...",
    "status": "done",
    "pdfUrl": "/uploads/render/abc-123.pdf",
    "pngUrl": "/uploads/render/abc-123.png",
    "errorMsg": null
  }</pre>
        <p class="api-note">失败时 status = "failed"，errorMsg 含错误描述。</p>

        <h3>调用示例</h3>
        <div class="api-tabs">
          <button :class="{ on: tab === 'curl' }" @click="tab = 'curl'">curl</button>
          <button :class="{ on: tab === 'js' }" @click="tab = 'js'">JavaScript</button>
          <button :class="{ on: tab === 'python' }" @click="tab = 'python'">Python</button>
        </div>

        <pre v-if="tab === 'curl'" class="api-code">curl -X POST https://your-host/api/render \
    -H "Content-Type: application/json" \
    -H "Cookie: tp_access=&lt;your_access_token&gt;" \
    -H "X-CSRF-Token: &lt;your_csrf_token&gt;" \
    -d '{
      "templateId": "tpl_xxx",
      "data": { "name": "张三" },
      "callbackUrl": "https://your-server.com/print-callback"
    }'</pre>

        <pre v-else-if="tab === 'js'" class="api-code">const res = await fetch('https://your-host/api/render', {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      'X-CSRF-Token': csrfToken,
    },
    body: JSON.stringify({
      templateId: 'tpl_xxx',
      data: { name: '张三' },
      callbackUrl: 'https://your-server.com/print-callback',
    }),
  });
  const { jobId } = await res.json();
  console.log('Render queued:', jobId);</pre>

        <pre v-else class="api-code">import requests

  resp = requests.post(
      'https://your-host/api/render',
      json={
          'templateId': 'tpl_xxx',
          'data': { 'name': '张三' },
          'callbackUrl': 'https://your-server.com/print-callback',
      },
      cookies={ 'tp_access': '&lt;your_access_token&gt;' },
      headers={ 'X-CSRF-Token': '&lt;your_csrf_token&gt;' },
  )
  job_id = resp.json()['jobId']
  print('Render queued:', job_id)</pre>
      </section>
    </div>
  </template>

  <style scoped>
  .page-wrap { padding: 32px 40px; max-width: 1000px; margin: 0 auto; }
  .page-title { font-size: 24px; font-weight: 600; margin: 0 0 24px; color: var(--tp-ink, #1f1f23); }
  .api-section { background: #fff; border: 1px solid var(--tp-line, #ececef); border-radius: 12px; padding: 28px; }
  .api-section h2 { font-size: 18px; font-weight: 600; margin: 0 0 12px; }
  .api-section h3 { font-size: 14px; font-weight: 600; margin: 24px 0 8px; color: var(--tp-accent-ink, #4f3fcc); }
  .api-intro { color: var(--tp-ink-soft, #5e5e66); font-size: 13px; margin-bottom: 16px; line-height: 1.7; }
  .api-endpoint { display: flex; align-items: center; gap: 12px; margin: 8px 0; }
  .api-endpoint code { background: var(--tp-accent-bg, #f0eeff); color: var(--tp-accent-ink, #4f3fcc); padding: 4px 12px; border-radius: 6px; font-family: ui-monospace, monospace; font-size: 13px; }
  .api-auth-note { font-size: 11px; color: var(--tp-ink-faint, #9c9ca3); }
  .api-code { background: #1f1f23; color: #e0e0e6; padding: 14px 18px; border-radius: 8px; font-family: ui-monospace, monospace; font-size: 12px; line-height: 1.7; overflow-x: auto; }
  .api-tabs { display: flex; gap: 6px; margin: 8px 0; }
  .api-tabs button { background: transparent; border: 1px solid var(--tp-line, #ececef); padding: 5px 14px; border-radius: 6px; font-size: 12px; cursor: pointer; color: var(--tp-ink-soft, #5e5e66); }
  .api-tabs button.on { background: var(--tp-accent, #6c5ce7); color: #fff; border-color: var(--tp-accent, #6c5ce7); }
  .api-note { font-size: 11px; color: var(--tp-ink-faint, #9c9ca3); margin-top: 8px; }
  </style>
  ```

- [ ] **Step 2: commit**

  ```bash
  docker compose -f docker-compose.dev.yml exec -T web sh -c 'cd /workspace/apps/web && NODE_OPTIONS=--max-old-space-size=4096 ./node_modules/.bin/vue-tsc --noEmit'
  git add apps/web/src/views/ApiDocsView.vue
  git commit -m "feat(views): API 说明页 — 异步渲染调用文档（curl/js/python 示例 + webhook 说明）"
  ```

---

### Task 7: 最终验收

- [ ] **Step 1:** vue-tsc + api tsc + render tsc 全 0
- [ ] **Step 2:** schema tests 46/46 通过
- [ ] **Step 3:** 端到端测试（手动）：

  **准备**：登录平台、记下 csrf token (DevTools Application → Cookies → tp_csrf)、记下一个 templateId
  
  ```bash
  # 1. POST 入队
  curl -X POST http://localhost:5173/api/render \
    -H "Content-Type: application/json" \
    -H "Cookie: tp_access=YOUR_TOKEN" \
    -H "X-CSRF-Token: YOUR_CSRF" \
    -d '{"templateId":"YOUR_TPL_ID","data":{}}'
  # → {"jobId":"...", "status":"pending"}
  ```
  
  ```bash
  # 2. 等几秒后查状态
  curl http://localhost:5173/api/render/JOB_ID \
    -H "Cookie: tp_access=YOUR_TOKEN"
  # → {"status":"done", "pdfUrl":"/uploads/render/JOB_ID.pdf", ...}
  ```
  
  ```bash
  # 3. 拉 PDF
  curl http://localhost:5173/uploads/render/JOB_ID.pdf -o /tmp/test.pdf
  # 打开 /tmp/test.pdf 应能看到完整 paper 内容
  ```

- [ ] **Step 4:** webhook 测试 — 准备一个 webhook receiver（webhook.site / requestbin）拿到 URL，POST 时带 callbackUrl → 等 worker 完成后应看到回调到达

- [ ] **Step 5:** 浏览器走查 `/api-docs` → 看到完整文档 + 切 curl/js/python 标签

---

## 不在范围（后续 iter）

- 飞书机器人集成示例代码
- 渲染任务 retry / 失败重试策略
- 渲染输出 signed URL（防止 URL 猜测）
- 用户「我的渲染任务」历史列表
- 渲染计费 / quota 限制
- 多语言 webhook payload
