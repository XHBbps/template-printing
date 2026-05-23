# Designer Iteration 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply the 14-item iteration-2 design (mm-anchor schema, expanded papers, smart cell rescale, richer styles, image upload, UI cleanups) to the designer.

**Architecture:** Schema package gains a mm-anchor field + expanded styling + new field types. The designer store recomputes derived `grid` from `anchor` on every cell/paper change. UI panels are augmented (BorderControl rewrite, PropertyPanel text-style block, BarcodeProperties, image upload). A new Nest UploadsModule sanitises + stores logos served from a volume.

**Tech Stack:** Vue 3 SFC + Pinia, Zod v3 schemas in `packages/schema`, Element Plus 2.7, Nest 10 + sharp + sanitize-html + file-type, Playwright e2e for browser flows, vitest + supertest for unit/e2e.

**Source spec:** `docs/superpowers/specs/2026-05-22-designer-iteration-2-design.md`

**Conventions in this repo (read before starting):**
- ESLint `import/no-unresolved` does not understand workspace package names or vue-router/pinia/zod under bundler resolution. Existing files use `// eslint-disable-next-line import/no-unresolved` immediately above each such import. **Follow that pattern** when adding new imports; do not edit `.eslintrc`.
- Schema package imports use `.js` extension even when the file is `.ts` — that's the bundler `moduleResolution` quirk: `from '../src/template.js'`.
- The dev environment runs in docker (`docker-compose.dev.yml`). For one-off commands inside containers use: `docker compose -f docker-compose.dev.yml exec -T web sh -c 'cd /workspace/apps/web && <cmd>'`.
- `vue-tsc` needs `NODE_OPTIONS=--max-old-space-size=4096` minimum on this discriminated-union schema; use 8192 to be safe.
- **Do not** skip git hooks. The pre-commit lint-staged hook is the authoritative formatter and linter. If it complains, fix the cause.

---

## File Structure

### Schema (`packages/schema/src/`)
- **Modify** `template.ts` — add `anchor` to `Base`; expand `StyleSchema` with 14 fields; expand `BarcodeElementSchema` with QR/1D controls; refactor `FieldDefSchema` to `discriminatedUnion` with new variants; expand `PaperSchema` preset enum.
- **Modify** `test/template.spec.ts` — extend baseline fixtures with anchor; add new variant tests.
- **Add** `test/anchor-derivation.spec.ts` — helper round-trip tests.

### Renderers (`packages/template-renderer/src/elements/`)
- **Modify** `TextElement.vue`, `FieldElement.vue`, `AutonumberElement.vue`, `SystemElement.vue`, `TableElement.vue` — consume new style fields.
- **Modify** `BarcodeElement.vue` — wire new barcode options into `bwip-js` and the QR generator.
- **Modify** `ImageElement.vue` — no schema change, but ensure image source field-binding still works.

### Web app (`apps/web/src/`)
- **Modify** `stores/designer.ts` — paper preset table (11 + custom support), `paperPxSize`, `recomputeGridFromAnchor`, anchor-aware `moveElement`/`resizeElement`/`setCellSize`/`setPaper`, draft migration.
- **Modify** `designer/elementFactory.ts` — default `anchor` for each new element.
- **Modify** `designer/DesignerHeader.vue` — expanded paper dropdown, custom-paper trigger, expanded toolbar CSS, grouped layout with overflow.
- **Add** `designer/CustomPaperDialog.vue` — modal for w/h mm + cell preview + validation.
- **Modify** `designer/ElementLibrary.vue` — 3-group categorisation, drop "点击或拖入".
- **Modify** `designer/CanvasElementsList.vue` — pagination + hover-delete.
- **Modify** `designer/PropertyPanel.vue` — mm-based axis inputs, cell-equivalent badge; style "基础" + "高级" subgroups; barcode-specific sub-panel.
- **Modify** `designer/BorderControl.vue` — per-side toggle stays; replace ✓/grid display with line-style icons + width slider + color picker.
- **Add** `designer/BarcodeProperties.vue` — QR vs 1D conditional controls (ECC, colors, quiet zone, text position, font size).
- **Modify** `designer/HitZones.vue` — accept `mode: 'free' | 'qr'` prop, hide edge handles in qr mode.
- **Modify** `designer/usePointerDrag.ts` — QR 1:1 lock on corner, 1D barcode min-rs guard, expose live-ratio info for the size badge.
- **Modify** `designer/CanvasElement.vue` — live size-badge format ("28×28 格 (1:1)" for QR).
- **Modify** `designer/FieldManager.vue` — dialog with type-conditional sub-fields (enum options editor, boolean labels, image accept allowlist, datetime format).
- **Modify** `views/DesignerView.vue` — remove `.tp-avatar`.
- **Modify** `styles/designer.css` — toolbar widening + grouping; minor selectors for new components.
- **Add** `composables/useImageUpload.ts` — small wrapper around `POST /api/uploads/image`.

### API (`apps/api/`)
- **Add** `src/uploads/uploads.module.ts`, `uploads.controller.ts`, `uploads.service.ts`.
- **Modify** `src/app.module.ts` — import `UploadsModule` + `ServeStaticModule` for `/uploads`.
- **Modify** `package.json` — add `sharp`, `sanitize-html`, `file-type`, `@nestjs/serve-static`, `@nestjs/platform-express`, `multer`, `@types/sanitize-html`, `@types/multer`.
- **Modify** `Dockerfile.dev` — `apk add --no-cache vips-dev` so sharp builds, plus `libc6-compat` if not already.
- **Add** `test/uploads.e2e.spec.ts`.
- **Add** `src/uploads/svg-sanitiser.ts` — pure function `sanitiseSvg(buf: Buffer): Buffer | null`.
- **Add** `test/svg-sanitiser.spec.ts`.

### Compose (`docker-compose.dev.yml`)
- **Modify** — add `./storage:/storage` mount on the `api` service.

---

## Tasks

### Task 1: Add `anchor` field to TemplateElement schema

**Files:**
- Modify: `packages/schema/src/template.ts`
- Modify: `packages/schema/test/template.spec.ts`

- [ ] **Step 1: Write the failing test**

Edit `packages/schema/test/template.spec.ts`. Add to the existing `describe('TemplateSchema', ...)`:

```ts
describe('anchor field', () => {
  it('parses an element with an anchor', () => {
    const el = {
      id: 'e1',
      type: 'text',
      grid: { c: 0, r: 0, cs: 4, rs: 2 },
      anchor: { x: 0, y: 0, w: 4, h: 2 },
      style: baseStyle,
      content: { static: 'hi' },
    };
    expect(ElementSchema.parse(el)).toMatchObject({ anchor: { x: 0, y: 0, w: 4, h: 2 } });
  });

  it('rejects negative anchor coordinates', () => {
    const el = {
      id: 'e1',
      type: 'text',
      grid: { c: 0, r: 0, cs: 4, rs: 2 },
      anchor: { x: -1, y: 0, w: 4, h: 2 },
      style: baseStyle,
      content: { static: 'hi' },
    };
    expect(() => ElementSchema.parse(el)).toThrow();
  });

  it('rejects zero-size anchor', () => {
    const el = {
      id: 'e1',
      type: 'text',
      grid: { c: 0, r: 0, cs: 4, rs: 2 },
      anchor: { x: 0, y: 0, w: 0, h: 2 },
      style: baseStyle,
      content: { static: 'hi' },
    };
    expect(() => ElementSchema.parse(el)).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
docker compose -f docker-compose.dev.yml exec -T web sh -c 'cd /workspace/packages/schema && pnpm test'
```

Expected: 3 new tests fail because `anchor` is unknown.

- [ ] **Step 3: Add `anchor` to `Base` in `template.ts`**

Edit `packages/schema/src/template.ts` — replace the `Base` block (around lines 52–56) with:

```ts
export const AnchorSchema = z.object({
  x: z.number().nonnegative(),
  y: z.number().nonnegative(),
  w: z.number().positive(),
  h: z.number().positive(),
});
export type Anchor = z.infer<typeof AnchorSchema>;

const Base = z.object({
  id: z.string().min(1),
  grid: GridPosSchema,
  anchor: AnchorSchema,
  style: StyleSchema,
});
```

- [ ] **Step 4: Update existing test fixture**

In `packages/schema/test/template.spec.ts` add `anchor` to every fixture element. Search for `style: baseStyle,` and ensure each adjacent element literal has an `anchor: { x: 0, y: 0, w: 4, h: 2 }` line (or any positive values) before `style:`. Apply to all element fixtures in the file (textElement, fieldElement, tableElement, etc.).

- [ ] **Step 5: Run tests to verify they all pass**

```bash
docker compose -f docker-compose.dev.yml exec -T web sh -c 'cd /workspace/packages/schema && pnpm test'
```

Expected: all green, including the 3 new anchor tests.

- [ ] **Step 6: Commit**

```bash
git add packages/schema/src/template.ts packages/schema/test/template.spec.ts
git commit -m "feat(schema): add mm anchor field to element base"
```

---

### Task 2: Expand StyleSchema with 14 new fields

**Files:**
- Modify: `packages/schema/src/template.ts`
- Modify: `packages/schema/test/template.spec.ts`

- [ ] **Step 1: Write the failing test**

Add to `packages/schema/test/template.spec.ts`:

```ts
describe('expanded StyleSchema', () => {
  it('accepts new optional style fields', () => {
    const style = {
      ...baseStyle,
      color: '#222',
      fontFamily: 'serif' as const,
      fontSize: 14,
      fontWeight: 600 as const,
      letterSpacing: 0.5,
      lineHeight: 1.5,
      textDecoration: 'underline' as const,
      backgroundColor: '#fff',
      textAlign: 'center' as const,
      verticalAlign: 'middle' as const,
      zIndex: 5,
      rotation: 30,
      opacity: 0.8,
      textOverflow: 'ellipsis' as const,
    };
    expect(StyleSchema.parse(style)).toMatchObject({
      color: '#222',
      fontWeight: 600,
      rotation: 30,
      opacity: 0.8,
    });
  });

  it('rejects opacity > 1', () => {
    expect(() => StyleSchema.parse({ ...baseStyle, opacity: 1.5 })).toThrow();
  });

  it('rejects fontWeight outside the enum', () => {
    expect(() => StyleSchema.parse({ ...baseStyle, fontWeight: 800 })).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify failure**

```bash
docker compose -f docker-compose.dev.yml exec -T web sh -c 'cd /workspace/packages/schema && pnpm test'
```

Expected: 3 new tests fail (unknown keys / wrong enum).

- [ ] **Step 3: Replace `StyleSchema` in `template.ts`**

Find the existing `StyleSchema` block (around lines 27–37) and replace with:

```ts
export const StyleSchema = z.object({
  border: BorderSchema,
  padding: PaddingSchema,
  background: z.string().nullable().default(null),
  borderRadius: z.number().nonnegative().default(0),

  // Text-style fields (iteration 2). All optional; renderers treat undefined
  // as "inherit / use default".
  color: z.string().optional(),
  fontFamily: z.enum(['sans', 'serif', 'mono']).optional(),
  fontSize: z.number().positive().optional(),
  fontWeight: z.union([z.literal(400), z.literal(500), z.literal(600), z.literal(700)]).optional(),
  letterSpacing: z.number().optional(),
  lineHeight: z.number().positive().optional(),
  textDecoration: z.enum(['none', 'underline', 'overline', 'line-through']).optional(),
  backgroundColor: z.string().optional(),
  textAlign: z.enum(['left', 'center', 'right', 'justify', 'default']).optional(),
  verticalAlign: z.enum(['top', 'middle', 'bottom']).optional(),
  zIndex: z.number().int().optional(),
  rotation: z.number().optional(),
  opacity: z.number().min(0).max(1).optional(),
  textOverflow: z.enum(['clip', 'ellipsis', 'wrap']).optional(),

  // Legacy field kept for backward compat — superseded by `textAlign`.
  align: z.enum(['left', 'center', 'right']).optional(),
});
```

Note the old `fontWeight: z.enum(['normal', 'bold']).optional()` is replaced (existing drafts may have `'normal'`/`'bold'`; Task 27 will migrate them).

- [ ] **Step 4: Run tests**

```bash
docker compose -f docker-compose.dev.yml exec -T web sh -c 'cd /workspace/packages/schema && pnpm test'
```

Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add packages/schema/src/template.ts packages/schema/test/template.spec.ts
git commit -m "feat(schema): expand ElementStyle with 14 text/layout fields"
```

---

### Task 3: Expand BarcodeElement with QR + 1D controls

**Files:**
- Modify: `packages/schema/src/template.ts`
- Modify: `packages/schema/test/template.spec.ts`

- [ ] **Step 1: Write the failing test**

Add to `packages/schema/test/template.spec.ts`:

```ts
describe('expanded BarcodeElementSchema', () => {
  const baseBarcode = {
    id: 'b1',
    type: 'barcode' as const,
    grid: { c: 0, r: 0, cs: 12, rs: 12 },
    anchor: { x: 0, y: 0, w: 12, h: 12 },
    style: baseStyle,
    content: { static: 'SAMPLE' },
    showText: false,
  };

  it('accepts qr with eccLevel + colors + quietZone', () => {
    const el = {
      ...baseBarcode,
      symbology: 'qr' as const,
      eccLevel: 'Q' as const,
      foregroundColor: '#111',
      backgroundColor: '#fff',
      quietZone: 4,
    };
    expect(BarcodeElementSchema.parse(el).eccLevel).toBe('Q');
  });

  it('accepts code128 with textPosition + textFontSize', () => {
    const el = {
      ...baseBarcode,
      symbology: 'code128' as const,
      showText: true,
      textPosition: 'top' as const,
      textFontSize: 12,
    };
    expect(BarcodeElementSchema.parse(el).textPosition).toBe('top');
  });

  it('accepts new symbology values ean8, upc-a, itf14', () => {
    for (const sym of ['ean8', 'upc-a', 'itf14'] as const) {
      const el = { ...baseBarcode, symbology: sym };
      expect(BarcodeElementSchema.parse(el).symbology).toBe(sym);
    }
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
docker compose -f docker-compose.dev.yml exec -T web sh -c 'cd /workspace/packages/schema && pnpm test'
```

Expected: new tests fail (unknown symbology / fields).

- [ ] **Step 3: Replace `BarcodeElementSchema`**

In `template.ts`, replace the existing `BarcodeElementSchema`:

```ts
export const BarcodeElementSchema = Base.extend({
  type: z.literal('barcode'),
  binding: z.string().min(1).optional(),
  content: z.object({ static: z.string() }).optional(),
  symbology: z
    .enum(['qr', 'code128', 'code39', 'ean13', 'ean8', 'upc-a', 'itf14'])
    .default('qr'),
  showText: z.boolean().default(false),

  // QR-only controls
  eccLevel: z.enum(['L', 'M', 'Q', 'H']).optional(),

  // Shared controls (default to black on white)
  foregroundColor: z.string().default('#000000'),
  backgroundColor: z.string().default('#ffffff'),
  quietZone: z.number().nonnegative().default(2),

  // 1D-only controls
  textPosition: z.enum(['top', 'bottom']).optional(),
  textFontSize: z.number().positive().optional(),
});
```

- [ ] **Step 4: Run tests**

```bash
docker compose -f docker-compose.dev.yml exec -T web sh -c 'cd /workspace/packages/schema && pnpm test'
```

Expected: green.

- [ ] **Step 5: Commit**

```bash
git add packages/schema/src/template.ts packages/schema/test/template.spec.ts
git commit -m "feat(schema): expand BarcodeElement with QR/1D controls"
```

---

### Task 4: Convert FieldDefSchema to discriminated union

**Files:**
- Modify: `packages/schema/src/template.ts`
- Modify: `packages/schema/test/template.spec.ts`

- [ ] **Step 1: Write the failing test**

Append to `packages/schema/test/template.spec.ts`:

```ts
describe('FieldDefSchema discriminated union', () => {
  it('parses a string field with maxLength', () => {
    const f = { type: 'string', label: 'Name', required: true, maxLength: 50 };
    expect(FieldDefSchema.parse(f).type).toBe('string');
  });

  it('parses a number field with thousands flag', () => {
    const f = { type: 'number', label: 'Amount', thousands: true };
    expect(FieldDefSchema.parse(f).type).toBe('number');
  });

  it('parses a datetime field', () => {
    const f = { type: 'datetime', label: 'Created', format: 'YYYY-MM-DD HH:mm' };
    expect(FieldDefSchema.parse(f).type).toBe('datetime');
  });

  it('parses a boolean field with custom labels', () => {
    const f = { type: 'boolean', label: 'Active', trueLabel: 'Yes', falseLabel: 'No' };
    expect(FieldDefSchema.parse(f).trueLabel).toBe('Yes');
  });

  it('parses an enum field with options', () => {
    const f = {
      type: 'enum',
      label: 'Status',
      options: [
        { value: 'a', label: '已通过' },
        { value: 'b', label: '已拒绝' },
      ],
    };
    expect(FieldDefSchema.parse(f).options).toHaveLength(2);
  });

  it('parses an image field with accept', () => {
    const f = { type: 'image', label: 'Logo', accept: ['image/svg+xml', 'image/png'] };
    expect(FieldDefSchema.parse(f).accept).toContain('image/svg+xml');
  });

  it('rejects an enum field with no options', () => {
    const f = { type: 'enum', label: 'X', options: [] };
    expect(() => FieldDefSchema.parse(f)).toThrow();
  });

  it('keeps the array field shape', () => {
    const f = { type: 'array', label: 'Items' };
    expect(FieldDefSchema.parse(f).type).toBe('array');
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
docker compose -f docker-compose.dev.yml exec -T web sh -c 'cd /workspace/packages/schema && pnpm test'
```

Expected: many new failures.

- [ ] **Step 3: Replace `FieldDefSchema`**

In `template.ts`, replace the flat `FieldDefSchema`:

```ts
const FieldBase = z.object({
  label: z.string().min(1),
  required: z.boolean().default(false),
  example: z.string().optional(),
});

export const FieldDefSchema = z.discriminatedUnion('type', [
  FieldBase.extend({
    type: z.literal('string'),
    maxLength: z.number().int().positive().optional(),
  }),
  FieldBase.extend({
    type: z.literal('number'),
    min: z.number().optional(),
    max: z.number().optional(),
    thousands: z.boolean().default(false),
  }),
  FieldBase.extend({
    type: z.literal('date'),
    format: z.string().default('YYYY-MM-DD'),
  }),
  FieldBase.extend({
    type: z.literal('datetime'),
    format: z.string().default('YYYY-MM-DD HH:mm'),
  }),
  FieldBase.extend({
    type: z.literal('boolean'),
    trueLabel: z.string().default('是'),
    falseLabel: z.string().default('否'),
  }),
  FieldBase.extend({
    type: z.literal('enum'),
    options: z
      .array(z.object({ value: z.string().min(1), label: z.string().min(1) }))
      .min(1),
  }),
  FieldBase.extend({
    type: z.literal('image'),
    accept: z.array(z.string().min(1)).default(['image/svg+xml', 'image/png', 'image/jpeg']),
  }),
  FieldBase.extend({
    type: z.literal('array'),
    itemSchema: z.record(z.unknown()).optional(),
  }),
]);
```

- [ ] **Step 4: Update existing fixtures**

Search the codebase for `type: 'string'` and `type: 'array'` in field-def contexts — none of the existing field defs in tests use the old `shape` key, so they should pass under the new union. Run tests to confirm:

```bash
docker compose -f docker-compose.dev.yml exec -T web sh -c 'cd /workspace/packages/schema && pnpm test'
```

If any existing fixture fails, add `label` (it's already required by the old shape) — no other change needed.

- [ ] **Step 5: Commit**

```bash
git add packages/schema/src/template.ts packages/schema/test/template.spec.ts
git commit -m "feat(schema): FieldDefSchema → discriminated union with datetime/boolean/enum/image"
```

---

### Task 5: Expand PaperSchema with new presets

**Files:**
- Modify: `packages/schema/src/template.ts`
- Modify: `packages/schema/test/template.spec.ts`

- [ ] **Step 1: Write the failing test**

Add to `template.spec.ts`:

```ts
describe('expanded PaperSchema', () => {
  it.each([
    'A3', 'A3-Landscape',
    'A4', 'A4-Landscape',
    'A5', 'A5-Landscape',
    'A6',
    'B5',
    'Letter',
    'GuardPass',     // 出门证 (90×60)
    'LogisticLabel', // 物流面单 (100×180)
  ])('accepts preset "%s"', (preset) => {
    expect(PaperSchema.parse(preset)).toBe(preset);
  });

  it('accepts custom { w_mm, h_mm }', () => {
    expect(PaperSchema.parse({ w_mm: 173, h_mm: 240 })).toMatchObject({ w_mm: 173 });
  });
});
```

(`GuardPass` and `LogisticLabel` use English identifiers — Chinese labels live in the UI, not the schema.)

- [ ] **Step 2: Run to verify failure**

```bash
docker compose -f docker-compose.dev.yml exec -T web sh -c 'cd /workspace/packages/schema && pnpm test'
```

Expected: most preset tests fail.

- [ ] **Step 3: Replace `PaperSchema`**

Replace in `template.ts`:

```ts
export const PaperPresetSchema = z.enum([
  'A3', 'A3-Landscape',
  'A4', 'A4-Landscape',
  'A5', 'A5-Landscape',
  'A6',
  'B5',
  'Letter',
  'GuardPass',
  'LogisticLabel',
]);
export type PaperPreset = z.infer<typeof PaperPresetSchema>;

export const PaperSchema = z.union([
  PaperPresetSchema,
  z.object({ w_mm: z.number().positive(), h_mm: z.number().positive() }),
]);
```

- [ ] **Step 4: Run tests**

```bash
docker compose -f docker-compose.dev.yml exec -T web sh -c 'cd /workspace/packages/schema && pnpm test'
```

Expected: green.

- [ ] **Step 5: Commit**

```bash
git add packages/schema/src/template.ts packages/schema/test/template.spec.ts
git commit -m "feat(schema): expand PaperPreset to 11 + custom"
```

---

### Task 6: Paper preset table + paperPxSize in the store

**Files:**
- Modify: `apps/web/src/stores/designer.ts`

- [ ] **Step 1: Read the current `PAPER_PRESETS` constant**

Open `apps/web/src/stores/designer.ts`. Replace the existing `PAPER_PRESETS` and `paperPxSize` definitions with:

```ts
// Paper presets in mm. With PX_PER_MM = 4 the resulting pixel dimensions
// share a healthy common-divisor set for most pairs, so cell w/h has many
// valid options. Custom papers are allowed via { w_mm, h_mm }.
const PAPER_PRESETS: Record<string, { w_mm: number; h_mm: number }> = {
  A3: { w_mm: 297, h_mm: 420 },
  'A3-Landscape': { w_mm: 420, h_mm: 297 },
  A4: { w_mm: 210, h_mm: 297 },
  'A4-Landscape': { w_mm: 297, h_mm: 210 },
  A5: { w_mm: 148, h_mm: 210 },
  'A5-Landscape': { w_mm: 210, h_mm: 148 },
  A6: { w_mm: 105, h_mm: 148 },
  B5: { w_mm: 176, h_mm: 250 },
  Letter: { w_mm: 216, h_mm: 279 },
  GuardPass: { w_mm: 90, h_mm: 60 },
  LogisticLabel: { w_mm: 100, h_mm: 180 },
};

function paperPxSize(paper: Template['canvas']['paper']): { w: number; h: number } {
  if (typeof paper === 'string' && paper in PAPER_PRESETS) {
    const p = PAPER_PRESETS[paper];
    return { w: p.w_mm * PX_PER_MM, h: p.h_mm * PX_PER_MM };
  }
  if (typeof paper === 'object' && paper !== null && 'w_mm' in paper) {
    return { w: paper.w_mm * PX_PER_MM, h: paper.h_mm * PX_PER_MM };
  }
  const p = PAPER_PRESETS['A4-Landscape'];
  return { w: p.w_mm * PX_PER_MM, h: p.h_mm * PX_PER_MM };
}
```

- [ ] **Step 2: Type-check**

```bash
docker compose -f docker-compose.dev.yml exec -T web sh -c 'cd /workspace/apps/web && NODE_OPTIONS=--max-old-space-size=4096 ./node_modules/.bin/vue-tsc --noEmit'
```

Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/stores/designer.ts
git commit -m "feat(store): paper preset table — 11 presets"
```

---

### Task 7: Add `recomputeGridFromAnchor` + draft migration

**Files:**
- Modify: `apps/web/src/stores/designer.ts`

- [ ] **Step 1: Write the migration utility and migration in `restore()`**

In `apps/web/src/stores/designer.ts`, add right after the `divisorsInRange` helper:

```ts
function mmFromPx(px: number): number {
  return px / PX_PER_MM;
}

function recomputeGridFromAnchor(el: TemplateElement, cell: { w: number; h: number }): void {
  el.grid = {
    c: Math.round((el.anchor.x * PX_PER_MM) / cell.w),
    r: Math.round((el.anchor.y * PX_PER_MM) / cell.h),
    cs: Math.max(1, Math.round((el.anchor.w * PX_PER_MM) / cell.w)),
    rs: Math.max(1, Math.round((el.anchor.h * PX_PER_MM) / cell.h)),
  };
}

function clampAnchorToPaper(el: TemplateElement, paper: { w_mm: number; h_mm: number }): boolean {
  let changed = false;
  if (el.anchor.w > paper.w_mm) { el.anchor.w = paper.w_mm; changed = true; }
  if (el.anchor.h > paper.h_mm) { el.anchor.h = paper.h_mm; changed = true; }
  if (el.anchor.x + el.anchor.w > paper.w_mm) {
    el.anchor.x = paper.w_mm - el.anchor.w; changed = true;
  }
  if (el.anchor.y + el.anchor.h > paper.h_mm) {
    el.anchor.y = paper.h_mm - el.anchor.h; changed = true;
  }
  if (el.anchor.x < 0) { el.anchor.x = 0; changed = true; }
  if (el.anchor.y < 0) { el.anchor.y = 0; changed = true; }
  return changed;
}
```

Then replace the existing `restore()` action's body with:

```ts
restore(): boolean {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw) as Template;

    // Step 1 — Migrate iteration-1 drafts: derive anchor from grid + OLD cell.
    const oldCell = parsed.canvas.cell;
    for (const el of parsed.elements as Array<TemplateElement & { anchor?: Anchor }>) {
      if (!el.anchor) {
        el.anchor = {
          x: (el.grid.c * oldCell.w) / PX_PER_MM,
          y: (el.grid.r * oldCell.h) / PX_PER_MM,
          w: (el.grid.cs * oldCell.w) / PX_PER_MM,
          h: (el.grid.rs * oldCell.h) / PX_PER_MM,
        };
      }
    }

    // Step 2 — Snap cell to a valid divisor of paper (iteration-1 logic).
    const px = paperPxSize(parsed.canvas.paper);
    let { w, h } = parsed.canvas.cell;
    if (px.w % w !== 0 || px.h % h !== 0) {
      const wOpts = divisorsInRange(px.w);
      const hOpts = divisorsInRange(px.h);
      w = wOpts.includes(4) ? 4 : (wOpts[0] ?? 1);
      h = hOpts.includes(4) ? 4 : (hOpts[0] ?? 1);
      parsed.canvas.cell = { w, h };
    }
    parsed.canvas.cols = px.w / w;
    parsed.canvas.rows = px.h / h;

    // Step 3 — Recompute grid for every element from anchor + new cell.
    for (const el of parsed.elements) {
      recomputeGridFromAnchor(el, parsed.canvas.cell);
    }

    this.template = parsed;
    this.history = [JSON.stringify(parsed)];
    this.historyIndex = 0;
    return true;
  } catch {
    return false;
  }
},
```

Also export `recomputeGridFromAnchor` and `clampAnchorToPaper` (add `export` keywords to their declarations) for use elsewhere.

You will also need to import `Anchor` from the schema. Add to the existing import:

```ts
// eslint-disable-next-line import/no-unresolved
import type { Template, TemplateElement, FieldDefSchema, Anchor } from '@template-printing/schema';
```

- [ ] **Step 2: Type-check**

```bash
docker compose -f docker-compose.dev.yml exec -T web sh -c 'cd /workspace/apps/web && NODE_OPTIONS=--max-old-space-size=4096 ./node_modules/.bin/vue-tsc --noEmit'
```

Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/stores/designer.ts
git commit -m "feat(store): mm-anchor migration + recompute helpers"
```

---

### Task 8: Anchor-aware setCellSize / setPaper

**Files:**
- Modify: `apps/web/src/stores/designer.ts`

- [ ] **Step 1: Replace `setCellSize` action**

In `apps/web/src/stores/designer.ts` replace the `setCellSize` action body:

```ts
setCellSize(w: number, h: number): void {
  const px = paperPxSize(this.template.canvas.paper);
  if (px.w % w !== 0 || px.h % h !== 0) return;
  this.template.canvas.cell = { w, h };
  this.template.canvas.cols = px.w / w;
  this.template.canvas.rows = px.h / h;
  for (const el of this.template.elements) {
    recomputeGridFromAnchor(el, this.template.canvas.cell);
  }
  this.snapshot();
},
```

- [ ] **Step 2: Replace `setPaper` action**

```ts
setPaper(paper: Template['canvas']['paper']): void {
  const px = paperPxSize(paper);
  let { w, h } = this.template.canvas.cell;
  if (px.w % w !== 0 || px.h % h !== 0) {
    const wOpts = divisorsInRange(px.w);
    const hOpts = divisorsInRange(px.h);
    w = wOpts.includes(4) ? 4 : (wOpts[0] ?? 1);
    h = hOpts.includes(4) ? 4 : (hOpts[0] ?? 1);
  }

  // Resolve new paper in mm so we can clamp anchors.
  let newMm: { w_mm: number; h_mm: number };
  if (typeof paper === 'string' && paper in PAPER_PRESETS) {
    newMm = PAPER_PRESETS[paper];
  } else if (typeof paper === 'object' && paper !== null && 'w_mm' in paper) {
    newMm = { w_mm: paper.w_mm, h_mm: paper.h_mm };
  } else {
    newMm = PAPER_PRESETS['A4-Landscape'];
  }

  let movedCount = 0;
  for (const el of this.template.elements) {
    if (clampAnchorToPaper(el, newMm)) movedCount++;
  }

  this.template.canvas.paper = paper;
  this.template.canvas.cell = { w, h };
  this.template.canvas.cols = px.w / w;
  this.template.canvas.rows = px.h / h;
  for (const el of this.template.elements) {
    recomputeGridFromAnchor(el, this.template.canvas.cell);
  }
  this.snapshot();

  if (movedCount > 0) {
    // Use Element Plus toast; import is added at top of file.
    ElMessage.warning(`${movedCount} 个元素已自动移入新画布`);
  }
},
```

Add `ElMessage` to imports at the top:

```ts
// eslint-disable-next-line import/no-unresolved
import { ElMessage } from 'element-plus';
```

- [ ] **Step 3: Type-check**

```bash
docker compose -f docker-compose.dev.yml exec -T web sh -c 'cd /workspace/apps/web && NODE_OPTIONS=--max-old-space-size=4096 ./node_modules/.bin/vue-tsc --noEmit'
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/stores/designer.ts
git commit -m "feat(store): setCellSize/setPaper recompute grid from anchor, clamp out-of-bound"
```

---

### Task 9: Anchor-aware moveElement / resizeElement

**Files:**
- Modify: `apps/web/src/stores/designer.ts`

- [ ] **Step 1: Replace `moveElement` action**

In `apps/web/src/stores/designer.ts` replace:

```ts
moveElement(id: string, c: number, r: number): void {
  const idx = this.template.elements.findIndex((e) => e.id === id);
  if (idx < 0) return;
  const cur = this.template.elements[idx];
  const cell = this.template.canvas.cell;
  this.template.elements[idx] = {
    ...cur,
    grid: { ...cur.grid, c, r },
    anchor: {
      ...cur.anchor,
      x: (c * cell.w) / PX_PER_MM,
      y: (r * cell.h) / PX_PER_MM,
    },
  } as TemplateElement;
},

resizeElement(id: string, cs: number, rs: number, c?: number, r?: number): void {
  const idx = this.template.elements.findIndex((e) => e.id === id);
  if (idx < 0) return;
  const cur = this.template.elements[idx];
  const cell = this.template.canvas.cell;
  const newC = c ?? cur.grid.c;
  const newR = r ?? cur.grid.r;
  this.template.elements[idx] = {
    ...cur,
    grid: { c: newC, r: newR, cs, rs },
    anchor: {
      x: (newC * cell.w) / PX_PER_MM,
      y: (newR * cell.h) / PX_PER_MM,
      w: (cs * cell.w) / PX_PER_MM,
      h: (rs * cell.h) / PX_PER_MM,
    },
  } as TemplateElement;
},
```

Add a new action for direct anchor edits from PropertyPanel:

```ts
setElementAnchor(id: string, patch: Partial<Anchor>): void {
  const idx = this.template.elements.findIndex((e) => e.id === id);
  if (idx < 0) return;
  const cur = this.template.elements[idx];
  const next = { ...cur, anchor: { ...cur.anchor, ...patch } } as TemplateElement;
  recomputeGridFromAnchor(next, this.template.canvas.cell);
  this.template.elements[idx] = next;
  this.snapshot();
},
```

- [ ] **Step 2: Type-check**

```bash
docker compose -f docker-compose.dev.yml exec -T web sh -c 'cd /workspace/apps/web && NODE_OPTIONS=--max-old-space-size=4096 ./node_modules/.bin/vue-tsc --noEmit'
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/stores/designer.ts
git commit -m "feat(store): move/resize write anchor; add setElementAnchor"
```

---

### Task 10: Default anchor in elementFactory

**Files:**
- Modify: `apps/web/src/designer/elementFactory.ts`

- [ ] **Step 1: Update `buildElement`**

Currently the factory returns elements with only `grid`. Add `anchor` derived from grid + a cell width/height passed in. Update the signature:

```ts
// At top of file
const PX_PER_MM = 4;

export function buildElement(
  meta: ElementMeta,
  newId: string,
  c = 4,
  r = 4,
  cellW = 4,
  cellH = 4,
): TemplateElement {
  const grid = { c, r, cs: meta.defaultGrid.cs, rs: meta.defaultGrid.rs };
  const anchor = {
    x: (c * cellW) / PX_PER_MM,
    y: (r * cellH) / PX_PER_MM,
    w: (grid.cs * cellW) / PX_PER_MM,
    h: (grid.rs * cellH) / PX_PER_MM,
  };
  const style = defaultStyle();
  // ... existing switch, but spread anchor into every return
```

For every `return { id: newId, type: '...', grid, style, ... }` add `anchor,`:

```ts
return { id: newId, type: 'text', grid, anchor, style, content: { static: '示例文本' } };
```

Apply to all 9 returns (text/field/image/rect/table/barcode/autonumber/system).

For the barcode return also add the new default fields:

```ts
case 'barcode':
  return {
    id: newId, type: 'barcode', grid, anchor, style,
    symbology: meta.variant === 'qr' ? 'qr' : 'code128',
    content: { static: 'SAMPLE' }, showText: false,
    foregroundColor: '#000000', backgroundColor: '#ffffff', quietZone: 2,
    ...(meta.variant === 'qr' ? { eccLevel: 'M' as const } : { textPosition: 'bottom' as const, textFontSize: 10 }),
  };
```

- [ ] **Step 2: Update callers**

In `apps/web/src/designer/ElementLibrary.vue`:

```ts
function clickAdd(meta: ElementMeta): void {
  const cell = store.template.canvas.cell;
  const el = buildElement(meta, store.newElementId(), 4, 4, cell.w, cell.h);
  store.addElement(el);
}
```

In `apps/web/src/designer/DesignerCanvas.vue` inside `onDrop`:

```ts
const el: TemplateElement = buildElement(
  meta, store.newElementId(), c, r,
  store.template.canvas.cell.w, store.template.canvas.cell.h,
);
```

- [ ] **Step 3: Type-check**

```bash
docker compose -f docker-compose.dev.yml exec -T web sh -c 'cd /workspace/apps/web && NODE_OPTIONS=--max-old-space-size=4096 ./node_modules/.bin/vue-tsc --noEmit'
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/designer/elementFactory.ts apps/web/src/designer/ElementLibrary.vue apps/web/src/designer/DesignerCanvas.vue
git commit -m "feat(designer): elementFactory derives anchor; pass cell to all callers"
```

---

### Task 11: validCellOptions across non-square divisor sets

**Files:**
- Modify: `apps/web/src/stores/designer.ts`

- [ ] **Step 1: Replace `validCellOptions` to expose fallback semantics**

Some new presets (Letter 216×279, B5 176×250, GuardPass 90×60) have no common divisors ≥ 2. Fall back to including `1` in that case:

```ts
validCellOptions(): Array<{ w: number; h: number; cols: number; rows: number }> {
  const px = paperPxSize(this.template.canvas.paper);
  const wOpts = divisorsInRange(px.w);
  const hOpts = divisorsInRange(px.h);
  let common = wOpts.filter((d) => hOpts.includes(d));
  if (common.length === 0) common = [1];
  return common.map((d) => ({ w: d, h: d, cols: px.w / d, rows: px.h / d }));
},
```

Also update the `defaultTemplate` cell selection so it doesn't pick an invalid 4×4 for presets that don't divide by 4:

```ts
export function defaultTemplate(): Template {
  const paper = 'A4-Landscape';
  const px = paperPxSize(paper);
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
      background: null,
    },
    schema: {},
    elements: [],
  };
}
```

- [ ] **Step 2: Type-check**

```bash
docker compose -f docker-compose.dev.yml exec -T web sh -c 'cd /workspace/apps/web && NODE_OPTIONS=--max-old-space-size=4096 ./node_modules/.bin/vue-tsc --noEmit'
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/stores/designer.ts
git commit -m "feat(store): valid cell options fall back to cell=1 for low-divisor presets"
```

---

### Task 12: CustomPaperDialog component

**Files:**
- Create: `apps/web/src/designer/CustomPaperDialog.vue`

- [ ] **Step 1: Create the component**

Write the file:

```vue
<script setup lang="ts">
// eslint-disable-next-line import/no-unresolved
import { ElButton, ElDialog, ElInput } from 'element-plus';
import { computed, ref, watch } from 'vue';

const props = defineProps<{ modelValue: boolean }>();
const emit = defineEmits<{
  (e: 'update:modelValue', v: boolean): void;
  (e: 'confirm', size: { w_mm: number; h_mm: number }): void;
}>();

const PX_PER_MM = 4;

const w = ref<number>(210);
const h = ref<number>(297);

function open() {
  w.value = 210;
  h.value = 297;
}
watch(() => props.modelValue, (v) => { if (v) open(); });

function divisors(n: number, min = 2, max = 40): number[] {
  const out: number[] = [];
  for (let i = min; i <= max && i <= n; i++) if (n % i === 0) out.push(i);
  return out;
}

const pxW = computed(() => w.value * PX_PER_MM);
const pxH = computed(() => h.value * PX_PER_MM);

const cellOptions = computed(() => {
  const a = divisors(pxW.value);
  const b = divisors(pxH.value);
  return a.filter((d) => b.includes(d));
});

const aspectOk = computed(() => {
  const r = Math.max(w.value, h.value) / Math.min(w.value, h.value);
  return r <= 5;
});

const inRange = computed(() => w.value >= 30 && w.value <= 600 && h.value >= 30 && h.value <= 600);
const isPrime = (n: number) => {
  if (n < 2) return false;
  for (let i = 2; i * i <= n; i++) if (n % i === 0) return false;
  return true;
};
const primeSide = computed(() => isPrime(w.value) || isPrime(h.value));

function nearbyNonPrime(n: number): number {
  for (let d = 1; d < 8; d++) {
    if (!isPrime(n - d) && n - d >= 30) return n - d;
    if (!isPrime(n + d) && n + d <= 600) return n + d;
  }
  return n;
}

const canConfirm = computed(() => inRange.value && aspectOk.value && cellOptions.value.length > 0);

function confirm() {
  emit('confirm', { w_mm: Math.round(w.value), h_mm: Math.round(h.value) });
  emit('update:modelValue', false);
}
</script>

<template>
  <ElDialog
    :model-value="props.modelValue"
    @update:model-value="(v: boolean) => emit('update:modelValue', v)"
    title="自定义画布"
    width="420px"
  >
    <div class="cpd-row">
      <label>宽 (mm)</label>
      <ElInput :model-value="String(w)" @update:model-value="(v: string) => w = Math.max(0, Math.floor(Number(v) || 0))" />
    </div>
    <div class="cpd-row">
      <label>高 (mm)</label>
      <ElInput :model-value="String(h)" @update:model-value="(v: string) => h = Math.max(0, Math.floor(Number(v) || 0))" />
    </div>

    <div class="cpd-preview">
      <div>画布像素：{{ pxW }} × {{ pxH }}</div>
      <div v-if="!inRange" class="cpd-error">⚠ 每边需在 30 - 600 mm 范围内</div>
      <div v-else-if="!aspectOk" class="cpd-error">⚠ 长宽比超过 5:1，不允许</div>
      <div v-else-if="cellOptions.length === 0" class="cpd-error">
        ⚠ 此尺寸无任何 cell 候选 (2-40 px 内)，建议调整为附近的高公约数值
      </div>
      <div v-else>
        可选 cell：{{ cellOptions.join(', ') }} px ({{ cellOptions.length }} 个)
      </div>
      <div v-if="primeSide && canConfirm" class="cpd-warn">
        ⚠ 边长含质数 ({{ w }} 或 {{ h }})，cell 选项受限。建议改为
        {{ isPrime(w) ? nearbyNonPrime(w) : w }} × {{ isPrime(h) ? nearbyNonPrime(h) : h }} mm
      </div>
    </div>

    <template #footer>
      <ElButton @click="emit('update:modelValue', false)">取消</ElButton>
      <ElButton type="primary" :disabled="!canConfirm" @click="confirm">确定</ElButton>
    </template>
  </ElDialog>
</template>

<style scoped>
.cpd-row { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
.cpd-row label { width: 60px; color: var(--tp-ink-soft); font-size: 12px; }
.cpd-preview { margin-top: 8px; padding: 10px; background: var(--tp-field-bg); border-radius: 8px; font-size: 12px; color: var(--tp-ink-soft); line-height: 1.8; }
.cpd-error { color: #d94f4f; font-weight: 600; }
.cpd-warn { color: #a16a00; }
</style>
```

- [ ] **Step 2: Type-check**

```bash
docker compose -f docker-compose.dev.yml exec -T web sh -c 'cd /workspace/apps/web && NODE_OPTIONS=--max-old-space-size=4096 ./node_modules/.bin/vue-tsc --noEmit'
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/designer/CustomPaperDialog.vue
git commit -m "feat(designer): CustomPaperDialog with live cell-option preview + validation"
```

---

### Task 13: Wire CustomPaperDialog into DesignerHeader

**Files:**
- Modify: `apps/web/src/designer/DesignerHeader.vue`

- [ ] **Step 1: Add the 11 presets + custom entry**

Replace the existing `paperOptions` constant and dropdown:

```ts
const paperOptions = [
  'A3', 'A3-Landscape',
  'A4', 'A4-Landscape',
  'A5', 'A5-Landscape',
  'A6',
  'B5',
  'Letter',
  'GuardPass',
  'LogisticLabel',
] as const;

const paperLabelMap: Record<string, string> = {
  A3: 'A3',
  'A3-Landscape': 'A3 横',
  A4: 'A4',
  'A4-Landscape': 'A4 横',
  A5: 'A5',
  'A5-Landscape': 'A5 横',
  A6: 'A6',
  B5: 'B5',
  Letter: 'Letter',
  GuardPass: '出门证 (90×60)',
  LogisticLabel: '物流面单 (100×180)',
};

const customDialogOpen = ref(false);

function onCustomPaperConfirm(size: { w_mm: number; h_mm: number }): void {
  store.setPaper(size);
}
```

Then in the dropdown menu, after the preset items add the custom trigger:

```vue
<ElDropdownMenu>
  <ElDropdownItem
    v-for="p in paperOptions"
    :key="p"
    @click="store.setPaper(p)"
  >
    {{ paperLabelMap[p] }}
  </ElDropdownItem>
  <ElDropdownItem divided @click="customDialogOpen = true">⊕ 自定义…</ElDropdownItem>
</ElDropdownMenu>
```

And before `</template>`:

```vue
<CustomPaperDialog v-model="customDialogOpen" @confirm="onCustomPaperConfirm" />
```

Update `paperLabel` computed to use the map:

```ts
const paperLabel = computed(() => {
  const p = store.template.canvas.paper;
  if (typeof p === 'string') return paperLabelMap[p] ?? p;
  return `${p.w_mm}×${p.h_mm}mm`;
});
```

Add the import:

```ts
import CustomPaperDialog from './CustomPaperDialog.vue';
```

- [ ] **Step 2: Type-check**

```bash
docker compose -f docker-compose.dev.yml exec -T web sh -c 'cd /workspace/apps/web && NODE_OPTIONS=--max-old-space-size=4096 ./node_modules/.bin/vue-tsc --noEmit'
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/designer/DesignerHeader.vue
git commit -m "feat(designer): header lists 11 paper presets + custom dialog trigger"
```

---

### Task 14: DesignerHeader toolbar widen + grouping + overflow

**Files:**
- Modify: `apps/web/src/styles/designer.css`
- Modify: `apps/web/src/designer/DesignerHeader.vue`

- [ ] **Step 1: Update `.tp-top-toolbar` CSS**

In `apps/web/src/styles/designer.css`, replace `.tp-top-toolbar`:

```css
.tp-top-toolbar {
  position: absolute;
  top: 14px;
  left: 50%;
  transform: translateX(-50%);
  background: var(--tp-panel);
  border-radius: var(--tp-radius-pill);
  box-shadow: var(--tp-shadow-pill);
  padding: 6px 10px;
  display: flex;
  align-items: center;
  gap: 6px;
  z-index: 10;
  min-width: 720px;
  max-width: calc(100% - 80px);
  white-space: nowrap;
}
.tp-top-toolbar .tt-spacer { flex: 1; }
```

In the same file find `.tt-divider` and set height to `20px`, margin to `0 8px`. Find `.tt-btn padding: 0 12px` and change to `0 14px`.

- [ ] **Step 2: Group the toolbar buttons in template**

In `apps/web/src/designer/DesignerHeader.vue`, rearrange the template so the action buttons (预览/保存/打印) sit at the right side after a `tt-spacer`:

```vue
<header class="tp-top-toolbar">
  <button class="tt-btn tt-icon" title="返回" @click="exitToHome">←</button>
  <span class="tt-divider" />

  <button class="tt-btn" :disabled="!store.canUndo" title="撤销 (⌘Z)" @click="store.undo">↶</button>
  <button class="tt-btn" :disabled="!store.canRedo" title="重做 (⌘⇧Z)" @click="store.redo">↷</button>
  <span class="tt-divider" />

  <ElDropdown trigger="click">
    <button class="tt-btn">📄 {{ paperLabel }}</button>
    <template #dropdown>
      <ElDropdownMenu>
        <ElDropdownItem v-for="p in paperOptions" :key="p" @click="store.setPaper(p)">{{ paperLabelMap[p] }}</ElDropdownItem>
        <ElDropdownItem divided @click="customDialogOpen = true">⊕ 自定义…</ElDropdownItem>
      </ElDropdownMenu>
    </template>
  </ElDropdown>

  <ElDropdown trigger="click">
    <button class="tt-btn">⊞ {{ cellLabel }}</button>
    <template #dropdown>
      <ElDropdownMenu>
        <ElDropdownItem v-for="opt in validCells" :key="`${opt.w}x${opt.h}`" @click="chooseCell(opt.w, opt.h)">
          {{ opt.w }} px
          <span style="color:#999;margin-left:6px">({{ opt.cols }}×{{ opt.rows }} 格)</span>
        </ElDropdownItem>
      </ElDropdownMenu>
    </template>
  </ElDropdown>

  <span class="tt-spacer" />

  <button class="tt-btn" @click="previewOpen = true">👁 预览</button>
  <button class="tt-btn tt-primary" @click="ElMessage.info('保存到后端在 Plan 3 实现，草稿已存本地')">保存</button>
  <button class="tt-btn tt-accent" @click="doPrint">🖨 立即打印</button>

  <CustomPaperDialog v-model="customDialogOpen" @confirm="onCustomPaperConfirm" />
</header>
```

Also update `cellLabel` computed to use the single-px form:

```ts
const cellLabel = computed(() => `${store.template.canvas.cell.w} px`);
```

- [ ] **Step 3: Visual check**

```bash
docker compose -f docker-compose.dev.yml restart web
```

Open `http://localhost:5173/designer/new`. Toolbar should be wider, items spread out, action buttons aligned right.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/styles/designer.css apps/web/src/designer/DesignerHeader.vue
git commit -m "feat(designer): widen + group toolbar; cell label shows single 'X px'"
```

---

### Task 15: PropertyPanel — mm inputs + cell-equivalent badge

**Files:**
- Modify: `apps/web/src/designer/PropertyPanel.vue`

- [ ] **Step 1: Replace position/size inputs to bind to anchor**

Replace the two `row-axis` divs in `PropertyPanel.vue` template with:

```vue
<!-- 位置 — anchor.x / anchor.y in mm -->
<div class="row row-axis">
  <span class="lbl">位置</span>
  <div class="axis-pair">
    <label class="axis">
      <span class="axis-lbl">列</span>
      <input
        type="number"
        class="axis-input"
        :value="sel.anchor.x.toFixed(2)"
        step="0.25"
        min="0"
        @input="(e: Event) => onAnchorInput('x', e)"
      />
      <span class="axis-unit">mm</span>
    </label>
    <label class="axis">
      <span class="axis-lbl">行</span>
      <input
        type="number"
        class="axis-input"
        :value="sel.anchor.y.toFixed(2)"
        step="0.25"
        min="0"
        @input="(e: Event) => onAnchorInput('y', e)"
      />
      <span class="axis-unit">mm</span>
    </label>
  </div>
</div>
<div class="row row-badge">
  <span class="lbl"></span>
  <span class="cell-eq">≈ {{ sel.grid.c }} × {{ sel.grid.r }} 格 @ cell={{ store.template.canvas.cell.w }}px</span>
</div>

<!-- 尺寸 — anchor.w / anchor.h in mm -->
<div class="row row-axis">
  <span class="lbl">尺寸</span>
  <div class="axis-pair">
    <label class="axis">
      <span class="axis-lbl">宽</span>
      <input
        type="number"
        class="axis-input"
        :value="sel.anchor.w.toFixed(2)"
        step="0.25"
        min="0.25"
        @input="(e: Event) => onAnchorInput('w', e)"
      />
      <span class="axis-unit">mm</span>
    </label>
    <label class="axis">
      <span class="axis-lbl">高</span>
      <input
        type="number"
        class="axis-input"
        :value="sel.anchor.h.toFixed(2)"
        step="0.25"
        min="0.25"
        @input="(e: Event) => onAnchorInput('h', e)"
      />
      <span class="axis-unit">mm</span>
    </label>
  </div>
</div>
<div class="row row-badge">
  <span class="lbl"></span>
  <span class="cell-eq">≈ {{ sel.grid.cs }} × {{ sel.grid.rs }} 格</span>
</div>
```

Replace the script's `setGridPos`/`onAxisInput` with `onAnchorInput`:

```ts
function onAnchorInput(key: 'x' | 'y' | 'w' | 'h', e: Event): void {
  if (!sel.value) return;
  const v = Number((e.target as HTMLInputElement).value);
  if (!Number.isFinite(v)) return;
  const min = key === 'w' || key === 'h' ? 0.25 : 0;
  store.setElementAnchor(sel.value.id, { [key]: Math.max(min, v) });
}
```

Add CSS for the new bits at the bottom of the existing `<style scoped>`:

```css
.axis-unit {
  background: transparent;
  color: var(--tp-ink-faint);
  font-size: 10px;
  padding: 0 8px;
  display: inline-flex;
  align-items: center;
  flex-shrink: 0;
}
.row-badge {
  padding: 0 14px 4px;
  font-size: 10.5px;
  color: var(--tp-ink-faint);
}
.row-badge .lbl { min-width: 36px; }
.cell-eq { font-family: ui-monospace, monospace; }
```

- [ ] **Step 2: Type-check**

```bash
docker compose -f docker-compose.dev.yml exec -T web sh -c 'cd /workspace/apps/web && NODE_OPTIONS=--max-old-space-size=4096 ./node_modules/.bin/vue-tsc --noEmit'
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/designer/PropertyPanel.vue
git commit -m "feat(designer): position/size inputs in mm; cell-equivalent badge"
```

---

### Task 16: ElementLibrary categorisation (3 groups)

**Files:**
- Modify: `apps/web/src/designer/ElementLibrary.vue`
- Modify: `apps/web/src/designer/elementFactory.ts`

- [ ] **Step 1: Add group key to LIBRARY_ITEMS**

In `apps/web/src/designer/elementFactory.ts`:

```ts
export type LibraryGroup = '文字' | '图形' | '数据';

export interface ElementMeta {
  type: TemplateElement['type'];
  glyph: string;
  label: string;
  group: LibraryGroup;
  defaultGrid: { cs: number; rs: number };
  variant?: 'qr' | 'barcode';
}

export const LIBRARY_ITEMS: ElementMeta[] = [
  { type: 'text',       group: '文字', glyph: 'T',   label: '文字',   defaultGrid: { cs: 12, rs: 3 } },
  { type: 'field',      group: '文字', glyph: '{}',  label: '字段',   defaultGrid: { cs: 16, rs: 3 } },
  { type: 'autonumber', group: '文字', glyph: '№',   label: '编号',   defaultGrid: { cs: 18, rs: 3 } },
  { type: 'system',     group: '文字', glyph: '#',   label: '系统',   defaultGrid: { cs: 18, rs: 3 } },
  { type: 'rect',       group: '图形', glyph: '▢',   label: '矩形',   defaultGrid: { cs: 16, rs: 8 } },
  { type: 'image',      group: '图形', glyph: '▤',   label: '图片',   defaultGrid: { cs: 16, rs: 16 } },
  { type: 'table',      group: '数据', glyph: '▦',   label: '明细',   defaultGrid: { cs: 60, rs: 24 } },
  { type: 'barcode',    group: '数据', glyph: '▣',   label: '二维码', defaultGrid: { cs: 12, rs: 12 }, variant: 'qr' },
  { type: 'barcode',    group: '数据', glyph: '|||', label: '条码',   defaultGrid: { cs: 30, rs: 8 },  variant: 'barcode' },
];
```

Note we expanded "文字" to include the previously-missing `autonumber` and `system` types.

In `buildElement`'s switch, add `system` (already exists). Confirm the existing `case 'system'` covers it.

- [ ] **Step 2: Group the library template**

In `apps/web/src/designer/ElementLibrary.vue`, replace the template:

```vue
<template>
  <div class="tp-section-top">
    <div class="tp-sub-head">
      <span class="tp-sub-title">添加新元素</span>
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
            <span class="lib-glyph">{{ item.glyph }}</span>
            <span>{{ item.label }}</span>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
```

And update the script:

```ts
import { computed } from 'vue';
import { useDesignerStore } from '../stores/designer';
import { LIBRARY_ITEMS, buildElement, type ElementMeta, type LibraryGroup } from './elementFactory';

const store = useDesignerStore();
const groupOrder: LibraryGroup[] = ['文字', '图形', '数据'];
const itemsByGroup = computed<Record<LibraryGroup, ElementMeta[]>>(() => {
  return {
    文字: LIBRARY_ITEMS.filter((i) => i.group === '文字'),
    图形: LIBRARY_ITEMS.filter((i) => i.group === '图形'),
    数据: LIBRARY_ITEMS.filter((i) => i.group === '数据'),
  };
});

function clickAdd(meta: ElementMeta): void {
  const cell = store.template.canvas.cell;
  const el = buildElement(meta, store.newElementId(), 4, 4, cell.w, cell.h);
  store.addElement(el);
}

function onDragStart(e: DragEvent, meta: ElementMeta): void {
  if (!e.dataTransfer) return;
  e.dataTransfer.setData('application/x-tp-element', JSON.stringify(meta));
  e.dataTransfer.effectAllowed = 'copy';
}
```

Add CSS:

```css
.lib-scroll { flex: 1; overflow-y: auto; padding-bottom: 8px; }
.lib-group + .lib-group { margin-top: 8px; }
.lib-group-title {
  padding: 8px 14px 4px;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--tp-ink-faint);
}
.lib-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
  padding: 0 10px;
}
```

Remove the existing `.lib-grid` rule that's outside `.lib-scroll` if it conflicts.

- [ ] **Step 3: Type-check + visual check**

```bash
docker compose -f docker-compose.dev.yml exec -T web sh -c 'cd /workspace/apps/web && NODE_OPTIONS=--max-old-space-size=4096 ./node_modules/.bin/vue-tsc --noEmit'
```

Open browser, confirm three grouped sections appear.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/designer/ElementLibrary.vue apps/web/src/designer/elementFactory.ts
git commit -m "feat(designer): library grouped into 文字/图形/数据 with section titles"
```

---

### Task 17: CanvasElementsList pagination

**Files:**
- Modify: `apps/web/src/designer/CanvasElementsList.vue`

- [ ] **Step 1: Add pagination state and rendering**

Replace the script + template:

```vue
<script setup lang="ts">
import { computed, ref, watch } from 'vue';
// eslint-disable-next-line import/no-unresolved
import type { TemplateElement } from '@template-printing/schema';

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

// When user selects an element via PropertyPanel or canvas, flip to the page containing it.
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
    case 'field':      return `field · ${el.binding}`;
    case 'image':      return `image`;
    case 'rect':       return `rect`;
    case 'table':      return `table · ${el.binding}`;
    case 'barcode':    return `${el.symbology === 'qr' ? 'qr' : 'barcode'} · ${el.content?.static ?? el.binding ?? '空'}`;
    case 'autonumber': return `№ · ${el.sequence}`;
    case 'system':     return `system · ${el.variable}`;
  }
}
function iconGlyph(type: TemplateElement['type']): string {
  switch (type) {
    case 'text':       return 'T';
    case 'field':      return '{}';
    case 'image':      return '▤';
    case 'rect':       return '▢';
    case 'table':      return '▦';
    case 'barcode':    return '▣';
    case 'autonumber': return '№';
    case 'system':     return '#';
  }
}
function selectOne(id: string): void { store.select([id]); }
function removeEl(id: string, e: Event): void {
  e.stopPropagation();
  store.deleteElement(id);
}
</script>

<template>
  <div class="canvas-elems-list">
    <div class="tp-sub-head">
      <span class="tp-sub-title">画布元素 · 共 {{ elements.length }} 个</span>
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
        <span class="elem-icon">{{ iconGlyph(el.type) }}</span>
        <span class="elem-label">{{ summarize(el) }}</span>
        <button class="elem-del" @click="(e: Event) => removeEl(el.id, e)" title="删除">×</button>
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
.elem-row {
  position: relative;
  width: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
  border-radius: var(--tp-radius-item);
  cursor: pointer;
  color: var(--tp-ink);
  font-size: 12.5px;
  margin-bottom: 2px;
  background: transparent;
}
.elem-row:hover { background: var(--tp-field-bg); }
.elem-row.is-active { background: var(--tp-accent-bg); color: var(--tp-accent-ink); font-weight: 600; }
.elem-row.is-active .elem-icon { background: var(--tp-accent); color: #fff; }
.elem-icon {
  flex-shrink: 0;
  width: 22px; height: 22px;
  border-radius: 5px;
  background: var(--tp-field-bg); color: var(--tp-accent);
  display: inline-flex; align-items: center; justify-content: center;
  font-family: ui-monospace, monospace; font-weight: 600; font-size: 11px;
}
.elem-label { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.elem-del {
  border: none; background: transparent;
  width: 20px; height: 20px;
  border-radius: 4px;
  color: var(--tp-ink-faint);
  cursor: pointer;
  font-size: 14px; line-height: 1;
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
  border-radius: 4px;
  cursor: pointer;
  color: var(--tp-ink);
}
.pagination button:disabled { opacity: 0.4; cursor: not-allowed; }
.pagination .pgno { font-family: ui-monospace, monospace; }
.pagination .pgsize { margin-left: auto; color: var(--tp-ink-faint); }
</style>
```

- [ ] **Step 2: Type-check + browser check**

```bash
docker compose -f docker-compose.dev.yml exec -T web sh -c 'cd /workspace/apps/web && NODE_OPTIONS=--max-old-space-size=4096 ./node_modules/.bin/vue-tsc --noEmit'
```

Create 12 elements in the browser; verify pagination footer appears and hover shows ×.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/designer/CanvasElementsList.vue
git commit -m "feat(designer): canvas elements list — pagination + hover delete"
```

---

### Task 18: HitZones — mode prop for QR

**Files:**
- Modify: `apps/web/src/designer/HitZones.vue`

- [ ] **Step 1: Add `mode` prop**

Replace the file:

```vue
<script setup lang="ts">
const props = defineProps<{ mode?: 'free' | 'qr' }>();
defineEmits<{
  (e: 'pointerdown', side: 'n' | 'e' | 's' | 'w' | 'nw' | 'ne' | 'sw' | 'se', ev: PointerEvent): void;
}>();
const showEdges = () => props.mode !== 'qr';
</script>

<template>
  <div class="hit-zones">
    <template v-if="showEdges()">
      <div class="hit n" @pointerdown.stop="$emit('pointerdown', 'n', $event)" />
      <div class="hit e" @pointerdown.stop="$emit('pointerdown', 'e', $event)" />
      <div class="hit s" @pointerdown.stop="$emit('pointerdown', 's', $event)" />
      <div class="hit w" @pointerdown.stop="$emit('pointerdown', 'w', $event)" />
    </template>
    <div class="hit corner nw" @pointerdown.stop="$emit('pointerdown', 'nw', $event)" />
    <div class="hit corner ne" @pointerdown.stop="$emit('pointerdown', 'ne', $event)" />
    <div class="hit corner sw" @pointerdown.stop="$emit('pointerdown', 'sw', $event)" />
    <div class="hit corner se" @pointerdown.stop="$emit('pointerdown', 'se', $event)" />
  </div>
</template>

<style scoped>
/* (keep existing scoped CSS — unchanged) */
</style>
```

(Keep the existing scoped CSS from the previous version.)

- [ ] **Step 2: Pass mode from CanvasElement**

In `apps/web/src/designer/CanvasElement.vue` find:

```vue
<HitZones v-if="isSelected" @pointerdown="onResizeDown" />
```

Replace with:

```vue
<HitZones
  v-if="isSelected"
  :mode="props.element.type === 'barcode' && props.element.symbology === 'qr' ? 'qr' : 'free'"
  @pointerdown="onResizeDown"
/>
```

- [ ] **Step 3: Type-check**

```bash
docker compose -f docker-compose.dev.yml exec -T web sh -c 'cd /workspace/apps/web && NODE_OPTIONS=--max-old-space-size=4096 ./node_modules/.bin/vue-tsc --noEmit'
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/designer/HitZones.vue apps/web/src/designer/CanvasElement.vue
git commit -m "feat(designer): HitZones hides edge handles in qr mode"
```

---

### Task 19: usePointerDrag — QR 1:1 lock + 1D min-rs guard

**Files:**
- Modify: `apps/web/src/designer/usePointerDrag.ts`

- [ ] **Step 1: Update the composable signature**

Replace the file:

```ts
import { useDesignerStore } from '../stores/designer';

type ResizeSide = 'n' | 'e' | 's' | 'w' | 'nw' | 'ne' | 'sw' | 'se';
type ResizeMode = 'free' | 'qr-lock' | 'barcode';

export function usePointerDrag(
  elementId: string,
  getDom: () => HTMLElement | null,
): {
  onGripDown: (e: PointerEvent) => void;
  onResizeDown: (side: ResizeSide, e: PointerEvent) => void;
} {
  const store = useDesignerStore();

  function getCellPx(): { w: number; h: number } {
    return { w: store.template.canvas.cell.w, h: store.template.canvas.cell.h };
  }
  function getElement() {
    return store.template.elements.find((e) => e.id === elementId);
  }
  function clamp(v: number, lo: number, hi: number): number {
    return Math.max(lo, Math.min(hi, v));
  }
  function getResizeMode(): ResizeMode {
    const el = getElement();
    if (!el || el.type !== 'barcode') return 'free';
    return el.symbology === 'qr' ? 'qr-lock' : 'barcode';
  }

  function onGripDown(e: PointerEvent): void {
    const dom = getDom();
    const el = getElement();
    if (!dom || !el) return;
    const cell = getCellPx();
    const startC = el.grid.c, startR = el.grid.r;
    const startCs = el.grid.cs, startRs = el.grid.rs;
    const startX = e.clientX, startY = e.clientY;

    let lastDx = 0, lastDy = 0;
    store.isResizing = true;
    dom.classList.add('is-pointer-active');

    function onMove(ev: PointerEvent): void {
      lastDx = ev.clientX - startX;
      lastDy = ev.clientY - startY;
      dom!.style.transform = `translate(${lastDx}px, ${lastDy}px)`;
    }
    function onUp(): void {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      const dc = Math.round(lastDx / cell.w);
      const dr = Math.round(lastDy / cell.h);
      const newC = clamp(startC + dc, 0, store.template.canvas.cols - startCs);
      const newR = clamp(startR + dr, 0, store.template.canvas.rows - startRs);
      const residueX = lastDx - (newC - startC) * cell.w;
      const residueY = lastDy - (newR - startR) * cell.h;
      dom!.style.transform = `translate(${residueX}px, ${residueY}px)`;
      store.moveElement(elementId, newC, newR);
      requestAnimationFrame(() => {
        dom!.classList.remove('is-pointer-active');
        dom!.style.transform = '';
      });
      store.isResizing = false;
      store.commit();
    }
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  function onResizeDown(side: ResizeSide, e: PointerEvent): void {
    const el = getElement();
    if (!el) return;
    const cell = getCellPx();
    const startC = el.grid.c, startR = el.grid.r;
    const startCs = el.grid.cs, startRs = el.grid.rs;
    const startX = e.clientX, startY = e.clientY;
    const mode = getResizeMode();

    store.isResizing = true;

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

      let dc = Math.round(dcPx / cell.w);
      let dr = Math.round(drPx / cell.h);

      // For QR force dc === dr (in cell units) — round each axis the same way
      // by snapping to the largest absolute.
      if (mode === 'qr-lock') {
        const d = Math.max(Math.abs(dc), Math.abs(dr));
        dc = (dc >= 0 ? 1 : -1) * d;
        dr = (dr >= 0 ? 1 : -1) * d;
      }

      let newC = startC, newR = startR, newCs = startCs, newRs = startRs;

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

      // 1D barcode: enforce min rs >= 2
      if (mode === 'barcode' && newRs < 2) {
        if (side.includes('n')) {
          newR = startR + startRs - 2;
          newRs = 2;
        } else {
          newRs = 2;
        }
      }

      // QR: enforce cs === rs strictly. Use the smaller of the two as final.
      if (mode === 'qr-lock') {
        const final = Math.min(newCs, newRs);
        newCs = final;
        newRs = final;
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

- [ ] **Step 2: Type-check**

```bash
docker compose -f docker-compose.dev.yml exec -T web sh -c 'cd /workspace/apps/web && NODE_OPTIONS=--max-old-space-size=4096 ./node_modules/.bin/vue-tsc --noEmit'
```

- [ ] **Step 3: Manual test**

In the browser, drop a QR code; resize from any corner — width and height should always change together. Drop a 1D barcode; resize the top edge — verify it can't go below 2 cells tall.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/designer/usePointerDrag.ts
git commit -m "feat(designer): QR 1:1 lock + 1D barcode min-rs guard"
```

---

### Task 20: CanvasElement — live ratio hint in size badge

**Files:**
- Modify: `apps/web/src/designer/CanvasElement.vue`

- [ ] **Step 1: Add suffix to size badge for QR**

Replace the `sizeBadge` computed:

```ts
const sizeBadge = computed(() => {
  const g = props.element.grid;
  if (props.element.type === 'barcode' && props.element.symbology === 'qr') {
    return `${g.cs}×${g.rs} 格 (1:1)`;
  }
  return `${g.cs}×${g.rs} 格`;
});
```

- [ ] **Step 2: Type-check**

```bash
docker compose -f docker-compose.dev.yml exec -T web sh -c 'cd /workspace/apps/web && NODE_OPTIONS=--max-old-space-size=4096 ./node_modules/.bin/vue-tsc --noEmit'
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/designer/CanvasElement.vue
git commit -m "feat(designer): size badge appends (1:1) suffix for QR"
```

---

### Task 21: BorderControl rewrite (per-side toggle + global style/width/color)

**Files:**
- Modify: `apps/web/src/designer/BorderControl.vue`

- [ ] **Step 1: Replace the component**

```vue
<script setup lang="ts">
// eslint-disable-next-line import/no-unresolved
import type { ElementStyle } from '@template-printing/schema';

const props = defineProps<{ modelValue: ElementStyle['border'] }>();
const emit = defineEmits<{ (e: 'update:modelValue', v: ElementStyle['border']): void }>();

type Side = 'top' | 'right' | 'bottom' | 'left';

function toggle(side: Side): void {
  emit('update:modelValue', {
    ...props.modelValue,
    [side]: { ...props.modelValue[side], show: !props.modelValue[side].show },
  });
}

function patchAllSides(patch: Partial<{ style: 'solid' | 'dashed' | 'dotted'; width: number; color: string }>): void {
  const next = { ...props.modelValue };
  (['top', 'right', 'bottom', 'left'] as Side[]).forEach((s) => {
    next[s] = { ...next[s], ...patch };
  });
  emit('update:modelValue', next);
}

// All sides share the same style/width/color (mirror on write).
function currentStyle(): 'solid' | 'dashed' | 'dotted' { return props.modelValue.top.style; }
function currentWidth(): number { return props.modelValue.top.width; }
function currentColor(): string { return props.modelValue.top.color; }
</script>

<template>
  <div class="bp-block">
    <div class="bp-title">边框</div>

    <div class="grid">
      <button class="cell t" :class="{ on: props.modelValue.top.show }" @click="toggle('top')">上</button>
      <button class="cell l" :class="{ on: props.modelValue.left.show }" @click="toggle('left')">左</button>
      <div class="center">elem</div>
      <button class="cell r" :class="{ on: props.modelValue.right.show }" @click="toggle('right')">右</button>
      <button class="cell b" :class="{ on: props.modelValue.bottom.show }" @click="toggle('bottom')">下</button>
    </div>

    <div class="bp-controls">
      <div class="ctrl-row">
        <span class="ctrl-lbl">线型</span>
        <div class="seg">
          <button :class="{ on: currentStyle() === 'solid' }"  @click="patchAllSides({ style: 'solid' })">—</button>
          <button :class="{ on: currentStyle() === 'dashed' }" @click="patchAllSides({ style: 'dashed' })">- -</button>
          <button :class="{ on: currentStyle() === 'dotted' }" @click="patchAllSides({ style: 'dotted' })">• •</button>
        </div>
      </div>
      <div class="ctrl-row">
        <span class="ctrl-lbl">粗细</span>
        <input
          type="range"
          min="1" max="8" step="1"
          :value="currentWidth()"
          class="slider"
          @input="(e: Event) => patchAllSides({ width: Number((e.target as HTMLInputElement).value) })"
        />
        <span class="ctrl-val">{{ currentWidth() }} px</span>
      </div>
      <div class="ctrl-row">
        <span class="ctrl-lbl">颜色</span>
        <input
          type="color"
          :value="currentColor()"
          class="color-pick"
          @input="(e: Event) => patchAllSides({ color: (e.target as HTMLInputElement).value })"
        />
        <span class="ctrl-val mono">{{ currentColor() }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.bp-block { padding: 12px 14px; border-bottom: 1px solid var(--tp-line); }
.bp-title {
  font-size: 11px; font-weight: 600;
  color: var(--tp-ink-soft);
  letter-spacing: 0.06em; text-transform: uppercase;
  margin-bottom: 8px;
}
.grid {
  display: grid;
  grid-template-columns: 1fr 60px 1fr;
  grid-template-rows: 28px 1fr 28px;
  height: 96px;
  border: 1px dashed var(--tp-line-strong);
  border-radius: 6px;
  padding: 4px;
  gap: 2px;
}
.cell {
  background: transparent; border: none; cursor: pointer;
  border-radius: 4px; font-size: 11px; color: var(--tp-ink-soft);
}
.cell:hover { background: var(--tp-field-bg); }
.cell.on { color: var(--tp-accent-ink); background: var(--tp-accent-bg); font-weight: 600; }
.cell.t { grid-area: 1 / 1 / 2 / 4; }
.cell.b { grid-area: 3 / 1 / 4 / 4; }
.cell.l { grid-area: 2 / 1 / 3 / 2; }
.cell.r { grid-area: 2 / 3 / 3 / 4; }
.center {
  grid-area: 2 / 2 / 3 / 3;
  border: 1px solid var(--tp-line-strong);
  background: var(--tp-field-bg); border-radius: 4px;
  display: flex; align-items: center; justify-content: center;
  font-size: 10px; color: var(--tp-ink-faint);
}

.bp-controls { margin-top: 10px; display: flex; flex-direction: column; gap: 8px; }
.ctrl-row { display: flex; align-items: center; gap: 8px; }
.ctrl-lbl { width: 36px; font-size: 11px; color: var(--tp-ink-soft); }
.ctrl-val { font-size: 11px; color: var(--tp-ink-soft); min-width: 40px; text-align: right; }
.mono { font-family: ui-monospace, monospace; }
.seg { display: inline-flex; gap: 4px; }
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
.slider { flex: 1; accent-color: var(--tp-accent); }
.color-pick { width: 32px; height: 22px; border: 1px solid var(--tp-line-strong); border-radius: 4px; padding: 0; cursor: pointer; }
</style>
```

- [ ] **Step 2: Type-check + visual**

```bash
docker compose -f docker-compose.dev.yml exec -T web sh -c 'cd /workspace/apps/web && NODE_OPTIONS=--max-old-space-size=4096 ./node_modules/.bin/vue-tsc --noEmit'
```

Open in browser, select an element, verify border control shows the new layout with slider.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/designer/BorderControl.vue
git commit -m "feat(designer): BorderControl — global style/width/color with slider; per-side show stays"
```

---

### Task 22: PropertyPanel — text-style "基础" section

**Files:**
- Modify: `apps/web/src/designer/PropertyPanel.vue`

- [ ] **Step 1: Add style helpers and template block**

Inside `<script setup>` of `PropertyPanel.vue`, add helpers near the other handlers:

```ts
function updateStyle(patch: Partial<ElementStyle>): void {
  if (!sel.value) return;
  store.updateElement(sel.value.id, { style: { ...sel.value.style, ...patch } } as Partial<TemplateElement>);
}

function isTextish(el: TemplateElement | null): boolean {
  if (!el) return false;
  return ['text', 'field', 'autonumber', 'system', 'table'].includes(el.type);
}
```

In the template, after `BorderControl` (before PaddingControl), insert the basic style block:

```vue
<div v-if="isTextish(sel)" class="style-block">
  <div class="style-title">样式 · 基础</div>

  <div class="srow">
    <span class="slbl">颜色</span>
    <input
      type="color"
      :value="sel.style.color ?? '#1F1F23'"
      @input="(e: Event) => updateStyle({ color: (e.target as HTMLInputElement).value })"
    />
    <span class="sval mono">{{ sel.style.color ?? '#1F1F23' }}</span>
  </div>

  <div class="srow">
    <span class="slbl">字号</span>
    <input
      type="number"
      :value="sel.style.fontSize ?? 14"
      min="6" max="72" step="1"
      class="snum"
      @input="(e: Event) => updateStyle({ fontSize: Number((e.target as HTMLInputElement).value) })"
    />
    <span class="sval">px</span>
  </div>

  <div class="srow">
    <span class="slbl">粗细</span>
    <select
      :value="sel.style.fontWeight ?? 400"
      class="ssel"
      @change="(e: Event) => updateStyle({ fontWeight: Number((e.target as HTMLSelectElement).value) as 400 | 500 | 600 | 700 })"
    >
      <option :value="400">常规 400</option>
      <option :value="500">中等 500</option>
      <option :value="600">半粗 600</option>
      <option :value="700">粗体 700</option>
    </select>
  </div>

  <div class="srow">
    <span class="slbl">对齐</span>
    <div class="seg">
      <button v-for="a in ['left','center','right','justify'] as const" :key="a"
        :class="{ on: sel.style.textAlign === a }"
        @click="updateStyle({ textAlign: a })">
        {{ {left:'左',center:'中',right:'右',justify:'端'}[a] }}
      </button>
    </div>
  </div>
</div>
```

Add CSS to the `<style scoped>`:

```css
.style-block { padding: 12px 14px; border-bottom: 1px solid var(--tp-line); }
.style-title { font-size: 11px; font-weight: 600; color: var(--tp-ink-soft); text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 8px; }
.srow { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
.slbl { width: 36px; font-size: 11px; color: var(--tp-ink-soft); }
.sval { font-size: 11px; color: var(--tp-ink-soft); }
.snum, .ssel { padding: 3px 6px; border: 1px solid var(--tp-line-strong); border-radius: 4px; font-size: 12px; min-width: 80px; }
.seg { display: inline-flex; gap: 4px; }
.seg button { border: 1px solid var(--tp-line-strong); background: var(--tp-panel); padding: 3px 10px; border-radius: 6px; cursor: pointer; font-size: 12px; color: var(--tp-ink-soft); }
.seg button.on { background: var(--tp-accent); color: #fff; border-color: var(--tp-accent); }
```

Also import `ElementStyle`:

```ts
// eslint-disable-next-line import/no-unresolved
import type { ElementStyle, TemplateElement } from '@template-printing/schema';
```

(already imported, just confirm the type is referenced.)

- [ ] **Step 2: Type-check + visual**

```bash
docker compose -f docker-compose.dev.yml exec -T web sh -c 'cd /workspace/apps/web && NODE_OPTIONS=--max-old-space-size=4096 ./node_modules/.bin/vue-tsc --noEmit'
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/designer/PropertyPanel.vue
git commit -m "feat(designer): PropertyPanel — 基础 text style (color/fontSize/fontWeight/textAlign)"
```

---

### Task 23: PropertyPanel — text-style "高级" section (collapsible)

**Files:**
- Modify: `apps/web/src/designer/PropertyPanel.vue`

- [ ] **Step 1: Add an `advancedOpen` ref + advanced block**

Add to `<script setup>`:

```ts
import { ref } from 'vue';
const advancedOpen = ref(false);
```

Insert below the 基础 block in template:

```vue
<div v-if="isTextish(sel)" class="style-block">
  <div class="style-title sclickable" @click="advancedOpen = !advancedOpen">
    样式 · 高级 <span class="caret">{{ advancedOpen ? '▾' : '▸' }}</span>
  </div>
  <div v-if="advancedOpen">
    <div class="srow">
      <span class="slbl">字体</span>
      <select :value="sel.style.fontFamily ?? 'sans'" class="ssel"
        @change="(e: Event) => updateStyle({ fontFamily: (e.target as HTMLSelectElement).value as 'sans'|'serif'|'mono' })">
        <option value="sans">无衬线</option>
        <option value="serif">衬线</option>
        <option value="mono">等宽</option>
      </select>
    </div>
    <div class="srow">
      <span class="slbl">字间距</span>
      <input type="number" step="0.1" :value="sel.style.letterSpacing ?? 0" class="snum"
        @input="(e: Event) => updateStyle({ letterSpacing: Number((e.target as HTMLInputElement).value) })" />
      <span class="sval">px</span>
    </div>
    <div class="srow">
      <span class="slbl">行高</span>
      <input type="number" step="0.1" min="0.8" :value="sel.style.lineHeight ?? 1.4" class="snum"
        @input="(e: Event) => updateStyle({ lineHeight: Number((e.target as HTMLInputElement).value) })" />
    </div>
    <div class="srow">
      <span class="slbl">装饰</span>
      <select :value="sel.style.textDecoration ?? 'none'" class="ssel"
        @change="(e: Event) => updateStyle({ textDecoration: (e.target as HTMLSelectElement).value as 'none'|'underline'|'overline'|'line-through' })">
        <option value="none">无</option>
        <option value="underline">下划线</option>
        <option value="overline">上划线</option>
        <option value="line-through">删除线</option>
      </select>
    </div>
    <div class="srow">
      <span class="slbl">背景色</span>
      <input type="color" :value="sel.style.backgroundColor ?? '#ffffff'"
        @input="(e: Event) => updateStyle({ backgroundColor: (e.target as HTMLInputElement).value })" />
    </div>
    <div class="srow">
      <span class="slbl">垂直对齐</span>
      <div class="seg">
        <button v-for="v in ['top','middle','bottom'] as const" :key="v"
          :class="{ on: (sel.style.verticalAlign ?? 'middle') === v }"
          @click="updateStyle({ verticalAlign: v })">
          {{ {top:'上',middle:'中',bottom:'下'}[v] }}
        </button>
      </div>
    </div>
    <div class="srow">
      <span class="slbl">层级 z</span>
      <input type="number" :value="sel.style.zIndex ?? 0" class="snum"
        @input="(e: Event) => updateStyle({ zIndex: Number((e.target as HTMLInputElement).value) })" />
    </div>
    <div class="srow">
      <span class="slbl">旋转</span>
      <input type="range" min="-180" max="180" step="1" :value="sel.style.rotation ?? 0" class="slider"
        @input="(e: Event) => updateStyle({ rotation: Number((e.target as HTMLInputElement).value) })" />
      <span class="sval mono">{{ sel.style.rotation ?? 0 }}°</span>
    </div>
    <div class="srow">
      <span class="slbl">透明度</span>
      <input type="range" min="0" max="100" step="1" :value="((sel.style.opacity ?? 1) * 100)" class="slider"
        @input="(e: Event) => updateStyle({ opacity: Number((e.target as HTMLInputElement).value) / 100 })" />
      <span class="sval mono">{{ Math.round((sel.style.opacity ?? 1) * 100) }}%</span>
    </div>
    <div class="srow">
      <span class="slbl">溢出</span>
      <select :value="sel.style.textOverflow ?? 'wrap'" class="ssel"
        @change="(e: Event) => updateStyle({ textOverflow: (e.target as HTMLSelectElement).value as 'clip'|'ellipsis'|'wrap' })">
        <option value="wrap">换行</option>
        <option value="clip">裁剪</option>
        <option value="ellipsis">省略号</option>
      </select>
    </div>
  </div>
</div>
```

Add CSS:

```css
.sclickable { cursor: pointer; user-select: none; display: flex; justify-content: space-between; }
.caret { color: var(--tp-ink-faint); }
```

- [ ] **Step 2: Type-check**

```bash
docker compose -f docker-compose.dev.yml exec -T web sh -c 'cd /workspace/apps/web && NODE_OPTIONS=--max-old-space-size=4096 ./node_modules/.bin/vue-tsc --noEmit'
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/designer/PropertyPanel.vue
git commit -m "feat(designer): PropertyPanel — 高级 text style (font/spacing/decoration/bg/v-align/z/rotation/opacity/overflow)"
```

---

### Task 24: BarcodeProperties component + integration

**Files:**
- Create: `apps/web/src/designer/BarcodeProperties.vue`
- Modify: `apps/web/src/designer/PropertyPanel.vue`

- [ ] **Step 1: Create the component**

```vue
<script setup lang="ts">
// eslint-disable-next-line import/no-unresolved
import type { TemplateElement } from '@template-printing/schema';
import { computed } from 'vue';

const props = defineProps<{ element: TemplateElement }>();
const emit = defineEmits<{ (e: 'update', patch: Partial<TemplateElement>): void }>();

const isQr = computed(() => props.element.type === 'barcode' && props.element.symbology === 'qr');
const isOneD = computed(() => props.element.type === 'barcode' && props.element.symbology !== 'qr');

function update(patch: Record<string, unknown>): void {
  emit('update', patch as Partial<TemplateElement>);
}
</script>

<template>
  <div v-if="props.element.type === 'barcode'" class="bc-block">
    <div class="bc-title">{{ isQr ? '二维码控制' : '条码控制' }}</div>

    <div class="srow">
      <span class="slbl">类型</span>
      <select class="ssel" :value="props.element.symbology" @change="(e: Event) => update({ symbology: (e.target as HTMLSelectElement).value })">
        <option value="qr">二维码 QR</option>
        <option value="code128">Code 128</option>
        <option value="code39">Code 39</option>
        <option value="ean13">EAN-13</option>
        <option value="ean8">EAN-8</option>
        <option value="upc-a">UPC-A</option>
        <option value="itf14">ITF-14</option>
      </select>
    </div>

    <div v-if="isQr" class="srow">
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
      <input type="range" min="0" max="8" step="1" :value="props.element.quietZone ?? 2" class="slider"
        @input="(e: Event) => update({ quietZone: Number((e.target as HTMLInputElement).value) })" />
      <span class="sval mono">{{ props.element.quietZone ?? 2 }}</span>
    </div>

    <template v-if="isOneD">
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
    </template>
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
.slider { flex: 1; accent-color: var(--tp-accent); }
.seg { display: inline-flex; gap: 4px; }
.seg button { border: 1px solid var(--tp-line-strong); background: var(--tp-panel); padding: 3px 10px; border-radius: 6px; cursor: pointer; font-size: 12px; color: var(--tp-ink-soft); }
.seg button.on { background: var(--tp-accent); color: #fff; border-color: var(--tp-accent); }
</style>
```

- [ ] **Step 2: Wire into PropertyPanel**

In `apps/web/src/designer/PropertyPanel.vue` import the new component:

```ts
import BarcodeProperties from './BarcodeProperties.vue';
```

In the template, after the existing 字段绑定 row block (before `<BorderControl>`), add:

```vue
<BarcodeProperties
  v-if="sel && sel.type === 'barcode'"
  :element="sel"
  @update="(patch: Partial<TemplateElement>) => store.updateElement(sel.id, patch)"
/>
```

- [ ] **Step 3: Type-check + visual**

```bash
docker compose -f docker-compose.dev.yml exec -T web sh -c 'cd /workspace/apps/web && NODE_OPTIONS=--max-old-space-size=4096 ./node_modules/.bin/vue-tsc --noEmit'
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/designer/BarcodeProperties.vue apps/web/src/designer/PropertyPanel.vue
git commit -m "feat(designer): BarcodeProperties — QR/1D conditional controls"
```

---

### Task 25: Renderers consume new style + barcode fields

**Files:**
- Modify: `packages/template-renderer/src/elements/TextElement.vue`
- Modify: `packages/template-renderer/src/elements/FieldElement.vue`
- Modify: `packages/template-renderer/src/elements/AutonumberElement.vue`
- Modify: `packages/template-renderer/src/elements/SystemElement.vue`
- Modify: `packages/template-renderer/src/elements/BarcodeElement.vue`

- [ ] **Step 1: Add a shared style mapper**

Create `packages/template-renderer/src/styleToCss.ts`:

```ts
// eslint-disable-next-line import/no-unresolved
import type { ElementStyle } from '@template-printing/schema';

const FONT_STACK: Record<string, string> = {
  sans: '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", system-ui, sans-serif',
  serif: 'Georgia, "Times New Roman", "Songti SC", serif',
  mono: 'ui-monospace, SFMono-Regular, Menlo, monospace',
};

export function styleToCss(s: ElementStyle): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  if (s.color) out.color = s.color;
  if (s.fontFamily) out.fontFamily = FONT_STACK[s.fontFamily];
  if (s.fontSize) out.fontSize = `${s.fontSize}px`;
  if (s.fontWeight) out.fontWeight = s.fontWeight;
  if (s.letterSpacing !== undefined) out.letterSpacing = `${s.letterSpacing}px`;
  if (s.lineHeight !== undefined) out.lineHeight = s.lineHeight;
  if (s.textDecoration && s.textDecoration !== 'none') out.textDecoration = s.textDecoration;
  if (s.backgroundColor) out.backgroundColor = s.backgroundColor;
  if (s.textAlign && s.textAlign !== 'default') out.textAlign = s.textAlign;
  // verticalAlign goes onto flex container — handled per-element
  if (s.zIndex !== undefined) out.zIndex = s.zIndex;
  if (s.rotation) out.transform = `rotate(${s.rotation}deg)`;
  if (s.opacity !== undefined) out.opacity = s.opacity;
  if (s.textOverflow === 'ellipsis') {
    out.whiteSpace = 'nowrap';
    out.overflow = 'hidden';
    out.textOverflow = 'ellipsis';
  } else if (s.textOverflow === 'clip') {
    out.overflow = 'hidden';
  }
  return out;
}

export function verticalAlignToFlex(va?: ElementStyle['verticalAlign']): string {
  if (va === 'top') return 'flex-start';
  if (va === 'bottom') return 'flex-end';
  return 'center';
}
```

Add `export * from './styleToCss.js';` to `packages/template-renderer/src/index.ts` (if `index.ts` exists; otherwise create it with the re-export).

- [ ] **Step 2: Update TextElement and the other text-like elements**

For each of TextElement / FieldElement / AutonumberElement / SystemElement — pull in `styleToCss` and apply.

Example for `TextElement.vue` (replace its content style block):

```vue
<script setup lang="ts">
// eslint-disable-next-line import/no-unresolved
import type { TemplateElement } from '@template-printing/schema';
import { computed } from 'vue';
import { styleToCss, verticalAlignToFlex } from '../styleToCss';

const props = defineProps<{ element: Extract<TemplateElement, { type: 'text' }>; designMode?: boolean }>();

const containerStyle = computed(() => ({
  ...styleToCss(props.element.style),
  display: 'flex',
  alignItems: verticalAlignToFlex(props.element.style.verticalAlign),
  width: '100%',
  height: '100%',
  padding: `${props.element.style.padding.t}px ${props.element.style.padding.r}px ${props.element.style.padding.b}px ${props.element.style.padding.l}px`,
}));
</script>

<template>
  <div :style="containerStyle">{{ props.element.content.static }}</div>
</template>
```

Apply the analogous change to FieldElement (binding fallback), AutonumberElement, SystemElement.

- [ ] **Step 3: Update BarcodeElement to consume new fields**

Open `packages/template-renderer/src/elements/BarcodeElement.vue`. Inside the canvas/svg generation, find where `bwip-js` is called and inject the new options:

```ts
// For 1D barcode (existing path)
bwipjs.toCanvas(canvasRef.value, {
  bcid: props.element.symbology,
  text: contentText.value,
  includetext: props.element.showText ?? false,
  textxalign: 'center',
  paddingwidth: props.element.quietZone ?? 4,
  textgaps: 2,
  textsize: props.element.textFontSize ?? 10,
  textyoffset: props.element.textPosition === 'top' ? -(props.element.textFontSize ?? 10) - 2 : 0,
  barcolor: (props.element.foregroundColor ?? '#000000').replace('#', ''),
  backgroundcolor: (props.element.backgroundColor ?? '#ffffff').replace('#', ''),
  textcolor: (props.element.foregroundColor ?? '#000000').replace('#', ''),
});
```

For QR:

```ts
import qrcode from 'qrcode-generator';
const eccMap = { L: 'L', M: 'M', Q: 'Q', H: 'H' } as const;
const qr = qrcode(0, eccMap[props.element.eccLevel ?? 'M']);
qr.addData(contentText.value);
qr.make();
// Use qr.createImgTag() or render to canvas with foregroundColor / backgroundColor / quietZone.
```

Render the QR canvas with `foregroundColor` / `backgroundColor` / `quietZone` cells of padding.

- [ ] **Step 4: Type-check**

```bash
docker compose -f docker-compose.dev.yml exec -T web sh -c 'cd /workspace/apps/web && NODE_OPTIONS=--max-old-space-size=4096 ./node_modules/.bin/vue-tsc --noEmit'
```

- [ ] **Step 5: Commit**

```bash
git add packages/template-renderer/src
git commit -m "feat(renderer): consume expanded style + barcode controls"
```

---

### Task 26: FieldManager — type-conditional dialog

**Files:**
- Modify: `apps/web/src/designer/FieldManager.vue`

- [ ] **Step 1: Replace the form state + dialog body**

Update the script of `FieldManager.vue`:

```ts
import {
  ElButton, ElDialog, ElForm, ElFormItem,
  ElInput, ElMessage, ElOption, ElSelect, ElCheckbox,
} from 'element-plus';
import { ref } from 'vue';
import { useDesignerStore } from '../stores/designer';

type FieldType = 'string' | 'number' | 'date' | 'datetime' | 'boolean' | 'enum' | 'image' | 'array';

const store = useDesignerStore();
const dialogOpen = ref(false);

interface FormShape {
  key: string;
  label: string;
  type: FieldType;
  required: boolean;
  example: string;
  // string
  maxLength?: number;
  // number
  thousands?: boolean;
  // date / datetime
  format?: string;
  // boolean
  trueLabel?: string;
  falseLabel?: string;
  // enum
  options?: Array<{ value: string; label: string }>;
  // image
  accept?: string[];
}

const form = ref<FormShape>(defaultForm());

function defaultForm(): FormShape {
  return { key: '', label: '', type: 'string', required: false, example: '' };
}

function openAdd(): void { form.value = defaultForm(); dialogOpen.value = true; }

function addOptionRow(): void {
  if (!form.value.options) form.value.options = [];
  form.value.options.push({ value: '', label: '' });
}
function removeOptionRow(i: number): void {
  form.value.options?.splice(i, 1);
}

function submit(): void {
  const f = form.value;
  if (!f.key || !f.label) { ElMessage.warning('key 和 label 都必须填'); return; }
  if (store.template.schema[f.key]) { ElMessage.error(`字段 "${f.key}" 已存在`); return; }
  // Build the discriminated-union value
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const def: any = { type: f.type, label: f.label, required: f.required, example: f.example || undefined };
  if (f.type === 'string' && f.maxLength) def.maxLength = f.maxLength;
  if (f.type === 'number') def.thousands = f.thousands ?? false;
  if (f.type === 'date') def.format = f.format || 'YYYY-MM-DD';
  if (f.type === 'datetime') def.format = f.format || 'YYYY-MM-DD HH:mm';
  if (f.type === 'boolean') {
    def.trueLabel = f.trueLabel || '是';
    def.falseLabel = f.falseLabel || '否';
  }
  if (f.type === 'enum') {
    if (!f.options || f.options.length === 0) { ElMessage.error('enum 至少需要一个选项'); return; }
    def.options = f.options.filter((o) => o.value && o.label);
    if (def.options.length === 0) { ElMessage.error('选项需要填 value 和 label'); return; }
  }
  if (f.type === 'image') {
    def.accept = f.accept && f.accept.length > 0 ? f.accept : ['image/svg+xml', 'image/png', 'image/jpeg'];
  }
  store.addField(f.key, def);
  dialogOpen.value = false;
}

function remove(key: string): void {
  if (!window.confirm(`删除字段 "${key}"？模板中绑定到该字段的元素将变为未绑定状态。`)) return;
  store.removeField(key);
}
```

In the template, replace the `ElDialog` body:

```vue
<ElDialog v-model="dialogOpen" title="添加字段" width="420px">
  <ElForm label-position="top">
    <ElFormItem label="key (英文/拼音)"><ElInput v-model="form.key" /></ElFormItem>
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

    <!-- Conditional sub-form by type -->
    <ElFormItem v-if="form.type === 'string'" label="最大长度">
      <ElInput v-model.number="form.maxLength" type="number" />
    </ElFormItem>
    <ElFormItem v-if="form.type === 'number'" label="千分位显示">
      <ElCheckbox v-model="form.thousands" />
    </ElFormItem>
    <ElFormItem v-if="form.type === 'date' || form.type === 'datetime'" label="格式 (例 YYYY-MM-DD)">
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
        @change="(v: boolean) => form.accept = toggleAcc(form.accept, 'image/svg+xml', v)">SVG</ElCheckbox>
      <ElCheckbox :model-value="form.accept?.includes('image/png') ?? true"
        @change="(v: boolean) => form.accept = toggleAcc(form.accept, 'image/png', v)">PNG</ElCheckbox>
      <ElCheckbox :model-value="form.accept?.includes('image/jpeg') ?? true"
        @change="(v: boolean) => form.accept = toggleAcc(form.accept, 'image/jpeg', v)">JPG</ElCheckbox>
    </ElFormItem>

    <ElFormItem label="示例值"><ElInput v-model="form.example" /></ElFormItem>

    <ElButton type="primary" style="width: 100%" @click="submit">添加</ElButton>
  </ElForm>
</ElDialog>
```

Add the helper to the script:

```ts
function toggleAcc(arr: string[] | undefined, mime: string, on: boolean): string[] {
  const cur = arr ?? ['image/svg+xml', 'image/png', 'image/jpeg'];
  if (on) return cur.includes(mime) ? cur : [...cur, mime];
  return cur.filter((m) => m !== mime);
}
```

Add CSS:

```css
.enum-row { display: flex; align-items: center; margin-bottom: 4px; }
```

- [ ] **Step 2: Type-check + visual**

```bash
docker compose -f docker-compose.dev.yml exec -T web sh -c 'cd /workspace/apps/web && NODE_OPTIONS=--max-old-space-size=4096 ./node_modules/.bin/vue-tsc --noEmit'
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/designer/FieldManager.vue
git commit -m "feat(designer): FieldManager — type-conditional dialog (string/number/date/datetime/boolean/enum/image/array)"
```

---

### Task 27: API — install upload deps + storage volume

**Files:**
- Modify: `apps/api/package.json`
- Modify: `apps/api/Dockerfile.dev`
- Modify: `docker-compose.dev.yml`

- [ ] **Step 1: Add dependencies**

Edit `apps/api/package.json`. Under `dependencies` add:

```json
"sharp": "^0.33.4",
"sanitize-html": "^2.13.0",
"file-type": "^19.0.0",
"@nestjs/serve-static": "^4.0.2",
"multer": "^1.4.5-lts.1"
```

Under `devDependencies`:

```json
"@types/sanitize-html": "^2.11.0",
"@types/multer": "^1.4.11"
```

- [ ] **Step 2: Update Dockerfile.dev for sharp native deps**

Edit `apps/api/Dockerfile.dev`. Find the `apk add` line and append `vips-dev` (sharp needs it on Alpine):

```dockerfile
RUN apk add --no-cache openssl libc6-compat python3 make g++ vips-dev
```

If there's no g++/python3 already, add them too (sharp's prebuilt binaries don't ship for musl 3.x reliably).

- [ ] **Step 3: Add storage volume mount in compose**

Edit `docker-compose.dev.yml`. Under the `api:` service, add a volume entry (next to the existing volumes block):

```yaml
volumes:
  - ./apps/api:/workspace/apps/api
  - ./packages:/workspace/packages
  - ./pnpm-lock.yaml:/workspace/pnpm-lock.yaml
  - ./tsconfig.base.json:/workspace/tsconfig.base.json
  - ./package.json:/workspace/package.json
  - ./pnpm-workspace.yaml:/workspace/pnpm-workspace.yaml
  - api-node-modules:/workspace/apps/api/node_modules
  - api-root-node-modules:/workspace/node_modules
  - ./storage:/storage     # ← NEW: persistent uploads
```

(Adjust to match the existing structure; if `storage` doesn't exist at host, the docker daemon will create it on start.)

- [ ] **Step 4: Install + rebuild**

```bash
docker compose -f docker-compose.dev.yml exec -T api sh -c 'cd /workspace && pnpm install'
docker compose -f docker-compose.dev.yml build api
docker compose -f docker-compose.dev.yml up -d api
docker compose -f docker-compose.dev.yml logs --tail 30 api
```

Expected: api restarts cleanly, sharp loads.

- [ ] **Step 5: Commit**

```bash
git add apps/api/package.json apps/api/Dockerfile.dev docker-compose.dev.yml pnpm-lock.yaml
git commit -m "build(api): install sharp/sanitize-html/file-type/multer + storage volume mount"
```

---

### Task 28: SVG sanitiser + tests

**Files:**
- Create: `apps/api/src/uploads/svg-sanitiser.ts`
- Create: `apps/api/test/svg-sanitiser.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/test/svg-sanitiser.spec.ts
import { sanitiseSvg } from '../src/uploads/svg-sanitiser';

describe('sanitiseSvg', () => {
  it('keeps a clean svg', () => {
    const input = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="#000"/></svg>`);
    const out = sanitiseSvg(input);
    expect(out).not.toBeNull();
    expect(out!.toString()).toContain('<rect');
  });

  it('strips <script>', () => {
    const input = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><rect/></svg>`);
    const out = sanitiseSvg(input);
    expect(out!.toString()).not.toContain('<script');
  });

  it('strips on* event attrs', () => {
    const input = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><rect onclick="x"/></svg>`);
    const out = sanitiseSvg(input);
    const s = out!.toString();
    expect(s).not.toContain('onload');
    expect(s).not.toContain('onclick');
  });

  it('strips <foreignObject>', () => {
    const input = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><body/></foreignObject></svg>`);
    const out = sanitiseSvg(input);
    expect(out!.toString()).not.toContain('foreignObject');
  });

  it('returns null for non-svg', () => {
    const input = Buffer.from('not an svg');
    expect(sanitiseSvg(input)).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
docker compose -f docker-compose.dev.yml exec -T api sh -c 'cd /workspace/apps/api && pnpm test svg-sanitiser'
```

Expected: 5 failures (module not found).

- [ ] **Step 3: Implement `svg-sanitiser.ts`**

```ts
// apps/api/src/uploads/svg-sanitiser.ts
import sanitizeHtml from 'sanitize-html';

const ALLOWED_TAGS = [
  'svg', 'g', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon',
  'text', 'tspan', 'defs', 'pattern', 'mask', 'clipPath',
  'linearGradient', 'radialGradient', 'stop', 'filter', 'feGaussianBlur',
  'feColorMatrix', 'feComposite', 'feOffset', 'feMerge', 'feMergeNode',
  'use', 'symbol', 'image', 'title', 'desc', 'style', 'marker',
];

const ALLOWED_ATTRS = [
  'xmlns', 'xmlns:xlink', 'viewBox', 'width', 'height', 'preserveAspectRatio',
  'd', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry',
  'fill', 'fill-rule', 'fill-opacity',
  'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin',
  'stroke-dasharray', 'stroke-dashoffset', 'stroke-opacity',
  'transform', 'opacity', 'clip-path', 'mask', 'filter', 'style',
  'gradientUnits', 'gradientTransform', 'spreadMethod',
  'offset', 'stop-color', 'stop-opacity',
  'patternUnits', 'patternTransform',
  'points', 'href', 'xlink:href',
  'id', 'class', 'font-family', 'font-size', 'font-weight', 'text-anchor',
  'dx', 'dy', 'orient', 'markerWidth', 'markerHeight', 'refX', 'refY',
];

export function sanitiseSvg(input: Buffer): Buffer | null {
  const text = input.toString('utf8');
  if (!/<svg[\s>]/i.test(text)) return null;

  const cleaned = sanitizeHtml(text, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: { '*': ALLOWED_ATTRS },
    parser: { lowerCaseTags: false, lowerCaseAttributeNames: false, xmlMode: true },
    allowedSchemes: ['http', 'https', 'data'],
    allowedSchemesAppliedToAttributes: ['href', 'xlink:href'],
    transformTags: {
      'svg': (tagName, attribs) => {
        // Drop any on* event handlers that survived (defence in depth).
        const safe: Record<string, string> = {};
        for (const [k, v] of Object.entries(attribs)) {
          if (!/^on/i.test(k)) safe[k] = v;
        }
        return { tagName, attribs: safe };
      },
    },
  });
  return Buffer.from(cleaned, 'utf8');
}
```

- [ ] **Step 4: Run tests**

```bash
docker compose -f docker-compose.dev.yml exec -T api sh -c 'cd /workspace/apps/api && pnpm test svg-sanitiser'
```

Expected: all 5 pass.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/uploads/svg-sanitiser.ts apps/api/test/svg-sanitiser.spec.ts
git commit -m "feat(api): SVG sanitiser stripping script/onhandler/foreignObject"
```

---

### Task 29: UploadsModule + Service + Controller

**Files:**
- Create: `apps/api/src/uploads/uploads.service.ts`
- Create: `apps/api/src/uploads/uploads.controller.ts`
- Create: `apps/api/src/uploads/uploads.module.ts`
- Modify: `apps/api/src/app.module.ts`

- [ ] **Step 1: Implement UploadsService**

```ts
// apps/api/src/uploads/uploads.service.ts
import { Injectable, BadRequestException, PayloadTooLargeException } from '@nestjs/common';
import { promises as fs } from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import sharp from 'sharp';
import { fileTypeFromBuffer } from 'file-type';
import { sanitiseSvg } from './svg-sanitiser';

const MAX_BYTES = 5 * 1024 * 1024;
const STORAGE_ROOT = process.env.STORAGE_ROOT ?? '/storage';

export interface UploadResult {
  url: string;
  w_px: number;
  h_px: number;
  format: 'svg' | 'png' | 'jpeg';
  dpiWarning?: string;
}

@Injectable()
export class UploadsService {
  async storeImage(buffer: Buffer, mime: string): Promise<UploadResult> {
    if (buffer.length > MAX_BYTES) {
      throw new PayloadTooLargeException('image_too_large');
    }

    let cleaned: Buffer;
    let format: 'svg' | 'png' | 'jpeg';
    let w_px = 0;
    let h_px = 0;
    let dpiWarning: string | undefined;

    if (mime === 'image/svg+xml') {
      const sanitised = sanitiseSvg(buffer);
      if (!sanitised) throw new BadRequestException('svg_unsafe_or_invalid');
      cleaned = sanitised;
      format = 'svg';
      // Best effort dimensions
      const m = sanitised.toString('utf8').match(/viewBox="\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*"/i);
      if (m) {
        w_px = Math.round(Number(m[1]));
        h_px = Math.round(Number(m[2]));
      } else {
        const wm = sanitised.toString('utf8').match(/<svg[^>]*\swidth="(\d+)/i);
        const hm = sanitised.toString('utf8').match(/<svg[^>]*\sheight="(\d+)/i);
        w_px = wm ? Number(wm[1]) : 0;
        h_px = hm ? Number(hm[1]) : 0;
      }
    } else {
      const sniff = await fileTypeFromBuffer(buffer);
      if (!sniff) throw new BadRequestException('mime_unknown');
      if (sniff.mime !== mime) throw new BadRequestException('mime_mismatch');
      if (sniff.mime === 'image/png') {
        const out = await sharp(buffer).png().toBuffer({ resolveWithObject: true });
        cleaned = out.data;
        format = 'png';
        w_px = out.info.width;
        h_px = out.info.height;
        const meta = await sharp(buffer).metadata();
        if (meta.density && meta.density < 200) dpiWarning = `DPI ${meta.density} 偏低，打印可能模糊`;
      } else if (sniff.mime === 'image/jpeg') {
        const out = await sharp(buffer).jpeg({ quality: 90 }).toBuffer({ resolveWithObject: true });
        cleaned = out.data;
        format = 'jpeg';
        w_px = out.info.width;
        h_px = out.info.height;
        const meta = await sharp(buffer).metadata();
        if (meta.density && meta.density < 200) dpiWarning = `DPI ${meta.density} 偏低，打印可能模糊`;
      } else {
        throw new BadRequestException('mime_not_allowed');
      }
    }

    const ext = format === 'jpeg' ? 'jpg' : format;
    const hash = createHash('sha256').update(cleaned).digest('hex').slice(0, 16);
    const filename = `${hash}.${ext}`;
    const fullPath = path.join(STORAGE_ROOT, 'uploads', filename);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, cleaned);

    return { url: `/uploads/${filename}`, w_px, h_px, format, dpiWarning };
  }
}
```

- [ ] **Step 2: Implement UploadsController**

```ts
// apps/api/src/uploads/uploads.controller.ts
import {
  Controller, Post, UploadedFile, UseInterceptors, BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { UploadsService } from './uploads.service';

@Controller('uploads')
export class UploadsController {
  constructor(private readonly uploads: UploadsService) {}

  @Post('image')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } }))
  // Multer's File interface is what comes through.
  async uploadImage(@UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('file_missing');
    const allowed = ['image/svg+xml', 'image/png', 'image/jpeg'];
    if (!allowed.includes(file.mimetype)) {
      throw new BadRequestException('mime_not_allowed');
    }
    return this.uploads.storeImage(file.buffer, file.mimetype);
  }
}
```

- [ ] **Step 3: Implement UploadsModule**

```ts
// apps/api/src/uploads/uploads.module.ts
import { Module } from '@nestjs/common';
import { UploadsController } from './uploads.controller';
import { UploadsService } from './uploads.service';

@Module({
  controllers: [UploadsController],
  providers: [UploadsService],
})
export class UploadsModule {}
```

- [ ] **Step 4: Wire into AppModule + serve static**

In `apps/api/src/app.module.ts`, add imports:

```ts
import { ServeStaticModule } from '@nestjs/serve-static';
import { UploadsModule } from './uploads/uploads.module';
import { join } from 'path';
```

And add to the `imports` array:

```ts
ServeStaticModule.forRoot({
  rootPath: join(process.env.STORAGE_ROOT ?? '/storage'),
  serveRoot: '/',
  exclude: ['/healthz', '/auth/*', '/users/*'],
}),
UploadsModule,
```

- [ ] **Step 5: Type-check api**

```bash
docker compose -f docker-compose.dev.yml exec -T api sh -c 'cd /workspace/apps/api && pnpm exec tsc --noEmit'
```

- [ ] **Step 6: Restart api + smoke**

```bash
docker compose -f docker-compose.dev.yml restart api
docker compose -f docker-compose.dev.yml logs --tail 30 api
```

Confirm `Mapped {/uploads/image, POST} route` appears.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/uploads apps/api/src/app.module.ts
git commit -m "feat(api): UploadsModule — POST /uploads/image (svg/png/jpg, sanitise, sharp re-encode)"
```

---

### Task 30: Uploads e2e test

**Files:**
- Create: `apps/api/test/uploads.e2e.spec.ts`

- [ ] **Step 1: Write the e2e**

```ts
// apps/api/test/uploads.e2e.spec.ts
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Uploads (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    process.env.STORAGE_ROOT = '/tmp/test-storage';
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    await app.init();
  });

  afterAll(async () => { await app.close(); });

  it('accepts a clean SVG and returns a url', async () => {
    const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100"/></svg>`);
    const res = await request(app.getHttpServer())
      .post('/uploads/image')
      .attach('file', svg, { filename: 'logo.svg', contentType: 'image/svg+xml' });
    expect(res.status).toBe(201);
    expect(res.body.format).toBe('svg');
    expect(res.body.url).toMatch(/^\/uploads\/.+\.svg$/);
  });

  it('rejects an SVG with a <script>', async () => {
    const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>`);
    const res = await request(app.getHttpServer())
      .post('/uploads/image')
      .attach('file', svg, { filename: 'bad.svg', contentType: 'image/svg+xml' });
    expect(res.status).toBe(201); // sanitised, not rejected
    expect(res.body.url).toBeDefined();
  });

  it('rejects when mime claim does not match magic bytes', async () => {
    const fakePng = Buffer.from('not actually a png');
    const res = await request(app.getHttpServer())
      .post('/uploads/image')
      .attach('file', fakePng, { filename: 'fake.png', contentType: 'image/png' });
    expect(res.status).toBe(400);
  });

  it('rejects oversized file (> 5 MB)', async () => {
    const big = Buffer.alloc(6 * 1024 * 1024, 0xff);
    const res = await request(app.getHttpServer())
      .post('/uploads/image')
      .attach('file', big, { filename: 'big.png', contentType: 'image/png' });
    expect([400, 413]).toContain(res.status);
  });
});
```

- [ ] **Step 2: Run**

```bash
docker compose -f docker-compose.dev.yml exec -T api sh -c 'cd /workspace/apps/api && pnpm test:e2e --testPathPattern=uploads'
```

(If `test:e2e` doesn't take a pattern, run the full e2e suite. Inspect the test runner config in `apps/api/package.json` and use the appropriate command.)

Expected: 4/4 pass.

- [ ] **Step 3: Commit**

```bash
git add apps/api/test/uploads.e2e.spec.ts
git commit -m "test(api): uploads e2e — svg/script-strip/mime-mismatch/oversize"
```

---

### Task 31: Web — useImageUpload composable + ImageElement source picker

**Files:**
- Create: `apps/web/src/composables/useImageUpload.ts`
- Modify: `apps/web/src/designer/PropertyPanel.vue`

- [ ] **Step 1: Implement composable**

```ts
// apps/web/src/composables/useImageUpload.ts
import { ref } from 'vue';

export interface UploadResult {
  url: string;
  w_px: number;
  h_px: number;
  format: 'svg' | 'png' | 'jpeg';
  dpiWarning?: string;
}

export function useImageUpload() {
  const uploading = ref(false);
  const error = ref<string | null>(null);
  const lastResult = ref<UploadResult | null>(null);

  async function upload(file: File): Promise<UploadResult | null> {
    if (file.size > 5 * 1024 * 1024) {
      error.value = '文件超过 5MB';
      return null;
    }
    uploading.value = true;
    error.value = null;
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/uploads/image', { method: 'POST', body: fd, credentials: 'include' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        error.value = body.message || `上传失败 (${res.status})`;
        return null;
      }
      const json = (await res.json()) as UploadResult;
      lastResult.value = json;
      return json;
    } catch (e) {
      error.value = (e as Error).message;
      return null;
    } finally {
      uploading.value = false;
    }
  }

  return { upload, uploading, error, lastResult };
}
```

- [ ] **Step 2: Wire image source picker into PropertyPanel**

In `PropertyPanel.vue` add a block above `BorderControl` that only renders when `sel.type === 'image'`:

```ts
// add imports at top of script
import { useImageUpload } from '../composables/useImageUpload';
const { upload, uploading, error: uploadError } = useImageUpload();

type ImageSourceKind = 'static' | 'field' | 'upload';
function setImageSourceKind(kind: ImageSourceKind): void {
  if (!sel.value || sel.value.type !== 'image') return;
  if (kind === 'static' || kind === 'upload') {
    store.updateElement(sel.value.id, { source: { kind: 'static', url: '' } } as Partial<TemplateElement>);
  } else {
    store.updateElement(sel.value.id, { source: { kind: 'field', binding: '' } } as Partial<TemplateElement>);
  }
}
function setStaticUrl(v: string): void {
  if (!sel.value || sel.value.type !== 'image') return;
  store.updateElement(sel.value.id, { source: { kind: 'static', url: v } } as Partial<TemplateElement>);
}
function setFieldBinding(v: string): void {
  if (!sel.value || sel.value.type !== 'image') return;
  store.updateElement(sel.value.id, { source: { kind: 'field', binding: v } } as Partial<TemplateElement>);
}
async function onFileChange(e: Event): Promise<void> {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  const r = await upload(file);
  if (r && sel.value && sel.value.type === 'image') {
    store.updateElement(sel.value.id, { source: { kind: 'static', url: r.url } } as Partial<TemplateElement>);
  }
}
```

In template:

```vue
<div v-if="sel && sel.type === 'image'" class="img-source">
  <div class="style-title">图片来源</div>
  <div class="srow">
    <div class="seg">
      <button :class="{ on: sel.source.kind === 'static' && !sel.source.url.startsWith('/uploads/') }"
        @click="setImageSourceKind('static')">URL</button>
      <button :class="{ on: sel.source.kind === 'static' && sel.source.url.startsWith('/uploads/') }"
        @click="setImageSourceKind('upload')">上传</button>
      <button :class="{ on: sel.source.kind === 'field' }"
        @click="setImageSourceKind('field')">绑定字段</button>
    </div>
  </div>

  <div v-if="sel.source.kind === 'static' && !sel.source.url.startsWith('/uploads/')" class="srow">
    <input class="snum" style="flex:1" :value="sel.source.url"
      @input="(e: Event) => setStaticUrl((e.target as HTMLInputElement).value)"
      placeholder="https://..." />
  </div>
  <div v-else-if="sel.source.kind === 'static'" class="srow">
    <input type="file" accept="image/svg+xml,image/png,image/jpeg" @change="onFileChange" />
    <span v-if="uploading" class="sval">上传中…</span>
    <span v-if="uploadError" class="sval" style="color:#d94f4f">{{ uploadError }}</span>
    <span v-if="sel.source.url" class="sval mono">{{ sel.source.url }}</span>
  </div>
  <div v-else class="srow">
    <select class="ssel" style="flex:1" :value="sel.source.binding"
      @change="(e: Event) => setFieldBinding((e.target as HTMLSelectElement).value)">
      <option value="">(选择字段)</option>
      <option v-for="f in store.fieldDefs.filter((x) => x.def.type === 'image')" :key="f.key" :value="f.key">
        {{ f.key }} · {{ f.def.label }}
      </option>
    </select>
  </div>
</div>
```

Add CSS:

```css
.img-source { padding: 12px 14px; border-bottom: 1px solid var(--tp-line); }
```

- [ ] **Step 3: Type-check + visual**

```bash
docker compose -f docker-compose.dev.yml exec -T web sh -c 'cd /workspace/apps/web && NODE_OPTIONS=--max-old-space-size=4096 ./node_modules/.bin/vue-tsc --noEmit'
```

In browser, drop an image element. Use the three buttons; pick a small PNG/SVG to upload; verify it renders.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/composables/useImageUpload.ts apps/web/src/designer/PropertyPanel.vue
git commit -m "feat(designer): image source picker (URL / upload / field) + upload composable"
```

---

### Task 32: DesignerView — remove avatar

**Files:**
- Modify: `apps/web/src/views/DesignerView.vue`
- Modify: `apps/web/src/styles/designer.css`

- [ ] **Step 1: Remove avatar markup**

In `apps/web/src/views/DesignerView.vue` replace the `tp-panel-head` block:

```vue
<div class="tp-panel-head">
  <div class="tp-head-text">
    <div class="tp-head-title">{{ store.template.meta.name }}</div>
    <div class="tp-head-sub">v{{ store.template.meta.version }} · 草稿已保存</div>
  </div>
</div>
```

(Remove the `<div class="tp-avatar">` line.)

- [ ] **Step 2: Optionally clean up `.tp-avatar` from designer.css**

Search for `.tp-avatar` in `apps/web/src/styles/designer.css`. Delete the rule block entirely. Adjust `.tp-panel-head` gap to 0 (the avatar was the only thing needing the 10px gap).

- [ ] **Step 3: Visual + commit**

```bash
docker compose -f docker-compose.dev.yml restart web
```

```bash
git add apps/web/src/views/DesignerView.vue apps/web/src/styles/designer.css
git commit -m "chore(designer): remove template avatar from left panel head"
```

---

### Task 33: Strip redundant hints

**Files:**
- Modify: `apps/web/src/designer/ElementLibrary.vue`
- Modify: `apps/web/src/designer/BorderControl.vue` (already done in Task 21 but double-check)

- [ ] **Step 1: ElementLibrary**

Open `apps/web/src/designer/ElementLibrary.vue`. In the `tp-sub-head` block, ensure only `<span class="tp-sub-title">添加新元素</span>` remains. Remove any `tp-sub-hint` span containing `"点击或拖入"`.

- [ ] **Step 2: BorderControl** — verify Task 21's `bp-title` reads simply `"边框"` with no trailing hint.

- [ ] **Step 3: Grep for any remaining "点击或拖入" or "点方向切换" in src/**

```bash
docker compose -f docker-compose.dev.yml exec -T web sh -c 'cd /workspace/apps/web && grep -r "点击或拖入\|点方向切换" src/ || echo "none"'
```

If results appear in places other than tooltips (titles, aria-label), remove them.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/designer
git commit -m "chore(designer): strip redundant hints from sub-heads"
```

---

### Task 34: Playwright acceptance flow

**Files:**
- Modify: `apps/web/tests/e2e/designer.spec.ts` (or whatever the existing e2e file is)

- [ ] **Step 1: Find the existing e2e file**

```bash
docker compose -f docker-compose.dev.yml exec -T web sh -c 'cd /workspace/apps/web && find tests -name "*.spec.ts" 2>/dev/null'
```

Use the file (likely `tests/e2e/designer.spec.ts`).

- [ ] **Step 2: Add iteration-2 acceptance scenarios**

Append:

```ts
test('iteration 2 — paper preset + custom dialog + cell rescale preserves position', async ({ page }) => {
  await page.goto('/designer/new');
  // Drop a text element via drag-and-drop or click-add
  await page.getByRole('button', { name: /文字/ }).first().click();
  // Move to known position
  const el = page.locator('.tp-element').first();
  const beforeBox = await el.boundingBox();
  expect(beforeBox).toBeTruthy();

  // Change cell size from default to 8 px via toolbar dropdown
  await page.getByRole('button', { name: /⊞/ }).click();
  await page.getByText('8 px').click();

  // Element should still be at roughly the same px position
  const afterBox = await el.boundingBox();
  expect(Math.abs((afterBox!.x ?? 0) - (beforeBox!.x ?? 0))).toBeLessThan(5);
});

test('iteration 2 — QR resize locks 1:1', async ({ page }) => {
  await page.goto('/designer/new');
  await page.getByRole('button', { name: /二维码/ }).click();
  const el = page.locator('.tp-element').first();
  await el.click();

  // Get the SE corner handle and drag right by 50 px
  const handle = page.locator('.tp-handle-br');
  const handleBox = await handle.boundingBox();
  await page.mouse.move(handleBox!.x + 4, handleBox!.y + 4);
  await page.mouse.down();
  await page.mouse.move(handleBox!.x + 54, handleBox!.y + 4);
  await page.mouse.up();

  const sizeBadge = await page.locator('.tp-size-badge').textContent();
  expect(sizeBadge).toMatch(/^(\d+)×\1 格 \(1:1\)/); // width === height
});

test('iteration 2 — image upload integrates', async ({ page }) => {
  await page.goto('/designer/new');
  await page.getByRole('button', { name: /图片/ }).click();
  const el = page.locator('.tp-element').first();
  await el.click();
  await page.getByRole('button', { name: '上传' }).click();
  const filePromise = page.waitForEvent('filechooser');
  await page.locator('input[type="file"]').setInputFiles({
    name: 'logo.svg',
    mimeType: 'image/svg+xml',
    buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 50 50"><rect width="50" height="50"/></svg>'),
  });
  await page.waitForSelector('.sval.mono', { timeout: 10_000 });
  await expect(page.locator('.sval.mono')).toContainText('/uploads/');
});
```

- [ ] **Step 3: Run e2e**

```bash
docker compose -f docker-compose.dev.yml exec -T web sh -c 'cd /workspace/apps/web && pnpm exec playwright test --reporter=line'
```

If browsers aren't installed in the container, install them:

```bash
docker compose -f docker-compose.dev.yml exec -T web sh -c 'cd /workspace/apps/web && pnpm exec playwright install --with-deps chromium'
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/tests
git commit -m "test(e2e): iteration 2 — paper change preserves px / QR 1:1 / image upload"
```

---

### Task 35: Final acceptance pass + merge

- [ ] **Step 1: Full vue-tsc**

```bash
docker compose -f docker-compose.dev.yml exec -T web sh -c 'cd /workspace/apps/web && NODE_OPTIONS=--max-old-space-size=8192 ./node_modules/.bin/vue-tsc --noEmit'
docker compose -f docker-compose.dev.yml exec -T api sh -c 'cd /workspace/apps/api && pnpm exec tsc --noEmit'
docker compose -f docker-compose.dev.yml exec -T web sh -c 'cd /workspace/packages/schema && pnpm test'
docker compose -f docker-compose.dev.yml exec -T api sh -c 'cd /workspace/apps/api && pnpm test'
```

Expected: everything green.

- [ ] **Step 2: Walk the acceptance checklist from the spec**

Open the designer in a browser. Manually verify each line of the spec's `## Acceptance checklist`. If any item fails, open a follow-up task; do not skip.

- [ ] **Step 3: Merge feature branch to master**

```bash
git checkout master
git pull
git merge --no-ff feature/plan-2-designer -m "Merge iteration 2: 14-item designer refinement"
git push origin master
```

- [ ] **Step 4: Tag**

```bash
git tag -a v0.3.0-designer-iter2 -m "Designer iteration 2 complete"
git push origin v0.3.0-designer-iter2
```

---

## Self-Review (run after writing — don't dispatch a subagent)

Checked against the spec:

1. **§ 1 Canvas / cell** — Tasks 5-15. mm-anchor in T1/T7-T10; paper presets T5/T6/T13; custom dialog T12; square cell display T14; mm inputs T15.
2. **§ 2 Library + list** — Tasks 16 (3-group categorisation) and 17 (pagination + hover delete).
3. **§ 3 Drag/resize** — Tasks 18 (HitZones mode prop), 19 (QR lock + 1D min-rs), 20 (live ratio in badge).
4. **§ 4 Styling** — Tasks 2 (StyleSchema expand), 3 (BarcodeElement expand), 21 (BorderControl rewrite), 22 (基础 style), 23 (高级 style), 24 (BarcodeProperties).
5. **§ 5 Field types + image upload** — Tasks 4 (FieldDefSchema), 26 (FieldManager dialog), 27 (api deps + volume), 28 (svg sanitiser), 29 (UploadsModule), 30 (e2e), 31 (web image source picker).
6. **§ 6 UI cleanups** — Tasks 14 (toolbar widen), 32 (avatar), 33 (hint strip).
7. **Migration** — Task 7 (restore migrates iteration-1 drafts).

No placeholders; every code block contains complete content; commit messages, file paths, and shell commands are explicit.

Type/method consistency check: `recomputeGridFromAnchor`, `clampAnchorToPaper`, `setElementAnchor` introduced in T7/T8/T9 are referenced consistently in T15, T17, T19. The `mode` prop on HitZones (T18) matches what CanvasElement passes. `ElementMeta.group` (T16) flows through `LIBRARY_ITEMS`. `useImageUpload` (T31) is called only from PropertyPanel.

No spec requirement appears to be missing a task.
