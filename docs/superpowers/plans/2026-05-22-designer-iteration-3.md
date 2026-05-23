# Designer Iteration 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply iteration-3 (view-zoom layer, style-fix + mm-based sizing, barcode placeholder + restyled grip) to the designer.

**Architecture:** Decouple paper-mm from display-px via a `view.zoom` factor that multiplies CSS variables only. mm-based default + minimum sizes per element type drive both factory and resize guards. Barcode rendering switches to a CSS placeholder while `store.isResizing` is true; selection grip moves from a pill above the element to bare dots inside the top border (with a small-element fallback).

**Tech Stack:** Vue 3 SFC, Pinia, CSS variables, ResizeObserver, no new deps.

**Source spec:** `docs/superpowers/specs/2026-05-22-designer-iteration-3-design.md`

**Conventions in this repo (read before starting):**
- ESLint `import/no-unresolved` doesn't understand workspace package names or vue / pinia / zod under bundler resolution. Existing files use `// eslint-disable-next-line import/no-unresolved` immediately above each such import. Follow that pattern; do not edit `.eslintrc.cjs`.
- Schema package imports use `.js` extension even when the file is `.ts` (bundler `moduleResolution` quirk).
- Dev environment runs in docker. One-off command template:
  `docker compose -f docker-compose.dev.yml exec -T web sh -c 'cd /workspace/apps/web && <cmd>'`
- Type-check: `NODE_OPTIONS=--max-old-space-size=4096 ./node_modules/.bin/vue-tsc --noEmit` (use 8192 for the final pass).
- Do **not** skip git hooks. The pre-commit lint-staged hook is the authoritative formatter and linter.

---

## File Structure

### Store
- **Modify** `apps/web/src/stores/designer.ts`
  - Add `view: { zoom: number }` to state, default 1.0.
  - New actions: `setZoom(z)`, `fitView()` (consults a registered area-size accessor).
  - Restore migration: clamp existing element `anchor.w/h` up to `minMmFor(el)`.

### Renderer package
- **Modify** `packages/template-renderer/src/styleToCss.ts`
  - Coerce every numeric output to a string so Vue's `:style` binding doesn't drop properties.
- **Modify** `packages/template-renderer/src/elements/FieldElement.vue`
  - Lower the `.tp-field-design` color specificity with `:where()` so inline color always wins.
- **Modify** `packages/template-renderer/src/elements/BarcodeElement.vue`
  - Accept `isResizing?: boolean` prop. Swap `<canvas>` for a CSS placeholder when true.

### Designer
- **Modify** `apps/web/src/designer/elementFactory.ts`
  - Replace `defaultGrid: { cs, rs }` with `defaultMm: { w, h }` on `ElementMeta`.
  - Add `MIN_MM` table and exported `minMmFor(el)` helper.
  - New `buildElement` signature: `(meta, newId, anchorMm, cell)`.
- **Modify** `apps/web/src/designer/ElementLibrary.vue`
  - `clickAdd` builds anchor at a sensible default position in mm.
- **Modify** `apps/web/src/designer/DesignerCanvas.vue`
  - Apply `view.zoom` to the `--cell-w`/`--cell-h`/`--canvas-w`/`--canvas-h` CSS variables.
  - Publish a `canvasAreaRef` and use `ResizeObserver` to drive `store.fitView`.
  - `onDrop` converts cursor to mm via `paperRect / (PX_PER_MM × zoom)`, centers element on cursor.
- **Modify** `apps/web/src/designer/DesignerHeader.vue`
  - Insert a zoom dropdown between cell dropdown and spacer.
- **Modify** `apps/web/src/designer/usePointerDrag.ts`
  - Apply `minMmFor(el)` clamp on resize.
- **Modify** `apps/web/src/designer/PropertyPanel.vue`
  - Dynamic `:min` on the mm width/height inputs.
- **Modify** `apps/web/src/designer/CanvasElement.vue`
  - Pass `:is-resizing` and `:is-small` to inner BarcodeElement / ElementGrip.
- **Modify** `apps/web/src/designer/ElementGrip.vue`
  - Default = bare 6 dots inside top border; `isSmall` prop falls back to outside pill.

### Views
- **Modify** `apps/web/src/views/PreviewView.vue`
  - Wrap paper in a scrollable container, transform-scale by `previewZoom`. Add zoom control.

---

## Tasks

### Task 1: Add `view.zoom` to store + actions

**Files:**
- Modify: `apps/web/src/stores/designer.ts`

- [ ] **Step 1: Add `view` to state**

Find the state block (`state: () => ({ template: ..., selectedIds: [], ... })`) and add:

```ts
state: () => ({
  template: defaultTemplate(),
  selectedIds: [] as string[],
  history: [] as string[],
  historyIndex: -1,
  dirty: false,
  isResizing: false,
  view: { zoom: 1 } as { zoom: number },
  // Internal: a DOM size accessor that DesignerCanvas registers so the store
  // can compute fit-to-view without a DOM dependency.
  canvasAreaSize: null as null | (() => { w: number; h: number }),
}),
```

- [ ] **Step 2: Add `setZoom`, `fitView`, `registerCanvasArea` actions**

In the `actions` block, add:

```ts
registerCanvasArea(reader: () => { w: number; h: number }): void {
  this.canvasAreaSize = reader;
},
setZoom(z: number): void {
  this.view.zoom = Math.max(0.25, Math.min(4, z));
  // No snapshot — view.zoom is not history-tracked or persisted.
},
fitView(): void {
  if (!this.canvasAreaSize) return;
  const area = this.canvasAreaSize();
  const px = paperPxSize(this.template.canvas.paper);
  const padding = 80;
  const fitW = (area.w - padding) / px.w;
  const fitH = (area.h - padding) / px.h;
  const z = Math.max(0.25, Math.min(4, Math.min(fitW, fitH)));
  if (Number.isFinite(z) && z > 0) this.view.zoom = z;
},
```

- [ ] **Step 3: Call `fitView` from `setPaper`**

In the existing `setPaper` action, after the `this.snapshot()` line at the end, append:

```ts
// Re-fit on paper change since the relative size jumps.
this.fitView();
```

- [ ] **Step 4: Type-check**

```bash
docker compose -f docker-compose.dev.yml exec -T web sh -c 'cd /workspace/apps/web && NODE_OPTIONS=--max-old-space-size=4096 ./node_modules/.bin/vue-tsc --noEmit'
echo "exit=$?"
```

Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/stores/designer.ts
git commit -m "feat(store): add view.zoom state + setZoom/fitView/registerCanvasArea"
```

---

### Task 2: DesignerCanvas applies view.zoom + drives fitView

**Files:**
- Modify: `apps/web/src/designer/DesignerCanvas.vue`

- [ ] **Step 1: Wire view.zoom into CSS variables**

Open `apps/web/src/designer/DesignerCanvas.vue`. Find the `cssVars` computed and replace it:

```ts
const cssVars = computed(() => {
  const z = store.view.zoom;
  const px = store.paperPx;
  return {
    '--cell-w': `${store.template.canvas.cell.w * z}px`,
    '--cell-h': `${store.template.canvas.cell.h * z}px`,
    '--canvas-w': `${px.w * z}px`,
    '--canvas-h': `${px.h * z}px`,
  };
});
```

- [ ] **Step 2: Register the canvas-area size accessor + ResizeObserver**

Find the existing `<script setup>` imports — ensure `ref`, `onMounted`, `onBeforeUnmount` are imported from 'vue'. Add the canvas-area ref and lifecycle hooks:

```ts
const canvasAreaRef = ref<HTMLElement | null>(null);

let resizeObserver: ResizeObserver | null = null;

onMounted(() => {
  store.registerCanvasArea(() => {
    const el = canvasAreaRef.value;
    if (!el) return { w: 800, h: 600 };
    return { w: el.clientWidth, h: el.clientHeight };
  });
  // Initial fit after mount + first paint.
  requestAnimationFrame(() => store.fitView());

  if (canvasAreaRef.value && typeof ResizeObserver !== 'undefined') {
    let raf = 0;
    resizeObserver = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => store.fitView());
    });
    resizeObserver.observe(canvasAreaRef.value);
  }
});

onBeforeUnmount(() => {
  resizeObserver?.disconnect();
});
```

- [ ] **Step 3: Add `ref="canvasAreaRef"` to the canvas-area div**

Find `<div class="tp-canvas-area">` in the template and add the ref:

```vue
<div ref="canvasAreaRef" class="tp-canvas-area">
```

- [ ] **Step 4: Type-check**

```bash
docker compose -f docker-compose.dev.yml exec -T web sh -c 'cd /workspace/apps/web && NODE_OPTIONS=--max-old-space-size=4096 ./node_modules/.bin/vue-tsc --noEmit'
echo "exit=$?"
```

Expected: exit 0.

- [ ] **Step 5: Browser smoke test**

Open `http://localhost:5173/designer/new`. Switch from A4 to GuardPass (出门证 90×60mm) in the paper dropdown. Verify the paper grows to fill most of the canvas area, not 360×240 px.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/designer/DesignerCanvas.vue
git commit -m "feat(designer): canvas applies view.zoom + auto fit-to-view via ResizeObserver"
```

---

### Task 3: DesignerHeader — zoom dropdown

**Files:**
- Modify: `apps/web/src/designer/DesignerHeader.vue`

- [ ] **Step 1: Add `zoomLabel` computed + `chooseZoom`/`onFit` handlers**

In `<script setup>` of `DesignerHeader.vue`, near the other computed:

```ts
const zoomLabel = computed(() => `${Math.round(store.view.zoom * 100)}%`);
const zoomOptions = [0.25, 0.5, 0.75, 1, 1.5, 2, 4];
function chooseZoom(z: number): void { store.setZoom(z); }
function onFit(): void { store.fitView(); }
```

- [ ] **Step 2: Add the dropdown in the toolbar template**

In `<template>` find the existing `<ElDropdown trigger="click">` block for the cell dropdown (containing `<button class="tt-btn">⊞ {{ cellLabel }}</button>`). Immediately after the closing `</ElDropdown>` of the cell dropdown, insert:

```vue
<ElDropdown trigger="click">
  <button class="tt-btn">🔍 {{ zoomLabel }}</button>
  <template #dropdown>
    <ElDropdownMenu>
      <ElDropdownItem @click="onFit">Fit (自动适配)</ElDropdownItem>
      <ElDropdownItem v-for="z in zoomOptions" :key="z" @click="chooseZoom(z)">
        {{ Math.round(z * 100) }}%
      </ElDropdownItem>
    </ElDropdownMenu>
  </template>
</ElDropdown>
```

- [ ] **Step 3: Type-check**

```bash
docker compose -f docker-compose.dev.yml exec -T web sh -c 'cd /workspace/apps/web && NODE_OPTIONS=--max-old-space-size=4096 ./node_modules/.bin/vue-tsc --noEmit'
echo "exit=$?"
```

Expected: exit 0.

- [ ] **Step 4: Browser smoke test**

Toggle through the zoom options. Pick `100%` → paper renders at 1:1. Pick `50%` → halves. Pick `Fit` → returns to auto-fit.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/designer/DesignerHeader.vue
git commit -m "feat(designer): zoom dropdown in top toolbar (Fit + 25/50/75/100/150/200/400%)"
```

---

### Task 4: PreviewView — auto-fit + zoom control

**Files:**
- Modify: `apps/web/src/views/PreviewView.vue`

- [ ] **Step 1: Read existing PreviewView.vue**

Skim its current structure to understand how the paper is mounted. The implementation likely renders an inline `tp-paper` div with the elements inside, no scaling.

- [ ] **Step 2: Add fit + zoom state**

Inside `<script setup>` add (with existing imports of `ref`, `computed`, `onMounted`, `watch` — add any missing):

```ts
const previewZoom = ref(1);
const modalContainerRef = ref<HTMLElement | null>(null);
const zoomOptions = [0.5, 0.75, 1, 1.5, 2];

function computeFit(): number {
  const el = modalContainerRef.value;
  if (!el) return 1;
  const px = store.paperPx;
  const padding = 60;
  const fitW = (el.clientWidth  - padding) / px.w;
  const fitH = (el.clientHeight - padding) / px.h;
  return Math.max(0.1, Math.min(2, Math.min(fitW, fitH)));
}

function onFitPreview(): void { previewZoom.value = computeFit(); }
function choosePreviewZoom(z: number): void { previewZoom.value = z; }

// Recompute fit whenever the modal opens or window resizes.
watch(() => props.modelValue, (open) => {
  if (open) requestAnimationFrame(() => { previewZoom.value = computeFit(); });
});
```

(`props.modelValue` is the existing v-model binding — if the prop is named differently, adapt.)

- [ ] **Step 3: Update template structure**

Wrap the paper in a scrollable container with the scale applied. Replace the modal-content body of `<ElDialog>` (or the existing inner template) with:

```vue
<div ref="modalContainerRef" class="pv-container">
  <div class="pv-paper-wrap" :style="{ transform: `scale(${previewZoom})`, transformOrigin: 'top left' }">
    <div class="tp-paper" :style="paperStyle">
      <!-- existing element rendering loop here, unchanged -->
    </div>
  </div>
  <div class="pv-zoom">
    <button class="pv-zoom-btn" @click="onFitPreview">Fit</button>
    <button v-for="z in zoomOptions" :key="z" class="pv-zoom-btn"
      :class="{ on: Math.abs(previewZoom - z) < 0.01 }"
      @click="choosePreviewZoom(z)">
      {{ Math.round(z * 100) }}%
    </button>
  </div>
</div>
```

(`paperStyle` should bind to `{ width: `${store.paperPx.w}px`, height: `${store.paperPx.h}px` }` — at native paper px, since the scale wrapper handles fitting.)

- [ ] **Step 4: Add CSS**

In `<style scoped>` append:

```css
.pv-container {
  width: 100%;
  height: 70vh;
  position: relative;
  overflow: auto;
  background: var(--tp-canvas-bg);
  border-radius: 8px;
}
.pv-paper-wrap {
  display: inline-block;
  margin: 30px;
}
.pv-zoom {
  position: absolute;
  bottom: 12px;
  right: 12px;
  display: flex;
  gap: 4px;
  background: rgba(255,255,255,0.94);
  border-radius: 999px;
  padding: 4px 6px;
  box-shadow: 0 2px 12px rgba(20,20,30,0.10);
}
.pv-zoom-btn {
  border: none;
  background: transparent;
  font-size: 11px;
  padding: 3px 8px;
  border-radius: 999px;
  cursor: pointer;
  color: var(--tp-ink-soft);
}
.pv-zoom-btn:hover { background: var(--tp-field-bg); }
.pv-zoom-btn.on { background: var(--tp-accent); color: #fff; font-weight: 600; }
```

- [ ] **Step 5: Type-check**

```bash
docker compose -f docker-compose.dev.yml exec -T web sh -c 'cd /workspace/apps/web && NODE_OPTIONS=--max-old-space-size=4096 ./node_modules/.bin/vue-tsc --noEmit'
echo "exit=$?"
```

- [ ] **Step 6: Visual check**

Click "预览" in the toolbar. Verify content fits without overflow; zoom buttons work.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/views/PreviewView.vue
git commit -m "feat(preview): auto-fit + manual zoom control"
```

---

### Task 5: Harden `styleToCss` (string-coerce all values)

**Files:**
- Modify: `packages/template-renderer/src/styleToCss.ts`

- [ ] **Step 1: Replace the function body**

Open `packages/template-renderer/src/styleToCss.ts`. Replace the body of `styleToCss` with this version that coerces every value to a string:

```ts
export function styleToCss(s: ElementStyle): Record<string, string> {
  const out: Record<string, string> = {};
  if (s.color) out.color = s.color;
  if (s.fontFamily) out.fontFamily = FONT_STACK[s.fontFamily];
  if (s.fontSize) out.fontSize = `${s.fontSize}px`;
  if (s.fontWeight) out.fontWeight = String(s.fontWeight);
  if (s.letterSpacing !== undefined) out.letterSpacing = `${s.letterSpacing}px`;
  if (s.lineHeight !== undefined) out.lineHeight = String(s.lineHeight);
  if (s.textDecoration && s.textDecoration !== 'none') out.textDecoration = s.textDecoration;
  if (s.backgroundColor) out.backgroundColor = s.backgroundColor;
  if (s.textAlign && s.textAlign !== 'default') out.textAlign = s.textAlign;
  if (s.zIndex !== undefined) out.zIndex = String(s.zIndex);
  if (s.rotation) out.transform = `rotate(${s.rotation}deg)`;
  if (s.opacity !== undefined) out.opacity = String(s.opacity);
  if (s.textOverflow === 'ellipsis') {
    out.whiteSpace = 'nowrap';
    out.overflow = 'hidden';
    out.textOverflow = 'ellipsis';
  } else if (s.textOverflow === 'clip') {
    out.overflow = 'hidden';
  }
  return out;
}
```

Note the return type changed from `Record<string, string | number>` to `Record<string, string>`. Callers that destructure should still compile.

- [ ] **Step 2: Type-check**

```bash
docker compose -f docker-compose.dev.yml exec -T web sh -c 'cd /workspace/apps/web && NODE_OPTIONS=--max-old-space-size=4096 ./node_modules/.bin/vue-tsc --noEmit'
echo "exit=$?"
```

If consumers like `TextElement.vue` do `{ ...styleToCss(...), display: 'flex', ... }` they should still compile (Vue's `:style` accepts a record of strings).

- [ ] **Step 3: Commit**

```bash
git add packages/template-renderer/src/styleToCss.ts
git commit -m "fix(renderer): styleToCss coerces all values to string for stable Vue :style"
```

---

### Task 6: Lower `tp-field-design` color specificity

**Files:**
- Modify: `packages/template-renderer/src/elements/FieldElement.vue`

- [ ] **Step 1: Replace the scoped style block**

In `packages/template-renderer/src/elements/FieldElement.vue`, find the `<style scoped>` block. Replace:

```css
.tp-field-design {
  color: #0969da;
}
```

with:

```css
/* Wrapping in :where() drops the selector to specificity 0,
   so any inline color from styleToCss always wins. */
:where(.tp-field-design) {
  color: #0969da;
}
```

- [ ] **Step 2: Type-check**

```bash
docker compose -f docker-compose.dev.yml exec -T web sh -c 'cd /workspace/apps/web && NODE_OPTIONS=--max-old-space-size=4096 ./node_modules/.bin/vue-tsc --noEmit'
echo "exit=$?"
```

- [ ] **Step 3: Browser check**

Open the designer. Drop a field element, select it, change its color in PropertyPanel "样式 · 基础 → 颜色". Confirm the color visibly changes (was getting overridden by `tp-field-design`).

- [ ] **Step 4: Commit**

```bash
git add packages/template-renderer/src/elements/FieldElement.vue
git commit -m "fix(renderer): drop tp-field-design specificity so inline color wins"
```

---

### Task 7: Replace `defaultGrid` with `defaultMm` + add `MIN_MM`

**Files:**
- Modify: `apps/web/src/designer/elementFactory.ts`

- [ ] **Step 1: Replace `ElementMeta` + `LIBRARY_ITEMS` + add `MIN_MM`/`minMmFor`**

Open `apps/web/src/designer/elementFactory.ts`. Replace the top of the file (between imports and `defaultBorder`) with:

```ts
export type LibraryGroup = '文字' | '图形' | '数据';

export interface ElementMeta {
  type: TemplateElement['type'];
  glyph: string;
  label: string;
  group: LibraryGroup;
  defaultMm: { w: number; h: number };
  variant?: 'qr' | 'barcode';
}

export const LIBRARY_ITEMS: ElementMeta[] = [
  { type: 'text',       group: '文字', glyph: 'T',   label: '文字',   defaultMm: { w: 40, h: 8 } },
  { type: 'field',      group: '文字', glyph: '{}',  label: '字段',   defaultMm: { w: 50, h: 8 } },
  { type: 'autonumber', group: '文字', glyph: '№',   label: '编号',   defaultMm: { w: 45, h: 8 } },
  { type: 'system',     group: '文字', glyph: '#',   label: '系统',   defaultMm: { w: 45, h: 8 } },
  { type: 'rect',       group: '图形', glyph: '▢',   label: '矩形',   defaultMm: { w: 40, h: 20 } },
  { type: 'image',      group: '图形', glyph: '▤',   label: '图片',   defaultMm: { w: 40, h: 40 } },
  { type: 'table',      group: '数据', glyph: '▦',   label: '明细',   defaultMm: { w: 150, h: 60 } },
  { type: 'barcode',    group: '数据', glyph: '▣',   label: '二维码', defaultMm: { w: 25, h: 25 }, variant: 'qr' },
  { type: 'barcode',    group: '数据', glyph: '|||', label: '条码',   defaultMm: { w: 60, h: 16 }, variant: 'barcode' },
];

export const MIN_MM: Record<string, { w: number; h: number }> = {
  text:       { w: 8,  h: 4 },
  field:      { w: 12, h: 4 },
  autonumber: { w: 12, h: 4 },
  system:     { w: 12, h: 4 },
  rect:       { w: 4,  h: 4 },
  image:      { w: 10, h: 10 },
  table:      { w: 60, h: 20 },
  qr:         { w: 12, h: 12 },
  barcode1d:  { w: 25, h: 8 },
};

export function minMmFor(el: TemplateElement): { w: number; h: number } {
  if (el.type === 'barcode') return el.symbology === 'qr' ? MIN_MM.qr : MIN_MM.barcode1d;
  return MIN_MM[el.type];
}
```

- [ ] **Step 2: Replace `buildElement` signature + body**

Find the existing `buildElement` function. Replace its full body with:

```ts
const PX_PER_MM = 4;

export function buildElement(
  meta: ElementMeta,
  newId: string,
  anchorMm: { x: number; y: number },
  cell: { w: number; h: number },
): TemplateElement {
  const anchor = {
    x: anchorMm.x,
    y: anchorMm.y,
    w: meta.defaultMm.w,
    h: meta.defaultMm.h,
  };
  const grid = {
    c: Math.round((anchor.x * PX_PER_MM) / cell.w),
    r: Math.round((anchor.y * PX_PER_MM) / cell.h),
    cs: Math.max(1, Math.round((anchor.w * PX_PER_MM) / cell.w)),
    rs: Math.max(1, Math.round((anchor.h * PX_PER_MM) / cell.h)),
  };
  const style = defaultStyle();
  switch (meta.type) {
    case 'text':
      return { id: newId, type: 'text', grid, anchor, style, content: { static: '示例文本' } };
    case 'field':
      return { id: newId, type: 'field', grid, anchor, style, binding: 'fieldKey', fallback: '—', format: null };
    case 'image':
      return { id: newId, type: 'image', grid, anchor, style, source: { kind: 'static', url: '' }, fit: 'contain' };
    case 'rect':
      return { id: newId, type: 'rect', grid, anchor, style };
    case 'table':
      return {
        id: newId, type: 'table', grid, anchor, style, binding: 'items',
        columns: [
          { key: 'col1', header: '列1', cs: 30, align: 'left', format: null },
          { key: 'col2', header: '列2', cs: 30, align: 'right', format: null },
        ],
        rowHeight: 4, showHeader: true,
      };
    case 'barcode':
      return {
        id: newId, type: 'barcode', grid, anchor, style,
        symbology: meta.variant === 'qr' ? 'qr' : 'code128',
        content: { static: 'SAMPLE' }, showText: false,
        foregroundColor: '#000000', backgroundColor: '#ffffff', quietZone: 2,
        ...(meta.variant === 'qr'
          ? { eccLevel: 'M' as const }
          : { textPosition: 'bottom' as const, textFontSize: 10 }),
      };
    case 'autonumber':
      return { id: newId, type: 'autonumber', grid, anchor, style, sequence: 'default', format: '0000000', prefix: '' };
    case 'system':
      return { id: newId, type: 'system', grid, anchor, style, variable: 'pageNo' };
  }
}
```

- [ ] **Step 3: Type-check (callers will break — that's expected; Task 8 fixes them)**

```bash
docker compose -f docker-compose.dev.yml exec -T web sh -c 'cd /workspace/apps/web && NODE_OPTIONS=--max-old-space-size=4096 ./node_modules/.bin/vue-tsc --noEmit 2>&1 | tail -10'
```

Expect errors in `ElementLibrary.vue` and `DesignerCanvas.vue` complaining about the changed signature. That's OK — Task 8 fixes them.

- [ ] **Step 4: Commit (tree currently red, fixed in Task 8)**

```bash
git add apps/web/src/designer/elementFactory.ts
git commit -m "feat(designer): elementFactory uses defaultMm + adds MIN_MM table"
```

---

### Task 8: Update callers (ElementLibrary + DesignerCanvas) to mm signature

**Files:**
- Modify: `apps/web/src/designer/ElementLibrary.vue`
- Modify: `apps/web/src/designer/DesignerCanvas.vue`

- [ ] **Step 1: Update `clickAdd` in ElementLibrary.vue**

In `apps/web/src/designer/ElementLibrary.vue`, find `clickAdd` and replace its body:

```ts
function clickAdd(meta: ElementMeta): void {
  const cell = store.template.canvas.cell;
  // Drop at a small default offset from top-left so successive clicks don't fully overlap.
  const count = store.template.elements.length;
  const anchorMm = { x: 4 + (count % 10) * 2, y: 4 + (count % 10) * 2 };
  const el = buildElement(meta, store.newElementId(), anchorMm, cell);
  store.addElement(el);
}
```

- [ ] **Step 2: Update `onDrop` in DesignerCanvas.vue**

In `apps/web/src/designer/DesignerCanvas.vue`, find `onDrop` (the dragend / drop handler on the canvas). Replace the body that calls `buildElement(...)` with:

```ts
function onDrop(e: DragEvent): void {
  e.preventDefault();
  if (!e.dataTransfer) return;
  const raw = e.dataTransfer.getData('application/x-tp-element');
  if (!raw) return;
  let meta: ElementMeta;
  try { meta = JSON.parse(raw); } catch { return; }
  if (!paperRef.value) return;

  const rect = paperRef.value.getBoundingClientRect();
  const zoom = store.view.zoom;
  const PX_PER_MM = 4;
  const cursorMmX = (e.clientX - rect.left) / (PX_PER_MM * zoom);
  const cursorMmY = (e.clientY - rect.top)  / (PX_PER_MM * zoom);

  const paperPx = store.paperPx;
  const paperMm = { w: paperPx.w / PX_PER_MM, h: paperPx.h / PX_PER_MM };

  const anchorMm = {
    x: Math.max(0, Math.min(paperMm.w - meta.defaultMm.w, cursorMmX - meta.defaultMm.w / 2)),
    y: Math.max(0, Math.min(paperMm.h - meta.defaultMm.h, cursorMmY - meta.defaultMm.h / 2)),
  };

  const el = buildElement(meta, store.newElementId(), anchorMm, store.template.canvas.cell);
  store.addElement(el);
}
```

If the existing function name is different (e.g., `handleDrop`), adapt the change to that function.

- [ ] **Step 3: Type-check**

```bash
docker compose -f docker-compose.dev.yml exec -T web sh -c 'cd /workspace/apps/web && NODE_OPTIONS=--max-old-space-size=4096 ./node_modules/.bin/vue-tsc --noEmit'
echo "exit=$?"
```

Expected: exit 0.

- [ ] **Step 4: Browser smoke test**

Drag a field element from the library onto the paper. The element should appear at the cursor location (centered), about 50×8 mm — visibly larger than iteration-2 defaults.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/designer/ElementLibrary.vue apps/web/src/designer/DesignerCanvas.vue
git commit -m "feat(designer): callers use mm anchorMm; drop centers on cursor"
```

---

### Task 9: usePointerDrag — min-mm resize guard

**Files:**
- Modify: `apps/web/src/designer/usePointerDrag.ts`

- [ ] **Step 1: Import `minMmFor`**

In `apps/web/src/designer/usePointerDrag.ts`, add to the existing top-of-file imports:

```ts
import { minMmFor } from './elementFactory';
```

- [ ] **Step 2: Apply min clamp inside `onResizeDown`'s `onMove`**

Find `onResizeDown` → `onMove` → the block computing `newC, newR, newCs, newRs`. After the existing `if (side.includes('w'))` ... etc clamping but BEFORE `store.resizeElement(...)`, insert:

```ts
// Iteration-3: enforce per-type minimum size in mm.
const PX_PER_MM = 4;
const minMm = minMmFor(el);
const minCs = Math.max(1, Math.ceil((minMm.w * PX_PER_MM) / cell.w));
const minRs = Math.max(1, Math.ceil((minMm.h * PX_PER_MM) / cell.h));
if (newCs < minCs) {
  if (side.includes('w')) {
    // Dragging the west edge — pin the right edge so the element doesn't slide.
    newC = startC + startCs - minCs;
  }
  newCs = minCs;
}
if (newRs < minRs) {
  if (side.includes('n')) {
    newR = startR + startRs - minRs;
  }
  newRs = minRs;
}
```

The earlier QR `cs === rs` lock (still applied after this block) will pick the larger of the two — that's fine.

- [ ] **Step 3: Type-check**

```bash
docker compose -f docker-compose.dev.yml exec -T web sh -c 'cd /workspace/apps/web && NODE_OPTIONS=--max-old-space-size=4096 ./node_modules/.bin/vue-tsc --noEmit'
echo "exit=$?"
```

- [ ] **Step 4: Browser smoke test**

Drop a text element. Drag the right edge inward — it should stop at ~8 mm width. Drag the bottom edge upward — it should stop at ~4 mm height.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/designer/usePointerDrag.ts
git commit -m "feat(designer): per-type min mm resize guard"
```

---

### Task 10: PropertyPanel — dynamic `:min` on mm size inputs

**Files:**
- Modify: `apps/web/src/designer/PropertyPanel.vue`

- [ ] **Step 1: Import + compute `minMmCurrent`**

In `<script setup>` of `apps/web/src/designer/PropertyPanel.vue`, add:

```ts
import { minMmFor } from './elementFactory';

const minMmCurrent = computed(() =>
  sel.value ? minMmFor(sel.value) : { w: 0.25, h: 0.25 },
);
```

- [ ] **Step 2: Update the size axis inputs**

Find the two size inputs (the ones bound to `sel.anchor.w` and `sel.anchor.h`). Change their static `min="0.25"` to:

```vue
<input ... :min="minMmCurrent.w" ... />
<!-- and -->
<input ... :min="minMmCurrent.h" ... />
```

Also tighten `onAnchorInput`'s clamp so it consults minMmCurrent for `w`/`h` writes:

```ts
function onAnchorInput(key: 'x' | 'y' | 'w' | 'h', e: Event): void {
  if (!sel.value) return;
  const v = Number((e.target as HTMLInputElement).value);
  if (!Number.isFinite(v)) return;
  let min: number;
  if (key === 'w') min = minMmCurrent.value.w;
  else if (key === 'h') min = minMmCurrent.value.h;
  else min = 0;
  store.setElementAnchor(sel.value.id, { [key]: Math.max(min, v) });
}
```

- [ ] **Step 3: Type-check**

```bash
docker compose -f docker-compose.dev.yml exec -T web sh -c 'cd /workspace/apps/web && NODE_OPTIONS=--max-old-space-size=4096 ./node_modules/.bin/vue-tsc --noEmit'
echo "exit=$?"
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/designer/PropertyPanel.vue
git commit -m "feat(designer): PropertyPanel mm width/height inputs clamp to per-type min"
```

---

### Task 11: Restore migration — clamp small anchors up to min

**Files:**
- Modify: `apps/web/src/stores/designer.ts`

- [ ] **Step 1: Import `minMmFor`**

At the top of `apps/web/src/stores/designer.ts`, add (after the existing imports — the schema is imported from `@template-printing/schema`; `minMmFor` lives in the designer folder, so use a relative path):

```ts
import { minMmFor } from '../designer/elementFactory';
```

- [ ] **Step 2: Apply the clamp in `restore()`**

In the `restore()` action, after Step 1 (anchor derivation) and Step 2 (cell snap) but BEFORE Step 3 (recompute grid), add:

```ts
// Step 2.5 — Iteration-3: clamp anchor.w/h up to per-type minimum.
// This brings iteration-2 drafts (which had no minimums) into compliance.
for (const el of parsed.elements) {
  const m = minMmFor(el);
  if (el.anchor.w < m.w) el.anchor.w = m.w;
  if (el.anchor.h < m.h) el.anchor.h = m.h;
}
```

- [ ] **Step 3: Type-check**

```bash
docker compose -f docker-compose.dev.yml exec -T web sh -c 'cd /workspace/apps/web && NODE_OPTIONS=--max-old-space-size=4096 ./node_modules/.bin/vue-tsc --noEmit'
echo "exit=$?"
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/stores/designer.ts
git commit -m "feat(store): restore migration clamps anchor.w/h to per-type minimum"
```

---

### Task 12: BarcodeElement — placeholder during resize

**Files:**
- Modify: `packages/template-renderer/src/elements/BarcodeElement.vue`

- [ ] **Step 1: Add `isResizing` prop**

In `BarcodeElement.vue`, expand the `defineProps` to include `isResizing`:

```ts
const props = defineProps<{
  element: Extract<TemplateElement, { type: 'barcode' }>;
  data?: Record<string, unknown>;
  designMode?: boolean;
  isResizing?: boolean;
}>();
```

- [ ] **Step 2: Compute `showPlaceholder`**

Below the existing computed values:

```ts
const showPlaceholder = computed(() => props.isResizing === true);
const isQr = computed(() => props.element.symbology === 'qr');
```

- [ ] **Step 3: Update template — conditional placeholder**

Find the existing `<canvas>` or `<div v-html=...>` rendering the barcode output. Wrap it so a placeholder renders when `showPlaceholder` is true:

```vue
<div class="bc-wrap" :style="wrapStyle">
  <template v-if="!showPlaceholder">
    <!-- existing canvas / svg render -->
  </template>
  <div v-else class="bc-placeholder" :class="{ 'is-qr': isQr }" />
</div>
```

(`wrapStyle` is whatever style was previously on the outer div — width/height/colors. If there is no outer wrapper, add one.)

- [ ] **Step 4: Add placeholder CSS**

In the `<style scoped>` block (create one if absent):

```css
.bc-placeholder {
  width: 100%;
  height: 100%;
  background-color: #fff;
}
.bc-placeholder.is-qr {
  background-image:
    linear-gradient(45deg, #1f1f23 25%, transparent 25%),
    linear-gradient(-45deg, #1f1f23 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, #1f1f23 75%),
    linear-gradient(-45deg, transparent 75%, #1f1f23 75%);
  background-size: 8px 8px;
  background-position: 0 0, 0 4px, 4px -4px, -4px 0;
}
.bc-placeholder:not(.is-qr) {
  background-image: repeating-linear-gradient(
    90deg,
    #1f1f23 0,
    #1f1f23 2px,
    transparent 2px,
    transparent 5px
  );
}
```

- [ ] **Step 5: Type-check**

```bash
docker compose -f docker-compose.dev.yml exec -T web sh -c 'cd /workspace/apps/web && NODE_OPTIONS=--max-old-space-size=4096 ./node_modules/.bin/vue-tsc --noEmit'
echo "exit=$?"
```

- [ ] **Step 6: Commit (placeholder works once CanvasElement passes the prop — Task 13)**

```bash
git add packages/template-renderer/src/elements/BarcodeElement.vue
git commit -m "feat(renderer): BarcodeElement shows CSS placeholder when isResizing"
```

---

### Task 13: CanvasElement — pass `isResizing` to BarcodeElement

**Files:**
- Modify: `apps/web/src/designer/CanvasElement.vue`

- [ ] **Step 1: Update the `<component :is>` invocation**

In the template, find:

```vue
<component :is="elementMap[props.element.type]" :element="props.element" design-mode />
```

Replace with:

```vue
<component
  :is="elementMap[props.element.type]"
  :element="props.element"
  :is-resizing="store.isResizing && isSelected"
  design-mode
/>
```

(`isSelected` is already a computed in the file.)

- [ ] **Step 2: Type-check**

```bash
docker compose -f docker-compose.dev.yml exec -T web sh -c 'cd /workspace/apps/web && NODE_OPTIONS=--max-old-space-size=4096 ./node_modules/.bin/vue-tsc --noEmit'
echo "exit=$?"
```

Other renderer components without `isResizing` in their props will silently ignore the extra attr — that's fine.

- [ ] **Step 3: Browser smoke test**

Drop a QR code. Click to select. Drag a corner. During the drag the QR shows the checkerboard placeholder; on release the real pattern returns.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/designer/CanvasElement.vue
git commit -m "feat(designer): pass isResizing to barcode renderer for placeholder swap"
```

---

### Task 14: ElementGrip — inside-top default + isSmall fallback

**Files:**
- Modify: `apps/web/src/designer/ElementGrip.vue`
- Modify: `apps/web/src/designer/CanvasElement.vue`

- [ ] **Step 1: Rewrite ElementGrip.vue**

Replace the entire content of `apps/web/src/designer/ElementGrip.vue`:

```vue
<script setup lang="ts">
defineProps<{ isSmall?: boolean }>();
defineEmits<{ (e: 'pointerdown', ev: PointerEvent): void }>();
</script>

<template>
  <div
    class="tp-grip"
    :class="{ 'tp-grip--outside': isSmall }"
    @pointerdown.stop="$emit('pointerdown', $event)"
  >
    <span class="tp-grip-dots"><i /><i /><i /><i /><i /><i /></span>
  </div>
</template>

<style scoped>
.tp-grip {
  position: absolute;
  top: 4px;
  left: 50%;
  transform: translateX(-50%);
  cursor: grab;
  z-index: 4;
  padding: 4px 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 5px;
  transition: background 120ms ease;
}
.tp-grip:hover { background: rgba(108, 92, 231, 0.12); }
.tp-grip:active { cursor: grabbing; }

.tp-grip--outside {
  top: -14px;
  background: var(--tp-panel);
  border: 1.5px solid var(--tp-accent);
  border-radius: 8px;
  width: 32px;
  height: 20px;
  box-shadow: var(--tp-accent-shadow);
  padding: 0;
}
.tp-grip--outside:hover { background: var(--tp-accent-bg); }

.tp-grip-dots {
  display: grid;
  grid-template-columns: repeat(3, 3px);
  grid-template-rows: repeat(2, 3px);
  gap: 2.5px;
}
.tp-grip-dots i {
  background: var(--tp-accent);
  border-radius: 50%;
  width: 3px;
  height: 3px;
  display: block;
}
</style>
```

- [ ] **Step 2: Pass `isSmall` from CanvasElement**

In `apps/web/src/designer/CanvasElement.vue`, add the computed in `<script setup>`:

```ts
const isSmall = computed(() => props.element.grid.rs < 6);
```

In the template, update the grip mount:

```vue
<ElementGrip v-if="isSelected" :is-small="isSmall" @pointerdown="onGripDown" />
```

- [ ] **Step 3: Type-check**

```bash
docker compose -f docker-compose.dev.yml exec -T web sh -c 'cd /workspace/apps/web && NODE_OPTIONS=--max-old-space-size=4096 ./node_modules/.bin/vue-tsc --noEmit'
echo "exit=$?"
```

- [ ] **Step 4: Browser smoke test**

Drop a text element (default 40×8 mm → at cell=4 that's ~160×32 px → 32/4 = 8 cells tall, so rs=8 ≥ 6 → inside grip). Verify the 6-dot grip sits inside the top border, no pill. Then shrink the element below 24 px height — the grip should switch to the outside pill.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/designer/ElementGrip.vue apps/web/src/designer/CanvasElement.vue
git commit -m "feat(designer): grip inside top border by default; outside pill for rs<6"
```

---

### Task 15: Final acceptance pass

- [ ] **Step 1: Full vue-tsc + schema tests**

```bash
docker compose -f docker-compose.dev.yml exec -T web sh -c 'cd /workspace/apps/web && NODE_OPTIONS=--max-old-space-size=8192 ./node_modules/.bin/vue-tsc --noEmit'
docker compose -f docker-compose.dev.yml exec -T web sh -c 'cd /workspace/packages/schema && pnpm test'
```

Expected: both green.

- [ ] **Step 2: Walk through the spec acceptance checklist in a browser**

Open `http://localhost:5173/designer/new`. Run each item from the spec's `## Acceptance checklist` section:

1. A4 → GuardPass (90×60mm): paper grows to fill the canvas area; zoom dropdown shows a value above 100% (commonly 400-800%).
2. GuardPass → A3: paper shrinks; zoom dropdown shows under 100%.
3. 🔍 100% works; Fit returns to auto.
4. Preview: content fits without overflow; zoom buttons in preview work.
5. Color picker, font-size, font-weight, text-align, line-height, decoration, bg, vertical-align, z, rotation, opacity, overflow, letter-spacing, font-family — **each visibly applies** to the selected text/field element. Note any that fail.
6. Drag-to-add a 字段 element: appears ≈ 50×8 mm, centered on cursor.
7. Resize 1D barcode west edge inward: stops at 25 mm.
8. Resize text element bottom edge upward: stops at 4 mm.
9. Resize QR: placeholder shows during drag, real pixels return on release.
10. Selection grip: 6-dot icon inside top border on large elements; outside pill on tall < 6 cells.

For any failures, open an issue (do not silently pass).

- [ ] **Step 3: Optional Playwright run**

```bash
docker compose -f docker-compose.dev.yml exec -T web sh -c 'cd /workspace/apps/web && pnpm exec playwright test --reporter=line 2>&1 | tail -20'
```

If iteration-2 playwright tests still pass, good. If they regress on selectors changed by iteration-3, file follow-up but don't gate the iteration on UI test maintenance.

- [ ] **Step 4: Merge feature branch to master (only after user confirms visual acceptance)**

```bash
git checkout master
git pull
git merge --no-ff feature/plan-2-designer -m "Merge iteration 3: view-zoom + style fixes + grip restyle"
git push origin master
```

(Do NOT auto-merge — wait for user confirmation per repo convention.)

- [ ] **Step 5: Tag**

```bash
git tag -a v0.4.0-designer-iter3 -m "Designer iteration 3 complete"
git push origin v0.4.0-designer-iter3
```

---

## Self-Review

Checked against the spec:

1. **§A view zoom** — T1 store state + actions; T2 canvas applies CSS vars + ResizeObserver + fitView; T3 toolbar dropdown; T4 PreviewView. Acceptance items 1–4 ✓.
2. **§B element display + size guards** — T5 styleToCss string-coerce (#1); T6 `:where()` field color (#1); T7 defaultMm + MIN_MM + buildElement signature; T8 callers; T9 resize guard; T10 PropertyPanel min; T11 restore migration. Acceptance items 5–8 ✓.
3. **§C resize perf + grip** — T12 BarcodeElement placeholder; T13 CanvasElement passes prop; T14 ElementGrip restyle + isSmall. Acceptance items 9–10 ✓.

No placeholders; every code block is complete; commit messages, paths, and commands explicit. Type/name consistency: `minMmFor`, `MIN_MM`, `defaultMm`, `view.zoom`, `registerCanvasArea`, `fitView`, `setZoom`, `isResizing`, `isSmall` are used consistently across tasks.
