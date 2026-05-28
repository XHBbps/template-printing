# 批次6:前端 /templates 落地页优化(F2+F6+F3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development 逐 task 实现。步骤用 `- [ ]` 跟踪。

**Goal:** 砍 /templates 落地页首屏:F2 设计器异步分包(从 TemplatesView 拆出)、F6 缩略图 IntersectionObserver 懒加载(砍 N+1 + 离屏不渲)、F3 条码/QR 库(bwip-js/qrcode)从渲染器懒拆。

**Architecture:** 纯 `apps/web` + `packages/template-renderer`(共享元件)。**F3 关键**:不把 Barcode/Qr 整组件 `defineAsyncComponent`(会破坏批次4 settle barrier——异步组件挂载晚于 chunk 加载,其 `begin()` 太晚 → `__renderReady` 早置 → 打印漏渲条码),而是**保持组件同步、在 `render()` 内动态 `import('bwip-js')`**,且 `begin()` 同步先行(`pending>0` 早于 `await`)→ barrier 正确等待懒加载 chunk。

**Tech Stack:** Vue 3.4 defineAsyncComponent / dynamic import、IntersectionObserver、Vite 5。

**Spec:** `docs/superpowers/specs/2026-05-28-system-review-audit.md` 桶二 F2/F3/F6。

**baseline(批次5 后构建,gz):** entry index 9.67gz、vue-vendor 38.65gz、element-plus 78.36gz、TemplatesView 35.94gz、**TemplateRenderer 255.64gz(904KB raw,含 bwip-js/qrcode)**。/templates = TemplatesView + TemplateRenderer(经 TemplateThumb)+ 每卡 N+1 GET。

**已核实事实:**
- `TemplatesView.vue:31` `import DesignerView from './DesignerView.vue'`(+ `:21` DesignerHeader、`:22` VersionDialog)→ 设计器静态进 TemplatesView.js。
- `TemplateRenderer.vue:6-14` 静态 import 全部 9 元件进 `elementMap`(:37-47);`barcode→BarcodeElement`(bwip-js)、`qr→QrElement`(qrcode-generator)。
- `TemplateThumb.vue`:`onMounted` 立即 `apiFetch('/templates/:id/versions/:version')`(全量 data,N+1)+ `<TemplateRenderer>` live-render;有 `rootRef`、已用 ResizeObserver。
- `BarcodeElement.vue`(批次4 后):`render()` 同步,`const ctx=active(); ctx?.begin(); try{ bwipjs.toCanvas(...) }catch{ reportError('barcode_invalid') }finally{ ctx?.end() }`;静态 `import bwipjs from 'bwip-js'`(:9,带 @ts-expect-error)。`QrElement.vue` 同模式,`import qrcode from 'qrcode-generator'`,reason `qr_invalid`。
- 批次4 settle:`PrintHeadlessView` 等 `pending===0`(8s 兜底)才置 `__renderReady`;元件 `begin/end` 计数。

---

## 全局约定
- 构建:`docker exec template_printing-web sh -c "cd /workspace/apps/web && pnpm run build 2>&1 | tail -50"`;typecheck/lint `pnpm run typecheck`/`pnpm run lint`;template-renderer 包也 typecheck/lint。
- 只动 `apps/web` + `packages/template-renderer`。不动后端/worker/schema。Git 不 `--no-verify`。
- **视觉/功能门**:F2(编辑器能打开)、F6(缩略图可视即渲、滚动加载)、F3(**打印渲染含条码模板仍出条码**——非视觉,可端到端验)需在 task 后由编排者请用户走查 / 端到端验。

---

## Task 1(F2):设计器异步分包

**Files:** Modify `apps/web/src/views/TemplatesView.vue`。

- [ ] **Step 1: DesignerView 改 defineAsyncComponent** `:31` `import DesignerView from './DesignerView.vue'` 删除;在 script 用:
```ts
import { defineAsyncComponent } from 'vue'; // 合并进现有 vue import
const DesignerView = defineAsyncComponent(() => import('./DesignerView.vue'));
```
> DesignerHeader(:21)/VersionDialog(:22):先 Read 它们在 TemplatesView `<template>` 的用法——若**仅在编辑态(与 DesignerView 同 v-if 区)**出现,也一并改 `defineAsyncComponent` 拆出;若在列表态也用到则保持静态。以"不破坏列表态渲染"为准,报告说明哪些改了。

- [ ] **Step 2: 构建验证** rebuild:确认出现独立 `DesignerView-*.js` chunk;`TemplatesView.js` 显著变小(设计器移出)。贴 before(35.94gz)→after。`pnpm run typecheck && pnpm run lint` 绿。

- [ ] **Step 3: 提交**
```bash
git add apps/web/src/views/TemplatesView.vue
git commit -m "perf(web): 设计器 defineAsyncComponent 异步分包,从 /templates 首屏拆出(F2)"
```
> 视觉门:进 /templates → 点"编辑/新建"→ 设计器正常打开(首次有短暂异步加载),编辑/保存/版本弹窗正常。

---

## Task 2(F6):缩略图 IntersectionObserver 懒加载

**Files:** Modify `apps/web/src/views/TemplateThumb.vue`。

- [ ] **Step 1: 改 onMounted 为可见即加载** 当前 `onMounted` 立即 fetch+render。改为:挂载时建 `IntersectionObserver` 观察 `rootRef`;**首次进入视口**才执行原 fetch+render 逻辑(抽成 `load()`),`load()` 完成或触发后断开 observer(只加载一次)。保留 version==null 早退、ResizeObserver(在 load 成功后再建,或保持)、onBeforeUnmount 断开两个 observer。
```ts
let io: IntersectionObserver | null = null;
let loaded = false;
async function load(): Promise<void> {
  if (loaded || props.version == null) return;
  loaded = true;
  try {
    const r = await apiFetch<{ data: Template }>(`/templates/${props.templateId}/versions/${props.version}`);
    tpl.value = r.data;
    const s: Record<string, unknown> = {};
    for (const [k, def] of Object.entries(r.data.schema ?? {})) s[k] = (def as { example?: unknown }).example ?? '';
    sample.value = s;
    await nextTick();
    recompute();
    if (rootRef.value) { ro = new ResizeObserver(recompute); ro.observe(rootRef.value); }
  } catch {
    /* 透明占位 */
  }
}
onMounted(() => {
  if (props.version == null || !rootRef.value) return;
  io = new IntersectionObserver((entries) => {
    if (entries.some((e) => e.isIntersecting)) { io?.disconnect(); io = null; void load(); }
  }, { rootMargin: '200px' /* 提前预载临近视口 */ });
  io.observe(rootRef.value);
});
onBeforeUnmount(() => { io?.disconnect(); ro?.disconnect(); });
```
> `rootMargin:'200px'` 让临近视口的卡提前加载,体验更顺。`nextTick` 确保 tpl 设后 DOM 在再 recompute。

- [ ] **Step 2: 验证** `pnpm run typecheck && pnpm run lint` 绿;rebuild 成功。
> 功能门:/templates 大量模板时,首屏只有可视卡发 `/versions/` 请求(Network 面板:离屏卡不请求);滚动时陆续加载;缩略图正常显示、尺寸正确。

- [ ] **Step 3: 提交**
```bash
git add apps/web/src/views/TemplateThumb.vue
git commit -m "perf(web): 缩略图 IntersectionObserver 懒加载,可视才取数+渲染(砍 N+1)(F6)"
```

---

## Task 3(F3):条码/QR 库懒拆(settle-safe 动态 import)

**Files:** Modify `packages/template-renderer/src/elements/BarcodeElement.vue`、`QrElement.vue`。

- [ ] **Step 1: BarcodeElement 动态 import bwip-js** 删静态 `import bwipjs from 'bwip-js'`(及其 @ts-expect-error/eslint-disable 注释行,:4-9 那段);`render()` 改 async + 内部动态 import,**`begin()` 仍同步先行**:
```ts
async function render(): Promise<void> {
  if (!hasContent.value) return;
  if (!canvasRef.value) return;
  const v = value.value;
  if (!v) return;
  const elPxW = props.element.anchor.w * 4;
  const elPxH = props.element.anchor.h * 4;
  const estModules = v.length * 11 + 20;
  const scale = Math.max(1, Math.floor((elPxW * 0.85) / estModules));
  const height = Math.max(8, Math.floor(elPxH * 0.75));
  const ctx = active();
  ctx?.begin(); // 同步先行:pending>0 早于 await,settle barrier 正确等待懒加载
  try {
    // @ts-expect-error -- bwip-js 条件导出 vue-tsc 无法解析;Vite 运行时取 browser bundle
    // eslint-disable-next-line import/no-unresolved
    const mod = await import('bwip-js');
    const bwipjs = (mod as { default?: typeof mod }).default ?? mod;
    if (!canvasRef.value) return; // await 后可能已卸载
    bwipjs.toCanvas(canvasRef.value, { /* 原参数对象不变 */ });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[BarcodeElement] bwip-js render failed:', err);
    ctx?.reportError('barcode_invalid', String((err as Error)?.message ?? err));
  } finally {
    ctx?.end();
  }
}
```
> watch/onMounted 调 `render()` 处:现 render 返回 Promise,fire-and-forget 即可(settle 跟踪),但建议 `void render()` 显式忽略 promise(satisfy eslint no-floating-promises 若启用)。确认 `begin()` 在任何 await 之前同步执行。bwip-js 动态 import 的具体取值(default vs namespace.toCanvas)以构建/运行实际为准,确保 `toCanvas` 可调用。

- [ ] **Step 2: QrElement 动态 import qrcode-generator** 同法:删静态 `import qrcode from 'qrcode-generator'`;`render()` async,`begin()` 先行,`const mod = await import('qrcode-generator'); const qrcode = (mod as any).default ?? mod;` 再 `qrcode(0, ecc)...`;catch `reportError('qr_invalid', ...)`;finally end。await 后判 `hasContent`/存活。

- [ ] **Step 3: 构建验证(chunk 拆分)** rebuild:确认 **bwip-js / qrcode-generator 拆成独立懒加载 chunk**(出现 `bwip-js-*.js` 之类),`TemplateRenderer.js` 显著变小(255gz → 应大降,bwip-js 移出)。贴 before(255.64gz)→after + 新增 bwip 懒 chunk 体积。`pnpm run typecheck && pnpm run lint`(web + template-renderer)绿。

- [ ] **Step 4: 端到端验证(关键——打印含条码模板仍出条码)** 这是 F3 的回归门(settle barrier 必须等住懒加载):
  - 重启容器载新代码:`docker restart template_printing-web template_printing-render`。
  - 先确认已发布模板 `41fcaaf0`(扬力出门证)**是否含 barcode/qr 元件**(`docker exec template_printing-postgres psql ... "SELECT data::text FROM templates WHERE id='41fcaaf0...'"` grep `"type":"barcode"`/`"qr"`)。若含 → 经 API(临时 token,完后清理)入队渲染 → 轮询 done → **下载 PDF 确认条码/二维码真实出现(非空白)**;若不含,造一个含 barcode 的临时 schema-合法模板(参考批次4-T7 做法)入队验证。
  - 这验证:动态 import 在 worker 浏览器内能加载 + settle barrier 等到条码渲染完才 `__renderReady` → 打印不漏条码。清理临时数据。贴 job status + 条码可见性结论。
  - 若 Docker 不可用报 BLOCKED。

- [ ] **Step 5: 提交**
```bash
git add packages/template-renderer/src/elements/BarcodeElement.vue packages/template-renderer/src/elements/QrElement.vue
git commit -m "perf(renderer): bwip-js/qrcode 动态 import 懒拆(settle-safe begin 先行),无条码页不载条码库(F3)"
```

---

## Task 4:体积对比 + 文档

**Files:** Modify `docs/PROGRESS.md`。

- [ ] **Step 1: 最终构建对比** rebuild,整理 /templates 相关 chunk before(批次5 后)→after:TemplatesView、新增 DesignerView chunk、TemplateRenderer、新增 bwip-js/qrcode 懒 chunk。算 /templates 首屏(无条码模板时)gz 下降。
- [ ] **Step 2: PROGRESS** `### 2026-05-29` 追加批次6 条目(F2 设计器异步 + F6 缩略图懒加载 + F3 条码库懒拆 settle-safe + 体积对比;注明 F4 hydrate/F8-F11 等仍留后续)。更新「最近更新」。
- [ ] **Step 3: 提交**
```bash
git add docs/PROGRESS.md
git commit -m "docs: 批次6 /templates 落地页优化(F2/F6/F3)同步 + 体积对比"
```

---

## Self-Review
**Spec 覆盖:** F2→T1、F6→T2、F3→T3、对比/文档→T4。
**占位符:** F2 defineAsyncComponent、F6 IntersectionObserver+load()、F3 动态 import + begin 先行 均给完整代码;bwip-js 动态取值/DesignerHeader 是否拆 标"以实际为准/报告说明"。
**风险点(关键):** (1) **F3↔settle barrier**:begin() 必须在 `await import` 之前同步执行(pending 早增)→ T3-Step4 端到端打印条码验证是硬门,确认不漏渲。(2) **F3 await 后存活检查**:await 后组件可能卸载/canvas 没了 → 加 `if(!canvasRef.value) return`。(3) F2 异步组件首次打开有加载态(可接受);确认列表态用到的设计器组件不被误拆。(4) F6 rootMargin 预载 + 只加载一次(loaded 守卫)。(5) bwip-js 动态 import 的 default/namespace 形态需运行时确认 toCanvas 可调用。
