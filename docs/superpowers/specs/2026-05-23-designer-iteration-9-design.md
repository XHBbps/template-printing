# Designer Iteration 9 — Spec

**目标:** 修复 5 个迭代 8 验收后用户反馈的体验问题：选中态遮挡用户边框、小纸张下拖动/缩放跳变、纸张预设过多、条码/二维码在小元素下显示异常。

**核心原则:** 重 UX。每条改动都以「用户感受得到的丝滑度 / 清晰度」为标尺，不引入新的概念负担。

---

## 涉及范围

| 文件 | 改动类型 |
|---|---|
| `apps/web/src/designer/CanvasElement.vue` | 选中态 CSS 重构 |
| `apps/web/src/designer/usePointerDrag.ts` | 拖动 / 缩放重写为 mm 精度 |
| `apps/web/src/stores/designer.ts` | moveElement / resizeElement 改为接收 mm；瘦身 paper presets；清理 GuardPass 残留 |
| `apps/web/src/designer/DesignerHeader.vue` | paper 下拉列表瘦身 |
| `packages/template-renderer/src/elements/BarcodeElement.vue` | 拖动占位图标 + 动态 scale |
| `packages/template-renderer/src/elements/QrElement.vue` | 拖动占位图标 |

---

## §A — 选中态不再覆盖用户边框 (问题 1)

**症状:** 用户在属性面板配置「上边框 1px solid #000」，但因为 `.tp-element` 选中态本身有 `1.5px solid var(--tp-accent)` 边框 + 紫色光晕，与用户的内层边框在视觉上重叠，用户以为样式没生效。

**修复:**

```css
.tp-element.is-selected {
  /* 移除 border-color 改色逻辑；改用 outline + 留间隙 */
  outline: 1.5px solid var(--tp-accent);
  outline-offset: 3px;
  border-radius: 4px;
  /* 保留外圈柔光晕 */
  box-shadow: 0 0 24px rgba(108, 92, 231, 0.18);
}

/* 未选中状态 .tp-element 的 border 直接去掉 (不再保留 1.5px transparent 占位) */
.tp-element {
  position: absolute;
  box-sizing: border-box;
  cursor: pointer;
  border-radius: 4px;
  /* 不再有 border: 1.5px solid transparent */
}
```

**关键点:**
- 用 `outline` 取代 `border`，outline 不占布局空间，不会与用户边框冲突
- `outline-offset: 3px` 让紫框与元素之间有 3px 清晰间隙
- 用户的 border 全部由内层 `div` 渲染（已有逻辑）

**4 个角的圆点 handle:** 保持当前 absolute 定位，不受 outline 影响（它们用 top/left 负值放在 wrapper 外侧）。

---

## §B — 拖动/缩放改为 mm 精度 (问题 2 + 3)

**症状:** 出门证（90×60mm 自定义纸）下 cell=4px、zoom≈3 时，1 cell ≈ 12px 屏幕，鼠标移 6px 就跳一格，松手回贴到 mm 整数，体感「不跟手」「微动突变」。

**根因:** 现行 `usePointerDrag` 在 `onResizeDown` 中 `Math.round(dxPx / (cell.w * z))` 将拖动量化到 cell；`onGripDown` 落点也通过 `Math.round(finalDxMm * PX_PER_MM / cell.w)` 回贴到 cell 整数。

**修复:** 拖动 / 缩放统一改为 **0.25mm 步进**，commit 时直接写 `anchor.x/y/w/h`（mm），由 `recomputeGridFromAnchor` 反推 grid。

### B.1 store 增加 anchor-based 接口

```ts
// stores/designer.ts — 新增 / 替换
const STEP_MM = 0.25;

function snapToStep(mm: number): number {
  return Math.round(mm / STEP_MM) * STEP_MM;
}

// 新方法 — 替代 moveElement 调用点
moveElementMm(id: string, xMm: number, yMm: number): void {
  const idx = this.template.elements.findIndex((e) => e.id === id);
  if (idx < 0) return;
  const cur = this.template.elements[idx];
  const next = {
    ...cur,
    anchor: { ...cur.anchor, x: snapToStep(xMm), y: snapToStep(yMm) },
  } as TemplateElement;
  recomputeGridFromAnchor(next, this.template.canvas.cell);
  this.template.elements[idx] = next;
},

// 新方法 — 替代 resizeElement 调用点
resizeElementMm(
  id: string,
  patch: { x?: number; y?: number; w?: number; h?: number },
): void {
  const idx = this.template.elements.findIndex((e) => e.id === id);
  if (idx < 0) return;
  const cur = this.template.elements[idx];
  const next = {
    ...cur,
    anchor: {
      x: patch.x !== undefined ? snapToStep(patch.x) : cur.anchor.x,
      y: patch.y !== undefined ? snapToStep(patch.y) : cur.anchor.y,
      w: patch.w !== undefined ? snapToStep(patch.w) : cur.anchor.w,
      h: patch.h !== undefined ? snapToStep(patch.h) : cur.anchor.h,
    },
  } as TemplateElement;
  recomputeGridFromAnchor(next, this.template.canvas.cell);
  this.template.elements[idx] = next;
},
```

旧的 `moveElement(id, c, r)` 和 `resizeElement(id, cs, rs, c?, r?)` 仍保留（PropertyPanel 的 `setElementAnchor` 用 cell 偏移外的 anchor 修改）但 usePointerDrag 不再调用。

### B.2 usePointerDrag 重写

**onGripDown:**

```ts
const startAnchorX = el.anchor.x;
const startAnchorY = el.anchor.y;
const minMm = { w: 0, h: 0 }; // move 不限制 (只 clamp 到 paper)
const paperW = store.paperPx.w / PX_PER_MM;
const paperH = store.paperPx.h / PX_PER_MM;

function onMove(ev: PointerEvent) {
  const dxMm = (ev.clientX - startX) / (PX_PER_MM * store.view.zoom);
  const dyMm = (ev.clientY - startY) / (PX_PER_MM * store.view.zoom);

  // snap-aware target
  const snap = computeSnap({
    target: {
      x: startAnchorX + dxMm,
      y: startAnchorY + dyMm,
      w: el!.anchor.w,
      h: el!.anchor.h,
    },
    others, paper, threshold: ev.altKey ? 0 : SNAP_THRESHOLD_MM,
  });
  store.setGuides(snap.guides);

  // clamp to paper, then commit live
  const clampedX = Math.max(0, Math.min(snap.snapped.x, paperW - el!.anchor.w));
  const clampedY = Math.max(0, Math.min(snap.snapped.y, paperH - el!.anchor.h));
  store.moveElementMm(elementId, clampedX, clampedY);

  // No transform residue — store is the source of truth now.
  // Element re-renders at its new anchor pixel position immediately.
}

function onUp() {
  store.clearGuides();
  store.isResizing = false;
  store.commit(); // snapshot for undo
}
```

**onResizeDown:**

```ts
const startAnchor = { ...el.anchor };
const mode = getResizeMode(); // 'free' | 'qr-lock' | 'barcode'
const minMm = minMmFor(el);

function onMove(ev: PointerEvent) {
  let dxMm = (ev.clientX - startX) / (PX_PER_MM * store.view.zoom);
  let dyMm = (ev.clientY - startY) / (PX_PER_MM * store.view.zoom);

  // QR 1:1 lock — 取大轴
  if (mode === 'qr-lock') {
    const basis = Math.max(Math.abs(dxMm), Math.abs(dyMm));
    dxMm = Math.sign(dxMm) * basis;
    dyMm = Math.sign(dyMm) * basis;
  }

  let { x, y, w, h } = startAnchor;

  if (side.includes('w')) {
    const newX = startAnchor.x + dxMm;
    const newW = startAnchor.w - dxMm;
    if (newW >= minMm.w) { x = newX; w = newW; }
    else { x = startAnchor.x + startAnchor.w - minMm.w; w = minMm.w; }
  } else if (side.includes('e')) {
    w = Math.max(minMm.w, startAnchor.w + dxMm);
  }
  if (side.includes('n')) {
    const newY = startAnchor.y + dyMm;
    const newH = startAnchor.h - dyMm;
    if (newH >= minMm.h) { y = newY; h = newH; }
    else { y = startAnchor.y + startAnchor.h - minMm.h; h = minMm.h; }
  } else if (side.includes('s')) {
    h = Math.max(minMm.h, startAnchor.h + dyMm);
  }

  // QR 严格 w === h
  if (mode === 'qr-lock') { const m = Math.min(w, h); w = m; h = m; }

  // barcode 最小高度 — 用 minMm 而不是 cell unit
  if (mode === 'barcode' && h < 0.5) h = 0.5;  // 0.5mm 是 1D barcode 最小可识别高度

  // clamp 不出纸
  if (x < 0) { w += x; x = 0; }
  if (y < 0) { h += y; y = 0; }
  if (x + w > paperW) w = paperW - x;
  if (y + h > paperH) h = paperH - y;

  store.resizeElementMm(elementId, { x, y, w, h });
}
```

**关键点:**
- 不再使用 `dom.style.transform` 残差驱动视觉 — 直接 commit 到 store，元素自然 re-render
- 0.25mm 步进对 PX_PER_MM=4 来说意味着 1 屏幕像素都有意义（zoom=1 时 1px=0.25mm）
- snap guides 仍然按 mm 工作（已经是 mm 单位），自动兼容
- 移除了 cell-based residue 计算分支 → 代码更简单

### B.3 CanvasElement 元素定位改为 anchor-mm

当前用 `calc(${grid.c} * var(--cell-w))`。现在 grid 由 anchor 反推，仍然可用，但为了避免 mm→cell→px 的精度损失，改为直接读 anchor.x mm + paper px-per-mm：

```ts
const positionStyle = computed(() => {
  const px = PX_PER_MM; // 4
  return {
    left: `${props.element.anchor.x * px}px`,
    top: `${props.element.anchor.y * px}px`,
    width: `${props.element.anchor.w * px}px`,
    height: `${props.element.anchor.h * px}px`,
  };
});
```

CSS 变量 `--cell-w/--cell-h` 仍由 paper 上层 set（背景点阵需要），与元素定位解耦。

---

## §C — 纸张预设瘦身 (问题 4)

### C.1 store 预设清单

```ts
// stores/designer.ts:25 - 替换为
const PAPER_PRESETS: Record<string, { w_mm: number; h_mm: number }> = {
  A3: { w_mm: 297, h_mm: 420 },
  A4: { w_mm: 210, h_mm: 297 },
  A5: { w_mm: 148, h_mm: 210 },
  B4: { w_mm: 250, h_mm: 353 },
  B5: { w_mm: 176, h_mm: 250 },
};
```

移除: `A6`, `Letter`。

### C.2 DesignerHeader 下拉列表

```ts
// DesignerHeader.vue:28
const paperOptions = ['A3', 'A4', 'A5', 'B4', 'B5'] as const;
```

paperLabelMap 同步更新，移除 A6 / Letter 行。

### C.3 旋转按钮

**保持现状** — `RotateCw` 按钮已经在 toolbar，单击调用 `store.rotate()`，已实现 portrait/landscape 切换。

### C.4 清理 localStorage 残留

在 `restore()` 中：

```ts
// stores/designer.ts:236 附近
const legacyPaperMap: Record<string, ...> = {
  'A3-Landscape': { paper: 'A3', orientation: 'landscape' },
  'A4-Landscape': { paper: 'A4', orientation: 'landscape' },
  'A5-Landscape': { paper: 'A5', orientation: 'landscape' },
  // GuardPass / LogisticLabel 不再迁移到 custom，而是回退到 A4
  GuardPass: { paper: 'A4', orientation: 'portrait' },
  LogisticLabel: { paper: 'A4', orientation: 'portrait' },
  // A6 / Letter 也回退（如果用户老草稿用了）
  A6: { paper: 'A5', orientation: 'portrait' },
  Letter: { paper: 'A4', orientation: 'portrait' },
};
```

如果 parsed.canvas.paper 是当前预设之外的字符串 (e.g. 'A6')，也走 fallback to A4。

---

## §D — Barcode/QR 拖动占位 + 静止自适应 (问题 5)

### D.1 BarcodeElement.vue

**改动:**
1. 拖动时（`isResizing=true`）不再 blur 真实 canvas，而是渲染一个简洁占位 div
2. 静止时按元素实际像素生成 canvas，避免 CSS 强压缩

```vue
<template>
  <div class="tp-barcode">
    <div v-if="props.isResizing" class="bc-placeholder">
      <span class="bc-icon">||||</span>
      <span class="bc-label">条码</span>
    </div>
    <div v-else class="bc-wrap">
      <canvas v-if="hasContent" ref="canvasRef" class="tp-canvas" />
      <div v-else class="bc-empty">未配置内容</div>
    </div>
  </div>
</template>
```

```css
.bc-placeholder {
  width: 100%;
  height: 100%;
  background: var(--tp-field-bg, #f5f5f5);
  border-radius: 4px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: var(--tp-ink-soft, #555);
  font-size: 11px;
  gap: 4px;
}
.bc-icon {
  font-family: ui-monospace, monospace;
  font-size: 18px;
  letter-spacing: -2px;
  color: var(--tp-ink, #333);
}
```

**动态 scale**：根据元素实际 mm 尺寸算 bwip-js `scale`，让条码精度匹配元素大小。

```ts
function render(): void {
  if (!hasContent.value || !canvasRef.value) return;
  const v = value.value;
  if (!v) return;

  // 元素实际 paper 像素
  const elPxW = props.element.anchor.w * 4; // PX_PER_MM = 4
  // 目标条码画布约 80% 元素宽度，预留 quietZone
  const targetW = Math.max(60, Math.floor(elPxW * 0.85));
  // bwip-js scale 决定 module 宽度 (px)。code128 大约每字符 11 modules + quiet zone。
  // 简单启发: scale = max(1, floor(targetW / (v.length * 11 + 20)))
  const estModules = v.length * 11 + 20;
  const scale = Math.max(1, Math.floor(targetW / estModules));

  try {
    bwipjs.toCanvas(canvasRef.value, {
      bcid: props.element.symbology,
      text: v,
      scale,
      height: Math.max(8, Math.floor(props.element.anchor.h * 4 * 0.75)),
      // ...其余参数不变
    });
  } catch (err) { /* ... */ }
}
```

监听 anchor 变化（不只是 grid）以便 resize commit 后立即重新生成：

```ts
watch(
  () => ({
    anchor: { ...props.element.anchor },
    // ...
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

### D.2 QrElement.vue

类似占位逻辑：

```vue
<template>
  <div class="qr-wrap">
    <div v-if="props.isResizing" class="qr-placeholder">
      <div class="qr-icon">▦</div>
      <span class="qr-label">二维码</span>
    </div>
    <template v-else>
      <div v-if="hasContent" class="qr-svg" :style="..." v-html="qrSvg" />
      <div v-else class="qr-empty">未配置内容</div>
    </template>
  </div>
</template>
```

```css
.qr-placeholder {
  width: 100%;
  height: 100%;
  background: var(--tp-field-bg, #f5f5f5);
  border-radius: 4px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
}
.qr-icon {
  font-size: 28px;
  color: var(--tp-ink, #333);
  line-height: 1;
}
```

QR cellSize 不动（保持模块化生成），只在拖动时换占位。

### D.3 设计模式 isResizing 来源

`CanvasElement.vue:87` 已经把 `isResizing` 传给 child component：

```vue
<component
  :is="elementMap[props.element.type]"
  :element="props.element"
  :is-resizing="store.isResizing && isSelected"
  design-mode
/>
```

逻辑保留，barcode/qr 已能正确接收。

---

## 验收检查清单

- [ ] **§A**: 选中文本元素 + 设上下左右 1px 黑边 → 紫色 outline 在元素外 3px 处，用户黑边清晰可见
- [ ] **§B 移动**: 出门证（90×60mm）下拖动元素 5px 屏幕距离 → 元素丝滑跟随，落点不回弹
- [ ] **§B 缩放**: 出门证下拖角点缩放 → 不跳格、跟手
- [ ] **§B 大纸张回归**: A3 / A4 portrait 下拖动 / 缩放体验不变差
- [ ] **§B undo/redo**: 拖动后 ⌘Z 撤销正确还原 anchor
- [ ] **§C**: paper 下拉只剩 5 项 (A3 / A4 / A5 / B4 / B5)
- [ ] **§C**: 旋转按钮一击切换横/竖，label 正确显示 "A4 横" 等
- [ ] **§C**: 加载老草稿（曾有 GuardPass / Letter / A6）能正常 fallback 不报错
- [ ] **§D 条码**: 出门证下放一个 30mm 宽条码 → 静止时清晰可读、拖动时显示占位图标
- [ ] **§D 二维码**: 同上 → 静止时正常 QR、拖动时显示 ▦ 占位
- [ ] **vue-tsc**: exit 0
- [ ] **打印**: PreviewView 打印走 print CSS，条码 / 二维码用真实图（不是占位）

---

## 不在范围

- 不引入新的 Designer 功能或属性
- 不动 PropertyPanel UI
- 不动 snap guides 逻辑（iter 8 §D 已交付）
- 不重写 TableColumnsEditor / FieldManager
- 不动 schema 定义
