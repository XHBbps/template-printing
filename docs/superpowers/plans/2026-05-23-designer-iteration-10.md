# Designer Iteration 10 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development.

**Goal:** 修复 iter 9 走查后用户反馈的 6 个问题：自定义纸张不生效、高级折叠耦合的视觉再确认、变量区域高度调整、预览界面左右滚动缺失、示例数据过滤、元素越界消失防护三件套。

**Tech Stack:** Vue 3 + Pinia + Element Plus + bwip-js + qrcode-generator. Type-check：

```bash
docker compose -f docker-compose.dev.yml exec -T web sh -c 'cd /workspace/apps/web && NODE_OPTIONS=--max-old-space-size=4096 ./node_modules/.bin/vue-tsc --noEmit'
```

---

## File Structure

| 文件 | 任务 |
|---|---|
| `apps/web/src/designer/CustomPaperDialog.vue` | T1 (调查 + 修复) |
| `apps/web/src/designer/DesignerHeader.vue` | T1 (确保 confirm 调用 setPaper) |
| `apps/web/src/stores/designer.ts` | T1 (setPaper custom 路径) + T5 (anchor clamp 三层) |
| `apps/web/src/designer/FieldManager.vue` | T2 (max-height 168px) |
| `apps/web/src/views/PreviewView.vue` | T3 (横向滚动) + T4 (sample data 过滤) |
| `apps/web/src/designer/PropertyPanel.vue` | T6 (advanced 区分) |
| `apps/web/src/designer/usePointerDrag.ts` | T5 (onResizeDown w/h 兜底) |

---

### Task 1: 自定义纸张不生效 — 调查 + 修复

**Files:** Modify: `apps/web/src/designer/CustomPaperDialog.vue`, `apps/web/src/designer/DesignerHeader.vue`, `apps/web/src/stores/designer.ts`

- [ ] **Step 1: 走读现状（5 分钟）**

  完整阅读以下三个文件：
  - `apps/web/src/designer/CustomPaperDialog.vue`（dialog UI）
  - `apps/web/src/designer/DesignerHeader.vue` 第 28-101 行（dropdown + `openCustomDialog` + `onCustomPaperConfirm`）
  - `apps/web/src/stores/designer.ts` 的 `setPaper(paper)` action 和 `paperPxSize(paper, orientation)` 辅助函数

  确认数据流：
  1. Dropdown 点 「自定义…」→ `openCustomDialog()` → `customDialogOpen = true`
  2. Dialog 弹出 → 用户输入 w/h → `confirm()` → `emit('confirm', { w_mm, h_mm })`
  3. DesignerHeader `onCustomPaperConfirm(size)` → `store.setPaper(size)`
  4. setPaper 写入 `template.canvas.paper = { w_mm, h_mm }`，recompute cell/cols/rows

- [ ] **Step 2: 加临时调试日志**

  在 CustomPaperDialog.vue `confirm()`、DesignerHeader.vue `onCustomPaperConfirm()`、stores/designer.ts `setPaper()` 三处入口各加一行 console.log，输出参数。

  示例 — CustomPaperDialog.vue:
  ```ts
  function confirm() {
    console.log('[CustomPaperDialog] confirm', { w_mm: Math.round(w.value), h_mm: Math.round(h.value), canConfirm: canConfirm.value });
    emit('confirm', { w_mm: Math.round(w.value), h_mm: Math.round(h.value) });
    emit('update:modelValue', false);
  }
  ```

  示例 — DesignerHeader.vue:
  ```ts
  function onCustomPaperConfirm(size: { w_mm: number; h_mm: number }): void {
    console.log('[DesignerHeader] onCustomPaperConfirm', size);
    store.setPaper(size);
  }
  ```

  示例 — stores/designer.ts `setPaper()` 顶部：
  ```ts
  setPaper(paper) {
    console.log('[store.setPaper] called with', JSON.stringify(paper), 'current orientation', this.template.canvas.orientation);
    ...
  }
  ```

- [ ] **Step 3: 在 docker dev server 中重现**

  打开 dev server（已运行）→ http://localhost:3000/designer/new

  操作：paper 下拉 → 点 「自定义…」→ 设 90×60mm → 确定

  打开浏览器 devtools console，记录所有 `[CustomPaperDialog]` / `[DesignerHeader]` / `[store.setPaper]` 日志。

  **诊断分支：**
  - 如果**完全没日志**：dropdown click 没触发 → 检查 `@click="openCustomDialog"` 绑定
  - 如果**只有 [CustomPaperDialog] confirm 日志**：emit 未到 parent → 检查 `<CustomPaperDialog v-model="customDialogOpen" @confirm="onCustomPaperConfirm" />` 拼写
  - 如果**到 [DesignerHeader]** 但**没到 [store.setPaper]**：store action 调用失败 → 检查 store import
  - 如果**到 [store.setPaper]** 但**画布没变**：reactive issue → 检查 `paperPx` getter / `fitView()` / `recomputeGridFromAnchor`

- [ ] **Step 4: 修复根因**

  根据 Step 3 诊断结果实施修复。常见可能性：
  - **可能 A: 对象引用问题** — `store.setPaper` 接收的 `paper` 对象与 dialog 内部 reactive 引用同一对象，后续 dialog open 重置 w/h 时反向污染了 store。修复：在 `setPaper` 入口克隆 `paper = { ...paper }` 防御。
  - **可能 B: `paperPxSize` 兜底问题** — 用 `Object.prototype.hasOwnProperty` 检查 `'w_mm' in paper`，但 Vue 的 proxy 可能让 `in` 判断不准。修复：改为 `'w_mm' in paper && typeof (paper as any).w_mm === 'number'`。
  - **可能 C: 旋转方向冲突** — 当前 orientation=landscape 时，custom paper {w_mm:90, h_mm:60} 被 paperPxSize 旋转成 60×90，用户期望「设宽 90 高 60」按字面理解。修复：custom paper 进来时强制 orientation=portrait，或让 dialog 显式指明「宽/高」按当前 orientation 解释。

- [ ] **Step 5: 去掉调试日志**

  把 Step 2 的 console.log 全部删除。

- [ ] **Step 6: 类型检查 + commit**

  ```bash
  docker compose -f docker-compose.dev.yml exec -T web sh -c 'cd /workspace/apps/web && NODE_OPTIONS=--max-old-space-size=4096 ./node_modules/.bin/vue-tsc --noEmit'
  git add apps/web/src/designer/CustomPaperDialog.vue apps/web/src/designer/DesignerHeader.vue apps/web/src/stores/designer.ts
  git commit -m "fix(designer): 自定义纸张 confirm 后画布正确更新（诊断 + 修复 + cleanup）"
  ```

---

### Task 2: 变量区域 max-height 168px

**Files:** Modify: `apps/web/src/designer/FieldManager.vue`

- [ ] **Step 1: 修改 .fm-body max-height**

  Find:
  ```css
  .fm-body {
    flex: 1;
    overflow-y: auto;
    padding: 8px 10px 12px;
    max-height: 200px;
  }
  ```
  Replace with:
  ```css
  .fm-body {
    flex: 1;
    overflow-y: auto;
    padding: 8px 10px 12px;
    max-height: 168px;
  }
  ```

- [ ] **Step 2: 类型检查 + commit**

  ```bash
  docker compose -f docker-compose.dev.yml exec -T web sh -c 'cd /workspace/apps/web && NODE_OPTIONS=--max-old-space-size=4096 ./node_modules/.bin/vue-tsc --noEmit'
  git add apps/web/src/designer/FieldManager.vue
  git commit -m "fix(designer): 变量区域改 max-height 168px (≈ 3 张卡 + 滚动)"
  ```

---

### Task 3: 预览界面左右滚动

**Files:** Modify: `apps/web/src/views/PreviewView.vue`

- [ ] **Step 1: 给 .pv-wrap 加 `min-width: 0` 并让 grid 列不撑开**

  Find:
  ```css
  .pv-wrap {
    position: relative;
    width: 100%;
    height: 70vh;
    border-radius: 8px;
    overflow: hidden;
  }
  ```
  Replace with:
  ```css
  .pv-wrap {
    position: relative;
    width: 100%;
    min-width: 0;
    height: 70vh;
    border-radius: 8px;
    overflow: hidden;
  }
  ```

- [ ] **Step 2: .pv-paper-wrap 改 block 布局**

  Find:
  ```css
  .pv-paper-wrap {
    display: inline-block;
    margin: 30px;
  }
  ```
  Replace with:
  ```css
  .pv-paper-wrap {
    margin: 30px;
    width: max-content;
  }
  ```

  解释：`width: max-content` 让 wrap 按其自身 inline style width 撑开，不受父容器宽度约束。pv-container 的 overflow:auto 接管滚动。

- [ ] **Step 3: 给 preview-layout 也加保护**

  Find:
  ```css
  .preview-layout {
    display: grid;
    grid-template-columns: 240px 1fr;
    gap: 16px;
    max-height: 70vh;
  }
  ```
  Replace with:
  ```css
  .preview-layout {
    display: grid;
    grid-template-columns: 240px minmax(0, 1fr);
    gap: 16px;
    max-height: 70vh;
  }
  ```

  解释：`minmax(0, 1fr)` 显式允许列收缩到 0，避免内容撑开。

- [ ] **Step 4: 类型检查 + commit**

  ```bash
  docker compose -f docker-compose.dev.yml exec -T web sh -c 'cd /workspace/apps/web && NODE_OPTIONS=--max-old-space-size=4096 ./node_modules/.bin/vue-tsc --noEmit'
  git add apps/web/src/views/PreviewView.vue
  git commit -m "fix(preview): 双向滚动 — grid 列加 minmax(0, 1fr) + paper-wrap 按内容宽度"
  ```

---

### Task 4: 预览示例数据只显示绑定字段

**Files:** Modify: `apps/web/src/views/PreviewView.vue`

- [ ] **Step 1: 加 `boundFieldDefs` computed**

  在 `<script setup>` 中，已有的 `paperStyle` 定义后追加：

  ```ts
  const boundFieldDefs = computed(() => {
    const used = store.usedFieldKeys;
    const out: Array<[string, ReturnType<typeof Object.entries<typeof store.template.schema>>[0][1]]> = [];
    for (const [key, def] of Object.entries(store.template.schema)) {
      if (used.has(key)) out.push([key, def]);
    }
    return out;
  });
  ```

  （如果上面 typeof 表达式 vue-tsc 报错，简化为：）

  ```ts
  const boundFieldDefs = computed(() => {
    const used = store.usedFieldKeys;
    return Object.entries(store.template.schema).filter(([k]) => used.has(k));
  });
  ```

- [ ] **Step 2: 修改模板 — 用 boundFieldDefs 替代 store.template.schema**

  Find:
  ```vue
  <ElForm v-if="store.fieldDefs.length > 0" label-position="top">
    <ElFormItem
      v-for="(def, key) in store.template.schema"
      :key="key"
      :label="`${key} (${def.label})`"
    >
      <ElInput
        :model-value="String(sampleData[key] ?? '')"
        size="small"
        @update:model-value="(v) => (sampleData[key] = v)"
      />
    </ElFormItem>
  </ElForm>
  <p v-else class="empty">未声明数据字段</p>
  ```
  Replace with:
  ```vue
  <ElForm v-if="boundFieldDefs.length > 0" label-position="top">
    <ElFormItem
      v-for="[key, def] in boundFieldDefs"
      :key="key"
      :label="`${key} (${def.label})`"
    >
      <ElInput
        :model-value="String(sampleData[key] ?? '')"
        size="small"
        @update:model-value="(v) => (sampleData[key] = v)"
      />
    </ElFormItem>
  </ElForm>
  <p v-else-if="store.fieldDefs.length === 0" class="empty">未声明数据字段</p>
  <p v-else class="empty">模板未绑定任何字段<br />无需填写示例数据</p>
  ```

- [ ] **Step 3: 类型检查 + commit**

  ```bash
  docker compose -f docker-compose.dev.yml exec -T web sh -c 'cd /workspace/apps/web && NODE_OPTIONS=--max-old-space-size=4096 ./node_modules/.bin/vue-tsc --noEmit'
  git add apps/web/src/views/PreviewView.vue
  git commit -m "fix(preview): 示例数据表单仅展示被绑定的字段，未绑定时空状态提示"
  ```

---

### Task 5: 元素越界消失防护三件套

**Files:** Modify: `apps/web/src/stores/designer.ts`, `apps/web/src/designer/usePointerDrag.ts`

#### 5A: onResizeDown 末尾 w/h 兜底

- [ ] **Step 1: 在 usePointerDrag.ts onResizeDown 的 clamp 块末尾加兜底**

  Find（onResizeDown 的 onMove 函数中的 clamp 区块）:
  ```ts
  // clamp to paper
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
  ```
  Replace with:
  ```ts
  // clamp to paper
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

  // Final safety net: prevent zero/negative dimensions from any combination of clamps above
  w = Math.max(minMm.w, w);
  h = Math.max(minMm.h, h);

  store.resizeElementMm(elementId, { x, y, w, h });
  ```

#### 5B: setElementAnchor clamp to paper

- [ ] **Step 2: 在 stores/designer.ts setElementAnchor 末尾加 paper-bound clamp**

  Find:
  ```ts
  setElementAnchor(id: string, patch: Partial<Anchor>): void {
    const idx = this.template.elements.findIndex((e) => e.id === id);
    if (idx < 0) return;
    const cur = this.template.elements[idx];
    const next = { ...cur, anchor: { ...cur.anchor, ...patch } } as TemplateElement;
    recomputeGridFromAnchor(next, this.template.canvas.cell);
    this.template.elements[idx] = next;
    this.snapshot();
  },
  ```
  Replace with:
  ```ts
  setElementAnchor(id: string, patch: Partial<Anchor>): void {
    const idx = this.template.elements.findIndex((e) => e.id === id);
    if (idx < 0) return;
    const cur = this.template.elements[idx];
    const next = { ...cur, anchor: { ...cur.anchor, ...patch } } as TemplateElement;
    // Clamp to paper bounds — prevents property panel typing from sending element off-canvas
    const paperMm = {
      w_mm: this.paperPx.w / PX_PER_MM,
      h_mm: this.paperPx.h / PX_PER_MM,
    };
    clampAnchorToPaper(next, paperMm);
    recomputeGridFromAnchor(next, this.template.canvas.cell);
    this.template.elements[idx] = next;
    this.snapshot();
  },
  ```

#### 5C: restore() 全量 clampAnchorToPaper

- [ ] **Step 3: 在 stores/designer.ts restore() 末尾对所有元素跑一遍 clamp**

  Find（restore() 末尾，在 `this.template = parsed` 前）:
  ```ts
  // Step 3 — Recompute grid for every element from anchor + new cell.
  for (const el of parsed.elements) {
    recomputeGridFromAnchor(el, parsed.canvas.cell);
  }

  this.template = parsed;
  ```
  Replace with:
  ```ts
  // Step 3 — Recompute grid for every element from anchor + new cell.
  for (const el of parsed.elements) {
    recomputeGridFromAnchor(el, parsed.canvas.cell);
  }

  // Step 4 — Iter 10: clamp every element to current paper bounds.
  // Handles stale drafts where elements ended up off-paper due to old buggy
  // resize behavior or paper changes without proper clamping.
  const paperMm = {
    w_mm: px.w / PX_PER_MM,
    h_mm: px.h / PX_PER_MM,
  };
  for (const el of parsed.elements) {
    clampAnchorToPaper(el, paperMm);
    recomputeGridFromAnchor(el, parsed.canvas.cell);
  }

  this.template = parsed;
  ```

- [ ] **Step 4: 类型检查 + commit (5A + 5B + 5C 一次提交)**

  ```bash
  docker compose -f docker-compose.dev.yml exec -T web sh -c 'cd /workspace/apps/web && NODE_OPTIONS=--max-old-space-size=4096 ./node_modules/.bin/vue-tsc --noEmit'
  git add apps/web/src/designer/usePointerDrag.ts apps/web/src/stores/designer.ts
  git commit -m "fix(designer): 三层 anchor 越界防护 — resize 兜底 + 属性面板 clamp + restore 全量"
  ```

---

### Task 6: 高级折叠区分 — 重命名 + 视觉分隔

**Files:** Modify: `apps/web/src/designer/PropertyPanel.vue`

代码层 `styleAdvOpen` / `layoutAdvOpen` 已是独立 ref，理论上不会耦合。这一步是用户视觉层的进一步区分，配合硬刷新清缓存确保 iter 8 T3 的代码真正生效。

- [ ] **Step 1: 把 「样式 · 高级」 标题改为 「字体 · 高级」**

  Find:
  ```vue
  <div class="style-title sclickable" @click="styleAdvOpen = !styleAdvOpen">
    样式 · 高级 <span class="caret">{{ styleAdvOpen ? '▾' : '▸' }}</span>
  </div>
  ```
  Replace with:
  ```vue
  <div class="style-title sclickable" @click="styleAdvOpen = !styleAdvOpen">
    字体 · 高级 <span class="caret">{{ styleAdvOpen ? '▾' : '▸' }}</span>
  </div>
  ```

- [ ] **Step 2: 类型检查 + commit**

  ```bash
  docker compose -f docker-compose.dev.yml exec -T web sh -c 'cd /workspace/apps/web && NODE_OPTIONS=--max-old-space-size=4096 ./node_modules/.bin/vue-tsc --noEmit'
  git add apps/web/src/designer/PropertyPanel.vue
  git commit -m "ui(panel): 「样式·高级」改为「字体·高级」与「布局·高级」视觉区分更明显"
  ```

---

### Task 7: 最终验收

无文件改动。

- [ ] **Step 1: 全套 vue-tsc**

  ```bash
  docker compose -f docker-compose.dev.yml exec -T web sh -c 'cd /workspace/apps/web && NODE_OPTIONS=--max-old-space-size=4096 ./node_modules/.bin/vue-tsc --noEmit'
  ```

- [ ] **Step 2: schema tests**

  ```bash
  docker compose -f docker-compose.dev.yml exec -T web sh -c 'cd /workspace/packages/schema && npm test'
  ```

- [ ] **Step 3: 浏览器走查（用户做）**

  - [ ] 自定义纸张 90×60mm 应用后画布尺寸正确改变
  - [ ] 变量区域 4+ 个变量时出现滚动条，3 个时不出现
  - [ ] 预览界面 A3 portrait 100% zoom 下出现横向 + 纵向滚动
  - [ ] 预览界面未绑定字段不出现在示例数据表单
  - [ ] 拖动 / 缩放任何元素不再越出 paper、不消失
  - [ ] 属性面板手填 anchor.x = -50 自动被 clamp 到 0
  - [ ] 加载老草稿不再有元素飘到 paper 外
  - [ ] 「字体 · 高级」「布局 · 高级」独立展开折叠
