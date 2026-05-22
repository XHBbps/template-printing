# Designer Iteration 3 — Design Spec

**Date:** 2026-05-22 (after iteration 2 ship)
**Status:** Approved (brainstorming)
**Supersedes (partial):** view-zoom assumptions from iteration 2

This iteration addresses 7 issues raised after iteration 2 ship across three
areas: a view-zoom layer that decouples paper-mm from screen-px, element
display correctness and dimensional guards, and polish to the barcode
resize loop and the selection grip.

The 7 items map to 3 batches:

| Batch | Topic | Items |
|---|---|---|
| § A | View zoom layer | #3 small paper too tiny in editor, #5 preview overflows |
| § B | Element display + size guards | #1 property-panel styles don't apply, #4 new elements too small, #7 missing min size |
| § C | Resize perf + grip restyle | #2 QR resize lag, #6 grip should be inside top border |

---

## § A · View zoom layer (#3 #5)

### A.1 Decouple paper-mm from display-px

Iteration 2 hard-wired `displayPx = paperMm × PX_PER_MM`. With 11 paper
presets ranging from 90×60 mm (出门证) to 297×420 mm (A3), forcing one
constant scale makes the small papers unusable inside the editor area.

This iteration introduces a `view.zoom` factor in the designer store:

```ts
// stores/designer.ts — state additions
view: {
  zoom: number;        // 1.0 = paperPx × 1, applied to CSS vars only
}
```

Render pipeline:

```
paper.mm × PX_PER_MM       = paperPx   // physical pixel size (unchanged)
paperPx × view.zoom        = displayPx // screen pixel size (new)
```

The `--cell-w`, `--cell-h`, `--canvas-w`, `--canvas-h` CSS variables are
all multiplied by `view.zoom` before being written to the canvas element's
inline style. Everything downstream — element `:style="positionStyle"`
which uses `calc(grid.c * var(--cell-w))` — naturally scales.

**Critical invariant**: `anchor.{x,y,w,h}` (mm) and `grid.{c,r,cs,rs}`
(cells) **do not change** with view.zoom. Only the rendered pixel size
changes. mm-anchor accuracy from iteration 2 is preserved.

### A.2 Auto fit-to-view

When `setPaper` runs (or on first mount), compute a fit zoom:

```ts
function computeFitZoom(paperPx: { w: number; h: number }, area: { w: number; h: number }): number {
  const padding = 80; // leave breathing room
  const fitW = (area.w - padding) / paperPx.w;
  const fitH = (area.h - padding) / paperPx.h;
  return clamp(Math.min(fitW, fitH), 0.25, 4.0);
}
```

Triggers:
- On `setPaper(...)`: call `view.zoom = computeFitZoom(...)`.
- On first mount of `DesignerCanvas`: ResizeObserver measures the
  `.tp-canvas-area` and applies fit.
- On window resize: throttled (200ms) recompute.

Cell-size changes do NOT trigger fit — the user's last manual zoom stays.
Paper changes always fit (because the relative size jumps).

### A.3 Zoom control in top toolbar

Add a zoom dropdown between the cell dropdown and the spacer. Markup:

```vue
<ElDropdown trigger="click">
  <button class="tt-btn">🔍 {{ zoomLabel }}</button>
  <template #dropdown>
    <ElDropdownMenu>
      <ElDropdownItem @click="store.fitView()">Fit (自动适配)</ElDropdownItem>
      <ElDropdownItem v-for="z in [0.25, 0.5, 0.75, 1, 1.5, 2, 4]"
        :key="z"
        @click="store.setZoom(z)">
        {{ Math.round(z * 100) }}%
      </ElDropdownItem>
    </ElDropdownMenu>
  </template>
</ElDropdown>
```

`zoomLabel` = `'${Math.round(view.zoom * 100)}%'`.

Store actions:

```ts
setZoom(z: number): void {
  this.view.zoom = clamp(z, 0.25, 4.0);
  // No snapshot — view.zoom is not history-tracked.
},
fitView(): void {
  // Reads canvas-area DOM dimensions via a ref published by DesignerCanvas.
  // If ref unavailable yet, defer one tick.
  ...
}
```

### A.4 PreviewView — same scaling

`apps/web/src/views/PreviewView.vue` mirrors the same pattern:

- Wrapper: `display: flex; align-items: center; justify-content: center; overflow: auto;` with `min-height: 0`.
- The inner `tp-paper` gets `transform: scale(previewZoom); transform-origin: top left;`.
- `previewZoom` computed by `computeFitZoom(paperPx, modalAreaPx)` on
  preview open and on modal resize.
- Bottom-right of the modal: small zoom control (Fit / 50% / 75% / 100% /
  150% / 200%).
- `overflow: auto` provides scrollbar fallback if zoom is forced to >Fit.

### A.5 Persistence

`view.zoom` is **store state, not template state**. It is **not**
included in `template.canvas.*` and **not** persisted to localStorage.
Opening a draft restores other state but always recomputes fit.

---

## § B · Element display + size guards (#1 #4 #7)

### B.1 Investigation + fix for #1 (styles don't apply)

**Root cause candidates**:

1. **`styleToCss` mixes number and string values** for properties Vue
   doesn't always coerce identically (e.g., `fontWeight: 400` vs `'400'`,
   `opacity: 0.8` vs `'0.8'`). Older browsers can drop the property.
2. **The renderer's outer container's CSS computed value for color/font
   never recomputes** because `props.element` may be ref-equality stable
   when the Pinia mutation only changes nested keys — but Pinia v2's deep
   proxy should track this. If for any reason `template.elements[idx] =
   merged` does not break ref-equality on the child's `props.element`,
   the `computed` won't recompute. (Defensive fix: write style updates
   such that the OUTER element reference always changes, not just
   `element.style`.)
3. **scoped `tp-field-design` color** — explicitly overrides the inline
   color in design mode for field elements. Inline style **should** win
   on specificity, but the precedence is fragile if Vue happens to write
   `:style` before the `:class`. Removing the hardcoded color from
   `tp-field-design` and instead using a CSS variable that defers to
   inline color closes this completely.

**Fix in spec terms**:

a) **Rewrite `styleToCss`** to coerce every value to a string explicitly:
   ```ts
   if (s.fontWeight) out.fontWeight = String(s.fontWeight);
   if (s.opacity !== undefined) out.opacity = String(s.opacity);
   if (s.zIndex !== undefined) out.zIndex = String(s.zIndex);
   // fontSize, letterSpacing, lineHeight, rotation already produce strings.
   ```

b) **Strengthen Pinia mutation in `updateElement`** to always replace the
   `style` object reference (currently a shallow `...sel.style` may not
   force a new ref if patch is empty):
   ```ts
   updateElement(id, updates) {
     // existing logic; ensure { ...el.style, ...updates.style } when patch.style is present.
   }
   ```
   (Verified already correct, but call this out as a check item.)

c) **Remove scoped `color: #0969da` from `tp-field-design`**. Instead use
   a marker class without color override:
   ```css
   .tp-field-design::after {
     content: '';   /* visual marker, no color hijacking */
   }
   ```
   Or just keep it but lower specificity via `:where(...)`:
   ```css
   :where(.tp-field-design) { color: #0969da; }
   ```
   `:where()` has specificity 0, so any inline `color` always wins.

d) **Acceptance verification step**: spin up the dev server post-impl and
   walk through each of the 14 style fields manually. Any field that
   doesn't visibly change is a bug; investigate the specific renderer.

### B.2 Default + min sizes (mm-based)

Replace the iteration-2 `defaultGrid: { cs, rs }` (cells) with
`defaultMm: { w, h }` (mm) in `LIBRARY_ITEMS`. Add a parallel `MIN_MM`
constant table that resize handlers consult.

```ts
// apps/web/src/designer/elementFactory.ts

export interface ElementMeta {
  type: TemplateElement['type'];
  glyph: string;
  label: string;
  group: LibraryGroup;
  defaultMm: { w: number; h: number };   // ← new
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
  qr:         { w: 12, h: 12 },     // barcode where symbology === 'qr'
  barcode1d:  { w: 25, h: 8 },      // barcode where symbology !== 'qr'
};

export function minMmFor(el: TemplateElement): { w: number; h: number } {
  if (el.type === 'barcode') return el.symbology === 'qr' ? MIN_MM.qr : MIN_MM.barcode1d;
  return MIN_MM[el.type];
}
```

### B.3 buildElement uses defaultMm

```ts
export function buildElement(
  meta: ElementMeta, newId: string,
  cAnchorMm: { x: number; y: number },  // top-left in mm
  cell: { w: number; h: number },
): TemplateElement {
  const anchor = {
    x: cAnchorMm.x,
    y: cAnchorMm.y,
    w: meta.defaultMm.w,
    h: meta.defaultMm.h,
  };
  const grid = {
    c: Math.round(anchor.x * PX_PER_MM / cell.w),
    r: Math.round(anchor.y * PX_PER_MM / cell.h),
    cs: Math.max(1, Math.round(anchor.w * PX_PER_MM / cell.w)),
    rs: Math.max(1, Math.round(anchor.h * PX_PER_MM / cell.h)),
  };
  // ... rest unchanged
}
```

The old `c=4, r=4, cellW=4, cellH=4` parameter shape is removed.
Callers (`ElementLibrary.clickAdd`, `DesignerCanvas.onDrop`) supply an
`anchorMm`.

### B.4 Drop-to-add positions element center on cursor

In `DesignerCanvas.onDrop`:

```ts
const rect = paperRef.value.getBoundingClientRect();
const cursorMmX = (e.clientX - rect.left) / (PX_PER_MM * store.view.zoom);
const cursorMmY = (e.clientY  - rect.top ) / (PX_PER_MM * store.view.zoom);
const anchorMm = {
  x: clamp(cursorMmX - meta.defaultMm.w / 2, 0, paperMm.w - meta.defaultMm.w),
  y: clamp(cursorMmY - meta.defaultMm.h / 2, 0, paperMm.h - meta.defaultMm.h),
};
const el = buildElement(meta, store.newElementId(), anchorMm, store.template.canvas.cell);
```

Note the `/ (PX_PER_MM * store.view.zoom)` — must account for the §A view
scaling.

### B.5 Resize min-size guard

In `usePointerDrag.ts onResizeDown`, after the per-side cell math but
before `store.resizeElement`:

```ts
const minMm = minMmFor(el);
const minCs = Math.max(1, Math.ceil(minMm.w * PX_PER_MM / cell.w));
const minRs = Math.max(1, Math.ceil(minMm.h * PX_PER_MM / cell.h));

if (newCs < minCs) {
  if (side.includes('w')) newC = startC + startCs - minCs;  // pin right edge
  newCs = minCs;
}
if (newRs < minRs) {
  if (side.includes('n')) newR = startR + startRs - minRs;  // pin bottom edge
  newRs = minRs;
}
```

This also tightens the existing 1D barcode `rs >= 2` guard (now subsumed
by `MIN_MM.barcode1d.h = 8`).

### B.6 PropertyPanel mm input min

PropertyPanel's anchor mm inputs already have `min="0.25"` for `w`/`h`.
Change to `:min` bound dynamically:

```vue
<input ... :min="minMm.w" @input="..." />
```

where `minMm = minMmFor(sel)` computed.

---

## § C · Resize perf + grip restyle (#2 #6)

### C.1 Barcode placeholder during resize

`BarcodeElement.vue` gains a placeholder branch:

```vue
<script setup lang="ts">
// The renderer package can't import the designer store (cross-workspace).
// CanvasElement (which has store access) passes `isResizing` down as a prop.
const props = defineProps<{
  element: Extract<TemplateElement, { type: 'barcode' }>;
  isResizing?: boolean;
}>();

const showPlaceholder = computed(() => props.isResizing === true);
</script>

<template>
  <div class="barcode-wrap" :style="wrapStyle">
    <canvas v-if="!showPlaceholder" ref="canvasRef" />
    <div v-else class="barcode-ph" :class="{ 'is-qr': isQr }" />
  </div>
</template>

<style scoped>
.barcode-ph {
  width: 100%; height: 100%;
  background-color: #fff;
}
.barcode-ph.is-qr {
  background-image:
    linear-gradient(45deg, #1f1f23 25%, transparent 25%),
    linear-gradient(-45deg, #1f1f23 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, #1f1f23 75%),
    linear-gradient(-45deg, transparent 75%, #1f1f23 75%);
  background-size: 6px 6px;
  background-position: 0 0, 0 3px, 3px -3px, -3px 0px;
}
.barcode-ph:not(.is-qr) {
  background-image: repeating-linear-gradient(90deg,
    #1f1f23 0, #1f1f23 2px, transparent 2px, transparent 5px);
}
</style>
```

CanvasElement passes the prop:

```vue
<component
  :is="elementMap[props.element.type]"
  :element="props.element"
  :is-resizing="store.isResizing && isSelected"
  design-mode />
```

When `store.isResizing` flips false on pointerup, the placeholder div is
swapped back to `<canvas>`, and the existing watch triggers a single
bwip-js render. Result: zero per-frame raster work during drag.

This also serves as a fallback for very-low-cell-size templates where
bwip-js would be slow regardless.

### C.2 Grip restyle (Plan A — inside top border, no pill)

Replace `ElementGrip.vue`:

```vue
<script setup lang="ts">
defineEmits<{ (e: 'pointerdown', ev: PointerEvent): void }>();
</script>

<template>
  <div class="tp-grip" @pointerdown.stop="$emit('pointerdown', $event)">
    <span class="tp-grip-dots"><i /><i /><i /><i /><i /><i /></span>
  </div>
</template>

<style scoped>
.tp-grip {
  position: absolute;
  top: 4px;          /* INSIDE the top border, ~4 px below it */
  left: 50%;
  transform: translateX(-50%);
  cursor: grab;
  z-index: 4;
  padding: 4px 6px;  /* expand hit zone to ~20×16 */
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 5px;
  transition: background 120ms ease;
}
.tp-grip:hover { background: rgba(108, 92, 231, 0.12); }
.tp-grip:active { cursor: grabbing; }
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

The `transform: translateX(-50%)` keeps it centered. No outer outline,
border, or shadow — just the dots, with a hover-state pill for affordance.

### C.3 Small-element fallback

When the element's `grid.rs < 6` cells (≈ height ≤ 24 px at cell=4), the
internal grip would overlap the four corner handles and the top edge.
Fallback to the iteration-2 outside-pill style:

```vue
<div class="tp-grip" :class="{ 'tp-grip--outside': isSmall }" ...>
```

```css
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
```

`isSmall` is computed in CanvasElement (where the grip is mounted) and
passed as a prop:

```ts
const isSmall = computed(() => props.element.grid.rs < 6);
```

```vue
<ElementGrip v-if="isSelected" :is-small="isSmall" @pointerdown="onGripDown" />
```

Threshold `rs < 6` was picked from the iteration-2 demo: at 4 px cells
that's 24 px height — below which inside-grip overlaps handles.

---

## Schema impact

None. View zoom is store-only. mm sizes change `LIBRARY_ITEMS`
constants but not schema. Min sizes are runtime guards.

## Migration

None needed. Existing drafts already have `anchor` (from iteration 2).
On restore:

- `view.zoom` defaults to `1.0`, then fit-to-view runs on first mount.
- Existing elements with too-small `anchor.w/h` (created with iteration 2
  defaults) keep their size — the new MIN_MM only applies to future
  edits. Optional: on restore, clamp any anchor below `minMmFor(el)` up
  to the minimum. **Decision**: do this to ensure consistency.

## Out of scope

- User-draggable zoom slider (use dropdown options instead)
- Zoom via Ctrl+wheel (deferred)
- Persisting per-template zoom (intentionally non-persistent)
- Replacing bwip-js (placeholder is sufficient)

## Acceptance checklist

- [ ] Switch from A4 to 出门证 (90×60) — editor area shows paper at
      large enough scale to comfortably edit. Zoom dropdown shows a
      number like 400-800%.
- [ ] Switch from 出门证 back to A3 — fit-to-view reduces zoom to ~50%
      so the paper fits in the viewport.
- [ ] Click toolbar `🔍 ▾` → pick `100%` → paper renders at native px.
      Picking `Fit` returns to auto-fit.
- [ ] Open Preview — content fits without overflow; scroll only when
      zoom is manually set above Fit.
- [ ] Right panel "颜色" picker — color visibly applies to selected text
      element. Same for font-size, font-weight, text-align, line-height,
      decoration, bg, vertical-align, z, rotation, opacity, overflow,
      letter-spacing, font-family.
- [ ] Drag-to-add a 字段 element onto the paper — appears at ~50×8 mm
      (well above iteration-2's 16×3 cells micro-size), centered on
      cursor.
- [ ] Drag the right edge of a 1D barcode inward — stops at 25 mm width.
- [ ] Drag the top edge of a text element down — stops at 4 mm height.
- [ ] Mid-resize on a QR code — the canvas shows a checkerboard
      placeholder; the QR pixels return after pointerup.
- [ ] Selection grip is now a small 6-dot icon inside the top border on
      large elements; outside pill on `rs < 6` elements.
