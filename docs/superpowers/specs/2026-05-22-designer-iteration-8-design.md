# Designer Iteration 8 — Design Spec

**Date:** 2026-05-22 (after iteration 7)
**Status:** Approved (brainstorming)

8 issues raised after iter 7, grouped into 4 batches.

| Batch | Topic | Items |
|---|---|---|
| § A | Bug fixes | #1 preview overflow no scrollbar, #2 grip clipped at paper edge, #6 advanced sections share toggle, #7 custom paper dialog still broken |
| § B | UI tweaks | #3 small-element grip threshold, #4 variables 3-row default + always-show search |
| § C | Table columns editor | #5 detail-list column edit UI |
| § D | Alignment guides | #8 snap-to-edge + snap-to-center + distance labels (scenarios 1-3, MVP) |

---

## § A · Bug fixes (#1 #2 #6 #7)

### A.1 Preview scrollbar when zoomed (#1)

**Root cause**: `.pv-paper-wrap` uses `transform: scale(zoom)` to render the paper at the requested zoom. CSS transforms **do not affect layout box dimensions** — the wrapper still reports its un-scaled size to the parent. The `.pv-container { overflow: auto }` sees the un-scaled size, no scrollbar needed (from its POV), even when the visually-scaled paper exceeds the viewport.

**Fix**: split the responsibility — give the WRAPPER the scaled layout size while applying `transform: scale()` to its inner child:

`apps/web/src/views/PreviewView.vue` — adjust the two computed styles:

```ts
const paperWrapStyle = computed(() => ({
  width:  `${store.paperPx.w * previewZoom.value}px`,
  height: `${store.paperPx.h * previewZoom.value}px`,
  position: 'relative' as const,
}));

const paperStyle = computed(() => ({
  width:  `${store.paperPx.w}px`,
  height: `${store.paperPx.h}px`,
  transform: `scale(${previewZoom.value})`,
  transformOrigin: 'top left',
  background: '#fff',
}));
```

`.pv-paper-wrap` now has layout dimensions equal to the scaled paper; `.pv-container { overflow: auto }` correctly grows scrollbars when zoom > fit.

Keep the existing `.pv-wrap { overflow: hidden }` for the OUTER wrapper (which clips the absolute-positioned zoom control) — this is unchanged.

### A.2 Outside-grip clipped at paper edge (#2)

**Root cause**: when an element sits flush against the paper top (`anchor.y ≈ 0`), the outside-grip pill at `top: -28px` overflows the paper and gets clipped by `.tp-canvas-area { overflow: auto }`.

**Fix**: extend the `isSmall`-style threshold in `CanvasElement.vue` to **also auto-switch to inside-grip when the element is too close to the paper top**:

```ts
const isNearTop = computed(() => {
  // anchor.y in mm; 8 mm safely fits the outside pill (28 px ≈ 7 mm) + margin.
  return props.element.anchor.y < 8;
});

const useInsideGrip = computed(() => {
  // Use inside grip when element is too short, too narrow, OR too close to top.
  if (props.element.grid.rs < 6) return true;
  if (props.element.grid.cs < 8) return true;       // covered by §B.1 below
  if (isNearTop.value) return true;
  return false;
});
```

Then update the grip mount in CanvasElement.vue's template:

```vue
<ElementGrip v-if="isSelected" :is-small="!useInsideGrip" @pointerdown="onGripDown" />
```

Note `:is-small` semantics in ElementGrip.vue (from iter 6): `isSmall=true` → outside pill; `isSmall=false` → inside dots. We pass `!useInsideGrip` so:
- `useInsideGrip = true` → `isSmall = false` → inside dots
- `useInsideGrip = false` (i.e., large element, not near top) → `isSmall = true` → outside pill

Drop the iter 6 `isSmall` computed in CanvasElement.vue and use this new `useInsideGrip` exclusively. The naming is clearer.

### A.3 Advanced sections expand independently (#6)

**Root cause**: iter 6's PropertyPanel reused a single `advancedOpen` ref to gate BOTH `样式 · 高级` (text styling) and `布局 · 高级` (universal layout). Clicking one toggles both.

**Fix**: split into two refs in `PropertyPanel.vue` `<script setup>`:

```ts
const styleAdvOpen = ref(false);
const layoutAdvOpen = ref(false);
```

Remove the old `const advancedOpen = ref(false);` declaration.

Update each section title + body:

```vue
<!-- 样式 · 高级 -->
<div v-if="isTextish(sel)" class="style-block">
  <div class="style-title sclickable" @click="styleAdvOpen = !styleAdvOpen">
    样式 · 高级 <span class="caret">{{ styleAdvOpen ? '▾' : '▸' }}</span>
  </div>
  <div v-if="styleAdvOpen">
    <!-- font/letterSpacing/lineHeight/textDecoration/verticalAlign/textOverflow rows unchanged -->
  </div>
</div>

<!-- 布局 · 高级 -->
<div v-if="sel" class="style-block">
  <div class="style-title sclickable" @click="layoutAdvOpen = !layoutAdvOpen">
    布局 · 高级 <span class="caret">{{ layoutAdvOpen ? '▾' : '▸' }}</span>
  </div>
  <div v-if="layoutAdvOpen">
    <!-- backgroundColor/zIndex/rotation/opacity rows unchanged -->
  </div>
</div>
```

Each section now toggles independently.

### A.4 Custom paper dialog still unresponsive (#7)

**Symptom**: clicking `⊕ 自定义…` darkens the toolbar (modal overlay shows) but no dialog body is visible. Iter 7 already relaxed `canConfirm` — that fix landed, but the click → open chain itself is broken.

**Investigation strategy** (impl phase):

Add temporary debug logs to find the broken hop:

```ts
// In DesignerHeader.vue:
function openCustomDialog(): void {
  console.log('[Header] custom paper click; customDialogOpen ->', true);
  customDialogOpen.value = true;
}
```

Change the ElDropdownItem trigger from inline assignment to the method:

```vue
<ElDropdownItem divided @click="openCustomDialog">
  <Plus :size="14" :stroke-width="2" style="margin-right: 6px" />
  自定义…
</ElDropdownItem>
```

```ts
// In CustomPaperDialog.vue:
watch(() => props.modelValue, (v) => {
  console.log('[CustomPaperDialog] modelValue ->', v);
}, { immediate: true });
```

Open browser → click ⊕ → check console:

- If `[Header]` logs fire but `[CustomPaperDialog]` doesn't: v-model binding is broken on the header side.
- If both fire: dialog opens but renders empty / off-screen — likely a CSS or content issue.
- If neither fires: ElDropdownItem click handler is being intercepted.

**Fix candidates**:

1. The most likely cause is the ElDialog needs `:append-to-body="true"` or `:teleported="true"` to render correctly when the trigger is itself inside another teleported ElDropdown:

```vue
<ElDialog
  :model-value="props.modelValue"
  @update:model-value="(v: boolean) => emit('update:modelValue', v)"
  title="自定义画布"
  width="420px"
  align-center
  :append-to-body="true"
  :z-index="3000"
>
```

The `:append-to-body` flag teleports the dialog into `<body>`, breaking it free of any ancestor positioning issues. `align-center` centres vertically. `:z-index="3000"` ensures it renders above the toolbar overlay.

2. Verify the dialog body has actual content rendered. If the template was preserved correctly from iter 2 / iter 7, the form should render. If the body is empty, check that the inputs / preview computed are not crashing on initial mount.

3. Remove the temporary `console.log` calls before committing.

### Acceptance — § A

- Preview at 200% zoom on a small paper → vertical and horizontal scrollbars appear; can scroll to see all corners.
- Drop an element flush against the paper top → outside grip pill is NOT clipped; element auto-uses inside grip dots instead.
- Click `样式 · 高级` title → only the style section toggles. Click `布局 · 高级` title → only the layout section toggles.
- Click `⊕ 自定义…` → dialog opens centred, with all inputs visible. Type w=200, h=150 → confirm → paper changes.

---

## § B · UI tweaks (#3 #4)

### B.1 Small-element grip threshold (#3)

Already covered in §A.2 via `useInsideGrip`. The threshold now considers:

```ts
if (props.element.grid.rs < 6) return true;   // too short
if (props.element.grid.cs < 8) return true;   // too narrow (NEW for #3)
if (isNearTop.value) return true;             // too close to paper top (§A.2)
```

`cs < 8` ensures elements narrower than ~32 px (at cell=4) don't get an inside grip whose dots would collide with the corner handles.

This is **NOT a separate task** — bundled with §A.2.

### B.2 Variables — default 3 rows + always-show search (#4)

`apps/web/src/designer/FieldManager.vue`:

**a) Always show search bar**: remove the `v-if="store.fieldDefs.length > 5"` guard:

```vue
<div class="fm-search">
  <Search :size="13" :stroke-width="2" />
  <input
    type="text"
    v-model="searchQuery"
    placeholder="搜索变量名或显示名…"
  />
</div>
```

**b) Default body height = 3 cards**: cap `.fm-body` max-height so >3 fields scroll:

```css
.fm-body {
  flex: 1;
  overflow-y: auto;
  padding: 8px 10px 12px;
  max-height: 200px;        /* ~ 3 cards * 60px + padding */
}
```

If `flex: 1` and `max-height` conflict (parent flex grows the body), use only `max-height` without `flex: 1`. Test in browser — drop one approach if it doesn't visually behave.

---

## § C · Table columns editor (#5)

Detail-list elements have a `columns` array on the schema but no UI to edit it. Reference vue-plugin-hiprint: a sub-list with one row per column (key / header / width / align) + add / remove buttons.

### C.1 New component `TableColumnsEditor.vue`

`apps/web/src/designer/TableColumnsEditor.vue`:

```vue
<script setup lang="ts">
// eslint-disable-next-line import/no-unresolved
import { ElButton, ElInput, ElOption, ElSelect } from 'element-plus';
// eslint-disable-next-line import/no-unresolved
import { Plus, Trash2, ChevronUp, ChevronDown } from 'lucide-vue-next';

interface ColumnLike {
  key: string;
  header: string;
  cs: number;
  align: 'left' | 'center' | 'right';
  format: string | null;
}

const props = defineProps<{ columns: ColumnLike[] }>();
const emit = defineEmits<{ (e: 'update', cols: ColumnLike[]): void }>();

function patchAt(i: number, patch: Partial<ColumnLike>): void {
  const next = props.columns.map((c, idx) => (idx === i ? { ...c, ...patch } : c));
  emit('update', next);
}

function removeAt(i: number): void {
  emit('update', props.columns.filter((_, idx) => idx !== i));
}

function moveUp(i: number): void {
  if (i === 0) return;
  const next = [...props.columns];
  [next[i - 1], next[i]] = [next[i], next[i - 1]];
  emit('update', next);
}

function moveDown(i: number): void {
  if (i === props.columns.length - 1) return;
  const next = [...props.columns];
  [next[i], next[i + 1]] = [next[i + 1], next[i]];
  emit('update', next);
}

function addColumn(): void {
  const idx = props.columns.length + 1;
  emit('update', [
    ...props.columns,
    { key: `col${idx}`, header: `列${idx}`, cs: 30, align: 'left', format: null },
  ]);
}
</script>

<template>
  <div class="tc-block">
    <div class="tc-title">列管理</div>

    <div class="tc-list">
      <div v-for="(col, i) in props.columns" :key="i" class="tc-row">
        <ElInput
          :model-value="col.key"
          size="small"
          placeholder="key"
          style="width: 70px"
          @update:model-value="(v: string) => patchAt(i, { key: v })"
        />
        <ElInput
          :model-value="col.header"
          size="small"
          placeholder="表头"
          style="width: 80px"
          @update:model-value="(v: string) => patchAt(i, { header: v })"
        />
        <ElInput
          :model-value="String(col.cs)"
          size="small"
          placeholder="宽度"
          style="width: 50px"
          @update:model-value="(v: string) => patchAt(i, { cs: Math.max(1, parseInt(v, 10) || 1) })"
        />
        <ElSelect
          :model-value="col.align"
          size="small"
          style="width: 64px"
          @change="(v: 'left' | 'center' | 'right') => patchAt(i, { align: v })"
        >
          <ElOption value="left" label="左" />
          <ElOption value="center" label="中" />
          <ElOption value="right" label="右" />
        </ElSelect>
        <div class="tc-actions">
          <button class="tc-mv" @click="moveUp(i)" :disabled="i === 0" title="上移">
            <ChevronUp :size="13" :stroke-width="2" />
          </button>
          <button class="tc-mv" @click="moveDown(i)" :disabled="i === props.columns.length - 1" title="下移">
            <ChevronDown :size="13" :stroke-width="2" />
          </button>
          <button class="tc-del" @click="removeAt(i)" title="删除">
            <Trash2 :size="13" :stroke-width="2" />
          </button>
        </div>
      </div>
    </div>

    <ElButton link style="margin-top: 8px" @click="addColumn">
      <Plus :size="14" :stroke-width="2" style="margin-right: 4px" />
      添加列
    </ElButton>
  </div>
</template>

<style scoped>
.tc-block { padding: 12px 14px; border-bottom: 1px solid var(--tp-line); }
.tc-title {
  font-size: 11px; font-weight: 600;
  color: var(--tp-ink-soft);
  letter-spacing: 0.06em; text-transform: uppercase;
  margin-bottom: 8px;
}
.tc-list { display: flex; flex-direction: column; gap: 4px; }
.tc-row { display: flex; align-items: center; gap: 4px; }
.tc-actions { display: inline-flex; gap: 2px; }
.tc-actions button {
  border: none;
  background: transparent;
  width: 22px;
  height: 22px;
  border-radius: 4px;
  cursor: pointer;
  color: var(--tp-ink-faint);
  display: inline-flex; align-items: center; justify-content: center;
}
.tc-actions button:hover { background: var(--tp-field-bg); color: var(--tp-accent-ink); }
.tc-actions button:disabled { opacity: 0.4; cursor: not-allowed; }
.tc-actions .tc-del:hover { background: rgba(217, 79, 79, 0.1); color: #d94f4f; }
</style>
```

### C.2 Mount in PropertyPanel

In `apps/web/src/designer/PropertyPanel.vue`:

Add import:

```ts
import TableColumnsEditor from './TableColumnsEditor.vue';
```

In `<template>`, after the table binding row (which already exists for `sel.type === 'table'`) and BEFORE `<BorderControl>`, add:

```vue
<TableColumnsEditor
  v-if="sel && sel.type === 'table'"
  :columns="sel.columns"
  @update="(cols: TableColumn[]) => store.updateElement(sel!.id, { columns: cols } as Partial<TemplateElement>)"
/>

<div v-if="sel && sel.type === 'table'" class="row">
  <span class="lbl">行高</span>
  <input
    type="number"
    min="2" max="20" step="1"
    :value="sel.rowHeight"
    class="snum"
    @input="(e: Event) => store.updateElement(sel!.id, { rowHeight: Math.max(2, Number((e.target as HTMLInputElement).value)) } as Partial<TemplateElement>)"
  />
  <span class="sval">cell</span>
</div>

<div v-if="sel && sel.type === 'table'" class="row">
  <span class="lbl">表头</span>
  <input
    type="checkbox"
    :checked="sel.showHeader"
    @change="(e: Event) => store.updateElement(sel!.id, { showHeader: (e.target as HTMLInputElement).checked } as Partial<TemplateElement>)"
  />
</div>
```

(Import `TableColumn` type from `@template-printing/schema` if needed; it's `z.infer<typeof TableColumnSchema>`. If not exported, infer the shape inline as the props/emit types use.)

### Acceptance — § C

- Drop a 明细 element → PropertyPanel shows `列管理` section with the 2 default columns (col1, col2).
- Click `+ 添加列` → a new row appears with `col3 / 列3 / 30 / 左`.
- Click ↑ / ↓ → row order changes.
- Click 🗑 → row removed.
- Edit key / header / 宽度 / 对齐 → changes reflect in store immediately.
- 行高 / 表头 inputs work.

---

## § D · Alignment guides (#8) — MVP scenarios 1+2+3

Reference: `docs/demos/08-snap-guides.html` (already committed). MVP = scenarios 1 (edge align), 2 (center align including paper-centre), 3 (distance labels). Scenario 4 (equal spacing) deferred.

### D.1 Store state

`apps/web/src/stores/designer.ts`:

```ts
// Add to state:
guides: {
  v: [] as number[],     // x-positions in mm where vertical guides should render
  h: [] as number[],     // y-positions in mm
  distLabels: [] as Array<{
    kind: 'h' | 'v';
    a: number;            // start position (mm, paper-relative)
    b: number;            // end position (mm)
    crossAxis: number;    // perpendicular axis position (mm)
    value: number;        // distance in mm
  }>,
},

// Add action:
setGuides(g: { v: number[]; h: number[]; distLabels: ... }): void {
  this.guides = g;
},
clearGuides(): void {
  this.guides = { v: [], h: [], distLabels: [] };
},
```

Not persisted (transient). Snapshot ignores `guides`.

### D.2 Snap detection algorithm

`apps/web/src/designer/usePointerDrag.ts` integrates snap detection into `onGripDown` (move) and `onResizeDown` (resize). Add a helper module first:

**Create** `apps/web/src/designer/snapGuides.ts`:

```ts
// eslint-disable-next-line import/no-unresolved
import type { TemplateElement } from '@template-printing/schema';

export interface SnapInput {
  target: { x: number; y: number; w: number; h: number };  // mm, paper-relative
  others: Array<{ x: number; y: number; w: number; h: number }>;
  paper: { w: number; h: number };  // mm
  threshold: number;                  // mm (e.g., 1.5 mm ≈ 6 px at 4 px/mm)
}

export interface SnapResult {
  snapped: { x: number; y: number };
  guides: {
    v: number[];      // x-positions
    h: number[];      // y-positions
    distLabels: Array<{ kind: 'h' | 'v'; a: number; b: number; crossAxis: number; value: number }>;
  };
}

interface Line { pos: number; from: number; to: number }   // pos = the line; from/to = the orthogonal extent

function targetLines(t: SnapInput['target']): { v: Line[]; h: Line[] } {
  return {
    v: [
      { pos: t.x,             from: t.y, to: t.y + t.h }, // left
      { pos: t.x + t.w / 2,   from: t.y, to: t.y + t.h }, // h-center
      { pos: t.x + t.w,       from: t.y, to: t.y + t.h }, // right
    ],
    h: [
      { pos: t.y,             from: t.x, to: t.x + t.w }, // top
      { pos: t.y + t.h / 2,   from: t.x, to: t.x + t.w }, // v-center
      { pos: t.y + t.h,       from: t.x, to: t.x + t.w }, // bottom
    ],
  };
}

function candidateLines(others: SnapInput['others'], paper: SnapInput['paper']): { v: number[]; h: number[] } {
  const v: number[] = [0, paper.w / 2, paper.w];
  const h: number[] = [0, paper.h / 2, paper.h];
  for (const o of others) {
    v.push(o.x, o.x + o.w / 2, o.x + o.w);
    h.push(o.y, o.y + o.h / 2, o.y + o.h);
  }
  return { v, h };
}

export function computeSnap(input: SnapInput): SnapResult {
  const t = targetLines(input.target);
  const c = candidateLines(input.others, input.paper);
  const th = input.threshold;

  let snapDx = 0;
  let snapDy = 0;
  const hitV: number[] = [];   // x-positions of vertical guides actually hit
  const hitH: number[] = [];

  // Vertical alignment (snaps x)
  let bestV: { delta: number; pos: number; abs: number } | null = null;
  for (const tl of t.v) {
    for (const cl of c.v) {
      const delta = cl - tl.pos;
      const abs = Math.abs(delta);
      if (abs <= th && (bestV === null || abs < bestV.abs)) {
        bestV = { delta, pos: cl, abs };
      }
    }
  }
  if (bestV) {
    snapDx = bestV.delta;
    // Also collect all guides at this position (multi-hit when 2 elements share an edge)
    for (const tl of t.v) {
      const target = tl.pos + snapDx;
      for (const cl of c.v) {
        if (Math.abs(cl - target) < 0.001) hitV.push(cl);
      }
    }
  }

  // Horizontal alignment (snaps y)
  let bestH: { delta: number; pos: number; abs: number } | null = null;
  for (const tl of t.h) {
    for (const cl of c.h) {
      const delta = cl - tl.pos;
      const abs = Math.abs(delta);
      if (abs <= th && (bestH === null || abs < bestH.abs)) {
        bestH = { delta, pos: cl, abs };
      }
    }
  }
  if (bestH) {
    snapDy = bestH.delta;
    for (const tl of t.h) {
      const target = tl.pos + snapDy;
      for (const cl of c.h) {
        if (Math.abs(cl - target) < 0.001) hitH.push(cl);
      }
    }
  }

  // Distance labels — find the nearest non-zero gap to the closest other element
  // along each axis. Show label only when target is near another element (gap < 30 mm).
  const distLabels: SnapResult['guides']['distLabels'] = [];
  const tAfterSnap = {
    x: input.target.x + snapDx,
    y: input.target.y + snapDy,
    w: input.target.w,
    h: input.target.h,
  };
  for (const o of input.others) {
    // Horizontal gap (when y ranges overlap)
    const yOverlap = !(o.y + o.h <= tAfterSnap.y || o.y >= tAfterSnap.y + tAfterSnap.h);
    if (yOverlap) {
      const targetLeft  = tAfterSnap.x;
      const targetRight = tAfterSnap.x + tAfterSnap.w;
      const otherLeft   = o.x;
      const otherRight  = o.x + o.w;
      if (otherRight <= targetLeft) {
        const gap = targetLeft - otherRight;
        if (gap > 0.1 && gap < 30) {
          distLabels.push({
            kind: 'h',
            a: otherRight,
            b: targetLeft,
            crossAxis: Math.max(o.y, tAfterSnap.y) + Math.min(o.h, tAfterSnap.h) / 2,
            value: gap,
          });
        }
      } else if (otherLeft >= targetRight) {
        const gap = otherLeft - targetRight;
        if (gap > 0.1 && gap < 30) {
          distLabels.push({
            kind: 'h',
            a: targetRight,
            b: otherLeft,
            crossAxis: Math.max(o.y, tAfterSnap.y) + Math.min(o.h, tAfterSnap.h) / 2,
            value: gap,
          });
        }
      }
    }
    // Vertical gap
    const xOverlap = !(o.x + o.w <= tAfterSnap.x || o.x >= tAfterSnap.x + tAfterSnap.w);
    if (xOverlap) {
      const targetTop    = tAfterSnap.y;
      const targetBottom = tAfterSnap.y + tAfterSnap.h;
      const otherTop     = o.y;
      const otherBottom  = o.y + o.h;
      if (otherBottom <= targetTop) {
        const gap = targetTop - otherBottom;
        if (gap > 0.1 && gap < 30) {
          distLabels.push({
            kind: 'v',
            a: otherBottom,
            b: targetTop,
            crossAxis: Math.max(o.x, tAfterSnap.x) + Math.min(o.w, tAfterSnap.w) / 2,
            value: gap,
          });
        }
      } else if (otherTop >= targetBottom) {
        const gap = otherTop - targetBottom;
        if (gap > 0.1 && gap < 30) {
          distLabels.push({
            kind: 'v',
            a: targetBottom,
            b: otherTop,
            crossAxis: Math.max(o.x, tAfterSnap.x) + Math.min(o.w, tAfterSnap.w) / 2,
            value: gap,
          });
        }
      }
    }
  }

  // Only keep the nearest 2 distance labels (don't spam)
  distLabels.sort((a, b) => a.value - b.value);
  const trimmedLabels = distLabels.slice(0, 2);

  return {
    snapped: {
      x: tAfterSnap.x,
      y: tAfterSnap.y,
    },
    guides: {
      v: [...new Set(hitV)],
      h: [...new Set(hitH)],
      distLabels: trimmedLabels,
    },
  };
}
```

### D.3 Wire into usePointerDrag

In `apps/web/src/designer/usePointerDrag.ts`, modify `onGripDown` → `onMove`:

```ts
import { computeSnap } from './snapGuides';

const SNAP_THRESHOLD_MM = 1.5;

function onMove(ev: PointerEvent): void {
  lastDx = ev.clientX - startX;
  lastDy = ev.clientY - startY;

  // Convert raw px delta to mm
  const dxMm = lastDx / (PX_PER_MM * store.view.zoom);
  const dyMm = lastDy / (PX_PER_MM * store.view.zoom);

  // Candidate snap input (target = current anchor + delta, others = all OTHER elements)
  const el = getElement();
  if (!el) return;
  const targetMm = {
    x: el.anchor.x + dxMm,
    y: el.anchor.y + dyMm,
    w: el.anchor.w,
    h: el.anchor.h,
  };
  const others = store.template.elements
    .filter((e) => e.id !== elementId)
    .map((e) => ({ x: e.anchor.x, y: e.anchor.y, w: e.anchor.w, h: e.anchor.h }));
  const paperMmW = store.paperPx.w / PX_PER_MM;
  const paperMmH = store.paperPx.h / PX_PER_MM;

  const snap = computeSnap({
    target: targetMm,
    others,
    paper: { w: paperMmW, h: paperMmH },
    threshold: ev.altKey ? 0 : SNAP_THRESHOLD_MM,  // Alt disables snap
  });

  store.setGuides(snap.guides);

  // Apply snapped delta as a transform offset (still smooth-drag pattern from iter 2)
  const snappedDxPx = (snap.snapped.x - el.anchor.x) * PX_PER_MM * store.view.zoom;
  const snappedDyPx = (snap.snapped.y - el.anchor.y) * PX_PER_MM * store.view.zoom;
  dom!.style.transform = `translate(${snappedDxPx}px, ${snappedDyPx}px)`;

  // Remember the snapped position so onUp uses it instead of raw cursor
  lastSnappedX = snap.snapped.x;
  lastSnappedY = snap.snapped.y;
}

function onUp(): void {
  window.removeEventListener('pointermove', onMove);
  window.removeEventListener('pointerup', onUp);
  store.clearGuides();          // hide all guides on release

  // Use snapped position (if any) — round to cell grid as before
  const z = store.view.zoom;
  const cell = store.template.canvas.cell;
  const finalDxMm = lastSnappedX - el.anchor.x;
  const finalDyMm = lastSnappedY - el.anchor.y;
  // ... existing logic computes newC, newR from cell-rounding, applies residue, etc.
  // The diff: instead of computing dc from raw lastDx, compute from finalDxMm:
  const dc = Math.round((finalDxMm * PX_PER_MM) / cell.w);
  const dr = Math.round((finalDyMm * PX_PER_MM) / cell.h);
  // ... rest of existing onUp body
}
```

Initialize `lastSnappedX` / `lastSnappedY` at the top of `onGripDown`:

```ts
let lastSnappedX = el.anchor.x;
let lastSnappedY = el.anchor.y;
```

For resize, the same idea but applied to the relevant edges (not all 4). MVP **only applies snap to move** (`onGripDown`), not resize — keeps complexity manageable. Resize snap-to-cell stays as-is.

### D.4 Render guides

`apps/web/src/designer/DesignerCanvas.vue` — overlay an SVG inside `.tp-paper`:

```vue
<template>
  <div class="tp-canvas-area" ref="canvasAreaRef">
    <div
      ref="paperRef"
      class="tp-paper"
      :class="{
        'is-dragging': store.isResizing,
        'is-drop-target': isDropTarget,
        heavy: store.template.elements.length > 500,
      }"
      :style="{
        ...cssVars,
        width: 'var(--canvas-w)',
        height: 'var(--canvas-h)',
      }"
      @click="clickPaperBackground"
      @dragover="onDragOver"
      @dragleave="onDragLeave"
      @drop="onDrop"
    >
      <CanvasElement v-for="el in store.template.elements" :key="el.id" :element="el" />
      <SnapGuides v-if="store.isResizing" :guides="store.guides" />
    </div>
  </div>
</template>
```

Create **`apps/web/src/designer/SnapGuides.vue`**:

```vue
<script setup lang="ts">
import { computed } from 'vue';
import { useDesignerStore } from '../stores/designer';

interface Guides {
  v: number[];
  h: number[];
  distLabels: Array<{ kind: 'h' | 'v'; a: number; b: number; crossAxis: number; value: number }>;
}

const props = defineProps<{ guides: Guides }>();
const store = useDesignerStore();

const PX_PER_MM = 4;

function mmToCanvasPx(mm: number): number {
  return mm * PX_PER_MM * store.view.zoom;
}

const verticalLines = computed(() =>
  props.guides.v.map((mmX) => ({
    left: `${mmToCanvasPx(mmX)}px`,
  })),
);

const horizontalLines = computed(() =>
  props.guides.h.map((mmY) => ({
    top: `${mmToCanvasPx(mmY)}px`,
  })),
);

const labels = computed(() =>
  props.guides.distLabels.map((d) => {
    const aPx = mmToCanvasPx(d.a);
    const bPx = mmToCanvasPx(d.b);
    const crossPx = mmToCanvasPx(d.crossAxis);
    return d.kind === 'h'
      ? { style: { left: `${aPx}px`, top: `${crossPx - 8}px`, width: `${bPx - aPx}px` }, value: d.value, kind: 'h' as const }
      : { style: { left: `${crossPx - 8}px`, top: `${aPx}px`, height: `${bPx - aPx}px` }, value: d.value, kind: 'v' as const };
  }),
);
</script>

<template>
  <div class="sg-layer">
    <div v-for="(s, i) in verticalLines" :key="`v${i}`" class="sg-v" :style="s" />
    <div v-for="(s, i) in horizontalLines" :key="`h${i}`" class="sg-h" :style="s" />
    <div v-for="(l, i) in labels" :key="`l${i}`" class="sg-label" :class="`sg-label-${l.kind}`" :style="l.style">
      {{ Math.round(l.value) }} mm
    </div>
  </div>
</template>

<style scoped>
.sg-layer {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 5;
}
.sg-v {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 1.5px;
  background: var(--tp-accent);
  box-shadow: 0 0 12px rgba(108, 92, 231, 0.3);
}
.sg-h {
  position: absolute;
  left: 0;
  right: 0;
  height: 1.5px;
  background: var(--tp-accent);
  box-shadow: 0 0 12px rgba(108, 92, 231, 0.3);
}
.sg-label {
  position: absolute;
  background: var(--tp-accent);
  color: #fff;
  font-size: 10px;
  font-family: ui-monospace, monospace;
  padding: 1px 5px;
  border-radius: 3px;
  line-height: 1.4;
  white-space: nowrap;
}
.sg-label-h {
  /* Horizontal label sits on the line between two elements; center via translate */
  transform: translate(-50%, -50%);
  margin-left: 50%;
}
.sg-label-v {
  transform: translate(-50%, -50%);
  margin-top: 50%;
}
</style>
```

Import the new component in `DesignerCanvas.vue`:

```ts
import SnapGuides from './SnapGuides.vue';
```

### D.5 Behaviour summary

- Drag a element: real-time snap to other elements' edges / centres + paper edges / centre.
- Within 1.5 mm (~ 6 px at 4 px/mm), purple line appears + element snaps.
- Hold Alt while dragging → no snap; raw cursor position.
- Distance labels (up to 2) show on neighbouring elements within 30 mm gap.
- On release: guides disappear; element committed to cell grid (existing iter-2 behavior).

### Acceptance — § D

- Drag element A so its left edge approaches element B's left edge: at 1.5 mm distance, a vertical purple line appears, element snaps.
- Drag to paper center: 2 lines (vertical + horizontal) show + snap.
- Hold Alt while dragging: no snap behaviour, no guides.
- Release: all guides vanish.
- Distance labels show the gap to nearest 2 elements during drag.

---

## Out of scope

- Equal-spacing detection (scenario 4 from the demo).
- Snap-during-resize (only snap during move in MVP).
- Magnetic snap to specific style attributes (e.g., font size).
- Multi-element drag (single-element only).

## Acceptance checklist

§A:
- [ ] Preview modal at 200% zoom on small paper → scrollbars appear; can scroll to all corners.
- [ ] Element at top edge of paper → outside grip not clipped (auto inside-grip kicks in).
- [ ] Click `样式 · 高级` → only the style section toggles; click `布局 · 高级` → only the layout section toggles.
- [ ] Click `⊕ 自定义…` → dialog opens centred; can enter dimensions and confirm.

§B:
- [ ] Tiny element (cs < 8) → uses outside grip pill.
- [ ] Variables panel always shows search input regardless of field count.
- [ ] Variables panel shows max 3 cards by default; scrolls past that.

§C:
- [ ] Drop a 明细 → `列管理` editor shows. Add / remove / reorder / edit columns work.
- [ ] 行高 + 表头 inputs work.

§D:
- [ ] Drag an element; aligns to another element's edge → purple line appears + snap.
- [ ] Aligns to paper centre → two vertical+horizontal lines + snap.
- [ ] Hold Alt → no snap.
- [ ] Release → guides disappear.
- [ ] Distance labels show within drag.
