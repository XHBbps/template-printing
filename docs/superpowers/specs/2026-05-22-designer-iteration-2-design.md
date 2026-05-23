# Designer Iteration 2 — Design Spec

**Date:** 2026-05-22
**Status:** Approved (brainstorming)
**Supersedes (partial):** parts of `2026-05-21-template-printing-platform-design.md`

This iteration tightens the designer that landed in Plan 2. It addresses 14
issues raised by the user after the first round of usability testing,
spanning canvas/cell mechanics, element styling depth, data field
expansion (including image uploads), and several UI cleanups.

The 14 issues are mapped to the six design sections below. Each section
contains the final agreed design; alternatives that were considered but
rejected are noted only where the rationale is non-obvious.

---

## § 1 · Canvas ↔ Cell ↔ Element 联动（#3 #4 #13 #14）

### 1.1 Paper presets

Extend `PAPER_PRESETS` from 4 to 11:

| Name | mm |
|---|---|
| `A3` / `A3-Landscape` | 297×420 / 420×297 |
| `A4` / `A4-Landscape` | 210×297 / 297×210 |
| `A5` / `A5-Landscape` | 148×210 / 210×148 |
| `A6` | 105×148 |
| `B5` | 176×250 |
| `Letter` | 216×279 |
| `出门证` | 90×60 |
| `物流面单` | 100×180 |

Plus `Custom` which opens a dialog (see 1.2). Even-number restriction from
iteration 1 is **removed** — any integer mm is allowed.

`PX_PER_MM = 4` stays constant; canvas pixel size always equals
`paper.w_mm × 4` by `paper.h_mm × 4`. cell options derive from the
common divisors of those two pixel values.

### 1.2 Custom paper dialog

```
┌─ 自定义画布 ───────────────────┐
│  宽 [173] mm   高 [240] mm    │
│  ──────────────────────────── │
│  画布像素：692 × 960          │
│  可选 cell：2px, 4px (仅 2 个) │
│  ⚠ 173 是质数，cell 选项受限   │
│  建议改为 172 或 174 mm        │
│  ──────────────────────────── │
│  [取消]  [确定]                │
└─────────────────────────────────┘
```

**Validation rules:**

- Each side `∈ [30, 600]` integer mm
- Aspect ratio `≤ 5:1` either direction (rejects 177×1 etc.)
- If common divisors in `[2, 40]` is empty, allow fallback to `cell=1px`
  but show a red warning suggesting nearby high-composite values
- Live preview of valid cell options updates on every keystroke

### 1.3 Square cell lock (#13)

Schema continues to store `cell: { w, h }`, but the UI only lets the user
pick a single `size`. Writes set `w = h = size`. DesignerHeader's cell
dropdown displays `"4 px (300×210 格)"` instead of `"4×4 px"`.

Options are the intersection of divisors of `paperPxW` and `paperPxH` in
range `[2, 40]`, plus optional `1` fallback.

### 1.4 mm-anchor — minimal-drift cell rescaling (#4, #14 core)

**Schema addition.** Every element gets a new field carrying the ground-
truth position in paper-absolute millimetres:

```ts
// On every TemplateElement (all 8 type variants in the discriminated union):
anchor: { x: number; y: number; w: number; h: number };  // mm
```

`grid: { c, r, cs, rs }` keeps the same shape but is now a **derived**
field that the store recomputes whenever cell size changes:

```ts
grid.c  = Math.round(anchor.x * PX_PER_MM / cell.w);
grid.r  = Math.round(anchor.y * PX_PER_MM / cell.h);
grid.cs = Math.max(1, Math.round(anchor.w * PX_PER_MM / cell.w));
grid.rs = Math.max(1, Math.round(anchor.h * PX_PER_MM / cell.h));
```

**Write paths.** Three places update `anchor`:

1. **Drag / resize pointerup.** Convert final px delta to mm via
   `dmm = dpx / PX_PER_MM`, write to `anchor`, recompute `grid`.
2. **PropertyPanel input.** Inputs are bound directly to `anchor.*` (see
   1.5). Write triggers `grid` recompute.
3. **Cell-size change.** `anchor` is left untouched; `grid` is recomputed
   for every element with the new cell size.

**Drift analysis.**

- Per single cell change: `≤ 0.5 × cell.w` px snap error (`≈ 0.125 mm`
  at `cell=1`, `≈ 5 mm` at `cell=40`)
- Per N changes: **no accumulation** — every recompute starts from the
  same `anchor`, so error is bounded, not cumulative
- Drag → resize → drag round-trip returns to the original anchor exactly
  (within 1 px of cursor)

**Paper-size change.** Same algorithm; `anchor` stays put, `grid`
recomputes against new paper-derived `cell` options. Out-of-bound
elements are clamped (in this order):

```ts
anchor.w = min(anchor.w, paper.w_mm);                 // shrink if too wide
anchor.h = min(anchor.h, paper.h_mm);                 // shrink if too tall
anchor.x = clamp(anchor.x, 0, paper.w_mm - anchor.w); // slide back inside
anchor.y = clamp(anchor.y, 0, paper.h_mm - anchor.h);
```

If any clamping occurs, show a one-time toast ("3 个元素已自动移入新画布").

### 1.5 Inputs in mm, not cells (correction of iteration 1)

PropertyPanel position/size inputs are bound to `anchor.x / y / w / h`
(mm), step `0.25 mm` (one minimum-cell unit). Display format `30.0`
with two decimals max. Cell size changes do **not** change the input
values, because mm is a physical absolute unit.

A secondary muted badge next to each input pair shows the cell-grid
equivalent: `"≈ 30 × 18 格 @ cell=4px"`.

```
位置  [列] 30.0 mm    [行] 18.5 mm     ≈ 30 × 18 格
尺寸  [宽] 24.0 mm    [高] 6.0  mm     ≈ 24 × 6 格
```

Snapping behaviour during drag continues to use cell-grid quantisation
(that's a UX choice, not a storage choice). On pointerup the snapped px
position is converted to mm and written to `anchor`.

---

## § 2 · 元素库 + 画布元素列表（#1 #2）

### 2.1 ElementLibrary categorisation (#2)

Three groups, each with a small uppercase section title:

| 分组 | 包含 |
|---|---|
| **文字** | 文字 / 字段 / 编号 / 系统变量 |
| **图形** | 矩形 / 图片 |
| **数据** | 明细表格 / 二维码 / 条码 |

Visual: group titles re-use the existing `tp-sub-title` style (uppercase
letter-spaced 11px), separated by 8 px vertical gap. Inside each group,
2-column button grid (current layout).

### 2.2 CanvasElementsList pagination + delete (#1)

```
┌─ 画布元素 · 共 23 个 ─────────────┐
│  ▦ table · items          [×]    │ ← hover 出现 ×
│  T text · 出门证                  │
│  {} field · employeeName         │
│  ...                              │
├──────────────────────────────────┤
│        ‹ 1 / 3 ›   每页 10        │ ← sticky 底部
└──────────────────────────────────┘
```

- Page size fixed at 10. Pagination footer renders only when `count > 10`.
- Delete button (`×`) `opacity: 0`, becomes `1` on row hover. Click
  deletes without confirmation (undo via Ctrl-Z covers misclicks).
- Selecting an element via PropertyPanel that's on a different page
  auto-flips to that page.
- List order = `template.elements[]` order (creation order; later
  z-index changes may reorder).

---

## § 3 · 元素拖拽与缩放（#5）

### 3.1 QR (`symbology === 'qr'`): lock 1:1

- HitZones renders only 4 corner handles (no `n/e/s/w` edges)
- On corner drag, lock to 1:1. Algorithm (taking `nw` as example):
  ```ts
  // Pick the larger axis-delta as the basis; the smaller one is
  // re-derived so both axes change by the same amount.
  const basis = Math.max(Math.abs(dxPx), Math.abs(dyPx));
  const signX = dxPx >= 0 ? 1 : -1;
  const signY = dyPx >= 0 ? 1 : -1;
  // For nw corner: positive delta shrinks both width & height.
  // For other corners, flip signs accordingly.
  const adjustedDx = signX * basis;
  const adjustedDy = signY * basis;
  ```
- Default new-element grid: `cs === rs` (already enforced by current
  library defaults; double-check)

### 3.2 1D barcode: free w/h with min-height guard

- HitZones renders all 8 handles
- No aspect lock; user can stretch independently
- Minimum height clamp: `rs >= 2` cells (lower would be unscannable). 
  Resize handler refuses smaller, the size badge stays at `rs=2`.

### 3.3 Live ratio hint in size badge

While dragging a QR, `tp-size-badge` shows `"28×28 格 (1:1)"`. The
`(1:1)` suffix makes it obvious the lock is intentional, not a bug. 1D
barcode shows the normal `"30×8 格"` with no suffix.

---

## § 4 · 元素样式控制（#6 #7 #8）

### 4.1 Border control redesign (#6)

Two-layer control:

1. **Per-side toggles** (top): 4 directional buttons (上 / 右 / 下 / 左)
   that flip `border[side].show` independently — this part stays.
2. **Global style** (bottom): three controls that apply to **all sides
   with `show=true` at once**:
   - **Line style** — 3 icon buttons: solid `—`, dashed `- -`, dotted `• •`
   - **Width** — slider, range `1 — 8 px`, step `1`, current value
     displayed alongside
   - **Color** — color picker, default `#1F1F23`

```
边框：[上] · [右] · [下] · [左]    ← per-side show toggle
─────────────────────────────
线型   [—] [- -] [• •]
粗细   ●─────────  2 px
颜色   ◼ #1F1F23
```

Writing logic: when `style.border` is mutated, `style.border[side].style /
width / color` is mirrored across all four sides. The `show` flag stays
independent. This collapses the schema's per-side detail into a single
visual control surface while keeping the schema unchanged (for forward
compatibility).

### 4.2 Text / content style — full table

Add the following to `ElementStyle` (applied to text-rendering element
types: `text`, `field`, `autonumber`, `system`, `table` cells):

| Field | Type | Default | Notes |
|---|---|---|---|
| `color` | hex | `#1F1F23` | Text color (was missing) |
| `fontFamily` | enum `sans` \| `serif` \| `mono` | `sans` | No custom-font upload in this plan |
| `fontSize` | number (px) | `14` | |
| `fontWeight` | enum `400` \| `500` \| `600` \| `700` | `400` | |
| `letterSpacing` | number (px) | `0` | |
| `lineHeight` | number (multiplier) | `1.4` | |
| `textDecoration` | enum `none` \| `underline` \| `overline` \| `line-through` | `none` | |
| `backgroundColor` | hex with alpha | `transparent` | |
| `textAlign` | enum `left` \| `center` \| `right` \| `justify` \| `default` | `default` | `default` = no CSS set, inherits |
| `verticalAlign` | enum `top` \| `middle` \| `bottom` | `middle` | |
| `zIndex` | number | `0` | |
| `rotation` | number (deg) | `0` | For e-signatures / watermarks |
| `opacity` | number `[0, 1]` | `1` | For watermarks |
| `textOverflow` | enum `clip` \| `ellipsis` \| `wrap` | `wrap` | Strategy when bound value exceeds box |

**PropertyPanel layout.** A new "样式" collapsible group with two
sub-sections: "基础" (color/fontSize/fontWeight/textAlign always
visible) and "高级" (rest, collapsed by default).

### 4.3 QR controls (#8 QR part)

`BarcodeElement` gains these QR-specific fields (validated only when
`symbology === 'qr'`):

| Field | Options | Default |
|---|---|---|
| `eccLevel` | `L` \| `M` \| `Q` \| `H` | `M` |
| `foregroundColor` | hex | `#000` |
| `backgroundColor` | hex with alpha | `#fff` |
| `quietZone` | number (cell) `[0, 8]` | `2` |

### 4.4 1D barcode controls (#8 1D part)

| Field | Options | Default |
|---|---|---|
| `symbology` | `code128` \| `ean13` \| `ean8` \| `code39` \| `upc-a` \| `itf14` | `code128` |
| `showText` | bool | `true` |
| `textPosition` | `top` \| `bottom` | `bottom` |
| `textFontSize` | number (px) | `10` |
| `foregroundColor` | hex | `#000` |
| `backgroundColor` | hex with alpha | `#fff` |
| `quietZone` | number (px) | `4` |

`bwip-js` supports all of these; the renderer just passes them through
in `bwip.toCanvas()` / `bwip.toSVG()` options.

---

## § 5 · 数据字段扩充 + 图片上传管线（#9）

### 5.1 Expanded `FieldDefSchema`

`FieldDefSchema` becomes a discriminated union by `type`:

| `type` | New? | P0 status | Extra fields |
|---|---|---|---|
| `string` | existing | P0 | `maxLength?` |
| `number` | existing | P0 | `min?`, `max?`, `thousands?` |
| `date` | existing | P0 | `format?` (default `YYYY-MM-DD`) |
| `array` | existing | P0 | `itemSchema?` (for table binding) |
| `datetime` | new | **P0** | `format?` (default `YYYY-MM-DD HH:mm`) |
| `boolean` | new | **P0** | `trueLabel='是'`, `falseLabel='否'` |
| `enum` | new | **P0** | `options: { value, label }[]` |
| `image` | new | **P0** | `accept?: string[]` (mime allowlist) |
| `currency` | new | P1 | `symbol='¥'`, `precision=2` |
| `url` | new | P2 | |
| `phone` | new | P2 | |

P0 items ship in this plan. P1/P2 are deferred.

### 5.2 Image upload pipeline (P0)

Required because most templates need a static company logo, and the
existing static URL input is impractical for users without a hosting URL.

**Format support.**

| Format | Use case | Processing |
|---|---|---|
| **SVG** | Logos, stamps, signatures | Sanitise XSS vectors, normalise viewBox |
| **PNG** | Bitmaps with alpha | Re-encode via `sharp`, strip metadata, DPI warning |
| **JPG** | Photos | Re-encode via `sharp`, strip EXIF |

**Backend endpoint.**

```
POST /api/uploads/image    (multipart/form-data)
Auth: JWT cookie + CSRF
Body: file (≤ 5 MB)
Pipeline:
  1. Read magic bytes via file-type → reject if not in allowlist
  2. SVG: sanitize-html with SVG profile → strip <script>, <foreignObject>,
     on* event attributes, external href refs
  3. PNG/JPG: sharp re-encode → strips EXIF & metadata, normalises color
     space; reads DPI, returns warning if < 200
  4. Compute sha256 of cleaned content → filename = <hash>.<ext>
  5. Write to <storage_root>/uploads/<hash>.<ext>
  6. Return { url: "/uploads/<hash>.<ext>", w_px, h_px, format, dpiWarning? }
Response 200: { url, w_px, h_px, format, dpiWarning? }
Response 4xx: { error: 'too_large' | 'mime_mismatch' | 'svg_unsafe' | ... }
```

**Storage.** MVP uses an api-container volume mounted at
`/storage/uploads/`. Nest's `ServeStaticModule` serves `/uploads/*`. Plan 6
will migrate this to OSS/S3 when deploying.

**Frontend.** ImageElement's property panel gets a three-way source
picker:

```
图片来源：  ( ) 上传    ( ) URL    ( ) 绑定字段
            ↓
[ 拖入文件或点击选择 ]   ← 上传模式时显示
```

Selecting "上传" opens the OS file picker, uploads on confirm, then
writes `source = { kind: 'static', url: <returned url> }`. Progress
indicator inline. On error, show the API's error message inline.

### 5.3 FieldManager dialog enhancements

When the user picks `type: 'enum'`, the dialog shows a sub-list editor
for `options[]` (one row per option, each with `value` + `label` inputs
and an `×` to remove; add-row button at bottom).

When the user picks `type: 'image'`, the dialog shows an optional
`accept` selector (checkboxes for `svg`, `png`, `jpg`; default all on).

When the user picks `type: 'boolean'`, the dialog shows inputs for
`trueLabel` / `falseLabel`.

---

## § 6 · UI 细节修整（#10 #11 #12）

### 6.1 Remove template avatar (#10)

DesignerView left panel's `.tp-panel-head` drops `.tp-avatar` entirely.
Layout becomes a single column with `tp-head-title` (template name) on
top and `tp-head-sub` (`v1 · 草稿已保存`) below, both left-aligned.
Saves ~40 px of horizontal space so the template name displays fully.

### 6.2 Remove meaningless hints (#11)

| Location | Original | New |
|---|---|---|
| `ElementLibrary` `tp-sub-head` | `添加新元素 · 点击或拖入` | `添加新元素` |
| `BorderControl` title | `边框 · 点方向切换显隐` | `边框` |
| Anything else found during impl | — | strip |

Tooltip on each library button retains `"点击或拖入：文字"` for users
who hover.

### 6.3 Top toolbar — wider, looser, grouped (#12)

`.tp-top-toolbar` CSS changes:

| Property | Before | After |
|---|---|---|
| `display` | `inline-flex` | `flex` |
| `min-width` | (auto) | `720px` |
| `max-width` | `calc(100% - 28px)` | `calc(100% - 80px)` |
| `padding` | `5px` | `6px 10px` |
| `gap` | `2px` | `6px` |
| `.tt-btn padding` | `0 12px` | `0 14px` |
| `.tt-divider height` | `18px` | `20px` |
| `.tt-divider margin` | `0 4px` | `0 8px` |

Visual grouping (left to right, dividers between groups):

```
[← 返回]  │  [↶] [↷]  │  [📄 纸张] [⊞ Cell] [⊕ 自定义画布]   ... [👁 预览] [💾 保存] [🖨 立即打印]
   1            2                    3                                       4
```

A `flex: 1` spacer between group 3 and group 4 pushes the action buttons
to the right edge of the pill.

If viewport width drops below the toolbar's natural width, group 4 (`预
览 / 保存 / 打印`) collapses into a single `⋯` overflow menu. Groups
1–3 are always visible.

---

## Schema migration

### New element fields

```ts
// Every TemplateElement variant
anchor: { x: number; y: number; w: number; h: number };  // mm

// ElementStyle (text-bearing types)
color?: string;
fontFamily?: 'sans' | 'serif' | 'mono';
fontSize?: number;
fontWeight?: 400 | 500 | 600 | 700;
letterSpacing?: number;
lineHeight?: number;
textDecoration?: 'none' | 'underline' | 'overline' | 'line-through';
backgroundColor?: string;
textAlign?: 'left' | 'center' | 'right' | 'justify' | 'default';
verticalAlign?: 'top' | 'middle' | 'bottom';
zIndex?: number;
rotation?: number;
opacity?: number;
textOverflow?: 'clip' | 'ellipsis' | 'wrap';

// BarcodeElement
eccLevel?: 'L' | 'M' | 'Q' | 'H';            // qr only
foregroundColor?: string;
backgroundColor?: string;
quietZone?: number;
textPosition?: 'top' | 'bottom';             // 1d only
textFontSize?: number;                        // 1d only
symbology now includes: code128 | ean13 | ean8 | code39 | upc-a | itf14 | qr
```

### Migration of existing drafts

`useDesignerStore.restore()` runs migration in this strict order to
avoid double-snapping:

```ts
// Step 1 — Derive anchor from grid + OLD cell (preserves visual pos)
for (const el of parsed.elements) {
  if (!el.anchor) {
    const oldCell = parsed.canvas.cell;
    el.anchor = {
      x: el.grid.c  * oldCell.w / PX_PER_MM,
      y: el.grid.r  * oldCell.h / PX_PER_MM,
      w: el.grid.cs * oldCell.w / PX_PER_MM,
      h: el.grid.rs * oldCell.h / PX_PER_MM,
    };
  }
}

// Step 2 — Existing logic: snap cell to a valid divisor of new paper
// (already implemented in iteration 1 restore())

// Step 3 — Recompute grid for every element from anchor + new cell
for (const el of parsed.elements) {
  recomputeGridFromAnchor(el, parsed.canvas.cell);
}

// Style fields: keep undefined; renderers treat undefined as "use default"
```

Existing iteration 1 drafts continue to work; on first interaction
they're upgraded in place.

---

## Out of scope (explicit non-goals)

- Custom font upload — requires server-side font management; default to
  3 system stacks (`sans`/`serif`/`mono`)
- AI rasterise→vector or background removal — quality not reliable enough
- Multi-page templates — Plan 3 territory
- P1/P2 field types (currency, url, phone) — listed for future plans
- OSS/S3 storage — Plan 6 (deployment)
- Auto-vectorising raster logos — manual conversion only

---

## Acceptance checklist

The implementation is done when:

- [ ] All 11 paper presets + custom dialog work, with cell options
      filtered to common divisors and warning for prime/extreme inputs
- [ ] Changing cell size or paper preserves every element's mm position
      (drift ≤ 0.5 × new_cell px, no cumulative drift over N changes)
- [ ] Square-cell display shows `"4 px (300×210 格)"` not `"4×4 px"`
- [ ] Position/size inputs are in mm with cell-equivalent badge
- [ ] ElementLibrary shows 3 grouped sections; pagination on element
      list activates at 10+ elements with hover-to-delete
- [ ] QR resize locks 1:1; 1D barcode resizes freely (min rs=2)
- [ ] BorderControl: per-side show toggle + global style/width/color
      with slider widget
- [ ] All 14 text-style fields applied through PropertyPanel "基础"
      and "高级" subgroups
- [ ] QR ECC/colors/quiet zone + 1D barcode type/text-pos/font/colors
      all wired through to bwip-js
- [ ] P0 field types (datetime, boolean, enum, image) ship with
      dialog editors
- [ ] `POST /uploads/image` accepts SVG/PNG/JPG, sanitises and
      re-encodes, returns served URL
- [ ] ImageElement source picker offers 上传 / URL / 绑定字段
- [ ] Avatar gone, all redundant hints stripped, toolbar widened and
      grouped, overflow menu falls in below 720px
- [ ] Existing iteration 1 drafts open and auto-migrate to anchor schema
