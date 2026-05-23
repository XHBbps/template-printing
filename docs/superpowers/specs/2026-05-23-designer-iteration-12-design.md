# Designer Iteration 12 — Spec

**Goal:** 修复 4 类用户报告问题：打印时 QR 不可见、inside grip 不应有胶囊、选中态出现双边框、拖动/缩放有阻力感（QR 尤其）。

**核心原则：** §A 打印通过 `nextTick` 让 zoom 重置真正生效；§B/§C 是视觉调整（小改）；§D 是性能 + 算法升级，参考开源主流做法（rAF 节流 + 对角线投影）。

---

## §A — 打印 QR 不可见修复

### 现状

iter 11 §F 注册了 `beforeprint` / `afterprint` 事件，在打印前同步把 `store.view.zoom` 设为 1，打印后还原。问题：Pinia state mutation 是同步的，但 Vue DOM 更新是 async（`nextTick` 调度）。浏览器在 `beforeprint` 监听器返回后立即抓 DOM 快照 —— 此时 DOM 还是 zoom=1.21 的状态。结果：paper 尺寸不对，元素可能落到 paper 外被剪掉。

同时 QR 通过 `v-html="qrSvg"` 注入 SVG。在打印路径下，SVG 的 `width: auto; height: auto; max-width: 100%; max-height: 100%` 组合可能导致 SVG 缩成 0×0（如果父容器在某瞬间宽度异常）。

### 修复

#### A.1 — 把 `doPrint()` 改成 async，主动等 nextTick

`apps/web/src/designer/DesignerHeader.vue`：

```ts
async function doPrint(): Promise<void> {
  const prevZoom = store.view.zoom;
  if (prevZoom !== 1) {
    store.setZoom(1);
    await nextTick();
  }
  window.print();
  if (prevZoom !== 1) {
    store.setZoom(prevZoom);
  }
}
```

保留 `beforeprint` / `afterprint` 监听器，作为 Ctrl+P 快捷键的兜底（用户不通过按钮打印时仍生效）。

#### A.2 — @media print 强制 QR SVG 尺寸

`packages/template-renderer/src/elements/QrElement.vue` `<style scoped>` 末尾追加：

```css
@media print {
  .qr-svg :deep(svg) {
    width: 100% !important;
    height: 100% !important;
    max-width: none !important;
    max-height: none !important;
  }
}
```

确保 SVG 在打印时撑满容器，不受 `width: auto` 影响。

---

## §B — Inside grip 无胶囊样式

### 现状

iter 11 T4 让三种 grip 模式（inside / outside-above / outside-below）共用胶囊样式（白底紫边）。当 grip 落在元素内部时，胶囊背景遮挡了元素内容。

### 修复

`apps/web/src/designer/ElementGrip.vue` 的 `.tp-grip--inside` 改为「纯 6 点无装饰」：

```css
.tp-grip--inside {
  top: 4px;
  background: transparent;
  border: none;
  box-shadow: none;
  padding: 4px 6px;
  width: auto;
  height: auto;
}
.tp-grip--inside:hover {
  background: rgba(108, 92, 231, 0.08);
}
```

`.tp-grip--outside-above` 和 `.tp-grip--outside-below` 保留完整胶囊样式（白底紫边阴影）—— 它们脱离了元素需要视觉锚定。

---

## §C — 选中态单条粗蓝边框

### 现状

iter 9 §A 的修复：`.tp-element.is-selected { outline: 1.5px solid var(--tp-accent); outline-offset: 3px; }`。outline 在元素外 3px，与用户自定义 border（如黑色 1px）形成「两条边框」视觉。

### 修复

`apps/web/src/designer/CanvasElement.vue` `<style scoped>` 的 `.tp-element.is-selected` 块：

Find:
```css
.tp-element.is-selected {
  outline: 1.5px solid var(--tp-accent);
  outline-offset: 3px;
  box-shadow: 0 0 24px rgba(108, 92, 231, 0.18);
}
```

Replace with:
```css
.tp-element.is-selected {
  box-shadow:
    inset 0 0 0 2px var(--tp-accent),
    0 0 16px rgba(108, 92, 231, 0.18);
}
```

效果：
- `inset 0 0 0 2px var(--tp-accent)` — 元素内边 2px 紫色实线阴影，紧贴元素边
- `0 0 16px rgba(108, 92, 231, 0.18)` — 外圈柔光晕保留
- 完全覆盖用户自定义的 1-2px 边框（紫色在上）
- 视觉上：一条 2px 粗的紫色边框
- 取消选中：阴影消失，恢复用户原始边框

---

## §D — 拖动/缩放流畅化（rAF 节流 + QR 对角线投影）

### 现状

`usePointerDrag.ts` 当前每个 `pointermove` 都同步执行：
1. mm delta 计算
2. snap / clamp
3. `store.moveElementMm` / `store.resizeElementMm` mutation
4. `recomputeGridFromAnchor`
5. Pinia 订阅触发 → Vue reactive re-render

`pointermove` 在现代浏览器可达 200+ Hz。每次循环 3-8ms，连续 fire 时帧率掉到 30fps 以下 → 用户感觉「阻力感」。

QR 额外问题：`Math.max(|dx|, |dy|)` 1:1 锁定让较小轴跟着较大轴增长，对角线拖动时元素一边比鼠标快 → 加剧不跟手感。

### 修复

#### D.1 — rAF 节流通用化

`apps/web/src/designer/usePointerDrag.ts` 引入 rAF 调度器，对 `pointermove` 事件批量到帧率（约 60Hz）。

在文件顶部常量后追加：

```ts
let pendingFrame = 0;
let latestEvent: PointerEvent | null = null;
let scheduledHandler: ((ev: PointerEvent) => void) | null = null;

function scheduleMove(ev: PointerEvent, handler: (ev: PointerEvent) => void): void {
  latestEvent = ev;
  scheduledHandler = handler;
  if (pendingFrame) return;
  pendingFrame = requestAnimationFrame(() => {
    pendingFrame = 0;
    const e = latestEvent;
    const h = scheduledHandler;
    latestEvent = null;
    scheduledHandler = null;
    if (e && h) h(e);
  });
}

function cancelScheduled(): void {
  if (pendingFrame) {
    cancelAnimationFrame(pendingFrame);
    pendingFrame = 0;
  }
  latestEvent = null;
  scheduledHandler = null;
}
```

在 `onGripDown` 中：
```ts
function onPointerMove(ev: PointerEvent): void {
  scheduleMove(ev, onMove);
}
// ...
window.addEventListener('pointermove', onPointerMove);
// 把内部 function onMove 不变，只是不直接挂到 window
```

`onUp`：
```ts
function onUp(): void {
  window.removeEventListener('pointermove', onPointerMove);
  window.removeEventListener('pointerup', onUp);
  // 如果有待处理帧，强制执行最后一次以确保 commit
  if (pendingFrame && latestEvent && scheduledHandler) {
    cancelAnimationFrame(pendingFrame);
    pendingFrame = 0;
    scheduledHandler(latestEvent);
    latestEvent = null;
    scheduledHandler = null;
  }
  // ... 原 onUp 剩余逻辑
}
```

同样对 `onResizeDown` 应用。两个 handler 共用同一组模块级状态变量。

#### D.2 — QR 对角线投影

`onResizeDown.onMove` 内现有 QR-lock 逻辑：

Find:
```ts
if (mode === 'qr-lock') {
  const basis = Math.max(Math.abs(dxMm), Math.abs(dyMm));
  dxMm = (dxMm >= 0 ? 1 : -1) * basis;
  dyMm = (dyMm >= 0 ? 1 : -1) * basis;
}
```

Replace with:
```ts
if (mode === 'qr-lock') {
  // Project cursor delta onto the active corner's diagonal direction.
  // Minimizes distance between element corner and cursor while keeping 1:1 lock.
  // (Figma's shift-drag aspect lock algorithm.)
  let proj: number;
  if (side === 'se') proj = (dxMm + dyMm) / 2;
  else if (side === 'nw') proj = -(dxMm + dyMm) / 2;
  else if (side === 'ne') proj = (dxMm - dyMm) / 2;
  else if (side === 'sw') proj = (dyMm - dxMm) / 2;
  else proj = 0;

  if (side === 'se') { dxMm = proj; dyMm = proj; }
  else if (side === 'nw') { dxMm = -proj; dyMm = -proj; }
  else if (side === 'ne') { dxMm = proj; dyMm = -proj; }
  else if (side === 'sw') { dxMm = -proj; dyMm = proj; }
}
```

QR 只有 corner handle（HitZones `mode='qr'`），所以 side 总是 `'se' / 'sw' / 'ne' / 'nw'` 之一。

后续的 `if (mode === 'qr-lock') { const m = Math.min(w, h); w = m; h = m; }` 保留作为最终强约束。

---

## 验收清单

### §A
- [ ] zoom 121% 下点「立即打印」，浏览器打印预览中 QR 可见
- [ ] zoom 50% 下打印，QR 可见
- [ ] Ctrl+P 快捷键打印，QR 可见（beforeprint 兜底）
- [ ] 关闭打印对话框后 zoom 恢复原值

### §B
- [ ] 大元素（≥10mm × 8mm）→ grip 在元素内顶部显示**仅 6 个紫点**，无胶囊背景/边框
- [ ] 小元素 → grip 在外部上方显示**完整胶囊**
- [ ] 小元素 + 贴顶 → grip 在外部下方显示**完整胶囊**

### §C
- [ ] 选中元素 → 边框为**单一 2px 紫色实线**（覆盖用户原边框），外圈柔光晕保留
- [ ] 取消选中 → 恢复用户原边框颜色 / 粗细
- [ ] 设置用户边框 1px 黑后选中：紫色 inset 完全覆盖黑色，不出现「两条边」

### §D
- [ ] zoom 100% 下快速缩放（高速 fling）→ 元素流畅跟随，无阻力感
- [ ] zoom 200% 下快速缩放 → 同上
- [ ] QR 拖动 SE corner，对角斜方向移动 → 元素 corner 紧贴鼠标（不再「一边比鼠标快」）
- [ ] QR 拖 NE/NW/SW corner → 同上方向直觉
- [ ] 释放鼠标后元素位置准确（不丢失最后一次 pointermove 的位置）

---

## 不在范围

- 不改 element 渲染（BarcodeElement / TextElement 等）
- 不改 PropertyPanel / FieldManager
- 不改 schema 定义
- 不动 snap guides 算法
- 不发起 PR
