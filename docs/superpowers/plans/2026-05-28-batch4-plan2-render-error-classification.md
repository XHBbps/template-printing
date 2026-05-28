# 批次4 Plan 2:渲染可靠性收尾(P1a jitter + P2a 永久错误细分) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development 逐 task 实现。步骤用 `- [ ]` 跟踪。

**Goal:** 补齐 Plan 1 暂缓项:P1a backoff jitter(防惊群)+ P2a 永久错误细分(模板结构非法 / 条码二维码非法 / 图片 404 → 立即 `UnrecoverableError`,不白重试 3 次,fail-fast 不出残缺标签)。

**Architecture:** 三组、按风险递增、可分别回滚:
- **A·P1a**:bullmq 自定义 `backoffStrategy`(worker `settings`)+ api `backoff:{type:'custom'}`,指数 + ±50% jitter。低风险。
- **B·P2a-worker**:给 `@template-printing/schema` 加 build,**仅新增 `./template` 子路径导出指向 dist**(`.`/main 仍 src → web/designer/api 零改动),worker 导航前 `TemplateSchema.safeParse(tpl.data)`。打包风险(需生产 runtime-verify)。
- **C·P2a-web**:修 `PrintHeadlessView` 50ms 心跳为**渲染-settle 注册表**(等所有异步元件结算)+ Barcode/Qr/Image 元件错误上报(designMode 门控)+ worker 读 `__renderError` → `UnrecoverableError`。设计器回归风险(需手测)。

**Tech Stack:** bullmq 5.10.4、apps/render(TS+vitest+node dist)、packages/schema(zod, tsc build)、packages/template-renderer(Vue 元件)、apps/web(Vite)、Docker。

**Spec:** `docs/superpowers/specs/2026-05-28-render-reliability-hardening-design.md`(P1a / P2a-worker / P2a-web)。

**已核实关键事实:**
- bullmq 自定义 backoff:`job.js:416` `Backoffs.calculate(..., queue.opts.settings && queue.opts.settings.backoffStrategy)`;`backoffs.js:lookupStrategy` 在 `backoff.type` 非 builtin(fixed/exponential)时用 `customStrategy`。策略签名 `(attemptsMade, type, err, job) => number(ms)`,**不接收 backoff.delay**。配置在 **Worker**(retry 在 worker 进程算),api 仅设 `backoff:{type:'custom'}`。
- `packages/schema/src/template.ts` **只 import zod**(无 `@template-printing/types`)→ 建 `dist/template.js` 仅依赖 zod,无 types 级联。`index.ts` 才 import types 的 `USER_ROLES`(故**不走 index**,走 `./template` 子路径)。
- schema tsconfig 已 `outDir:./dist`;`tsconfig.base` `declaration:true`、`module:ESNext`、`moduleResolution:Bundler`、无 `noEmit`。
- render 生产镜像 `docker/render.Dockerfile`:build 阶段 copy `apps/render/package.json` + `packages/types/package.json`(**未 copy schema**),`pnpm --filter @template-printing/render build && pnpm --filter @template-printing/render deploy --prod /prod/render`,runtime `node dist/main.js`。
- web 经 node_modules 解析 `@template-printing/schema`(vite/tsconfig **无** schema alias)→ 保持 `.`=src 即 web 零改动。26 个 web/template-renderer 文件 import schema,均走 `.`。
- `ImageElement.vue` 已有 `loadFailed` + `onLoadError`/`onLoadSuccess`(img 的 `@error`/`@load`);`BarcodeElement.vue:73-76` / `QrElement.vue:50-54` catch 仅 console.error(吞错);两元件均已有 `designMode` prop。
- worker `main.ts` `markFailed`/`markDone` 已返回 rowCount(Plan 1);`renderer.ts` waitForFunction 现为 `__renderReady===true`。

---

## 全局约定
- 测试:render `docker exec template_printing-render sh -c "cd /workspace/apps/render && pnpm test -- <file>"`;api 同容器 jest;web `docker exec template_printing-web sh -c "cd /workspace/apps/web && pnpm run typecheck && pnpm run lint"`;schema `docker exec template_printing-web sh -c "cd /workspace/packages/schema && pnpm run build"`(或 render 容器,任一有 pnpm)。
- ESM `.js` 后缀;render vitest 即时转译;**worker 引入 schema/template 后,render typecheck/test 前须先 `pnpm --filter @template-printing/schema build`**(dist 存在才解析 `./template`)。
- Git 不 `--no-verify`;每 task 只 add 本 task 文件。**部署耦合**:P1a 后 api+render 必须同版本部署(旧 worker 不认 `type:'custom'`)。

---

## 组 A — P1a:backoff jitter

### Task 1:自定义 backoffStrategy(worker)+ api type:'custom'

**Files:** Create `apps/render/src/backoff.ts`;Modify `apps/render/src/main.ts`、`apps/api/src/render/render.service.ts`;Test `apps/render/test/backoff.spec.ts`(新)。

- [ ] **Step 1: 写失败测试** 新建 `apps/render/test/backoff.spec.ts`(vitest,照搬 `pool.spec.ts` 头):
```ts
import { describe, it, expect } from 'vitest';
import { jitterBackoff } from '../src/backoff.js';

describe('jitterBackoff', () => {
  it('指数基线 ±50% jitter,落在 [0.5,1.5]×base×2^(n-1)', () => {
    for (const n of [1, 2, 3]) {
      const base = 2000 * Math.pow(2, n - 1); // 2000/4000/8000
      for (let i = 0; i < 200; i++) {
        const d = jitterBackoff(n);
        expect(d).toBeGreaterThanOrEqual(Math.floor(base * 0.5));
        expect(d).toBeLessThanOrEqual(Math.ceil(base * 1.5));
      }
    }
  });
  it('返回整数', () => {
    expect(Number.isInteger(jitterBackoff(1))).toBe(true);
  });
});
```

- [ ] **Step 2: 跑红** `docker exec template_printing-render sh -c "cd /workspace/apps/render && pnpm test -- test/backoff.spec.ts"` → FAIL(模块不存在)。

- [ ] **Step 3: 实现** 新建 `apps/render/src/backoff.ts`:
```ts
const BASE_MS = Number(process.env.RENDER_BACKOFF_BASE_MS ?? 2000);

/**
 * 批次4 P1a:指数退避 + ±50% jitter,防并发同步齐步重试惊群。
 * attemptsMade 1-indexed(bullmq 传第 N 次重试)。base*2^(n-1) 再乘 [0.5,1.5)。
 */
export function jitterBackoff(attemptsMade: number): number {
  const exp = BASE_MS * Math.pow(2, attemptsMade - 1);
  return Math.round(exp * (0.5 + Math.random()));
}
```
`apps/render/src/main.ts`:import `{ jitterBackoff } from './backoff.js'`;Worker 选项加 `settings`:
```ts
    {
      connection,
      concurrency: BROWSERS * PAGES_PER_BROWSER,
      lockDuration: LOCK_DURATION_MS,
      stalledInterval: 30_000,
      maxStalledCount: 1,
      settings: { backoffStrategy: (attemptsMade: number) => jitterBackoff(attemptsMade) },
    },
```
`apps/api/src/render/render.service.ts` 入队:`backoff: { type: 'custom' },`(替换 `{ type: 'exponential', delay: 2000 }`;`attempts:3` 不变)。

- [ ] **Step 4: 测试通过 + 两端 typecheck/lint** render + api 各 `pnpm run typecheck && pnpm run lint`;render `pnpm test -- test/backoff.spec.ts` 绿。

- [ ] **Step 5: 提交**
```bash
git add apps/render/src/backoff.ts apps/render/src/main.ts apps/render/test/backoff.spec.ts apps/api/src/render/render.service.ts
git commit -m "feat(render): 自定义 backoffStrategy 指数+±50% jitter,api 改 type:custom(P1a 防惊群)"
```

---

## 组 B — P2a-worker:schema build + worker zod 预校验

### Task 2:给 @template-printing/schema 加 build + ./template 子路径导出

**Files:** Create `packages/schema/tsconfig.build.json`;Modify `packages/schema/package.json`。

- [ ] **Step 1: build tsconfig** 新建 `packages/schema/tsconfig.build.json`(只编 src、出 dist + 声明):
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "noEmit": false,
    "declaration": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "test"]
}
```

- [ ] **Step 2: package.json build + exports** `packages/schema/package.json`:加 `"build": "tsc -p tsconfig.build.json"` 到 scripts;**保持 `main`/`types` = `./src/index.ts` 不变**;新增 `exports`:
```json
  "exports": {
    ".": "./src/index.ts",
    "./template": { "types": "./dist/template.d.ts", "default": "./dist/template.js" }
  },
```
> `.` 仍指 src → web/designer/api(经 node_modules 或 Vite)零改动;`./template` 指 dist(zod-only)→ 供 worker node dist 运行时用。

- [ ] **Step 3: 构建并验证** `docker exec template_printing-web sh -c "cd /workspace/packages/schema && pnpm run build"`;确认产出 `dist/template.js` + `dist/template.d.ts` + `dist/index.js`;`grep -n "template-printing/types" dist/template.js` → **无命中**(确认 template.js 不引 types,仅 zod)。

- [ ] **Step 4: 确认 web 未回归** `docker exec template_printing-web sh -c "cd /workspace/apps/web && pnpm run typecheck && pnpm run lint"` 全绿(`.` 仍 src,行为不变)。

- [ ] **Step 5: 提交**
```bash
git add packages/schema/tsconfig.build.json packages/schema/package.json
git commit -m "build(schema): 加 tsc build + ./template 子路径导出(dist,供 worker 运行时;. 仍 src 不动 web)"
```

### Task 3:worker 导航前 zod 预校验

**Files:** Modify `apps/render/package.json`、`apps/render/src/main.ts`;Test `apps/render/test/schema-precheck.spec.ts`(新)。依赖 T2(dist 已建)。

- [ ] **Step 1: 加依赖** `apps/render/package.json` dependencies 加 `"@template-printing/schema": "workspace:*"`;`docker exec template_printing-render sh -c "cd /workspace && pnpm install --frozen-lockfile=false --filter @template-printing/render"`(或在 render 容器 `pnpm install`)使 workspace 链接生效。**先确保 T2 的 `pnpm --filter @template-printing/schema build` 已跑**(`./template` 解析到 dist)。

- [ ] **Step 2: 写失败测试** 新建 `apps/render/test/schema-precheck.spec.ts`:导出可测的纯校验函数(见 Step 3 把校验抽成 `isValidTemplate`)。断言:合法最小模板(`{canvas:{paper:'A4',orientation:'portrait'},elements:[]}` 等 schema-valid 结构)→ true;畸形(`{}` / `{canvas:{}}` / `elements` 非数组)→ false。
```ts
import { describe, it, expect } from 'vitest';
import { isValidTemplate } from '../src/schema-precheck.js';
describe('isValidTemplate', () => {
  it('合法模板通过', () => { expect(isValidTemplate(/* 最小合法 template.data */).ok).toBe(true); });
  it('畸形结构拒绝', () => {
    expect(isValidTemplate({}).ok).toBe(false);
    expect(isValidTemplate({ canvas: {}, elements: 'x' }).ok).toBe(false);
  });
});
```
> 实现者先 Read `packages/schema/src/template.ts` 的 `TemplateSchema` 确认最小合法 data 形状,写进测试。

- [ ] **Step 3: 跑红 + 实现** 红:`pnpm test -- test/schema-precheck.spec.ts`(模块缺)。新建 `apps/render/src/schema-precheck.ts`:
```ts
// eslint-disable-next-line import/no-unresolved
import { TemplateSchema } from '@template-printing/schema/template';

export function isValidTemplate(data: unknown): { ok: true } | { ok: false; reason: string } {
  const r = TemplateSchema.safeParse(data);
  if (r.success) return { ok: true };
  const first = r.error.issues[0];
  return { ok: false, reason: first ? `${first.path.join('.')}: ${first.message}` : 'schema_invalid' };
}
```
`apps/render/src/main.ts`:import `{ isValidTemplate } from './schema-precheck.js'`;在 `if (!tpl) {...}` 之后、`markProcessing` 之前:
```ts
      const check = isValidTemplate(tpl.data);
      if (!check.ok) {
        // eslint-disable-next-line no-console
        console.warn(`[render] job ${jobId} template schema_invalid: ${check.reason}`);
        const changed = await markFailed(jobId, 'schema_invalid', attemptNo);
        if (changed > 0) await sendCallback(jobId, job.callback_url);
        throw new UnrecoverableError('schema_invalid');
      }
```

- [ ] **Step 4: 测试通过 + typecheck/lint**(先 schema build)`docker exec template_printing-render sh -c "cd /workspace/apps/render && pnpm test -- test/schema-precheck.spec.ts && pnpm run typecheck && pnpm run lint"`。

- [ ] **Step 5: 提交**
```bash
git add apps/render/package.json apps/render/src/schema-precheck.ts apps/render/src/main.ts apps/render/test/schema-precheck.spec.ts pnpm-lock.yaml
git commit -m "feat(render): 导航前 TemplateSchema.safeParse 预校验,畸形模板立即 UnrecoverableError(P2a-worker)"
```

### Task 4:render 生产镜像构建 schema + 生产 runtime-verify(关键防 build≠runs)

**Files:** Modify `docker/render.Dockerfile`。

- [ ] **Step 1: Dockerfile build 阶段加 schema** 在 build 阶段:`COPY packages/schema/package.json ./packages/schema/`(与 types 那行并列);构建命令改为**先建 schema 再建 render 再 deploy**:
```dockerfile
RUN pnpm --filter @template-printing/schema build \
    && pnpm --filter @template-printing/render build \
    && pnpm --filter @template-printing/render deploy --prod /prod/render
```
> `pnpm deploy --prod` 会把 schema 包(含已建 dist)copy 进 `/prod/render/node_modules/@template-printing/schema`;worker `import ... '@template-printing/schema/template'` → `exports["./template"]` → dist/template.js,node 可执行。

- [ ] **Step 2: 构建 prod 镜像** `docker build -f docker/render.Dockerfile -t tp-render:plan2-verify .`(注意 build context = 仓库根)。确认构建成功。

- [ ] **Step 3: 生产 runtime-verify(必须)** 起一次该镜像确认 worker 不崩(防 `ERR_UNKNOWN_FILE_EXTENSION`):
```bash
docker run --rm --network template_printing_default \
  -e REDIS_URL=redis://redis:6379 -e DATABASE_URL=<dev DB url> -e PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser \
  tp-render:plan2-verify node -e "import('@template-printing/schema/template').then(m=>{console.log('schema/template OK', typeof m.TemplateSchema?.safeParse)}).catch(e=>{console.error('FAIL',e.message);process.exit(1)})"
```
期望打印 `schema/template OK function`(证实 dist 子路径在 node runtime 可解析、可执行)。**若 ERR_UNKNOWN_FILE_EXTENSION / Cannot find module → BLOCKED 报我**。(实现者按容器网络/DB 实际值填;核心是让 node 在 prod 镜像里真的 import 到 schema/template。)

- [ ] **Step 4: 提交**
```bash
git add docker/render.Dockerfile
git commit -m "build(render): 生产镜像构建 schema 包(供 worker ./template 运行时),实证 node dist 可解析(P2a-worker)"
```

---

## 组 C — P2a-web:渲染-settle barrier + 元件错误上报 + worker 读信号

> ⚠️ 改 `template-renderer` 共享元件(设计器 + 打印共用),所有上报**必须 designMode 门控**;Task 8 设计器手测硬门。

### Task 5:PrintHeadlessView 渲染-settle 注册表 + 错误 sink

**Files:** Modify `apps/web/src/views/PrintHeadlessView.vue`;Create `packages/template-renderer/src/render-context.ts`(共享 InjectionKey)。

- [ ] **Step 1: 共享 InjectionKey** 新建 `packages/template-renderer/src/render-context.ts`:
```ts
import type { InjectionKey } from 'vue';

export interface RenderSettleCtx {
  /** 异步元件挂载时 +1 */
  begin(): void;
  /** 异步元件结算(成功/失败)时 -1 */
  end(): void;
  /** 永久错误上报(非 designMode);reason 如 'barcode_invalid' / 'image_404' */
  reportError(reason: string, detail?: string): void;
}
export const renderSettleKey: InjectionKey<RenderSettleCtx | null> = Symbol('tp-render-settle');
```
从 `packages/template-renderer/src/index.ts` 导出 `renderSettleKey`、`RenderSettleCtx`。

- [ ] **Step 2: PrintHeadlessView provide + settle 逻辑** 改 `apps/web/src/views/PrintHeadlessView.vue`:
  - 声明 `window.__renderError`(类型扩展):`{ permanent: boolean; reason: string; detail?: string } | undefined`。
  - `provide(renderSettleKey, ctx)`,ctx:`begin` `pending++`、`end` `pending--`、`reportError` 设 `window.__renderError = { permanent:true, reason, detail }`。
  - `__renderReady` 不再固定 50ms:注入后 `nextTick` → 等 `pending===0`(轮询 50ms)且当前帧无未结算元件,**再**置 `__renderReady=true`;**安全兜底**:总等待超 `RENDER_SETTLE_TIMEOUT_MS`(常量 8000)无论如何置 ready(防个别元件不结算挂死)。
  - 仍保留 `onErrorCaptured` 兜同步渲染抛错 → `reportError('render_error', err.message)`。
  - 具体(替换现 onMounted poll):
```ts
const pending = ref(0);
const settleCtx = {
  begin: () => { pending.value++; },
  end: () => { pending.value = Math.max(0, pending.value - 1); },
  reportError: (reason: string, detail?: string) => {
    (window as unknown as { __renderError?: object }).__renderError = { permanent: true, reason, detail };
  },
};
provide(renderSettleKey, settleCtx);
onErrorCaptured((err) => { settleCtx.reportError('render_error', (err as Error).message); return false; });

onMounted(() => {
  const start = Date.now();
  const poll = (): void => {
    if (window.__renderInput) {
      template.value = window.__renderInput.template;
      data.value = window.__renderInput.data;
      void nextTick().then(() => {
        const waitSettle = (): void => {
          const timedOut = Date.now() - start > 8000;
          if (pending.value === 0 || timedOut) {
            ready.value = true;
            (window as Window).__renderReady = true;
            // eslint-disable-next-line no-console
            console.log(`[ph] ready (pending=${pending.value}, timedOut=${timedOut})`);
          } else {
            setTimeout(waitSettle, 50);
          }
        };
        setTimeout(waitSettle, 50); // 给同步元件一帧起步
      });
    } else {
      setTimeout(poll, 50);
    }
  };
  poll();
});
```

- [ ] **Step 3: typecheck/lint** `docker exec template_printing-web sh -c "cd /workspace/apps/web && pnpm run typecheck && pnpm run lint"`;template-renderer 也 typecheck。

- [ ] **Step 4: 提交**
```bash
git add packages/template-renderer/src/render-context.ts packages/template-renderer/src/index.ts apps/web/src/views/PrintHeadlessView.vue
git commit -m "feat(web): PrintHeadlessView 渲染-settle 注册表 + 错误 sink 取代固定 50ms 心跳(P2a-web barrier)"
```

### Task 6:Barcode / Qr / Image 元件结算 + 永久错误上报(designMode 门控)

**Files:** Modify `packages/template-renderer/src/elements/BarcodeElement.vue`、`QrElement.vue`、`ImageElement.vue`。

- [ ] **Step 1: 三元件接入 settle ctx** 各元件 setup 顶层 `const settle = inject(renderSettleKey, null);`(从 `../render-context`)。**仅非 designMode** 参与 settle/上报。
  - **Barcode**(`render()` 在 async watch/onMounted):有内容且非 designMode 时,渲染前 `settle?.begin()`;`try{ bwipjs.toCanvas(...) }`成功 `settle?.end()`;`catch(err){ settle?.reportError('barcode_invalid', String(err)); settle?.end(); console.error(...) }`。注意 `begin/end` 配平(每次 render 仅一对)。
  - **Qr**:同理,`reason:'qr_invalid'`。
  - **Image**(已有 `onLoadError`/`onLoadSuccess` + `loadFailed`):有 `src` 且非 designMode 时挂载/换 src `settle?.begin()`;`onLoadSuccess` → `settle?.end()`;`onLoadError` → `settle?.reportError('image_404', src.value ?? ''); settle?.end()`。注意 `src` 为空不 begin。
  > 配平要点:用一个局部 `pendingThis` 布尔防重复 begin/end(src 变化、watch 多次触发);实现者确保「每个真正发起的异步操作恰好一对 begin/end」。designMode 全程不调 settle(设计器零影响)。

- [ ] **Step 2: typecheck/lint** web + template-renderer typecheck/lint 绿。
  > 单测:元件级 vitest(Barcode 非法 symbology → reportError 被调;designMode 下不调)可选;template-renderer 当前无元件测试基建,若加成本高,本 task 以 typecheck + Task 8 设计器手测 + 端到端(Task 7 后非法条码 job→failed)兜底,实现者按现有测试基建决定是否加元件单测,报告说明。

- [ ] **Step 3: 提交**
```bash
git add packages/template-renderer/src/elements/BarcodeElement.vue packages/template-renderer/src/elements/QrElement.vue packages/template-renderer/src/elements/ImageElement.vue
git commit -m "feat(renderer): Barcode/Qr/Image 结算 + 永久错误上报(designMode 门控,改吞错为报)(P2a-web)"
```

### Task 7:worker 读 __renderError → UnrecoverableError

**Files:** Modify `apps/render/src/renderer.ts`、`apps/render/src/main.ts`。

- [ ] **Step 1: renderer 读信号** `apps/render/src/renderer.ts`:
  - `waitForFunction` 改为 `() => (window as any).__renderReady === true || (window as any).__renderError != null`(保留 30s timeout/polling 100)。
  - `page.pdf`/`screenshot` 前,读 `const renderError = await page.evaluate(() => (window as any).__renderError ?? null);`;若非空,**不出图**,直接 `return { ...nullPaths, permanentError: renderError.reason }`(扩 `RenderOutput` 加可选 `permanentError?: string`)。
  > 即:页面报了永久错误就不截图,把 reason 透出给 main。

- [ ] **Step 2: main 处理** `apps/render/src/main.ts` 成功路径里,`renderJobOnPage` 返回后先判 `result.permanentError`:
```ts
        const result = await withTimeout(renderPromise, JOB_TIMEOUT_MS, 'render');
        if (result.permanentError) {
          const changed = await markFailed(jobId, result.permanentError, attemptNo);
          if (changed > 0) await sendCallback(jobId, job.callback_url);
          throw new UnrecoverableError(result.permanentError);
        }
        doneChanged = await markDone(jobId, result.pdfUrl, result.pngUrl, attemptNo);
```
(置于 `markDone` 之前;`ok` 仍按是否成功控制页回收 —— 永久错误抛出走 catch 的 finally `recycle`,因 throw 前未设 ok=true;确认 `ok` 语义不被破坏:permanentError 分支 throw → finally `else recycle`,合理。)

- [ ] **Step 3: 端到端验证** 先确保 web/render 容器载新代码(`docker restart template_printing-web template_printing-render`)。造一个含**非法条码内容**的临时模板或用 data 绑定触发(实现者构造:一个 barcode 元件 symbology 合法但 text 非法,或图片 url 指向 404),经 API 入队(临时 token,完后清理)→ 轮询应 `failed` 且 `errorMsg in (barcode_invalid|image_404|render_error)`、**未出 PDF**;再用正常模板入队 → 仍 `done`(happy path 不回归)。报告贴两次结果。
  > 无独立单测(跨浏览器+worker);靠端到端 + 设计器手测(Task 8)+ typecheck。

- [ ] **Step 4: typecheck/lint + 提交**
```bash
git add apps/render/src/renderer.ts apps/render/src/main.ts
git commit -m "feat(render): 读页面 __renderError,非法条码/图片渲染期错误 → UnrecoverableError 不出残缺图(P2a-web fail-fast)"
```

### Task 8:设计器回归手测(硬门)

**Files:** 无(手测 + 记录)。

- [ ] **Step 1: 设计器走查** `docker restart template_printing-web` 后,浏览器进设计器:
  - 拖入/编辑 条码、二维码、图片 元件 —— 渲染正常、可改属性、**不因新上报逻辑报错/中断编辑**(designMode 全程不触发 settle/上报)。
  - 故意配非法条码内容、断网图片 —— 设计器应**照旧显占位/console**,不弹错、不崩。
  - 模板预览(`PublicTemplatePreviewDialog`)正常。
- [ ] **Step 2: 记录** 把走查结果(每项 PASS/异常)写入提交说明或 Task 报告;有异常则修。无代码改动则跳过提交。

---

## 组 D — 收尾

### Task 9:env + 文档 + 全量回归

**Files:** Modify `.env.example`、`.env.prod.example`、`apps/api/test/env-example-sync.spec.ts`、`docs/deployment.md`、`docs/PROGRESS.md`、review spec。

- [ ] **Step 1: env** `RENDER_BACKOFF_BASE_MS=2000`(render 退避基线)+ `RENDER_SETTLE_TIMEOUT_MS`(若做成 env;否则常量略)入 `.env.example`/`.env.prod.example` + `env-example-sync.spec.ts` 白名单(process.env-only)。
- [ ] **Step 2: docs** `docs/deployment.md` 渲染段补:P1a 自定义 backoff/jitter(+ **api/render 必须同版本部署**,旧 worker 不认 `type:'custom'`);P2a 永久错误分类(schema_invalid / barcode_invalid / qr_invalid / image_404 / render_error → 立即失败不重试、不出残缺图);schema 包新增 `./template` 构建产物(render 镜像构建依赖)。
- [ ] **Step 3: 全量回归** schema build → render(test+typecheck+lint)→ api(test+typecheck+lint)→ web(typecheck+lint)全绿;**重建并 runtime-verify render prod 镜像**(组 B Task4 的实证再跑一次确认整体)。
- [ ] **Step 4: 标记 + 提交** `docs/PROGRESS.md` 追加批次4 Plan2 条目(P1a + P2a-worker + P2a-web 完成);review spec 把 P1a / P2a-worker / P2a-web 由「⏸ Plan 2」改「✅ 已实现」。更新「最近更新」。
```bash
git add .env.example .env.prod.example apps/api/test/env-example-sync.spec.ts docs/deployment.md docs/PROGRESS.md docs/superpowers/specs/2026-05-28-render-reliability-hardening-design.md
git commit -m "docs: 批次4 Plan2 同步(P1a jitter + P2a 永久错误细分)"
```

---

## Self-Review

**Spec 覆盖:** P1a→T1 ✅;P2a-worker(schema build + worker zod)→T2/T3/T4 ✅;P2a-web(barrier + 元件上报 + worker 读 + 设计器手测)→T5/T6/T7/T8 ✅;env/docs/回归→T9 ✅。

**占位符扫描:** 关键代码(jitterBackoff、schema exports/build tsconfig、safeParse precheck、settle ctx + PrintHeadlessView poll、main permanentError 分支、renderer waitForFunction)均给完整代码。T3/T6 测试构造(最小合法 template.data、元件单测可行性)标注"实现者据 schema/现有基建定",属对真实结构的引用,非占位;T4/T7 端到端验证给了命令骨架 + 期望 + BLOCKED 条件。

**类型/顺序一致性:** schema `.`=src 不变(web 零改)、仅 `./template`→dist(worker);`jitterBackoff` 签名(attemptsMade)与 Worker settings 一致;`RenderOutput` 加 `permanentError?` 在 renderer(T7)定义、main(T7)消费一致;`renderSettleKey`/`RenderSettleCtx` 在 render-context(T5)定义,PrintHeadlessView(T5)provide、三元件(T6)inject 一致;`markFailed` rowCount 门控沿用 Plan 1。**顺序依赖**:T3 依赖 T2(dist);T4 依赖 T2/T3;T7 依赖 T5/T6(__renderError 协议);T6 依赖 T5(renderSettleKey)。subagent 顺序执行。

**风险点:** (1) **打包**:schema `./template`→dist 必须在 render 镜像构建阶段先 `pnpm --filter schema build`,且 `pnpm deploy` 带上 dist —— T4 生产 runtime-verify 是硬门(batch2「build≠runs」教训)。(2) **设计器回归**:T6 改共享元件,全部 designMode 门控 + T8 手测硬门。(3) **settle 配平**:T6 begin/end 必须成对,否则 pending 永不归零 → 靠 T5 的 8s 兜底超时防挂死。(4) **部署耦合**:P1a 后 api+render 必须同版本(旧 worker 不认 custom backoff)—— 文档已注明。
