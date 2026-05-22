# Designer Iteration 9 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 iter 8 验收后用户反馈的 5 个体验问题：选中态遮挡用户边框、小纸张下拖动/缩放跳变、纸张预设过多、条码/二维码在小元素下显示异常。同时收尾 iter 8 #13 的最终验收。

**Architecture:** 4 个独立批次（A 选中态 / B 拖动精度 / C 纸张预设 / D 条码占位）+ 收尾验收。每批次内任务自包含、可单独 commit。最后一项任务做全套 vue-tsc + schema tests + 浏览器走查（同时覆盖 iter 8 §D 的 snap guides 验收）。

**Tech Stack:** Vue 3 SFC + Pinia + Element Plus 2.7 + lucide-vue-next + bwip-js + qrcode-generator. 类型检查命令：

```bash
docker compose -f docker-compose.dev.yml exec -T web sh -c 'cd /workspace/apps/web && NODE_OPTIONS=--max-old-space-size=4096 ./node_modules/.bin/vue-tsc --noEmit'
```

---

## File Structure

| 文件 | 任务 | 改动类型 |
|---|---|---|
| `apps/web/src/designer/CanvasElement.vue` | T1, T5 | 选中态 CSS + 元素定位 |
| `apps/web/src/stores/designer.ts` | T2, T4 | paper presets + legacy fallback + mm 接口 |
| `apps/web/src/designer/DesignerHeader.vue` | T3 | paperOptions 瘦身 |
| `apps/web/src/designer/usePointerDrag.ts` | T6, T7 | onGripDown + onResizeDown 重写 |
| `packages/template-renderer/src/elements/BarcodeElement.vue` | T8 | 占位图标 + 动态 scale |
| `packages/template-renderer/src/elements/QrElement.vue` | T9 | 占位图标 |
| — | T10 | 最终验收（无文件改动） |

---

### Task 1: §A 选中态改 outline + 3px offset

**Files:**
- Modify: `apps/web/src/designer/CanvasElement.vue`

- [ ] **Step 1: 修改 `.tp-element` — 去掉 transparent border 占位**

  Find:
  ```css
  .tp-element {
    position: absolute;
    box-sizing: border-box;
    cursor: pointer;
    border: 1.5px solid transparent;
    border-radius: 4px;
  }
  ```
  Replace with:
  ```css
  .tp-element {
    position: absolute;
    box-sizing: border-box;
    cursor: pointer;
    border-radius: 4px;
  }
  ```

- [ ] **Step 2: 修改 `.tp-element.is-selected` — outline + 3px offset**

  Find:
  ```css
  .tp-element.is-selected {
    border-color: var(--tp-accent);
    box-shadow:
      0 0 0 1px rgba(108, 92, 231, 0.15),
      0 0 24px rgba(108, 92, 231, 0.18);
  }
  ```
  Replace with:
  ```css
  .tp-element.is-selected {
    outline: 1.5px solid var(--tp-accent);
    outline-offset: 3px;
    box-shadow: 0 0 24px rgba(108, 92, 231, 0.18);
  }
  ```

- [ ] **Step 3: 删除原 selection 注释块**

  Find并删除整段（如存在）：
  ```css
  /* Selection visual coincides with element border (#2) — no outline-offset.
     Replaces the previous outline with an inset purple border so the highlight
     sits exactly where the element's edge is. */
  ```

- [ ] **Step 4: 类型检查**

  Run:
  ```bash
  docker compose -f docker-compose.dev.yml exec -T web sh -c 'cd /workspace/apps/web && NODE_OPTIONS=--max-old-space-size=4096 ./node_modules/.bin/vue-tsc --noEmit'
  ```
  Expected: exit 0

- [ ] **Step 5: Commit**

  ```bash
  git add apps/web/src/designer/CanvasElement.vue
  git commit -m "fix(designer): 选中态改 outline + 3px offset，让出位置给用户自定义边框"
  ```

---

### Task 2: §C.1 + §C.4 store paper presets 瘦身 + legacy fallback

**Files:**
- Modify: `apps/web/src/stores/designer.ts`

- [ ] **Step 1: 替换 PAPER_PRESETS**

  Find:
  ```ts
  const PAPER_PRESETS: Record<string, { w_mm: number; h_mm: number }> = {
    A3: { w_mm: 297, h_mm: 420 },
    A4: { w_mm: 210, h_mm: 297 },
    A5: { w_mm: 148, h_mm: 210 },
    A6: { w_mm: 105, h_mm: 148 },
    B5: { w_mm: 176, h_mm: 250 },
    Letter: { w_mm: 216, h_mm: 279 },
  };
  ```
  Replace with:
  ```ts
  const PAPER_PRESETS: Record<string, { w_mm: number; h_mm: number }> = {
    A3: { w_mm: 297, h_mm: 420 },
    A4: { w_mm: 210, h_mm: 297 },
    A5: { w_mm: 148, h_mm: 210 },
    B4: { w_mm: 250, h_mm: 353 },
    B5: { w_mm: 176, h_mm: 250 },
  };
  ```

- [ ] **Step 2: 扩展 legacyPaperMap，把 A6 / Letter / GuardPass / LogisticLabel 全部回退到内置预设**

  Find (inside `restore()`):
  ```ts
  const legacyPaperMap: Record<
    string,
    { paper: Template['canvas']['paper']; orientation: 'portrait' | 'landscape' }
  > = {
    'A3-Landscape': { paper: 'A3', orientation: 'landscape' },
    'A4-Landscape': { paper: 'A4', orientation: 'landscape' },
    'A5-Landscape': { paper: 'A5', orientation: 'landscape' },
    GuardPass: { paper: { w_mm: 90, h_mm: 60 }, orientation: 'portrait' },
    LogisticLabel: { paper: { w_mm: 100, h_mm: 180 }, orientation: 'portrait' },
  };
  ```
  Replace with:
  ```ts
  const legacyPaperMap: Record<
    string,
    { paper: Template['canvas']['paper']; orientation: 'portrait' | 'landscape' }
  > = {
    'A3-Landscape': { paper: 'A3', orientation: 'landscape' },
    'A4-Landscape': { paper: 'A4', orientation: 'landscape' },
    'A5-Landscape': { paper: 'A5', orientation: 'landscape' },
    GuardPass: { paper: 'A4', orientation: 'portrait' },
    LogisticLabel: { paper: 'A4', orientation: 'portrait' },
    A6: { paper: 'A5', orientation: 'portrait' },
    Letter: { paper: 'A4', orientation: 'portrait' },
  };
  ```

- [ ] **Step 3: 在 legacyPaperMap 应用后，对任何不在新 presets 中的字符串 paper 做兜底**

  Find:
  ```ts
  if (typeof parsed.canvas.paper === 'string' && parsed.canvas.paper in legacyPaperMap) {
    const m = legacyPaperMap[parsed.canvas.paper as string];
    parsed.canvas.paper = m.paper;
    parsed.canvas.orientation = m.orientation;
  }
  ```
  Replace with:
  ```ts
  if (typeof parsed.canvas.paper === 'string' && parsed.canvas.paper in legacyPaperMap) {
    const m = legacyPaperMap[parsed.canvas.paper as string];
    parsed.canvas.paper = m.paper;
    parsed.canvas.orientation = m.orientation;
  }
  // Final guard: if paper is still a string but not in current presets, fall back to A4
  if (
    typeof parsed.canvas.paper === 'string' &&
    !(parsed.canvas.paper in PAPER_PRESETS)
  ) {
    parsed.canvas.paper = 'A4';
  }
  ```

- [ ] **Step 4: 类型检查 + commit**

  ```bash
  docker compose -f docker-compose.dev.yml exec -T web sh -c 'cd /workspace/apps/web && NODE_OPTIONS=--max-old-space-size=4096 ./node_modules/.bin/vue-tsc --noEmit'
  git add apps/web/src/stores/designer.ts
  git commit -m "feat(store): paper presets 瘦身为 A3/A4/A5/B4/B5 + legacy 草稿回退到内置预设"
  ```

---

### Task 3: §C.2 DesignerHeader paperOptions 同步

**Files:**
- Modify: `apps/web/src/designer/DesignerHeader.vue`

- [ ] **Step 1: 修改 paperOptions**

  Find:
  ```ts
  const paperOptions = ['A3', 'A4', 'A5', 'A6', 'B5', 'Letter'] as const;
  ```
  Replace with:
  ```ts
  const paperOptions = ['A3', 'A4', 'A5', 'B4', 'B5'] as const;
  ```

- [ ] **Step 2: 修改 paperLabelMap**

  Find:
  ```ts
  const paperLabelMap: Record<string, string> = {
    A3: 'A3',
    A4: 'A4',
    A5: 'A5',
    A6: 'A6',
    B5: 'B5',
    Letter: 'Letter',
  };
  ```
  Replace with:
  ```ts
  const paperLabelMap: Record<string, string> = {
    A3: 'A3',
    A4: 'A4',
    A5: 'A5',
    B4: 'B4',
    B5: 'B5',
  };
  ```

- [ ] **Step 3: 类型检查 + commit**

  ```bash
  docker compose -f docker-compose.dev.yml exec -T web sh -c 'cd /workspace/apps/web && NODE_OPTIONS=--max-old-space-size=4096 ./node_modules/.bin/vue-tsc --noEmit'
  git add apps/web/src/designer/DesignerHeader.vue
  git commit -m "feat(designer): paper 下拉只保留 A3/A4/A5/B4/B5"
  ```

---

### Task 4: §B.1 store 增加 moveElementMm + resizeElementMm

**Files:**
- Modify: `apps/web/src/stores/designer.ts`

- [ ] **Step 1: 在文件顶部 PX_PER_MM 常量旁加入 STEP_MM**

  Find:
  ```ts
  const PX_PER_MM = 4;
  ```
  Replace with:
  ```ts
  const PX_PER_MM = 4;
  const STEP_MM = 0.25;

  function snapToStep(mm: number): number {
    return Math.round(mm / STEP_MM) * STEP_MM;
  }
  ```

- [ ] **Step 2: 在 `actions` 中 `resizeElement` 之后追加两个新方法**

  Find `resizeElement(id: string, cs: number, rs: number, c?: number, r?: number): void { ... }` 结束位置（紧接闭合 `},`），之后插入：

  ```ts
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
    // No snapshot — caller is responsible for committing on pointerup.
  },
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
    // No snapshot — caller is responsible for committing on pointerup.
  },
  ```

- [ ] **Step 3: 类型检查 + commit**

  ```bash
  docker compose -f docker-compose.dev.yml exec -T web sh -c 'cd /workspace/apps/web && NODE_OPTIONS=--max-old-space-size=4096 ./node_modules/.bin/vue-tsc --noEmit'
  git add apps/web/src/stores/designer.ts
  git commit -m "feat(store): 新增 moveElementMm / resizeElementMm，0.25mm 步进 + 不自动 snapshot"
  ```

---

### Task 5: §B.3 CanvasElement 元素定位改 anchor-px

**Files:**
- Modify: `apps/web/src/designer/CanvasElement.vue`

- [ ] **Step 1: 修改 positionStyle computed**

  Find:
  ```ts
  const positionStyle = computed(() => ({
    left: `calc(${props.element.grid.c} * var(--cell-w))`,
    top: `calc(${props.element.grid.r} * var(--cell-h))`,
    width: `calc(${props.element.grid.cs} * var(--cell-w))`,
    height: `calc(${props.element.grid.rs} * var(--cell-h))`,
  }));
  ```
  Replace with:
  ```ts
  const PX_PER_MM = 4;
  const positionStyle = computed(() => ({
    left: `${props.element.anchor.x * PX_PER_MM}px`,
    top: `${props.element.anchor.y * PX_PER_MM}px`,
    width: `${props.element.anchor.w * PX_PER_MM}px`,
    height: `${props.element.anchor.h * PX_PER_MM}px`,
  }));
  ```

- [ ] **Step 2: 类型检查 + commit**

  ```bash
  docker compose -f docker-compose.dev.yml exec -T web sh -c 'cd /workspace/apps/web && NODE_OPTIONS=--max-old-space-size=4096 ./node_modules/.bin/vue-tsc --noEmit'
  git add apps/web/src/designer/CanvasElement.vue
  git commit -m "fix(designer): CanvasElement 定位改读 anchor.mm，消除 cell 量化精度损失"
  ```

---

### Task 6: §B.2 usePointerDrag.onGripDown 改 mm 精度

**Files:**
- Modify: `apps/web/src/designer/usePointerDrag.ts`

- [ ] **Step 1: 完全替换 `onGripDown` 函数体**

  Find整个 `function onGripDown(e: PointerEvent): void { ... }` 块（line 38–122 当前内容），替换为：

  ```ts
  function onGripDown(e: PointerEvent): void {
    const dom = getDom();
    const el = getElement();
    if (!dom || !el) return;
    const startX = e.clientX;
    const startY = e.clientY;
    const startAnchorX = el.anchor.x;
    const startAnchorY = el.anchor.y;
    const elW = el.anchor.w;
    const elH = el.anchor.h;
    const paperW = store.paperPx.w / PX_PER_MM;
    const paperH = store.paperPx.h / PX_PER_MM;
    store.isResizing = true;
    dom.classList.add('is-pointer-active');

    function onMove(ev: PointerEvent): void {
      const dxMm = (ev.clientX - startX) / (PX_PER_MM * store.view.zoom);
      const dyMm = (ev.clientY - startY) / (PX_PER_MM * store.view.zoom);

      const others = store.template.elements
        .filter((e2) => e2.id !== elementId)
        .map((e2) => ({ x: e2.anchor.x, y: e2.anchor.y, w: e2.anchor.w, h: e2.anchor.h }));

      const snap = computeSnap({
        target: { x: startAnchorX + dxMm, y: startAnchorY + dyMm, w: elW, h: elH },
        others,
        paper: { w: paperW, h: paperH },
        threshold: ev.altKey ? 0 : SNAP_THRESHOLD_MM,
      });
      store.setGuides(snap.guides);

      const clampedX = Math.max(0, Math.min(snap.snapped.x, paperW - elW));
      const clampedY = Math.max(0, Math.min(snap.snapped.y, paperH - elH));
      store.moveElementMm(elementId, clampedX, clampedY);
    }

    function onUp(): void {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      store.clearGuides();
      dom!.classList.remove('is-pointer-active');
      store.isResizing = false;
      store.commit();
    }
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }
  ```

- [ ] **Step 2: 清理不再使用的本地辅助 `clamp` / `getCellPx`（如果仅 onGripDown 用过且 onResizeDown 还会用就保留）**

  保留 `clamp` 和 `getCellPx`（onResizeDown 在 T7 之前仍是旧实现，需要它们）。

- [ ] **Step 3: 类型检查 + commit**

  ```bash
  docker compose -f docker-compose.dev.yml exec -T web sh -c 'cd /workspace/apps/web && NODE_OPTIONS=--max-old-space-size=4096 ./node_modules/.bin/vue-tsc --noEmit'
  git add apps/web/src/designer/usePointerDrag.ts
  git commit -m "feat(designer): onGripDown 改 mm 精度，直接 commit anchor 不再使用 transform 残差"
  ```

---

### Task 7: §B.2 usePointerDrag.onResizeDown 改 mm 精度

**Files:**
- Modify: `apps/web/src/designer/usePointerDrag.ts`

- [ ] **Step 1: 完全替换 `onResizeDown` 函数体**

  Find整个 `function onResizeDown(side: ResizeSide, e: PointerEvent): void { ... }` 块，替换为：

  ```ts
  function onResizeDown(side: ResizeSide, e: PointerEvent): void {
    const el = getElement();
    if (!el) return;
    const startX = e.clientX;
    const startY = e.clientY;
    const startAnchor = { ...el.anchor };
    const mode = getResizeMode();
    const minMm = minMmFor(el);
    const paperW = store.paperPx.w / PX_PER_MM;
    const paperH = store.paperPx.h / PX_PER_MM;

    store.isResizing = true;

    function onMove(ev: PointerEvent): void {
      let dxMm = (ev.clientX - startX) / (PX_PER_MM * store.view.zoom);
      let dyMm = (ev.clientY - startY) / (PX_PER_MM * store.view.zoom);

      // QR 1:1 lock — 同步两轴
      if (mode === 'qr-lock') {
        const basis = Math.max(Math.abs(dxMm), Math.abs(dyMm));
        dxMm = (dxMm >= 0 ? 1 : -1) * basis;
        dyMm = (dyMm >= 0 ? 1 : -1) * basis;
      }

      let { x, y, w, h } = startAnchor;

      if (side.includes('w')) {
        const newX = startAnchor.x + dxMm;
        const newW = startAnchor.w - dxMm;
        if (newW >= minMm.w) {
          x = newX;
          w = newW;
        } else {
          x = startAnchor.x + startAnchor.w - minMm.w;
          w = minMm.w;
        }
      } else if (side.includes('e')) {
        w = Math.max(minMm.w, startAnchor.w + dxMm);
      }
      if (side.includes('n')) {
        const newY = startAnchor.y + dyMm;
        const newH = startAnchor.h - dyMm;
        if (newH >= minMm.h) {
          y = newY;
          h = newH;
        } else {
          y = startAnchor.y + startAnchor.h - minMm.h;
          h = minMm.h;
        }
      } else if (side.includes('s')) {
        h = Math.max(minMm.h, startAnchor.h + dyMm);
      }

      // QR 严格 w === h（取较小）
      if (mode === 'qr-lock') {
        const m = Math.min(w, h);
        w = m;
        h = m;
      }

      // 1D barcode 最小高度 0.5 mm
      if (mode === 'barcode' && h < 0.5) {
        if (side.includes('n')) {
          y = startAnchor.y + startAnchor.h - 0.5;
        }
        h = 0.5;
      }

      // clamp 不出纸
      if (x < 0) {
        w += x;
        x = 0;
      }
      if (y < 0) {
        h += y;
        y = 0;
      }
      if (x + w > paperW) w = paperW - x;
      if (y + h > paperH) h = paperH - y;

      store.resizeElementMm(elementId, { x, y, w, h });
    }
    function onUp(): void {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      store.isResizing = false;
      store.commit();
    }
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }
  ```

- [ ] **Step 2: 清理已不再使用的辅助** — 如果 `getCellPx` 和 `clamp` 在新 onGripDown / onResizeDown 中均未引用，删除它们；保留 `getElement` 和 `getResizeMode`。

- [ ] **Step 3: 类型检查 + commit**

  ```bash
  docker compose -f docker-compose.dev.yml exec -T web sh -c 'cd /workspace/apps/web && NODE_OPTIONS=--max-old-space-size=4096 ./node_modules/.bin/vue-tsc --noEmit'
  git add apps/web/src/designer/usePointerDrag.ts
  git commit -m "feat(designer): onResizeDown 改 mm 精度，统一 0.25mm 步进、避免 cell 量化跳变"
  ```

---

### Task 8: §D.1 BarcodeElement 占位 + 动态 scale

**Files:**
- Modify: `packages/template-renderer/src/elements/BarcodeElement.vue`

- [ ] **Step 1: 重写 render() 用动态 scale**

  Find:
  ```ts
  function render(): void {
    if (!hasContent.value) return;
    if (!canvasRef.value) return;
    const v = value.value;
    if (!v) return;
    try {
      bwipjs.toCanvas(canvasRef.value, {
        bcid: props.element.symbology,
        text: v,
        scale: 3,
        height: 12,
        includetext: props.element.showText ?? false,
        textxalign: 'center',
        paddingwidth: props.element.quietZone ?? 4,
        textgaps: 2,
        textsize: props.element.textFontSize ?? 10,
        textyoffset:
          props.element.textPosition === 'top' ? -((props.element.textFontSize ?? 10) + 2) : 0,
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
  Replace with:
  ```ts
  function render(): void {
    if (!hasContent.value) return;
    if (!canvasRef.value) return;
    const v = value.value;
    if (!v) return;
    const elPxW = props.element.anchor.w * 4; // PX_PER_MM=4
    const elPxH = props.element.anchor.h * 4;
    // 估算 modules 数: code128 约 11 modules/char + quiet zone 20
    const estModules = v.length * 11 + 20;
    const scale = Math.max(1, Math.floor((elPxW * 0.85) / estModules));
    const height = Math.max(8, Math.floor(elPxH * 0.75));
    try {
      bwipjs.toCanvas(canvasRef.value, {
        bcid: props.element.symbology,
        text: v,
        scale,
        height,
        includetext: props.element.showText ?? false,
        textxalign: 'center',
        paddingwidth: props.element.quietZone ?? 4,
        textgaps: 2,
        textsize: props.element.textFontSize ?? 10,
        textyoffset:
          props.element.textPosition === 'top' ? -((props.element.textFontSize ?? 10) + 2) : 0,
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

- [ ] **Step 2: 替换 watch 依赖 — 监听 anchor 不只是 grid**

  Find:
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
  ```
  Replace with:
  ```ts
  watch(
    () => ({
      anchor: { ...props.element.anchor },
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
  ```

- [ ] **Step 3: 替换 wrapStyle — 去掉拖动 blur，改为渲染占位**

  Find:
  ```ts
  const wrapStyle = computed(() => ({
    width: '100%',
    height: '100%',
    position: 'relative' as const,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    filter: props.isResizing ? 'blur(2px) opacity(0.55)' : 'none',
    transition: 'filter 120ms ease',
  }));
  ```
  Replace with:
  ```ts
  const wrapStyle = computed(() => ({
    width: '100%',
    height: '100%',
    position: 'relative' as const,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  }));
  ```

- [ ] **Step 4: 替换 template — 拖动时显示占位**

  Find:
  ```vue
  <template>
    <div class="tp-barcode">
      <div class="bc-wrap" :style="wrapStyle">
        <canvas v-if="hasContent" ref="canvasRef" class="tp-canvas" />
        <div v-else class="bc-empty">未配置内容</div>
      </div>
    </div>
  </template>
  ```
  Replace with:
  ```vue
  <template>
    <div class="tp-barcode">
      <div v-if="props.isResizing" class="bc-placeholder">
        <span class="bc-icon">||||</span>
        <span class="bc-label">条码</span>
      </div>
      <div v-else class="bc-wrap" :style="wrapStyle">
        <canvas v-if="hasContent" ref="canvasRef" class="tp-canvas" />
        <div v-else class="bc-empty">未配置内容</div>
      </div>
    </div>
  </template>
  ```

- [ ] **Step 5: 追加占位样式到 `<style scoped>`**

  在 `</style>` 之前追加：

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
  .bc-label {
    font-size: 10px;
    color: var(--tp-ink-soft, #555);
  }
  ```

- [ ] **Step 6: 类型检查 + commit**

  ```bash
  docker compose -f docker-compose.dev.yml exec -T web sh -c 'cd /workspace/apps/web && NODE_OPTIONS=--max-old-space-size=4096 ./node_modules/.bin/vue-tsc --noEmit'
  git add packages/template-renderer/src/elements/BarcodeElement.vue
  git commit -m "feat(renderer): Barcode 拖动显示占位图标 + 静止按 anchor 动态 scale"
  ```

---

### Task 9: §D.2 QrElement 占位

**Files:**
- Modify: `packages/template-renderer/src/elements/QrElement.vue`

- [ ] **Step 1: 替换 wrapStyle — 去掉 blur**

  Find:
  ```ts
  const wrapStyle = computed(() => ({
    width: '100%',
    height: '100%',
    position: 'relative' as const,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    filter: props.isResizing ? 'blur(2px) opacity(0.55)' : 'none',
    transition: 'filter 120ms ease',
  }));
  ```
  Replace with:
  ```ts
  const wrapStyle = computed(() => ({
    width: '100%',
    height: '100%',
    position: 'relative' as const,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  }));
  ```

- [ ] **Step 2: 替换 template — 拖动时显示占位**

  Find:
  ```vue
  <template>
    <div class="qr-wrap" :style="wrapStyle">
      <div
        v-if="hasContent"
        class="qr-svg"
        :style="{ color: props.element.foregroundColor, background: props.element.backgroundColor }"
        v-html="qrSvg"
      />
      <div v-else class="qr-empty">未配置内容</div>
    </div>
  </template>
  ```
  Replace with:
  ```vue
  <template>
    <div v-if="props.isResizing" class="qr-placeholder">
      <div class="qr-icon">▦</div>
      <span class="qr-label">二维码</span>
    </div>
    <div v-else class="qr-wrap" :style="wrapStyle">
      <div
        v-if="hasContent"
        class="qr-svg"
        :style="{ color: props.element.foregroundColor, background: props.element.backgroundColor }"
        v-html="qrSvg"
      />
      <div v-else class="qr-empty">未配置内容</div>
    </div>
  </template>
  ```

- [ ] **Step 3: 追加占位样式到 `<style scoped>`**

  在 `</style>` 之前追加：

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
  .qr-label {
    font-size: 10px;
    color: var(--tp-ink-soft, #555);
  }
  ```

- [ ] **Step 4: 类型检查 + commit**

  ```bash
  docker compose -f docker-compose.dev.yml exec -T web sh -c 'cd /workspace/apps/web && NODE_OPTIONS=--max-old-space-size=4096 ./node_modules/.bin/vue-tsc --noEmit'
  git add packages/template-renderer/src/elements/QrElement.vue
  git commit -m "feat(renderer): QR 拖动显示占位图标 + 去掉 blur 视觉噪音"
  ```

---

### Task 10: 最终验收（合并 iter 8 #13 + iter 9 全量）

**Files:** 无文件改动 — 这是一次全套验收和文档收尾。

- [ ] **Step 1: 在 web 容器跑 vue-tsc**

  ```bash
  docker compose -f docker-compose.dev.yml exec -T web sh -c 'cd /workspace/apps/web && NODE_OPTIONS=--max-old-space-size=4096 ./node_modules/.bin/vue-tsc --noEmit'
  ```
  Expected: exit 0

- [ ] **Step 2: 跑 schema 包测试**

  ```bash
  docker compose -f docker-compose.dev.yml exec -T web sh -c 'cd /workspace/packages/schema && npm test'
  ```
  Expected: 所有用例通过

- [ ] **Step 3: 启动 dev server 走查验收清单**

  ```bash
  docker compose -f docker-compose.dev.yml ps
  ```
  确认 web 容器在运行；如未运行：`docker compose -f docker-compose.dev.yml up -d web`

  浏览器打开 http://localhost:3000/designer/new 并逐条验证：

  **iter 9 §A — 选中态**
  - [ ] 放一个 text 元素，选中后看到 outline 在元素外 3px
  - [ ] 在属性面板配置上边框 1px 黑色 → 黑边清晰可见、不被紫框覆盖

  **iter 9 §B — 拖动/缩放**
  - [ ] 切到 A5 portrait，拖动一个元素 → 流畅跟手、无跳变
  - [ ] 用「自定义画布 90×60mm」（出门证）创建一个 30mm×10mm 条码 → 缩放角点流畅、不跳格、不偏离指针
  - [ ] A4 landscape 下拖动 / 缩放体验正常
  - [ ] 拖动后 ⌘Z 撤销正确还原

  **iter 9 §C — 纸张预设**
  - [ ] paper 下拉只显示: A3 / A4 / A5 / B4 / B5 + 「自定义…」
  - [ ] 旋转按钮一击切换横竖、label 显示「A4 横」等
  - [ ] localStorage 注入旧 'GuardPass' 或 'A6' 草稿 → 加载后自动回退到 A4/A5、不报错

    手动注入测试：
    ```js
    // 浏览器 devtools console
    localStorage.setItem('tp_designer_draft', JSON.stringify({
      id: 'tpl_test', meta: { name: 'legacy', description: '', version: 1, tags: [] },
      canvas: { paper: 'A6', orientation: 'portrait', cols: 1, rows: 1, cell: { w: 4, h: 4 }, background: null },
      schema: {}, elements: []
    }));
    location.reload();
    ```
    Expected: paper label 显示「A5」（不报错）

  **iter 9 §D — Barcode/QR**
  - [ ] 拖动 barcode 元素 → 显示「||||  条码」占位
  - [ ] 拖动 QR 元素 → 显示「▦  二维码」占位
  - [ ] 松手后 barcode 真实渲染，30mm 宽下条形清晰可读
  - [ ] 松手后 QR 真实渲染、不像素化

  **iter 8 §D — Snap guides（顺带回归）**
  - [ ] 拖动元素靠近其他元素边/中线 → 出现紫色辅助线
  - [ ] 两元素水平/垂直对齐时显示距离 label
  - [ ] 按住 Alt 拖动 → snap 关闭，无辅助线
  - [ ] 松手后辅助线消失

- [ ] **Step 4: 标记 iter 8 任务 #91 + iter 9 完成**

  使用 TaskUpdate 把 #91 标 completed，并新建 iter 9 总览任务标记 completed。

- [ ] **Step 5: 推送分支到 origin（如已经追踪了远程）**

  ```bash
  git status
  git log --oneline -20
  ```
  确认所有 commit 都在 `feature/plan-2-designer` 分支上。是否合并由用户决定，不在本任务范围。

---

## 不在范围 (out of scope)

- 不引入新的 Designer 功能或属性
- 不改 PropertyPanel UI
- 不动 snap guides 算法（仅做回归测试）
- 不重写 TableColumnsEditor / FieldManager
- 不动 schema 定义
- 不发起 PR 或合并 master（由用户手动操作）
