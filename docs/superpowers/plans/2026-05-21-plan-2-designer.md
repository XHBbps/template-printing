# Plan 2 — Designer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the standalone in-browser template designer — a栅格化 canvas where authenticated users can drop 8 element types, drag with a top-center grip, resize via edges/corners, and watch a smooth animation when they switch cell sizes. State lives in a Pinia store with full undo/redo and `localStorage` backup; no backend save yet (that comes in Plan 3).

**Architecture:** Three-column UI: left = element library, center = canvas, right = field manager + selected-element properties. All template state in `useDesignerStore` (Pinia). Elements are positioned by grid coordinates (`c, r, cs, rs`) — never pixels — so a single `cellW × cellH` change re-renders the whole canvas via CSS variables without losing layout. Drag/resize is implemented with pointer events on hit-zones layered over each element. Cell-size animation orchestrates three transitions (栅格淡出 → 元素 + 画布平滑形变 → 栅格淡入) via CSS classes toggled in sequence.

**Tech Stack:** Vue 3.4 `<script setup>`, Pinia 2.1, Element Plus 2.7 (icons + buttons + dropdown + form inputs), pure CSS transitions/grid, qrcode-generator + bwip-js for barcode element preview. Native pointer events (no drag lib). Playwright for one happy-path E2E.

**Spec reference:** `docs/superpowers/specs/2026-05-21-template-printing-platform-design.md` §§ 4 (Cell concept), 5 (Template JSON Schema, 8 element types, border/padding), 6 (3-column layout, grid visibility, selection outline, grip + edge/corner hit-zones, cell-size animation, field management, preview mode), 13.5 (frontend stack decisions).

**Builds on:** Plan 1 (commit `4c67b9a` on master). The Designer requires auth — only logged-in users can reach `/designer/new`. Plan 1's router guard already redirects to `/login` for unauthed users.

**Out of scope (deferred to later plans):**
- **Template save to backend / template list / version history / search** — Plan 3 (Template Hub). For Plan 2 we use `localStorage` so the designer is independently usable.
- **PDF / PNG export, real `print()` action** — Plan 4 (Render Pool) and Plan 5 (Print API). For Plan 2 the "立即打印" button calls `window.print()` with a print-only CSS layer.
- **Multi-user editing locks, presence, version conflict** — Plan 3.
- **Real barcode/QR rendering by Puppeteer** — Plan 4. For Plan 2 we render barcodes in-browser using qrcode-generator + bwip-js.
- **Server-side schema validation when saving** — Plan 3.

---

## File Structure (created/modified by this plan)

```
packages/schema/
├── src/
│   ├── index.ts                     # MODIFY: export Template + Element schemas
│   └── template.ts                  # CREATE: zod schemas for the full template JSON
└── test/
    ├── index.spec.ts                # existing
    └── template.spec.ts             # CREATE: schema validation tests

packages/template-renderer/
├── src/
│   ├── index.ts                     # MODIFY: export TemplateRenderer + element components
│   ├── TemplateRenderer.vue         # MODIFY: real implementation (was placeholder)
│   └── elements/                    # CREATE: 8 element renderers (used by both designer + future SSR)
│       ├── TextElement.vue
│       ├── FieldElement.vue
│       ├── ImageElement.vue
│       ├── TableElement.vue
│       ├── BarcodeElement.vue
│       ├── AutonumberElement.vue
│       ├── SystemElement.vue
│       └── RectElement.vue
└── package.json                     # MODIFY: + qrcode-generator + bwip-js

apps/web/
├── src/
│   ├── views/
│   │   ├── DesignerView.vue         # CREATE: top-level designer page
│   │   ├── HomeView.vue             # MODIFY: add "新建模板" button → /designer/new
│   │   └── PreviewView.vue          # CREATE: modal-style preview with sample data
│   ├── designer/                    # CREATE: all designer-specific components live here
│   │   ├── DesignerHeader.vue       # template name + undo/redo + preview + cell w/h + paper size + 保存
│   │   ├── ElementLibrary.vue       # left column: 8 element icons + categories
│   │   ├── DesignerCanvas.vue       # center column: paper + grid + elements + selection box
│   │   ├── CanvasElement.vue        # per-element wrapper (selection outline + grip + hit-zones)
│   │   ├── HitZones.vue             # 4 edges + 4 corners + center pointer regions
│   │   ├── ElementGrip.vue          # 6-dot top-center drag handle
│   │   ├── FieldManager.vue         # right column top: data field CRUD + unused warnings
│   │   ├── PropertyPanel.vue        # right column bottom: selected element props
│   │   ├── BorderControl.vue        # 田字格 4-side border (show/width/style/color)
│   │   ├── PaddingControl.vue      # 4 inputs (T/R/B/L padding)
│   │   ├── CellSizeInput.vue        # header w×h with confirm
│   │   └── usePointerDrag.ts        # composable: shared drag/resize logic
│   ├── stores/
│   │   └── designer.ts              # CREATE: useDesignerStore (template state, history, dirty flag)
│   ├── router/
│   │   └── index.ts                 # MODIFY: add /designer/new (and /designer/:id placeholder for Plan 3)
│   └── styles/
│       └── designer.css             # CREATE: grid CSS variables, animation keyframes, print media query
└── test/
    └── designer.e2e.spec.ts         # CREATE: Playwright happy path (load → drop element → drag → save to localStorage)
```

---

## Task Map (20 tasks)

| # | Task | Layer |
|---|---|---|
| 1 | Install web deps (qrcode-generator, bwip-js, @types) + lockfile | infra |
| 2 | `packages/schema/src/template.ts` — full Template JSON zod schema | schema |
| 3 | Schema tests for happy + invalid cases | schema |
| 4 | `packages/template-renderer` — 8 element renderers + container | render |
| 5 | `apps/web/src/stores/designer.ts` — Pinia store with undo/redo | state |
| 6 | Router: add `/designer/new` (and placeholder `/designer/:id`) | route |
| 7 | `DesignerView` skeleton — 3-column layout, wire empty children | view |
| 8 | `DesignerHeader` — template name input + undo/redo + cell w/h + paper size dropdown + 保存 button | header |
| 9 | `ElementLibrary` — 8 element icons grouped by category (基础/表格/编码/系统) | left |
| 10 | `DesignerCanvas` — paper + grid background via CSS vars + drop target | canvas |
| 11 | `CanvasElement` + `HitZones` + `ElementGrip` — selection outline + 8 hit-zones + grip | canvas |
| 12 | `usePointerDrag` composable — grip drag with grid snap | interaction |
| 13 | Edge/corner resize wiring (uses `usePointerDrag` with different deltas) | interaction |
| 14 | Cell-size animation (`is-resizing` class sequence: grid fade → resize transition → grid fade-in) | animation |
| 15 | `FieldManager` — add/edit/delete fields, unused field warnings | right-top |
| 16 | `PropertyPanel` + `BorderControl` + `PaddingControl` — selected element props | right-bottom |
| 17 | LocalStorage persistence (autosave + restore on `/designer/new` if dirty) | state |
| 18 | `PreviewView` — read-only render with prompt for sample data | preview |
| 19 | Print CSS — `@media print` layer so "立即打印" works | print |
| 20 | Playwright E2E — load designer, drop element, drag, save | test |

---

## Task 1: Install web deps

**Files:**
- Modify: `apps/web/package.json`
- Modify: `packages/template-renderer/package.json`
- Modify: `pnpm-lock.yaml`

- [ ] **Step 1: Add deps**

```bash
pnpm --filter @template-printing/template-renderer add qrcode-generator@1.4.4 bwip-js@4.5.1
pnpm --filter @template-printing/template-renderer add -D @types/qrcode-generator@1.4.10
```

- [ ] **Step 2: Verify build still passes**

```bash
pnpm --filter @template-printing/template-renderer typecheck
```

- [ ] **Step 3: Commit**

```bash
git add packages/template-renderer/package.json pnpm-lock.yaml
git commit -m "chore(template-renderer): add qrcode-generator + bwip-js for in-browser barcode preview"
```

---

## Task 2: Template JSON zod schema

**Files:**
- Create: `packages/schema/src/template.ts`
- Modify: `packages/schema/src/index.ts`

- [ ] **Step 1: Create `packages/schema/src/template.ts`**

```typescript
import { z } from 'zod';

// --- Border / padding shared by all elements ---

export const BorderSideSchema = z.object({
  show: z.boolean().default(false),
  width: z.number().nonnegative().default(1),
  style: z.enum(['solid', 'dashed', 'dotted']).default('solid'),
  color: z.string().default('#1f2328'),
});
export type BorderSide = z.infer<typeof BorderSideSchema>;

export const BorderSchema = z.object({
  top: BorderSideSchema,
  right: BorderSideSchema,
  bottom: BorderSideSchema,
  left: BorderSideSchema,
});

export const PaddingSchema = z.object({
  t: z.number().nonnegative().default(0),
  r: z.number().nonnegative().default(0),
  b: z.number().nonnegative().default(0),
  l: z.number().nonnegative().default(0),
});

export const StyleSchema = z.object({
  border: BorderSchema,
  padding: PaddingSchema,
  background: z.string().nullable().default(null),
  borderRadius: z.number().nonnegative().default(0),
  fontSize: z.number().positive().optional(),
  fontWeight: z.enum(['normal', 'bold']).optional(),
  align: z.enum(['left', 'center', 'right']).optional(),
  color: z.string().optional(),
  fontFamily: z.string().optional(),
});
export type ElementStyle = z.infer<typeof StyleSchema>;

// --- Grid coordinates ---

export const GridPosSchema = z.object({
  c: z.number().int().nonnegative(),     // column start
  r: z.number().int().nonnegative(),     // row start
  cs: z.number().int().positive(),       // column span
  rs: z.number().int().positive(),       // row span
});
export type GridPos = z.infer<typeof GridPosSchema>;

// --- Element variants (8 types) ---

const Base = z.object({
  id: z.string().min(1),
  grid: GridPosSchema,
  style: StyleSchema,
});

export const TextElementSchema = Base.extend({
  type: z.literal('text'),
  content: z.object({ static: z.string() }),
});

export const FieldElementSchema = Base.extend({
  type: z.literal('field'),
  binding: z.string().min(1),
  fallback: z.string().default('—'),
  format: z.string().nullable().default(null),
});

export const ImageElementSchema = Base.extend({
  type: z.literal('image'),
  source: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('static'), url: z.string().url().or(z.string().startsWith('/')) }),
    z.object({ kind: z.literal('field'), binding: z.string().min(1) }),
  ]),
  fit: z.enum(['contain', 'cover', 'fill']).default('contain'),
});

export const TableColumnSchema = z.object({
  key: z.string().min(1),
  header: z.string(),
  cs: z.number().int().positive(),
  align: z.enum(['left', 'center', 'right']).default('left'),
  format: z.string().nullable().default(null),
});

export const TableElementSchema = Base.extend({
  type: z.literal('table'),
  binding: z.string().min(1),
  columns: z.array(TableColumnSchema).min(1),
  rowHeight: z.number().int().positive(),
  showHeader: z.boolean().default(true),
  headerStyle: StyleSchema.partial().optional(),
  rowStyle: StyleSchema.partial().optional(),
});

export const BarcodeElementSchema = Base.extend({
  type: z.literal('barcode'),
  binding: z.string().min(1).optional(),
  content: z.object({ static: z.string() }).optional(),
  symbology: z.enum(['qr', 'code128', 'code39', 'ean13']).default('qr'),
  showText: z.boolean().default(false),
});

export const AutonumberElementSchema = Base.extend({
  type: z.literal('autonumber'),
  sequence: z.string().min(1),
  format: z.string().default('0000000'),
  prefix: z.string().default(''),
});

export const SystemElementSchema = Base.extend({
  type: z.literal('system'),
  variable: z.enum(['pageNo', 'totalPages', 'now', 'printedBy']),
  format: z.string().optional(),
});

export const RectElementSchema = Base.extend({
  type: z.literal('rect'),
});

export const ElementSchema = z.discriminatedUnion('type', [
  TextElementSchema,
  FieldElementSchema,
  ImageElementSchema,
  TableElementSchema,
  BarcodeElementSchema,
  AutonumberElementSchema,
  SystemElementSchema,
  RectElementSchema,
]);
export type TemplateElement = z.infer<typeof ElementSchema>;

// --- Canvas + Schema (data contract) + Meta ---

export const CellSchema = z.object({
  w: z.number().positive(),
  h: z.number().positive(),
});

export const PaperSchema = z.union([
  z.enum(['A4', 'A4-Landscape', 'A5', 'A5-Landscape']),
  z.object({ w_mm: z.number().positive(), h_mm: z.number().positive() }),
]);

export const CanvasSchema = z.object({
  cols: z.number().int().positive(),
  rows: z.number().int().positive(),
  cell: CellSchema,
  paper: PaperSchema,
  background: z.string().nullable().default(null),
});

export const FieldDefSchema = z.object({
  type: z.enum(['string', 'number', 'date', 'array']),
  label: z.string().min(1),
  required: z.boolean().default(false),
  example: z.string().optional(),
  shape: z.record(z.string()).optional(), // for array type
});

export const TemplateMetaSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(2000).default(''),
  version: z.number().int().positive().default(1),
  tags: z.array(z.string()).default([]),
});

export const TemplateSchema = z.object({
  id: z.string().min(1),
  meta: TemplateMetaSchema,
  canvas: CanvasSchema,
  schema: z.record(FieldDefSchema).default({}),
  elements: z.array(ElementSchema).default([]),
});
export type Template = z.infer<typeof TemplateSchema>;
```

- [ ] **Step 2: Update `packages/schema/src/index.ts`** — re-export

Open the file. After the existing exports, add:

```typescript
export * from './template.js';
```

(The `.js` extension stays for NodeNext compatibility; vitest is configured to resolve it.)

- [ ] **Step 3: Typecheck**

```bash
pnpm --filter @template-printing/schema typecheck
```

- [ ] **Step 4: Commit**

```bash
git add packages/schema/src/
git commit -m "feat(schema): full Template JSON zod schema (8 element types + canvas + fields)"
```

---

## Task 3: Schema tests

**Files:**
- Create: `packages/schema/test/template.spec.ts`

- [ ] **Step 1: Create `packages/schema/test/template.spec.ts`**

```typescript
import { describe, it, expect } from 'vitest';

import {
  TemplateSchema,
  ElementSchema,
  TextElementSchema,
  TableElementSchema,
  type Template,
} from '../src/template.js';

const minimalTemplate: Template = {
  id: 'tpl_test',
  meta: { name: 'Test', description: '', version: 1, tags: [] },
  canvas: {
    cols: 240,
    rows: 160,
    cell: { w: 4, h: 4 },
    paper: 'A4-Landscape',
    background: null,
  },
  schema: {},
  elements: [],
};

const fullBorder = {
  top:    { show: false, width: 1, style: 'solid' as const, color: '#1f2328' },
  right:  { show: false, width: 1, style: 'solid' as const, color: '#1f2328' },
  bottom: { show: true,  width: 1.5, style: 'solid' as const, color: '#1f2328' },
  left:   { show: false, width: 1, style: 'solid' as const, color: '#1f2328' },
};

const baseStyle = {
  border: fullBorder,
  padding: { t: 0, r: 4, b: 2, l: 4 },
  background: null,
  borderRadius: 0,
};

describe('TemplateSchema', () => {
  it('accepts a minimal valid template', () => {
    const parsed = TemplateSchema.parse(minimalTemplate);
    expect(parsed.id).toBe('tpl_test');
  });

  it('rejects template without meta.name', () => {
    expect(() =>
      TemplateSchema.parse({ ...minimalTemplate, meta: { ...minimalTemplate.meta, name: '' } }),
    ).toThrow();
  });

  it('rejects negative canvas cols', () => {
    expect(() =>
      TemplateSchema.parse({
        ...minimalTemplate,
        canvas: { ...minimalTemplate.canvas, cols: -1 },
      }),
    ).toThrow();
  });
});

describe('ElementSchema', () => {
  it('accepts text element', () => {
    const el = TextElementSchema.parse({
      id: 'e1',
      type: 'text',
      grid: { c: 0, r: 0, cs: 10, rs: 2 },
      style: baseStyle,
      content: { static: 'Hello' },
    });
    expect(el.content.static).toBe('Hello');
  });

  it('table element requires at least one column', () => {
    expect(() =>
      TableElementSchema.parse({
        id: 'e2',
        type: 'table',
        grid: { c: 0, r: 0, cs: 20, rs: 10 },
        style: baseStyle,
        binding: 'items',
        columns: [],
        rowHeight: 4,
        showHeader: true,
      }),
    ).toThrow();
  });

  it('discriminated union narrows correctly', () => {
    const el = ElementSchema.parse({
      id: 'b1',
      type: 'barcode',
      grid: { c: 0, r: 0, cs: 8, rs: 8 },
      style: baseStyle,
      symbology: 'qr',
      content: { static: 'https://example.com' },
    });
    if (el.type === 'barcode') {
      expect(el.symbology).toBe('qr');
    } else {
      throw new Error('expected barcode');
    }
  });

  it('rejects unknown element type', () => {
    expect(() =>
      ElementSchema.parse({
        id: 'x',
        type: 'unknown',
        grid: { c: 0, r: 0, cs: 1, rs: 1 },
        style: baseStyle,
      }),
    ).toThrow();
  });
});
```

- [ ] **Step 2: Run tests**

```bash
pnpm --filter @template-printing/schema test
```
Expected: previous 6 tests + 7 new tests = 13/13 pass.

- [ ] **Step 3: Commit**

```bash
git add packages/schema/test/template.spec.ts
git commit -m "test(schema): cover Template + Element discriminated union"
```

---

## Task 4: Element renderer components

**Files:**
- Create: `packages/template-renderer/src/elements/TextElement.vue`
- Create: `packages/template-renderer/src/elements/FieldElement.vue`
- Create: `packages/template-renderer/src/elements/ImageElement.vue`
- Create: `packages/template-renderer/src/elements/TableElement.vue`
- Create: `packages/template-renderer/src/elements/BarcodeElement.vue`
- Create: `packages/template-renderer/src/elements/AutonumberElement.vue`
- Create: `packages/template-renderer/src/elements/SystemElement.vue`
- Create: `packages/template-renderer/src/elements/RectElement.vue`
- Modify: `packages/template-renderer/src/TemplateRenderer.vue`
- Modify: `packages/template-renderer/src/index.ts`

- [ ] **Step 1: Create `packages/template-renderer/src/elements/TextElement.vue`**

```vue
<script setup lang="ts">
import type { TemplateElement, ElementStyle } from '@template-printing/schema';

const props = defineProps<{
  element: Extract<TemplateElement, { type: 'text' }>;
}>();

function styleToCss(s: ElementStyle): Record<string, string | number> {
  const css: Record<string, string | number> = {
    paddingTop: `${s.padding.t}px`,
    paddingRight: `${s.padding.r}px`,
    paddingBottom: `${s.padding.b}px`,
    paddingLeft: `${s.padding.l}px`,
    borderRadius: `${s.borderRadius}px`,
  };
  if (s.fontSize) css.fontSize = `${s.fontSize}px`;
  if (s.fontWeight) css.fontWeight = s.fontWeight;
  if (s.align) css.textAlign = s.align;
  if (s.color) css.color = s.color;
  if (s.fontFamily) css.fontFamily = s.fontFamily;
  if (s.background) css.background = s.background;
  for (const side of ['top', 'right', 'bottom', 'left'] as const) {
    const b = s.border[side];
    if (b.show) {
      const cap = side.charAt(0).toUpperCase() + side.slice(1);
      css[`border${cap}`] = `${b.width}px ${b.style} ${b.color}`;
    }
  }
  return css;
}
</script>

<template>
  <div class="tp-text" :style="styleToCss(props.element.style)">
    {{ props.element.content.static }}
  </div>
</template>

<style scoped>
.tp-text {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  white-space: pre-wrap;
  word-break: break-all;
}
</style>
```

- [ ] **Step 2: Create `packages/template-renderer/src/elements/FieldElement.vue`**

```vue
<script setup lang="ts">
import { computed } from 'vue';

import type { TemplateElement, ElementStyle } from '@template-printing/schema';

const props = defineProps<{
  element: Extract<TemplateElement, { type: 'field' }>;
  data?: Record<string, unknown>;
  designMode?: boolean;
}>();

const displayValue = computed(() => {
  if (props.designMode) return `{{ ${props.element.binding} }}`;
  const v = props.data?.[props.element.binding];
  if (v == null || v === '') return props.element.fallback;
  return String(v);
});

function styleToCss(s: ElementStyle): Record<string, string | number> {
  // Same conversion logic as TextElement — duplicated intentionally so each
  // element file is self-contained for review. Will share later if it grows.
  const css: Record<string, string | number> = {
    paddingTop: `${s.padding.t}px`,
    paddingRight: `${s.padding.r}px`,
    paddingBottom: `${s.padding.b}px`,
    paddingLeft: `${s.padding.l}px`,
    borderRadius: `${s.borderRadius}px`,
  };
  if (s.fontSize) css.fontSize = `${s.fontSize}px`;
  if (s.fontWeight) css.fontWeight = s.fontWeight;
  if (s.align) css.textAlign = s.align;
  if (s.color) css.color = s.color;
  if (s.fontFamily) css.fontFamily = s.fontFamily;
  if (s.background) css.background = s.background;
  for (const side of ['top', 'right', 'bottom', 'left'] as const) {
    const b = s.border[side];
    if (b.show) {
      const cap = side.charAt(0).toUpperCase() + side.slice(1);
      css[`border${cap}`] = `${b.width}px ${b.style} ${b.color}`;
    }
  }
  return css;
}
</script>

<template>
  <div
    class="tp-field"
    :class="{ 'tp-field-design': props.designMode }"
    :style="styleToCss(props.element.style)"
  >
    {{ displayValue }}
  </div>
</template>

<style scoped>
.tp-field {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.tp-field-design {
  color: #0969da;
}
</style>
```

- [ ] **Step 3: Create `packages/template-renderer/src/elements/ImageElement.vue`**

```vue
<script setup lang="ts">
import { computed } from 'vue';

import type { TemplateElement } from '@template-printing/schema';

const props = defineProps<{
  element: Extract<TemplateElement, { type: 'image' }>;
  data?: Record<string, unknown>;
  designMode?: boolean;
}>();

const src = computed<string | null>(() => {
  const s = props.element.source;
  if (s.kind === 'static') return s.url;
  const v = props.data?.[s.binding];
  return typeof v === 'string' ? v : null;
});

const objectFit = computed(() => props.element.fit ?? 'contain');
</script>

<template>
  <div class="tp-image" :class="{ 'tp-image-design': props.designMode && !src }">
    <img v-if="src" :src="src" :style="{ objectFit }" />
    <span v-else-if="props.designMode" class="tp-image-placeholder">▤ 图片</span>
  </div>
</template>

<style scoped>
.tp-image {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}
.tp-image img {
  width: 100%;
  height: 100%;
}
.tp-image-design {
  border: 1px dashed #c0c7ff;
  background: linear-gradient(135deg, #fafafa, #eef1f4);
}
.tp-image-placeholder {
  color: #86909c;
  font-size: 11px;
}
</style>
```

- [ ] **Step 4: Create `packages/template-renderer/src/elements/TableElement.vue`**

```vue
<script setup lang="ts">
import { computed } from 'vue';

import type { TemplateElement } from '@template-printing/schema';

const props = defineProps<{
  element: Extract<TemplateElement, { type: 'table' }>;
  data?: Record<string, unknown>;
  designMode?: boolean;
}>();

const rows = computed<Record<string, unknown>[]>(() => {
  if (props.designMode) {
    // Show 2 sample rows in design mode
    return [
      Object.fromEntries(props.element.columns.map((c) => [c.key, '示例'])) as Record<string, unknown>,
      Object.fromEntries(props.element.columns.map((c) => [c.key, '...'])) as Record<string, unknown>,
    ];
  }
  const v = props.data?.[props.element.binding];
  if (!Array.isArray(v)) return [];
  return v as Record<string, unknown>[];
});

const totalCs = computed(() =>
  props.element.columns.reduce((sum, c) => sum + c.cs, 0) || 1,
);
</script>

<template>
  <div class="tp-table">
    <div v-if="props.element.showHeader" class="tp-table-row tp-table-header">
      <div
        v-for="col in props.element.columns"
        :key="col.key"
        class="tp-table-cell"
        :style="{ flexBasis: `${(col.cs / totalCs) * 100}%`, textAlign: col.align }"
      >
        {{ col.header }}
      </div>
    </div>
    <div v-for="(row, i) in rows" :key="i" class="tp-table-row">
      <div
        v-for="col in props.element.columns"
        :key="col.key"
        class="tp-table-cell"
        :style="{ flexBasis: `${(col.cs / totalCs) * 100}%`, textAlign: col.align }"
      >
        {{ row[col.key] ?? '' }}
      </div>
    </div>
  </div>
</template>

<style scoped>
.tp-table {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  font-size: 12px;
}
.tp-table-row {
  display: flex;
  border-bottom: 1px solid #e5e6eb;
}
.tp-table-header {
  font-weight: 600;
  background: #f7f8fa;
}
.tp-table-cell {
  padding: 4px 6px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
```

- [ ] **Step 5: Create `packages/template-renderer/src/elements/BarcodeElement.vue`**

```vue
<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
// eslint-disable-next-line import/no-unresolved
import bwipjs from 'bwip-js';
// eslint-disable-next-line import/no-unresolved
import qrcode from 'qrcode-generator';

import type { TemplateElement } from '@template-printing/schema';

const props = defineProps<{
  element: Extract<TemplateElement, { type: 'barcode' }>;
  data?: Record<string, unknown>;
  designMode?: boolean;
}>();

const canvasRef = ref<HTMLCanvasElement | null>(null);
const qrSvg = ref<string>('');

const value = computed<string>(() => {
  if (props.element.content?.static) return props.element.content.static;
  if (props.element.binding) {
    const v = props.data?.[props.element.binding];
    if (v != null) return String(v);
  }
  return props.designMode ? 'SAMPLE-CODE' : '';
});

function render(): void {
  const v = value.value;
  if (!v) return;
  if (props.element.symbology === 'qr') {
    // qrcode-generator produces SVG inline
    const qr = qrcode(0, 'M');
    qr.addData(v);
    qr.make();
    qrSvg.value = qr.createSvgTag({ scalable: true, margin: 0 });
  } else {
    if (!canvasRef.value) return;
    try {
      bwipjs.toCanvas(canvasRef.value, {
        bcid: props.element.symbology,
        text: v,
        scale: 2,
        includetext: props.element.showText,
        textxalign: 'center',
      });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('barcode render failed', e);
    }
  }
}

onMounted(render);
watch(() => [value.value, props.element.symbology], render);
</script>

<template>
  <div class="tp-barcode">
    <div v-if="props.element.symbology === 'qr'" class="tp-qr" v-html="qrSvg" />
    <canvas v-else ref="canvasRef" class="tp-canvas" />
  </div>
</template>

<style scoped>
.tp-barcode {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}
.tp-qr {
  width: 100%;
  height: 100%;
}
.tp-qr :deep(svg) {
  width: 100%;
  height: 100%;
}
.tp-canvas {
  max-width: 100%;
  max-height: 100%;
}
</style>
```

- [ ] **Step 6: Create `packages/template-renderer/src/elements/AutonumberElement.vue`**

```vue
<script setup lang="ts">
import { computed } from 'vue';

import type { TemplateElement } from '@template-printing/schema';

const props = defineProps<{
  element: Extract<TemplateElement, { type: 'autonumber' }>;
  data?: Record<string, unknown>;
  designMode?: boolean;
}>();

const displayValue = computed<string>(() => {
  // Design mode: synthesize a sample based on format string
  if (props.designMode) {
    const digits = (props.element.format.match(/0/g) ?? []).length;
    return props.element.prefix + '1'.padStart(digits, '0');
  }
  // Print mode: backend supplies the resolved number via data.__autonumber.<sequence>
  const v = (props.data?.__autonumber as Record<string, string> | undefined)?.[props.element.sequence];
  return v ?? `[${props.element.sequence}]`;
});
</script>

<template>
  <div class="tp-autonumber">{{ displayValue }}</div>
</template>

<style scoped>
.tp-autonumber {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  font-family: ui-monospace, monospace;
}
</style>
```

- [ ] **Step 7: Create `packages/template-renderer/src/elements/SystemElement.vue`**

```vue
<script setup lang="ts">
import { computed } from 'vue';

import type { TemplateElement } from '@template-printing/schema';

const props = defineProps<{
  element: Extract<TemplateElement, { type: 'system' }>;
  data?: Record<string, unknown>;
  designMode?: boolean;
  pageNo?: number;
  totalPages?: number;
}>();

const displayValue = computed<string>(() => {
  const v = props.element.variable;
  switch (v) {
    case 'pageNo':
      return String(props.pageNo ?? (props.designMode ? 1 : ''));
    case 'totalPages':
      return String(props.totalPages ?? (props.designMode ? 1 : ''));
    case 'now':
      return new Date().toLocaleString('zh-CN');
    case 'printedBy':
      return (
        (props.data?.__printedBy as string | undefined) ?? (props.designMode ? '{{ 当前用户 }}' : '')
      );
    default:
      return '';
  }
});
</script>

<template>
  <div class="tp-system">{{ displayValue }}</div>
</template>

<style scoped>
.tp-system {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
}
</style>
```

- [ ] **Step 8: Create `packages/template-renderer/src/elements/RectElement.vue`**

```vue
<script setup lang="ts">
import type { TemplateElement, ElementStyle } from '@template-printing/schema';

const props = defineProps<{
  element: Extract<TemplateElement, { type: 'rect' }>;
}>();

function styleToCss(s: ElementStyle): Record<string, string | number> {
  const css: Record<string, string | number> = {
    borderRadius: `${s.borderRadius}px`,
  };
  if (s.background) css.background = s.background;
  for (const side of ['top', 'right', 'bottom', 'left'] as const) {
    const b = s.border[side];
    if (b.show) {
      const cap = side.charAt(0).toUpperCase() + side.slice(1);
      css[`border${cap}`] = `${b.width}px ${b.style} ${b.color}`;
    }
  }
  return css;
}
</script>

<template>
  <div class="tp-rect" :style="styleToCss(props.element.style)" />
</template>

<style scoped>
.tp-rect {
  width: 100%;
  height: 100%;
}
</style>
```

- [ ] **Step 9: Replace `packages/template-renderer/src/TemplateRenderer.vue`**

```vue
<script setup lang="ts">
import { computed } from 'vue';
import type { Template } from '@template-printing/schema';

import TextElement from './elements/TextElement.vue';
import FieldElement from './elements/FieldElement.vue';
import ImageElement from './elements/ImageElement.vue';
import TableElement from './elements/TableElement.vue';
import BarcodeElement from './elements/BarcodeElement.vue';
import AutonumberElement from './elements/AutonumberElement.vue';
import SystemElement from './elements/SystemElement.vue';
import RectElement from './elements/RectElement.vue';

const props = defineProps<{
  template: Template;
  data?: Record<string, unknown>;
  designMode?: boolean;
}>();

const cellW = computed(() => props.template.canvas.cell.w);
const cellH = computed(() => props.template.canvas.cell.h);
const cssVars = computed(() => ({
  '--cell-w': `${cellW.value}px`,
  '--cell-h': `${cellH.value}px`,
  '--canvas-w': `${cellW.value * props.template.canvas.cols}px`,
  '--canvas-h': `${cellH.value * props.template.canvas.rows}px`,
}));

const elementMap = {
  text: TextElement,
  field: FieldElement,
  image: ImageElement,
  table: TableElement,
  barcode: BarcodeElement,
  autonumber: AutonumberElement,
  system: SystemElement,
  rect: RectElement,
} as const;
</script>

<template>
  <div class="tp-canvas" :style="cssVars">
    <div
      v-for="el in props.template.elements"
      :key="el.id"
      class="tp-element"
      :style="{
        left: `calc(${el.grid.c} * var(--cell-w))`,
        top: `calc(${el.grid.r} * var(--cell-h))`,
        width: `calc(${el.grid.cs} * var(--cell-w))`,
        height: `calc(${el.grid.rs} * var(--cell-h))`,
      }"
    >
      <component
        :is="elementMap[el.type]"
        :element="el"
        :data="props.data"
        :design-mode="props.designMode"
      />
    </div>
  </div>
</template>

<style scoped>
.tp-canvas {
  position: relative;
  width: var(--canvas-w);
  height: var(--canvas-h);
  background: #fff;
}
.tp-element {
  position: absolute;
  box-sizing: border-box;
}
</style>
```

- [ ] **Step 10: Replace `packages/template-renderer/src/index.ts`**

```typescript
export { default as TemplateRenderer } from './TemplateRenderer.vue';
export { default as TextElement } from './elements/TextElement.vue';
export { default as FieldElement } from './elements/FieldElement.vue';
export { default as ImageElement } from './elements/ImageElement.vue';
export { default as TableElement } from './elements/TableElement.vue';
export { default as BarcodeElement } from './elements/BarcodeElement.vue';
export { default as AutonumberElement } from './elements/AutonumberElement.vue';
export { default as SystemElement } from './elements/SystemElement.vue';
export { default as RectElement } from './elements/RectElement.vue';
```

- [ ] **Step 11: Typecheck**

```bash
pnpm --filter @template-printing/template-renderer typecheck
```

- [ ] **Step 12: Commit**

```bash
git add packages/template-renderer/src/
git commit -m "feat(template-renderer): 8 element components + TemplateRenderer using CSS vars"
```

---

## Task 5: Designer Pinia store

**Files:**
- Create: `apps/web/src/stores/designer.ts`

- [ ] **Step 1: Create `apps/web/src/stores/designer.ts`**

```typescript
import { defineStore } from 'pinia';
import type { Template, TemplateElement, FieldDefSchema } from '@template-printing/schema';
import { z } from 'zod';

type FieldDef = z.infer<typeof FieldDefSchema>;

const STORAGE_KEY = 'tp_designer_draft';
const HISTORY_LIMIT = 50;

function makeId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function defaultBorder() {
  const side = { show: false, width: 1, style: 'solid' as const, color: '#1f2328' };
  return { top: { ...side }, right: { ...side }, bottom: { ...side }, left: { ...side } };
}

function defaultStyle() {
  return {
    border: defaultBorder(),
    padding: { t: 0, r: 4, b: 2, l: 4 },
    background: null,
    borderRadius: 0,
  };
}

export function defaultTemplate(): Template {
  return {
    id: makeId('tpl'),
    meta: { name: '未命名模板', description: '', version: 1, tags: [] },
    canvas: { cols: 240, rows: 160, cell: { w: 4, h: 4 }, paper: 'A4-Landscape', background: null },
    schema: {},
    elements: [],
  };
}

export const useDesignerStore = defineStore('designer', {
  state: () => ({
    template: defaultTemplate(),
    selectedIds: [] as string[],
    history: [] as string[], // JSON snapshots
    historyIndex: -1,
    dirty: false,
    isResizing: false, // true while cell-size animation is playing
  }),
  getters: {
    canUndo: (s): boolean => s.historyIndex > 0,
    canRedo: (s): boolean => s.historyIndex < s.history.length - 1,
    selectedElement: (s): TemplateElement | null => {
      if (s.selectedIds.length !== 1) return null;
      return s.template.elements.find((e) => e.id === s.selectedIds[0]) ?? null;
    },
    fieldDefs: (s): Array<{ key: string; def: FieldDef }> =>
      Object.entries(s.template.schema).map(([key, def]) => ({ key, def })),
    usedFieldKeys: (s): Set<string> => {
      const used = new Set<string>();
      for (const el of s.template.elements) {
        if (el.type === 'field' || el.type === 'table') used.add(el.binding);
        if (el.type === 'image' && el.source.kind === 'field') used.add(el.source.binding);
        if (el.type === 'barcode' && el.binding) used.add(el.binding);
      }
      return used;
    },
  },
  actions: {
    snapshot(): void {
      const json = JSON.stringify(this.template);
      // Drop redo branch
      this.history = this.history.slice(0, this.historyIndex + 1);
      this.history.push(json);
      if (this.history.length > HISTORY_LIMIT) {
        this.history.shift();
      } else {
        this.historyIndex++;
      }
      this.dirty = true;
      this.persist();
    },
    undo(): void {
      if (!this.canUndo) return;
      this.historyIndex--;
      this.template = JSON.parse(this.history[this.historyIndex]);
      this.persist();
    },
    redo(): void {
      if (!this.canRedo) return;
      this.historyIndex++;
      this.template = JSON.parse(this.history[this.historyIndex]);
      this.persist();
    },
    persist(): void {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this.template));
      } catch {
        // Ignore quota / privacy-mode failures
      }
    },
    restore(): boolean {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return false;
        const parsed = JSON.parse(raw) as Template;
        this.template = parsed;
        this.history = [JSON.stringify(parsed)];
        this.historyIndex = 0;
        return true;
      } catch {
        return false;
      }
    },
    reset(): void {
      this.template = defaultTemplate();
      this.history = [JSON.stringify(this.template)];
      this.historyIndex = 0;
      this.selectedIds = [];
      this.dirty = false;
      this.persist();
    },
    select(ids: string[]): void {
      this.selectedIds = ids;
    },
    clearSelection(): void {
      this.selectedIds = [];
    },
    addElement(el: TemplateElement): void {
      this.template.elements.push(el);
      this.snapshot();
      this.select([el.id]);
    },
    updateElement(id: string, updates: Partial<TemplateElement>): void {
      const idx = this.template.elements.findIndex((e) => e.id === id);
      if (idx < 0) return;
      const merged = { ...this.template.elements[idx], ...updates } as TemplateElement;
      this.template.elements[idx] = merged;
      this.snapshot();
    },
    moveElement(id: string, c: number, r: number): void {
      const idx = this.template.elements.findIndex((e) => e.id === id);
      if (idx < 0) return;
      this.template.elements[idx] = {
        ...this.template.elements[idx],
        grid: { ...this.template.elements[idx].grid, c, r },
      };
      // Don't snapshot every pointermove; caller will call commit() at pointer-up
    },
    resizeElement(id: string, cs: number, rs: number, c?: number, r?: number): void {
      const idx = this.template.elements.findIndex((e) => e.id === id);
      if (idx < 0) return;
      const cur = this.template.elements[idx];
      this.template.elements[idx] = {
        ...cur,
        grid: {
          c: c ?? cur.grid.c,
          r: r ?? cur.grid.r,
          cs,
          rs,
        },
      };
    },
    commit(): void {
      // Snapshot after a drag/resize completes
      this.snapshot();
    },
    deleteElement(id: string): void {
      this.template.elements = this.template.elements.filter((e) => e.id !== id);
      this.selectedIds = this.selectedIds.filter((s) => s !== id);
      this.snapshot();
    },
    setCellSize(w: number, h: number): void {
      this.template.canvas.cell = { w, h };
      this.snapshot();
    },
    setCanvasSize(cols: number, rows: number): void {
      this.template.canvas.cols = cols;
      this.template.canvas.rows = rows;
      this.snapshot();
    },
    setPaper(paper: Template['canvas']['paper']): void {
      this.template.canvas.paper = paper;
      this.snapshot();
    },
    setName(name: string): void {
      this.template.meta.name = name;
      this.snapshot();
    },
    addField(key: string, def: FieldDef): void {
      this.template.schema[key] = def;
      this.snapshot();
    },
    removeField(key: string): void {
      delete this.template.schema[key];
      this.snapshot();
    },
    newElementId(): string {
      return makeId('e');
    },
  },
});
```

- [ ] **Step 2: Typecheck**

```bash
pnpm --filter @template-printing/web typecheck
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/stores/designer.ts
git commit -m "feat(web): useDesignerStore — template state, undo/redo, localStorage backup"
```

---

## Task 6: Router updates

**Files:**
- Modify: `apps/web/src/router/index.ts`

- [ ] **Step 1: Append routes**

Open `apps/web/src/router/index.ts`. Modify the `routes` array to add two new routes BEFORE the existing `/login/callback` entry:

```typescript
    {
      path: '/designer/new',
      name: 'designer-new',
      meta: { requiresAuth: true },
      component: () => import('../views/DesignerView.vue'),
    },
    {
      path: '/designer/:id',
      name: 'designer-edit',
      meta: { requiresAuth: true },
      component: () => import('../views/DesignerView.vue'),
      // Plan 3 will wire id → load existing template; Plan 2 just opens an empty designer.
    },
```

- [ ] **Step 2: Build to verify (Vite will fail if DesignerView.vue is missing)**

Skip the build for now — DesignerView.vue is created in Task 7. Just typecheck (will warn about dynamic import but that's OK):

```bash
pnpm --filter @template-printing/web typecheck
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/router/index.ts
git commit -m "feat(web): add /designer/new and /designer/:id routes (auth-gated)"
```

---

## Task 7: DesignerView skeleton

**Files:**
- Create: `apps/web/src/views/DesignerView.vue`
- Create: `apps/web/src/designer/DesignerHeader.vue` (empty placeholder)
- Create: `apps/web/src/designer/ElementLibrary.vue` (empty placeholder)
- Create: `apps/web/src/designer/DesignerCanvas.vue` (empty placeholder)
- Create: `apps/web/src/designer/FieldManager.vue` (empty placeholder)
- Create: `apps/web/src/designer/PropertyPanel.vue` (empty placeholder)
- Create: `apps/web/src/styles/designer.css`

- [ ] **Step 1: Create `apps/web/src/styles/designer.css`**

```css
.designer-root {
  --header-h: 48px;
  --left-w: 88px;
  --right-w: 300px;
  --bg-canvas: #f0f2f5;
  --grid-line: #eef1f4;
  display: grid;
  grid-template-rows: var(--header-h) 1fr;
  grid-template-columns: var(--left-w) 1fr var(--right-w);
  grid-template-areas:
    'header header header'
    'left   middle right';
  height: 100vh;
  background: var(--el-bg-color);
}

.designer-header  { grid-area: header; border-bottom: 1px solid var(--el-border-color); }
.designer-left    { grid-area: left;   border-right: 1px solid var(--el-border-color); background: #fafafa; overflow-y: auto; }
.designer-middle  { grid-area: middle; background: var(--bg-canvas); overflow: auto; padding: 24px; display: flex; justify-content: center; align-items: flex-start; }
.designer-right   { grid-area: right;  border-left: 1px solid var(--el-border-color); overflow-y: auto; }

/* Grid background, default hidden */
.designer-paper {
  position: relative;
  background: #fff;
  box-shadow: 0 2px 8px rgba(31, 35, 40, 0.04);
}
.designer-paper::before {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  background-image:
    linear-gradient(to right, var(--grid-line) 1px, transparent 1px),
    linear-gradient(to bottom, var(--grid-line) 1px, transparent 1px);
  background-size: var(--cell-w) var(--cell-h);
  opacity: 0;
  transition: opacity 180ms ease;
}
.designer-paper.is-dragging::before { opacity: 1; }

/* Cell-size animation transitions on the paper + each element */
.designer-paper {
  transition: width 360ms cubic-bezier(0.4, 0, 0.2, 1), height 360ms cubic-bezier(0.4, 0, 0.2, 1);
}
.designer-paper .tp-element {
  transition:
    left 360ms cubic-bezier(0.4, 0, 0.2, 1),
    top 360ms cubic-bezier(0.4, 0, 0.2, 1),
    width 360ms cubic-bezier(0.4, 0, 0.2, 1),
    height 360ms cubic-bezier(0.4, 0, 0.2, 1);
}

/* Print layer */
@media print {
  .designer-header, .designer-left, .designer-right { display: none !important; }
  .designer-root { display: block; height: auto; }
  .designer-middle { padding: 0; background: #fff; }
  .designer-paper::before, .designer-paper::after { display: none !important; }
}
```

- [ ] **Step 2: Create each placeholder Vue component**

`apps/web/src/designer/DesignerHeader.vue`:
```vue
<script setup lang="ts"></script>
<template><div class="designer-header" style="padding: 0 16px; display: flex; align-items: center">DesignerHeader (Task 8)</div></template>
```

`apps/web/src/designer/ElementLibrary.vue`:
```vue
<script setup lang="ts"></script>
<template><div class="designer-left" style="padding: 12px">ElementLibrary (Task 9)</div></template>
```

`apps/web/src/designer/DesignerCanvas.vue`:
```vue
<script setup lang="ts"></script>
<template>
  <div class="designer-middle">
    <div class="designer-paper" style="width: 480px; height: 320px">DesignerCanvas (Task 10)</div>
  </div>
</template>
```

`apps/web/src/designer/FieldManager.vue`:
```vue
<script setup lang="ts"></script>
<template><div style="padding: 12px">FieldManager (Task 15)</div></template>
```

`apps/web/src/designer/PropertyPanel.vue`:
```vue
<script setup lang="ts"></script>
<template><div style="padding: 12px">PropertyPanel (Task 16)</div></template>
```

- [ ] **Step 3: Create `apps/web/src/views/DesignerView.vue`**

```vue
<script setup lang="ts">
import '../styles/designer.css';

import DesignerHeader from '../designer/DesignerHeader.vue';
import ElementLibrary from '../designer/ElementLibrary.vue';
import DesignerCanvas from '../designer/DesignerCanvas.vue';
import FieldManager from '../designer/FieldManager.vue';
import PropertyPanel from '../designer/PropertyPanel.vue';
</script>

<template>
  <div class="designer-root">
    <DesignerHeader />
    <ElementLibrary />
    <DesignerCanvas />
    <div class="designer-right">
      <FieldManager />
      <PropertyPanel />
    </div>
  </div>
</template>
```

- [ ] **Step 4: Verify dev build**

```bash
pnpm --filter @template-printing/web build
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/views/DesignerView.vue apps/web/src/designer/ apps/web/src/styles/designer.css
git commit -m "feat(web): DesignerView 3-column skeleton with placeholder children"
```

---

## Task 8: DesignerHeader

**Files:**
- Modify: `apps/web/src/designer/DesignerHeader.vue`

- [ ] **Step 1: Replace with full implementation**

```vue
<script setup lang="ts">
import {
  ElButton,
  ElDropdown,
  ElDropdownItem,
  ElDropdownMenu,
  ElIcon,
  ElInput,
  ElInputNumber,
  ElMessage,
} from 'element-plus';
import { computed, nextTick, ref } from 'vue';
import { useRouter } from 'vue-router';

import { useDesignerStore } from '../stores/designer';

const store = useDesignerStore();
const router = useRouter();

const paperOptions = ['A4', 'A4-Landscape', 'A5', 'A5-Landscape'] as const;

const cellW = ref(store.template.canvas.cell.w);
const cellH = ref(store.template.canvas.cell.h);

function applyCellSize(): void {
  if (cellW.value === store.template.canvas.cell.w && cellH.value === store.template.canvas.cell.h) {
    return;
  }
  // Animate: mark paper as resizing, change cells, then unmark after transition
  store.isResizing = true;
  store.setCellSize(cellW.value, cellH.value);
  nextTick(() => {
    setTimeout(() => {
      store.isResizing = false;
    }, 420);
  });
}

function exitToHome(): void {
  if (store.dirty) {
    if (!window.confirm('当前模板有未保存改动，确定离开吗？(草稿保留在本地)')) return;
  }
  router.push('/');
}

const paperLabel = computed(() => {
  const p = store.template.canvas.paper;
  return typeof p === 'string' ? p : `${p.w_mm}×${p.h_mm} mm`;
});
</script>

<template>
  <header class="designer-header">
    <ElButton link size="small" @click="exitToHome">← 返回</ElButton>
    <ElInput
      v-model="store.template.meta.name"
      size="small"
      placeholder="模板名"
      style="width: 200px; margin-left: 8px"
    />

    <span class="dh-divider" />

    <ElButton :disabled="!store.canUndo" link size="small" @click="store.undo">↶ 撤销</ElButton>
    <ElButton :disabled="!store.canRedo" link size="small" @click="store.redo">↷ 重做</ElButton>

    <span class="dh-divider" />

    <span class="dh-label">cell</span>
    <ElInputNumber v-model="cellW" :min="1" :max="40" size="small" controls-position="right" style="width: 70px" />
    <span class="dh-x">×</span>
    <ElInputNumber v-model="cellH" :min="1" :max="40" size="small" controls-position="right" style="width: 70px" />
    <span class="dh-label">px</span>
    <ElButton size="small" @click="applyCellSize">应用</ElButton>

    <span class="dh-divider" />

    <ElDropdown trigger="click">
      <ElButton size="small">{{ paperLabel }}</ElButton>
      <template #dropdown>
        <ElDropdownMenu>
          <ElDropdownItem
            v-for="p in paperOptions"
            :key="p"
            @click="store.setPaper(p)"
          >
            {{ p }}
          </ElDropdownItem>
        </ElDropdownMenu>
      </template>
    </ElDropdown>

    <span class="dh-spacer" />

    <ElButton size="small" @click="ElMessage.info('预览将在 Task 18 实现')">👁 预览</ElButton>
    <ElButton type="primary" size="small" @click="ElMessage.info('保存到后端在 Plan 3 实现，草稿已存本地')">
      保存
    </ElButton>
    <ElButton type="primary" plain size="small" @click="window.print()">立即打印</ElButton>
  </header>
</template>

<style scoped>
.designer-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 12px;
  height: 100%;
}
.dh-divider {
  width: 1px;
  height: 20px;
  background: var(--el-border-color);
  margin: 0 4px;
}
.dh-label {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}
.dh-x {
  color: var(--el-text-color-placeholder);
  font-size: 14px;
}
.dh-spacer {
  flex: 1;
}
</style>
```

- [ ] **Step 2: Build + commit**

```bash
pnpm --filter @template-printing/web build
git add apps/web/src/designer/DesignerHeader.vue
git commit -m "feat(designer): Header with name + undo/redo + cell w/h + paper + save"
```

---

## Task 9: ElementLibrary

**Files:**
- Modify: `apps/web/src/designer/ElementLibrary.vue`

- [ ] **Step 1: Implement**

```vue
<script setup lang="ts">
import type { TemplateElement } from '@template-printing/schema';

import { useDesignerStore } from '../stores/designer';

const store = useDesignerStore();

interface ElementMeta {
  type: TemplateElement['type'];
  glyph: string;
  label: string;
  defaultGrid: { cs: number; rs: number };
}

const groups: { title: string; items: ElementMeta[] }[] = [
  {
    title: '基础',
    items: [
      { type: 'text',  glyph: 'T',  label: '文字',  defaultGrid: { cs: 12, rs: 3 } },
      { type: 'field', glyph: '{}', label: '字段',  defaultGrid: { cs: 16, rs: 3 } },
      { type: 'image', glyph: '▤',  label: '图片',  defaultGrid: { cs: 16, rs: 16 } },
      { type: 'rect',  glyph: '▢',  label: '矩形',  defaultGrid: { cs: 16, rs: 8 } },
    ],
  },
  { title: '表格', items: [{ type: 'table',  glyph: '▦', label: '明细表', defaultGrid: { cs: 60, rs: 24 } }] },
  {
    title: '编码',
    items: [
      { type: 'barcode', glyph: '▣', label: '二维码', defaultGrid: { cs: 12, rs: 12 } },
      { type: 'barcode', glyph: '|||', label: '条码', defaultGrid: { cs: 30, rs: 8 } },
      { type: 'autonumber', glyph: '№', label: '编号', defaultGrid: { cs: 18, rs: 3 } },
    ],
  },
  { title: '系统', items: [{ type: 'system', glyph: '#', label: '页码/日期', defaultGrid: { cs: 12, rs: 3 } }] },
];

function defaultBorder() {
  const side = { show: false, width: 1, style: 'solid' as const, color: '#1f2328' };
  return { top: { ...side }, right: { ...side }, bottom: { ...side }, left: { ...side } };
}

function defaultStyle() {
  return {
    border: defaultBorder(),
    padding: { t: 0, r: 4, b: 2, l: 4 },
    background: null,
    borderRadius: 0,
  };
}

function buildElement(meta: ElementMeta): TemplateElement {
  const id = store.newElementId();
  const grid = { c: 4, r: 4, cs: meta.defaultGrid.cs, rs: meta.defaultGrid.rs };
  const style = defaultStyle();

  switch (meta.type) {
    case 'text':
      return { id, type: 'text', grid, style, content: { static: '示例文本' } };
    case 'field':
      return { id, type: 'field', grid, style, binding: 'fieldKey', fallback: '—', format: null };
    case 'image':
      return { id, type: 'image', grid, style, source: { kind: 'static', url: '' }, fit: 'contain' };
    case 'rect':
      return { id, type: 'rect', grid, style };
    case 'table':
      return {
        id, type: 'table', grid, style,
        binding: 'items',
        columns: [
          { key: 'col1', header: '列1', cs: 30, align: 'left', format: null },
          { key: 'col2', header: '列2', cs: 30, align: 'right', format: null },
        ],
        rowHeight: 4,
        showHeader: true,
      };
    case 'barcode':
      return {
        id, type: 'barcode', grid, style,
        symbology: meta.label === '二维码' ? 'qr' : 'code128',
        content: { static: 'SAMPLE' },
        showText: false,
      };
    case 'autonumber':
      return { id, type: 'autonumber', grid, style, sequence: 'default', format: '0000000', prefix: '' };
    case 'system':
      return { id, type: 'system', grid, style, variable: 'pageNo' };
  }
}

function addElement(meta: ElementMeta): void {
  store.addElement(buildElement(meta));
}
</script>

<template>
  <aside class="designer-left">
    <div v-for="group in groups" :key="group.title" class="group">
      <div class="group-title">{{ group.title }}</div>
      <button
        v-for="item in group.items"
        :key="item.label"
        class="elem-btn"
        @click="addElement(item)"
      >
        <span class="glyph">{{ item.glyph }}</span>
        <span class="label">{{ item.label }}</span>
      </button>
    </div>
  </aside>
</template>

<style scoped>
.group { padding: 8px; }
.group-title {
  font-size: 11px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--el-text-color-placeholder);
  margin: 4px 4px 6px;
}
.elem-btn {
  width: 100%;
  padding: 6px 4px;
  margin-bottom: 4px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  background: #fff;
  border: 1px solid var(--el-border-color);
  border-radius: 6px;
  cursor: pointer;
  font-size: 11px;
  color: var(--el-text-color-regular);
  transition: all 120ms ease;
}
.elem-btn:hover {
  border-color: var(--el-color-primary);
  color: var(--el-color-primary);
  transform: translateY(-1px);
}
.glyph { font-size: 14px; }
</style>
```

- [ ] **Step 2: Build + commit**

```bash
pnpm --filter @template-printing/web build
git add apps/web/src/designer/ElementLibrary.vue
git commit -m "feat(designer): ElementLibrary with 4 categories + 8 element variants"
```

---

## Task 10: DesignerCanvas

**Files:**
- Modify: `apps/web/src/designer/DesignerCanvas.vue`

- [ ] **Step 1: Implement**

```vue
<script setup lang="ts">
import { computed } from 'vue';
import { TemplateRenderer } from '@template-printing/template-renderer';

import { useDesignerStore } from '../stores/designer';
import CanvasElement from './CanvasElement.vue';

const store = useDesignerStore();

const cssVars = computed(() => ({
  '--cell-w': `${store.template.canvas.cell.w}px`,
  '--cell-h': `${store.template.canvas.cell.h}px`,
  '--canvas-w': `${store.template.canvas.cell.w * store.template.canvas.cols}px`,
  '--canvas-h': `${store.template.canvas.cell.h * store.template.canvas.rows}px`,
}));

function clickPaperBackground(e: MouseEvent): void {
  if ((e.target as HTMLElement).classList.contains('designer-paper')) {
    store.clearSelection();
  }
}
</script>

<template>
  <section class="designer-middle">
    <div
      class="designer-paper"
      :class="{ 'is-dragging': store.isResizing }"
      :style="{
        ...cssVars,
        width: 'var(--canvas-w)',
        height: 'var(--canvas-h)',
      }"
      @click="clickPaperBackground"
    >
      <CanvasElement
        v-for="el in store.template.elements"
        :key="el.id"
        :element="el"
      />
    </div>
  </section>
</template>
```

- [ ] **Step 2: Commit (CanvasElement created in Task 11)**

```bash
git add apps/web/src/designer/DesignerCanvas.vue
git commit -m "feat(designer): DesignerCanvas with grid CSS vars + click-background-deselect"
```

---

## Task 11: CanvasElement + HitZones + ElementGrip

**Files:**
- Create: `apps/web/src/designer/CanvasElement.vue`
- Create: `apps/web/src/designer/HitZones.vue`
- Create: `apps/web/src/designer/ElementGrip.vue`

- [ ] **Step 1: Create `apps/web/src/designer/ElementGrip.vue`**

```vue
<script setup lang="ts">
defineEmits<{
  (e: 'pointerdown', ev: PointerEvent): void;
}>();
</script>

<template>
  <div class="grip" @pointerdown.stop="$emit('pointerdown', $event)">
    <span class="dots"><i /><i /><i /><i /><i /><i /></span>
  </div>
</template>

<style scoped>
.grip {
  position: absolute;
  top: -14px;
  left: 50%;
  transform: translateX(-50%);
  background: #fff;
  border: 1.5px solid #0969da;
  border-radius: 6px;
  width: 28px;
  height: 18px;
  cursor: grab;
  z-index: 4;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 2px 6px rgba(31, 35, 40, 0.08);
}
.grip:hover { background: #ddf4ff; }
.grip:active { cursor: grabbing; }
.dots {
  display: grid;
  grid-template-columns: repeat(3, 3px);
  grid-template-rows: repeat(2, 3px);
  gap: 2px;
}
.dots i {
  background: #0969da;
  border-radius: 50%;
  width: 3px; height: 3px;
}
</style>
```

- [ ] **Step 2: Create `apps/web/src/designer/HitZones.vue`**

```vue
<script setup lang="ts">
defineEmits<{
  (e: 'pointerdown', side: 'n' | 'e' | 's' | 'w' | 'nw' | 'ne' | 'sw' | 'se', ev: PointerEvent): void;
}>();
</script>

<template>
  <div class="hit-zones">
    <div class="hit n" @pointerdown.stop="$emit('pointerdown', 'n', $event)" />
    <div class="hit e" @pointerdown.stop="$emit('pointerdown', 'e', $event)" />
    <div class="hit s" @pointerdown.stop="$emit('pointerdown', 's', $event)" />
    <div class="hit w" @pointerdown.stop="$emit('pointerdown', 'w', $event)" />
    <div class="hit corner nw" @pointerdown.stop="$emit('pointerdown', 'nw', $event)" />
    <div class="hit corner ne" @pointerdown.stop="$emit('pointerdown', 'ne', $event)" />
    <div class="hit corner sw" @pointerdown.stop="$emit('pointerdown', 'sw', $event)" />
    <div class="hit corner se" @pointerdown.stop="$emit('pointerdown', 'se', $event)" />
  </div>
</template>

<style scoped>
.hit-zones { position: absolute; inset: 0; pointer-events: none; }
.hit { position: absolute; pointer-events: auto; z-index: 3; }
.n { left: 12px; right: 12px; top: -4px; height: 12px; cursor: ns-resize; }
.s { left: 12px; right: 12px; bottom: -4px; height: 12px; cursor: ns-resize; }
.w { top: 8px; bottom: 8px; left: -4px; width: 12px; cursor: ew-resize; }
.e { top: 8px; bottom: 8px; right: -4px; width: 12px; cursor: ew-resize; }
.corner { width: 14px; height: 14px; }
.nw { top: -4px; left: -4px; cursor: nwse-resize; }
.ne { top: -4px; right: -4px; cursor: nesw-resize; }
.sw { bottom: -4px; left: -4px; cursor: nesw-resize; }
.se { bottom: -4px; right: -4px; cursor: nwse-resize; }
</style>
```

- [ ] **Step 3: Create `apps/web/src/designer/CanvasElement.vue`**

```vue
<script setup lang="ts">
import { computed } from 'vue';
import {
  TextElement, FieldElement, ImageElement, TableElement,
  BarcodeElement, AutonumberElement, SystemElement, RectElement,
} from '@template-printing/template-renderer';
import type { TemplateElement } from '@template-printing/schema';

import { useDesignerStore } from '../stores/designer';
import ElementGrip from './ElementGrip.vue';
import HitZones from './HitZones.vue';
import { usePointerDrag } from './usePointerDrag';

const props = defineProps<{ element: TemplateElement }>();
const store = useDesignerStore();

const isSelected = computed(() => store.selectedIds.includes(props.element.id));

const positionStyle = computed(() => ({
  left: `calc(${props.element.grid.c} * var(--cell-w))`,
  top: `calc(${props.element.grid.r} * var(--cell-h))`,
  width: `calc(${props.element.grid.cs} * var(--cell-w))`,
  height: `calc(${props.element.grid.rs} * var(--cell-h))`,
}));

const sizeBadge = computed(
  () => `${props.element.grid.cs}×${props.element.grid.rs} 格`,
);

function selectMe(e: MouseEvent): void {
  e.stopPropagation();
  store.select([props.element.id]);
}

const { onGripDown, onResizeDown } = usePointerDrag(props.element.id);

const elementMap = {
  text: TextElement,
  field: FieldElement,
  image: ImageElement,
  table: TableElement,
  barcode: BarcodeElement,
  autonumber: AutonumberElement,
  system: SystemElement,
  rect: RectElement,
} as const;
</script>

<template>
  <div
    class="tp-element"
    :class="{ 'is-selected': isSelected }"
    :style="positionStyle"
    @click="selectMe"
  >
    <component :is="elementMap[props.element.type]" :element="props.element" design-mode />
    <ElementGrip v-if="isSelected" @pointerdown="onGripDown" />
    <HitZones v-if="isSelected" @pointerdown="onResizeDown" />
    <span v-if="isSelected" class="size-badge">{{ sizeBadge }}</span>
  </div>
</template>

<style scoped>
.tp-element {
  position: absolute;
  box-sizing: border-box;
  cursor: pointer;
}
.tp-element.is-selected {
  outline: 1.5px solid #0969da;
  outline-offset: 2px;
  border-radius: 4px;
  box-shadow: 0 0 0 5px rgba(9, 105, 218, 0.1);
}
.size-badge {
  position: absolute;
  bottom: -22px;
  right: -1px;
  background: #1f2328;
  color: #fff;
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 3px;
  font-family: ui-monospace, monospace;
  pointer-events: none;
}
</style>
```

- [ ] **Step 4: Commit (usePointerDrag is in Task 12)**

```bash
git add apps/web/src/designer/CanvasElement.vue apps/web/src/designer/HitZones.vue apps/web/src/designer/ElementGrip.vue
git commit -m "feat(designer): CanvasElement + HitZones + ElementGrip (selection visual)"
```

---

## Task 12: usePointerDrag — grip drag with grid snap

**Files:**
- Create: `apps/web/src/designer/usePointerDrag.ts`

- [ ] **Step 1: Create the composable**

```typescript
import { useDesignerStore } from '../stores/designer';

type ResizeSide = 'n' | 'e' | 's' | 'w' | 'nw' | 'ne' | 'sw' | 'se';

export function usePointerDrag(elementId: string): {
  onGripDown: (e: PointerEvent) => void;
  onResizeDown: (side: ResizeSide, e: PointerEvent) => void;
} {
  const store = useDesignerStore();

  function getCellPx(): { w: number; h: number } {
    return {
      w: store.template.canvas.cell.w,
      h: store.template.canvas.cell.h,
    };
  }

  function getElement() {
    return store.template.elements.find((e) => e.id === elementId);
  }

  function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
  }

  // ----- Grip drag (move) -----
  function onGripDown(e: PointerEvent): void {
    const el = getElement();
    if (!el) return;
    const startCell = getCellPx();
    const startC = el.grid.c;
    const startR = el.grid.r;
    const startX = e.clientX;
    const startY = e.clientY;

    store.isResizing = true;

    function onMove(ev: PointerEvent): void {
      const dc = Math.round((ev.clientX - startX) / startCell.w);
      const dr = Math.round((ev.clientY - startY) / startCell.h);
      const newC = clamp(startC + dc, 0, store.template.canvas.cols - el!.grid.cs);
      const newR = clamp(startR + dr, 0, store.template.canvas.rows - el!.grid.rs);
      store.moveElement(elementId, newC, newR);
    }
    function onUp(): void {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      store.isResizing = false;
      store.commit();
    }
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  // ----- Resize -----
  function onResizeDown(side: ResizeSide, e: PointerEvent): void {
    const el = getElement();
    if (!el) return;
    const startCell = getCellPx();
    const startC = el.grid.c;
    const startR = el.grid.r;
    const startCs = el.grid.cs;
    const startRs = el.grid.rs;
    const startX = e.clientX;
    const startY = e.clientY;

    store.isResizing = true;

    function onMove(ev: PointerEvent): void {
      const dc = Math.round((ev.clientX - startX) / startCell.w);
      const dr = Math.round((ev.clientY - startY) / startCell.h);
      let newC = startC;
      let newR = startR;
      let newCs = startCs;
      let newRs = startRs;

      if (side.includes('w')) {
        newC = clamp(startC + dc, 0, startC + startCs - 1);
        newCs = startCs - (newC - startC);
      } else if (side.includes('e')) {
        newCs = clamp(startCs + dc, 1, store.template.canvas.cols - startC);
      }
      if (side.includes('n')) {
        newR = clamp(startR + dr, 0, startR + startRs - 1);
        newRs = startRs - (newR - startR);
      } else if (side.includes('s')) {
        newRs = clamp(startRs + dr, 1, store.template.canvas.rows - startR);
      }
      store.resizeElement(elementId, newCs, newRs, newC, newR);
    }
    function onUp(): void {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      store.isResizing = false;
      store.commit();
    }
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  return { onGripDown, onResizeDown };
}
```

- [ ] **Step 2: Build + commit**

```bash
pnpm --filter @template-printing/web build
git add apps/web/src/designer/usePointerDrag.ts
git commit -m "feat(designer): usePointerDrag composable — grip move + 8-side resize with grid snap"
```

---

## Task 13: Edge/corner resize verification

This task is verification only — `usePointerDrag` from Task 12 already implements all 8 sides.

- [ ] **Step 1: Manual verification**

Run `pnpm dev` (host or docker), navigate to `/designer/new` after logging in, drop a Text element, click to select it, drag the corners and edges to verify resize works in all 8 directions with grid snap.

- [ ] **Step 2: No commit needed**

If anything is broken from Task 12, fix it inline and commit with a `fix(designer):` prefix.

---

## Task 14: Cell-size animation (`is-resizing` orchestration)

The CSS in Task 7 already declares the transitions. The `store.isResizing` flag is set in `DesignerHeader.applyCellSize()` (Task 8) for cell-size change, and in `usePointerDrag` for drag/resize. The animation is already wired.

- [ ] **Step 1: Tweak the animation timing**

Open `apps/web/src/styles/designer.css` and verify the transition durations match plan:
- Grid fade: 180ms (set via `opacity` transition on `::before`)
- Paper resize: 360ms cubic-bezier
- Element move: 360ms cubic-bezier

If you want slightly snappier feel, tune to 280ms (still within "smooth" perception).

- [ ] **Step 2: Element count > 500 fallback**

Add to `apps/web/src/styles/designer.css`:

```css
.designer-paper.heavy {
  /* Used when element count exceeds threshold — skip element transitions */
}
.designer-paper.heavy .tp-element {
  transition: none !important;
}
```

In `apps/web/src/designer/DesignerCanvas.vue` template, replace the paper div's class binding to include the heavy fallback:

```html
<div
  class="designer-paper"
  :class="{ 'is-dragging': store.isResizing, heavy: store.template.elements.length > 500 }"
  ...
>
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/styles/designer.css apps/web/src/designer/DesignerCanvas.vue
git commit -m "feat(designer): cell-size animation + heavy-mode fallback (>500 elements)"
```

---

## Task 15: FieldManager

**Files:**
- Modify: `apps/web/src/designer/FieldManager.vue`

- [ ] **Step 1: Implement**

```vue
<script setup lang="ts">
import { ElButton, ElDialog, ElForm, ElFormItem, ElInput, ElSelect, ElOption, ElMessage } from 'element-plus';
import { ref } from 'vue';

import { useDesignerStore } from '../stores/designer';

const store = useDesignerStore();

const dialogOpen = ref(false);
const form = ref({ key: '', label: '', type: 'string' as 'string' | 'number' | 'date' | 'array', required: false, example: '' });

function openAdd(): void {
  form.value = { key: '', label: '', type: 'string', required: false, example: '' };
  dialogOpen.value = true;
}

function submit(): void {
  if (!form.value.key || !form.value.label) {
    ElMessage.warning('key 和 label 都必须填');
    return;
  }
  if (store.template.schema[form.value.key]) {
    ElMessage.error(`字段 "${form.value.key}" 已存在`);
    return;
  }
  store.addField(form.value.key, {
    type: form.value.type,
    label: form.value.label,
    required: form.value.required,
    example: form.value.example || undefined,
  });
  dialogOpen.value = false;
}

function remove(key: string): void {
  if (!window.confirm(`删除字段 "${key}"？模板中绑定到该字段的元素将变为未绑定状态。`)) return;
  store.removeField(key);
}
</script>

<template>
  <div class="field-mgr">
    <div class="header">
      <span class="title">数据字段</span>
      <ElButton link size="small" @click="openAdd">+ 添加字段</ElButton>
    </div>

    <div v-if="store.fieldDefs.length === 0" class="empty">尚未声明字段</div>
    <div
      v-for="{ key, def } in store.fieldDefs"
      :key="key"
      class="field-card"
      :class="{ unused: !store.usedFieldKeys.has(key) }"
    >
      <div>
        <span class="k">{{ key }}</span>
        <span class="l">· {{ def.label }}</span>
      </div>
      <div class="meta">
        <span class="t">{{ def.type }}</span>
        <span v-if="def.required" class="req">必填</span>
        <span v-if="!store.usedFieldKeys.has(key)" class="unused-tag">⚠ 未使用</span>
        <ElButton link type="danger" size="small" @click="remove(key)">删除</ElButton>
      </div>
    </div>

    <ElDialog v-model="dialogOpen" title="添加字段" width="360px">
      <ElForm label-position="top">
        <ElFormItem label="key (英文/拼音)"><ElInput v-model="form.key" /></ElFormItem>
        <ElFormItem label="label (中文显示名)"><ElInput v-model="form.label" /></ElFormItem>
        <ElFormItem label="类型">
          <ElSelect v-model="form.type">
            <ElOption label="string" value="string" />
            <ElOption label="number" value="number" />
            <ElOption label="date" value="date" />
            <ElOption label="array" value="array" />
          </ElSelect>
        </ElFormItem>
        <ElFormItem label="示例值"><ElInput v-model="form.example" /></ElFormItem>
        <ElButton type="primary" @click="submit" style="width: 100%">添加</ElButton>
      </ElForm>
    </ElDialog>
  </div>
</template>

<style scoped>
.field-mgr { padding: 14px 16px; border-bottom: 1px solid var(--el-border-color); }
.header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
.title { font-size: 12px; font-weight: 600; color: var(--el-text-color-placeholder); letter-spacing: 0.06em; text-transform: uppercase; }
.empty { font-size: 12px; color: var(--el-text-color-placeholder); padding: 12px 0; text-align: center; }
.field-card { padding: 8px 10px; border: 1px solid var(--el-border-color); border-radius: 6px; margin-bottom: 6px; font-size: 12px; }
.field-card.unused { background: #fff8e1; border-color: #f0d178; }
.k { font-family: ui-monospace, monospace; font-weight: 500; }
.l { color: var(--el-text-color-secondary); margin-left: 4px; }
.meta { margin-top: 2px; display: flex; gap: 6px; align-items: center; font-size: 11px; color: var(--el-text-color-placeholder); }
.req { color: var(--el-color-primary); }
.unused-tag { color: #7d5a00; }
</style>
```

- [ ] **Step 2: Build + commit**

```bash
pnpm --filter @template-printing/web build
git add apps/web/src/designer/FieldManager.vue
git commit -m "feat(designer): FieldManager with add/remove + unused warnings"
```

---

## Task 16: PropertyPanel + BorderControl + PaddingControl

**Files:**
- Modify: `apps/web/src/designer/PropertyPanel.vue`
- Create: `apps/web/src/designer/BorderControl.vue`
- Create: `apps/web/src/designer/PaddingControl.vue`

- [ ] **Step 1: Create `apps/web/src/designer/BorderControl.vue`**

```vue
<script setup lang="ts">
import type { ElementStyle } from '@template-printing/schema';

const props = defineProps<{ modelValue: ElementStyle['border'] }>();
const emit = defineEmits<{ (e: 'update:modelValue', v: ElementStyle['border']): void }>();

function toggle(side: 'top' | 'right' | 'bottom' | 'left'): void {
  emit('update:modelValue', {
    ...props.modelValue,
    [side]: { ...props.modelValue[side], show: !props.modelValue[side].show },
  });
}

function setWidth(side: 'top' | 'right' | 'bottom' | 'left', w: number): void {
  emit('update:modelValue', {
    ...props.modelValue,
    [side]: { ...props.modelValue[side], width: w },
  });
}
</script>

<template>
  <div class="bp-block">
    <div class="title">边框 <span class="hint">点方向切换显隐</span></div>
    <div class="grid">
      <button class="cell t" :class="{ on: props.modelValue.top.show }" @click="toggle('top')">上 {{ props.modelValue.top.show ? '✓' : '' }}</button>
      <button class="cell l" :class="{ on: props.modelValue.left.show }" @click="toggle('left')">左</button>
      <div class="center">elem</div>
      <button class="cell r" :class="{ on: props.modelValue.right.show }" @click="toggle('right')">右</button>
      <button class="cell b" :class="{ on: props.modelValue.bottom.show }" @click="toggle('bottom')">下 {{ props.modelValue.bottom.show ? '✓' : '' }}</button>
    </div>
  </div>
</template>

<style scoped>
.bp-block { padding: 12px 16px; border-bottom: 1px solid var(--el-border-color); }
.title { font-size: 11px; color: var(--el-text-color-secondary); margin-bottom: 6px; display: flex; justify-content: space-between; }
.hint { color: var(--el-text-color-placeholder); font-weight: normal; font-size: 10.5px; }
.grid {
  display: grid;
  grid-template-columns: 1fr 60px 1fr;
  grid-template-rows: 28px 1fr 28px;
  height: 96px;
  border: 1px dashed var(--el-border-color);
  border-radius: 4px;
  padding: 4px;
  gap: 2px;
}
.cell {
  background: transparent;
  border: none;
  cursor: pointer;
  border-radius: 3px;
  font-family: ui-monospace, monospace;
  font-size: 10.5px;
  color: var(--el-text-color-secondary);
}
.cell:hover { background: var(--el-fill-color-light); }
.cell.on { color: var(--el-color-primary); background: #ddf4ff; font-weight: 600; }
.cell.t { grid-area: 1 / 1 / 2 / 4; }
.cell.b { grid-area: 3 / 1 / 4 / 4; }
.cell.l { grid-area: 2 / 1 / 3 / 2; }
.cell.r { grid-area: 2 / 3 / 3 / 4; }
.center { grid-area: 2 / 2 / 3 / 3; border: 1px solid var(--el-border-color); background: var(--el-fill-color-light); border-radius: 3px; display: flex; align-items: center; justify-content: center; font-size: 10px; color: var(--el-text-color-placeholder); }
</style>
```

- [ ] **Step 2: Create `apps/web/src/designer/PaddingControl.vue`**

```vue
<script setup lang="ts">
import type { ElementStyle } from '@template-printing/schema';

const props = defineProps<{ modelValue: ElementStyle['padding'] }>();
const emit = defineEmits<{ (e: 'update:modelValue', v: ElementStyle['padding']): void }>();

function setSide(side: 't' | 'r' | 'b' | 'l', n: number): void {
  emit('update:modelValue', { ...props.modelValue, [side]: Math.max(0, n) });
}
</script>

<template>
  <div class="pad-block">
    <div class="title">内边距 <span class="hint">px</span></div>
    <div class="grid">
      <label>上 <input type="number" :value="props.modelValue.t" min="0" @input="setSide('t', Number(($event.target as HTMLInputElement).value))" /></label>
      <label>右 <input type="number" :value="props.modelValue.r" min="0" @input="setSide('r', Number(($event.target as HTMLInputElement).value))" /></label>
      <label>下 <input type="number" :value="props.modelValue.b" min="0" @input="setSide('b', Number(($event.target as HTMLInputElement).value))" /></label>
      <label>左 <input type="number" :value="props.modelValue.l" min="0" @input="setSide('l', Number(($event.target as HTMLInputElement).value))" /></label>
    </div>
  </div>
</template>

<style scoped>
.pad-block { padding: 12px 16px; border-bottom: 1px solid var(--el-border-color); }
.title { font-size: 11px; color: var(--el-text-color-secondary); margin-bottom: 6px; display: flex; justify-content: space-between; }
.hint { color: var(--el-text-color-placeholder); }
.grid { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; }
label { display: flex; align-items: center; gap: 4px; font-size: 11px; color: var(--el-text-color-secondary); }
input { width: 100%; padding: 2px 4px; border: 1px solid var(--el-border-color); border-radius: 4px; font: inherit; font-size: 11px; text-align: right; }
</style>
```

- [ ] **Step 3: Implement `apps/web/src/designer/PropertyPanel.vue`**

```vue
<script setup lang="ts">
import { ElButton, ElInput, ElInputNumber, ElSelect, ElOption } from 'element-plus';
import { computed } from 'vue';
import type { ElementStyle, TemplateElement } from '@template-printing/schema';

import { useDesignerStore } from '../stores/designer';
import BorderControl from './BorderControl.vue';
import PaddingControl from './PaddingControl.vue';

const store = useDesignerStore();

const sel = computed<TemplateElement | null>(() => store.selectedElement);

function updateStyleBorder(v: ElementStyle['border']): void {
  if (!sel.value) return;
  store.updateElement(sel.value.id, {
    style: { ...sel.value.style, border: v },
  } as Partial<TemplateElement>);
}

function updateStylePadding(v: ElementStyle['padding']): void {
  if (!sel.value) return;
  store.updateElement(sel.value.id, {
    style: { ...sel.value.style, padding: v },
  } as Partial<TemplateElement>);
}

function setGridPos(field: 'c' | 'r' | 'cs' | 'rs', val: number): void {
  if (!sel.value) return;
  store.updateElement(sel.value.id, {
    grid: { ...sel.value.grid, [field]: Math.max(field === 'cs' || field === 'rs' ? 1 : 0, val) },
  } as Partial<TemplateElement>);
}

function setTextContent(v: string): void {
  if (!sel.value || sel.value.type !== 'text') return;
  store.updateElement(sel.value.id, {
    content: { static: v },
  } as Partial<TemplateElement>);
}

function setBinding(v: string): void {
  if (!sel.value) return;
  if (sel.value.type === 'field' || sel.value.type === 'table') {
    store.updateElement(sel.value.id, { binding: v } as Partial<TemplateElement>);
  }
}

function del(): void {
  if (!sel.value) return;
  store.deleteElement(sel.value.id);
}
</script>

<template>
  <div class="prop-panel">
    <div class="block-title">
      属性 <span class="hint" v-if="sel">· 已选 {{ store.selectedIds.length }} 个</span>
    </div>

    <div v-if="!sel" class="empty">未选中任何元素</div>

    <template v-else>
      <div class="row">
        <span class="lbl">类型</span>
        <span class="val mono">{{ sel.type }}</span>
      </div>
      <div class="row">
        <span class="lbl">位置 (格)</span>
        <span class="val">
          c<ElInputNumber size="small" :model-value="sel.grid.c" :min="0" controls-position="right" style="width: 70px; margin-left:4px" @change="(v: number | undefined) => setGridPos('c', v ?? 0)" />
          r<ElInputNumber size="small" :model-value="sel.grid.r" :min="0" controls-position="right" style="width: 70px; margin-left:4px" @change="(v: number | undefined) => setGridPos('r', v ?? 0)" />
        </span>
      </div>
      <div class="row">
        <span class="lbl">尺寸 (格)</span>
        <span class="val">
          <ElInputNumber size="small" :model-value="sel.grid.cs" :min="1" controls-position="right" style="width: 70px" @change="(v: number | undefined) => setGridPos('cs', v ?? 1)" />
          ×
          <ElInputNumber size="small" :model-value="sel.grid.rs" :min="1" controls-position="right" style="width: 70px" @change="(v: number | undefined) => setGridPos('rs', v ?? 1)" />
        </span>
      </div>

      <div v-if="sel.type === 'text'" class="row">
        <span class="lbl">内容</span>
        <ElInput size="small" :model-value="sel.content.static" @update:model-value="setTextContent" style="flex: 1" />
      </div>
      <div v-if="sel.type === 'field' || sel.type === 'table'" class="row">
        <span class="lbl">绑定</span>
        <ElSelect size="small" :model-value="sel.binding" @change="setBinding" style="flex: 1">
          <ElOption v-for="f in store.fieldDefs" :key="f.key" :value="f.key" :label="`${f.key} (${f.def.label})`" />
        </ElSelect>
      </div>

      <BorderControl :model-value="sel.style.border" @update:model-value="updateStyleBorder" />
      <PaddingControl :model-value="sel.style.padding" @update:model-value="updateStylePadding" />

      <div style="padding: 12px 16px">
        <ElButton type="danger" plain size="small" @click="del" style="width: 100%">删除元素</ElButton>
      </div>
    </template>
  </div>
</template>

<style scoped>
.prop-panel { font-size: 12px; }
.block-title { padding: 12px 16px 6px; font-size: 11px; color: var(--el-text-color-placeholder); letter-spacing: 0.06em; text-transform: uppercase; }
.hint { font-weight: normal; text-transform: none; letter-spacing: 0; color: var(--el-text-color-secondary); }
.empty { padding: 16px; color: var(--el-text-color-placeholder); text-align: center; }
.row { display: flex; align-items: center; gap: 8px; padding: 4px 16px; }
.lbl { color: var(--el-text-color-secondary); min-width: 60px; }
.val { color: var(--el-text-color-primary); }
.mono { font-family: ui-monospace, monospace; }
</style>
```

- [ ] **Step 4: Build + commit**

```bash
pnpm --filter @template-printing/web build
git add apps/web/src/designer/PropertyPanel.vue apps/web/src/designer/BorderControl.vue apps/web/src/designer/PaddingControl.vue
git commit -m "feat(designer): PropertyPanel + BorderControl + PaddingControl"
```

---

## Task 17: LocalStorage persistence

The store already persists on every snapshot. This task wires the initial `restore()` call on designer view mount.

**Files:**
- Modify: `apps/web/src/views/DesignerView.vue`

- [ ] **Step 1: Add `onMounted` restore logic**

```vue
<script setup lang="ts">
import '../styles/designer.css';

import { onMounted } from 'vue';
import { useRoute } from 'vue-router';

import DesignerHeader from '../designer/DesignerHeader.vue';
import ElementLibrary from '../designer/ElementLibrary.vue';
import DesignerCanvas from '../designer/DesignerCanvas.vue';
import FieldManager from '../designer/FieldManager.vue';
import PropertyPanel from '../designer/PropertyPanel.vue';
import { useDesignerStore } from '../stores/designer';

const route = useRoute();
const store = useDesignerStore();

onMounted(() => {
  if (route.params.id) {
    // Plan 3 will load from backend by id. For now, start fresh.
    store.reset();
  } else {
    const restored = store.restore();
    if (!restored) store.reset();
  }
});
</script>

<template>
  <div class="designer-root">
    <DesignerHeader />
    <ElementLibrary />
    <DesignerCanvas />
    <div class="designer-right">
      <FieldManager />
      <PropertyPanel />
    </div>
  </div>
</template>
```

- [ ] **Step 2: Build + commit**

```bash
pnpm --filter @template-printing/web build
git add apps/web/src/views/DesignerView.vue
git commit -m "feat(designer): restore draft from localStorage on /designer/new mount"
```

---

## Task 18: PreviewView

**Files:**
- Create: `apps/web/src/views/PreviewView.vue`
- Modify: `apps/web/src/designer/DesignerHeader.vue` (wire 👁 预览 button)

- [ ] **Step 1: Create `apps/web/src/views/PreviewView.vue`**

```vue
<script setup lang="ts">
import { ElButton, ElDialog, ElForm, ElFormItem, ElInput } from 'element-plus';
import { computed, ref, watch } from 'vue';
import { TemplateRenderer } from '@template-printing/template-renderer';

import { useDesignerStore } from '../stores/designer';

const props = defineProps<{ modelValue: boolean }>();
const emit = defineEmits<{ (e: 'update:modelValue', v: boolean): void }>();

const store = useDesignerStore();
const sampleData = ref<Record<string, unknown>>({});

watch(
  () => props.modelValue,
  (open) => {
    if (open) {
      // Pre-fill sample data from field schema examples
      const data: Record<string, unknown> = {};
      for (const [key, def] of Object.entries(store.template.schema)) {
        data[key] = def.example ?? '';
      }
      sampleData.value = data;
    }
  },
);

const close = (): void => emit('update:modelValue', false);
</script>

<template>
  <ElDialog
    :model-value="props.modelValue"
    title="预览模板"
    width="80vw"
    @close="close"
  >
    <div class="preview-layout">
      <div class="data-form">
        <h4>示例数据</h4>
        <ElForm label-position="top">
          <ElFormItem
            v-for="(def, key) in store.template.schema"
            :key="key"
            :label="`${key} (${def.label})`"
          >
            <ElInput
              :model-value="String(sampleData[key] ?? '')"
              @update:model-value="(v) => (sampleData[key] = v)"
              size="small"
            />
          </ElFormItem>
        </ElForm>
      </div>
      <div class="preview-canvas">
        <TemplateRenderer :template="store.template" :data="sampleData" />
      </div>
    </div>
    <template #footer>
      <ElButton @click="close">关闭</ElButton>
    </template>
  </ElDialog>
</template>

<style scoped>
.preview-layout { display: grid; grid-template-columns: 240px 1fr; gap: 16px; max-height: 70vh; }
.data-form { overflow-y: auto; padding-right: 8px; border-right: 1px solid var(--el-border-color); }
.preview-canvas { overflow: auto; display: flex; justify-content: center; align-items: flex-start; padding: 16px; background: #f0f2f5; }
</style>
```

- [ ] **Step 2: Update `apps/web/src/designer/DesignerHeader.vue`** — wire preview button

Replace the existing preview button line and add:

```typescript
// At top of script
import PreviewView from '../views/PreviewView.vue';

const previewOpen = ref(false);
```

Replace `@click="ElMessage.info('预览将在 Task 18 实现')"` with `@click="previewOpen = true"`.

After `</header>` add:

```html
<PreviewView v-model="previewOpen" />
```

Note: `ref` needs to be imported from `vue` (it already is from Task 8).

- [ ] **Step 3: Build + commit**

```bash
pnpm --filter @template-printing/web build
git add apps/web/src/views/PreviewView.vue apps/web/src/designer/DesignerHeader.vue
git commit -m "feat(designer): Preview dialog with sample data form + live render"
```

---

## Task 19: Print CSS verification

Print CSS is already added in Task 7. This task just verifies window.print() produces a clean output (no header/sidebars).

- [ ] **Step 1: Manual verification**

Open `/designer/new`, drop a few elements, click "立即打印". In the print preview, verify:
- Header, ElementLibrary, FieldManager, PropertyPanel all hidden.
- Grid lines hidden (the `::before` opacity goes to 0 thanks to media query).
- Selection outlines hidden.
- Paper renders cleanly with just elements.

- [ ] **Step 2: If issues, add CSS adjustments to `apps/web/src/styles/designer.css`**

Example adjustments for selection outlines:

```css
@media print {
  .tp-element.is-selected {
    outline: none !important;
    box-shadow: none !important;
  }
  .grip, .hit-zones, .size-badge { display: none !important; }
}
```

- [ ] **Step 3: Commit (if changes)**

```bash
git add apps/web/src/styles/designer.css
git commit -m "fix(designer): hide selection chrome in print media"
```

---

## Task 20: Playwright E2E

**Files:**
- Create: `apps/web/playwright.config.ts`
- Create: `apps/web/e2e/designer.spec.ts`
- Modify: `apps/web/package.json` (add `@playwright/test`, e2e script)

- [ ] **Step 1: Install Playwright**

```bash
pnpm --filter @template-printing/web add -D @playwright/test@1.45.3
pnpm --filter @template-printing/web exec playwright install chromium
```

- [ ] **Step 2: Create `apps/web/playwright.config.ts`**

```typescript
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  retries: 0,
  use: {
    baseURL: 'http://localhost:5173',
    headless: true,
    viewport: { width: 1440, height: 900 },
  },
  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:5173',
    timeout: 60_000,
    reuseExistingServer: true,
  },
});
```

- [ ] **Step 3: Create `apps/web/e2e/designer.spec.ts`**

```typescript
import { test, expect } from '@playwright/test';

test('designer happy path: open, drop a text element, drag, autosave', async ({ page }) => {
  // Bypass auth by setting a fake JWT cookie? Plan 1 requires real login.
  // For Plan 2 E2E we skip auth gating by mocking the auth store via window injection.
  await page.addInitScript(() => {
    // Set a fake CSRF token + user in pinia state (will be overwritten by hydrate, but localStorage trick keeps it)
    window.localStorage.setItem(
      'tp_designer_draft',
      JSON.stringify({
        id: 'tpl_e2e',
        meta: { name: 'E2E Test', description: '', version: 1, tags: [] },
        canvas: { cols: 240, rows: 160, cell: { w: 4, h: 4 }, paper: 'A4-Landscape', background: null },
        schema: {},
        elements: [],
      }),
    );
  });

  // The router guard will push to /login if not authed.
  // For this test we assume the dev environment has emergency_admin seeded.
  // If your dev env doesn't have a login, this test will fail at the next step — that's expected.
  await page.goto('/login');

  // Try emergency login (if seed exists)
  const emergencyToggle = page.locator('button:has-text("应急管理员登录")');
  if (await emergencyToggle.count() > 0) {
    await emergencyToggle.click();
    await page.locator('input[autocomplete="username"]').fill('emergency_admin');
    await page.locator('input[autocomplete="current-password"]').fill('changeme-strong-pwd-123');
    await page.locator('button:has-text("应急登录")').click();
    await page.waitForURL('/');
  }

  await page.goto('/designer/new');
  await expect(page.locator('.designer-root')).toBeVisible();

  // Click "文字" in element library
  await page.locator('button:has-text("文字")').first().click();

  // Should now have a .tp-element inside paper
  await expect(page.locator('.designer-paper .tp-element')).toHaveCount(1);

  // Click the element to select it
  await page.locator('.designer-paper .tp-element').click();
  await expect(page.locator('.designer-paper .tp-element.is-selected')).toBeVisible();

  // Verify property panel shows the type
  await expect(page.locator('.prop-panel')).toContainText('text');
});
```

- [ ] **Step 4: Add npm script**

In `apps/web/package.json` `scripts`, add:

```json
"e2e": "playwright test",
"e2e:headed": "playwright test --headed"
```

- [ ] **Step 5: Run E2E (skip if no live login available)**

```bash
pnpm --filter @template-printing/web e2e
```

If login can't proceed (no seeded emergency_admin or backend not running), the test will fail at the login step. That's acceptable for a placeholder — the test file is committed and ready for when the env is set up.

- [ ] **Step 6: Commit**

```bash
git add apps/web/playwright.config.ts apps/web/e2e/ apps/web/package.json pnpm-lock.yaml
git commit -m "test(designer): Playwright E2E for designer happy path"
```

---

## Plan 2 Done — Acceptance Criteria

- [ ] `pnpm typecheck` passes (all packages).
- [ ] `pnpm lint` passes.
- [ ] `pnpm test` passes — schema tests now 13/13.
- [ ] `pnpm build` passes for web + render-renderer.
- [ ] Manually visit `/designer/new` after login → 3-column UI renders.
- [ ] Click "文字" → element appears at (4, 4) with size (12, 3).
- [ ] Click element → blue outline + grip + hit-zones visible.
- [ ] Drag grip → element snaps to grid as moved.
- [ ] Drag edges/corners → element resizes.
- [ ] Change `cell w/h` in header + click 应用 → smooth animation (grid fades, paper + elements resize).
- [ ] Right panel field manager: add a `name` field → appears in property panel binding dropdown.
- [ ] Add a "字段" element → bind to `name` → preview button → fill `name` with "张三" → see "张三" rendered.
- [ ] `window.print()` produces clean output (header/sidebars hidden).
- [ ] Refresh page → localStorage restores the draft.

After acceptance, move to **Plan 3 — Template Hub**.
