# Designer Iteration 11 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development.

**Goal:** 修复 7 类问题：iter 9 T5 留下的 zoom 渲染 bug（§G Critical）、居中辅助线消失（§A）、拖不到纸张右侧（§B）、grip 位置反了（§C）、最大尺寸文档化（§D）、预览/打印渲染不一致（§E）、打印 zoom 异常（§F）。

**Architecture:** 7 个批次分 8 个任务，按 critical 程度排序（§G 第一，避免后续任务依赖错误的 zoom 渲染）。

**Tech Stack:** Vue 3 + Pinia + Element Plus + bwip-js + qrcode-generator. 类型检查命令：

```bash
docker compose -f docker-compose.dev.yml exec -T web sh -c 'cd /workspace/apps/web && NODE_OPTIONS=--max-old-space-size=4096 ./node_modules/.bin/vue-tsc --noEmit'
```

---

## File Structure

| 文件 | 任务 |
|---|---|
| `apps/web/src/designer/CanvasElement.vue` | T1, T4 |
| `apps/web/src/designer/snapGuides.ts` | T2 |
| `apps/web/src/designer/usePointerDrag.ts` | T2, T3 |
| `apps/web/src/designer/ElementGrip.vue` | T4 |
| `packages/template-renderer/src/TemplateRenderer.vue` | T5 |
| `apps/web/src/stores/designer.ts` | T6 |
| `packages/schema/test/template.spec.ts` | T6 |
| `apps/web/src/designer/DesignerHeader.vue` | T7 |
| — | T8 (acceptance) |

---

### Task 1: §G — CanvasElement zoom 因子修复 (Critical)

**Files:** Modify: `apps/web/src/designer/CanvasElement.vue`

- [ ] **Step 1: 替换 positionStyle**

  Find:
  ```ts
  const PX_PER_MM = 4;
  const positionStyle = computed(() => ({
    left: `${props.element.anchor.x * PX_PER_MM}px`,
    top: `${props.element.anchor.y * PX_PER_MM}px`,
    width: `${props.element.anchor.w * PX_PER_MM}px`,
    height: `${props.element.anchor.h * PX_PER_MM}px`,
  }));
  ```
  Replace with:
  ```ts
  const PX_PER_MM = 4;
  const positionStyle = computed(() => {
    const z = store.view.zoom;
    return {
      left: `${props.element.anchor.x * PX_PER_MM * z}px`,
      top: `${props.element.anchor.y * PX_PER_MM * z}px`,
      width: `${props.element.anchor.w * PX_PER_MM * z}px`,
      height: `${props.element.anchor.h * PX_PER_MM * z}px`,
    };
  });
  ```

- [ ] **Step 2: 类型检查 + commit**

  ```bash
  docker compose -f docker-compose.dev.yml exec -T web sh -c 'cd /workspace/apps/web && NODE_OPTIONS=--max-old-space-size=4096 ./node_modules/.bin/vue-tsc --noEmit'
  git add apps/web/src/designer/CanvasElement.vue
  git commit -m "fix(designer): CanvasElement 位置/尺寸乘 zoom 修复跟手延迟（iter 9 T5 残留 bug）"
  ```

---

### Task 2: §A — snap guides 双阈值

**Files:** Modify: `apps/web/src/designer/snapGuides.ts`, `apps/web/src/designer/usePointerDrag.ts`

#### 2A: snapGuides.ts 加 guideThreshold 参数

- [ ] **Step 1: 加入并导出 GUIDE_THRESHOLD_MM 常量 + 修改 SnapInput**

  在 `snapGuides.ts` 顶部加入：
  ```ts
  export const SNAP_THRESHOLD_MM = 1.5;
  export const GUIDE_THRESHOLD_MM = 5;
  ```

  修改 `SnapInput` 接口：
  ```ts
  export interface SnapInput {
    target: { x: number; y: number; w: number; h: number };
    others: Array<{ x: number; y: number; w: number; h: number }>;
    paper: { w: number; h: number };
    threshold: number;
    guideThreshold: number;
  }
  ```

- [ ] **Step 2: 修改 computeSnap 函数，用 guideThreshold 收集线**

  Find（hitV / hitH 计算块）:
  ```ts
  if (bestV) {
    snapDx = bestV.delta;
    for (const tl of t.v) {
      const newPos = tl + snapDx;
      for (const cl of c.v) {
        if (Math.abs(cl - newPos) < 0.001) hitV.push(cl);
      }
    }
  }
  ```
  Replace with:
  ```ts
  if (bestV) {
    snapDx = bestV.delta;
  }
  // Independent of bestV: collect all candidate lines within guideThreshold
  // for visual display, even when no snap fires.
  for (const tl of t.v) {
    const newPos = tl + snapDx;
    for (const cl of c.v) {
      if (Math.abs(cl - newPos) <= input.guideThreshold) hitV.push(cl);
    }
  }
  ```

  同理对 hitH 块：
  ```ts
  if (bestH) {
    snapDy = bestH.delta;
  }
  for (const tl of t.h) {
    const newPos = tl + snapDy;
    for (const cl of c.h) {
      if (Math.abs(cl - newPos) <= input.guideThreshold) hitH.push(cl);
    }
  }
  ```

#### 2B: usePointerDrag.ts 调用更新

- [ ] **Step 3: 替换 SNAP_THRESHOLD_MM 常量声明**

  在 `usePointerDrag.ts` 顶部，找到：
  ```ts
  const PX_PER_MM = 4;
  const SNAP_THRESHOLD_MM = 1.5;
  ```
  Replace with:
  ```ts
  import { computeSnap, SNAP_THRESHOLD_MM, GUIDE_THRESHOLD_MM } from './snapGuides';

  const PX_PER_MM = 4;
  ```
  （把 SNAP_THRESHOLD_MM 改为从 snapGuides 导入，删除本地声明。）

  注意：原来的 `import { computeSnap } from './snapGuides';` 改为同一行导入三个符号。如果 import 已经在别处，合并它们。

- [ ] **Step 4: onGripDown 调用增加 guideThreshold**

  Find（onGripDown 内的 computeSnap 调用）:
  ```ts
  const snap = computeSnap({
    target: { x: startAnchorX + dxMm, y: startAnchorY + dyMm, w: elW, h: elH },
    others,
    paper: { w: paperW, h: paperH },
    threshold: ev.altKey ? 0 : SNAP_THRESHOLD_MM,
  });
  ```
  Replace with:
  ```ts
  const snap = computeSnap({
    target: { x: startAnchorX + dxMm, y: startAnchorY + dyMm, w: elW, h: elH },
    others,
    paper: { w: paperW, h: paperH },
    threshold: ev.altKey ? 0 : SNAP_THRESHOLD_MM,
    guideThreshold: ev.altKey ? 0 : GUIDE_THRESHOLD_MM,
  });
  ```

- [ ] **Step 5: 类型检查 + commit**

  ```bash
  docker compose -f docker-compose.dev.yml exec -T web sh -c 'cd /workspace/apps/web && NODE_OPTIONS=--max-old-space-size=4096 ./node_modules/.bin/vue-tsc --noEmit'
  git add apps/web/src/designer/snapGuides.ts apps/web/src/designer/usePointerDrag.ts
  git commit -m "feat(designer): snap guides 双阈值 — 显示 5mm / 吸附 1.5mm，中心区辅助线持续可见"
  ```

---

### Task 3: §B — usePointerDrag 边缘自动滚动

**Files:** Modify: `apps/web/src/designer/usePointerDrag.ts`

- [ ] **Step 1: 加 EDGE_PX / SCROLL_STEP 常量 + autoScroll 函数**

  在 `usePointerDrag.ts` 顶部常量声明后追加：
  ```ts
  const EDGE_PX = 30;
  const SCROLL_STEP = 8;

  function autoScrollNearEdge(ev: PointerEvent): void {
    const ca = document.querySelector('.tp-canvas-area') as HTMLElement | null;
    if (!ca) return;
    const rect = ca.getBoundingClientRect();
    let dx = 0;
    let dy = 0;
    if (ev.clientX < rect.left + EDGE_PX) dx = -SCROLL_STEP;
    else if (ev.clientX > rect.right - EDGE_PX) dx = SCROLL_STEP;
    if (ev.clientY < rect.top + EDGE_PX) dy = -SCROLL_STEP;
    else if (ev.clientY > rect.bottom - EDGE_PX) dy = SCROLL_STEP;
    if (dx !== 0 || dy !== 0) ca.scrollBy(dx, dy);
  }
  ```

- [ ] **Step 2: onGripDown.onMove 末尾调用 autoScrollNearEdge**

  Find（onGripDown 内 onMove 函数末尾，在 `store.moveElementMm(...)` 之后）:
  ```ts
  store.moveElementMm(elementId, clampedX, clampedY);
  }
  ```
  Replace with:
  ```ts
  store.moveElementMm(elementId, clampedX, clampedY);
  autoScrollNearEdge(ev);
  }
  ```

- [ ] **Step 3: onResizeDown.onMove 末尾也调用**

  Find（onResizeDown 内 onMove 函数末尾，在 `store.resizeElementMm(...)` 之后）:
  ```ts
  store.resizeElementMm(elementId, { x, y, w, h });
  }
  ```
  Replace with:
  ```ts
  store.resizeElementMm(elementId, { x, y, w, h });
  autoScrollNearEdge(ev);
  }
  ```

- [ ] **Step 4: 类型检查 + commit**

  ```bash
  docker compose -f docker-compose.dev.yml exec -T web sh -c 'cd /workspace/apps/web && NODE_OPTIONS=--max-old-space-size=4096 ./node_modules/.bin/vue-tsc --noEmit'
  git add apps/web/src/designer/usePointerDrag.ts
  git commit -m "feat(designer): 拖动接近 canvas-area 边缘 30px 时自动滚动"
  ```

---

### Task 4: §C — Grip 三态位置 + 统一胶囊样式

**Files:** Modify: `apps/web/src/designer/ElementGrip.vue`, `apps/web/src/designer/CanvasElement.vue`

#### 4A: ElementGrip.vue 三态 prop + 三套位置 + 统一胶囊样式

- [ ] **Step 1: 完全替换 ElementGrip.vue**

  Replace entire file with:
  ```vue
  <script setup lang="ts">
  defineProps<{ mode: 'inside' | 'outside-above' | 'outside-below' }>();
  defineEmits<{ (e: 'pointerdown', ev: PointerEvent): void }>();
  </script>

  <template>
    <div
      class="tp-grip"
      :class="{
        'tp-grip--inside': mode === 'inside',
        'tp-grip--outside-above': mode === 'outside-above',
        'tp-grip--outside-below': mode === 'outside-below',
      }"
      @pointerdown.stop="$emit('pointerdown', $event)"
    >
      <span class="tp-grip-dots"><i /><i /><i /><i /><i /><i /></span>
    </div>
  </template>

  <style scoped>
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
    transition: background 120ms ease;
  }
  .tp-grip:hover {
    background: var(--tp-accent-bg);
  }
  .tp-grip:active {
    cursor: grabbing;
  }
  .tp-grip--inside {
    top: 4px;
  }
  .tp-grip--outside-above {
    top: -28px;
  }
  .tp-grip--outside-below {
    top: auto;
    bottom: -28px;
  }
  .tp-grip-dots {
    display: grid;
    grid-template-columns: repeat(3, 3px);
    grid-template-rows: repeat(2, 3px);
    gap: 2.5px;
  }
  .tp-grip-dots i {
    background: var(--tp-accent);
    border-radius: 50%;
    width: 3px;
    height: 3px;
    display: block;
  }
  </style>
  ```

#### 4B: CanvasElement.vue gripMode computed + 替换 prop

- [ ] **Step 2: 替换 useInsideGrip 计算 + 加入 gripMode**

  Find:
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
  Replace with:
  ```ts
  const isNearTop = computed(() => props.element.anchor.y < 8);

  const canFitInside = computed(
    () => props.element.anchor.w >= 10 && props.element.anchor.h >= 8,
  );

  const gripMode = computed<'inside' | 'outside-above' | 'outside-below'>(() => {
    if (canFitInside.value) return 'inside';
    if (isNearTop.value) return 'outside-below';
    return 'outside-above';
  });
  ```

- [ ] **Step 3: 替换模板里的 ElementGrip 调用**

  Find:
  ```vue
  <ElementGrip v-if="isSelected" :is-small="!useInsideGrip" @pointerdown="onGripDown" />
  ```
  Replace with:
  ```vue
  <ElementGrip v-if="isSelected" :mode="gripMode" @pointerdown="onGripDown" />
  ```

- [ ] **Step 4: 类型检查 + 单 commit**

  ```bash
  docker compose -f docker-compose.dev.yml exec -T web sh -c 'cd /workspace/apps/web && NODE_OPTIONS=--max-old-space-size=4096 ./node_modules/.bin/vue-tsc --noEmit'
  git add apps/web/src/designer/ElementGrip.vue apps/web/src/designer/CanvasElement.vue
  git commit -m "feat(designer): grip 三态位置 — 大→内部 / 小→外上 / 小+贴顶→外下，统一胶囊样式"
  ```

---

### Task 5: §E.1 + §E.2 — TemplateRenderer 加 QR + 改 anchor

**Files:** Modify: `packages/template-renderer/src/TemplateRenderer.vue`

- [ ] **Step 1: 加 QR import + 常量**

  在 `<script setup>` 顶部其他 import 之后追加：
  ```ts
  import QrElement from './elements/QrElement.vue';

  const PX_PER_MM = 4;
  ```

- [ ] **Step 2: elementMap 加 qr**

  Find:
  ```ts
  const elementMap: Record<string, Component> = {
    text: TextElement,
    field: FieldElement,
    image: ImageElement,
    table: TableElement,
    barcode: BarcodeElement,
    autonumber: AutonumberElement,
    system: SystemElement,
    rect: RectElement,
  };
  ```
  Replace with:
  ```ts
  const elementMap: Record<string, Component> = {
    text: TextElement,
    field: FieldElement,
    image: ImageElement,
    table: TableElement,
    barcode: BarcodeElement,
    qr: QrElement,
    autonumber: AutonumberElement,
    system: SystemElement,
    rect: RectElement,
  };
  ```

- [ ] **Step 3: 元素 div :style 改读 anchor**

  Find:
  ```vue
  <div
    v-for="el in props.template.elements"
    :key="el.id"
    class="tp-element"
    :style="{
      left: `calc(${el.grid.c} * var(--cell-w))`,
      top: `calc(${el.grid.r} * var(--cell-h))`,
      width: `calc(${el.grid.cs} * var(--cell-w))`,
      height: `calc(${el.grid.rs} * var(--cell-h))`,
    }"
  >
  ```
  Replace with:
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

- [ ] **Step 4: 类型检查 + commit**

  ```bash
  docker compose -f docker-compose.dev.yml exec -T web sh -c 'cd /workspace/apps/web && NODE_OPTIONS=--max-old-space-size=4096 ./node_modules/.bin/vue-tsc --noEmit'
  git add packages/template-renderer/src/TemplateRenderer.vue
  git commit -m "fix(renderer): elementMap 加入 QR + 元素改用 anchor 定位，与设计器对齐"
  ```

---

### Task 6: §E.3 + §E.4 — usedFieldKeys 加 QR + schema 覆盖测试

**Files:** Modify: `apps/web/src/stores/designer.ts`, `packages/schema/test/template.spec.ts`

- [ ] **Step 1: usedFieldKeys 加 QR 分支**

  Find:
  ```ts
  usedFieldKeys: (s): Set<string> => {
    const used = new Set<string>();
    for (const el of s.template.elements) {
      if (el.type === 'field' || el.type === 'table') used.add(el.binding);
      if (el.type === 'image' && el.source.kind === 'field') used.add(el.source.binding);
      if (el.type === 'barcode' && el.binding) used.add(el.binding);
    }
    return used;
  },
  ```
  Replace with:
  ```ts
  usedFieldKeys: (s): Set<string> => {
    const used = new Set<string>();
    for (const el of s.template.elements) {
      if (el.type === 'field' || el.type === 'table') used.add(el.binding);
      if (el.type === 'image' && el.source.kind === 'field') used.add(el.source.binding);
      if ((el.type === 'barcode' || el.type === 'qr') && el.binding) used.add(el.binding);
    }
    return used;
  },
  ```

- [ ] **Step 2: schema test 加 element-type 覆盖断言**

  在 `packages/schema/test/template.spec.ts` 末尾追加新 describe 块：

  ```ts
  describe('TemplateElementSchema element type coverage (iter 11)', () => {
    it('all schema-declared element types are accounted for', () => {
      // Source of truth: which types the schema declares
      const schemaTypes = (TemplateElementSchema.options as Array<{ shape: { type: { value: string } } }>)
        .map((opt) => opt.shape.type.value)
        .sort();

      // Mirror: which types the renderers handle
      // Keep this list in sync with:
      //   - apps/web/src/designer/CanvasElement.vue (elementMap)
      //   - packages/template-renderer/src/TemplateRenderer.vue (elementMap)
      const renderedTypes = [
        'text',
        'field',
        'image',
        'table',
        'barcode',
        'qr',
        'autonumber',
        'system',
        'rect',
      ].sort();

      expect(schemaTypes).toEqual(renderedTypes);
    });
  });
  ```

  注意：需要确认 `TemplateElementSchema` 已经在文件顶部 import。如果用的是 `TemplateElement` 类型而不是 schema，加上：
  ```ts
  import { TemplateElementSchema } from '../src/template';
  ```

- [ ] **Step 3: 跑测试确认**

  ```bash
  docker compose -f docker-compose.dev.yml exec -T web sh -c 'cd /workspace/packages/schema && npm test'
  ```
  Expected: all tests pass including the new one.

- [ ] **Step 4: 类型检查 + commit**

  ```bash
  docker compose -f docker-compose.dev.yml exec -T web sh -c 'cd /workspace/apps/web && NODE_OPTIONS=--max-old-space-size=4096 ./node_modules/.bin/vue-tsc --noEmit'
  git add apps/web/src/stores/designer.ts packages/schema/test/template.spec.ts
  git commit -m "fix(store+schema): usedFieldKeys 加 QR 分支 + schema element-type 覆盖测试"
  ```

---

### Task 7: §F — 打印 zoom 重置

**Files:** Modify: `apps/web/src/designer/DesignerHeader.vue`

- [ ] **Step 1: 增加 beforeprint / afterprint 监听**

  在 `<script setup>` 中找到 `import { computed, nextTick, ref } from 'vue';` —— 加 `onMounted, onBeforeUnmount`：
  ```ts
  import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
  ```

  在 `function doPrint()` 之前加：
  ```ts
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
  ```

- [ ] **Step 2: 类型检查 + commit**

  ```bash
  docker compose -f docker-compose.dev.yml exec -T web sh -c 'cd /workspace/apps/web && NODE_OPTIONS=--max-old-space-size=4096 ./node_modules/.bin/vue-tsc --noEmit'
  git add apps/web/src/designer/DesignerHeader.vue
  git commit -m "fix(designer): 打印前 zoom 重置为 1，afterprint 还原 — 输出尺寸正确"
  ```

---

### Task 8: 最终验收

无文件改动 — 自动化检查 + 浏览器走查（用户做）。

- [ ] **Step 1: 全套 vue-tsc**

  ```bash
  docker compose -f docker-compose.dev.yml exec -T web sh -c 'cd /workspace/apps/web && NODE_OPTIONS=--max-old-space-size=4096 ./node_modules/.bin/vue-tsc --noEmit'
  ```
  Expected: exit 0

- [ ] **Step 2: schema tests**

  ```bash
  docker compose -f docker-compose.dev.yml exec -T web sh -c 'cd /workspace/packages/schema && npm test'
  ```
  Expected: all tests pass (46+ tests, including new element-type coverage)

- [ ] **Step 3: 浏览器走查（http://localhost:5173/designer/new，Ctrl+Shift+R 硬刷新）**

  **§G zoom 修复**
  - [ ] zoom 100%：元素跟随鼠标 1:1
  - [ ] zoom 50%：元素跟随鼠标 1:1（不快不慢）
  - [ ] zoom 200%：元素跟随鼠标 1:1
  - [ ] 出门证 90×60 fit 视图后拖元素流畅跟手
  - [ ] zoom 切换前后元素位置数据不漂移

  **§A 双阈值 snap guides**
  - [ ] 拖元素离纸张中心 3mm 时辅助线显示
  - [ ] 拖到正中心，辅助线 + 位置吸附
  - [ ] 离中心 6mm 时辅助线消失
  - [ ] Alt 拖动时辅助线消失，吸附也关

  **§B 自动滚动**
  - [ ] 出门证 zoom 较高时拖元素到 canvas-area 右缘 30px 内：自动横向滚动
  - [ ] 元素持续跟随鼠标移动
  - [ ] 不拖动时停止滚动

  **§C grip 三态**
  - [ ] 元素 ≥ 10mm × 8mm → 胶囊位于元素内部顶部居中
  - [ ] 元素 < 10mm × 8mm 且 y ≥ 8mm → 胶囊在外部上方
  - [ ] 元素 < 10mm × 8mm 且 y < 8mm → 胶囊翻到下方
  - [ ] 三种位置视觉风格一致（同款带边框胶囊）

  **§D 最大尺寸防护（iter 10 已加）**
  - [ ] 拖动 / 缩放任何元素到纸张边界外不消失
  - [ ] 属性面板手填 anchor.x = -50 自动 clamp 到 0

  **§E 预览/打印对齐**
  - [ ] 预览中 QR 出现（之前缺失）
  - [ ] 预览中 sample data 表单列出 QR / barcode / table 实际绑定的字段（schema 内的）
  - [ ] 设计器 zoom=1 与预览 100% zoom 元素位置 1:1 对齐
  - [ ] schema test 覆盖 9 种 element type

  **§F 打印**
  - [ ] zoom=1.21 下点「立即打印」 → 打印预览中纸张尺寸正确（A4 ≈ 21cm × 29.7cm）
  - [ ] 关闭打印对话框 → 设计器 zoom 恢复 1.21
  - [ ] PDF 输出比对：打印 PDF 与预览 100% 输出像素一致

  **iter 8/9/10 回归**
  - [ ] 拖动元素出现 snap guides（紫色辅助线）
  - [ ] 选中元素时 outline 与用户自定义边框留 3px 间隔
  - [ ] 自定义纸张 90×60mm 应用后画布正确更新
  - [ ] 变量区域 4+ 个变量出现滚动
  - [ ] 预览界面横向滚动正常

- [ ] **Step 4: 标记 iter 11 完成**

  使用 TaskUpdate 把 iter 11 总览任务标 completed。

---

## 不在范围 (out of scope)

- 不引入新 Designer 功能或元素属性
- 不动 PropertyPanel UI
- 不重写 FieldManager / TableColumnsEditor
- 不动 schema 字段定义（只加测试）
- 不发起 PR 或合并 master（用户手动操作）
