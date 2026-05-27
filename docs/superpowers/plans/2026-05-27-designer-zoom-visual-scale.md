# 设计器缩放改为纯视觉缩放(transform: scale) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把设计器画布的 zoom 从"逐元素几何乘 zoom(字体不缩)"改为"整张纸 `transform: scale(zoom)`",使任何缩放比例下排版与 100%(=实际打印产出)完全一致,zoom 仅作视觉放大、不影响内容。

**Architecture:** 所有元素按固定 intrinsic 比例(`PX_PER_MM=4`,zoom=1 几何)渲染;`.tp-paper` 施加 `transform: scale(zoom)`(`transform-origin: top left`);外层新增 `.tp-paper-frame` 预留 `intrinsic×zoom` 布局尺寸(供 flex 居中/滚动)。`paperRef` 仍指向被 transform 的 `.tp-paper`(`onDrop` 取缩放后矩形)。拖拽/缩放/拖放公式(屏幕像素 ÷ `PX_PER_MM×zoom`)天然成立、不改。

**Tech Stack:** Vue3 SFC + Pinia;CSS transform;`apps/web` 设计器。

**Spec:** `docs/superpowers/specs/2026-05-27-designer-zoom-visual-scale-design.md`

**全局约定:** 容器内验证 `docker exec template_printing-web sh -c "cd /workspace/apps/web && pnpm run typecheck && pnpm run lint"`。提交走 husky,不 `--no-verify`,只 `git add` 本任务文件。`store.view.zoom` 为缩放因子;`store.paperPx` 为纸张 intrinsic 像素 `{w,h}`;`store.template.canvas.cell` 为格子 `{w,h}`(px)。

---

## File Structure

- Modify `apps/web/src/designer/CanvasElement.vue` —— `positionStyle` 去 `× z`(元素几何回到 intrinsic)。
- Modify `apps/web/src/designer/SnapGuides.vue` —— `mmToCanvasPx` 去 `× zoom`(辅助线在被缩放的纸内,用 intrinsic)。
- Modify `apps/web/src/designer/DesignerCanvas.vue` —— `cssVars` 改 intrinsic;新增 `paperStyle`(transform)与 `frameStyle`(预留尺寸);模板用 frame 包裹纸张。
- Modify `apps/web/src/styles/designer.css` —— 新增 `.tp-paper-frame`。

> 这 4 处是一个不可分割的几何一致性改动(任一单独改都会让画布临时错位),故合并为 Task 1 一次提交;Task 2 为多比例人工验证。

---

## Task 1: 缩放机制改为整张纸 transform: scale

**Files:** Modify `CanvasElement.vue`、`SnapGuides.vue`、`DesignerCanvas.vue`、`designer.css`。

- [ ] **Step 1: `CanvasElement.vue` —— positionStyle 去 zoom**

把 `apps/web/src/designer/CanvasElement.vue` 的 `positionStyle`(约 39-48 行):
```ts
const PX_PER_MM = 4;
const positionStyle = computed(() => {
  const z = store.view.zoom;
  return {
    left: `${props.element.anchor.x * PX_PER_MM * z}px`,
    top: `${props.element.anchor.y * PX_PER_MM * z}px`,
    width: `${props.element.anchor.w * PX_PER_MM * z}px`,
    height: `${props.element.anchor.h * PX_PER_MM * z}px`,
    zIndex: props.element.style.zIndex ?? 0,
  };
});
```
改为(去掉 `z`,元素几何为 intrinsic;纸张的 transform 会统一缩放):
```ts
const PX_PER_MM = 4;
const positionStyle = computed(() => ({
  left: `${props.element.anchor.x * PX_PER_MM}px`,
  top: `${props.element.anchor.y * PX_PER_MM}px`,
  width: `${props.element.anchor.w * PX_PER_MM}px`,
  height: `${props.element.anchor.h * PX_PER_MM}px`,
  zIndex: props.element.style.zIndex ?? 0,
}));
```
若 `store.view.zoom` 在该文件其他地方未再被使用,无需额外清理(`store` 仍用于 `selectedIds` 等)。

- [ ] **Step 2: `SnapGuides.vue` —— mmToCanvasPx 去 zoom**

把 `apps/web/src/designer/SnapGuides.vue`(约 14-18 行):
```ts
const PX_PER_MM = 4;
function mmToCanvasPx(mm: number): number {
  return mm * PX_PER_MM * store.view.zoom;
}
```
改为:
```ts
const PX_PER_MM = 4;
function mmToCanvasPx(mm: number): number {
  return mm * PX_PER_MM;
}
```
(辅助线 DOM 现在位于被 `transform: scale` 缩放的 `.tp-paper` 内部,坐标须用 intrinsic;若 `store` 在该文件无其他用途导致 lint 报未使用,删除 `const store = useDesignerStore()` 及其 import——先确认无其他引用再删。)

- [ ] **Step 3: `DesignerCanvas.vue` —— cssVars 改 intrinsic + 新增 paperStyle/frameStyle**

把 `apps/web/src/designer/DesignerCanvas.vue` 的 `cssVars`(约 14-23 行):
```ts
const cssVars = computed(() => {
  const z = store.view.zoom;
  const px = store.paperPx;
  return {
    '--cell-w': `${store.template.canvas.cell.w * z}px`,
    '--cell-h': `${store.template.canvas.cell.h * z}px`,
    '--canvas-w': `${px.w * z}px`,
    '--canvas-h': `${px.h * z}px`,
  };
});
```
改为(intrinsic)并在其后新增 `paperStyle` 与 `frameStyle`:
```ts
const cssVars = computed(() => {
  const px = store.paperPx;
  return {
    '--cell-w': `${store.template.canvas.cell.w}px`,
    '--cell-h': `${store.template.canvas.cell.h}px`,
    '--canvas-w': `${px.w}px`,
    '--canvas-h': `${px.h}px`,
  };
});

// 纸张：intrinsic 尺寸 + 整体缩放（zoom=1 时不加 transform，保证打印/100% 零副作用）
const paperStyle = computed(() => {
  const z = store.view.zoom;
  return {
    ...cssVars.value,
    width: 'var(--canvas-w)',
    height: 'var(--canvas-h)',
    transform: z === 1 ? 'none' : `scale(${z})`,
    transformOrigin: 'top left',
  };
});

// frame：预留缩放后的布局尺寸（transform 不占布局空间），使 flex 居中/滚动正常
const frameStyle = computed(() => {
  const z = store.view.zoom;
  const px = store.paperPx;
  return {
    width: `${px.w * z}px`,
    height: `${px.h * z}px`,
  };
});
```

- [ ] **Step 4: `DesignerCanvas.vue` —— 模板用 frame 包裹纸张**

把模板中的纸张块(约 142-162 行):
```html
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
```
改为(外层 frame + 内层被 transform 的 paper;`paperRef` 仍在 `.tp-paper`):
```html
      <div class="tp-paper-frame" :style="frameStyle">
        <div
          ref="paperRef"
          class="tp-paper"
          :class="{
            'is-dragging': store.isResizing,
            'is-drop-target': isDropTarget,
            heavy: store.template.elements.length > 500,
          }"
          :style="paperStyle"
          @click="clickPaperBackground"
          @dragover="onDragOver"
          @dragleave="onDragLeave"
          @drop="onDrop"
        >
          <CanvasElement v-for="el in store.template.elements" :key="el.id" :element="el" />
          <SnapGuides v-if="store.isResizing" :guides="store.guides" />
        </div>
      </div>
```
(不再单独内联 `...cssVars`/width/height —— 全部并入 `paperStyle`。)

- [ ] **Step 5: `designer.css` —— 新增 `.tp-paper-frame`**

在 `apps/web/src/styles/designer.css` 的 `.tp-paper` 规则(约 203 行)之前或之后,新增:
```css
/* 缩放外框：预留 transform 缩放后的布局尺寸，供 flex 居中/滚动（transform 本身不占布局） */
.tp-paper-frame {
  position: relative;
  flex-shrink: 0;
}
```
`.tp-paper` 现有规则保持不变(它不再是 flex 子项,`flex-shrink: 0` 无害,可保留)。

- [ ] **Step 6: typecheck + lint**

Run: `docker exec template_printing-web sh -c "cd /workspace/apps/web && pnpm run typecheck && pnpm run lint"`
Expected: 0 错误、0 告警(若 SnapGuides 的 `store` 变为未使用,按 Step 2 提示清理后再跑)。

- [ ] **Step 7: 提交**

```bash
git add apps/web/src/designer/CanvasElement.vue apps/web/src/designer/SnapGuides.vue apps/web/src/designer/DesignerCanvas.vue apps/web/src/styles/designer.css
git commit -m "fix(web): 设计器缩放改为整张纸 transform: scale（纯视觉缩放，任何比例排版与 100%/打印一致）"
```

---

## Task 2: 多比例人工验证

**Files:** 无代码改动(纯验证;若发现问题回到 Task 1 修)。前置:web 容器已加载最新代码(改 Vue 源 Vite 会热更新;若无反应 `docker restart template_printing-web`)。

- [ ] **Step 1: 排版一致性(核心)**

打开「扬力出门证」模板,依次切到 **50% / 66% / 100% / 150% / 200%**:
- 标题、字段、下划线等所有元素的**相对位置与文本排版在各比例下完全一致**(无重叠、无溢出、无异常换行差异)。
- 对照 100% 与「预览」弹窗:排版一致。
Expected: 不再出现 66% 时的重叠/乱换行(对比修复前截图)。

- [ ] **Step 2: 拖拽 / 缩放 / 拖放**

- 在 **66%** 和 **150%** 下拖动一个元素:落点跟手、吸附与边界 clamp 正常;切回 100% 位置与视觉一致。
- 在非 100% 下用手柄改元素宽高:尺寸跟手、与视觉一致。
- 从左侧组件区拖一个新元素到画布某点(非 100%):落点正确(在光标处)。
Expected: 与 100% 行为一致,无偏移。

- [ ] **Step 3: 吸附辅助线 / 选中编辑**

- 非 100% 下拖动触发吸附:红色辅助线与元素边/中线对齐(不偏移)。
- 任意比例点击选中元素 → 右侧属性面板显示属性;改字号/位置/内容 → 生效且画布更新正常。
Expected: 辅助线对齐准确;属性编辑正常。

- [ ] **Step 4: 打印 sanity**

当前 zoom 设为 66%,点「立即打印」(`onBeforePrint` 会强制 zoom=1)→ 打印预览中输出为正常 100% 尺寸(不被 66% 缩放)。
Expected: 打印输出与 zoom 无关、正确。

- [ ] **Step 5: 文档同步 + 提交**

在 `docs/PROGRESS.md` 的 `### 2026-05-27` 段顶部追加:
```markdown
- **fix：设计器缩放改为纯视觉缩放(通用)** —— 画布元素改为固定 intrinsic 比例渲染、整张纸套 `transform: scale(zoom)`(外层 frame 预留缩放尺寸),修复非 100%(如 66%)缩放时字体不随盒子缩放导致的文本重叠/异常换行。任何比例下排版与 100% 即实际打印产出完全一致;拖拽/缩放/拖放/吸附/属性编辑不受影响(坐标公式基于屏幕像素÷(4×zoom),对缩放方式不敏感);打印前已强制 zoom=1,无副作用。不改渲染器/预览/打印/模板数据。
```
```bash
git add docs/PROGRESS.md
git commit -m "docs: 同步设计器纯视觉缩放修复"
```

---

## Self-Review(写计划后自检)

**Spec 覆盖:** §改动点① CanvasElement 去 zoom → Task 1 Step 1 ✅;②DesignerCanvas intrinsic+transform+frame → Step 3/4/5 ✅;③SnapGuides 去 zoom → Step 2 ✅;`paperRef` 在被 transform 的纸 → Step 4(ref 保持在 `.tp-paper`)✅;§不需要改(拖拽/拖放/选中/编辑/autoScroll/fitView/渲染器)→ 计划未触碰,Task 2 验证 ✅;§验证(多比例一致 + 拖拽/缩放/拖放/吸附/选中 + typecheck/lint)→ Task 2 ✅;打印 zoom=1 安全 → Step 4 ✅。

**占位符扫描:** 无 TBD/TODO;每步含完整 before/after 代码与确切命令。

**类型一致性:** `cssVars`/`paperStyle`/`frameStyle` 均 `computed`,`paperStyle` 引用 `cssVars.value` 一致;`store.view.zoom`/`store.paperPx`/`store.template.canvas.cell` 为既有读取,签名未改;`paperRef` 类型不变。模板里 `frameStyle`/`paperStyle` 与 script 定义名一致。
