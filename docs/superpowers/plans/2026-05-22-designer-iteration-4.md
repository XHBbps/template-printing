# Designer Iteration 4 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply iteration-4 (zoom-aware drag math, style rendering completeness, paper preset cleanup + orientation flag + toolbar rotate, barcode blur during resize) to the designer.

**Architecture:** Multiply every screen-pixel → cell conversion by `view.zoom` in `usePointerDrag`. Extend `styleToCss` to emit border/borderRadius + add a `textAlignToJustify` helper; route the helper through text-bearing renderers and adopt the full styleToCss in RectElement/ImageElement. Replace the paper enum with a 6-preset list + a `canvas.orientation` flag that `paperPxSize` honours, plus a `rotate()` store action and toolbar button. Stop swapping the barcode for a CSS placeholder during drag — keep the real canvas mounted, blur it, and skip re-rendering until pointerup; lock bwip-js to a fixed render scale so small barcodes stay visible.

**Tech Stack:** Vue 3 SFC, Pinia, Zod (schema), bwip-js, qrcode-generator. No new dependencies.

**Source spec:** `docs/superpowers/specs/2026-05-22-designer-iteration-4-design.md`

**Conventions in this repo (read before starting):**
- ESLint `import/no-unresolved` doesn't understand workspace package names or `vue` / `pinia` / `zod` under bundler resolution. Existing files use `// eslint-disable-next-line import/no-unresolved` immediately above each such import. Follow that pattern; do not edit `.eslintrc.cjs`.
- Schema package imports use `.js` extension even when the file is `.ts`.
- Dev environment runs in docker. Command template:
  `docker compose -f docker-compose.dev.yml exec -T web sh -c 'cd /workspace/<dir> && <cmd>'`
- Type-check: `NODE_OPTIONS=--max-old-space-size=4096 ./node_modules/.bin/vue-tsc --noEmit` (use 8192 for the final pass).
- Do **not** skip git hooks.

---

## File Structure

### Schema
- **Modify** `packages/schema/src/template.ts`
  - Shrink `PaperPresetSchema` to `A3 / A4 / A5 / A6 / B5 / Letter`.
  - Add `orientation: z.enum(['portrait','landscape']).default('portrait')` to `CanvasSchema`.
  - Export `BorderSide` type (renderer needs it).

- **Modify** `packages/schema/test/template.spec.ts`
  - Adjust the existing PaperSchema test to assert the new 6-entry list.
  - Add a test for `orientation` parsing.

### Renderer
- **Modify** `packages/template-renderer/src/styleToCss.ts`
  - Add `borderSideCss(side)`, append border + borderRadius to `styleToCss`.
  - Add and export `textAlignToJustify`.

- **Modify** `packages/template-renderer/src/elements/TextElement.vue`,
  `FieldElement.vue`, `AutonumberElement.vue`, `SystemElement.vue`
  - In `containerStyle` add `justifyContent: textAlignToJustify(...)`.

- **Modify** `packages/template-renderer/src/elements/RectElement.vue`,
  `ImageElement.vue`
  - Wrap existing render in a `<div :style="containerStyle">` that applies styleToCss.

- **Modify** `packages/template-renderer/src/elements/BarcodeElement.vue`
  - Drop placeholder swap from iteration-3.
  - Add blur via `wrapStyle.filter` when `isResizing`.
  - Watch skips re-render while `isResizing` is true.
  - bwip-js call uses fixed `scale: 3, height: 12` for stable visibility.
  - Outer wrap CSS lets canvas/SVG fit container.

### Store
- **Modify** `apps/web/src/stores/designer.ts`
  - Update `PAPER_PRESETS` to 6 entries.
  - `paperPxSize(paper, orientation)` honours landscape swap.
  - `paperPx` getter passes `template.canvas.orientation`.
  - `defaultTemplate()` returns `paper: 'A4', orientation: 'landscape'`.
  - New `rotate()` action.
  - `restore()` migration for legacy paper values + ensures `orientation` exists.

### Designer
- **Modify** `apps/web/src/designer/usePointerDrag.ts`
  - All `dx / cell.w` / `dy / cell.h` conversions become `/ (cell.w * store.view.zoom)`.
  - residue math: multiply by `cell.w * store.view.zoom`.

- **Modify** `apps/web/src/designer/DesignerHeader.vue`
  - `paperOptions` list reduces to 6.
  - `paperLabelMap` mirrors.
  - `paperLabel` computed appends `横` for landscape.
  - Add `⤴ 旋转` button between cell dropdown and zoom dropdown.

---

## Tasks

### Task 1: Zoom-aware drag/resize math (§A)

**Files:**
- Modify: `apps/web/src/designer/usePointerDrag.ts`

- [ ] **Step 1: Update onGripDown's onUp math**

Open `apps/web/src/designer/usePointerDrag.ts`. Find `onGripDown` → `onUp`. Replace the `dc` / `dr` / `residueX` / `residueY` lines:

```ts
function onUp(): void {
  window.removeEventListener('pointermove', onMove);
  window.removeEventListener('pointerup', onUp);
  const z = store.view.zoom;
  const dc = Math.round(lastDx / (cell.w * z));
  const dr = Math.round(lastDy / (cell.h * z));
  const newC = clamp(startC + dc, 0, store.template.canvas.cols - startCs);
  const newR = clamp(startR + dr, 0, store.template.canvas.rows - startRs);
  const residueX = lastDx - (newC - startC) * cell.w * z;
  const residueY = lastDy - (newR - startR) * cell.h * z;
  dom!.style.transform = `translate(${residueX}px, ${residueY}px)`;
  store.moveElement(elementId, newC, newR);
  requestAnimationFrame(() => {
    dom!.classList.remove('is-pointer-active');
    dom!.style.transform = '';
  });
  store.isResizing = false;
  store.commit();
}
```

- [ ] **Step 2: Update onResizeDown's onMove math**

Find `onResizeDown` → `onMove`. Replace the `dc` / `dr` initial computation:

```ts
function onMove(ev: PointerEvent): void {
  let dcPx = ev.clientX - startX;
  let drPx = ev.clientY - startY;

  // QR 1:1 lock: take the larger axis magnitude, apply to both.
  if (mode === 'qr-lock') {
    const basis = Math.max(Math.abs(dcPx), Math.abs(drPx));
    const sx = dcPx >= 0 ? 1 : -1;
    const sy = drPx >= 0 ? 1 : -1;
    dcPx = sx * basis;
    drPx = sy * basis;
  }

  const z = store.view.zoom;
  let dc = Math.round(dcPx / (cell.w * z));
  let dr = Math.round(drPx / (cell.h * z));

  // For QR force dc === dr (in cell units)
  if (mode === 'qr-lock') {
    const d = Math.max(Math.abs(dc), Math.abs(dr));
    dc = (dc >= 0 ? 1 : -1) * d;
    dr = (dr >= 0 ? 1 : -1) * d;
  }

  // ... existing newC/newR/newCs/newRs clamp + min-mm guard + qr-lock final ...
  // (keep all existing logic from this point on)
}
```

The minMm / min-rs / QR 1:1 final-min blocks below the `dc`/`dr` assignment do not need any change — they operate on the (now zoom-corrected) cell delta values.

- [ ] **Step 3: Type-check**

```bash
docker compose -f docker-compose.dev.yml exec -T web sh -c 'cd /workspace/apps/web && NODE_OPTIONS=--max-old-space-size=4096 ./node_modules/.bin/vue-tsc --noEmit'
echo "exit=$?"
```

Expected: exit 0.

- [ ] **Step 4: Browser smoke**

Open `http://localhost:5173/designer/new` → switch to A6 paper (auto-fit will pick a high zoom). Drop a text element, drag corners and the body. Confirm motion follows the cursor 1:1 without 8x jumps.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/designer/usePointerDrag.ts
git commit -m "fix(designer): usePointerDrag uses view.zoom in screen-px→cell math"
```

---

### Task 2: styleToCss border + borderRadius + textAlignToJustify (§B)

**Files:**
- Modify: `packages/template-renderer/src/styleToCss.ts`
- Modify: `packages/schema/src/index.ts` (only if `BorderSide` is not exported)

- [ ] **Step 1: Verify BorderSide is exported**

```bash
grep -n "BorderSide" packages/schema/src/index.ts packages/schema/src/template.ts
```

If `index.ts` doesn't re-export `BorderSide`, add to `packages/schema/src/index.ts`:

```ts
// eslint-disable-next-line import/no-unresolved
export type { BorderSide } from './template.js';
```

(Or include it in any existing `export type { ... } from './template.js'` line.)

- [ ] **Step 2: Update styleToCss.ts**

Open `packages/template-renderer/src/styleToCss.ts`. After the existing imports, add `BorderSide` to the type import:

```ts
// eslint-disable-next-line import/no-unresolved
import type { BorderSide, ElementStyle } from '@template-printing/schema';
```

Above `styleToCss`, add:

```ts
function borderSideCss(side: BorderSide): string {
  if (!side.show) return 'none';
  return `${side.width}px ${side.style} ${side.color}`;
}
```

Inside `styleToCss`, after the existing `textOverflow` branch and before `return out`, append:

```ts
  if (s.border) {
    out.borderTop    = borderSideCss(s.border.top);
    out.borderRight  = borderSideCss(s.border.right);
    out.borderBottom = borderSideCss(s.border.bottom);
    out.borderLeft   = borderSideCss(s.border.left);
  }
  if (s.borderRadius) out.borderRadius = `${s.borderRadius}px`;
```

- [ ] **Step 3: Add textAlignToJustify export**

Below `verticalAlignToFlex` in the same file:

```ts
export function textAlignToJustify(ta?: ElementStyle['textAlign']): string {
  if (ta === 'left') return 'flex-start';
  if (ta === 'right') return 'flex-end';
  if (ta === 'center') return 'center';
  if (ta === 'justify') return 'space-between';
  return 'flex-start';
}
```

- [ ] **Step 4: Type-check**

```bash
docker compose -f docker-compose.dev.yml exec -T web sh -c 'cd /workspace/apps/web && NODE_OPTIONS=--max-old-space-size=4096 ./node_modules/.bin/vue-tsc --noEmit'
echo "exit=$?"
```

Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add packages/template-renderer/src/styleToCss.ts packages/schema/src/index.ts
git commit -m "feat(renderer): styleToCss emits border/borderRadius; export textAlignToJustify"
```

(If `index.ts` wasn't modified, omit it from `git add`.)

---

### Task 3: Text-bearing renderers — wire `justifyContent` (§B)

**Files:**
- Modify: `packages/template-renderer/src/elements/TextElement.vue`
- Modify: `packages/template-renderer/src/elements/FieldElement.vue`
- Modify: `packages/template-renderer/src/elements/AutonumberElement.vue`
- Modify: `packages/template-renderer/src/elements/SystemElement.vue`

- [ ] **Step 1: TextElement.vue**

Open the file. Update the imports line so it pulls `textAlignToJustify`:

```ts
import { styleToCss, verticalAlignToFlex, textAlignToJustify } from '../styleToCss';
```

In `containerStyle` computed, add `justifyContent`:

```ts
const containerStyle = computed(() => ({
  ...styleToCss(props.element.style),
  display: 'flex',
  alignItems: verticalAlignToFlex(props.element.style.verticalAlign),
  justifyContent: textAlignToJustify(props.element.style.textAlign),
  width: '100%',
  height: '100%',
  padding: `${props.element.style.padding.t}px ${props.element.style.padding.r}px ${props.element.style.padding.b}px ${props.element.style.padding.l}px`,
}));
```

- [ ] **Step 2: FieldElement.vue**

Same edit. Import `textAlignToJustify` and add `justifyContent` to the `containerStyle` object.

- [ ] **Step 3: AutonumberElement.vue**

Same edit.

- [ ] **Step 4: SystemElement.vue**

Same edit.

- [ ] **Step 5: Type-check**

```bash
docker compose -f docker-compose.dev.yml exec -T web sh -c 'cd /workspace/apps/web && NODE_OPTIONS=--max-old-space-size=4096 ./node_modules/.bin/vue-tsc --noEmit'
echo "exit=$?"
```

Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add packages/template-renderer/src/elements/TextElement.vue \
        packages/template-renderer/src/elements/FieldElement.vue \
        packages/template-renderer/src/elements/AutonumberElement.vue \
        packages/template-renderer/src/elements/SystemElement.vue
git commit -m "fix(renderer): text-bearing renderers add justifyContent so textAlign works in flex"
```

---

### Task 4: RectElement adopts styleToCss (§B)

**Files:**
- Modify: `packages/template-renderer/src/elements/RectElement.vue`

- [ ] **Step 1: Read existing file**

```bash
docker compose -f docker-compose.dev.yml exec -T web sh -c 'cat /workspace/packages/template-renderer/src/elements/RectElement.vue'
```

The current implementation is likely a small `<div>` with bare CSS — no styleToCss usage. We're wrapping that markup in a styled container.

- [ ] **Step 2: Replace the file**

```vue
<script setup lang="ts">
// eslint-disable-next-line import/no-unresolved
import type { TemplateElement } from '@template-printing/schema';
import { computed } from 'vue';
import { styleToCss } from '../styleToCss';

const props = defineProps<{
  element: Extract<TemplateElement, { type: 'rect' }>;
  designMode?: boolean;
}>();

const containerStyle = computed(() => ({
  ...styleToCss(props.element.style),
  width: '100%',
  height: '100%',
  boxSizing: 'border-box' as const,
  padding: `${props.element.style.padding.t}px ${props.element.style.padding.r}px ${props.element.style.padding.b}px ${props.element.style.padding.l}px`,
}));
</script>

<template>
  <div :style="containerStyle"></div>
</template>
```

- [ ] **Step 3: Type-check**

```bash
docker compose -f docker-compose.dev.yml exec -T web sh -c 'cd /workspace/apps/web && NODE_OPTIONS=--max-old-space-size=4096 ./node_modules/.bin/vue-tsc --noEmit'
echo "exit=$?"
```

Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add packages/template-renderer/src/elements/RectElement.vue
git commit -m "feat(renderer): RectElement adopts styleToCss for border/bg/radius/opacity"
```

---

### Task 5: ImageElement adopts styleToCss (§B)

**Files:**
- Modify: `packages/template-renderer/src/elements/ImageElement.vue`

- [ ] **Step 1: Read existing file**

```bash
docker compose -f docker-compose.dev.yml exec -T web sh -c 'cat /workspace/packages/template-renderer/src/elements/ImageElement.vue'
```

It renders an `<img>`. We're wrapping it in a styled container; preserving the `<img>` and any existing `fit` logic.

- [ ] **Step 2: Update the file**

If the existing structure looks like:

```vue
<template>
  <img :src="src" :style="imgStyle" />
</template>
```

Wrap in a container:

```vue
<script setup lang="ts">
// eslint-disable-next-line import/no-unresolved
import type { TemplateElement } from '@template-printing/schema';
import { computed } from 'vue';
import { styleToCss } from '../styleToCss';

const props = defineProps<{
  element: Extract<TemplateElement, { type: 'image' }>;
  data?: Record<string, unknown>;
  designMode?: boolean;
}>();

const containerStyle = computed(() => ({
  ...styleToCss(props.element.style),
  width: '100%',
  height: '100%',
  boxSizing: 'border-box' as const,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  overflow: 'hidden',
  padding: `${props.element.style.padding.t}px ${props.element.style.padding.r}px ${props.element.style.padding.b}px ${props.element.style.padding.l}px`,
}));

// PRESERVE existing src resolution and fit logic — copy from current file.
// ... existing src computed, designMode placeholder behavior, etc.
</script>

<template>
  <div :style="containerStyle">
    <img v-if="src" :src="src" :style="{ width: '100%', height: '100%', objectFit }" />
    <div v-else class="img-placeholder" />
  </div>
</template>
```

Carry over whatever existing logic the file had for resolving `src` from `element.source.kind === 'static' | 'field'`, and for `objectFit` from `element.fit`. If the existing file already had `:style="..."` on the `<img>`, move that into the wrapper.

If the existing file has unique design-mode placeholder behavior (e.g., a dashed border for empty URL), keep it as a sibling inside the new container.

- [ ] **Step 3: Type-check**

```bash
docker compose -f docker-compose.dev.yml exec -T web sh -c 'cd /workspace/apps/web && NODE_OPTIONS=--max-old-space-size=4096 ./node_modules/.bin/vue-tsc --noEmit'
echo "exit=$?"
```

Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add packages/template-renderer/src/elements/ImageElement.vue
git commit -m "feat(renderer): ImageElement adopts styleToCss for border/bg/radius"
```

---

### Task 6: Schema — PaperPreset 6 entries + orientation (§C)

**Files:**
- Modify: `packages/schema/src/template.ts`
- Modify: `packages/schema/test/template.spec.ts`

- [ ] **Step 1: Update the failing tests**

In `packages/schema/test/template.spec.ts`, find the existing `describe('expanded PaperSchema', ...)` block. Replace it:

```ts
describe('PaperSchema (iteration 4)', () => {
  it.each(['A3', 'A4', 'A5', 'A6', 'B5', 'Letter'])('accepts preset "%s"', (preset) => {
    expect(PaperSchema.parse(preset)).toBe(preset);
  });

  it('rejects removed presets', () => {
    expect(() => PaperSchema.parse('A4-Landscape')).toThrow();
    expect(() => PaperSchema.parse('GuardPass')).toThrow();
    expect(() => PaperSchema.parse('LogisticLabel')).toThrow();
  });

  it('accepts custom { w_mm, h_mm }', () => {
    expect(PaperSchema.parse({ w_mm: 173, h_mm: 240 })).toMatchObject({ w_mm: 173 });
  });
});

describe('CanvasSchema orientation field', () => {
  it('defaults orientation to portrait', () => {
    const c = CanvasSchema.parse({
      cols: 240, rows: 160,
      cell: { w: 4, h: 4 },
      paper: 'A4',
      background: null,
    });
    expect(c.orientation).toBe('portrait');
  });

  it('accepts landscape', () => {
    const c = CanvasSchema.parse({
      cols: 240, rows: 160,
      cell: { w: 4, h: 4 },
      paper: 'A4',
      orientation: 'landscape',
      background: null,
    });
    expect(c.orientation).toBe('landscape');
  });
});
```

Make sure `CanvasSchema` is included in the named import from `'../src/template.js'` (it may already be — check the top of the file).

- [ ] **Step 2: Run tests (should fail)**

```bash
docker compose -f docker-compose.dev.yml exec -T web sh -c 'cd /workspace/packages/schema && pnpm test 2>&1 | tail -20'
```

Expected: PaperSchema tests fail (it still accepts A4-Landscape etc.) and CanvasSchema orientation tests fail.

- [ ] **Step 3: Update schema**

In `packages/schema/src/template.ts`, find `PaperPresetSchema` and replace:

```ts
export const PaperPresetSchema = z.enum(['A3', 'A4', 'A5', 'A6', 'B5', 'Letter']);
export type PaperPreset = z.infer<typeof PaperPresetSchema>;
```

Find `CanvasSchema` and add the `orientation` field:

```ts
export const CanvasSchema = z.object({
  cols: z.number().int().positive(),
  rows: z.number().int().positive(),
  cell: CellSchema,
  paper: PaperSchema,
  orientation: z.enum(['portrait', 'landscape']).default('portrait'),
  background: z.string().nullable().default(null),
});
```

- [ ] **Step 4: Run tests again**

```bash
docker compose -f docker-compose.dev.yml exec -T web sh -c 'cd /workspace/packages/schema && pnpm test 2>&1 | tail -10'
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add packages/schema/src/template.ts packages/schema/test/template.spec.ts
git commit -m "feat(schema): paper presets shrink to 6 + canvas.orientation flag"
```

---

### Task 7: Store — paperPxSize signature + orientation + rotate (§C)

**Files:**
- Modify: `apps/web/src/stores/designer.ts`

- [ ] **Step 1: Shrink PAPER_PRESETS to 6 entries**

In `apps/web/src/stores/designer.ts`, find the `PAPER_PRESETS` constant. Replace it:

```ts
const PAPER_PRESETS: Record<string, { w_mm: number; h_mm: number }> = {
  A3:     { w_mm: 297, h_mm: 420 },
  A4:     { w_mm: 210, h_mm: 297 },
  A5:     { w_mm: 148, h_mm: 210 },
  A6:     { w_mm: 105, h_mm: 148 },
  B5:     { w_mm: 176, h_mm: 250 },
  Letter: { w_mm: 216, h_mm: 279 },
};
```

- [ ] **Step 2: paperPxSize accepts orientation**

Replace the existing `paperPxSize` function:

```ts
function paperPxSize(
  paper: Template['canvas']['paper'],
  orientation: 'portrait' | 'landscape' = 'portrait',
): { w: number; h: number } {
  let w: number, h: number;
  if (typeof paper === 'string' && paper in PAPER_PRESETS) {
    const p = PAPER_PRESETS[paper];
    w = p.w_mm * PX_PER_MM;
    h = p.h_mm * PX_PER_MM;
  } else if (typeof paper === 'object' && paper !== null && 'w_mm' in paper) {
    w = paper.w_mm * PX_PER_MM;
    h = paper.h_mm * PX_PER_MM;
  } else {
    const p = PAPER_PRESETS.A4;
    w = p.w_mm * PX_PER_MM;
    h = p.h_mm * PX_PER_MM;
  }
  return orientation === 'landscape' ? { w: h, h: w } : { w, h };
}
```

- [ ] **Step 3: defaultTemplate() returns A4 landscape**

Replace `defaultTemplate`:

```ts
export function defaultTemplate(): Template {
  const paper = 'A4';
  const orientation = 'landscape' as const;
  const px = paperPxSize(paper, orientation);
  const opts = divisorsInRange(px.w).filter((d) => divisorsInRange(px.h).includes(d));
  const cellW = opts.includes(4) ? 4 : (opts[0] ?? 1);
  const cellH = cellW;
  return {
    id: makeId('tpl'),
    meta: { name: '未命名模板', description: '', version: 1, tags: [] },
    canvas: {
      cols: px.w / cellW,
      rows: px.h / cellH,
      cell: { w: cellW, h: cellH },
      paper,
      orientation,
      background: null,
    },
    schema: {},
    elements: [],
  };
}
```

- [ ] **Step 4: paperPx getter passes orientation**

Find the `paperPx` getter (in `getters: { ... }`) and replace:

```ts
paperPx: (s): { w: number; h: number } =>
  paperPxSize(s.template.canvas.paper, s.template.canvas.orientation),
```

- [ ] **Step 5: setPaper passes orientation in every paperPxSize call**

The existing `setPaper` action calls `paperPxSize(paper)`. Update to pass the current orientation:

```ts
setPaper(paper: Template['canvas']['paper']): void {
  const orientation = this.template.canvas.orientation;
  const px = paperPxSize(paper, orientation);
  // ... rest of existing setPaper body, BUT every other paperPxSize() call
  // inside the function should also pass orientation.
  // The "Resolve new paper in mm so we can clamp anchors" block needs orientation too:
  let newMm: { w_mm: number; h_mm: number };
  if (typeof paper === 'string' && paper in PAPER_PRESETS) {
    const p = PAPER_PRESETS[paper];
    newMm = orientation === 'landscape'
      ? { w_mm: p.h_mm, h_mm: p.w_mm }
      : { w_mm: p.w_mm, h_mm: p.h_mm };
  } else if (typeof paper === 'object' && paper !== null && 'w_mm' in paper) {
    newMm = orientation === 'landscape'
      ? { w_mm: paper.h_mm, h_mm: paper.w_mm }
      : { w_mm: paper.w_mm, h_mm: paper.h_mm };
  } else {
    const p = PAPER_PRESETS.A4;
    newMm = orientation === 'landscape'
      ? { w_mm: p.h_mm, h_mm: p.w_mm }
      : { w_mm: p.w_mm, h_mm: p.h_mm };
  }
  // ... continue with the existing clamp loop and snapshot + fitView calls
}
```

The rest of the function (clamp loop, set canvas fields, recompute grid, snapshot, fitView) stays intact.

- [ ] **Step 6: setCellSize uses paperPx getter**

In `setCellSize`, the existing `const px = paperPxSize(this.template.canvas.paper);` becomes:

```ts
const px = paperPxSize(this.template.canvas.paper, this.template.canvas.orientation);
```

(Or simpler: replace with `const px = this.paperPx;` since the getter already does this.)

- [ ] **Step 7: Add rotate action**

In `actions`, add (next to `setPaper`):

```ts
rotate(): void {
  this.template.canvas.orientation =
    this.template.canvas.orientation === 'portrait' ? 'landscape' : 'portrait';
  // Re-run setPaper to refresh cell candidates, clamp out-of-bound elements,
  // recompute grid, snapshot, and fit-to-view.
  this.setPaper(this.template.canvas.paper);
},
```

- [ ] **Step 8: Type-check**

```bash
docker compose -f docker-compose.dev.yml exec -T web sh -c 'cd /workspace/apps/web && NODE_OPTIONS=--max-old-space-size=4096 ./node_modules/.bin/vue-tsc --noEmit'
echo "exit=$?"
```

Expected: exit 0.

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/stores/designer.ts
git commit -m "feat(store): paperPxSize honours orientation; PAPER_PRESETS=6; rotate() action"
```

---

### Task 8: Store — restore migration for legacy paper values (§C)

**Files:**
- Modify: `apps/web/src/stores/designer.ts`

- [ ] **Step 1: Insert legacy paper migration in restore()**

In the `restore()` action body, AFTER the existing `const parsed = JSON.parse(raw) as Template;` line but BEFORE the anchor-derivation loop (Step 1 of the existing 3-step migration), insert:

```ts
// Iteration-4: migrate legacy paper enum values + ensure orientation exists.
const legacyPaperMap: Record<
  string,
  { paper: Template['canvas']['paper']; orientation: 'portrait' | 'landscape' }
> = {
  'A3-Landscape':  { paper: 'A3', orientation: 'landscape' },
  'A4-Landscape':  { paper: 'A4', orientation: 'landscape' },
  'A5-Landscape':  { paper: 'A5', orientation: 'landscape' },
  GuardPass:       { paper: { w_mm: 90,  h_mm: 60  }, orientation: 'portrait' },
  LogisticLabel:   { paper: { w_mm: 100, h_mm: 180 }, orientation: 'portrait' },
};
if (typeof parsed.canvas.paper === 'string' && parsed.canvas.paper in legacyPaperMap) {
  const m = legacyPaperMap[parsed.canvas.paper as string];
  parsed.canvas.paper = m.paper;
  parsed.canvas.orientation = m.orientation;
}
if (!parsed.canvas.orientation) parsed.canvas.orientation = 'portrait';
```

- [ ] **Step 2: Update every paperPxSize call in restore() to pass orientation**

Find the `const px = paperPxSize(parsed.canvas.paper);` line later in `restore()`. Replace with:

```ts
const px = paperPxSize(parsed.canvas.paper, parsed.canvas.orientation);
```

- [ ] **Step 3: Type-check**

```bash
docker compose -f docker-compose.dev.yml exec -T web sh -c 'cd /workspace/apps/web && NODE_OPTIONS=--max-old-space-size=4096 ./node_modules/.bin/vue-tsc --noEmit'
echo "exit=$?"
```

Expected: exit 0.

- [ ] **Step 4: Manual smoke (optional)**

In browser DevTools → Application → Local Storage → set `tp_designer_draft` to a JSON string that includes `"paper": "A4-Landscape"`. Reload the designer. Confirm the canvas opens at A4 landscape, no schema parse error.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/stores/designer.ts
git commit -m "feat(store): restore migrates legacy paper enums + ensures orientation"
```

---

### Task 9: DesignerHeader — paper list shrink + rotate button (§C)

**Files:**
- Modify: `apps/web/src/designer/DesignerHeader.vue`

- [ ] **Step 1: Shrink paperOptions**

In `<script setup>` of `apps/web/src/designer/DesignerHeader.vue`, find:

```ts
const paperOptions = [
  'A3', 'A3-Landscape',
  'A4', 'A4-Landscape',
  ...
] as const;
```

Replace with:

```ts
const paperOptions = ['A3', 'A4', 'A5', 'A6', 'B5', 'Letter'] as const;
```

- [ ] **Step 2: Trim paperLabelMap**

Find the `paperLabelMap` constant. Replace with:

```ts
const paperLabelMap: Record<string, string> = {
  A3: 'A3',
  A4: 'A4',
  A5: 'A5',
  A6: 'A6',
  B5: 'B5',
  Letter: 'Letter',
};
```

- [ ] **Step 3: Update paperLabel computed for orientation suffix**

Find `paperLabel` computed and replace:

```ts
const paperLabel = computed(() => {
  const p = store.template.canvas.paper;
  const o = store.template.canvas.orientation;
  if (typeof p === 'string') {
    return o === 'landscape' ? `${paperLabelMap[p]} 横` : (paperLabelMap[p] ?? p);
  }
  const dim = `${p.w_mm}×${p.h_mm}mm`;
  return o === 'landscape' ? `${dim} 横` : dim;
});
```

- [ ] **Step 4: Add rotate button**

In `<template>` find the cell dropdown (`<ElDropdown trigger="click"> <button class="tt-btn">⊞ {{ cellLabel }}</button> ...`). Immediately after that `</ElDropdown>`, insert:

```vue
<button class="tt-btn" title="旋转 90°" @click="store.rotate()">⤴</button>
```

(The existing zoom dropdown follows after this button.)

- [ ] **Step 5: Type-check**

```bash
docker compose -f docker-compose.dev.yml exec -T web sh -c 'cd /workspace/apps/web && NODE_OPTIONS=--max-old-space-size=4096 ./node_modules/.bin/vue-tsc --noEmit'
echo "exit=$?"
```

Expected: exit 0.

- [ ] **Step 6: Browser smoke**

Open `/designer/new`. Paper dropdown shows exactly 6 entries + `⊕ 自定义…`. The `⤴` button toggles A4 ↔ A4 横 with auto-fit.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/designer/DesignerHeader.vue
git commit -m "feat(designer): header paper list shrinks to 6 + ⤴ rotate button"
```

---

### Task 10: BarcodeElement — blur + skip re-render + fixed scale (§D)

**Files:**
- Modify: `packages/template-renderer/src/elements/BarcodeElement.vue`

- [ ] **Step 1: Read existing file**

```bash
docker compose -f docker-compose.dev.yml exec -T web sh -c 'cat /workspace/packages/template-renderer/src/elements/BarcodeElement.vue'
```

Note the existing render function name (commonly `renderBarcode` or inline `watch` callback), the current `bwipjs.toCanvas` options, and the iteration-3 placeholder structure.

- [ ] **Step 2: Remove placeholder swap from template**

Find:

```vue
<template v-if="!showPlaceholder">
  <!-- canvas / svg render -->
</template>
<div v-else class="bc-placeholder" :class="{ 'is-qr': isQr }" />
```

Replace with just the unconditional render path (whatever was inside the `v-if="!showPlaceholder"` block):

```vue
<div class="bc-wrap" :style="wrapStyle">
  <!-- existing canvas/SVG render(s) — keep both QR (v-html svg) and 1D (canvas) paths -->
</div>
```

- [ ] **Step 3: Update wrapStyle to apply blur during resize**

Replace (or create) the `wrapStyle` computed:

```ts
const wrapStyle = computed(() => ({
  width: '100%',
  height: '100%',
  position: 'relative' as const,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  filter: props.isResizing ? 'blur(2px) opacity(0.55)' : 'none',
  transition: 'filter 120ms ease',
}));
```

- [ ] **Step 4: Update watch to skip re-render while isResizing**

Find the existing watch that triggers `renderBarcode()` (or inline render code). Replace it with:

```ts
watch(
  () => ({
    grid: props.element.grid,
    sym: props.element.symbology,
    content: props.element.content,
    binding: props.element.binding,
    ecc: props.element.eccLevel,
    fg: props.element.foregroundColor,
    bg: props.element.backgroundColor,
    qz: props.element.quietZone,
    showText: props.element.showText,
    tpos: props.element.textPosition,
    tfs: props.element.textFontSize,
    isResizing: props.isResizing,
  }),
  (next) => {
    if (next.isResizing) return;
    renderBarcode();
  },
  { deep: true, immediate: true },
);
```

The `immediate: true` ensures the first render happens on mount.

If the existing code uses `onMounted(() => renderBarcode())` rather than `immediate: true`, replace the onMounted with the immediate-watch and remove the onMounted.

- [ ] **Step 5: Use fixed scale in bwip-js call**

Inside `renderBarcode()` (or the inline `bwipjs.toCanvas(...)` call), change the options object so 1D barcodes always render at a fixed high resolution:

```ts
bwipjs.toCanvas(canvasRef.value, {
  bcid: props.element.symbology,
  text: contentText.value,                              // existing variable
  scale: 3,
  height: 12,
  includetext: props.element.showText ?? false,
  textxalign: 'center',
  paddingwidth: props.element.quietZone ?? 4,
  textgaps: 2,
  textsize: props.element.textFontSize ?? 10,
  textyoffset: props.element.textPosition === 'top'
    ? -(props.element.textFontSize ?? 10) - 2
    : 0,
  barcolor: (props.element.foregroundColor ?? '#000000').replace('#', ''),
  backgroundcolor: (props.element.backgroundColor ?? '#ffffff').replace('#', ''),
  textcolor: (props.element.foregroundColor ?? '#000000').replace('#', ''),
});
```

For the QR path (`qrcode-generator`), use a fixed cell size:

```ts
// QR path
const ecc = (props.element.eccLevel ?? 'M') as 'L' | 'M' | 'Q' | 'H';
const qr = qrcode(0, ecc);
qr.addData(contentText.value);
qr.make();
const cellSize = 4;          // fixed high resolution
const margin = props.element.quietZone ?? 2;
qrSvg.value = qr.createSvgTag({ cellSize, margin });
```

If the existing code constructs the SVG differently, preserve its semantics but lock the per-cell pixel size to 4 so output is consistent.

- [ ] **Step 6: Update CSS to fit canvas to wrap**

In the `<style scoped>` block, REMOVE these iteration-3 rules:

```css
.bc-placeholder { ... }
.bc-placeholder.is-qr { ... }
.bc-placeholder:not(.is-qr) { ... }
```

ADD:

```css
.bc-wrap :deep(canvas),
.bc-wrap canvas,
.bc-wrap :deep(svg),
.bc-wrap svg {
  max-width: 100%;
  max-height: 100%;
  width: auto;
  height: auto;
}
```

- [ ] **Step 7: Remove now-unused computeds**

Delete the iteration-3 additions if they exist:

```ts
const showPlaceholder = computed(() => props.isResizing === true);
const isQr = computed(() => props.element.symbology === 'qr');
```

(Keep `isQr` only if it's used elsewhere in the template — likely not after the placeholder is removed. Verify by grepping the template for `isQr`.)

- [ ] **Step 8: Type-check**

```bash
docker compose -f docker-compose.dev.yml exec -T web sh -c 'cd /workspace/apps/web && NODE_OPTIONS=--max-old-space-size=4096 ./node_modules/.bin/vue-tsc --noEmit'
echo "exit=$?"
```

Expected: exit 0.

- [ ] **Step 9: Browser smoke**

Drop a 1D barcode → confirm bars + text are visible regardless of element size. Drop a QR → confirm visible. Drag the SE corner of either — confirm the real rendering stays visible but blurred during the drag, sharp after release.

- [ ] **Step 10: Commit**

```bash
git add packages/template-renderer/src/elements/BarcodeElement.vue
git commit -m "feat(renderer): BarcodeElement keeps real render, blurs during resize, fixed bwip-js scale"
```

---

### Task 11: Final acceptance pass

- [ ] **Step 1: Full vue-tsc + schema tests**

```bash
docker compose -f docker-compose.dev.yml exec -T web sh -c 'cd /workspace/apps/web && NODE_OPTIONS=--max-old-space-size=8192 ./node_modules/.bin/vue-tsc --noEmit'
docker compose -f docker-compose.dev.yml exec -T web sh -c 'cd /workspace/packages/schema && pnpm test'
```

Expected: both green.

- [ ] **Step 2: Walk the spec acceptance checklist in a browser**

Open `http://localhost:5173/designer/new`. Run each item from the spec's `## Acceptance checklist` section:

1. Resize a corner on a small paper (A6) — element follows cursor 1:1 (no 8x jitter).
2. Move an element — final position is under the cursor.
3. Set border on top + bottom in BorderControl → both edges paint.
4. Set text-align center → text horizontally centers.
5. Drop a rect → set border / borderRadius → both visible.
6. Drop an image → set border → visible around the image.
7. Paper dropdown lists exactly: A3, A4, A5, A6, B5, Letter, 自定义….
8. Click ⤴ → A4 portrait ↔ A4 landscape; canvas re-fits.
9. Open an iteration-3 draft that used "A4-Landscape" — opens rendered as A4 landscape; no jump.
10. Drop a 1D barcode at default size — barcode visible.
11. Drag the QR's SE handle — QR stays visible but blurred during drag, sharp on release.

- [ ] **Step 3: Don't merge — wait for user confirmation**

Per repo convention, only the user merges to master. Report status to the user with the full commit list since iteration-3.

---

## Self-Review

Checked against the spec:

1. **§A drag/resize zoom math** — Task 1 covers both onGripDown→onUp and onResizeDown→onMove with explicit `* store.view.zoom` in dc/dr/residue math. Acceptance items 1–2 ✓.
2. **§B style rendering** — Task 2 (border + borderRadius + textAlignToJustify in styleToCss), Task 3 (4 text renderers add justifyContent), Task 4 (RectElement), Task 5 (ImageElement). Acceptance items 3–6 ✓.
3. **§C paper cleanup + rotation** — Task 6 (schema), Task 7 (store paperPxSize + rotate), Task 8 (restore migration), Task 9 (header). Acceptance items 7–9 ✓.
4. **§D barcode blur + fixed scale** — Task 10. Acceptance items 10–11 ✓.

No placeholders; every step has concrete code blocks. Type/name consistency: `paperPxSize(paper, orientation)`, `rotate()`, `textAlignToJustify`, `borderSideCss`, `legacyPaperMap`, `view.zoom`, `isResizing` are used consistently across tasks.
