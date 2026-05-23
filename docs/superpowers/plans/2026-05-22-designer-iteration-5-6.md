# Designer Iteration 5+6 Implementation Plan (merged)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land both designer iteration 5 (barcode/QR split, content source picker, field editing, type-filtered bindings) and iteration 6 (UI polish + Lucide icon migration) as one continuous batch, avoiding double-editing the same files.

**Architecture:** iteration 5 schema/architectural changes land first (split element types, FieldElement.binding relaxation, store migration). Then iteration 6 polish (clear-all, rename, SliderWithInput, font-weight labels, 布局·高级 section, Lucide icons) layers on top. Per-file edits from both iterations are bundled into single tasks where they overlap (FieldManager, PropertyPanel, BorderControl, ElementLibrary, CanvasElementsList).

**Tech Stack:** Vue 3 SFC, Pinia, Zod, `lucide-vue-next` (new dependency).

**Source specs:**
- `docs/superpowers/specs/2026-05-22-designer-iteration-5-design.md`
- `docs/superpowers/specs/2026-05-22-designer-iteration-6-design.md`

**Conventions in this repo (read before starting):**
- ESLint `import/no-unresolved` doesn't understand workspace package names or `vue` / `pinia` / `zod` / `lucide-vue-next` under bundler resolution. Existing files use `// eslint-disable-next-line import/no-unresolved` immediately above each such import. Follow that pattern; do not edit `.eslintrc.cjs`.
- Schema package imports use `.js` extension even when the file is `.ts`.
- Dev environment runs in docker. Command template:
  `docker compose -f docker-compose.dev.yml exec -T web sh -c 'cd /workspace/<dir> && <cmd>'`
- Type-check: `NODE_OPTIONS=--max-old-space-size=4096 ./node_modules/.bin/vue-tsc --noEmit` (use 8192 for the final pass).
- Do **not** skip git hooks. The pre-commit lint-staged hook is the authoritative formatter and linter.

---

## File Structure

### Schema
- **Modify** `packages/schema/src/template.ts`
  - Add `QrElementSchema` (new element type).
  - Modify `BarcodeElementSchema`: drop `qr` from symbology; drop `eccLevel`; drop `ean8`/`upc-a`; relax binding to optional empty.
  - Add `QrElementSchema` to `ElementSchema` discriminated union.
  - Relax `FieldElementSchema.binding` from `z.string().min(1)` to `z.string()`.

- **Modify** `packages/schema/test/template.spec.ts`
  - Add tests for new QrElement variant + relaxed FieldElement.binding.

### Renderer
- **Modify** `packages/template-renderer/src/elements/BarcodeElement.vue`
  - Remove all QR-specific branches (qrcode-generator import, eccLevel reads, QR SVG output).
  - Keep only 1D rendering via bwip-js.
  - Add `bc-empty` placeholder branch when binding+content both empty.

- **Create** `packages/template-renderer/src/elements/QrElement.vue`
  - QR-only via `qrcode-generator`. Mirror iteration-4 watch + blur + `flush: 'post'` pattern.
  - Empty-state placeholder identical to BarcodeElement's.

- **Modify** `packages/template-renderer/src/index.ts`
  - Export `QrElement` alongside `BarcodeElement` and the others.

### Store
- **Modify** `apps/web/src/stores/designer.ts`
  - Add legacy barcode→qr migration in `restore()` (before iteration-4's paper migration).
  - Add `editField(key, def)` action with type-change compatibility scan.
  - Add `deleteAllElements()` action.
  - Import `allowedFieldTypesForElement` from `../designer/elementFactory`.

### Designer
- **Modify** `apps/web/src/designer/elementFactory.ts`
  - Add `'qr'` to `LIBRARY_ITEMS`. Drop `variant: 'qr' | 'barcode'` from `ElementMeta`.
  - Add `'qr'` switch arm in `buildElement`. 1D `buildElement` arm loses QR-specific fields.
  - Drop `glyph: string` from `ElementMeta` (Lucide icons replace it).
  - Add `MIN_MM.qr` and `MIN_MM.barcode1d`; update `minMmFor` to discriminate by `type === 'qr'`.
  - Export `allowedFieldTypesForElement(elementType)`.
  - Field branch default: `binding: ''` (option B from brainstorming).

- **Modify** `apps/web/src/designer/CanvasElement.vue`
  - `elementMap` adds `qr: QrElement`.
  - HitZones mode check uses `el.type === 'qr'` instead of `el.symbology === 'qr'`.
  - `sizeBadge` `(1:1)` suffix checks `el.type === 'qr'` instead of `symbology`.

- **Modify** `apps/web/src/designer/HitZones.vue`
  - No semantic change. The `mode` prop already exists; only the caller's predicate changes.

- **Modify** `apps/web/src/designer/usePointerDrag.ts`
  - `getResizeMode()` switches on `el.type === 'qr'` / `el.type === 'barcode'`.

- **Create** `apps/web/src/designer/BarcodeContentPicker.vue`
  - Reusable "静态文本 / 字段绑定" tabbed picker, filtered to string + number fields.

- **Modify** `apps/web/src/designer/BarcodeProperties.vue`
  - Strip QR-specific UI. Add `<BarcodeContentPicker>` at top.

- **Create** `apps/web/src/designer/QrProperties.vue`
  - QR-only UI: ECC / colors / quiet zone + `<BarcodeContentPicker>`.

- **Modify** `apps/web/src/designer/FieldManager.vue` (iter 5 + 6 combined)
  - Add edit dialog (iter 5) with `key` disabled.
  - Remove `<span class="unused-tag">未使用</span>` (iter 6); keep unused background.
  - Rename `数据字段` → `变量` (iter 6).
  - Rename `添加字段` / `编辑字段` → `添加变量` / `编辑变量` (iter 6).
  - Replace `+` and `×` glyphs with Lucide icons (iter 6).
  - Add edit icon `Pencil` button on hover (iter 5 + iter 6 icons together).

- **Modify** `apps/web/src/designer/PropertyPanel.vue` (iter 5 + 6 combined)
  - Binding dropdown: filter by `allowedFieldTypesForElement` (iter 5).
  - Binding dropdown: `（未绑定）` sentinel option for non-table types (iter 5).
  - Render `<BarcodeProperties>` for `barcode` type and `<QrProperties>` for `qr` type (iter 5).
  - textAlign label `端` → `两端` (iter 6).
  - Font weight labels: 偏细 / 常规 / 加粗 / 特粗 (iter 6).
  - Split high-level styling into 样式·高级 (text-only) + 布局·高级 (universal: backgroundColor / zIndex / rotation / opacity) (iter 6).
  - Migrate rotation / opacity sliders to `SliderWithInput` (iter 6).

- **Modify** `apps/web/src/designer/BorderControl.vue` (iter 6)
  - Replace inline border-width `<input type="range">` with `<SliderWithInput>`.

- **Modify** `apps/web/src/designer/ElementLibrary.vue` (iter 6)
  - Rename `添加新元素` → `元素组件`.
  - Replace `lib-glyph` text spans with Lucide icon components.
  - Drop `.lib-glyph` CSS.

- **Modify** `apps/web/src/designer/CanvasElementsList.vue` (iter 6)
  - Add `清空` button in sub-head.
  - Replace text iconography with Lucide.

- **Modify** `apps/web/src/designer/DesignerHeader.vue` (iter 6)
  - Replace emoji + symbols with Lucide icons.

- **Create** `apps/web/src/designer/SliderWithInput.vue` (iter 6)
  - Reusable range slider + numeric display; double-click display → number input.

- **Create** `apps/web/src/designer/TemplateNameEditor.vue` (iter 6)
  - Inline-editable template name. Click → input, Enter/blur commits, Esc cancels.

- **Modify** `apps/web/src/views/DesignerView.vue` (iter 6)
  - Mount `<TemplateNameEditor />` in left panel head instead of static `{{ template.meta.name }}`.

### Web package config
- **Modify** `apps/web/package.json`
  - Add `lucide-vue-next` dependency.

---

## Tasks

### Task 1: Schema — QR split + binding relax (iter 5)

**Files:**
- Modify: `packages/schema/src/template.ts`
- Modify: `packages/schema/test/template.spec.ts`

- [ ] **Step 1: Write the failing tests**

In `packages/schema/test/template.spec.ts`, append:

```ts
describe('QrElementSchema (iteration 5)', () => {
  const baseQr = {
    id: 'q1',
    type: 'qr' as const,
    grid: { c: 0, r: 0, cs: 12, rs: 12 },
    anchor: { x: 0, y: 0, w: 12, h: 12 },
    style: baseStyle,
    content: { static: 'SAMPLE' },
  };

  it('parses a QR element', () => {
    expect(ElementSchema.parse(baseQr).type).toBe('qr');
  });

  it('QR accepts eccLevel + colors + quietZone', () => {
    const el = { ...baseQr, eccLevel: 'H' as const, foregroundColor: '#111', backgroundColor: '#fff', quietZone: 3 };
    expect(QrElementSchema.parse(el).eccLevel).toBe('H');
  });

  it('QR accepts empty binding', () => {
    const el = { ...baseQr, binding: '', content: undefined };
    expect(QrElementSchema.parse(el).binding).toBe('');
  });
});

describe('BarcodeElementSchema (iteration 5 — 1D only)', () => {
  const base1d = {
    id: 'b1',
    type: 'barcode' as const,
    grid: { c: 0, r: 0, cs: 30, rs: 8 },
    anchor: { x: 0, y: 0, w: 60, h: 16 },
    style: baseStyle,
    content: { static: 'SAMPLE' },
  };

  it('rejects qr as a symbology', () => {
    expect(() => BarcodeElementSchema.parse({ ...base1d, symbology: 'qr' })).toThrow();
  });

  it('rejects ean8 / upc-a', () => {
    expect(() => BarcodeElementSchema.parse({ ...base1d, symbology: 'ean8' })).toThrow();
    expect(() => BarcodeElementSchema.parse({ ...base1d, symbology: 'upc-a' })).toThrow();
  });

  it('accepts Code 128 / Code 39 / EAN-13 / ITF-14', () => {
    for (const sym of ['code128', 'code39', 'ean13', 'itf14'] as const) {
      expect(BarcodeElementSchema.parse({ ...base1d, symbology: sym }).symbology).toBe(sym);
    }
  });

  it('accepts empty binding', () => {
    const el = { ...base1d, binding: '', content: undefined };
    expect(BarcodeElementSchema.parse(el).binding).toBe('');
  });
});

describe('FieldElementSchema (iteration 5)', () => {
  it('accepts empty binding (unbound)', () => {
    const el = {
      id: 'f1', type: 'field' as const,
      grid: { c: 0, r: 0, cs: 16, rs: 3 },
      anchor: { x: 0, y: 0, w: 50, h: 8 },
      style: baseStyle,
      binding: '',
      fallback: '—',
      format: null,
    };
    expect(FieldElementSchema.parse(el).binding).toBe('');
  });
});
```

Add `QrElementSchema`, `BarcodeElementSchema`, `FieldElementSchema` to the named import from `'../src/template.js'` if not already imported.

- [ ] **Step 2: Run tests to verify they fail**

```bash
docker compose -f docker-compose.dev.yml exec -T web sh -c 'cd /workspace/packages/schema && pnpm test 2>&1 | tail -25'
```

Expected: new tests fail (`QrElementSchema` not defined; symbology accepts qr; FieldElement rejects empty binding).

- [ ] **Step 3: Modify schema**

In `packages/schema/src/template.ts`:

A) Add `QrElementSchema` (place after `BarcodeElementSchema`):

```ts
export const QrElementSchema = Base.extend({
  type: z.literal('qr'),
  binding: z.string().optional(),
  content: z.object({ static: z.string() }).optional(),
  eccLevel: z.enum(['L', 'M', 'Q', 'H']).default('M'),
  foregroundColor: z.string().default('#000000'),
  backgroundColor: z.string().default('#ffffff'),
  quietZone: z.number().nonnegative().default(2),
});
```

B) Replace `BarcodeElementSchema` body (drop QR, ean8, upc-a, eccLevel; binding stays optional, content stays optional):

```ts
export const BarcodeElementSchema = Base.extend({
  type: z.literal('barcode'),
  binding: z.string().optional(),
  content: z.object({ static: z.string() }).optional(),
  symbology: z.enum(['code128', 'code39', 'ean13', 'itf14']).default('code128'),
  showText: z.boolean().default(true),
  textPosition: z.enum(['top', 'bottom']).default('bottom'),
  textFontSize: z.number().positive().default(10),
  foregroundColor: z.string().default('#000000'),
  backgroundColor: z.string().default('#ffffff'),
  quietZone: z.number().nonnegative().default(4),
});
```

C) Add `QrElementSchema` to the discriminated union (find `ElementSchema`):

```ts
export const ElementSchema = z.discriminatedUnion('type', [
  TextElementSchema,
  FieldElementSchema,
  ImageElementSchema,
  TableElementSchema,
  BarcodeElementSchema,
  QrElementSchema,
  AutonumberElementSchema,
  SystemElementSchema,
  RectElementSchema,
]);
```

D) Relax `FieldElementSchema.binding` from `z.string().min(1)` to `z.string()`. Find the existing line in FieldElementSchema:

```ts
// Before
binding: z.string().min(1),

// After
binding: z.string(),
```

- [ ] **Step 4: Run tests**

```bash
docker compose -f docker-compose.dev.yml exec -T web sh -c 'cd /workspace/packages/schema && pnpm test 2>&1 | tail -10'
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add packages/schema/src/template.ts packages/schema/test/template.spec.ts
git commit -m "feat(schema): split QrElement from Barcode; relax FieldElement.binding; drop ean8/upc-a"
```

---

### Task 2: Store — barcode→qr migration + editField + deleteAllElements

**Files:**
- Modify: `apps/web/src/stores/designer.ts`

- [ ] **Step 1: Insert iteration-5 barcode→qr migration in restore()**

Find `restore()`. After the iteration-4 legacy-paper migration block (which begins with `// Iteration-4: migrate legacy paper enum values`) and BEFORE the anchor-derivation step, insert:

```ts
// Iteration-5: migrate legacy barcode→qr split + deprecated 1D symbologies.
let legacyDeprecatedBarcodeCount = 0;
for (const el of parsed.elements as TemplateElement[]) {
  if (el.type === 'barcode' && (el as { symbology?: string }).symbology === 'qr') {
    // Convert to new qr type.
    const old = el as TemplateElement & {
      symbology?: string;
      eccLevel?: 'L' | 'M' | 'Q' | 'H';
      showText?: boolean;
      textPosition?: 'top' | 'bottom';
      textFontSize?: number;
    };
    (el as { type: string }).type = 'qr';
    delete old.symbology;
    delete old.showText;
    delete old.textPosition;
    delete old.textFontSize;
    if (!old.eccLevel) old.eccLevel = 'M';
  } else if (
    el.type === 'barcode' &&
    ((el as { symbology?: string }).symbology === 'ean8' ||
      (el as { symbology?: string }).symbology === 'upc-a')
  ) {
    (el as { symbology: string }).symbology = 'code128';
    legacyDeprecatedBarcodeCount += 1;
  }
}
if (legacyDeprecatedBarcodeCount > 0) {
  ElMessage.warning(`${legacyDeprecatedBarcodeCount} 个条码已从 EAN-8/UPC-A 转换为 Code 128`);
}
```

`ElMessage` is already imported in this file (from iteration 3). Confirm by searching the file.

- [ ] **Step 2: Add editField action**

In the `actions` block, add (next to `addField`):

```ts
editField(key: string, def: FieldDef): void {
  if (!this.template.schema[key]) return;
  const oldType = this.template.schema[key].type;
  this.template.schema[key] = def;
  // If type changed, scan elements that bind to this key.
  if (oldType !== def.type) {
    let unbound = 0;
    for (const el of this.template.elements) {
      if (!('binding' in el)) continue;
      const elTyped = el as TemplateElement & { binding?: string };
      if (elTyped.binding !== key) continue;
      const allowed = allowedFieldTypesForElement(el.type);
      if (!allowed.includes(def.type)) {
        elTyped.binding = '';
        unbound++;
      }
    }
    if (unbound > 0) {
      ElMessage.warning(`字段类型变化导致 ${unbound} 个元素绑定已自动解除`);
    }
  }
  this.snapshot();
},
```

- [ ] **Step 3: Add deleteAllElements action**

Next to `deleteElement`:

```ts
deleteAllElements(): void {
  this.template.elements = [];
  this.selectedIds = [];
  this.snapshot();
},
```

- [ ] **Step 4: Import allowedFieldTypesForElement**

At top of file, add (after existing imports):

```ts
import { allowedFieldTypesForElement } from '../designer/elementFactory';
```

(This will fail TS until Task 3 exports it. That's fine — the import goes in now to keep the diff small.)

- [ ] **Step 5: Type-check (expected: TS error pending Task 3)**

```bash
docker compose -f docker-compose.dev.yml exec -T web sh -c 'cd /workspace/apps/web && NODE_OPTIONS=--max-old-space-size=4096 ./node_modules/.bin/vue-tsc --noEmit 2>&1 | tail -15'
```

Expected: error about `allowedFieldTypesForElement` not exported. Other lines clean. Proceed to commit; Task 3 resolves.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/stores/designer.ts
git commit -m "feat(store): barcode→qr migration; editField + deleteAllElements actions"
```

---

### Task 3: elementFactory — QR split + MIN_MM + allowedFieldTypesForElement (iter 5 + drop glyph for iter 6)

**Files:**
- Modify: `apps/web/src/designer/elementFactory.ts`

- [ ] **Step 1: Add allowedFieldTypesForElement + new LIBRARY_ITEMS + MIN_MM**

Open `apps/web/src/designer/elementFactory.ts`. At the top of the file (above existing exports), replace `ElementMeta` + `LIBRARY_ITEMS` + `MIN_MM` + `minMmFor`:

```ts
export type LibraryGroup = '文字' | '图形' | '数据';

export interface ElementMeta {
  type: TemplateElement['type'];
  label: string;
  group: LibraryGroup;
  defaultMm: { w: number; h: number };
}

export const LIBRARY_ITEMS: ElementMeta[] = [
  { type: 'text',       group: '文字', label: '文字',   defaultMm: { w: 40, h: 8 } },
  { type: 'field',      group: '文字', label: '字段',   defaultMm: { w: 50, h: 8 } },
  { type: 'autonumber', group: '文字', label: '编号',   defaultMm: { w: 45, h: 8 } },
  { type: 'system',     group: '文字', label: '系统',   defaultMm: { w: 45, h: 8 } },
  { type: 'rect',       group: '图形', label: '矩形',   defaultMm: { w: 40, h: 20 } },
  { type: 'image',      group: '图形', label: '图片',   defaultMm: { w: 40, h: 40 } },
  { type: 'table',      group: '数据', label: '明细',   defaultMm: { w: 150, h: 60 } },
  { type: 'qr',         group: '数据', label: '二维码', defaultMm: { w: 25, h: 25 } },
  { type: 'barcode',    group: '数据', label: '条码',   defaultMm: { w: 60, h: 16 } },
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
  if (el.type === 'qr')      return MIN_MM.qr;
  if (el.type === 'barcode') return MIN_MM.barcode1d;
  return MIN_MM[el.type];
}

// eslint-disable-next-line import/no-unresolved
import type { FieldDefSchema } from '@template-printing/schema';
import type { z } from 'zod';
type FieldDef = z.infer<typeof FieldDefSchema>;
type FieldType = FieldDef['type'];

export function allowedFieldTypesForElement(elType: TemplateElement['type']): FieldType[] {
  switch (elType) {
    case 'field':       return ['string', 'number', 'date', 'datetime', 'boolean', 'enum'];
    case 'barcode':     return ['string', 'number'];
    case 'qr':          return ['string', 'number'];
    case 'image':       return ['image'];
    case 'table':       return ['array'];
    default:            return [];
  }
}
```

This removes `glyph` and `variant` from `ElementMeta`. The `MIN_MM.qr` already existed from iteration 3 but `minMmFor`'s `el.symbology === 'qr'` branch is now replaced with `el.type === 'qr'`.

- [ ] **Step 2: Update buildElement signature + body**

Replace `buildElement`:

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
      return { id: newId, type: 'field', grid, anchor, style, binding: '', fallback: '—', format: null };
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
        symbology: 'code128',
        binding: undefined,
        content: { static: 'SAMPLE' },
        showText: true,
        textPosition: 'bottom',
        textFontSize: 10,
        foregroundColor: '#000000',
        backgroundColor: '#ffffff',
        quietZone: 4,
      };
    case 'qr':
      return {
        id: newId, type: 'qr', grid, anchor, style,
        binding: undefined,
        content: { static: 'SAMPLE' },
        eccLevel: 'M',
        foregroundColor: '#000000',
        backgroundColor: '#ffffff',
        quietZone: 2,
      };
    case 'autonumber':
      return { id: newId, type: 'autonumber', grid, anchor, style, sequence: 'default', format: '0000000', prefix: '' };
    case 'system':
      return { id: newId, type: 'system', grid, anchor, style, variable: 'pageNo' };
  }
}
```

Field branch now uses `binding: ''` (option B from brainstorming).

- [ ] **Step 3: Type-check**

```bash
docker compose -f docker-compose.dev.yml exec -T web sh -c 'cd /workspace/apps/web && NODE_OPTIONS=--max-old-space-size=4096 ./node_modules/.bin/vue-tsc --noEmit 2>&1 | tail -20'
```

Expected: errors in ElementLibrary.vue (references `meta.glyph`), CanvasElementsList.vue (uses `iconGlyph` helper). These get fixed by Task 11 (ElementLibrary) and Task 12 (CanvasElementsList). For now, store.ts and elementFactory.ts compile.

- [ ] **Step 4: Commit (tree still red — will be green after T11+T12)**

```bash
git add apps/web/src/designer/elementFactory.ts
git commit -m "feat(designer): elementFactory adds qr; drops glyph/variant; exports allowedFieldTypesForElement"
```

---

### Task 4: Renderer split — strip QR from BarcodeElement

**Files:**
- Modify: `packages/template-renderer/src/elements/BarcodeElement.vue`

- [ ] **Step 1: Read the existing file**

```bash
docker compose -f docker-compose.dev.yml exec -T web sh -c 'cat /workspace/packages/template-renderer/src/elements/BarcodeElement.vue'
```

Identify: the qrcode-generator import, the QR-rendering branch (likely `if (props.element.symbology === 'qr') ...`), the QR SVG output, the eccLevel reads.

- [ ] **Step 2: Strip the QR branch**

Apply these edits:

- Remove the `import qrcode from 'qrcode-generator';` line (if present at top).
- Remove the `qrSvg` ref / state if it exists.
- In the render function (likely `render()` or `renderBarcode()`), remove the `if (symbology === 'qr') { ... } else { /* 1D */ }` conditional — keep only the 1D path.
- Remove the `<div v-html="qrSvg">` template branch — keep only the `<canvas ref="canvasRef">` branch.
- Remove any QR-specific computed (e.g., `const isQr = computed(...)`).
- Remove qr-related CSS in `<style scoped>` if any.
- TypeScript: change the prop type's element variant from `{ type: 'barcode' }` (this stays correct now since BarcodeElement only handles barcode after split).

- [ ] **Step 3: Add empty-state placeholder**

Add to `<script setup>`:

```ts
const hasContent = computed(() => {
  const c = props.element.content?.static;
  const b = props.element.binding;
  return (c !== undefined && c !== '') || (b !== undefined && b !== '');
});
```

In the template, wrap the existing canvas render:

```vue
<div class="bc-wrap" :style="wrapStyle">
  <canvas v-if="hasContent" ref="canvasRef" />
  <div v-else class="bc-empty">未配置内容</div>
</div>
```

Add CSS:

```css
.bc-empty {
  width: 100%;
  height: 100%;
  border: 1px dashed var(--tp-line-strong, #e0e0e4);
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--tp-ink-faint, #9c9ca3);
  font-size: 11px;
}
```

The existing `wrapStyle` (iter-4 blur during isResizing) stays intact.

- [ ] **Step 4: Type-check**

```bash
docker compose -f docker-compose.dev.yml exec -T web sh -c 'cd /workspace/apps/web && NODE_OPTIONS=--max-old-space-size=4096 ./node_modules/.bin/vue-tsc --noEmit 2>&1 | tail -15'
```

- [ ] **Step 5: Commit**

```bash
git add packages/template-renderer/src/elements/BarcodeElement.vue
git commit -m "feat(renderer): BarcodeElement strips QR; adds empty-content placeholder"
```

---

### Task 5: Renderer — create QrElement

**Files:**
- Create: `packages/template-renderer/src/elements/QrElement.vue`
- Modify: `packages/template-renderer/src/index.ts`

- [ ] **Step 1: Create QrElement.vue**

Write:

```vue
<script setup lang="ts">
// eslint-disable-next-line import/no-unresolved
import type { TemplateElement } from '@template-printing/schema';
import { computed, ref, watch } from 'vue';
// eslint-disable-next-line import/no-unresolved
// @ts-expect-error qrcode-generator has no published types
import qrcode from 'qrcode-generator';

const props = defineProps<{
  element: Extract<TemplateElement, { type: 'qr' }>;
  data?: Record<string, unknown>;
  designMode?: boolean;
  isResizing?: boolean;
}>();

const qrSvg = ref('');

const contentText = computed(() => {
  if (props.element.binding) {
    const v = props.data?.[props.element.binding];
    return v == null ? '' : String(v);
  }
  return props.element.content?.static ?? '';
});

const hasContent = computed(() => contentText.value !== '');

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

function render(): void {
  if (!hasContent.value) {
    qrSvg.value = '';
    return;
  }
  const eccMap = { L: 'L', M: 'M', Q: 'Q', H: 'H' } as const;
  const ecc = (props.element.eccLevel ?? 'M') as 'L' | 'M' | 'Q' | 'H';
  const qr = qrcode(0, eccMap[ecc]);
  qr.addData(contentText.value);
  qr.make();
  const cellSize = 4;
  const margin = props.element.quietZone ?? 2;
  qrSvg.value = qr.createSvgTag({ cellSize, margin });
}

watch(
  () => ({
    grid: props.element.grid,
    content: props.element.content,
    binding: props.element.binding,
    ecc: props.element.eccLevel,
    fg: props.element.foregroundColor,
    bg: props.element.backgroundColor,
    qz: props.element.quietZone,
    isResizing: props.isResizing,
  }),
  (next) => {
    if (next.isResizing) return;
    render();
  },
  { deep: true, immediate: true, flush: 'post' },
);
</script>

<template>
  <div class="qr-wrap" :style="wrapStyle">
    <div
      v-if="hasContent"
      class="qr-svg"
      :style="{ color: props.element.foregroundColor, background: props.element.backgroundColor }"
      v-html="qrSvg"
    />
    <div v-else class="qr-empty">未配置内容</div>
  </div>
</template>

<style scoped>
.qr-svg {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}
.qr-svg :deep(svg) {
  max-width: 100%;
  max-height: 100%;
  width: auto;
  height: auto;
}
.qr-empty {
  width: 100%;
  height: 100%;
  border: 1px dashed var(--tp-line-strong, #e0e0e4);
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--tp-ink-faint, #9c9ca3);
  font-size: 11px;
}
</style>
```

- [ ] **Step 2: Export QrElement from index.ts**

Open `packages/template-renderer/src/index.ts`. Find the existing element exports (likely `export { default as BarcodeElement } from './elements/BarcodeElement.vue';`). Add alongside:

```ts
export { default as QrElement } from './elements/QrElement.vue';
```

- [ ] **Step 3: Type-check**

```bash
docker compose -f docker-compose.dev.yml exec -T web sh -c 'cd /workspace/apps/web && NODE_OPTIONS=--max-old-space-size=4096 ./node_modules/.bin/vue-tsc --noEmit 2>&1 | tail -15'
```

- [ ] **Step 4: Commit**

```bash
git add packages/template-renderer/src/elements/QrElement.vue packages/template-renderer/src/index.ts
git commit -m "feat(renderer): create QrElement (split from BarcodeElement)"
```

---

### Task 6: CanvasElement + HitZones + usePointerDrag — wire QR type

**Files:**
- Modify: `apps/web/src/designer/CanvasElement.vue`
- Modify: `apps/web/src/designer/usePointerDrag.ts`

- [ ] **Step 1: Update CanvasElement.vue elementMap and predicates**

In `apps/web/src/designer/CanvasElement.vue`:

A) Update the named import from `@template-printing/template-renderer` to include `QrElement`:

```ts
import {
  TextElement,
  FieldElement,
  ImageElement,
  TableElement,
  BarcodeElement,
  QrElement,
  AutonumberElement,
  SystemElement,
  RectElement,
} from '@template-printing/template-renderer';
```

B) Add `qr: QrElement` to `elementMap`:

```ts
const elementMap: Record<string, unknown> = {
  text: TextElement,
  field: FieldElement,
  image: ImageElement,
  table: TableElement,
  barcode: BarcodeElement,
  qr: QrElement,
  autonumber: AutonumberElement,
  system: SystemElement,
  rect: RectElement,
};
```

C) HitZones mode check. Find the existing line:

```vue
:mode="props.element.type === 'barcode' && props.element.symbology === 'qr' ? 'qr' : 'free'"
```

Replace with:

```vue
:mode="props.element.type === 'qr' ? 'qr' : 'free'"
```

D) `sizeBadge` computed `(1:1)` suffix. Find:

```ts
if (props.element.type === 'barcode' && props.element.symbology === 'qr') {
  return `${g.cs}×${g.rs} 格 (1:1)`;
}
```

Replace with:

```ts
if (props.element.type === 'qr') {
  return `${g.cs}×${g.rs} 格 (1:1)`;
}
```

- [ ] **Step 2: Update usePointerDrag getResizeMode**

In `apps/web/src/designer/usePointerDrag.ts`, find `getResizeMode`:

```ts
function getResizeMode(): ResizeMode {
  const el = getElement();
  if (!el || el.type !== 'barcode') return 'free';
  return el.symbology === 'qr' ? 'qr-lock' : 'barcode';
}
```

Replace with:

```ts
function getResizeMode(): ResizeMode {
  const el = getElement();
  if (!el) return 'free';
  if (el.type === 'qr')      return 'qr-lock';
  if (el.type === 'barcode') return 'barcode';
  return 'free';
}
```

- [ ] **Step 3: Type-check**

```bash
docker compose -f docker-compose.dev.yml exec -T web sh -c 'cd /workspace/apps/web && NODE_OPTIONS=--max-old-space-size=4096 ./node_modules/.bin/vue-tsc --noEmit 2>&1 | tail -15'
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/designer/CanvasElement.vue apps/web/src/designer/usePointerDrag.ts
git commit -m "feat(designer): wire qr type through canvas / hit-zones / pointer-drag"
```

---

### Task 7: Install lucide-vue-next + create SliderWithInput + TemplateNameEditor

**Files:**
- Modify: `apps/web/package.json`
- Modify: `pnpm-lock.yaml`
- Create: `apps/web/src/designer/SliderWithInput.vue`
- Create: `apps/web/src/designer/TemplateNameEditor.vue`

- [ ] **Step 1: Install lucide-vue-next**

```bash
docker compose -f docker-compose.dev.yml exec -T web sh -c 'cd /workspace && pnpm --filter @template-printing/web add lucide-vue-next 2>&1 | tail -10'
```

Expected: pnpm installs and updates pnpm-lock.yaml.

- [ ] **Step 2: Create SliderWithInput.vue**

`apps/web/src/designer/SliderWithInput.vue`:

```vue
<script setup lang="ts">
import { nextTick, ref } from 'vue';

const props = defineProps<{
  modelValue: number;
  min: number;
  max: number;
  step?: number;
  format?: (v: number) => string;
}>();
const emit = defineEmits<{ (e: 'update:modelValue', v: number): void }>();

const editing = ref(false);
const draft = ref('');
const numRef = ref<HTMLInputElement | null>(null);

function onSlide(e: Event): void {
  emit('update:modelValue', Number((e.target as HTMLInputElement).value));
}

function startEdit(): void {
  draft.value = String(props.modelValue);
  editing.value = true;
  void nextTick(() => {
    numRef.value?.focus();
    numRef.value?.select();
  });
}

function commitEdit(): void {
  const v = Number(draft.value);
  if (Number.isFinite(v)) {
    const clamped = Math.max(props.min, Math.min(props.max, v));
    emit('update:modelValue', clamped);
  }
  editing.value = false;
}

function cancelEdit(): void {
  editing.value = false;
}

function display(v: number): string {
  return props.format ? props.format(v) : String(v);
}
</script>

<template>
  <div class="swi">
    <input
      type="range"
      class="swi-range"
      :min="props.min"
      :max="props.max"
      :step="props.step ?? 1"
      :value="props.modelValue"
      @input="onSlide"
    />
    <span
      v-if="!editing"
      class="swi-val"
      @dblclick="startEdit"
      title="双击编辑数值"
    >{{ display(props.modelValue) }}</span>
    <input
      v-else
      ref="numRef"
      v-model="draft"
      type="number"
      class="swi-num"
      :min="props.min"
      :max="props.max"
      :step="props.step ?? 1"
      @blur="commitEdit"
      @keydown.enter="commitEdit"
      @keydown.escape="cancelEdit"
    />
  </div>
</template>

<style scoped>
.swi { display: flex; align-items: center; gap: 8px; flex: 1; }
.swi-range { flex: 1; accent-color: var(--tp-accent); height: 4px; cursor: pointer; }
.swi-val {
  min-width: 40px;
  text-align: right;
  font-size: 11px;
  color: var(--tp-ink-soft);
  font-family: ui-monospace, monospace;
  cursor: pointer;
  padding: 1px 4px;
  border-radius: 3px;
  transition: background 120ms ease;
}
.swi-val:hover { background: var(--tp-field-bg); }
.swi-num {
  width: 56px; font-size: 11px; padding: 1px 4px;
  border: 1px solid var(--tp-accent); border-radius: 3px;
  font-family: ui-monospace, monospace; text-align: right;
  background: var(--tp-panel); outline: none;
}
.swi-num::-webkit-outer-spin-button, .swi-num::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
</style>
```

- [ ] **Step 3: Create TemplateNameEditor.vue**

`apps/web/src/designer/TemplateNameEditor.vue`:

```vue
<script setup lang="ts">
import { nextTick, ref } from 'vue';
// eslint-disable-next-line import/no-unresolved
import { Pencil } from 'lucide-vue-next';
import { useDesignerStore } from '../stores/designer';

const store = useDesignerStore();
const editing = ref(false);
const draft = ref('');
const inputRef = ref<HTMLInputElement | null>(null);

function startEdit(): void {
  draft.value = store.template.meta.name;
  editing.value = true;
  void nextTick(() => {
    inputRef.value?.focus();
    inputRef.value?.select();
  });
}

function commit(): void {
  const v = draft.value.trim();
  if (v && v !== store.template.meta.name) {
    store.setName(v);
  }
  editing.value = false;
}

function cancel(): void {
  editing.value = false;
}
</script>

<template>
  <div v-if="!editing" class="tne-display" @click="startEdit">
    <span class="tne-title">{{ store.template.meta.name }}</span>
    <Pencil :size="12" :stroke-width="2" class="tne-edit-hint" />
  </div>
  <input
    v-else
    ref="inputRef"
    v-model="draft"
    class="tne-input"
    @blur="commit"
    @keydown.enter="commit"
    @keydown.escape="cancel"
  />
</template>

<style scoped>
.tne-display {
  display: flex; align-items: center; gap: 6px;
  cursor: pointer; border-radius: 4px;
  padding: 2px 4px;
  transition: background 120ms ease;
}
.tne-display:hover { background: var(--tp-field-bg); }
.tne-title {
  font-weight: 700; font-size: 14px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.tne-edit-hint {
  color: var(--tp-ink-faint);
  opacity: 0;
  transition: opacity 120ms ease;
}
.tne-display:hover .tne-edit-hint { opacity: 1; }
.tne-input {
  width: 100%; font: inherit; font-weight: 700; font-size: 14px;
  padding: 2px 4px;
  border: 1px solid var(--tp-accent); border-radius: 4px;
  background: var(--tp-panel); outline: none;
  color: var(--tp-ink);
}
</style>
```

- [ ] **Step 4: Type-check**

```bash
docker compose -f docker-compose.dev.yml exec -T web sh -c 'cd /workspace/apps/web && NODE_OPTIONS=--max-old-space-size=4096 ./node_modules/.bin/vue-tsc --noEmit 2>&1 | tail -10'
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/package.json pnpm-lock.yaml \
        apps/web/src/designer/SliderWithInput.vue \
        apps/web/src/designer/TemplateNameEditor.vue
git commit -m "feat(designer): install lucide-vue-next; add SliderWithInput + TemplateNameEditor components"
```

---

### Task 8: BarcodeContentPicker (new)

**Files:**
- Create: `apps/web/src/designer/BarcodeContentPicker.vue`

- [ ] **Step 1: Create the file**

```vue
<script setup lang="ts">
// eslint-disable-next-line import/no-unresolved
import type { TemplateElement } from '@template-printing/schema';
import { computed } from 'vue';
import { useDesignerStore } from '../stores/designer';

const props = defineProps<{ element: Extract<TemplateElement, { type: 'barcode' | 'qr' }> }>();
const emit = defineEmits<{ (e: 'update', patch: Partial<TemplateElement>): void }>();

const store = useDesignerStore();

const mode = computed<'static' | 'field'>(() =>
  (props.element.binding ?? '') !== '' ? 'field' : 'static',
);

function setMode(m: 'static' | 'field'): void {
  if (m === 'static') {
    emit('update', { binding: undefined, content: { static: '' } } as Partial<TemplateElement>);
  } else {
    emit('update', { binding: '', content: undefined } as Partial<TemplateElement>);
  }
}

function setStatic(v: string): void {
  emit('update', { binding: undefined, content: { static: v } } as Partial<TemplateElement>);
}
function setBinding(key: string): void {
  emit('update', { binding: key, content: undefined } as Partial<TemplateElement>);
}

const eligibleFields = computed(() =>
  store.fieldDefs.filter((f) => f.def.type === 'string' || f.def.type === 'number'),
);
</script>

<template>
  <div class="bc-src">
    <div class="bc-src-tabs seg">
      <button :class="{ on: mode === 'static' }" @click="setMode('static')">静态文本</button>
      <button :class="{ on: mode === 'field' }"  @click="setMode('field')">字段绑定</button>
    </div>
    <div v-if="mode === 'static'" class="bc-static">
      <input
        type="text"
        class="bc-input"
        :value="props.element.content?.static ?? ''"
        @input="(e: Event) => setStatic((e.target as HTMLInputElement).value)"
        placeholder="例：ORD-001"
      />
    </div>
    <div v-else class="bc-bind">
      <select
        class="bc-input"
        :value="props.element.binding ?? ''"
        @change="(e: Event) => setBinding((e.target as HTMLSelectElement).value)"
      >
        <option value="">（未绑定）</option>
        <option v-for="f in eligibleFields" :key="f.key" :value="f.key">
          {{ f.key }} · {{ f.def.label }}
        </option>
      </select>
    </div>
  </div>
</template>

<style scoped>
.bc-src { padding: 10px 0; }
.bc-src-tabs { display: flex; gap: 4px; margin-bottom: 8px; }
.seg button {
  border: 1px solid var(--tp-line-strong);
  background: var(--tp-panel);
  padding: 3px 10px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 12px;
  color: var(--tp-ink-soft);
}
.seg button.on { background: var(--tp-accent); color: #fff; border-color: var(--tp-accent); }
.bc-input {
  width: 100%; padding: 4px 8px;
  border: 1px solid var(--tp-line-strong); border-radius: 4px;
  font-size: 12px; outline: none; background: var(--tp-panel);
}
.bc-input:focus { border-color: var(--tp-accent); }
</style>
```

- [ ] **Step 2: Type-check**

```bash
docker compose -f docker-compose.dev.yml exec -T web sh -c 'cd /workspace/apps/web && NODE_OPTIONS=--max-old-space-size=4096 ./node_modules/.bin/vue-tsc --noEmit 2>&1 | tail -10'
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/designer/BarcodeContentPicker.vue
git commit -m "feat(designer): BarcodeContentPicker — static / field-binding tabs"
```

---

### Task 9: BarcodeProperties strip + ContentPicker + SliderWithInput migration

**Files:**
- Modify: `apps/web/src/designer/BarcodeProperties.vue`

- [ ] **Step 1: Replace the file content**

```vue
<script setup lang="ts">
// eslint-disable-next-line import/no-unresolved
import type { TemplateElement } from '@template-printing/schema';
import BarcodeContentPicker from './BarcodeContentPicker.vue';
import SliderWithInput from './SliderWithInput.vue';

const props = defineProps<{ element: Extract<TemplateElement, { type: 'barcode' }> }>();
const emit = defineEmits<{ (e: 'update', patch: Partial<TemplateElement>): void }>();

function update(patch: Record<string, unknown>): void {
  emit('update', patch as Partial<TemplateElement>);
}
</script>

<template>
  <div class="bc-block">
    <div class="bc-title">条码控制</div>

    <BarcodeContentPicker :element="props.element" @update="(p: Partial<TemplateElement>) => emit('update', p)" />

    <div class="srow">
      <span class="slbl">类型</span>
      <select class="ssel" :value="props.element.symbology" @change="(e: Event) => update({ symbology: (e.target as HTMLSelectElement).value })">
        <option value="code128">Code 128</option>
        <option value="code39">Code 39</option>
        <option value="ean13">EAN-13</option>
        <option value="itf14">ITF-14</option>
      </select>
    </div>

    <div class="srow">
      <span class="slbl">前景</span>
      <input type="color" :value="props.element.foregroundColor ?? '#000000'"
        @input="(e: Event) => update({ foregroundColor: (e.target as HTMLInputElement).value })" />
      <span class="sval mono">{{ props.element.foregroundColor ?? '#000000' }}</span>
    </div>
    <div class="srow">
      <span class="slbl">背景</span>
      <input type="color" :value="props.element.backgroundColor ?? '#ffffff'"
        @input="(e: Event) => update({ backgroundColor: (e.target as HTMLInputElement).value })" />
      <span class="sval mono">{{ props.element.backgroundColor ?? '#ffffff' }}</span>
    </div>
    <div class="srow">
      <span class="slbl">静区</span>
      <SliderWithInput
        :model-value="props.element.quietZone ?? 4"
        :min="0" :max="8" :step="1"
        @update:model-value="(v: number) => update({ quietZone: v })"
      />
    </div>

    <div class="srow">
      <span class="slbl">显示文字</span>
      <input type="checkbox" :checked="props.element.showText" @change="(e: Event) => update({ showText: (e.target as HTMLInputElement).checked })" />
    </div>
    <div v-if="props.element.showText" class="srow">
      <span class="slbl">文字位置</span>
      <div class="seg">
        <button :class="{ on: (props.element.textPosition ?? 'bottom') === 'top' }" @click="update({ textPosition: 'top' })">上</button>
        <button :class="{ on: (props.element.textPosition ?? 'bottom') === 'bottom' }" @click="update({ textPosition: 'bottom' })">下</button>
      </div>
    </div>
    <div v-if="props.element.showText" class="srow">
      <span class="slbl">文字字号</span>
      <input type="number" min="6" max="32" step="1" :value="props.element.textFontSize ?? 10" class="snum"
        @input="(e: Event) => update({ textFontSize: Number((e.target as HTMLInputElement).value) })" />
      <span class="sval">px</span>
    </div>
  </div>
</template>

<style scoped>
.bc-block { padding: 12px 14px; border-bottom: 1px solid var(--tp-line); }
.bc-title { font-size: 11px; font-weight: 600; color: var(--tp-ink-soft); text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 8px; }
.srow { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
.slbl { width: 56px; font-size: 11px; color: var(--tp-ink-soft); }
.sval { font-size: 11px; color: var(--tp-ink-soft); min-width: 40px; text-align: right; }
.mono { font-family: ui-monospace, monospace; }
.snum, .ssel { padding: 3px 6px; border: 1px solid var(--tp-line-strong); border-radius: 4px; font-size: 12px; min-width: 100px; }
.seg { display: inline-flex; gap: 4px; }
.seg button { border: 1px solid var(--tp-line-strong); background: var(--tp-panel); padding: 3px 10px; border-radius: 6px; cursor: pointer; font-size: 12px; color: var(--tp-ink-soft); }
.seg button.on { background: var(--tp-accent); color: #fff; border-color: var(--tp-accent); }
</style>
```

- [ ] **Step 2: Type-check + commit**

```bash
docker compose -f docker-compose.dev.yml exec -T web sh -c 'cd /workspace/apps/web && NODE_OPTIONS=--max-old-space-size=4096 ./node_modules/.bin/vue-tsc --noEmit 2>&1 | tail -10'
git add apps/web/src/designer/BarcodeProperties.vue
git commit -m "feat(designer): BarcodeProperties strips QR; adds ContentPicker; uses SliderWithInput"
```

---

### Task 10: QrProperties (new)

**Files:**
- Create: `apps/web/src/designer/QrProperties.vue`

- [ ] **Step 1: Create the file**

```vue
<script setup lang="ts">
// eslint-disable-next-line import/no-unresolved
import type { TemplateElement } from '@template-printing/schema';
import BarcodeContentPicker from './BarcodeContentPicker.vue';
import SliderWithInput from './SliderWithInput.vue';

const props = defineProps<{ element: Extract<TemplateElement, { type: 'qr' }> }>();
const emit = defineEmits<{ (e: 'update', patch: Partial<TemplateElement>): void }>();

function update(patch: Record<string, unknown>): void {
  emit('update', patch as Partial<TemplateElement>);
}
</script>

<template>
  <div class="qr-block">
    <div class="qr-title">二维码控制</div>

    <BarcodeContentPicker :element="props.element" @update="(p: Partial<TemplateElement>) => emit('update', p)" />

    <div class="srow">
      <span class="slbl">容错</span>
      <select class="ssel" :value="props.element.eccLevel ?? 'M'" @change="(e: Event) => update({ eccLevel: (e.target as HTMLSelectElement).value })">
        <option value="L">L · 7%</option>
        <option value="M">M · 15%</option>
        <option value="Q">Q · 25%</option>
        <option value="H">H · 30%</option>
      </select>
    </div>
    <div class="srow">
      <span class="slbl">前景</span>
      <input type="color" :value="props.element.foregroundColor ?? '#000000'"
        @input="(e: Event) => update({ foregroundColor: (e.target as HTMLInputElement).value })" />
      <span class="sval mono">{{ props.element.foregroundColor ?? '#000000' }}</span>
    </div>
    <div class="srow">
      <span class="slbl">背景</span>
      <input type="color" :value="props.element.backgroundColor ?? '#ffffff'"
        @input="(e: Event) => update({ backgroundColor: (e.target as HTMLInputElement).value })" />
      <span class="sval mono">{{ props.element.backgroundColor ?? '#ffffff' }}</span>
    </div>
    <div class="srow">
      <span class="slbl">静区</span>
      <SliderWithInput
        :model-value="props.element.quietZone ?? 2"
        :min="0" :max="8" :step="1"
        @update:model-value="(v: number) => update({ quietZone: v })"
      />
    </div>
  </div>
</template>

<style scoped>
.qr-block { padding: 12px 14px; border-bottom: 1px solid var(--tp-line); }
.qr-title { font-size: 11px; font-weight: 600; color: var(--tp-ink-soft); text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 8px; }
.srow { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
.slbl { width: 56px; font-size: 11px; color: var(--tp-ink-soft); }
.sval { font-size: 11px; color: var(--tp-ink-soft); min-width: 40px; text-align: right; }
.mono { font-family: ui-monospace, monospace; }
.ssel { padding: 3px 6px; border: 1px solid var(--tp-line-strong); border-radius: 4px; font-size: 12px; min-width: 100px; }
</style>
```

- [ ] **Step 2: Type-check + commit**

```bash
docker compose -f docker-compose.dev.yml exec -T web sh -c 'cd /workspace/apps/web && NODE_OPTIONS=--max-old-space-size=4096 ./node_modules/.bin/vue-tsc --noEmit 2>&1 | tail -10'
git add apps/web/src/designer/QrProperties.vue
git commit -m "feat(designer): QrProperties — ECC / colors / quiet zone + ContentPicker"
```

---

### Task 11: ElementLibrary — Lucide icons + rename (iter 5 + iter 6)

**Files:**
- Modify: `apps/web/src/designer/ElementLibrary.vue`

- [ ] **Step 1: Replace the file**

```vue
<script setup lang="ts">
import { computed } from 'vue';
// eslint-disable-next-line import/no-unresolved
import { Type, Braces, Hash, Clock, Square, Image, Table, QrCode, Barcode } from 'lucide-vue-next';
import { useDesignerStore } from '../stores/designer';
import { LIBRARY_ITEMS, buildElement, type ElementMeta, type LibraryGroup } from './elementFactory';
// eslint-disable-next-line import/no-unresolved
import type { TemplateElement } from '@template-printing/schema';

const store = useDesignerStore();
const groupOrder: LibraryGroup[] = ['文字', '图形', '数据'];
const itemsByGroup = computed<Record<LibraryGroup, ElementMeta[]>>(() => ({
  文字: LIBRARY_ITEMS.filter((i) => i.group === '文字'),
  图形: LIBRARY_ITEMS.filter((i) => i.group === '图形'),
  数据: LIBRARY_ITEMS.filter((i) => i.group === '数据'),
}));

const iconFor: Record<TemplateElement['type'], unknown> = {
  text: Type,
  field: Braces,
  autonumber: Hash,
  system: Clock,
  rect: Square,
  image: Image,
  table: Table,
  qr: QrCode,
  barcode: Barcode,
};

function clickAdd(meta: ElementMeta): void {
  const cell = store.template.canvas.cell;
  const count = store.template.elements.length;
  const anchorMm = { x: 4 + (count % 10) * 2, y: 4 + (count % 10) * 2 };
  const el = buildElement(meta, store.newElementId(), anchorMm, cell);
  store.addElement(el);
}

function onDragStart(e: DragEvent, meta: ElementMeta): void {
  if (!e.dataTransfer) return;
  e.dataTransfer.setData('application/x-tp-element', JSON.stringify(meta));
  e.dataTransfer.effectAllowed = 'copy';
}
</script>

<template>
  <div class="tp-section-top">
    <div class="tp-sub-head">
      <span class="tp-sub-title">元素组件</span>
    </div>
    <div class="lib-scroll">
      <div v-for="g in groupOrder" :key="g" class="lib-group">
        <div class="lib-group-title">{{ g }}</div>
        <div class="lib-grid">
          <button
            v-for="item in itemsByGroup[g]"
            :key="item.label"
            class="lib-btn"
            draggable="true"
            :title="`点击或拖入：${item.label}`"
            @click="clickAdd(item)"
            @dragstart="onDragStart($event, item)"
          >
            <component :is="iconFor[item.type]" :size="22" :stroke-width="2" />
            <span>{{ item.label }}</span>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.lib-scroll { flex: 1; overflow-y: auto; padding-bottom: 8px; }
.lib-group + .lib-group { margin-top: 8px; }
.lib-group-title {
  padding: 8px 14px 4px;
  font-size: 10px; font-weight: 600;
  letter-spacing: 0.08em; text-transform: uppercase;
  color: var(--tp-ink-faint);
}
.lib-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
  padding: 0 10px;
}
.lib-btn {
  padding: 10px 4px;
  background: var(--tp-panel);
  border: 1px solid var(--tp-line-strong);
  border-radius: var(--tp-radius-item, 8px);
  cursor: grab;
  display: flex; flex-direction: column;
  align-items: center; gap: 4px;
  color: var(--tp-ink-soft);
  font-size: 11px;
  transition: all 120ms ease;
  user-select: none;
}
.lib-btn:hover {
  border-color: var(--tp-accent);
  color: var(--tp-accent);
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(108, 92, 231, 0.12);
}
.lib-btn:active { cursor: grabbing; transform: none; }
</style>
```

- [ ] **Step 2: Type-check + commit**

```bash
docker compose -f docker-compose.dev.yml exec -T web sh -c 'cd /workspace/apps/web && NODE_OPTIONS=--max-old-space-size=4096 ./node_modules/.bin/vue-tsc --noEmit 2>&1 | tail -10'
git add apps/web/src/designer/ElementLibrary.vue
git commit -m "feat(designer): ElementLibrary renames to 元素组件; Lucide icons; drops .lib-glyph"
```

---

### Task 12: CanvasElementsList — Lucide icons + clear-all (iter 6)

**Files:**
- Modify: `apps/web/src/designer/CanvasElementsList.vue`

- [ ] **Step 1: Replace the file**

```vue
<script setup lang="ts">
import { computed, ref, watch } from 'vue';
// eslint-disable-next-line import/no-unresolved
import type { TemplateElement } from '@template-printing/schema';
// eslint-disable-next-line import/no-unresolved
import { Type, Braces, Hash, Clock, Square, Image, Table, QrCode, Barcode, X, Trash2 } from 'lucide-vue-next';
import { useDesignerStore } from '../stores/designer';

const store = useDesignerStore();
const PAGE_SIZE = 10;
const page = ref(1);

const elements = computed(() => store.template.elements);
const pageCount = computed(() => Math.max(1, Math.ceil(elements.value.length / PAGE_SIZE)));
const paged = computed(() => {
  const start = (page.value - 1) * PAGE_SIZE;
  return elements.value.slice(start, start + PAGE_SIZE);
});

watch(pageCount, (n) => { if (page.value > n) page.value = n; });

watch(() => store.selectedIds, (ids) => {
  if (ids.length !== 1) return;
  const idx = elements.value.findIndex((el) => el.id === ids[0]);
  if (idx < 0) return;
  const targetPage = Math.floor(idx / PAGE_SIZE) + 1;
  if (targetPage !== page.value) page.value = targetPage;
});

function summarize(el: TemplateElement): string {
  switch (el.type) {
    case 'text':       return `text · ${el.content.static.slice(0, 16) || '空'}`;
    case 'field':      return `field · ${el.binding || '（未绑定）'}`;
    case 'image':      return `image`;
    case 'rect':       return `rect`;
    case 'table':      return `table · ${el.binding}`;
    case 'qr':         return `qr · ${el.content?.static ?? el.binding ?? '空'}`;
    case 'barcode':    return `${el.symbology} · ${el.content?.static ?? el.binding ?? '空'}`;
    case 'autonumber': return `№ · ${el.sequence}`;
    case 'system':     return `system · ${el.variable}`;
  }
}

const iconFor: Record<TemplateElement['type'], unknown> = {
  text: Type,
  field: Braces,
  autonumber: Hash,
  system: Clock,
  rect: Square,
  image: Image,
  table: Table,
  qr: QrCode,
  barcode: Barcode,
};

function selectOne(id: string): void { store.select([id]); }
function removeEl(id: string, e: Event): void {
  e.stopPropagation();
  store.deleteElement(id);
}
function onClearAll(): void {
  if (!window.confirm(`确定清空全部 ${elements.value.length} 个元素？`)) return;
  store.deleteAllElements();
}
</script>

<template>
  <div class="canvas-elems-list">
    <div class="tp-sub-head">
      <span class="tp-sub-title">画布元素 · 共 {{ elements.length }} 个</span>
      <button v-if="elements.length > 0" class="clear-btn" @click="onClearAll" title="清空全部元素">
        <Trash2 :size="13" :stroke-width="2" />
        <span>清空</span>
      </button>
    </div>
    <div class="list-body">
      <div v-if="elements.length === 0" class="empty">
        从上方拖入或点击元素来开始设计
      </div>
      <div
        v-for="el in paged"
        :key="el.id"
        class="elem-row"
        :class="{ 'is-active': store.selectedIds.includes(el.id) }"
        @click="selectOne(el.id)"
      >
        <span class="elem-icon">
          <component :is="iconFor[el.type]" :size="14" :stroke-width="2" />
        </span>
        <span class="elem-label">{{ summarize(el) }}</span>
        <button class="elem-del" @click="(e: Event) => removeEl(el.id, e)" title="删除">
          <X :size="14" :stroke-width="2" />
        </button>
      </div>
    </div>
    <div v-if="pageCount > 1" class="pagination">
      <button :disabled="page <= 1" @click="page--">‹</button>
      <span class="pgno">{{ page }} / {{ pageCount }}</span>
      <button :disabled="page >= pageCount" @click="page++">›</button>
      <span class="pgsize">每页 {{ PAGE_SIZE }}</span>
    </div>
  </div>
</template>

<style scoped>
.canvas-elems-list { flex: 1; display: flex; flex-direction: column; min-height: 0; }
.list-body { flex: 1; overflow-y: auto; padding: 6px 8px 6px; }
.empty { padding: 32px 16px; text-align: center; color: var(--tp-ink-faint); font-size: 12px; line-height: 1.6; }

.clear-btn {
  background: transparent; border: none;
  font-size: 11px; color: var(--tp-ink-faint);
  cursor: pointer; padding: 2px 8px; border-radius: 4px;
  display: inline-flex; align-items: center; gap: 4px;
  transition: color 120ms ease, background 120ms ease;
}
.clear-btn:hover { color: #d94f4f; background: rgba(217, 79, 79, 0.08); }

.elem-row {
  position: relative; width: 100%;
  display: flex; align-items: center; gap: 8px;
  padding: 7px 10px;
  border-radius: var(--tp-radius-item, 8px);
  cursor: pointer; color: var(--tp-ink);
  font-size: 12.5px; margin-bottom: 2px; background: transparent;
}
.elem-row:hover { background: var(--tp-field-bg); }
.elem-row.is-active { background: var(--tp-accent-bg); color: var(--tp-accent-ink); font-weight: 600; }
.elem-row.is-active .elem-icon { background: var(--tp-accent); color: #fff; }
.elem-icon {
  flex-shrink: 0; width: 22px; height: 22px;
  border-radius: 5px;
  background: var(--tp-field-bg); color: var(--tp-accent);
  display: inline-flex; align-items: center; justify-content: center;
}
.elem-label { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.elem-del {
  border: none; background: transparent;
  width: 20px; height: 20px; border-radius: 4px;
  color: var(--tp-ink-faint); cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center;
  opacity: 0;
  transition: opacity 120ms ease, background 120ms ease;
}
.elem-row:hover .elem-del { opacity: 1; }
.elem-del:hover { background: rgba(217, 79, 79, 0.1); color: #d94f4f; }
.pagination {
  display: flex; align-items: center; justify-content: center;
  gap: 8px; padding: 6px 10px 10px;
  border-top: 1px solid var(--tp-line);
  font-size: 11px; color: var(--tp-ink-soft);
}
.pagination button {
  width: 22px; height: 22px;
  border: 1px solid var(--tp-line-strong);
  background: var(--tp-panel);
  border-radius: 4px; cursor: pointer; color: var(--tp-ink);
}
.pagination button:disabled { opacity: 0.4; cursor: not-allowed; }
.pagination .pgno { font-family: ui-monospace, monospace; }
.pagination .pgsize { margin-left: auto; color: var(--tp-ink-faint); }
</style>
```

- [ ] **Step 2: Type-check + commit**

```bash
docker compose -f docker-compose.dev.yml exec -T web sh -c 'cd /workspace/apps/web && NODE_OPTIONS=--max-old-space-size=4096 ./node_modules/.bin/vue-tsc --noEmit 2>&1 | tail -10'
git add apps/web/src/designer/CanvasElementsList.vue
git commit -m "feat(designer): CanvasElementsList — clear-all + Lucide icons"
```

---

### Task 13: FieldManager — edit dialog + rename + unused color + icons (iter 5 + iter 6)

**Files:**
- Modify: `apps/web/src/designer/FieldManager.vue`

- [ ] **Step 1: Replace the file**

Read the current file first to understand its structure (it's already grown over iterations 2 + 4). Then rewrite to incorporate:
- iter 5: edit dialog + ✎ button (Lucide Pencil) + lock `key` in edit mode + call `store.editField` on submit.
- iter 6: rename "数据字段" → "变量", remove "未使用" tag, use Lucide icons for + Plus / Pencil / Trash2.

```vue
<script setup lang="ts">
// eslint-disable-next-line import/no-unresolved
import {
  ElButton, ElDialog, ElForm, ElFormItem,
  ElInput, ElMessage, ElOption, ElSelect, ElCheckbox,
} from 'element-plus';
import { ref } from 'vue';
// eslint-disable-next-line import/no-unresolved
import { Plus, Pencil, Trash2 } from 'lucide-vue-next';
import { useDesignerStore } from '../stores/designer';

type FieldType = 'string' | 'number' | 'date' | 'datetime' | 'boolean' | 'enum' | 'image' | 'array';

const store = useDesignerStore();
const dialogOpen = ref(false);
const dialogMode = ref<'add' | 'edit'>('add');

interface FormShape {
  key: string;
  label: string;
  type: FieldType;
  required: boolean;
  example: string;
  maxLength?: number;
  thousands?: boolean;
  format?: string;
  trueLabel?: string;
  falseLabel?: string;
  options?: Array<{ value: string; label: string }>;
  accept?: string[];
}

const form = ref<FormShape>(defaultForm());

function defaultForm(): FormShape {
  return { key: '', label: '', type: 'string', required: false, example: '' };
}

function openAdd(): void {
  dialogMode.value = 'add';
  form.value = defaultForm();
  dialogOpen.value = true;
}

function openEdit(key: string): void {
  const def = store.template.schema[key];
  if (!def) return;
  dialogMode.value = 'edit';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const d = def as any;
  form.value = {
    key,
    label: d.label ?? '',
    type: d.type ?? 'string',
    required: d.required ?? false,
    example: d.example ?? '',
    maxLength: d.maxLength,
    thousands: d.thousands,
    format: d.format,
    trueLabel: d.trueLabel,
    falseLabel: d.falseLabel,
    options: d.options ? [...d.options] : undefined,
    accept: d.accept ? [...d.accept] : undefined,
  };
  dialogOpen.value = true;
}

function addOptionRow(): void {
  if (!form.value.options) form.value.options = [];
  form.value.options.push({ value: '', label: '' });
}
function removeOptionRow(i: number): void { form.value.options?.splice(i, 1); }

function toggleAcc(arr: string[] | undefined, mime: string, on: boolean): string[] {
  const cur = arr ?? ['image/svg+xml', 'image/png', 'image/jpeg'];
  if (on) return cur.includes(mime) ? cur : [...cur, mime];
  return cur.filter((m) => m !== mime);
}

function submit(): void {
  const f = form.value;
  if (!f.key || !f.label) { ElMessage.warning('key 和 label 都必须填'); return; }
  if (dialogMode.value === 'add' && store.template.schema[f.key]) {
    ElMessage.error(`变量 "${f.key}" 已存在`); return;
  }

  const base = { label: f.label, required: f.required, example: f.example || undefined };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let def: any;
  if (f.type === 'string') def = { type: 'string' as const, ...base, ...(f.maxLength ? { maxLength: f.maxLength } : {}) };
  else if (f.type === 'number') def = { type: 'number' as const, ...base, thousands: f.thousands ?? false };
  else if (f.type === 'date') def = { type: 'date' as const, ...base, format: f.format || 'YYYY-MM-DD' };
  else if (f.type === 'datetime') def = { type: 'datetime' as const, ...base, format: f.format || 'YYYY-MM-DD HH:mm' };
  else if (f.type === 'boolean') def = { type: 'boolean' as const, ...base, trueLabel: f.trueLabel || '是', falseLabel: f.falseLabel || '否' };
  else if (f.type === 'enum') {
    const opts = (f.options ?? []).filter((o) => o.value && o.label);
    if (opts.length === 0) { ElMessage.error('enum 至少需要一个选项 (value + label 都要填)'); return; }
    def = { type: 'enum' as const, ...base, options: opts };
  } else if (f.type === 'image') {
    const accept = f.accept && f.accept.length > 0 ? f.accept : ['image/svg+xml', 'image/png', 'image/jpeg'];
    def = { type: 'image' as const, ...base, accept };
  } else def = { type: 'array' as const, ...base };

  if (dialogMode.value === 'add') store.addField(f.key, def);
  else store.editField(f.key, def);
  dialogOpen.value = false;
}

function remove(key: string): void {
  if (!window.confirm(`删除变量 "${key}"？模板中绑定到该字段的元素将变为未绑定状态。`)) return;
  store.removeField(key);
}
</script>

<template>
  <div class="tp-section-top field-mgr">
    <div class="tp-sub-head">
      <span class="tp-sub-title">变量 · 共 {{ store.fieldDefs.length }} 个</span>
      <button class="tp-sub-add" title="添加变量" @click="openAdd">
        <Plus :size="14" :stroke-width="2" />
      </button>
    </div>
    <div class="fm-body">
      <div v-if="store.fieldDefs.length === 0" class="empty">
        尚未声明变量<br />点击 + 添加
      </div>
      <div
        v-for="{ key, def } in store.fieldDefs"
        :key="key"
        class="field-card"
        :class="{ unused: !store.usedFieldKeys.has(key) }"
        :title="!store.usedFieldKeys.has(key) ? '未使用' : ''"
      >
        <div class="card-row">
          <span class="k">{{ key }}</span>
          <span class="t">{{ def.type }}</span>
        </div>
        <div class="card-row card-row-sub">
          <span class="l">{{ def.label }}</span>
          <span v-if="def.required" class="req">必填</span>
          <button class="action edit" @click="openEdit(key)" title="编辑变量">
            <Pencil :size="13" :stroke-width="2" />
          </button>
          <button class="action del" @click="remove(key)" title="删除变量">
            <Trash2 :size="13" :stroke-width="2" />
          </button>
        </div>
      </div>
    </div>

    <ElDialog v-model="dialogOpen" :title="dialogMode === 'edit' ? '编辑变量' : '添加变量'" width="420px">
      <ElForm label-position="top">
        <ElFormItem label="key (英文/拼音)">
          <ElInput v-model="form.key" :disabled="dialogMode === 'edit'" />
        </ElFormItem>
        <ElFormItem label="label (中文显示名)"><ElInput v-model="form.label" /></ElFormItem>
        <ElFormItem label="类型">
          <ElSelect v-model="form.type">
            <ElOption label="文本 string" value="string" />
            <ElOption label="数字 number" value="number" />
            <ElOption label="日期 date" value="date" />
            <ElOption label="日期时间 datetime" value="datetime" />
            <ElOption label="布尔 boolean" value="boolean" />
            <ElOption label="枚举 enum" value="enum" />
            <ElOption label="图片 image" value="image" />
            <ElOption label="数组 array" value="array" />
          </ElSelect>
        </ElFormItem>

        <ElFormItem v-if="form.type === 'string'" label="最大长度">
          <ElInput v-model.number="form.maxLength" type="number" />
        </ElFormItem>
        <ElFormItem v-if="form.type === 'number'" label="千分位显示">
          <ElCheckbox v-model="form.thousands" />
        </ElFormItem>
        <ElFormItem v-if="form.type === 'date' || form.type === 'datetime'" label="格式">
          <ElInput v-model="form.format" :placeholder="form.type === 'datetime' ? 'YYYY-MM-DD HH:mm' : 'YYYY-MM-DD'" />
        </ElFormItem>
        <template v-if="form.type === 'boolean'">
          <ElFormItem label="true 显示文案"><ElInput v-model="form.trueLabel" placeholder="是" /></ElFormItem>
          <ElFormItem label="false 显示文案"><ElInput v-model="form.falseLabel" placeholder="否" /></ElFormItem>
        </template>
        <template v-if="form.type === 'enum'">
          <ElFormItem label="选项">
            <div v-for="(o, i) in form.options || []" :key="i" class="enum-row">
              <ElInput v-model="o.value" placeholder="value" style="width:40%" />
              <ElInput v-model="o.label" placeholder="label" style="width:40%; margin-left:8px" />
              <ElButton link type="danger" @click="removeOptionRow(i)" style="margin-left:8px">×</ElButton>
            </div>
            <ElButton link @click="addOptionRow" style="margin-top:6px">+ 添加选项</ElButton>
          </ElFormItem>
        </template>
        <ElFormItem v-if="form.type === 'image'" label="允许格式">
          <ElCheckbox :model-value="form.accept?.includes('image/svg+xml') ?? true"
            @change="(v) => (form.accept = toggleAcc(form.accept, 'image/svg+xml', !!v))">SVG</ElCheckbox>
          <ElCheckbox :model-value="form.accept?.includes('image/png') ?? true"
            @change="(v) => (form.accept = toggleAcc(form.accept, 'image/png', !!v))">PNG</ElCheckbox>
          <ElCheckbox :model-value="form.accept?.includes('image/jpeg') ?? true"
            @change="(v) => (form.accept = toggleAcc(form.accept, 'image/jpeg', !!v))">JPG</ElCheckbox>
        </ElFormItem>

        <ElFormItem label="示例值"><ElInput v-model="form.example" /></ElFormItem>

        <ElButton type="primary" style="width: 100%" @click="submit">
          {{ dialogMode === 'edit' ? '保存' : '添加' }}
        </ElButton>
      </ElForm>
    </ElDialog>
  </div>
</template>

<style scoped>
.field-mgr { min-height: 0; }
.fm-body { flex: 1; overflow-y: auto; padding: 8px 10px 12px; }
.empty { padding: 24px 12px; text-align: center; color: var(--tp-ink-faint); font-size: 12px; line-height: 1.7; }
.field-card {
  margin-bottom: 6px; padding: 8px 10px;
  border-radius: var(--tp-radius-item, 8px);
  border: 1px solid var(--tp-line-strong); background: var(--tp-panel);
  font-size: 12px;
  transition: border-color 120ms ease, background 120ms ease;
}
.field-card:hover { border-color: var(--tp-accent); background: var(--tp-field-bg); }
.field-card.unused { background: var(--tp-warn-bg); border-color: var(--tp-warn-line); }
.card-row { display: flex; align-items: center; gap: 6px; min-width: 0; }
.card-row-sub { margin-top: 2px; }
.k { font-family: ui-monospace, monospace; font-weight: 600; color: var(--tp-ink); flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.t {
  font-size: 10px; background: var(--tp-accent-bg); color: var(--tp-accent-ink);
  padding: 1px 6px; border-radius: 4px; font-family: ui-monospace, monospace; flex-shrink: 0;
}
.l { flex: 1; min-width: 0; color: var(--tp-ink-soft); font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.req { font-size: 10px; color: var(--tp-accent-ink); background: var(--tp-accent-bg); padding: 0 5px; border-radius: 3px; flex-shrink: 0; }
.action {
  border: none; background: transparent;
  color: var(--tp-ink-faint); cursor: pointer;
  width: 22px; height: 22px; border-radius: 4px;
  display: inline-flex; align-items: center; justify-content: center;
  flex-shrink: 0;
}
.action:hover { background: var(--tp-field-bg); color: var(--tp-accent-ink); }
.action.del:hover { background: rgba(217, 79, 79, 0.1); color: #d94f4f; }

.enum-row { display: flex; align-items: center; margin-bottom: 4px; }
</style>
```

- [ ] **Step 2: Type-check + commit**

```bash
docker compose -f docker-compose.dev.yml exec -T web sh -c 'cd /workspace/apps/web && NODE_OPTIONS=--max-old-space-size=4096 ./node_modules/.bin/vue-tsc --noEmit 2>&1 | tail -10'
git add apps/web/src/designer/FieldManager.vue
git commit -m "feat(designer): FieldManager — edit dialog + 变量 rename + unused color + Lucide icons"
```

---

### Task 14: BorderControl — SliderWithInput migration (iter 6)

**Files:**
- Modify: `apps/web/src/designer/BorderControl.vue`

- [ ] **Step 1: Replace the width control**

In `apps/web/src/designer/BorderControl.vue`, find the existing `<input type="range" ... class="slider" ...>` for border width. Replace the whole `.ctrl-row` block that contains it with:

```vue
<div class="ctrl-row">
  <span class="ctrl-lbl">粗细</span>
  <SliderWithInput
    :model-value="currentWidth()"
    :min="1" :max="8" :step="1"
    :format="(v: number) => `${v} px`"
    @update:model-value="(v: number) => patchAllSides({ width: v })"
  />
</div>
```

Add to imports in `<script setup>`:

```ts
import SliderWithInput from './SliderWithInput.vue';
```

Remove the now-unused `.slider` and `.ctrl-val` CSS rules (the SliderWithInput owns its display).

- [ ] **Step 2: Type-check + commit**

```bash
docker compose -f docker-compose.dev.yml exec -T web sh -c 'cd /workspace/apps/web && NODE_OPTIONS=--max-old-space-size=4096 ./node_modules/.bin/vue-tsc --noEmit 2>&1 | tail -10'
git add apps/web/src/designer/BorderControl.vue
git commit -m "feat(designer): BorderControl width uses SliderWithInput"
```

---

### Task 15: PropertyPanel — iter 5 binding controls + iter 6 polish (font-weight, textAlign, 布局·高级, sliders, BarcodeProperties/QrProperties dispatch)

**Files:**
- Modify: `apps/web/src/designer/PropertyPanel.vue`

This is the largest task. Read the existing file first; the edits replace specific blocks while preserving structure.

- [ ] **Step 1: Update imports**

In `<script setup>` add (alongside existing imports):

```ts
import { allowedFieldTypesForElement } from './elementFactory';
import BarcodeProperties from './BarcodeProperties.vue';
import QrProperties from './QrProperties.vue';
import SliderWithInput from './SliderWithInput.vue';
// eslint-disable-next-line import/no-unresolved
import { Trash2 } from 'lucide-vue-next';
```

- [ ] **Step 2: Add compatibleFields computed for field binding**

Near the other computed values (next to `sel`):

```ts
const compatibleFields = computed(() => {
  if (!sel.value) return [];
  const allowed = allowedFieldTypesForElement(sel.value.type);
  return store.fieldDefs.filter((f) => allowed.includes(f.def.type));
});

const currentBindingMissing = computed(() => {
  if (!sel.value || !('binding' in sel.value)) return false;
  const b = (sel.value as { binding?: string }).binding;
  if (!b) return false;
  return !compatibleFields.value.some((f) => f.key === b);
});
```

- [ ] **Step 3: Replace the field-element binding row**

Find the existing block that renders for `sel.type === 'field' || sel.type === 'table'`. Split it into two separate blocks:

For field:

```vue
<div v-if="sel && sel.type === 'field'" class="row">
  <span class="lbl">绑定</span>
  <ElSelect
    size="small"
    :model-value="sel.binding"
    style="flex: 1"
    @change="(v: string) => setBinding(v)"
  >
    <ElOption value="" label="（未绑定）" />
    <ElOption
      v-for="f in compatibleFields"
      :key="f.key"
      :value="f.key"
      :label="`${f.key} · ${f.def.label}`"
    />
    <ElOption
      v-if="currentBindingMissing"
      :value="sel.binding"
      :label="`⚠ ${sel.binding} (类型不兼容)`"
      disabled
    />
  </ElSelect>
</div>
```

For table (keep binding required; no `(未绑定)` option):

```vue
<div v-if="sel && sel.type === 'table'" class="row">
  <span class="lbl">绑定</span>
  <ElSelect
    size="small"
    :model-value="sel.binding"
    style="flex: 1"
    @change="(v: string) => setBinding(v)"
  >
    <ElOption
      v-for="f in compatibleFields"
      :key="f.key"
      :value="f.key"
      :label="`${f.key} · ${f.def.label}`"
    />
  </ElSelect>
</div>
```

- [ ] **Step 4: Add BarcodeProperties / QrProperties dispatch**

In the template, immediately before `<BorderControl>` (and removing any existing `<BarcodeProperties>` mount for the merged 'barcode' type from iter 2):

```vue
<BarcodeProperties
  v-if="sel && sel.type === 'barcode'"
  :element="sel"
  @update="(patch: Partial<TemplateElement>) => store.updateElement(sel!.id, patch)"
/>
<QrProperties
  v-if="sel && sel.type === 'qr'"
  :element="sel"
  @update="(patch: Partial<TemplateElement>) => store.updateElement(sel!.id, patch)"
/>
```

- [ ] **Step 5: textAlign label change**

Find the segmented buttons block:

```vue
<button v-for="a in ['left','center','right','justify'] as const" :key="a"
  :class="{ on: sel.style.textAlign === a }"
  @click="updateStyle({ textAlign: a })">
  {{ {left:'左',center:'中',right:'右',justify:'端'}[a] }}
</button>
```

Replace the label map's value:

```vue
{{ {left:'左',center:'中',right:'右',justify:'两端'}[a] }}
```

- [ ] **Step 6: Font weight labels**

Find the font weight `<select>` and replace its options:

```vue
<select
  :value="sel.style.fontWeight ?? 400"
  class="ssel"
  @change="(e: Event) => updateStyle({ fontWeight: Number((e.target as HTMLSelectElement).value) as 400 | 500 | 600 | 700 })"
>
  <option :value="400">偏细</option>
  <option :value="500">常规</option>
  <option :value="600">加粗</option>
  <option :value="700">特粗</option>
</select>
```

- [ ] **Step 7: Restructure 高级 sections — move universal fields out**

Find the existing "样式 · 高级" collapsible block. Its current content (字体 / 字间距 / 行高 / 装饰 / 背景色 / 垂直对齐 / 层级 z / 旋转 / 透明度 / 溢出) splits into two:

A) Keep "样式 · 高级" gated on `isTextish(sel)` with content:
- 字体 fontFamily
- 字间距 letterSpacing
- 行高 lineHeight
- 装饰 textDecoration
- 垂直对齐 verticalAlign
- 溢出 textOverflow

B) Add a NEW sibling block "布局 · 高级" gated on `sel != null` (universal) with content:
- 背景色 backgroundColor
- 层级 z zIndex
- 旋转 rotation (using SliderWithInput)
- 透明度 opacity (using SliderWithInput)

Concrete markup for the NEW 布局·高级 block (place right after the existing 样式·高级 block):

```vue
<div v-if="sel" class="style-block">
  <div class="style-title sclickable" @click="advancedOpen = !advancedOpen">
    布局 · 高级 <span class="caret">{{ advancedOpen ? '▾' : '▸' }}</span>
  </div>
  <div v-if="advancedOpen">
    <div class="srow">
      <span class="slbl">背景色</span>
      <input type="color" :value="sel.style.backgroundColor ?? '#ffffff'"
        @input="(e: Event) => updateStyle({ backgroundColor: (e.target as HTMLInputElement).value })" />
    </div>
    <div class="srow">
      <span class="slbl">层级 z</span>
      <input type="number" :value="sel.style.zIndex ?? 0" class="snum"
        @input="(e: Event) => updateStyle({ zIndex: Number((e.target as HTMLInputElement).value) })" />
    </div>
    <div class="srow">
      <span class="slbl">旋转</span>
      <SliderWithInput
        :model-value="sel.style.rotation ?? 0"
        :min="-180" :max="180" :step="1"
        :format="(v: number) => `${v}°`"
        @update:model-value="(v: number) => updateStyle({ rotation: v })"
      />
    </div>
    <div class="srow">
      <span class="slbl">透明度</span>
      <SliderWithInput
        :model-value="Math.round((sel.style.opacity ?? 1) * 100)"
        :min="0" :max="100" :step="1"
        :format="(v: number) => `${v}%`"
        @update:model-value="(v: number) => updateStyle({ opacity: v / 100 })"
      />
    </div>
  </div>
</div>
```

In the EXISTING 样式·高级 block, remove the 4 rows that moved to the new block (背景色 / 层级 z / 旋转 / 透明度). The remaining rows (字体 / 字间距 / 行高 / 装饰 / 垂直对齐 / 溢出) stay.

Both blocks reuse the same `advancedOpen` ref — one click toggles both.

- [ ] **Step 8: Replace the existing rotation + opacity sliders in 样式·高级 (now moved)**

Already covered in Step 7. The original raw `<input type="range">` markup for rotation/opacity in 样式·高级 is REMOVED.

- [ ] **Step 9: Delete-element button uses Lucide Trash2**

Find the existing "删除元素" `<ElButton type="danger" ...>`. Replace its inner content:

```vue
<ElButton type="danger" plain size="small" style="width: 100%" @click="del">
  <Trash2 :size="14" :stroke-width="2" />
  <span style="margin-left: 6px">删除元素</span>
</ElButton>
```

- [ ] **Step 10: Type-check**

```bash
docker compose -f docker-compose.dev.yml exec -T web sh -c 'cd /workspace/apps/web && NODE_OPTIONS=--max-old-space-size=4096 ./node_modules/.bin/vue-tsc --noEmit 2>&1 | tail -15'
```

Expected: exit 0.

- [ ] **Step 11: Commit**

```bash
git add apps/web/src/designer/PropertyPanel.vue
git commit -m "feat(designer): PropertyPanel — binding filter/unbind, 布局·高级 universal, SliderWithInput, font-weight labels, textAlign 两端, Lucide icons"
```

---

### Task 16: DesignerHeader — Lucide icons (iter 6)

**Files:**
- Modify: `apps/web/src/designer/DesignerHeader.vue`

- [ ] **Step 1: Update imports**

In `<script setup>` add (alongside existing imports):

```ts
// eslint-disable-next-line import/no-unresolved
import {
  ArrowLeft, Undo2, Redo2, FileText, Grid3x3, RotateCw, ZoomIn,
  Eye, Save, Printer, Plus,
} from 'lucide-vue-next';
```

- [ ] **Step 2: Swap emoji + glyphs in template**

Find each `<button class="tt-btn">` and replace its text/emoji content with the Lucide component + remaining text:

```vue
<!-- Back -->
<button class="tt-btn tt-icon" title="返回" @click="exitToHome">
  <ArrowLeft :size="16" :stroke-width="2" />
</button>

<!-- Undo / Redo -->
<button class="tt-btn" :disabled="!store.canUndo" title="撤销 (⌘Z)" @click="store.undo">
  <Undo2 :size="16" :stroke-width="2" />
</button>
<button class="tt-btn" :disabled="!store.canRedo" title="重做 (⌘⇧Z)" @click="store.redo">
  <Redo2 :size="16" :stroke-width="2" />
</button>

<!-- Paper dropdown trigger -->
<button class="tt-btn">
  <FileText :size="16" :stroke-width="2" />
  {{ paperLabel }}
</button>

<!-- Cell dropdown trigger -->
<button class="tt-btn">
  <Grid3x3 :size="16" :stroke-width="2" />
  {{ cellLabel }}
</button>

<!-- Rotate -->
<button class="tt-btn" title="旋转 90°" @click="store.rotate()">
  <RotateCw :size="16" :stroke-width="2" />
</button>

<!-- Zoom dropdown trigger -->
<button class="tt-btn">
  <ZoomIn :size="16" :stroke-width="2" />
  {{ zoomLabel }}
</button>

<!-- Preview / Save / Print -->
<button class="tt-btn" @click="previewOpen = true">
  <Eye :size="16" :stroke-width="2" />
  预览
</button>
<button class="tt-btn tt-primary" @click="ElMessage.info('保存到后端在 Plan 3 实现，草稿已存本地')">
  <Save :size="16" :stroke-width="2" />
  保存
</button>
<button class="tt-btn tt-accent" @click="doPrint">
  <Printer :size="16" :stroke-width="2" />
  立即打印
</button>
```

For the paper dropdown's `⊕ 自定义…` item, replace with:

```vue
<ElDropdownItem divided @click="customDialogOpen = true">
  <Plus :size="14" :stroke-width="2" style="margin-right: 6px" />
  自定义…
</ElDropdownItem>
```

- [ ] **Step 3: Type-check + commit**

```bash
docker compose -f docker-compose.dev.yml exec -T web sh -c 'cd /workspace/apps/web && NODE_OPTIONS=--max-old-space-size=4096 ./node_modules/.bin/vue-tsc --noEmit 2>&1 | tail -10'
git add apps/web/src/designer/DesignerHeader.vue
git commit -m "feat(designer): DesignerHeader uses Lucide icons throughout"
```

---

### Task 17: DesignerView — mount TemplateNameEditor (iter 6)

**Files:**
- Modify: `apps/web/src/views/DesignerView.vue`

- [ ] **Step 1: Import + use the editor**

In `<script setup>` add:

```ts
import TemplateNameEditor from '../designer/TemplateNameEditor.vue';
```

In `<template>`, find the left-panel head:

```vue
<div class="tp-panel-head">
  <div class="tp-head-text">
    <div class="tp-head-title">{{ store.template.meta.name }}</div>
    <div class="tp-head-sub">v{{ store.template.meta.version }} · 草稿已保存</div>
  </div>
</div>
```

Replace with:

```vue
<div class="tp-panel-head">
  <div class="tp-head-text">
    <TemplateNameEditor />
    <div class="tp-head-sub">v{{ store.template.meta.version }} · 草稿已保存</div>
  </div>
</div>
```

(`tp-head-title` div is gone — TemplateNameEditor produces its own wrapper. The `tp-head-text` flex column stays.)

- [ ] **Step 2: Type-check + commit**

```bash
docker compose -f docker-compose.dev.yml exec -T web sh -c 'cd /workspace/apps/web && NODE_OPTIONS=--max-old-space-size=4096 ./node_modules/.bin/vue-tsc --noEmit 2>&1 | tail -10'
git add apps/web/src/views/DesignerView.vue
git commit -m "feat(designer): mount TemplateNameEditor in left panel head"
```

---

### Task 18: Final acceptance pass

- [ ] **Step 1: Full vue-tsc + schema tests**

```bash
docker compose -f docker-compose.dev.yml exec -T web sh -c 'cd /workspace/apps/web && NODE_OPTIONS=--max-old-space-size=8192 ./node_modules/.bin/vue-tsc --noEmit'
docker compose -f docker-compose.dev.yml exec -T web sh -c 'cd /workspace/packages/schema && pnpm test'
```

Expected: both green.

- [ ] **Step 2: Browser walk-through — iteration 5 + 6 acceptance items**

Open `http://localhost:5173/designer/new`. Verify ALL items below:

iter 5:
1. Element library has separate 二维码 (QrCode icon) and 条码 (Barcode icon).
2. Drop a 条码 → barcode is immediately visible (no transparent state).
3. Drop a 二维码 → QR is immediately visible.
4. 条码's symbology dropdown lists exactly: Code 128, Code 39, EAN-13, ITF-14.
5. 二维码 panel: ECC + colors + quiet zone, no symbology dropdown.
6. Both barcode panels have 静态文本 / 字段绑定 picker, with field list showing only string + number fields.
7. Switching modes (static ↔ field) clears the other side cleanly.
8. Field card hover shows Pencil + Trash2 icons.
9. Click Pencil → dialog opens prefilled; key input is disabled.
10. Submit edit → field updates; if a binding becomes incompatible due to type change, toast warns and binding is cleared.
11. Drop a 字段 → its binding default is empty; PropertyPanel binding shows `（未绑定）`.
12. Field-binding dropdown shows only type-compatible fields.
13. 明细 binding dropdown shows only array fields, no `（未绑定）`.

iter 6:
14. CanvasElementsList sub-head shows `清空` button when count > 0; click → confirm → all cleared.
15. Unused field card has warm-yellow background, NO "未使用" text.
16. ElementLibrary sub-title reads `元素组件`.
17. FieldManager sub-title reads `变量 · 共 N 个`.
18. textAlign segmented buttons show `左 / 中 / 右 / 两端`.
19. Template name in left panel head is clickable → inline input → blur/Enter commits, Esc cancels.
20. Border-width / rotation / opacity / quietZone all show the right-side numeric label; double-click → number input → Enter commits, Esc cancels.
21. Font weight `<select>` shows `偏细 / 常规 / 加粗 / 特粗`.
22. Select a rect element → 布局·高级 visible (background / z / rotation / opacity); 样式·高级 (text-only) hidden.
23. Select a text element → both blocks visible.
24. Toolbar shows Lucide icons (ArrowLeft / Undo2 / Redo2 / FileText / Grid3x3 / RotateCw / ZoomIn / Eye / Save / Printer).
25. Element library buttons render Lucide icons (Type/Braces/Hash/Clock/Square/Image/Table/QrCode/Barcode).
26. Field card actions use Pencil + Trash2 at 13px.
27. CanvasElementsList row delete uses X at 14px.
28. Open an iter-4 draft with `symbology:'qr'` → opens as `type:'qr'`, no visual jump.
29. Open a draft with `symbology:'ean8'` or `'upc-a'` → coerced to Code 128, toast shown.

For any failure, file a follow-up issue; don't fix silently.

- [ ] **Step 3: Report status to user — do NOT auto-merge**

Per repo convention, the user merges to master after confirmation.

---

## Self-Review

Spec coverage:

**iter 5 §A (barcode/QR split + content source + first-render fix)**:
- A.1 split → Task 1 (schema) + Task 3 (factory) + Task 4 (BarcodeElement strip) + Task 5 (new QrElement) + Task 6 (CanvasElement/HitZones/pointer-drag wiring)
- A.2 renderer split → Task 4 + Task 5
- A.3 library + factory → Task 3
- A.4 MIN_MM → Task 3
- A.5 HitZones + pointer drag → Task 6
- A.6 property panel split → Task 9 (BarcodeProperties) + Task 10 (QrProperties) + Task 15 (dispatch from PropertyPanel)
- A.7 content source picker → Task 8 (BarcodeContentPicker) + Tasks 9 + 10 use it
- A.8 empty placeholder → Tasks 4 + 5
- A.9 first-render fix → Task 5 (QrElement uses `flush: 'post'`); BarcodeElement already has it from iter-4 Task 10
- A.10 legacy migration → Task 2
- A.11 acceptance items → Task 18

**iter 5 §B (field editing + binding controls)**:
- B.1 FieldManager edit dialog → Task 13
- B.2 PropertyPanel binding controls → Task 15
- B.3 default empty binding → Task 3
- B.4 schema relax → Task 1
- B.5 acceptance items → Task 18

**iter 6 §A polish**:
- A.1 clear-all → Task 2 (store action) + Task 12 (CanvasElementsList button)
- A.2 unused color → Task 13 (FieldManager removes tag)
- A.3 renames → Task 11 (ElementLibrary), Task 13 (FieldManager)
- A.4 textAlign label → Task 15
- A.5 template name edit → Task 7 (component) + Task 17 (DesignerView mount)

**iter 6 §B SliderWithInput**:
- Component → Task 7
- BorderControl migration → Task 14
- PropertyPanel rotation/opacity migration → Task 15
- BarcodeProperties / QrProperties quietZone → Tasks 9 + 10

**iter 6 §C font weight labels** → Task 15

**iter 6 §D PropertyPanel universal style audit** → Task 15

**iter 6 §E Lucide migration** → Task 7 (install + first new components) + Task 11 (ElementLibrary) + Task 12 (CanvasElementsList) + Task 13 (FieldManager) + Task 15 (PropertyPanel) + Task 16 (DesignerHeader)

No placeholders; every code block has complete content. Type/name consistency: `allowedFieldTypesForElement`, `editField`, `deleteAllElements`, `BarcodeContentPicker`, `SliderWithInput`, `TemplateNameEditor`, `QrElement`, `QrElementSchema`, `MIN_MM.qr`, `iconFor` used consistently across tasks.

The file `apps/web/src/designer/PropertyPanel.vue` is bundled (Task 15) — all iter-5 + iter-6 edits to this file happen in one task. Same for FieldManager.vue (Task 13).
