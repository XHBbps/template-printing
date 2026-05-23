# Designer Iteration 7 — Design Spec

**Date:** 2026-05-22 (after iteration 5+6 ship)
**Status:** Approved (brainstorming)

9 issues raised after iter 5+6, grouped into 5 batches.

| Batch | Topic | Items |
|---|---|---|
| § A | Status clarification (no code) | #1 autonumber rules, #2 system component capabilities |
| § B | UI bugs | #5 number-input spinner cropped, #6 confirm dialog centring, #8 preview zoom drift on scroll, #9 outside grip overlap |
| § C | Renderer bug | #3 barcode blank on drop |
| § D | Variables panel | #4 bound/unbound colour + multi-variable strategy |
| § E | Custom paper + System variable picker | #7 custom paper unfinished + missing system-variable UI |

---

## § A · Status clarification (#1 #2)

**No code changes** — clarify intent for users / future contributors.

### A.1 Autonumber generation rules

Schema (unchanged): `{ type: 'autonumber', sequence: string, format: string='0000000', prefix: string='' }`.

- `sequence` — counter namespace (e.g. `'order_2026'`).
- `prefix` — string concatenated before the number.
- `format` — zero-padding template; length determines pad width (`'0000000'` = 7 digits).

**Runtime semantics**: at print time the API queries / increments the counter named by `sequence` (persistent in postgres, locked via `SELECT FOR UPDATE`) and renders `${prefix}${count.toString().padStart(format.length, '0')}`. Multi-user concurrent print calls produce strictly monotonic values.

**Current status**: designer + schema + property panel support editing the three fields. Renderer shows a placeholder in design mode. The actual counter API is **Plan 5 (Print API) territory** — not implemented yet.

### A.2 System component capabilities

Schema (unchanged): `{ type: 'system', variable: 'pageNo'|'totalPages'|'now'|'printedBy', format?: string }`.

**Runtime semantics**: at print time the renderer resolves the variable name to a concrete value:
- `pageNo` → current page (1, 2, 3…)
- `totalPages` → total pages in the current print job
- `now` → server timestamp formatted via `format` (default `'YYYY-MM-DD HH:mm'`)
- `printedBy` → display name of the user who issued the print (from JWT)

**Current status**: schema supports it; renderer renders a placeholder in design mode. Property panel currently has **no UI to choose `variable`** — this is fixed in § E.2 below.

---

## § B · UI bugs (#5 #6 #8 #9)

### B.1 Number input spinner cropped (#5)

**Root cause**: `<input type="number">` elements in PropertyPanel + CustomPaperDialog + FieldManager dialog have `padding: 3px 6px` + `font-size: 12px` → total height ~18px. The native spinner needs ≥ 20px to render fully; the top arrow gets cropped.

**Fix**: globally hide native spinners inside the designer:

```css
/* apps/web/src/styles/designer.css — append */
.designer-root input[type='number']::-webkit-outer-spin-button,
.designer-root input[type='number']::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}
.designer-root input[type='number'] {
  -moz-appearance: textfield;
}
```

This catches every number input under `.designer-root`. No per-component change needed.

Preview the dialog inside `<ElDialog>` Element-Plus modal is teleported to body, NOT inside `.designer-root`. Add a selector for that too:

```css
.el-dialog input[type='number']::-webkit-outer-spin-button,
.el-dialog input[type='number']::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}
.el-dialog input[type='number'] { -moz-appearance: textfield; }
```

(Place in the same global stylesheet, not scoped.)

Existing `.swi-num` and `.axis-input` rules already hide spinners — keep them; the new global is the safety net.

### B.2 Confirm dialog centring + theming (#6)

Replace every `window.confirm` call with Element Plus's `ElMessageBox.confirm` (themed + centred):

**Affected sites**:

1. `apps/web/src/designer/CanvasElementsList.vue` `onClearAll`:

```ts
import { ElMessageBox } from 'element-plus';

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

2. `apps/web/src/designer/FieldManager.vue` `remove(key)`:

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

3. **Grep** `apps/web/src/` for any other `window.confirm` and replace consistently. (`DesignerHeader.vue` `exitToHome` has one; replace it too with the same pattern.)

`ElMessageBox.confirm` is teleported to body but centred horizontally + vertically by `center: true`, and follows the existing Element Plus purple-accent theme.

### B.3 PreviewView zoom control drifts on scroll (#8)

**Root cause**: `.pv-zoom` is `position: absolute` inside `.pv-container` (which has `overflow: auto`). Absolutely-positioned children of a scrolling ancestor scroll with the container. As the user scrolls, the zoom control slides off-screen.

**Fix**: restructure the modal body so the zoom control is a SIBLING of the scrollable container, not a child:

```vue
<!-- Replace existing inside ElDialog body -->
<div class="pv-wrap">
  <div ref="modalContainerRef" class="pv-container">
    <div class="pv-paper-wrap" :style="{ transform: `scale(${previewZoom})`, transformOrigin: 'top left' }">
      <div class="tp-paper" :style="paperStyle">
        <!-- existing renderer -->
      </div>
    </div>
  </div>
  <div class="pv-zoom">
    <button class="pv-zoom-btn" @click="onFitPreview">Fit</button>
    <button v-for="z in zoomOptions" :key="z" class="pv-zoom-btn"
      :class="{ on: Math.abs(previewZoom - z) < 0.01 }"
      @click="choosePreviewZoom(z)">
      {{ Math.round(z * 100) }}%
    </button>
  </div>
</div>
```

CSS changes:

```css
.pv-wrap {
  position: relative;
  width: 100%;
  height: 70vh;
  border-radius: 8px;
  overflow: hidden;            /* clip the absolute zoom from spilling */
}
.pv-container {
  width: 100%;
  height: 100%;
  overflow: auto;
  background: var(--tp-canvas-bg, #f2f2f5);
}
.pv-zoom {
  position: absolute;
  bottom: 12px;
  right: 12px;
  z-index: 5;
  /* existing visual styles unchanged */
}
```

The zoom control now sits anchored to the modal's visible area; scrolling the paper doesn't move it.

### B.4 Outside grip overlap (#9)

**Root cause**: `.tp-grip--outside` is `position: absolute; top: -14px; height: 20px;` — pill bottom edge is at `-14 + 20 = 6px` (i.e. 6 px **inside** the element top edge). Combined with corner handles extending up to `top: -5px` (with 5 px radius → reach -10 px), the outside grip overlaps both the element body and the corner handles.

**Fix**: pull the pill further up so it sits clearly above the element with a visible gap:

```css
.tp-grip--outside {
  top: -28px;             /* was -14px; now bottom of pill = -28 + 20 = -8 px (8 px gap above element) */
  background: var(--tp-panel);
  border: 1.5px solid var(--tp-accent);
  border-radius: 8px;
  width: 32px;
  height: 20px;
  box-shadow: var(--tp-accent-shadow);
  padding: 0;
}
```

Inside-grip styling (`.tp-grip` at `top: 4px`) for `rs >= 6` elements is unchanged.

---

## § C · Barcode renders blank on drop (#3)

**Root cause hypothesis**: iter 5 Task 4 rewrote `BarcodeElement.vue` to consolidate the render in a single `watch(..., { deep: true, immediate: true, flush: 'post' })`. The `immediate: true` watch fires the callback once synchronously during setup, but `flush: 'post'` defers it to after the next DOM update. On the very first render, this race against `canvasRef` binding occasionally drops the call — or bwip-js silently throws because `canvasRef.value` is still `null` at that moment.

**Fix** — three-step defence in depth:

**1. Render guard + error logging**:

```ts
function render(): void {
  if (!hasContent.value) return;
  if (!canvasRef.value) return;       // bail if canvas not mounted yet
  try {
    bwipjs.toCanvas(canvasRef.value, {
      bcid: props.element.symbology,
      text: contentText.value,
      scale: 3,
      height: 12,
      includetext: props.element.showText ?? true,
      paddingwidth: props.element.quietZone ?? 4,
      textsize: props.element.textFontSize ?? 10,
      textyoffset: props.element.textPosition === 'top'
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

**2. `onMounted` fallback** (ensures render runs after DOM commit even if the initial watch raced):

```ts
import { onMounted } from 'vue';

onMounted(() => {
  // Belt-and-braces: ensure first render fires after the DOM is fully committed.
  render();
});
```

**3. Re-render on canvas re-mount** — when `hasContent` flips false → true (user types content into an empty element), the `<canvas v-if="hasContent">` newly mounts; the watch fires via dep change. Add a small `nextTick` to ensure DOM is ready:

```ts
import { nextTick } from 'vue';

watch(
  () => ({ /* existing deps */ }),
  async (next) => {
    if (next.isResizing) return;
    await nextTick();           // guarantee DOM up-to-date before bwip-js
    render();
  },
  { deep: true, immediate: true },
);
```

Removing `flush: 'post'` and replacing with `await nextTick()` inside the callback is more robust because the await happens inside the callback — `canvasRef` is always bound by then.

**Apply the same three fixes to `QrElement.vue`** (the iter 5 newly-created sibling uses the same pattern).

### Acceptance — § C

- Drop a barcode → bars + text visible immediately. No empty/blank canvas.
- Drop a QR → matrix visible immediately.
- Open browser console — no "[BarcodeElement] bwip-js render failed" errors.

---

## § D · Variables panel (#4)

### D.1 Bound / unbound colour cue

Replace the iter-6 "warm yellow for unused" with a two-state colour system:

- **Bound** (variable is referenced by at least one element on the canvas): light green background, soft green border.
- **Unbound** (no element references it): light gray background, default border.

CSS (replace `.field-card.unused` rule in `FieldManager.vue` `<style scoped>`):

```css
/* Default = unbound = light gray */
.field-card {
  background: #f5f5f6;
  border: 1px solid var(--tp-line-strong);
}

/* Bound = light green */
.field-card.bound {
  background: #e6f5ec;
  border-color: #9bd5b3;
}

/* Drop the .field-card.unused rule entirely */

/* Hover keeps the accent purple feel as before */
.field-card:hover { border-color: var(--tp-accent); }
```

Template binding (replace the existing `:class="{ unused: ... }"`):

```vue
<div
  class="field-card"
  :class="{ bound: store.usedFieldKeys.has(key) }"
  :title="store.usedFieldKeys.has(key) ? '已绑定' : '未绑定'"
>
```

Remove the `:title="!store.usedFieldKeys.has(key) ? '未使用' : ''"` previously added in iter 6 (it conveyed the same info less cleanly).

### D.2 Multi-variable strategy — search filter (chosen over pagination)

For panels of variables, **search filter is preferred over pagination** because:
- Variables are looked up by name (typing "name" matches), not scanned visually.
- Bound/unbound colour cues are useful when ALL variables are visible — pagination hides the variable you want to bind on another page.
- Typical project has < 30 variables; pagination is overkill.

Add a search input at the top of FieldManager's body:

```vue
<div class="tp-section-top field-mgr">
  <div class="tp-sub-head">
    <span class="tp-sub-title">变量 · 共 {{ store.fieldDefs.length }} 个</span>
    <button class="tp-sub-add" title="添加变量" @click="openAdd">
      <Plus :size="14" :stroke-width="2" />
    </button>
  </div>
  <div v-if="store.fieldDefs.length > 5" class="fm-search">
    <Search :size="13" :stroke-width="2" />
    <input
      type="text"
      v-model="searchQuery"
      placeholder="搜索变量名或显示名…"
    />
  </div>
  <div class="fm-body">
    <!-- v-for="{ key, def } in filteredFields" — see Step 3 below -->
  </div>
  ...
</div>
```

Script additions to FieldManager.vue:

```ts
import { ref, computed } from 'vue';
import { Search } from 'lucide-vue-next'; // already imports Plus / Pencil / Trash2 — add Search here

const searchQuery = ref('');

const filteredFields = computed(() => {
  const q = searchQuery.value.trim().toLowerCase();
  if (!q) return store.fieldDefs;
  return store.fieldDefs.filter((f) =>
    f.key.toLowerCase().includes(q) || f.def.label.toLowerCase().includes(q),
  );
});
```

Replace the `v-for="{ key, def } in store.fieldDefs"` in the cards loop with `v-for="{ key, def } in filteredFields"`. The empty-state message updates too:

```vue
<div v-if="filteredFields.length === 0 && store.fieldDefs.length === 0" class="empty">
  尚未声明变量<br />点击 + 添加
</div>
<div v-else-if="filteredFields.length === 0" class="empty">
  没有匹配 "{{ searchQuery }}" 的变量
</div>
```

CSS for search bar:

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

Note the search bar is hidden when fewer than 6 variables exist (clutter avoidance).

### Acceptance — § D

- Bound variable card has green background, unbound has gray.
- Title attribute reads `已绑定` / `未绑定` accordingly.
- Type into search → cards filter live, count in sub-title still shows full count.
- Search disappears when total variables ≤ 5.

---

## § E · Custom paper + System variable picker (#7 + § A.2 補)

### E.1 Custom paper — investigate + finish

**Audit scope** (impl phase first reads each file, confirms behavior):

1. `apps/web/src/designer/CustomPaperDialog.vue` — does the dialog open correctly when triggered? Inputs accept values? Confirm button enabled state correct?
2. `apps/web/src/designer/DesignerHeader.vue` — does `⊕ 自定义…` ElDropdownItem click open `customDialogOpen = true`? Is `<CustomPaperDialog v-model="customDialogOpen" @confirm="onCustomPaperConfirm" />` mounted? Does `onCustomPaperConfirm` call `store.setPaper(size)`?
3. `apps/web/src/stores/designer.ts` `setPaper(paper)` — does it correctly accept `{ w_mm, h_mm }` (object form, vs string preset form)? Per iter 4 schema, yes — `Template['canvas']['paper']` is the union.

**Expected flow**:
- User clicks 📄 paper dropdown → sees presets + `⊕ 自定义…` at the bottom.
- Click `⊕ 自定义…` → dialog opens.
- Enter w=200, h=150 → live preview shows `画布像素：800 × 600`, cell options listed.
- Click `确定` → dialog emits `confirm({ w_mm: 200, h_mm: 150 })` → header calls `store.setPaper({ w_mm: 200, h_mm: 150 })`.
- store applies new paper, recomputes cell options, calls `fitView()`.

**Most likely broken**: either the dialog's `:disabled` on Confirm is too strict (rejects valid inputs), or `store.setPaper` doesn't propagate orientation correctly for custom paper (custom always treated as portrait — fine), or the dialog doesn't emit the confirm event correctly.

**Impl strategy**:
1. Read all three files.
2. Add `console.log` at each step.
3. Manually click through.
4. Fix the broken hop.
5. Remove the console.logs before commit.

Confirm-button enabled condition in the dialog should be:

```ts
const canConfirm = computed(() =>
  inRange.value && aspectOk.value && cellOptions.value.length > 0
);
```

If the user wants a paper that has zero common divisors (e.g., 173×173 mm — both prime), the dialog should still allow confirm with a warning + fallback to `cell: 1`. Relax `canConfirm` to:

```ts
const canConfirm = computed(() => inRange.value && aspectOk.value);
```

(`cellOptions.length === 0` falls back to `cell=1px` in the store per iter 4; the dialog already shows a red warning in that case.)

### E.2 System component variable picker (補 § A.2)

In `apps/web/src/designer/PropertyPanel.vue`, add a property row for `sel.type === 'system'`. Place it next to other type-specific rows (after the binding row, before BarcodeProperties / QrProperties):

```vue
<div v-if="sel && sel.type === 'system'" class="row">
  <span class="lbl">变量</span>
  <ElSelect
    size="small"
    :model-value="sel.variable"
    style="flex: 1"
    @change="(v: 'pageNo'|'totalPages'|'now'|'printedBy') => store.updateElement(sel!.id, { variable: v } as Partial<TemplateElement>)"
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
    @update:model-value="(v: string) => store.updateElement(sel!.id, { format: v } as Partial<TemplateElement>)"
    placeholder="YYYY-MM-DD HH:mm"
  />
</div>
```

The format field shows only when `variable === 'now'`.

---

## Out of scope

- Implementing the autonumber counter API (Plan 5).
- Implementing system-variable resolution at print time (Plan 5).
- Pagination of variables (search is sufficient for foreseeable project size).
- Yellow/red colour states for variables (binary green/gray is enough).
- Custom paper presets persistence to localStorage (covered by template draft already).

## Acceptance checklist

§B:
- [ ] No `<input type="number">` in designer shows cropped spinner arrows.
- [ ] Clicking "清空" on canvas elements opens a centred Element Plus dialog matching purple theme (not the OS confirm).
- [ ] Clicking 🗑 on a variable opens a centred Element Plus dialog.
- [ ] In preview modal at 200% zoom, scrolling the paper does NOT move the zoom control buttons.
- [ ] On a small element (rs < 6 cells), the outside grip pill sits clearly above the element with a visible gap; corner handles don't visually overlap with the grip body.

§C:
- [ ] Dropping a barcode → immediately renders bars + text. No blank state.
- [ ] Dropping a QR → immediately renders matrix.
- [ ] No "bwip-js render failed" errors in console.

§D:
- [ ] Bound variable card has light green background; unbound has light gray.
- [ ] Title attribute reflects bound/unbound state.
- [ ] Search input visible when ≥ 6 variables.
- [ ] Typing filters variables in real time; "没有匹配" message when query has no hits.

§E:
- [ ] Custom paper dialog opens, accepts w/h, clicking confirm applies the custom size to the canvas.
- [ ] Edge case: 173×173 mm (both prime) — confirm is still allowed; cell falls back to 1.
- [ ] System element: variable dropdown appears in property panel; `now` shows additional format input.
