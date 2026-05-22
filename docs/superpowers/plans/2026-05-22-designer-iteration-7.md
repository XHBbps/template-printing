# Designer Iteration 7 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply iteration-7 (UI bug fixes + variables panel polish + custom paper finish + barcode first-render hardening).

**Architecture:** Mostly cosmetic / interaction polish. Replace native browser dialogs with Element Plus modal, restructure PreviewView for sticky zoom control, harden the barcode/QR initial render with defensive fallbacks, swap variable-card "warm-yellow unused" for binary bound/unbound colour, finish wiring the custom paper dialog, add a missing system-variable property panel.

**Tech Stack:** Vue 3 SFC, Pinia, Element Plus, bwip-js, qrcode-generator, Lucide icons (already installed). No new dependencies.

**Source spec:** `docs/superpowers/specs/2026-05-22-designer-iteration-7-design.md`

**Conventions in this repo (read before starting):**
- ESLint `import/no-unresolved` doesn't understand workspace package names or `vue` / `pinia` / `zod` / `element-plus` / `lucide-vue-next` under bundler resolution. Existing files use `// eslint-disable-next-line import/no-unresolved` immediately above each such import. Follow that pattern; do not edit `.eslintrc.cjs`.
- Dev environment runs in docker. Command template:
  `docker compose -f docker-compose.dev.yml exec -T web sh -c 'cd /workspace/<dir> && <cmd>'`
- Type-check: `NODE_OPTIONS=--max-old-space-size=4096 ./node_modules/.bin/vue-tsc --noEmit` (use 8192 for the final pass).
- Do **not** skip git hooks.

---

## File Structure

### Web app
- **Modify** `apps/web/src/styles/designer.css` — append global number-input spinner hide rules (for `.designer-root` + `.el-dialog`).
- **Modify** `apps/web/src/designer/CanvasElementsList.vue` — replace `window.confirm` with `ElMessageBox.confirm`.
- **Modify** `apps/web/src/designer/FieldManager.vue` — multiple iter-7 changes bundled:
  - replace `window.confirm` with `ElMessageBox.confirm`
  - replace `.unused` warm-yellow with binary `.bound` green / default gray
  - add search filter input + `filteredFields` computed
- **Modify** `apps/web/src/designer/DesignerHeader.vue` — replace `window.confirm` in `exitToHome` if present (audit).
- **Modify** `apps/web/src/views/PreviewView.vue` — restructure: add `.pv-wrap` outer, move `.pv-zoom` outside the scrolling `.pv-container`.
- **Modify** `apps/web/src/designer/ElementGrip.vue` — change `.tp-grip--outside top: -14px` → `-28px`.
- **Modify** `packages/template-renderer/src/elements/BarcodeElement.vue` — defensive render: try/catch + canvasRef guard + onMounted fallback + nextTick in watch callback.
- **Modify** `packages/template-renderer/src/elements/QrElement.vue` — same defensive render pattern.
- **Modify** `apps/web/src/designer/CustomPaperDialog.vue` — investigate + relax `canConfirm` to allow prime-side fallback.
- **Modify** `apps/web/src/designer/PropertyPanel.vue` — add system-variable property row (and format input when variable === 'now').

---

## Tasks

### Task 1: Global number-input spinner hide (§B.1)

**Files:**
- Modify: `apps/web/src/styles/designer.css`

- [ ] **Step 1: Append CSS rules**

Open `apps/web/src/styles/designer.css`. Add at the end of the file (or anywhere global-scope; not inside any media query):

```css
/* Iteration 7 #B.1 — globally hide native number-input spinners inside the
   designer and inside Element Plus dialogs (which are teleported to body
   and therefore not under .designer-root). */
.designer-root input[type='number']::-webkit-outer-spin-button,
.designer-root input[type='number']::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}
.designer-root input[type='number'] {
  -moz-appearance: textfield;
}
.el-dialog input[type='number']::-webkit-outer-spin-button,
.el-dialog input[type='number']::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}
.el-dialog input[type='number'] {
  -moz-appearance: textfield;
}
```

- [ ] **Step 2: Type-check + browser smoke**

```bash
docker compose -f docker-compose.dev.yml exec -T web sh -c 'cd /workspace/apps/web && NODE_OPTIONS=--max-old-space-size=4096 ./node_modules/.bin/vue-tsc --noEmit'
echo "exit=$?"
```

Browser: select a text element, open PropertyPanel "样式 · 基础", verify the 字号 number input has no spinner arrows visible.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/styles/designer.css
git commit -m "fix(designer): hide native number-input spinners globally"
```

---

### Task 2: Replace window.confirm with ElMessageBox (§B.2)

**Files:**
- Modify: `apps/web/src/designer/CanvasElementsList.vue`
- Modify: `apps/web/src/designer/FieldManager.vue`
- Modify: `apps/web/src/designer/DesignerHeader.vue` (if it contains a `window.confirm`)

- [ ] **Step 1: Audit window.confirm sites**

```bash
docker compose -f docker-compose.dev.yml exec -T web sh -c 'cd /workspace/apps/web && grep -rn "window.confirm" src/ 2>&1'
```

Expected hits: `CanvasElementsList.vue`, `FieldManager.vue`, possibly `DesignerHeader.vue` `exitToHome`. Note the exact lines.

- [ ] **Step 2: Update CanvasElementsList.vue**

In `apps/web/src/designer/CanvasElementsList.vue` `<script setup>`, add to the imports:

```ts
// eslint-disable-next-line import/no-unresolved
import { ElMessageBox } from 'element-plus';
```

Replace `onClearAll`:

```ts
async function onClearAll(): Promise<void> {
  try {
    await ElMessageBox.confirm(
      `确定清空全部 ${elements.value.length} 个元素？此操作可通过撤销恢复。`,
      '清空画布',
      {
        confirmButtonText: '清空',
        cancelButtonText: '取消',
        type: 'warning',
        center: true,
      },
    );
    store.deleteAllElements();
  } catch {
    /* user cancelled */
  }
}
```

- [ ] **Step 3: Update FieldManager.vue**

In `apps/web/src/designer/FieldManager.vue` `<script setup>`, the existing import line `import { ElButton, ElDialog, ElForm, ElFormItem, ElInput, ElMessage, ElOption, ElSelect, ElCheckbox } from 'element-plus';` already includes the `element-plus` source. Add `ElMessageBox`:

```ts
import {
  ElButton, ElDialog, ElForm, ElFormItem, ElInput, ElMessage, ElMessageBox,
  ElOption, ElSelect, ElCheckbox,
} from 'element-plus';
```

Replace `remove(key)`:

```ts
async function remove(key: string): Promise<void> {
  try {
    await ElMessageBox.confirm(
      `删除变量 "${key}"？模板中绑定到该字段的元素将变为未绑定状态。`,
      '删除变量',
      {
        confirmButtonText: '删除',
        cancelButtonText: '取消',
        type: 'warning',
        center: true,
      },
    );
    store.removeField(key);
  } catch {
    /* user cancelled */
  }
}
```

- [ ] **Step 4: Update DesignerHeader.vue if needed**

If Step 1 found `window.confirm` in DesignerHeader.vue (e.g., in `exitToHome`), open the file and replace it with the same pattern. Add `ElMessageBox` to the existing `element-plus` import. If no `window.confirm` was found in DesignerHeader.vue, skip this step.

Example `exitToHome` replacement (if found):

```ts
async function exitToHome(): Promise<void> {
  if (store.dirty) {
    try {
      await ElMessageBox.confirm(
        '当前模板有未保存改动，确定离开吗？(草稿保留在本地)',
        '离开',
        {
          confirmButtonText: '离开',
          cancelButtonText: '继续编辑',
          type: 'warning',
          center: true,
        },
      );
    } catch {
      return;
    }
  }
  void router.push('/');
}
```

- [ ] **Step 5: Type-check + commit**

```bash
docker compose -f docker-compose.dev.yml exec -T web sh -c 'cd /workspace/apps/web && NODE_OPTIONS=--max-old-space-size=4096 ./node_modules/.bin/vue-tsc --noEmit'
git add apps/web/src/designer/CanvasElementsList.vue \
        apps/web/src/designer/FieldManager.vue \
        apps/web/src/designer/DesignerHeader.vue
git commit -m "fix(designer): replace window.confirm with centred ElMessageBox"
```

If DesignerHeader.vue wasn't modified, omit it from `git add`.

---

### Task 3: PreviewView zoom control sticky (§B.3)

**Files:**
- Modify: `apps/web/src/views/PreviewView.vue`

- [ ] **Step 1: Read existing structure**

```bash
docker compose -f docker-compose.dev.yml exec -T web sh -c 'cat /workspace/apps/web/src/views/PreviewView.vue'
```

Locate the `<div class="pv-container">` (current scroll container) and the `<div class="pv-zoom">` inside it.

- [ ] **Step 2: Restructure template**

In the ElDialog body, wrap the existing structure in a `<div class="pv-wrap">` outer with the zoom now as a sibling of `.pv-container`:

```vue
<div class="pv-wrap">
  <div ref="modalContainerRef" class="pv-container">
    <div
      class="pv-paper-wrap"
      :style="{ transform: `scale(${previewZoom})`, transformOrigin: 'top left' }"
    >
      <div class="tp-paper" :style="paperStyle">
        <!-- existing TemplateRenderer or render loop unchanged -->
      </div>
    </div>
  </div>
  <div class="pv-zoom">
    <button class="pv-zoom-btn" @click="onFitPreview">Fit</button>
    <button
      v-for="z in zoomOptions"
      :key="z"
      class="pv-zoom-btn"
      :class="{ on: Math.abs(previewZoom - z) < 0.01 }"
      @click="choosePreviewZoom(z)"
    >
      {{ Math.round(z * 100) }}%
    </button>
  </div>
</div>
```

- [ ] **Step 3: Update CSS**

In `<style scoped>` replace the existing `.pv-container` rule (which had `height: 70vh; position: relative`) with two rules:

```css
.pv-wrap {
  position: relative;
  width: 100%;
  height: 70vh;
  border-radius: 8px;
  overflow: hidden;
}
.pv-container {
  width: 100%;
  height: 100%;
  overflow: auto;
  background: var(--tp-canvas-bg, #f2f2f5);
}
```

The existing `.pv-zoom` rule (`position: absolute; bottom: 12px; right: 12px;`) stays unchanged — it now positions relative to `.pv-wrap`. Confirm it has `z-index: 5;` to stay on top of scroll content:

```css
.pv-zoom {
  position: absolute;
  bottom: 12px;
  right: 12px;
  z-index: 5;
  display: flex;
  gap: 4px;
  background: rgba(255, 255, 255, 0.94);
  border-radius: 999px;
  padding: 4px 6px;
  box-shadow: 0 2px 12px rgba(20, 20, 30, 0.10);
}
```

If `z-index: 5;` isn't already there, add it.

- [ ] **Step 4: Type-check + browser smoke**

```bash
docker compose -f docker-compose.dev.yml exec -T web sh -c 'cd /workspace/apps/web && NODE_OPTIONS=--max-old-space-size=4096 ./node_modules/.bin/vue-tsc --noEmit'
```

Browser: open preview → set zoom to 200% → scroll the paper. Confirm the zoom control buttons stay fixed in the bottom-right corner of the modal.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/views/PreviewView.vue
git commit -m "fix(preview): move zoom control out of scrolling container"
```

---

### Task 4: Outside grip pill offset (§B.4)

**Files:**
- Modify: `apps/web/src/designer/ElementGrip.vue`

- [ ] **Step 1: Update `.tp-grip--outside` top offset**

In `apps/web/src/designer/ElementGrip.vue` `<style scoped>`, find:

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
```

Change `top: -14px` to `top: -28px`. The rest of the rule stays unchanged.

- [ ] **Step 2: Type-check + browser smoke**

```bash
docker compose -f docker-compose.dev.yml exec -T web sh -c 'cd /workspace/apps/web && NODE_OPTIONS=--max-old-space-size=4096 ./node_modules/.bin/vue-tsc --noEmit'
```

Browser: drop a small element (text 8×4 mm) — confirm the outside grip pill sits clearly above the element with a visible gap, not overlapping the corner handles.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/designer/ElementGrip.vue
git commit -m "fix(designer): outside grip pill — top:-28px for visible gap above element"
```

---

### Task 5: BarcodeElement + QrElement defensive render (§C)

**Files:**
- Modify: `packages/template-renderer/src/elements/BarcodeElement.vue`
- Modify: `packages/template-renderer/src/elements/QrElement.vue`

- [ ] **Step 1: BarcodeElement — defensive render fixes**

Open `packages/template-renderer/src/elements/BarcodeElement.vue`.

A) In imports add `onMounted` and `nextTick`:

```ts
import { computed, ref, watch, onMounted, nextTick } from 'vue';
```

B) Replace the existing `render()` function body to wrap bwip-js in try/catch:

```ts
function render(): void {
  if (!hasContent.value) return;
  if (!canvasRef.value) return;
  try {
    bwipjs.toCanvas(canvasRef.value, {
      bcid: props.element.symbology,
      text: contentText.value,
      scale: 3,
      height: 12,
      includetext: props.element.showText ?? true,
      paddingwidth: props.element.quietZone ?? 4,
      textsize: props.element.textFontSize ?? 10,
      textyoffset:
        props.element.textPosition === 'top'
          ? -(props.element.textFontSize ?? 10) - 2
          : 0,
      barcolor: (props.element.foregroundColor ?? '#000000').replace('#', ''),
      backgroundcolor: (props.element.backgroundColor ?? '#ffffff').replace('#', ''),
      textcolor: (props.element.foregroundColor ?? '#000000').replace('#', ''),
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[BarcodeElement] bwip-js render failed:', err);
  }
}
```

(Adjust the option keys to match what was previously passed. Preserve every option that was already there; only add the `try { ... } catch (err) { console.error(...) }` wrapper.)

C) Replace the existing watch invocation. Find the current `watch(() => ({ ... }), (next) => { ... }, { ...flags... });` block. Replace with:

```ts
watch(
  () => ({
    grid: props.element.grid,
    sym: props.element.symbology,
    content: props.element.content,
    binding: props.element.binding,
    fg: props.element.foregroundColor,
    bg: props.element.backgroundColor,
    qz: props.element.quietZone,
    showText: props.element.showText,
    tpos: props.element.textPosition,
    tfs: props.element.textFontSize,
    isResizing: props.isResizing,
  }),
  async (next) => {
    if (next.isResizing) return;
    await nextTick();
    render();
  },
  { deep: true, immediate: true },
);
```

Note: drop `flush: 'post'`. The `await nextTick()` inside the async callback achieves the same goal more robustly.

D) Add `onMounted` belt-and-braces fallback right after the watch:

```ts
onMounted(() => {
  // Defensive: ensure first render fires after DOM commit even if the
  // immediate watch raced with mount.
  render();
});
```

- [ ] **Step 2: QrElement — same defensive pattern**

Open `packages/template-renderer/src/elements/QrElement.vue`.

A) Add `onMounted` and `nextTick` to imports:

```ts
import { computed, ref, watch, onMounted, nextTick } from 'vue';
```

B) Wrap the `render()` function body (which calls `qrcode(0, ...)` and sets `qrSvg.value`) in try/catch:

```ts
function render(): void {
  if (!hasContent.value) {
    qrSvg.value = '';
    return;
  }
  try {
    const eccMap = { L: 'L', M: 'M', Q: 'Q', H: 'H' } as const;
    const ecc = (props.element.eccLevel ?? 'M') as 'L' | 'M' | 'Q' | 'H';
    const qr = qrcode(0, eccMap[ecc]);
    qr.addData(contentText.value);
    qr.make();
    const cellSize = 4;
    const margin = props.element.quietZone ?? 2;
    qrSvg.value = qr.createSvgTag({ cellSize, margin });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[QrElement] qrcode render failed:', err);
    qrSvg.value = '';
  }
}
```

C) Replace the watch invocation to use `await nextTick()` instead of `flush: 'post'`:

```ts
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
  async (next) => {
    if (next.isResizing) return;
    await nextTick();
    render();
  },
  { deep: true, immediate: true },
);
```

D) Add `onMounted` fallback:

```ts
onMounted(() => {
  render();
});
```

- [ ] **Step 3: Type-check + browser smoke**

```bash
docker compose -f docker-compose.dev.yml exec -T web sh -c 'cd /workspace/apps/web && NODE_OPTIONS=--max-old-space-size=4096 ./node_modules/.bin/vue-tsc --noEmit'
```

Browser: drop a barcode → confirm bars + text visible immediately. Drop a QR → confirm matrix visible immediately. Open DevTools console — no "[BarcodeElement] bwip-js render failed" or "[QrElement] qrcode render failed" errors.

- [ ] **Step 4: Commit**

```bash
git add packages/template-renderer/src/elements/BarcodeElement.vue \
        packages/template-renderer/src/elements/QrElement.vue
git commit -m "fix(renderer): defensive first-render for barcode/QR (try/catch + onMounted + nextTick)"
```

---

### Task 6: FieldManager bound/unbound colour + search filter (§D)

**Files:**
- Modify: `apps/web/src/designer/FieldManager.vue`

- [ ] **Step 1: Update imports**

Add `Search` to the existing lucide-vue-next named import (which already includes `Plus`, `Pencil`, `Trash2`):

```ts
// eslint-disable-next-line import/no-unresolved
import { Plus, Pencil, Trash2, Search } from 'lucide-vue-next';
```

Also confirm `ref`, `computed` are imported from 'vue' (likely already from prior iterations). If not, add `computed` to the existing vue import.

- [ ] **Step 2: Add search state + filteredFields computed**

In `<script setup>` near the top (after `useDesignerStore`), add:

```ts
const searchQuery = ref('');

const filteredFields = computed(() => {
  const q = searchQuery.value.trim().toLowerCase();
  if (!q) return store.fieldDefs;
  return store.fieldDefs.filter(
    (f) =>
      f.key.toLowerCase().includes(q) ||
      f.def.label.toLowerCase().includes(q),
  );
});
```

- [ ] **Step 3: Add search input to template**

In `<template>`, between the `<div class="tp-sub-head">…</div>` and `<div class="fm-body">…</div>`, insert:

```vue
<div v-if="store.fieldDefs.length > 5" class="fm-search">
  <Search :size="13" :stroke-width="2" />
  <input
    type="text"
    v-model="searchQuery"
    placeholder="搜索变量名或显示名…"
  />
</div>
```

- [ ] **Step 4: Update field-card loop + empty states**

In `<template>`, find the existing `<div v-for="{ key, def } in store.fieldDefs"`. Change the iterator to `filteredFields`:

```vue
<div
  v-for="{ key, def } in filteredFields"
  :key="key"
  class="field-card"
  :class="{ bound: store.usedFieldKeys.has(key) }"
  :title="store.usedFieldKeys.has(key) ? '已绑定' : '未绑定'"
>
  ...
</div>
```

Note the binding class changed from `unused: !store.usedFieldKeys.has(key)` to `bound: store.usedFieldKeys.has(key)` (binary green / default gray). The title also flipped.

Update the empty-state block (currently `v-if="store.fieldDefs.length === 0"`):

```vue
<div v-if="filteredFields.length === 0 && store.fieldDefs.length === 0" class="empty">
  尚未声明变量<br />点击 + 添加
</div>
<div v-else-if="filteredFields.length === 0" class="empty">
  没有匹配 "{{ searchQuery }}" 的变量
</div>
```

- [ ] **Step 5: Update CSS — bound/unbound colours + search bar**

In `<style scoped>` find and REPLACE the existing `.field-card` and `.field-card.unused` rules:

```css
/* Default = unbound = light gray */
.field-card {
  margin-bottom: 6px;
  padding: 8px 10px;
  border-radius: var(--tp-radius-item, 8px);
  border: 1px solid var(--tp-line-strong);
  background: #f5f5f6;
  font-size: 12px;
  transition: border-color 120ms ease, background 120ms ease;
}
.field-card:hover { border-color: var(--tp-accent); background: var(--tp-field-bg); }

/* Bound = light green */
.field-card.bound {
  background: #e6f5ec;
  border-color: #9bd5b3;
}
```

DELETE the `.field-card.unused { background: var(--tp-warn-bg); border-color: var(--tp-warn-line); }` rule entirely.

Append at the end of `<style scoped>`:

```css
.fm-search {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px 4px;
  color: var(--tp-ink-faint);
}
.fm-search input {
  flex: 1;
  border: 1px solid var(--tp-line-strong);
  border-radius: 6px;
  padding: 4px 8px;
  font-size: 12px;
  background: var(--tp-panel);
  color: var(--tp-ink);
  outline: none;
}
.fm-search input:focus { border-color: var(--tp-accent); }
```

- [ ] **Step 6: Type-check + browser smoke**

```bash
docker compose -f docker-compose.dev.yml exec -T web sh -c 'cd /workspace/apps/web && NODE_OPTIONS=--max-old-space-size=4096 ./node_modules/.bin/vue-tsc --noEmit'
```

Browser: add 6+ variables to see the search bar appear; verify bound variables show green when used by a canvas element; type in search → cards filter live.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/designer/FieldManager.vue
git commit -m "feat(designer): variables panel — bound/unbound colour + search filter"
```

---

### Task 7: Custom paper dialog — investigation + finish (§E.1)

**Files:**
- Modify: `apps/web/src/designer/CustomPaperDialog.vue` (possibly)
- Modify: `apps/web/src/designer/DesignerHeader.vue` (possibly)
- Modify: `apps/web/src/stores/designer.ts` (possibly — only if `setPaper` doesn't handle custom)

- [ ] **Step 1: Read the three files**

```bash
docker compose -f docker-compose.dev.yml exec -T web sh -c 'cat /workspace/apps/web/src/designer/CustomPaperDialog.vue'
docker compose -f docker-compose.dev.yml exec -T web sh -c 'grep -n "customDialogOpen\|onCustomPaperConfirm\|CustomPaperDialog" /workspace/apps/web/src/designer/DesignerHeader.vue'
docker compose -f docker-compose.dev.yml exec -T web sh -c 'grep -n "setPaper" /workspace/apps/web/src/stores/designer.ts'
```

Verify the click → dialog → confirm → store chain:
- `DesignerHeader.vue` has `customDialogOpen = ref(false)` and `onCustomPaperConfirm(size)` calling `store.setPaper(size)`.
- `<CustomPaperDialog v-model="customDialogOpen" @confirm="onCustomPaperConfirm" />` is mounted in template.
- The `⊕ 自定义…` ElDropdownItem calls `customDialogOpen = true`.
- `CustomPaperDialog.vue` emits `confirm({ w_mm, h_mm })`.
- `setPaper` in store accepts `{ w_mm: number; h_mm: number }` for custom paper.

- [ ] **Step 2: Relax canConfirm in CustomPaperDialog.vue**

In `apps/web/src/designer/CustomPaperDialog.vue` find `canConfirm`. Current logic likely:

```ts
const canConfirm = computed(() =>
  inRange.value && aspectOk.value && cellOptions.value.length > 0,
);
```

Replace with:

```ts
// Allow confirm even when cellOptions is empty — store falls back to cell=1
// for low-divisor papers (iteration 4 behavior). The dialog already shows
// a red warning explaining the constraint.
const canConfirm = computed(() => inRange.value && aspectOk.value);
```

- [ ] **Step 3: Manual flow validation**

Restart web if running:
```bash
docker compose -f docker-compose.dev.yml restart web
```

Open `/designer/new`. Click 📄 paper dropdown → click `⊕ 自定义…` → dialog opens. Enter `w=200`, `h=150`. Confirm shows preview `画布像素：800 × 600` + valid cell options. Click `确定`. Paper should change to 200×150mm, fitView re-centres.

Try `w=173`, `h=173` (both prime). Confirm button should be enabled (with warning text). Click confirm; paper becomes 173×173mm with `cell=1` fallback.

- [ ] **Step 4: If any hop is broken — fix and document**

If the dialog doesn't open: check `customDialogOpen` ref + dropdown item click handler.
If confirm doesn't fire: check `emit('confirm', ...)` inside the dialog + the `@confirm="onCustomPaperConfirm"` listener.
If store doesn't apply: check `setPaper` accepts object form (per iter 4 it does).

Apply the minimum fix(es) needed.

- [ ] **Step 5: Type-check + commit**

```bash
docker compose -f docker-compose.dev.yml exec -T web sh -c 'cd /workspace/apps/web && NODE_OPTIONS=--max-old-space-size=4096 ./node_modules/.bin/vue-tsc --noEmit'
git add apps/web/src/designer/CustomPaperDialog.vue
# Add any other files that needed fixes:
# git add apps/web/src/designer/DesignerHeader.vue apps/web/src/stores/designer.ts
git commit -m "fix(designer): finish custom paper dialog wiring; relax canConfirm to allow prime fallback"
```

---

### Task 8: PropertyPanel system-variable picker (§E.2)

**Files:**
- Modify: `apps/web/src/designer/PropertyPanel.vue`

- [ ] **Step 1: Add system-variable property rows in template**

In `apps/web/src/designer/PropertyPanel.vue`, find the existing `<div v-if="sel && sel.type === 'field'" class="row">…</div>` block (the binding row). After all type-specific rows for field / table, AND after the BarcodeProperties / QrProperties dispatches, but BEFORE the `<BorderControl>` block, insert two new rows for system elements:

```vue
<div v-if="sel && sel.type === 'system'" class="row">
  <span class="lbl">变量</span>
  <ElSelect
    size="small"
    :model-value="sel.variable"
    style="flex: 1"
    @change="(v: 'pageNo' | 'totalPages' | 'now' | 'printedBy') => store.updateElement(sel!.id, { variable: v } as Partial<TemplateElement>)"
  >
    <ElOption value="pageNo" label="页码 pageNo" />
    <ElOption value="totalPages" label="总页数 totalPages" />
    <ElOption value="now" label="当前时间 now" />
    <ElOption value="printedBy" label="操作人 printedBy" />
  </ElSelect>
</div>

<div v-if="sel && sel.type === 'system' && sel.variable === 'now'" class="row">
  <span class="lbl">格式</span>
  <ElInput
    size="small"
    :model-value="sel.format ?? 'YYYY-MM-DD HH:mm'"
    style="flex: 1"
    placeholder="YYYY-MM-DD HH:mm"
    @update:model-value="(v: string) => store.updateElement(sel!.id, { format: v } as Partial<TemplateElement>)"
  />
</div>
```

- [ ] **Step 2: Type-check + browser smoke**

```bash
docker compose -f docker-compose.dev.yml exec -T web sh -c 'cd /workspace/apps/web && NODE_OPTIONS=--max-old-space-size=4096 ./node_modules/.bin/vue-tsc --noEmit'
```

Browser: drop a "系统" element → PropertyPanel shows 变量 dropdown. Change to `now` → 格式 input appears below. Type a custom format. Save → restart web → reload → format persists.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/designer/PropertyPanel.vue
git commit -m "feat(designer): PropertyPanel — system variable picker (pageNo/totalPages/now/printedBy)"
```

---

### Task 9: Final acceptance pass

- [ ] **Step 1: Full vue-tsc + schema tests**

```bash
docker compose -f docker-compose.dev.yml exec -T web sh -c 'cd /workspace/apps/web && NODE_OPTIONS=--max-old-space-size=8192 ./node_modules/.bin/vue-tsc --noEmit'
docker compose -f docker-compose.dev.yml exec -T web sh -c 'cd /workspace/packages/schema && pnpm test'
```

Both should be green.

- [ ] **Step 2: Browser walk-through — iteration 7 acceptance**

Restart web container if needed:

```bash
docker compose -f docker-compose.dev.yml restart web
```

Open `http://localhost:5173/designer/new` (force-refresh `Ctrl+Shift+R` to defeat caching). Verify ALL items below:

§B:
1. PropertyPanel "样式 · 基础 → 字号" number input has no cropped spinner arrows (no arrows at all).
2. Click "清空" on canvas elements → centred Element Plus dialog appears (NOT the OS confirm).
3. Click 🗑 on a variable → centred Element Plus dialog appears.
4. In preview modal at 200% zoom → scrolling the paper does NOT move the zoom-control buttons.
5. Drop a small element (8×4 mm text) → outside grip pill sits clearly above the element with a visible gap.

§C:
6. Drop a barcode → bars + text visible immediately. No blank state.
7. Drop a QR → matrix visible immediately.
8. DevTools console has no "[BarcodeElement] bwip-js render failed" or "[QrElement] qrcode render failed" errors.

§D:
9. Add 6+ variables → search input appears.
10. Bound variable card shows light green background; unbound shows light gray.
11. Type "name" in search → cards filter live.

§E:
12. 📄 paper → ⊕ 自定义… → dialog opens. Enter 200×150 → confirm applies the paper.
13. Try 173×173 (both prime) → confirm enabled (warning shown); paper applied with cell=1 fallback.
14. Drop a 系统 element → property panel shows 变量 dropdown. Select `now` → 格式 input appears.

For any failure, log a follow-up issue; do NOT auto-fix silently.

- [ ] **Step 3: Report status — do NOT auto-merge to master**

Per repo convention, user merges to master. Report status + final commit list to user.

---

## Self-Review

Spec coverage:

**§A status clarification** — No code changes required; document-only.

**§B UI bugs**:
- B.1 number-input spinners → Task 1 (global CSS).
- B.2 ElMessageBox → Task 2 (CanvasElementsList + FieldManager + possibly DesignerHeader).
- B.3 preview zoom drift → Task 3 (PreviewView restructure).
- B.4 outside grip overlap → Task 4 (ElementGrip top: -28px).

**§C barcode blank**:
- BarcodeElement → Task 5 part A.
- QrElement → Task 5 part B.

**§D variables panel**:
- bound/unbound colour → Task 6 step 4 + 5.
- search filter → Task 6 steps 2-5.

**§E custom paper + system picker**:
- E.1 custom paper finish → Task 7.
- E.2 system variable picker → Task 8.

All spec requirements have a corresponding task. No placeholders ("TBD" / "implement later" / etc.) in the plan. Type/name consistency: `filteredFields`, `searchQuery`, `onClearAll`, `remove(key)`, `onCustomPaperConfirm`, `customDialogOpen`, `canConfirm`, `render()`, `hasContent`, `bound` class, `.pv-wrap`, `.pv-container`, `.pv-zoom`, `.tp-grip--outside top: -28px` — used consistently across tasks.
