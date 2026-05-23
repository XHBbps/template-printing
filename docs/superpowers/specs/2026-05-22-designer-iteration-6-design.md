# Designer Iteration 6 — Design Spec

**Date:** 2026-05-22 (after iteration 5)
**Status:** Approved (brainstorming)

UI polish + interaction batch. 9 items grouped into 5 sections.

| Batch | Topic | Items |
|---|---|---|
| § A | Light UI polish | #1 clear-all, #2 field unused color cue, #5 rename, #6 textAlign label, #8 template name edit |
| § B | Slider double-click → number input | #3 |
| § C | Font weight labels | #4 |
| § D | PropertyPanel universal style audit | #7 |
| § E | Lucide icon migration | #9 |

**Depends on**: iteration 5 (barcode/QR split, FieldManager edit dialog). Should ship after iteration 5 is implemented, or be combined with it into a single execution batch.

---

## § A · Light UI polish (#1 #2 #5 #6 #8)

### A.1 Clear-all canvas elements (#1)

Store new action:

```ts
deleteAllElements(): void {
  this.template.elements = [];
  this.selectedIds = [];
  this.snapshot();
},
```

`CanvasElementsList.vue` sub-head adds a `清空` button visible only when `elements.length > 0`:

```vue
<div class="tp-sub-head">
  <span class="tp-sub-title">画布元素 · 共 {{ elements.length }} 个</span>
  <button v-if="elements.length > 0" class="clear-btn" @click="onClearAll">
    清空
  </button>
</div>
```

```ts
function onClearAll(): void {
  if (!window.confirm(`确定清空全部 ${store.template.elements.length} 个元素？`)) return;
  store.deleteAllElements();
}
```

```css
.clear-btn {
  background: transparent;
  border: none;
  font-size: 11px;
  color: var(--tp-ink-faint);
  cursor: pointer;
  padding: 2px 8px;
  border-radius: 4px;
  transition: color 120ms ease, background 120ms ease;
}
.clear-btn:hover { color: #d94f4f; background: rgba(217, 79, 79, 0.08); }
```

### A.2 Field unused state via background only (#2)

In `FieldManager.vue`:
- KEEP the `:class="{ unused: !store.usedFieldKeys.has(key) }"` class binding on the field card.
- REMOVE the inner `<span v-if="!store.usedFieldKeys.has(key)" class="unused-tag">未使用</span>` element entirely.
- KEEP the `.field-card.unused { background: var(--tp-warn-bg); border-color: var(--tp-warn-line); }` CSS — the warm-yellow background remains the visual indicator.
- ADD `:title="!store.usedFieldKeys.has(key) ? '未使用' : ''"` on the card for accessibility (browser tooltip).
- DELETE the now-orphan `.unused-tag` CSS rule.

### A.3 Renames (#5)

| File | Old text | New text |
|---|---|---|
| `apps/web/src/designer/ElementLibrary.vue` | `添加新元素` | `元素组件` |
| `apps/web/src/designer/FieldManager.vue` | `数据字段 · 共 N 个` | `变量 · 共 N 个` |
| `apps/web/src/designer/FieldManager.vue` (add dialog title) | `添加字段` | `添加变量` |
| `apps/web/src/designer/FieldManager.vue` (edit dialog title, from iter 5) | `编辑字段` | `编辑变量` |
| `apps/web/src/designer/PropertyPanel.vue` (binding row label) | `绑定` | unchanged (still `绑定`) |
| empty-state copy in FieldManager | `尚未声明字段` | `尚未声明变量` |
| empty-state copy in FieldManager | `点击 + 添加` | unchanged |

Store action names (`addField`, `removeField`, `editField`) and schema names (`fieldDefs`, `FieldDefSchema`) stay unchanged — UI rename only.

### A.4 textAlign label "端" → "两端" (#6)

In `PropertyPanel.vue` `<script setup>`'s textAlign segmented button, find the label map:

```ts
// Current
{{ {left:'左', center:'中', right:'右', justify:'端'}[a] }}

// New
{{ {left:'左', center:'中', right:'右', justify:'两端'}[a] }}
```

The button width may need to grow a few px to fit "两端" — adjust scoped CSS if needed:

```css
.seg button { padding: 3px 10px; min-width: 32px; }
/* 两端 is 2 characters; button stays uniform with single-char ones */
```

### A.5 Template name inline edit (#8)

New small component `apps/web/src/designer/TemplateNameEditor.vue`:

```vue
<script setup lang="ts">
import { nextTick, ref } from 'vue';
import { useDesignerStore } from '../stores/designer';

const store = useDesignerStore();
const editing = ref(false);
const draft = ref('');
const inputRef = ref<HTMLInputElement | null>(null);

function startEdit(): void {
  draft.value = store.template.meta.name;
  editing.value = true;
  nextTick(() => {
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
    <span class="tne-edit-hint">✎</span>
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
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  border-radius: 4px;
  padding: 2px 4px;
  transition: background 120ms ease;
}
.tne-display:hover { background: var(--tp-field-bg); }
.tne-title {
  font-weight: 700;
  font-size: 14px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.tne-edit-hint {
  font-size: 11px;
  color: var(--tp-ink-faint);
  opacity: 0;
  transition: opacity 120ms ease;
}
.tne-display:hover .tne-edit-hint { opacity: 1; }
.tne-input {
  width: 100%;
  font: inherit;
  font-weight: 700;
  font-size: 14px;
  padding: 2px 4px;
  border: 1px solid var(--tp-accent);
  border-radius: 4px;
  background: var(--tp-panel);
  outline: none;
  color: var(--tp-ink);
}
</style>
```

Note: the `✎` placeholder in the script above is replaced by the actual Lucide `IconPencil` SVG in §E.

`DesignerView.vue` left panel head:

```vue
<div class="tp-panel-head">
  <div class="tp-head-text">
    <TemplateNameEditor />
    <div class="tp-head-sub">v{{ store.template.meta.version }} · 草稿已保存</div>
  </div>
</div>
```

Import `TemplateNameEditor` at top of `DesignerView.vue`.

---

## § B · Slider double-click → number input (#3)

New reusable component `apps/web/src/designer/SliderWithInput.vue`:

```vue
<script setup lang="ts">
import { nextTick, ref } from 'vue';

const props = defineProps<{
  modelValue: number;
  min: number;
  max: number;
  step?: number;
  format?: (v: number) => string;  // optional formatter for the right-side display
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
  nextTick(() => {
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

const display = (v: number) => (props.format ? props.format(v) : String(v));
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
      type="number"
      class="swi-num"
      v-model="draft"
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
.swi {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
}
.swi-range {
  flex: 1;
  accent-color: var(--tp-accent);
  height: 4px;
  cursor: pointer;
}
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
  width: 56px;
  font-size: 11px;
  padding: 1px 4px;
  border: 1px solid var(--tp-accent);
  border-radius: 3px;
  font-family: ui-monospace, monospace;
  text-align: right;
  background: var(--tp-panel);
  outline: none;
}
.swi-num::-webkit-outer-spin-button,
.swi-num::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}
</style>
```

### B.1 Migrate existing sliders

Replace each `<input type="range">` + display-span pair with `<SliderWithInput>`:

**`BorderControl.vue`** — width slider:
```vue
<SliderWithInput
  :model-value="currentWidth()"
  :min="1" :max="8" :step="1"
  :format="(v: number) => v + ' px'"
  @update:model-value="(v: number) => patchAllSides({ width: v })"
/>
```

**`PropertyPanel.vue`** advanced section — rotation:
```vue
<SliderWithInput
  :model-value="sel.style.rotation ?? 0"
  :min="-180" :max="180" :step="1"
  :format="(v: number) => v + '°'"
  @update:model-value="(v: number) => updateStyle({ rotation: v })"
/>
```

**`PropertyPanel.vue`** advanced section — opacity:
```vue
<SliderWithInput
  :model-value="Math.round((sel.style.opacity ?? 1) * 100)"
  :min="0" :max="100" :step="1"
  :format="(v: number) => v + '%'"
  @update:model-value="(v: number) => updateStyle({ opacity: v / 100 })"
/>
```

**`BarcodeProperties.vue`** + **`QrProperties.vue`** (from iter 5) — quietZone:
```vue
<SliderWithInput
  :model-value="props.element.quietZone ?? 2"
  :min="0" :max="8" :step="1"
  @update:model-value="(v: number) => update({ quietZone: v })"
/>
```

Existing `.slider` raw `<input type="range">` markup gets fully removed.

---

## § C · Font weight labels (#4)

In `PropertyPanel.vue`'s text-weight `<select>`:

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

(Drops the trailing numeric annotations.)

---

## § D · PropertyPanel universal style audit (#7)

### D.1 Audit findings

Style fields currently gated on `isTextish(sel)` that should be universal:

| Field | Current placement | Audit |
|---|---|---|
| color | 基础 (text-only) | ✓ Correctly text-only |
| fontSize / fontWeight / textAlign | 基础 (text-only) | ✓ Correctly text-only |
| fontFamily / letterSpacing / lineHeight / textDecoration / verticalAlign / textOverflow | 高级 (text-only) | ✓ Correctly text-only |
| **backgroundColor** | 高级 (text-only) | 🔧 Universal — rect / image / barcode / qr all benefit |
| **zIndex** | 高级 (text-only) | 🔧 Universal — layer ordering matters for all |
| **rotation** | 高级 (text-only) | 🔧 Universal — image rotation, watermark stamps |
| **opacity** | 高级 (text-only) | 🔧 Universal — watermarks |

### D.2 Restructure

Split the "样式 · 高级" block into two siblings:

**样式 · 高级** (existing block, still gated on `isTextish(sel)`):
- 字体 / 字间距 / 行高 / 装饰 / 垂直对齐 / 溢出

**布局 · 高级** (new block, gated on `sel != null` — visible for ALL element types):
- 背景色 (backgroundColor)
- 层级 z (zIndex)
- 旋转 (rotation) — uses `<SliderWithInput>` from §B
- 透明度 (opacity) — uses `<SliderWithInput>` from §B

Both blocks share `advancedOpen` collapse state (one click toggles both). Title for the universal block:

```vue
<div class="style-block">
  <div class="style-title sclickable" @click="advancedOpen = !advancedOpen">
    布局 · 高级 <span class="caret">{{ advancedOpen ? '▾' : '▸' }}</span>
  </div>
  <div v-if="advancedOpen">
    <!-- backgroundColor / zIndex / rotation / opacity rows -->
  </div>
</div>
```

The existing "样式 · 高级" block keeps its `v-if="isTextish(sel)"` and uses the same `advancedOpen` ref.

### D.3 Known limitations (acknowledged, NOT fixed this iteration)

- `rotation` only rotates the inner renderer div. Outer `.tp-element` (selection border, grip, handles) stays axis-aligned. Cost of synchronising too high.
- `textOverflow: ellipsis` may conflict with non-top vertical-align + padding combos. Edge case, leave as-is.

---

## § E · Lucide icon migration (#9)

### E.1 Install

```bash
pnpm --filter @template-printing/web add lucide-vue-next
```

### E.2 Icon mapping table

| Place | Old | Lucide component |
|---|---|---|
| Element library — Text | `T` (monospace) | `Type` |
| Element library — Field/字段 | `{}` | `Braces` |
| Element library — Autonumber/编号 | `№` | `Hash` |
| Element library — System/系统 | `#` | `Clock` |
| Element library — Rect/矩形 | `▢` | `Square` |
| Element library — Image/图片 | `▤` | `Image` |
| Element library — Table/明细 | `▦` | `Table` |
| Element library — QR/二维码 | `▣` | `QrCode` ⭐ (variant A — Lucide official) |
| Element library — Barcode/条码 | `|||` | `Barcode` |
| Toolbar — back | `←` | `ArrowLeft` |
| Toolbar — undo | `↶` | `Undo2` |
| Toolbar — redo | `↷` | `Redo2` |
| Toolbar — paper | `📄` | `FileText` |
| Toolbar — cell | `⊞` | `Grid3x3` |
| Toolbar — rotate | `⤴` | `RotateCw` |
| Toolbar — zoom | `🔍` | `ZoomIn` |
| Toolbar — preview | `👁` | `Eye` |
| Toolbar — save | (text) | `Save` |
| Toolbar — print | `🖨` | `Printer` |
| Toolbar — custom paper add | `⊕` | `Plus` (with text "自定义…") |
| FieldManager — add | `+` | `Plus` |
| FieldManager — edit (iter 5) | `✎` | `Pencil` |
| FieldManager — delete | `×` | `Trash2` |
| CanvasElementsList — clear | text "清空" | `Trash2` + text |
| CanvasElementsList — row delete | `×` | `X` |
| PropertyPanel — delete element | text "删除元素" | `Trash2` + text |

The "QR official Lucide" reference (variant A from the demo `docs/demos/07-qr-icon-variants.html`):

```vue
<QrCode :size="22" :stroke-width="2" />
```

### E.3 Usage pattern in Vue

```vue
<script setup lang="ts">
// eslint-disable-next-line import/no-unresolved
import { Type, Braces, Hash, Clock, /* etc */ } from 'lucide-vue-next';
</script>

<template>
  <button class="lib-btn">
    <Type :size="22" :stroke-width="2" />
    <span>文字</span>
  </button>
</template>
```

The components inherit `currentColor` for stroke, so `color: var(--tp-accent)` on the parent button colors the icon purple on hover automatically — matches existing CSS.

### E.4 Icon usage sizes

| Context | Size |
|---|---|
| Library button glyph | 22 |
| Toolbar `.tt-btn` icon | 16 |
| Field-card action button | 14 |
| CanvasElement size badge — no icon | — |
| PropertyPanel section labels — no icons (only text) | — |
| Empty-state placeholders | 32 |

`stroke-width=2` everywhere — matches Lucide's intended default and Tabler-equivalent visual weight.

### E.5 elementFactory `glyph` field cleanup

`ElementMeta.glyph` is currently a unicode/monospace character used in `<span class="lib-glyph">`. This becomes redundant. Two options:

- **Option A (recommended)**: drop `glyph` from `ElementMeta`. Each library button picks the icon by `meta.type` directly via a switch / map.
- Option B: keep `glyph` as the imported Lucide component reference. More dynamic but adds type complexity.

We go with Option A. Add to ElementLibrary.vue:

```ts
import { Type, Braces, Hash, Clock, Square, Image, Table, QrCode, Barcode } from 'lucide-vue-next';

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
```

Template:

```vue
<button v-for="item in items" :key="item.label" class="lib-btn" ...>
  <component :is="iconFor[item.type]" :size="22" :stroke-width="2" />
  <span>{{ item.label }}</span>
</button>
```

CanvasElementsList uses the same mapping (just at `:size="14"`).

### E.6 Old monospace glyph CSS

Delete `.lib-glyph { font-family: ui-monospace, monospace; ... }` from `ElementLibrary.vue` scoped CSS.
Delete `.elem-icon { font-family: ui-monospace, monospace; ... }` from `CanvasElementsList.vue` — replace with simpler centering CSS:

```css
.elem-icon {
  flex-shrink: 0;
  width: 22px;
  height: 22px;
  border-radius: 5px;
  background: var(--tp-field-bg);
  color: var(--tp-accent);
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
```

(The `font-family` / `font-weight` props become irrelevant since the icon is an SVG.)

---

## Out of scope

- Icon library "theming" (Lucide stroke-width is 2 across the app; advanced per-icon theming not needed).
- Custom QR icon design beyond Lucide's official one.
- Smart binding suggestion (B option from iter 5 — manual selection — stays).
- Renaming schema/store internal names (`fieldDefs`, `addField`, etc.).
- Rotation-aware selection border (acknowledged limitation in §D.3).

## Acceptance checklist

- [ ] `画布元素 · 共 N 个` sub-head shows `清空` button when N>0; click → confirm → all cleared.
- [ ] Unused field card has warm-yellow background, no `未使用` text tag.
- [ ] Element library sub-title reads `元素组件`.
- [ ] Variable panel sub-title reads `变量 · 共 N 个`.
- [ ] textAlign segmented buttons show `左 / 中 / 右 / 两端`.
- [ ] Template name in left panel head is clickable → becomes inline input → blur/Enter commits.
- [ ] Border-width / rotation / opacity / quietZone sliders all show the right-side numeric label; double-click → number input → Enter commits.
- [ ] Font weight `<select>` shows `偏细 / 常规 / 加粗 / 特粗` (no numbers).
- [ ] Rect element selected → 布局·高级 section visible with backgroundColor / zIndex / rotation / opacity controls; 样式·高级 (text-only) hidden.
- [ ] Text element selected → both 样式·高级 (text) and 布局·高级 (universal) visible.
- [ ] Element library buttons render Lucide icons (Type/Braces/Hash/Clock/Square/Image/Table/QrCode/Barcode) at 22px stroke 2.
- [ ] Toolbar shows Lucide icons consistently (ArrowLeft / Undo2 / Redo2 / FileText / Grid3x3 / RotateCw / ZoomIn / Eye / Save / Printer).
- [ ] FieldManager add/edit/delete use Plus / Pencil / Trash2 at 14px.
- [ ] CanvasElementsList row delete uses `X` at 14px.
