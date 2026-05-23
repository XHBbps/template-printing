# Designer Iteration 11 — Spec

**Goal:** 修复 7 类问题：
- §G **Critical** — iter 9 T5 留下的 zoom 渲染 bug（元素位置/尺寸未乘 zoom）
- §A 居中辅助线在中心区域消失
- §B 元素拖不到纸张右侧（视口外区域看不见）
- §C 拖动控件位置规则反了
- §D 元素最大尺寸确认 = 不超出纸张
- §E TemplateRenderer 与设计器渲染对齐 + QR 漏渲染
- §F 打印 zoom 重置

**核心原则**：先修底层数据 / 渲染问题（§G、§E、§F），再做 UX 增强（§A、§B、§C）。§D 仅文档化。

---

## §G — 元素 zoom 渲染 (Critical)

### 现状

`apps/web/src/designer/CanvasElement.vue:42-47` 当前：
```ts
const positionStyle = computed(() => ({
  left: `${props.element.anchor.x * PX_PER_MM}px`,
  top: `${props.element.anchor.y * PX_PER_MM}px`,
  width: `${props.element.anchor.w * PX_PER_MM}px`,
  height: `${props.element.anchor.h * PX_PER_MM}px`,
}));
```

但 `DesignerCanvas.vue:13-22` 的 `--canvas-w` / `--canvas-h` 是 `paperPx × zoom`。纸张随 zoom 缩放、元素不缩放 → zoom ≠ 1 时元素位置、大小、跟手都错。

### 后果

| zoom | 表现 |
|---|---|
| 1 | 正确 |
| 1.21 (用户截图) | 元素显示偏小约 17%，位置偏左上 |
| 2 | 拖动移 8px，元素只移 4px（跟手延迟一半）|
| 0.5 | 元素溢出纸张右下 |

这是 iter 9 T5 把 `calc(${grid.c} * var(--cell-w))`（cell-w 含 zoom）改成 `${anchor.x * 4}` 时漏掉的。

### 修复

```ts
const positionStyle = computed(() => ({
  left: `${props.element.anchor.x * PX_PER_MM * store.view.zoom}px`,
  top: `${props.element.anchor.y * PX_PER_MM * store.view.zoom}px`,
  width: `${props.element.anchor.w * PX_PER_MM * store.view.zoom}px`,
  height: `${props.element.anchor.h * PX_PER_MM * store.view.zoom}px`,
}));
```

usePointerDrag 的 mm 计算（`dxMm = clientDelta / (PX_PER_MM * zoom)`）保持不变 —— 它已是正确的。

### 验证

- zoom=1 时无回归
- zoom=2 时元素跟随鼠标 1:1
- zoom=0.5 时小纸张元素不溢出
- snap guides 显示位置和元素重合（SnapGuides 已用 zoom，本身正确）

---

## §A — 双阈值 snap guides

### 现状

`apps/web/src/designer/snapGuides.ts` 用 `threshold = SNAP_THRESHOLD_MM (1.5mm)` 同时控制吸附位置 + 辅助线可视。用户报告「在居中区域消失」是因为越过 1.5mm 窗口后线立即消失。

### 修复

拆分两个阈值：
- `SNAP_THRESHOLD_MM = 1.5` — 吸附位置（不变）
- `GUIDE_THRESHOLD_MM = 5` — 显示辅助线（新增）

逻辑：
- 在 5mm 内的候选对齐线全部加到 `hitV` / `hitH` 渲染
- 在 1.5mm 内的最近一条用于位置吸附

修改 `snapGuides.ts`：

```ts
export const SNAP_THRESHOLD_MM = 1.5;
export const GUIDE_THRESHOLD_MM = 5;

// computeSnap 增加 guideThreshold 参数：
export function computeSnap(input: SnapInput): SnapResult {
  // ... 现有 bestV / bestH 逻辑保持，仅决定 snap 位置 ...

  // 新增：用更宽的 guideThreshold 收集所有近距离的对齐线
  const hitV: number[] = [];
  const hitH: number[] = [];
  for (const tl of t.v) {
    const newPos = tl + snapDx;
    for (const cl of c.v) {
      if (Math.abs(cl - newPos) <= input.guideThreshold) hitV.push(cl);
    }
  }
  // 同理 hitH
  // ...
}
```

调用方 `usePointerDrag.onGripDown`：
```ts
const snap = computeSnap({
  target: ...,
  others,
  paper,
  threshold: ev.altKey ? 0 : SNAP_THRESHOLD_MM,
  guideThreshold: ev.altKey ? 0 : GUIDE_THRESHOLD_MM,
});
```

### 验证

- 离中心 3mm 时，辅助线显示（不吸附）
- 离中心 1mm 时，辅助线显示 + 位置吸附
- 离中心 6mm 时，不显示也不吸附
- Alt 按住时关闭两者

---

## §B — Canvas 拖动接近边缘自动滚动

### 现状

`.tp-canvas-area { overflow: auto }` 已设。但用户拖元素时，鼠标到达视口边缘就停了 —— 看不见纸张右侧就拖不过去。

### 修复

`usePointerDrag.ts` 的 `onGripDown` 和 `onResizeDown` 的 `onMove` 中加入「边缘检测 + 自动滚动」。

```ts
const EDGE_PX = 30;     // 距 canvas-area 边缘 30px 内触发自动滚动
const SCROLL_STEP = 8;  // 每帧滚动 px

function autoScroll(ev: PointerEvent): void {
  const ca = document.querySelector('.tp-canvas-area') as HTMLElement | null;
  if (!ca) return;
  const rect = ca.getBoundingClientRect();
  let dx = 0, dy = 0;
  if (ev.clientX < rect.left + EDGE_PX) dx = -SCROLL_STEP;
  else if (ev.clientX > rect.right - EDGE_PX) dx = SCROLL_STEP;
  if (ev.clientY < rect.top + EDGE_PX) dy = -SCROLL_STEP;
  else if (ev.clientY > rect.bottom - EDGE_PX) dy = SCROLL_STEP;
  if (dx || dy) ca.scrollBy(dx, dy);
}

// 在 onMove 末尾调用 autoScroll(ev)
```

### 验证

- 拖元素到 canvas-area 右缘 30px 内：canvas 自动向右滚动
- 元素继续跟随鼠标，能到达纸张右边缘
- 鼠标离开边缘区域，滚动停止

---

## §C — Grip 位置规则翻转

### 现状

`apps/web/src/designer/CanvasElement.vue:33-39` 当前：
```ts
const useInsideGrip = computed(() => {
  if (props.element.grid.rs < 6) return true;
  if (props.element.grid.cs < 8) return true;
  if (isNearTop.value) return true;
  return false;
});
```

`isSmall = !useInsideGrip`。当前**小元素用 inside（裸点），大元素用 outside（胶囊）**。用户要的是反过来。

### 修复

#### C.1 翻转规则
```ts
// 用 anchor.mm 而不是 grid.cell，规则更稳定（与 cell 大小无关）
const canFitInside = computed(() => {
  return props.element.anchor.w >= 10 && props.element.anchor.h >= 8;
});
const isNearTop = computed(() => props.element.anchor.y < 8);

const gripMode = computed<'inside' | 'outside-above' | 'outside-below'>(() => {
  if (canFitInside.value) return 'inside';
  if (isNearTop.value) return 'outside-below'; // 太小且贴顶 → 翻到下方
  return 'outside-above';
});
```

#### C.2 ElementGrip.vue 三态 prop + 三态样式

`ElementGrip.vue`：
```ts
defineProps<{ mode: 'inside' | 'outside-above' | 'outside-below' }>();
```

样式（全部统一胶囊外观，仅 top 不同）：
```css
.tp-grip {
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  cursor: grab;
  z-index: 4;
  width: 32px;
  height: 20px;
  background: var(--tp-panel);
  border: 1.5px solid var(--tp-accent);
  border-radius: 8px;
  box-shadow: var(--tp-accent-shadow);
  display: flex;
  align-items: center;
  justify-content: center;
}
.tp-grip--inside        { top: 4px; }
.tp-grip--outside-above { top: -28px; }
.tp-grip--outside-below { bottom: -28px; top: auto; }
```

#### C.3 CanvasElement 改用 gripMode

```vue
<ElementGrip v-if="isSelected" :mode="gripMode" @pointerdown="onGripDown" />
```

### 验证

- 元素 ≥ 10mm × 8mm → 胶囊在元素内顶部居中
- 元素 < 10mm × 8mm → 胶囊跳到外部上方
- 小元素 + anchor.y < 8mm → 胶囊翻到外部下方
- 三种位置视觉一致（同款胶囊）

---

## §D — 元素最大尺寸（文档化）

确认现状即可，无代码改动。

**规则**：
- 元素最大宽 = `paperW - anchor.x`（剩余纸张宽度）
- 元素最大高 = `paperH - anchor.y`
- 元素最小 = `minMmFor(el)` (apps/web/src/designer/elementFactory.ts:31-41)

防护点（iter 10 已加）：
- `onResizeDown` paper-bound clamp + minMm 兜底
- `setElementAnchor` paper-bound clamp
- `restore()` 全量 clampAnchorToPaper

仅在验收清单中验证三层防护正常工作。

---

## §E — TemplateRenderer 与设计器对齐

### E.1 加 QR 到 elementMap

`packages/template-renderer/src/TemplateRenderer.vue`：
```ts
import QrElement from './elements/QrElement.vue';

const elementMap: Record<string, Component> = {
  text: TextElement,
  field: FieldElement,
  image: ImageElement,
  table: TableElement,
  barcode: BarcodeElement,
  qr: QrElement,                // ← 新增
  autonumber: AutonumberElement,
  system: SystemElement,
  rect: RectElement,
};
```

### E.2 渲染器改 anchor 定位

`TemplateRenderer.vue` template：
```vue
<div
  v-for="el in props.template.elements"
  :key="el.id"
  class="tp-element"
  :style="{
    left: `${el.anchor.x * PX_PER_MM}px`,
    top: `${el.anchor.y * PX_PER_MM}px`,
    width: `${el.anchor.w * PX_PER_MM}px`,
    height: `${el.anchor.h * PX_PER_MM}px`,
  }"
>
```

加一个常量：
```ts
const PX_PER_MM = 4;
```

`--canvas-w` / `--canvas-h` 保持现状（`cellW × cols` 与 `cellH × rows` = paperPx 自然像素），无需改动。仅元素 `<div :style>` 改读 anchor。

### E.3 usedFieldKeys 加 QR 分支

`apps/web/src/stores/designer.ts` usedFieldKeys getter:
```ts
for (const el of s.template.elements) {
  if (el.type === 'field' || el.type === 'table') used.add(el.binding);
  if (el.type === 'image' && el.source.kind === 'field') used.add(el.source.binding);
  if ((el.type === 'barcode' || el.type === 'qr') && el.binding) used.add(el.binding);
}
```

### E.4 Schema 覆盖测试

`packages/schema/test/coverage.spec.ts` (或加到 template.spec.ts)：
```ts
import { TemplateElementSchema } from '../src/template';

it('all element types must be enumerable for renderer coverage', () => {
  // Hard-coded list from TemplateRenderer + CanvasElement maps
  const renderedTypes = ['text', 'field', 'image', 'table', 'barcode', 'qr', 'autonumber', 'system', 'rect'];

  // Schema-declared types
  const schemaTypes = TemplateElementSchema.options.map((s) => s.shape.type.value);

  expect(new Set(renderedTypes)).toEqual(new Set(schemaTypes));
});
```

未来 schema 加 element type 但忘了同步 TemplateRenderer / CanvasElement → 测试 fail。

### 验证

- 预览中 QR 渲染
- 预览中 sample data form 列出 QR 绑定的字段（前提是 schema 里存在）
- 设计器与预览中元素位置 1:1 像素对齐（zoom=1 时）
- schema test 通过

---

## §F — 打印 zoom 重置

### 现状

`apps/web/src/designer/DesignerHeader.vue:94-95`：
```ts
function doPrint(): void {
  window.print();
}
```

`window.print()` 直接打印当前 designer DOM。`@media print` (designer.css:254) 隐藏 toolbar / sidebar / grips 但保留 `.tp-paper` 和 `.tp-element`。问题：`--canvas-w = paperPx.w * zoom`，如果 zoom != 1，打印输出的纸张元素 CSS 宽度非自然值，浏览器要做不可控的二次缩放。

### 修复

加 `beforeprint` / `afterprint` 监听，打印前重置 zoom=1，打印后还原。

`apps/web/src/designer/DesignerHeader.vue`：
```ts
import { onMounted, onBeforeUnmount } from 'vue';

let savedZoom = 1;

function onBeforePrint(): void {
  savedZoom = store.view.zoom;
  store.setZoom(1);
}
function onAfterPrint(): void {
  store.setZoom(savedZoom);
}

onMounted(() => {
  window.addEventListener('beforeprint', onBeforePrint);
  window.addEventListener('afterprint', onAfterPrint);
});
onBeforeUnmount(() => {
  window.removeEventListener('beforeprint', onBeforePrint);
  window.removeEventListener('afterprint', onAfterPrint);
});

function doPrint(): void {
  window.print();
}
```

注意：浏览器在 `beforeprint` 触发后会同步生成 print layout，所以 setZoom(1) 必须立即生效（Pinia state mutation 是同步的，DOM 更新在 `nextTick`，但 beforeprint 已经在 print layout 阶段同步处理 reactive state）。如果跨浏览器测试发现 zoom 未及时刷新，回退方案：

```ts
function doPrint(): void {
  const prev = store.view.zoom;
  store.setZoom(1);
  void nextTick(() => {
    window.print();
    store.setZoom(prev);
  });
}
```

### 验证

- 在 zoom=1.21 时点「立即打印」→ 打印输出元素位置与 zoom=1 时一致
- 打印对话框关闭后 designer 恢复 zoom=1.21
- 用户截图证明打印输出与设计器/预览三方一致

---

## 不在范围

- 不引入新元素类型
- 不改 PropertyPanel 结构
- 不动 schema 字段定义（只加测试）
- 不重写 FieldManager / TableColumnsEditor
- 不处理「字段 schema 类型变化时 QR binding 也要解绑」(理论上 iter 5 的 editField 已经用 `'binding' in el` 通用判断处理了 QR，需要 §E 验收时确认)

---

## 验收清单

### §G
- [ ] zoom 50% / 100% / 121% / 200% 下，元素跟随鼠标 1:1
- [ ] zoom 切换不引起元素位置数据漂移（仅视觉缩放）
- [ ] 出门证 (90×60mm) fit 视图后，拖动元素丝滑跟手
- [ ] 缩放角点时元素和 paper 比例正确

### §A
- [ ] 拖元素到离中心 3-5mm 范围，紫色辅助线显示
- [ ] 拖元素正中心，辅助线显示 + 元素吸附
- [ ] 拖元素离中心 6mm+，线消失
- [ ] Alt 按住时两者都关

### §B
- [ ] 在低 zoom 出门证下拖元素到右边，纸张自动横向滚动让元素跟得上鼠标
- [ ] 不拖动时不滚动
- [ ] 多向（上下左右）边缘都触发

### §C
- [ ] 元素 ≥ 10mm × 8mm → 胶囊在元素内顶部居中
- [ ] 元素 < 10mm × 8mm → 胶囊在外部上方
- [ ] 元素 < 10mm × 8mm 且贴近纸张顶部 → 胶囊在外部下方
- [ ] 三种位置视觉风格一致（同款胶囊）

### §D
- [ ] 用 W 角点把元素拖到右侧出纸张，宽度被 clamp
- [ ] 属性面板手输 anchor.x = -50 自动 clamp 为 0

### §E
- [ ] 预览中 QR 渲染（之前缺失）
- [ ] 预览中绑定 QR 的字段（如果在 schema）出现在 sample data 表单
- [ ] 设计器 zoom=1 与预览 100% zoom 元素位置 1:1 对齐
- [ ] 加新元素 type 时 schema test 提示 renderer 未同步

### §F
- [ ] 在 zoom=1.21 点打印 → 打印输出尺寸正确（A4 = 21cm × 29.7cm）
- [ ] 打印窗口关闭后 zoom 恢复 1.21
- [ ] 用 PDF 输出比对打印结果与预览一致
