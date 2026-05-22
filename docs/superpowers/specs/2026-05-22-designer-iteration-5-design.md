# Designer Iteration 5 — Design Spec

**Date:** 2026-05-22 (after iteration 4 ship)
**Status:** Approved (brainstorming)

Four issues raised after iteration 4:

| Batch | Topic | Items |
|---|---|---|
| § A | Barcode/QR split + content source picker + first-render fix | #1 #2 #3 |
| § B | Field editing + binding controls | #4 |

---

## § A · Barcode/QR split + content source picker + first-render fix (#1 #2 #3)

### A.1 Split into two element types

The current single `barcode` element with a `symbology` discriminator (QR as one option) bundles two very different objects: a 2D matrix code with ECC levels vs a 1D code with text-below positioning. Other open-source designers (vue-plugin-hiprint, jsbarcode-based tools) treat them separately. This iteration splits them.

**Schema:**

```ts
// New element type
export const QrElementSchema = Base.extend({
  type: z.literal('qr'),
  binding: z.string().optional(),
  content: z.object({ static: z.string() }).optional(),
  eccLevel: z.enum(['L', 'M', 'Q', 'H']).default('M'),
  foregroundColor: z.string().default('#000000'),
  backgroundColor: z.string().default('#ffffff'),
  quietZone: z.number().nonnegative().default(2),
});

// Modified — drop qr from symbology enum + drop QR-only fields
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

// Discriminated union gains QrElementSchema
ElementSchema = z.discriminatedUnion('type', [
  TextElementSchema, FieldElementSchema, ImageElementSchema, TableElementSchema,
  BarcodeElementSchema, QrElementSchema,                                   // ← new
  AutonumberElementSchema, SystemElementSchema, RectElementSchema,
]);
```

Symbology enum drops `qr` (moved to its own type), `ean8`, `upc-a` (user decided to delete — niche/regional).

### A.2 Renderer split

- **Modify** `packages/template-renderer/src/elements/BarcodeElement.vue` — 1D rendering only. Remove QR-specific branches (the `qrcode-generator` calls, the QR SVG output, the `eccLevel` reads).
- **Create** `packages/template-renderer/src/elements/QrElement.vue` — QR rendering only via `qrcode-generator`. Mirrors the iteration-4 watch + blur + `flush: 'post'` pattern.
- `packages/template-renderer/src/index.ts` — export QrElement alongside the others.

**CanvasElement.vue** `elementMap` adds:
```ts
const elementMap: Record<string, unknown> = {
  text: TextElement,
  field: FieldElement,
  image: ImageElement,
  table: TableElement,
  barcode: BarcodeElement,
  qr: QrElement,                                                            // ← new
  autonumber: AutonumberElement,
  system: SystemElement,
  rect: RectElement,
};
```

### A.3 Library + factory split

`elementFactory.ts` `LIBRARY_ITEMS`:

```ts
{ type: 'barcode', group: '数据', glyph: '|||', label: '条码',   defaultMm: { w: 60, h: 16 } },
{ type: 'qr',      group: '数据', glyph: '▣',   label: '二维码', defaultMm: { w: 25, h: 25 } },
```

(Drop the `variant: 'qr' | 'barcode'` discriminator from `ElementMeta` — the `type` field is now sufficient.)

`buildElement` switch gains a `'qr'` case and the existing `'barcode'` case loses QR-specific defaults:

```ts
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
```

### A.4 MIN_MM + minMmFor

```ts
export const MIN_MM: Record<string, { w: number; h: number }> = {
  // ... existing entries ...
  qr:        { w: 12, h: 12 },
  barcode1d: { w: 25, h: 8 },
};

export function minMmFor(el: TemplateElement): { w: number; h: number } {
  if (el.type === 'qr')      return MIN_MM.qr;
  if (el.type === 'barcode') return MIN_MM.barcode1d;
  return MIN_MM[el.type];
}
```

### A.5 HitZones + usePointerDrag

`HitZones` mode prop check: today `el.symbology === 'qr'`, change to `el.type === 'qr'`.

`usePointerDrag.getResizeMode()`:
```ts
function getResizeMode(): ResizeMode {
  const el = getElement();
  if (!el) return 'free';
  if (el.type === 'qr')      return 'qr-lock';
  if (el.type === 'barcode') return 'barcode';
  return 'free';
}
```

The QR 1:1 lock + 1D barcode min-rs guard branches are otherwise unchanged.

### A.6 Property panel split

- **Modify** `apps/web/src/designer/BarcodeProperties.vue` — drop the QR-specific UI (eccLevel select, the `isQr` conditional), keep only 1D controls + add the **content source picker** (next subsection). Filename remains; props now constrain `element.type === 'barcode'`.
- **Create** `apps/web/src/designer/QrProperties.vue` — only QR controls + content source picker.
- **Modify** `apps/web/src/designer/PropertyPanel.vue` — render `<BarcodeProperties>` when `sel.type === 'barcode'`, `<QrProperties>` when `sel.type === 'qr'`.

### A.7 Content source picker (§A.7)

A small reusable Vue component `apps/web/src/designer/BarcodeContentPicker.vue` that both Properties panels use:

```vue
<script setup lang="ts">
// eslint-disable-next-line import/no-unresolved
import type { TemplateElement } from '@template-printing/schema';

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
  <div class="bc-source">
    <div class="bc-source-tabs seg">
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
```

Both Properties panels include this component at the top (above the type/ECC/color controls):

```vue
<BarcodeContentPicker :element="props.element" @update="(patch) => emit('update', patch)" />
```

### A.8 Render fallback when nothing configured

If a barcode/QR has `binding === ''` AND `content?.static === '' / undefined`, render an empty placeholder (CSS-only, no bwip-js call) showing a dashed outline + small "未配置内容" label centered. Avoids the "transparent / blank" surprise.

```css
.bc-empty {
  width: 100%;
  height: 100%;
  border: 1px dashed var(--tp-line-strong);
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--tp-ink-faint);
  font-size: 11px;
}
```

Both renderers gate on `if (!effectiveContent) return <placeholder>`.

### A.9 First-render bug fix (#2)

Iteration 4 Task 10 consolidated `onMounted(renderBarcode)` into a `watch(..., { immediate: true })`. With `immediate: true`, the watch callback fires **synchronously during setup**, before refs (canvasRef / qrContainer) are bound to the DOM. Result: first render no-ops, barcode appears blank until any subsequent reactive change re-fires the watch.

**Fix**: add `flush: 'post'` so the watcher runs after the DOM update:

```ts
watch(
  () => ({ ...deps }),
  (next) => {
    if (next.isResizing) return;
    renderBarcode();
  },
  { deep: true, immediate: true, flush: 'post' },
);
```

`flush: 'post'` is documented Vue 3 API; combined with `immediate: true` it fires once **after** the first mount, when refs are guaranteed bound. Apply to both BarcodeElement.vue and QrElement.vue.

### A.10 Legacy draft migration

`restore()` in the store gets a new migration step BEFORE the existing anchor/cell logic:

```ts
// Iteration-5: migrate legacy barcode→qr split.
for (const el of parsed.elements as TemplateElement[]) {
  if (el.type === 'barcode' && (el as { symbology?: string }).symbology === 'qr') {
    // Convert to new qr type.
    const old = el as TemplateElement & { symbology?: string; eccLevel?: 'L'|'M'|'Q'|'H'; showText?: boolean; textPosition?: 'top'|'bottom'; textFontSize?: number };
    (el as TemplateElement).type = 'qr';
    delete old.symbology;
    delete old.showText;
    delete old.textPosition;
    delete old.textFontSize;
    if (!old.eccLevel) old.eccLevel = 'M';
  } else if (el.type === 'barcode' && (
    (el as { symbology?: string }).symbology === 'ean8' ||
    (el as { symbology?: string }).symbology === 'upc-a'
  )) {
    (el as { symbology: string }).symbology = 'code128';
    legacyDeprecatedBarcodeCount += 1;
  }
}
if (legacyDeprecatedBarcodeCount > 0) {
  ElMessage.warning(`${legacyDeprecatedBarcodeCount} 个条码已从 EAN-8/UPC-A 转换为 Code 128`);
}
```

### A.11 Acceptance criteria

- Drop a 二维码 element → QR renders immediately (no transparent / blank state).
- Drop a 条码 element → 1D barcode renders immediately.
- Library shows TWO icons: ▣ 二维码, ||| 条码.
- 条码's symbology dropdown contains only Code 128 / Code 39 / EAN-13 / ITF-14.
- 二维码's property panel has ECC level + colors + quiet zone, **no** symbology dropdown.
- Both panels include a "静态文本 / 字段绑定" picker. Field binding only lists string + number fields.
- Switching from static to field binding clears `content.static`; switching back clears `binding`.
- Open an iteration-4 draft with `type:'barcode', symbology:'qr'` → loads as `type:'qr'`. Visual identical.
- Open a draft with `symbology:'ean8'` → barcode becomes Code 128 with a toast.

---

## § B · Field editing + binding controls (#4)

### B.1 FieldManager — edit existing fields

Currently each field card in `apps/web/src/designer/FieldManager.vue` has a delete (`×`) button on hover. Add an edit (`✎`) button alongside.

Click ✎ → opens the existing field dialog in **edit mode**:
- The dialog title changes to "编辑字段"
- The `key` input becomes `disabled` (key is the binding identifier; renaming is out of scope)
- All other inputs (label, required, example, type, type-conditional fields) are pre-populated from the existing definition and editable

Dialog submission in edit mode calls a new store action:

```ts
editField(key: string, def: FieldDef): void {
  if (!this.template.schema[key]) return;
  const oldType = this.template.schema[key].type;
  this.template.schema[key] = def;
  // If type changed, scan elements that bind to this key and may no longer be compatible.
  if (oldType !== def.type) {
    let unbound = 0;
    for (const el of this.template.elements) {
      if (!('binding' in el) || el.binding !== key) continue;
      const allowed = allowedFieldTypesForElement(el.type);
      if (!allowed.includes(def.type)) {
        (el as { binding?: string }).binding = '';
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

`allowedFieldTypesForElement(type)` is a helper exported from `elementFactory.ts` so the store and PropertyPanel both share it:

```ts
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

### B.2 PropertyPanel binding controls

The binding dropdown for `field` / `barcode` / `qr` / `image` (when source.kind=field) / `table` becomes type-filtered, with an "未绑定" sentinel for non-table types.

For `field` element in PropertyPanel:

```ts
import { allowedFieldTypesForElement } from './elementFactory';

const compatibleFields = computed(() => {
  if (!sel.value) return [];
  const allowed = allowedFieldTypesForElement(sel.value.type);
  return store.fieldDefs.filter((f) => allowed.includes(f.def.type));
});

const currentBindingMissing = computed(() => {
  if (!sel.value || !('binding' in sel.value) || !sel.value.binding) return false;
  return !compatibleFields.value.some((f) => f.key === sel.value!.binding);
});
```

Template (for the field binding row):

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
    <!-- If existing binding no longer compatible, show as warning option -->
    <ElOption
      v-if="currentBindingMissing"
      :value="sel.binding"
      :label="`⚠ ${sel.binding} (类型不兼容)`"
      disabled
    />
  </ElSelect>
</div>
```

Similar updates apply to:
- Table element's binding select (uses `compatibleFields` filtered to array; no "未绑定" option since binding is required by schema).
- Image element's "字段绑定" mode (filtered to image fields, already implemented in iteration 2 but uses raw filter — switch to `allowedFieldTypesForElement`).
- Barcode/QR's `BarcodeContentPicker` already filters per §A.7.

### B.3 Default empty binding (per user's B option)

`elementFactory.buildElement` field branch:

```ts
case 'field':
  return { id: newId, type: 'field', grid, anchor, style,
           binding: '', fallback: '—', format: null };
```

(`binding: 'fieldKey'` → `binding: ''`.) Renderer's `displayValue` already shows fallback when binding evaluates to empty/missing — should work without renderer change. Verify in test.

Existing iteration-1..4 drafts in localStorage may contain `binding: 'fieldKey'`. We **do not** auto-migrate those — the value is user-data territory; if they used 'fieldKey' literally that's a key they may have intended. The restore() flow already handles unknown-key gracefully via fallback rendering.

### B.4 Schema relax

`FieldElementSchema.binding`: change from `z.string().min(1)` to `z.string()`.

Existing tests for FieldElementSchema parsing should still pass. Add one assertion:

```ts
it('accepts empty binding (unbound)', () => {
  expect(FieldElementSchema.parse({ ...baseFieldFixture, binding: '' }).binding).toBe('');
});
```

Other element types' binding rules:
- `TableElementSchema.binding` stays `z.string().min(1)` — table requires an array source.
- `BarcodeElement.binding` / `QrElement.binding`: already optional via `.optional()`.

### B.5 Acceptance criteria

- Field card hover shows both ✎ and × icons.
- Click ✎ → dialog opens prefilled, `key` input is greyed out / disabled.
- Submit edit → field def replaced in schema; if type changed and any elements bind to it incompatibly, those bindings get cleared with a toast.
- Drop a 字段 element → its binding is empty by default; PropertyPanel binding dropdown shows `（未绑定）` selected.
- Pick a field of compatible type → binds.
- Switch to 字段 element type that doesn't match any defined field type → binding dropdown shows only `（未绑定）` (empty list).
- Drop a 明细 (table) → binding dropdown shows only `array`-typed fields, no `（未绑定）` item.

---

## Out of scope

- Renaming field keys (immutable; user can delete + recreate).
- Auto-suggesting field bindings on drop (B option chosen — user must explicitly bind).
- Expression mode for barcode/QR content (the user opted to keep just static + binding).

## Acceptance checklist

- [ ] Library shows 二维码 ▣ + 条码 ||| as separate icons.
- [ ] Drop 条码 → immediately visible (no blank state).
- [ ] Drop 二维码 → immediately visible.
- [ ] 条码's symbology dropdown lists only Code 128 / Code 39 / EAN-13 / ITF-14.
- [ ] 二维码 panel shows ECC, colors, quiet zone; no symbology dropdown.
- [ ] Both panels have 静态文本 / 字段绑定 picker.
- [ ] Field-binding select for barcode/QR lists only string + number fields.
- [ ] Open iteration-4 draft with type:'barcode', symbology:'qr' → opens as type:'qr', no visual change.
- [ ] Open draft with symbology:'ean8' or 'upc-a' → coerced to Code 128 with toast.
- [ ] Field card has ✎ edit icon on hover.
- [ ] Edit dialog opens prefilled with `key` disabled.
- [ ] Submit edit changes field; if type changes invalidate any bindings, those get cleared with a toast.
- [ ] Drop 字段 element → binding is empty by default.
- [ ] 字段 PropertyPanel binding dropdown filters to compatible types + shows `（未绑定）`.
- [ ] 明细 binding dropdown shows only array fields, no `（未绑定）`.
