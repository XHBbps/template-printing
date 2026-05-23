# Designer Iteration 4 — Design Spec

**Date:** 2026-05-22 (after iteration 3 ship)
**Status:** Approved (brainstorming)

This iteration fixes five issues that surfaced after iteration 3:

| Batch | Topic | Items |
|---|---|---|
| § A | Drag/resize zoom bug | #2 resize jitter at high zoom, #3 move drift |
| § B | Style rendering gaps | #1 borders / text-align / borderRadius not applied; Rect/Image renderers don't consume styleToCss |
| § C | Paper preset cleanup + rotation | #4 simplify to A3/A4/A5/A6/B5/Letter + orientation flag + toolbar rotate button |
| § D | Barcode/QR rendering during drag | #5 stop swapping to placeholder; blur the real render + skip re-render during resize; fix 1D barcode "invisible at small sizes" |

---

## § A · Drag/resize zoom-aware math (#2 #3)

### Root cause

`apps/web/src/designer/usePointerDrag.ts` converts screen pixel deltas
to cells using the un-zoomed `cell.w`/`cell.h`:

```ts
const dc = Math.round(lastDx / cell.w);  // ❌ ignores store.view.zoom
```

At `view.zoom = 8` (typical for a 90×60mm paper auto-fit), one rendered
cell on-screen is `4 × 8 = 32 px`, but the math treats `32 / 4 = 8`
cells. The element jumps eight cells per visible cell of cursor motion.
This affects every screen-px → cell conversion in the file: drag/move
delta, drag/move residue, every resize-side delta.

### Fix

Every screen-pixel-to-cell conversion in `usePointerDrag.ts` multiplies
`cell.w`/`cell.h` by `store.view.zoom` before dividing. Concrete edits:

**onGripDown → onUp:**
```ts
const dc = Math.round(lastDx / (cell.w * store.view.zoom));
const dr = Math.round(lastDy / (cell.h * store.view.zoom));
const newC = clamp(startC + dc, 0, store.template.canvas.cols - startCs);
const newR = clamp(startR + dr, 0, store.template.canvas.rows - startRs);
const residueX = lastDx - (newC - startC) * cell.w * store.view.zoom;
const residueY = lastDy - (newR - startR) * cell.h * store.view.zoom;
```

**onResizeDown → onMove (the two `dc = Math.round(dcPx / cell.w)` lines):**
```ts
let dc = Math.round(dcPx / (cell.w * store.view.zoom));
let dr = Math.round(drPx / (cell.h * store.view.zoom));
```

The minCs / minRs / QR 1:1 lock / 1D rs≥2 guards remain unchanged — they
operate on the (already-zoom-corrected) `dc`/`dr` values.

### Acceptance

- At any paper preset (A3 through A6 through custom small) and any zoom,
  dragging a corner produces exactly one cell of resize per cursor cell
  of screen motion.
- Moving an element ends with the element under the cursor (not several
  cells away).

---

## § B · Style rendering completeness (#1)

### Root causes

1. **Border CSS is never emitted.** `style.border.{top|right|bottom|left}`
   is written to the schema by BorderControl, but `styleToCss` returns
   no `border*` properties — the renderer's inline `:style` lacks any
   border rules. The element shows no border regardless of state.
2. **textAlign doesn't apply in a flex container.** The renderer's
   container is `display: flex`. `textAlign: 'center'` on a flex
   container does not horizontally center direct text/flex-items.
3. **borderRadius is never emitted.** Schema has the field; styleToCss
   drops it.
4. **RectElement and ImageElement don't consume styleToCss at all.**
   They were untouched by iteration-2 Task 25 (which only rewrote the
   six text-bearing renderers).

### Fix

**B.1 — Border emission in styleToCss**

Append to `packages/template-renderer/src/styleToCss.ts`:

```ts
import type { BorderSide, ElementStyle } from '@template-printing/schema';

function borderSideCss(side: BorderSide): string {
  if (!side.show) return 'none';
  return `${side.width}px ${side.style} ${side.color}`;
}

export function styleToCss(s: ElementStyle): Record<string, string> {
  const out: Record<string, string> = {};
  // ... existing fields ...
  if (s.border) {
    out.borderTop    = borderSideCss(s.border.top);
    out.borderRight  = borderSideCss(s.border.right);
    out.borderBottom = borderSideCss(s.border.bottom);
    out.borderLeft   = borderSideCss(s.border.left);
  }
  if (s.borderRadius) out.borderRadius = `${s.borderRadius}px`;
  return out;
}
```

(`BorderSide` may need to be exported from the schema package's index;
if not already, add it: `export type { BorderSide } from './template.js';`.)

**B.2 — textAlign → justify-content mapping in renderers**

Add a helper:

```ts
// In styleToCss.ts
export function textAlignToJustify(ta?: string): string {
  if (ta === 'left') return 'flex-start';
  if (ta === 'right') return 'flex-end';
  if (ta === 'center') return 'center';
  if (ta === 'justify') return 'space-between';
  return 'flex-start';
}
```

In each text-bearing renderer (TextElement, FieldElement,
AutonumberElement, SystemElement), update `containerStyle`:

```ts
const containerStyle = computed(() => ({
  ...styleToCss(props.element.style),
  display: 'flex',
  alignItems: verticalAlignToFlex(props.element.style.verticalAlign),
  justifyContent: textAlignToJustify(props.element.style.textAlign),
  width: '100%',
  height: '100%',
  padding: `${pad.t}px ${pad.r}px ${pad.b}px ${pad.l}px`,
}));
```

(The `textAlign` value from styleToCss is harmless inside flex; the new
`justifyContent` is what actually horizontally aligns the content.)

**B.3 — RectElement and ImageElement adopt styleToCss**

For both `packages/template-renderer/src/elements/RectElement.vue` and
`ImageElement.vue`:

- Import `styleToCss` and `verticalAlignToFlex` (rect doesn't need the
  latter; image uses it for content positioning).
- Wrap existing content in a `<div :style="containerStyle">` where
  containerStyle includes `styleToCss(props.element.style)`, padding,
  width/height 100%, and `box-sizing: border-box`.
- Don't change rect's rendering semantics or image's `<img>` element —
  just wrap them in the styled container so border + borderRadius +
  background + opacity etc apply.

Example for RectElement:

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

ImageElement keeps its `<img>` inside the container, preserving existing
fit logic.

### Acceptance

- Toggle a border side in BorderControl → that side immediately shows on
  the selected element (with the configured width/style/color).
- Change textAlign center/right/justify → text horizontally aligns
  inside the element.
- Set borderRadius via inline edit (or via future UI) → corners round.
- Drop a rect or image → set border → border appears.

---

## § C · Paper preset cleanup + rotation (#4)

### Schema

`packages/schema/src/template.ts`:

```ts
export const PaperPresetSchema = z.enum(['A3', 'A4', 'A5', 'A6', 'B5', 'Letter']);
export type PaperPreset = z.infer<typeof PaperPresetSchema>;

export const PaperSchema = z.union([
  PaperPresetSchema,
  z.object({ w_mm: z.number().positive(), h_mm: z.number().positive() }),
]);

export const CanvasSchema = z.object({
  cols: z.number().int().positive(),
  rows: z.number().int().positive(),
  cell: CellSchema,
  paper: PaperSchema,
  orientation: z.enum(['portrait', 'landscape']).default('portrait'),  // ← new
  background: z.string().nullable().default(null),
});
```

The `-Landscape`, `GuardPass`, `LogisticLabel` enum members are removed.

### Store

`paperPxSize` becomes orientation-aware:

```ts
// Old
function paperPxSize(paper): { w, h } {
  if (typeof paper === 'string' && paper in PAPER_PRESETS) {
    const p = PAPER_PRESETS[paper];
    return { w: p.w_mm * PX_PER_MM, h: p.h_mm * PX_PER_MM };
  }
  // ... custom
}

// New
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
    const p = PAPER_PRESETS['A4'];
    w = p.w_mm * PX_PER_MM;
    h = p.h_mm * PX_PER_MM;
  }
  return orientation === 'landscape' ? { w: h, h: w } : { w, h };
}
```

Update `PAPER_PRESETS` constant in the store to the 6-preset list:

```ts
const PAPER_PRESETS = {
  A3:     { w_mm: 297, h_mm: 420 },
  A4:     { w_mm: 210, h_mm: 297 },
  A5:     { w_mm: 148, h_mm: 210 },
  A6:     { w_mm: 105, h_mm: 148 },
  B5:     { w_mm: 176, h_mm: 250 },
  Letter: { w_mm: 216, h_mm: 279 },
};
```

Every caller of `paperPxSize` (`restore`, `setPaper`, `setCellSize`,
`defaultTemplate`, the `paperPx` getter, `DesignerCanvas.cssVars` via
the getter, `DesignerCanvas.onDrop`, `CustomPaperDialog`) passes
`this.template.canvas.orientation` (or the appropriate value).

`defaultTemplate()` becomes:

```ts
export function defaultTemplate(): Template {
  return {
    id: makeId('tpl'),
    meta: { ... },
    canvas: {
      cols: 297 * PX_PER_MM / 4,
      rows: 210 * PX_PER_MM / 4,
      cell: { w: 4, h: 4 },
      paper: 'A4',
      orientation: 'landscape',     // ← preserves "A4 横向" as default
      background: null,
    },
    schema: {},
    elements: [],
  };
}
```

(Landscape A4 is the natural design surface for most receipt/pass
templates; we keep that as the default by flipping orientation.)

`paperPx` getter:

```ts
paperPx: (s) => paperPxSize(s.template.canvas.paper, s.template.canvas.orientation),
```

### New action `rotate()` in store

```ts
rotate(): void {
  this.template.canvas.orientation =
    this.template.canvas.orientation === 'portrait' ? 'landscape' : 'portrait';
  // setPaper re-runs cell snap + clamp + grid recompute + fitView.
  // Pass the existing paper through so the side effects run.
  this.setPaper(this.template.canvas.paper);
},
```

### Migration in `restore()`

Existing iteration 1-3 drafts may have legacy paper values. Before the
existing migration pipeline runs:

```ts
// Iteration-4 paper migration
const legacyPaperMap: Record<string, { paper: Template['canvas']['paper']; orientation: 'portrait' | 'landscape' }> = {
  'A3-Landscape':   { paper: 'A3', orientation: 'landscape' },
  'A4-Landscape':   { paper: 'A4', orientation: 'landscape' },
  'A5-Landscape':   { paper: 'A5', orientation: 'landscape' },
  GuardPass:        { paper: { w_mm: 90,  h_mm: 60  }, orientation: 'portrait' },
  LogisticLabel:    { paper: { w_mm: 100, h_mm: 180 }, orientation: 'portrait' },
};
if (typeof parsed.canvas.paper === 'string' && parsed.canvas.paper in legacyPaperMap) {
  const m = legacyPaperMap[parsed.canvas.paper as string];
  parsed.canvas.paper = m.paper;
  parsed.canvas.orientation = m.orientation;
}
if (!parsed.canvas.orientation) parsed.canvas.orientation = 'portrait';
```

### DesignerHeader paper dropdown

`paperOptions` shrinks to 6 entries (`A3`, `A4`, `A5`, `A6`, `B5`,
`Letter`). `paperLabelMap` drops the `-Landscape`, GuardPass,
LogisticLabel entries.

`paperLabel` computed shows orientation suffix:

```ts
const paperLabel = computed(() => {
  const p = store.template.canvas.paper;
  const o = store.template.canvas.orientation;
  if (typeof p === 'string') {
    return o === 'landscape' ? `${paperLabelMap[p]} 横` : paperLabelMap[p];
  }
  const dim = `${p.w_mm}×${p.h_mm}mm`;
  return o === 'landscape' ? `${dim} 横` : dim;
});
```

### Toolbar rotate button

Between the cell dropdown and the zoom dropdown:

```vue
<button class="tt-btn" title="旋转 90°" @click="store.rotate()">⤴</button>
```

### Acceptance

- Paper dropdown contains exactly 6 presets + 自定义…; no Landscape/出门证/物流面单 entries.
- Clicking ⤴ rotation swaps portrait/landscape and immediately fits the
  rotated paper to the canvas area.
- Existing iteration-3 drafts with `paper: 'A4-Landscape'` open as
  `paper: 'A4', orientation: 'landscape'` (visual identical to before).
- All elements stay inside the paper after rotation
  (`clampAnchorToPaper` handles out-of-bounds).

---

## § D · Barcode/QR rendering during drag (#5)

### Root cause

Iteration-3 introduced a placeholder swap (CSS checkerboard for QR,
vertical bars for 1D) while `isResizing`. Two problems:

1. The 1D placeholder is `repeating-linear-gradient(90deg, 0, 2px,
   transparent, 5px)` — at small element pixel widths it compresses into
   a dense unrecognizable smear.
2. The "QR" placeholder is a 4-direction `linear-gradient` checkerboard
   that looks nothing like a real QR — visual noise.
3. Independent issue: 1D barcodes are sometimes **invisible when not
   dragging** at small element sizes. bwip-js renders the canvas at an
   internal resolution proportional to element pixel size; when the
   element shrinks below ~80 px wide, bwip's "scale: 2" default produces
   a canvas under the visible threshold, or CSS doesn't fit it.

### Fix — drop placeholder, blur the real canvas

`packages/template-renderer/src/elements/BarcodeElement.vue`:

**1. Always mount the real render** (canvas for 1D, SVG `v-html` for QR).
Remove the `<template v-if="!showPlaceholder">` / `<div v-else
class="bc-placeholder">` swap from iteration-3.

**2. Apply blur on wrap when isResizing:**

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

**3. Skip re-rendering during isResizing:**

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
  (next, prev) => {
    if (next.isResizing) return;            // skip during drag
    // (covers both: first render on mount, and the post-drag final render)
    renderBarcode();
  },
  { deep: true, immediate: true },
);
```

After pointerup, `isResizing` flips false, the watch fires once, and
the canvas re-renders at the final size with the blur fading off via
transition.

**4. Fix "invisible at small sizes" — fixed render scale + CSS fit**

For 1D barcode (bwip-js):

```ts
bwipjs.toCanvas(canvasRef.value, {
  bcid: props.element.symbology,
  text: contentText,
  scale: 3,                            // fixed 3x (was: variable / unset)
  height: 12,                          // mm — bwip-js internal unit
  includetext: props.element.showText ?? false,
  paddingwidth: props.element.quietZone ?? 4,
  textsize: props.element.textFontSize ?? 10,
  textyoffset: props.element.textPosition === 'top'
    ? -(props.element.textFontSize ?? 10) - 2
    : 0,
  barcolor: (props.element.foregroundColor ?? '#000000').replace('#', ''),
  backgroundcolor: (props.element.backgroundColor ?? '#ffffff').replace('#', ''),
  textcolor: (props.element.foregroundColor ?? '#000000').replace('#', ''),
});
```

For QR (qrcode-generator): pass a fixed `cellSize` (e.g., 4 or 6) so the
SVG output is consistently sized regardless of element pixel size.

CSS lets the rendered canvas/SVG fit the element box:

```css
.bc-wrap canvas,
.bc-wrap :deep(svg) {
  max-width: 100%;
  max-height: 100%;
  width: auto;
  height: auto;
}
```

### Cleanup

Remove the iteration-3 additions to BarcodeElement.vue:
- `showPlaceholder` and `isQr` computeds (the new watch uses
  `props.isResizing` directly; the QR detection moves into the render
  function).
- `.bc-placeholder`, `.bc-placeholder.is-qr`, `.bc-placeholder:not(.is-qr)`
  CSS rules.

### Acceptance

- Drop a 1D barcode on a small paper — barcode is visible (clear bars +
  optional text label), regardless of element pixel size.
- During corner drag — the real barcode/QR stays visible but blurred,
  no checkerboard / striped placeholder.
- Release the drag — blur fades off, barcode re-renders at the final
  size.

---

## Out of scope

- A custom barcode rendering library (we stay with bwip-js +
  qrcode-generator).
- The PropertyPanel border-radius UI control (schema field exists; UI
  not requested this iteration).
- Persisted per-template orientation badge in the canvas elements list.

## Acceptance checklist

- [ ] Resize a corner on a small paper (A6 or smaller after Fit) — the
      element follows the cursor 1:1 (no jumpy 8x jitter).
- [ ] Move an element — final position is under the cursor at any zoom.
- [ ] Set border on top + bottom in BorderControl → both edges paint.
- [ ] Set text-align center → text horizontally centers in the element.
- [ ] Drop a rect → set border / borderRadius → both visible.
- [ ] Drop an image → set border → visible around the image.
- [ ] Paper dropdown lists exactly: A3, A4, A5, A6, B5, Letter, 自定义….
- [ ] Click ⤴ → A4 portrait ↔ A4 landscape; canvas re-fits.
- [ ] Open an iteration-3 draft that used "A4-Landscape" — opens
      rendered as A4 landscape; no visual jump.
- [ ] Drop a 1D barcode at default size — barcode visible (not blank).
- [ ] Drag the QR's SE handle — QR stays visible but blurred during
      drag, sharp again on release.
