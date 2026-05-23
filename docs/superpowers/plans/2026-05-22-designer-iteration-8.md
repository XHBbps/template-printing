# Designer Iteration 8 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land iteration-8 (bug fixes + variables 3-row default + table columns editor + alignment guides MVP).

**Architecture:** Each batch lands as a small set of tasks. Snap guides require a new module (`snapGuides.ts`), a new rendering component (`SnapGuides.vue`), store state for transient guides, and an integration in `usePointerDrag`. Table columns editor is a new property-panel sub-component. Other fixes are surgical edits to existing files.

**Tech Stack:** Vue 3 SFC, Pinia, Element Plus, Lucide icons. No new dependencies.

**Source spec:** `docs/superpowers/specs/2026-05-22-designer-iteration-8-design.md`

**Conventions in this repo (read before starting):**
- ESLint `import/no-unresolved` doesn't understand workspace package names or `vue` / `pinia` / `zod` / `element-plus` / `lucide-vue-next` under bundler resolution. Existing files use `// eslint-disable-next-line import/no-unresolved` immediately above each such import. Follow that pattern; do not edit `.eslintrc.cjs`.
- Dev environment runs in docker. Command template:
  `docker compose -f docker-compose.dev.yml exec -T web sh -c 'cd /workspace/<dir> && <cmd>'`
- Type-check: `NODE_OPTIONS=--max-old-space-size=4096 ./node_modules/.bin/vue-tsc --noEmit` (use 8192 for the final pass).
- Do **not** skip git hooks.

---

## File Structure

### Web app
- **Modify** `apps/web/src/views/PreviewView.vue` — split into `paperWrapStyle` (layout size = paperPx × zoom) + `paperStyle` (scale only).
- **Modify** `apps/web/src/designer/CanvasElement.vue` — replace `isSmall` with `useInsideGrip` (rs<6 OR cs<8 OR near-top).
- **Modify** `apps/web/src/designer/PropertyPanel.vue` — split `advancedOpen` → `styleAdvOpen` + `layoutAdvOpen`; mount `TableColumnsEditor` + add rowHeight/showHeader rows.
- **Modify** `apps/web/src/designer/DesignerHeader.vue` — extract `openCustomDialog()` method for clarity.
- **Modify** `apps/web/src/designer/CustomPaperDialog.vue` — add `align-center` / `:append-to-body="true"` / `:z-index="3000"` to ElDialog.
- **Modify** `apps/web/src/designer/FieldManager.vue` — remove `v-if` on search; cap `.fm-body` max-height.
- **Create** `apps/web/src/designer/TableColumnsEditor.vue` — list/add/remove/reorder + per-row edit.
- **Modify** `apps/web/src/stores/designer.ts` — add `guides` state + `setGuides` / `clearGuides` actions.
- **Create** `apps/web/src/designer/snapGuides.ts` — pure `computeSnap()` function.
- **Modify** `apps/web/src/designer/usePointerDrag.ts` — integrate `computeSnap()` into the move drag callback.
- **Create** `apps/web/src/designer/SnapGuides.vue` — renders the lines + distance labels.
- **Modify** `apps/web/src/designer/DesignerCanvas.vue` — mount `<SnapGuides />` inside `.tp-paper`.

---

## Tasks

### Task 1: Preview scrollbar fix (§A.1)

**Files:**
- Modify: `apps/web/src/views/PreviewView.vue`

- [ ] **Step 1: Update paperWrapStyle + paperStyle**

In `apps/web/src/views/PreviewView.vue` `<script setup>`, find the existing `paperWrapStyle` and `paperStyle` computeds (they currently bind only to the scaled paper).

Replace them with:

```ts
const paperWrapStyle = computed(() => ({
  width: `${store.paperPx.w * previewZoom.value}px`,
  height: `${store.paperPx.h * previewZoom.value}px`,
  position: 'relative' as const,
}));

const paperStyle = computed(() => ({
  width: `${store.paperPx.w}px`,
  height: `${store.paperPx.h}px`,
  transform: `scale(${previewZoom.value})`,
  transformOrigin: 'top left',
  background: '#fff',
}));
```

The wrapper now reports the scaled layout size to `.pv-container { overflow: auto }`, which will grow scrollbars when content exceeds the viewport.

- [ ] **Step 2: Verify in template**

In `<template>`, confirm the structure binds both styles correctly:

```vue
<div
  class="pv-paper-wrap"
  :style="paperWrapStyle"
>
  <div class="tp-paper" :style="paperStyle">
    <!-- existing renderer / element loop unchanged -->
  </div>
</div>
```

If the existing template uses inline `:style="{ transform: ..., transformOrigin: ... }"` on `.pv-paper-wrap`, REPLACE that with `:style="paperWrapStyle"`. The scale must now be on the inner `.tp-paper` div.

- [ ] **Step 3: Type-check + browser smoke**

```bash
docker compose -f docker-compose.dev.yml exec -T web sh -c 'cd /workspace/apps/web && NODE_OPTIONS=--max-old-space-size=4096 ./node_modules/.bin/vue-tsc --noEmit'
echo "exit=$?"
```

Open preview at 200% zoom on A6 (or any small paper) — scrollbars should appear; you can scroll to see all corners.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/views/PreviewView.vue
git commit -m "fix(preview): wrap takes scaled layout size so scrollbars appear at zoom > fit"
```

---

### Task 2: Grip auto-flip — near-top + narrow element (§A.2 + §B.1)

**Files:**
- Modify: `apps/web/src/designer/CanvasElement.vue`

- [ ] **Step 1: Replace `isSmall` with `useInsideGrip`**

Open `apps/web/src/designer/CanvasElement.vue` `<script setup>`. Locate the existing `isSmall` computed (added in iter 6: `const isSmall = computed(() => props.element.grid.rs < 6);`).

Replace it with two computeds:

```ts
const isNearTop = computed(() => {
  // anchor.y in mm; 8 mm safely fits the outside pill (28 px ≈ 7 mm) + margin.
  return props.element.anchor.y < 8;
});

const useInsideGrip = computed(() => {
  // Use inside grip when element is too short, too narrow, OR too close to top.
  if (props.element.grid.rs < 6) return true;
  if (props.element.grid.cs < 8) return true;
  if (isNearTop.value) return true;
  return false;
});
```

- [ ] **Step 2: Update template binding**

In `<template>`, find:

```vue
<ElementGrip v-if="isSelected" :is-small="isSmall" @pointerdown="onGripDown" />
```

Replace `:is-small="isSmall"` with `:is-small="!useInsideGrip"`:

```vue
<ElementGrip v-if="isSelected" :is-small="!useInsideGrip" @pointerdown="onGripDown" />
```

Semantics from iter 6's ElementGrip.vue: `isSmall=true` → outside pill; `isSmall=false` → inside dots.
- `useInsideGrip=true` → `isSmall=false` → inside dots (when element is short/narrow/near-top).
- `useInsideGrip=false` → `isSmall=true` → outside pill (when element is large and not near top).

- [ ] **Step 3: Type-check + browser smoke**

```bash
docker compose -f docker-compose.dev.yml exec -T web sh -c 'cd /workspace/apps/web && NODE_OPTIONS=--max-old-space-size=4096 ./node_modules/.bin/vue-tsc --noEmit'
echo "exit=$?"
```

Browser tests:
- Drop a 文字 element flush against paper top → uses inside grip (not clipped).
- Drop a tall+narrow element (cs=4, rs=20) → uses inside grip (dots wouldn't fit).
- Drop a normal 60×40mm element away from top → uses outside grip pill.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/designer/CanvasElement.vue
git commit -m "fix(designer): grip auto-flips to inside dots when element is narrow OR near paper top"
```

---

### Task 3: Split advanced section toggles (§A.3)

**Files:**
- Modify: `apps/web/src/designer/PropertyPanel.vue`

- [ ] **Step 1: Split the ref**

In `apps/web/src/designer/PropertyPanel.vue` `<script setup>`, find:

```ts
const advancedOpen = ref(false);
```

Replace with:

```ts
const styleAdvOpen = ref(false);
const layoutAdvOpen = ref(false);
```

- [ ] **Step 2: Wire each section to its own ref**

In `<template>`, find the existing "样式 · 高级" `<div class="style-block">` block. Update its title click + v-if to use `styleAdvOpen`:

```vue
<div v-if="isTextish(sel)" class="style-block">
  <div class="style-title sclickable" @click="styleAdvOpen = !styleAdvOpen">
    样式 · 高级 <span class="caret">{{ styleAdvOpen ? '▾' : '▸' }}</span>
  </div>
  <div v-if="styleAdvOpen">
    <!-- existing rows: fontFamily / letterSpacing / lineHeight / textDecoration / verticalAlign / textOverflow — unchanged -->
  </div>
</div>
```

Find the "布局 · 高级" `<div class="style-block">` block (added in iter 6). Update its title + v-if to use `layoutAdvOpen`:

```vue
<div v-if="sel" class="style-block">
  <div class="style-title sclickable" @click="layoutAdvOpen = !layoutAdvOpen">
    布局 · 高级 <span class="caret">{{ layoutAdvOpen ? '▾' : '▸' }}</span>
  </div>
  <div v-if="layoutAdvOpen">
    <!-- existing rows: backgroundColor / zIndex / rotation / opacity — unchanged -->
  </div>
</div>
```

- [ ] **Step 3: Type-check + browser smoke**

```bash
docker compose -f docker-compose.dev.yml exec -T web sh -c 'cd /workspace/apps/web && NODE_OPTIONS=--max-old-space-size=4096 ./node_modules/.bin/vue-tsc --noEmit'
echo "exit=$?"
```

Browser: select a text element. Click "样式 · 高级" title — only the style section expands. Click "布局 · 高级" — only the layout section expands. They toggle independently.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/designer/PropertyPanel.vue
git commit -m "fix(designer): split styleAdvOpen + layoutAdvOpen so advanced sections toggle independently"
```

---

### Task 4: Custom paper dialog — investigation + fix (§A.4)

**Files:**
- Modify: `apps/web/src/designer/DesignerHeader.vue`
- Modify: `apps/web/src/designer/CustomPaperDialog.vue`

- [ ] **Step 1: Read existing wiring**

```bash
docker compose -f docker-compose.dev.yml exec -T web sh -c 'grep -n "customDialogOpen\|CustomPaperDialog" /workspace/apps/web/src/designer/DesignerHeader.vue'
docker compose -f docker-compose.dev.yml exec -T web sh -c 'cat /workspace/apps/web/src/designer/CustomPaperDialog.vue | head -40'
```

Note the current click handler shape and the ElDialog props.

- [ ] **Step 2: Replace ElDropdownItem inline assignment with a method**

In `apps/web/src/designer/DesignerHeader.vue` `<script setup>`, add (or relocate) the method:

```ts
function openCustomDialog(): void {
  customDialogOpen.value = true;
}
```

In `<template>`, find the existing `⊕ 自定义…` `<ElDropdownItem ...>` line. Replace its `@click` handler:

```vue
<ElDropdownItem divided @click="openCustomDialog">
  <Plus :size="14" :stroke-width="2" style="margin-right: 6px" />
  自定义…
</ElDropdownItem>
```

(If the click was previously `@click="customDialogOpen = true"`, swap to the method call.)

- [ ] **Step 3: Update ElDialog attributes in CustomPaperDialog.vue**

In `apps/web/src/designer/CustomPaperDialog.vue` `<template>`, find the `<ElDialog ...>` opening tag. Add 3 props: `align-center` for vertical centering, `:append-to-body="true"` to teleport outside any ancestor positioning issues, `:z-index="3000"` to ensure the dialog sits above the toolbar overlay:

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

Preserve existing inner content (input rows, preview, footer). Only the opening tag attributes change.

- [ ] **Step 4: Type-check**

```bash
docker compose -f docker-compose.dev.yml exec -T web sh -c 'cd /workspace/apps/web && NODE_OPTIONS=--max-old-space-size=4096 ./node_modules/.bin/vue-tsc --noEmit'
echo "exit=$?"
```

- [ ] **Step 5: Manual browser flow**

Restart web if needed:

```bash
docker compose -f docker-compose.dev.yml restart web
```

Open `/designer/new`. Click 📄 paper → `⊕ 自定义…`. Dialog opens centred with all inputs visible. Type w=200, h=150. Click `确定`. Canvas changes to 200×150mm.

If the dialog STILL doesn't appear after these fixes, add a temporary console.log at the bottom of `openCustomDialog`:

```ts
function openCustomDialog(): void {
  console.log('[Header] custom paper click; customDialogOpen ->', true);
  customDialogOpen.value = true;
}
```

and in CustomPaperDialog.vue script:

```ts
watch(() => props.modelValue, (v) => {
  // eslint-disable-next-line no-console
  console.log('[CustomPaperDialog] modelValue ->', v);
}, { immediate: true });
```

Use the logs to find the broken hop, fix it, then REMOVE the console.logs before committing.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/designer/DesignerHeader.vue apps/web/src/designer/CustomPaperDialog.vue
git commit -m "fix(designer): custom paper dialog — append-to-body + align-center + z-index 3000; explicit click handler"
```

---

### Task 5: Variables panel — 3-row default + always-show search (§B.2)

**Files:**
- Modify: `apps/web/src/designer/FieldManager.vue`

- [ ] **Step 1: Remove v-if on search bar**

In `apps/web/src/designer/FieldManager.vue` `<template>`, find:

```vue
<div v-if="store.fieldDefs.length > 5" class="fm-search">
  ...
</div>
```

Remove the `v-if`:

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

- [ ] **Step 2: Cap `.fm-body` max-height**

In `<style scoped>`, find the existing `.fm-body` rule. Replace with:

```css
.fm-body {
  flex: 1;
  overflow-y: auto;
  padding: 8px 10px 12px;
  max-height: 200px;
}
```

The max-height ≈ 3 cards (each ~60px tall including margin).

- [ ] **Step 3: Type-check + browser smoke**

```bash
docker compose -f docker-compose.dev.yml exec -T web sh -c 'cd /workspace/apps/web && NODE_OPTIONS=--max-old-space-size=4096 ./node_modules/.bin/vue-tsc --noEmit'
echo "exit=$?"
```

Browser: open designer with 0 variables → search input visible. Add 5 variables → body shows all 5. Add 4 more (total 9) → body shows ~3 cards + scrolls to reveal the rest.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/designer/FieldManager.vue
git commit -m "fix(designer): variables panel — always show search; cap body to ~3-row max-height"
```

---

### Task 6: TableColumnsEditor component (§C.1)

**Files:**
- Create: `apps/web/src/designer/TableColumnsEditor.vue`

- [ ] **Step 1: Create the file**

Write `apps/web/src/designer/TableColumnsEditor.vue`:

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
  font-size: 11px;
  font-weight: 600;
  color: var(--tp-ink-soft);
  letter-spacing: 0.06em;
  text-transform: uppercase;
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
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.tc-actions button:hover { background: var(--tp-field-bg); color: var(--tp-accent-ink); }
.tc-actions button:disabled { opacity: 0.4; cursor: not-allowed; }
.tc-actions .tc-del:hover { background: rgba(217, 79, 79, 0.1); color: #d94f4f; }
</style>
```

- [ ] **Step 2: Type-check**

```bash
docker compose -f docker-compose.dev.yml exec -T web sh -c 'cd /workspace/apps/web && NODE_OPTIONS=--max-old-space-size=4096 ./node_modules/.bin/vue-tsc --noEmit'
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/designer/TableColumnsEditor.vue
git commit -m "feat(designer): TableColumnsEditor component (add/remove/reorder/edit columns)"
```

---

### Task 7: Mount TableColumnsEditor in PropertyPanel + rowHeight/showHeader rows (§C.2)

**Files:**
- Modify: `apps/web/src/designer/PropertyPanel.vue`

- [ ] **Step 1: Import the new component**

In `<script setup>` add:

```ts
import TableColumnsEditor from './TableColumnsEditor.vue';
```

- [ ] **Step 2: Mount alongside the table-binding row**

In `<template>`, find the existing `<div v-if="sel && sel.type === 'table'" class="row">…</div>` block (the binding select). IMMEDIATELY AFTER that block, insert:

```vue
<TableColumnsEditor
  v-if="sel && sel.type === 'table'"
  :columns="sel.columns"
  @update="(cols) => store.updateElement(sel!.id, { columns: cols } as Partial<TemplateElement>)"
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

Place these blocks BEFORE `<BorderControl>`. The `TableColumnsEditor` `:columns="sel.columns"` requires that the type narrowing has occurred — `v-if="sel && sel.type === 'table'"` ensures `sel.columns` is well-typed.

- [ ] **Step 3: Type-check**

```bash
docker compose -f docker-compose.dev.yml exec -T web sh -c 'cd /workspace/apps/web && NODE_OPTIONS=--max-old-space-size=4096 ./node_modules/.bin/vue-tsc --noEmit'
echo "exit=$?"
```

If TypeScript complains that the `cols` parameter in the `@update` handler is implicitly any, type-annotate the inline handler:

```vue
@update="(cols: typeof sel.columns) => store.updateElement(sel!.id, { columns: cols } as Partial<TemplateElement>)"
```

- [ ] **Step 4: Browser smoke**

Drop a 明细 (table) element. PropertyPanel shows 列管理 section with 2 default columns (col1/col2). Click `+ 添加列` → row appears. Edit key/header/cs/align → reflected in real time. Click 🗑 → row removed. ↑/↓ reorder. Adjust 行高 number + toggle 表头 checkbox.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/designer/PropertyPanel.vue
git commit -m "feat(designer): PropertyPanel mounts TableColumnsEditor + rowHeight + showHeader rows"
```

---

### Task 8: Store — guides state + actions (§D.1)

**Files:**
- Modify: `apps/web/src/stores/designer.ts`

- [ ] **Step 1: Add guides to state**

In `apps/web/src/stores/designer.ts`, find the `state: () => ({ ... })` block. Append a `guides` field:

```ts
state: () => ({
  template: defaultTemplate(),
  selectedIds: [] as string[],
  history: [] as string[],
  historyIndex: -1,
  dirty: false,
  isResizing: false,
  view: { zoom: 1 } as { zoom: number },
  canvasAreaSize: null as null | (() => { w: number; h: number }),
  guides: {
    v: [] as number[],
    h: [] as number[],
    distLabels: [] as Array<{
      kind: 'h' | 'v';
      a: number;
      b: number;
      crossAxis: number;
      value: number;
    }>,
  },
}),
```

- [ ] **Step 2: Add setGuides + clearGuides actions**

In the `actions` block (next to `registerCanvasArea` / `setZoom`), add:

```ts
setGuides(g: { v: number[]; h: number[]; distLabels: Array<{ kind: 'h' | 'v'; a: number; b: number; crossAxis: number; value: number }> }): void {
  this.guides = g;
  // No snapshot — guides are transient, not history-tracked or persisted.
},
clearGuides(): void {
  this.guides = { v: [], h: [], distLabels: [] };
},
```

- [ ] **Step 3: Type-check**

```bash
docker compose -f docker-compose.dev.yml exec -T web sh -c 'cd /workspace/apps/web && NODE_OPTIONS=--max-old-space-size=4096 ./node_modules/.bin/vue-tsc --noEmit'
echo "exit=$?"
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/stores/designer.ts
git commit -m "feat(store): add guides state + setGuides/clearGuides actions for snap visuals"
```

---

### Task 9: snapGuides module (§D.2)

**Files:**
- Create: `apps/web/src/designer/snapGuides.ts`

- [ ] **Step 1: Create the file**

Write `apps/web/src/designer/snapGuides.ts`:

```ts
export interface SnapInput {
  target: { x: number; y: number; w: number; h: number };
  others: Array<{ x: number; y: number; w: number; h: number }>;
  paper: { w: number; h: number };
  threshold: number;
}

export interface SnapResult {
  snapped: { x: number; y: number };
  guides: {
    v: number[];
    h: number[];
    distLabels: Array<{ kind: 'h' | 'v'; a: number; b: number; crossAxis: number; value: number }>;
  };
}

function targetLines(t: SnapInput['target']): { v: number[]; h: number[] } {
  return {
    v: [t.x, t.x + t.w / 2, t.x + t.w],
    h: [t.y, t.y + t.h / 2, t.y + t.h],
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
  const hitV: number[] = [];
  const hitH: number[] = [];

  // Best vertical alignment (snap x)
  let bestV: { delta: number; abs: number } | null = null;
  for (const tl of t.v) {
    for (const cl of c.v) {
      const delta = cl - tl;
      const abs = Math.abs(delta);
      if (abs <= th && (bestV === null || abs < bestV.abs)) {
        bestV = { delta, abs };
      }
    }
  }
  if (bestV) {
    snapDx = bestV.delta;
    for (const tl of t.v) {
      const newPos = tl + snapDx;
      for (const cl of c.v) {
        if (Math.abs(cl - newPos) < 0.001) hitV.push(cl);
      }
    }
  }

  // Best horizontal alignment (snap y)
  let bestH: { delta: number; abs: number } | null = null;
  for (const tl of t.h) {
    for (const cl of c.h) {
      const delta = cl - tl;
      const abs = Math.abs(delta);
      if (abs <= th && (bestH === null || abs < bestH.abs)) {
        bestH = { delta, abs };
      }
    }
  }
  if (bestH) {
    snapDy = bestH.delta;
    for (const tl of t.h) {
      const newPos = tl + snapDy;
      for (const cl of c.h) {
        if (Math.abs(cl - newPos) < 0.001) hitH.push(cl);
      }
    }
  }

  // Distance labels — nearest non-zero gap to each side, capped to 2 entries
  const tSnapped = {
    x: input.target.x + snapDx,
    y: input.target.y + snapDy,
    w: input.target.w,
    h: input.target.h,
  };
  const distLabels: SnapResult['guides']['distLabels'] = [];
  for (const o of input.others) {
    const yOverlap = !(o.y + o.h <= tSnapped.y || o.y >= tSnapped.y + tSnapped.h);
    if (yOverlap) {
      const targetLeft = tSnapped.x;
      const targetRight = tSnapped.x + tSnapped.w;
      const otherLeft = o.x;
      const otherRight = o.x + o.w;
      if (otherRight <= targetLeft) {
        const gap = targetLeft - otherRight;
        if (gap > 0.1 && gap < 30) {
          distLabels.push({
            kind: 'h',
            a: otherRight,
            b: targetLeft,
            crossAxis: Math.max(o.y, tSnapped.y) + Math.min(o.h, tSnapped.h) / 2,
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
            crossAxis: Math.max(o.y, tSnapped.y) + Math.min(o.h, tSnapped.h) / 2,
            value: gap,
          });
        }
      }
    }
    const xOverlap = !(o.x + o.w <= tSnapped.x || o.x >= tSnapped.x + tSnapped.w);
    if (xOverlap) {
      const targetTop = tSnapped.y;
      const targetBottom = tSnapped.y + tSnapped.h;
      const otherTop = o.y;
      const otherBottom = o.y + o.h;
      if (otherBottom <= targetTop) {
        const gap = targetTop - otherBottom;
        if (gap > 0.1 && gap < 30) {
          distLabels.push({
            kind: 'v',
            a: otherBottom,
            b: targetTop,
            crossAxis: Math.max(o.x, tSnapped.x) + Math.min(o.w, tSnapped.w) / 2,
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
            crossAxis: Math.max(o.x, tSnapped.x) + Math.min(o.w, tSnapped.w) / 2,
            value: gap,
          });
        }
      }
    }
  }
  distLabels.sort((a, b) => a.value - b.value);
  const trimmedLabels = distLabels.slice(0, 2);

  return {
    snapped: { x: tSnapped.x, y: tSnapped.y },
    guides: {
      v: [...new Set(hitV)],
      h: [...new Set(hitH)],
      distLabels: trimmedLabels,
    },
  };
}
```

- [ ] **Step 2: Type-check + commit**

```bash
docker compose -f docker-compose.dev.yml exec -T web sh -c 'cd /workspace/apps/web && NODE_OPTIONS=--max-old-space-size=4096 ./node_modules/.bin/vue-tsc --noEmit'
git add apps/web/src/designer/snapGuides.ts
git commit -m "feat(designer): snapGuides module — computeSnap() for align + distance"
```

---

### Task 10: Integrate snap into usePointerDrag move (§D.3)

**Files:**
- Modify: `apps/web/src/designer/usePointerDrag.ts`

- [ ] **Step 1: Add imports + constants**

At top of `apps/web/src/designer/usePointerDrag.ts`, add:

```ts
import { computeSnap } from './snapGuides';

const PX_PER_MM = 4;
const SNAP_THRESHOLD_MM = 1.5;
```

(If `PX_PER_MM` already exists, don't duplicate.)

- [ ] **Step 2: Refactor onGripDown to snap during move**

Find the existing `onGripDown(e: PointerEvent)` function. Replace its body with the snap-aware version:

```ts
function onGripDown(e: PointerEvent): void {
  const dom = getDom();
  const el = getElement();
  if (!dom || !el) return;
  const cell = getCellPx();
  const startC = el.grid.c, startR = el.grid.r;
  const startCs = el.grid.cs, startRs = el.grid.rs;
  const startX = e.clientX, startY = e.clientY;
  const startAnchorX = el.anchor.x;
  const startAnchorY = el.anchor.y;

  let lastDx = 0, lastDy = 0;
  let lastSnappedX = startAnchorX;
  let lastSnappedY = startAnchorY;
  store.isResizing = true;
  dom.classList.add('is-pointer-active');

  function onMove(ev: PointerEvent): void {
    lastDx = ev.clientX - startX;
    lastDy = ev.clientY - startY;

    const dxMm = lastDx / (PX_PER_MM * store.view.zoom);
    const dyMm = lastDy / (PX_PER_MM * store.view.zoom);

    const targetMm = {
      x: startAnchorX + dxMm,
      y: startAnchorY + dyMm,
      w: el!.anchor.w,
      h: el!.anchor.h,
    };
    const others = store.template.elements
      .filter((e2) => e2.id !== elementId)
      .map((e2) => ({ x: e2.anchor.x, y: e2.anchor.y, w: e2.anchor.w, h: e2.anchor.h }));
    const paperMmW = store.paperPx.w / PX_PER_MM;
    const paperMmH = store.paperPx.h / PX_PER_MM;

    const snap = computeSnap({
      target: targetMm,
      others,
      paper: { w: paperMmW, h: paperMmH },
      threshold: ev.altKey ? 0 : SNAP_THRESHOLD_MM,
    });

    store.setGuides(snap.guides);
    lastSnappedX = snap.snapped.x;
    lastSnappedY = snap.snapped.y;

    const snappedDxPx = (lastSnappedX - startAnchorX) * PX_PER_MM * store.view.zoom;
    const snappedDyPx = (lastSnappedY - startAnchorY) * PX_PER_MM * store.view.zoom;
    dom!.style.transform = `translate(${snappedDxPx}px, ${snappedDyPx}px)`;
  }

  function onUp(): void {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    store.clearGuides();

    const z = store.view.zoom;
    const finalDxMm = lastSnappedX - startAnchorX;
    const finalDyMm = lastSnappedY - startAnchorY;
    const dc = Math.round((finalDxMm * PX_PER_MM) / cell.w);
    const dr = Math.round((finalDyMm * PX_PER_MM) / cell.h);
    const newC = clamp(startC + dc, 0, store.template.canvas.cols - startCs);
    const newR = clamp(startR + dr, 0, store.template.canvas.rows - startRs);

    const finalDxPx = (lastSnappedX - startAnchorX) * PX_PER_MM * z;
    const finalDyPx = (lastSnappedY - startAnchorY) * PX_PER_MM * z;
    const residueX = finalDxPx - (newC - startC) * cell.w * z;
    const residueY = finalDyPx - (newR - startR) * cell.h * z;
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
```

Key differences from previous version:
- Uses `startAnchorX/Y` (in mm) as the reference frame.
- Calls `computeSnap` each move with `threshold = altKey ? 0 : 1.5`.
- Stores `lastSnappedX/Y` (in mm) — these are what onUp uses.
- Sets `store.guides` each move; clears on up.
- Final commit converts snapped mm position back to cell grid via existing rounding.

The `onResizeDown` (corner/edge resize) is **unchanged** — MVP doesn't snap during resize.

- [ ] **Step 3: Type-check + browser smoke**

```bash
docker compose -f docker-compose.dev.yml exec -T web sh -c 'cd /workspace/apps/web && NODE_OPTIONS=--max-old-space-size=4096 ./node_modules/.bin/vue-tsc --noEmit'
echo "exit=$?"
```

Browser: drop 2 elements. Drag one — it should snap to the other when their edges align. Guides shown in store but not yet rendered (Task 11/12 adds rendering).

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/designer/usePointerDrag.ts
git commit -m "feat(designer): snap-during-move via computeSnap + store guides; Alt disables snap"
```

---

### Task 11: SnapGuides rendering component (§D.4)

**Files:**
- Create: `apps/web/src/designer/SnapGuides.vue`

- [ ] **Step 1: Create the component**

Write `apps/web/src/designer/SnapGuides.vue`:

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
  props.guides.v.map((mmX) => ({ left: `${mmToCanvasPx(mmX)}px` })),
);

const horizontalLines = computed(() =>
  props.guides.h.map((mmY) => ({ top: `${mmToCanvasPx(mmY)}px` })),
);

const labels = computed(() =>
  props.guides.distLabels.map((d) => {
    const aPx = mmToCanvasPx(d.a);
    const bPx = mmToCanvasPx(d.b);
    const crossPx = mmToCanvasPx(d.crossAxis);
    if (d.kind === 'h') {
      return {
        style: {
          left: `${aPx + (bPx - aPx) / 2}px`,
          top: `${crossPx}px`,
          transform: 'translate(-50%, -50%)',
        },
        value: d.value,
      };
    }
    return {
      style: {
        left: `${crossPx}px`,
        top: `${aPx + (bPx - aPx) / 2}px`,
        transform: 'translate(-50%, -50%)',
      },
      value: d.value,
    };
  }),
);
</script>

<template>
  <div class="sg-layer">
    <div v-for="(s, i) in verticalLines" :key="`v${i}`" class="sg-v" :style="s" />
    <div v-for="(s, i) in horizontalLines" :key="`h${i}`" class="sg-h" :style="s" />
    <div v-for="(l, i) in labels" :key="`l${i}`" class="sg-label" :style="l.style">
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
</style>
```

- [ ] **Step 2: Type-check + commit**

```bash
docker compose -f docker-compose.dev.yml exec -T web sh -c 'cd /workspace/apps/web && NODE_OPTIONS=--max-old-space-size=4096 ./node_modules/.bin/vue-tsc --noEmit'
git add apps/web/src/designer/SnapGuides.vue
git commit -m "feat(designer): SnapGuides component renders vertical/horizontal lines + distance labels"
```

---

### Task 12: Mount SnapGuides in DesignerCanvas (§D.4)

**Files:**
- Modify: `apps/web/src/designer/DesignerCanvas.vue`

- [ ] **Step 1: Import**

In `<script setup>` add:

```ts
import SnapGuides from './SnapGuides.vue';
```

- [ ] **Step 2: Mount inside .tp-paper**

In `<template>`, find the existing `<div ... class="tp-paper" ...>` block. Inside it, alongside the `<CanvasElement v-for="el in store.template.elements" ...>` loop, add:

```vue
<SnapGuides v-if="store.isResizing" :guides="store.guides" />
```

It only renders during drag/resize (when `store.isResizing` is true). pointerup clears guides via `store.clearGuides()` AND sets `isResizing = false`, so the component unmounts.

- [ ] **Step 3: Type-check + browser smoke**

```bash
docker compose -f docker-compose.dev.yml exec -T web sh -c 'cd /workspace/apps/web && NODE_OPTIONS=--max-old-space-size=4096 ./node_modules/.bin/vue-tsc --noEmit'
echo "exit=$?"
```

Browser:
- Drop 2 elements at different positions.
- Drag one toward the other — when its left/center/right edge approaches the other's corresponding line within ~6 px on screen, a purple vertical line appears and the element snaps.
- Drag toward paper center — both vertical AND horizontal lines through the paper midpoint appear; element snaps to centered.
- Hold Alt while dragging — no snap; guides don't appear.
- Release mouse — guides vanish.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/designer/DesignerCanvas.vue
git commit -m "feat(designer): mount SnapGuides inside paper; renders during isResizing"
```

---

### Task 13: Final acceptance pass

- [ ] **Step 1: Full vue-tsc + schema tests**

```bash
docker compose -f docker-compose.dev.yml exec -T web sh -c 'cd /workspace/apps/web && NODE_OPTIONS=--max-old-space-size=8192 ./node_modules/.bin/vue-tsc --noEmit'
docker compose -f docker-compose.dev.yml exec -T web sh -c 'cd /workspace/packages/schema && pnpm test'
```

Both should be green.

- [ ] **Step 2: Browser walk-through — iteration 8 acceptance**

```bash
docker compose -f docker-compose.dev.yml restart web
```

Open `http://localhost:5173/designer/new` (force-refresh Ctrl+Shift+R). Verify ALL items:

§A:
1. Preview modal at 200% zoom on A6 paper → vertical and horizontal scrollbars appear; can scroll to all corners.
2. Drop a text element flush against the paper top → outside grip not clipped; element auto-uses inside dots.
3. Click "样式 · 高级" title → only the style section toggles. Click "布局 · 高级" title → only the layout section toggles.
4. Click 📄 paper dropdown → ⊕ 自定义… → dialog opens centred with all inputs visible. Type w=200, h=150 → confirm → paper applied.

§B:
5. Drop a tiny element (cs < 8 cells) → uses inside grip dots (NOT outside pill).
6. FieldManager always shows search input regardless of variable count.
7. Add 4+ variables → field list scrolls when > ~3 cards.

§C:
8. Drop a 明细 element → 列管理 section shows 2 default columns. Click + 添加列 → row appears. Click ↑/↓ → reorder. Click 🗑 → remove. Edit key/header/cs/align → reflected in real time. Adjust 行高 + 表头.

§D:
9. Drop 2 elements. Drag one to align with the other's left edge: vertical purple line appears at the alignment line + element snaps.
10. Drag toward paper centre: 2 lines (vertical + horizontal) through midpoint + snap.
11. Hold Alt while dragging: no snap, no guides.
12. Release mouse: guides vanish.
13. Distance labels (up to 2) show during drag for nearby elements.

For any failure, log a follow-up issue; do NOT auto-fix silently.

- [ ] **Step 3: Report status to user — do NOT auto-merge**

Per repo convention, user merges to master after confirmation.

---

## Self-Review

Spec coverage:

**§A bugs**:
- A.1 preview scroll → Task 1
- A.2 grip clip auto-flip → Task 2
- A.3 advanced section independent → Task 3
- A.4 custom paper dialog → Task 4

**§B UI tweaks**:
- B.1 small-element grip threshold (cs<8) → Task 2 (bundled)
- B.2 variables 3-row + search → Task 5

**§C table columns editor**:
- C.1 TableColumnsEditor component → Task 6
- C.2 PropertyPanel mount + rowHeight + showHeader → Task 7

**§D alignment guides**:
- D.1 store state → Task 8
- D.2 snapGuides module → Task 9
- D.3 usePointerDrag integration → Task 10
- D.4 SnapGuides rendering component → Task 11
- D.4 DesignerCanvas mount → Task 12

All spec requirements have a corresponding task. No placeholders. Type/name consistency: `useInsideGrip`, `isNearTop`, `styleAdvOpen`, `layoutAdvOpen`, `openCustomDialog`, `TableColumnsEditor`, `computeSnap`, `SnapInput`, `SnapResult`, `setGuides`, `clearGuides`, `SnapGuides`, `lastSnappedX/Y`, `startAnchorX/Y` — all used consistently across tasks.
