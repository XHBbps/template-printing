# Designer Iteration 13 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development.

**Goal:** 修复打印与模板/预览不一致：浏览器默认 A4 而模板可能是 B4 导致 paper 溢出 + 缩放；选中态 4 个角点 dots 被打到打印输出里。

**Tech Stack:** Vue 3 + Pinia + Element Plus. 类型检查：
```bash
docker compose -f docker-compose.dev.yml exec -T web sh -c 'cd /workspace/apps/web && NODE_OPTIONS=--max-old-space-size=4096 ./node_modules/.bin/vue-tsc --noEmit'
```

---

## File Structure

| 文件 | 任务 |
|---|---|
| `apps/web/src/designer/DesignerHeader.vue` | T1 |
| `apps/web/src/styles/designer.css` | T2 |
| — | T3（验收） |

---

### Task 1: §A — `doPrint` 注入 `@page` 强制模板纸张

**Files:** Modify: `apps/web/src/designer/DesignerHeader.vue`

- [ ] **Step 1: 完全替换 `doPrint` 函数**

  Find:
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
  Replace with:
  ```ts
  async function doPrint(): Promise<void> {
    const prevZoom = store.view.zoom;

    // Inject @page rule so browser uses the template's paper size,
    // not the printer's default (usually A4). Prevents content scaling /
    // overflow / extra blank pages when template paper != A4.
    const PX_PER_MM = 4;
    const paperMm = {
      w: store.paperPx.w / PX_PER_MM,
      h: store.paperPx.h / PX_PER_MM,
    };
    const styleEl = document.createElement('style');
    styleEl.id = '__tp_print_page__';
    styleEl.textContent = `@page { size: ${paperMm.w}mm ${paperMm.h}mm; margin: 0; }`;
    document.head.appendChild(styleEl);

    if (prevZoom !== 1) {
      store.setZoom(1);
      await nextTick();
    }
    window.print();

    styleEl.remove();
    if (prevZoom !== 1) {
      store.setZoom(prevZoom);
    }
  }
  ```

- [ ] **Step 2: 类型检查 + commit**

  ```bash
  docker compose -f docker-compose.dev.yml exec -T web sh -c 'cd /workspace/apps/web && NODE_OPTIONS=--max-old-space-size=4096 ./node_modules/.bin/vue-tsc --noEmit'
  git add apps/web/src/designer/DesignerHeader.vue
  git commit -m "fix(print): 注入 @page 规则按模板纸张尺寸打印，避免 A4 默认导致溢出/缩放"
  ```

---

### Task 2: §B — `@media print` 隐藏 `.tp-handle`

**Files:** Modify: `apps/web/src/styles/designer.css`

- [ ] **Step 1: 在 `@media print` 块的 `display: none` 列表加 `.tp-handle`**

  Find:
  ```css
    .tp-grip,
    .tp-hit-zones,
    .tp-size-badge {
      display: none !important;
    }
  ```
  Replace with:
  ```css
    .tp-grip,
    .tp-hit-zones,
    .tp-handle,
    .tp-size-badge {
      display: none !important;
    }
  ```

- [ ] **Step 2: 类型检查 + commit**

  ```bash
  docker compose -f docker-compose.dev.yml exec -T web sh -c 'cd /workspace/apps/web && NODE_OPTIONS=--max-old-space-size=4096 ./node_modules/.bin/vue-tsc --noEmit'
  git add apps/web/src/styles/designer.css
  git commit -m "fix(print): @media print 隐藏 .tp-handle 选中态角点，不再被打印"
  ```

---

### Task 3: 最终验收

无文件改动。

- [ ] **Step 1: vue-tsc 通过**
- [ ] **Step 2: schema tests 46/46 通过**
- [ ] **Step 3: 浏览器走查（http://localhost:5173/，Ctrl+Shift+R 硬刷新）**

  - [ ] 模板设为 **B4 纵向**，加几个元素，点「立即打印」→ 打印预览中纸张就是 B4 (250×353mm)，**不再分两页**
  - [ ] 模板设为 **A4 横向**，打印 → A4 横向纸
  - [ ] 模板设为 **自定义 90×60mm**，打印 → 90×60mm 小尺寸纸
  - [ ] 元素位置和大小与设计器、预览**像素级一致**
  - [ ] 选中态 4 个紫色角点圆 **不出现** 在打印输出里
  - [ ] 关闭打印对话框后，原 zoom 恢复，注入的 `@page` style 被清除（检查 `document.head` 内无残留）

---

## 不在范围

- 不改 element 渲染
- 不动 schema / store getter
- 不发起 PR
