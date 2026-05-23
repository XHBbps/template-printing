# Designer Iteration 12 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development.

**Goal:** 修复 4 类问题：打印 QR 不可见（§A）、inside grip 多余胶囊（§B）、选中态双边框（§C）、拖动/缩放阻力感 + QR 不跟手（§D）。

**Tech Stack:** Vue 3 + Pinia + Element Plus. 类型检查：

```bash
docker compose -f docker-compose.dev.yml exec -T web sh -c 'cd /workspace/apps/web && NODE_OPTIONS=--max-old-space-size=4096 ./node_modules/.bin/vue-tsc --noEmit'
```

---

## File Structure

| 文件 | 任务 |
|---|---|
| `apps/web/src/designer/DesignerHeader.vue` | T1 |
| `packages/template-renderer/src/elements/QrElement.vue` | T2 |
| `apps/web/src/designer/ElementGrip.vue` | T3 |
| `apps/web/src/designer/CanvasElement.vue` | T4 |
| `apps/web/src/designer/usePointerDrag.ts` | T5, T6 |
| — | T7 (acceptance) |

---

### Task 1: §A.1 — `doPrint` 改 async + await nextTick

**Files:** Modify: `apps/web/src/designer/DesignerHeader.vue`

- [ ] **Step 1: 把 `doPrint()` 改为 async 函数**

  Find:
  ```ts
  function doPrint(): void {
    window.print();
  }
  ```
  Replace with:
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

  `nextTick` 已经在文件顶部 import（iter 9 时加的）。`store` 已在 scope 内。`beforeprint` / `afterprint` 监听器保留作为 Ctrl+P 快捷键兜底。

- [ ] **Step 2: 类型检查 + commit**

  ```bash
  docker compose -f docker-compose.dev.yml exec -T web sh -c 'cd /workspace/apps/web && NODE_OPTIONS=--max-old-space-size=4096 ./node_modules/.bin/vue-tsc --noEmit'
  git add apps/web/src/designer/DesignerHeader.vue
  git commit -m "fix(print): doPrint 改 async，await nextTick 让 zoom=1 DOM 真正生效"
  ```

---

### Task 2: §A.2 — QR `@media print` 强制 SVG 尺寸

**Files:** Modify: `packages/template-renderer/src/elements/QrElement.vue`

- [ ] **Step 1: 在 `<style scoped>` 末尾追加 @media print 规则**

  在 `</style>` 之前插入（保留所有现有样式不变）：

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

- [ ] **Step 2: 类型检查 + commit**

  ```bash
  docker compose -f docker-compose.dev.yml exec -T web sh -c 'cd /workspace/apps/web && NODE_OPTIONS=--max-old-space-size=4096 ./node_modules/.bin/vue-tsc --noEmit'
  git add packages/template-renderer/src/elements/QrElement.vue
  git commit -m "fix(renderer): @media print 强制 QR SVG 撑满容器，避免打印时尺寸塌缩"
  ```

---

### Task 3: §B — Inside grip 改为裸 6 点

**Files:** Modify: `apps/web/src/designer/ElementGrip.vue`

- [ ] **Step 1: 修改 `.tp-grip--inside` 样式（覆盖共用的胶囊样式）**

  Find:
  ```css
  .tp-grip--inside {
    top: 4px;
  }
  ```
  Replace with:
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

  这样 inside 模式覆盖了基础 `.tp-grip` 的胶囊样式（background / border / box-shadow / width / height），仅保留 6 个紫点的栅格布局和定位。`outside-above` / `outside-below` 保留完整胶囊不变。

- [ ] **Step 2: 类型检查 + commit**

  ```bash
  docker compose -f docker-compose.dev.yml exec -T web sh -c 'cd /workspace/apps/web && NODE_OPTIONS=--max-old-space-size=4096 ./node_modules/.bin/vue-tsc --noEmit'
  git add apps/web/src/designer/ElementGrip.vue
  git commit -m "fix(designer): inside grip 去除胶囊背景/边框/阴影，仅保留 6 点"
  ```

---

### Task 4: §C — 选中态改 inset box-shadow

**Files:** Modify: `apps/web/src/designer/CanvasElement.vue`

- [ ] **Step 1: 替换 `.tp-element.is-selected` 样式**

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

- [ ] **Step 2: 类型检查 + commit**

  ```bash
  docker compose -f docker-compose.dev.yml exec -T web sh -c 'cd /workspace/apps/web && NODE_OPTIONS=--max-old-space-size=4096 ./node_modules/.bin/vue-tsc --noEmit'
  git add apps/web/src/designer/CanvasElement.vue
  git commit -m "fix(designer): 选中态改 inset 2px 阴影，单条粗紫边覆盖用户原边框"
  ```

---

### Task 5: §D.1 — rAF 节流通用化

**Files:** Modify: `apps/web/src/designer/usePointerDrag.ts`

- [ ] **Step 1: 在模块顶部加入 rAF 调度器**

  在文件顶部（imports 之后、`export function usePointerDrag(...)` 之前）追加：

  ```ts
  // ---- rAF-throttled pointermove scheduler ----
  // Coalesces high-frequency pointermove events into one update per animation
  // frame, eliminating the "resistance" feel during fast drag.
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

  function flushPendingMove(): void {
    if (pendingFrame) {
      cancelAnimationFrame(pendingFrame);
      pendingFrame = 0;
      const e = latestEvent;
      const h = scheduledHandler;
      latestEvent = null;
      scheduledHandler = null;
      if (e && h) h(e);
    }
  }
  ```

- [ ] **Step 2: `onGripDown` 改用 scheduleMove**

  Find the existing `onGripDown` section where `window.addEventListener('pointermove', onMove)` is called.

  Find:
  ```ts
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  ```
  Replace with:
  ```ts
  function onPointerMove(ev: PointerEvent): void {
    scheduleMove(ev, onMove);
  }
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onUp);
  ```

  Then in the `onUp` inside this `onGripDown`, find:
  ```ts
  function onUp(): void {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
  ```
  Replace with:
  ```ts
  function onUp(): void {
    flushPendingMove();
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onUp);
  ```

- [ ] **Step 3: `onResizeDown` 改用 scheduleMove**

  在 `onResizeDown` 中做同样的替换：找到 `window.addEventListener('pointermove', onMove)`：

  Find:
  ```ts
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  ```
  Replace with:
  ```ts
  function onPointerMove(ev: PointerEvent): void {
    scheduleMove(ev, onMove);
  }
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onUp);
  ```

  在 `onResizeDown` 内的 `function onUp(): void {` 顶部加 `flushPendingMove()`：

  Find:
  ```ts
  function onUp(): void {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
  ```
  Replace with:
  ```ts
  function onUp(): void {
    flushPendingMove();
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onUp);
  ```

  注意：两个 `onPointerMove` 函数在不同 closure 内（`onGripDown` 和 `onResizeDown` 各有一个），名字相同但闭包不同 —— 不冲突。

- [ ] **Step 4: 类型检查 + commit**

  ```bash
  docker compose -f docker-compose.dev.yml exec -T web sh -c 'cd /workspace/apps/web && NODE_OPTIONS=--max-old-space-size=4096 ./node_modules/.bin/vue-tsc --noEmit'
  git add apps/web/src/designer/usePointerDrag.ts
  git commit -m "perf(designer): pointermove 用 requestAnimationFrame 节流到 60Hz，消除快速拖动阻力感"
  ```

---

### Task 6: §D.2 — QR 对角线投影

**Files:** Modify: `apps/web/src/designer/usePointerDrag.ts`

- [ ] **Step 1: 替换 onResizeDown 内的 QR-lock 逻辑**

  Find:
  ```ts
  // QR 1:1 lock — sync axes
  if (mode === 'qr-lock') {
    const basis = Math.max(Math.abs(dxMm), Math.abs(dyMm));
    dxMm = (dxMm >= 0 ? 1 : -1) * basis;
    dyMm = (dyMm >= 0 ? 1 : -1) * basis;
  }
  ```
  Replace with:
  ```ts
  // QR 1:1 lock — diagonal projection
  // Project cursor delta onto the active corner's diagonal direction.
  // Minimizes distance between element corner and cursor while keeping 1:1.
  // (Figma's shift-drag aspect-lock algorithm.)
  if (mode === 'qr-lock') {
    let proj: number;
    if (side === 'se') proj = (dxMm + dyMm) / 2;
    else if (side === 'nw') proj = -(dxMm + dyMm) / 2;
    else if (side === 'ne') proj = (dxMm - dyMm) / 2;
    else if (side === 'sw') proj = (dyMm - dxMm) / 2;
    else proj = 0;

    if (side === 'se') {
      dxMm = proj;
      dyMm = proj;
    } else if (side === 'nw') {
      dxMm = -proj;
      dyMm = -proj;
    } else if (side === 'ne') {
      dxMm = proj;
      dyMm = -proj;
    } else if (side === 'sw') {
      dxMm = -proj;
      dyMm = proj;
    }
  }
  ```

  注意：HitZones 在 QR 模式只显示 corner handles，所以 side 总是 `'se' | 'sw' | 'ne' | 'nw'` 之一。`else proj = 0` 是防御性 fallback，理论上不会触发。

  后续的 strict equality 块（`if (mode === 'qr-lock') { const m = Math.min(w, h); w = m; h = m; }`）保留 —— 作为最终边界保险（防止浮点累积导致 w ≠ h）。

- [ ] **Step 2: 类型检查 + commit**

  ```bash
  docker compose -f docker-compose.dev.yml exec -T web sh -c 'cd /workspace/apps/web && NODE_OPTIONS=--max-old-space-size=4096 ./node_modules/.bin/vue-tsc --noEmit'
  git add apps/web/src/designer/usePointerDrag.ts
  git commit -m "feat(designer): QR 缩放改对角线投影，corner 紧跟鼠标（Figma shift-drag 算法）"
  ```

---

### Task 7: 最终验收

无文件改动。

- [ ] **Step 1: 全套 vue-tsc**

  ```bash
  docker compose -f docker-compose.dev.yml exec -T web sh -c 'cd /workspace/apps/web && NODE_OPTIONS=--max-old-space-size=4096 ./node_modules/.bin/vue-tsc --noEmit'
  ```

- [ ] **Step 2: schema tests（应保持 46/46）**

  ```bash
  docker compose -f docker-compose.dev.yml exec -T web sh -c 'cd /workspace/packages/schema && npm test'
  ```

- [ ] **Step 3: 浏览器走查（http://localhost:5173/designer/new，Ctrl+Shift+R 硬刷新）**

  **§A 打印 QR**
  - [ ] zoom 121% 点「立即打印」→ 打印预览中 QR 可见
  - [ ] zoom 50% 打印 → QR 可见
  - [ ] Ctrl+P 快捷键打印 → QR 可见

  **§B inside grip**
  - [ ] 大元素（≥10mm × 8mm）选中：grip 在元素内顶部仅 6 个紫点，无胶囊背景
  - [ ] 小元素：grip 在外部上方为完整胶囊
  - [ ] 小元素 + 贴顶：grip 在外部下方为完整胶囊

  **§C 选中态**
  - [ ] 选中元素 → 单条 2px 粗紫边（不再出现两条边框）
  - [ ] 选中元素 + 自定义 1px 黑边 → 紫色 inset 完全覆盖黑色
  - [ ] 取消选中 → 恢复用户原边框

  **§D 拖动/缩放流畅度**
  - [ ] zoom 100% 快速拖动元素 → 流畅跟手
  - [ ] zoom 200% 快速缩放角点 → 流畅跟手
  - [ ] QR 拖动 SE 对角线 → 元素 corner 紧贴鼠标
  - [ ] QR 拖动 NE/SW/NW corner → 同样紧贴
  - [ ] 释放鼠标后元素位置准确（无最后一帧丢失）

  **iter 11 回归**
  - [ ] CanvasElement zoom 跟随正确
  - [ ] snap guides 双阈值显示正常
  - [ ] 边缘自动滚动工作
  - [ ] 预览中 QR 渲染（之前 iter 11 §E 修的）

- [ ] **Step 4: 用 TaskUpdate 把 iter 12 master task 标 completed**

---

## 不在范围

- 不改 element 渲染（BarcodeElement / TextElement 等）
- 不动 snap guides / store / schema
- 不发起 PR 或合并 master
