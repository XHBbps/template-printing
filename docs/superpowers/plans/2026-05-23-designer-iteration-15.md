# Designer Iteration 15 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development.

**Goal:** 修 3 个独立小 bug：z-index 不生效（wrapper 没设）、图片上传按钮无效（UI mode 判定错位）、图片 URL 输入后不显示（防盗链 referer）。

**Tech Stack:** Vue 3 + Pinia + Element Plus.

Type-check:
```bash
docker compose -f docker-compose.dev.yml exec -T web sh -c 'cd /workspace/apps/web && NODE_OPTIONS=--max-old-space-size=4096 ./node_modules/.bin/vue-tsc --noEmit'
```

---

## File Structure

| 文件 | 任务 |
|---|---|
| `apps/web/src/designer/CanvasElement.vue` | T1 |
| `packages/template-renderer/src/TemplateRenderer.vue` | T1 |
| `packages/template-renderer/src/styleToCss.ts` | T1 |
| `apps/web/src/designer/PropertyPanel.vue` | T2 |
| `packages/template-renderer/src/elements/ImageElement.vue` | T3 |
| — | T4 (验收) |

---

### Task 1: §A — Z 轴属性应用到 wrapper

**Files:** Modify: `apps/web/src/designer/CanvasElement.vue`, `packages/template-renderer/src/TemplateRenderer.vue`, `packages/template-renderer/src/styleToCss.ts`

#### 1A: CanvasElement positionStyle 加 zIndex

- [ ] **Step 1: 替换 positionStyle 返回对象**

  Find:
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
      zIndex: props.element.style.zIndex ?? 0,
    };
  });
  ```

#### 1B: TemplateRenderer 元素 div 加 zIndex

- [ ] **Step 2: 替换元素循环 div :style**

  Find:
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
      zIndex: el.style.zIndex ?? 0,
    }"
  >
  ```

#### 1C: styleToCss 移除 zIndex（避免双重维护）

- [ ] **Step 3: 删除 styleToCss.ts 中的 zIndex 行**

  Find:
  ```ts
  if (s.zIndex !== undefined) out.zIndex = String(s.zIndex);
  ```
  Delete this line. zIndex 现在由外层 wrapper 处理，不再走 inner div。

- [ ] **Step 4: 类型检查 + 单 commit 覆盖三个文件**

  ```bash
  docker compose -f docker-compose.dev.yml exec -T web sh -c 'cd /workspace/apps/web && NODE_OPTIONS=--max-old-space-size=4096 ./node_modules/.bin/vue-tsc --noEmit'
  git add apps/web/src/designer/CanvasElement.vue packages/template-renderer/src/TemplateRenderer.vue packages/template-renderer/src/styleToCss.ts
  git commit -m "fix(designer): z-index 应用到 .tp-element 外层 wrapper，inner div 不再设"
  ```

---

### Task 2: §B — 图片源 UI 模式独立状态

**Files:** Modify: `apps/web/src/designer/PropertyPanel.vue`

- [ ] **Step 1: 加 imageMode 本地状态 + watcher**

  在 `<script setup>` 中，找到 `const styleAdvOpen = ref(false);` 这一行，前后加入：

  ```ts
  import { computed, ref, watch } from 'vue';  // ← 如果还没 import watch，加上
  ```
  （检查现有 import 行；如已包含 watch 则跳过。）

  在已有 `const styleAdvOpen = ref(false);` / `const layoutAdvOpen = ref(false);` 附近加：

  ```ts
  type ImageMode = 'url' | 'upload' | 'field';
  const imageMode = ref<ImageMode>('url');

  watch(
    () => sel.value,
    (el) => {
      if (!el || el.type !== 'image') return;
      if (el.source.kind === 'field') imageMode.value = 'field';
      else if (el.source.url?.startsWith('/uploads/')) imageMode.value = 'upload';
      else imageMode.value = 'url';
    },
    { immediate: true },
  );
  ```

- [ ] **Step 2: 重写 setImageSourceKind**

  Find:
  ```ts
  type ImageSourceKind = 'static' | 'field' | 'upload';
  function setImageSourceKind(kind: ImageSourceKind): void {
    if (!sel.value || sel.value.type !== 'image') return;
    if (kind === 'static' || kind === 'upload') {
      store.updateElement(sel.value.id, {
        source: { kind: 'static', url: '' },
      } as Partial<TemplateElement>);
    } else {
      store.updateElement(sel.value.id, {
        source: { kind: 'field', binding: '' },
      } as Partial<TemplateElement>);
    }
  }
  ```
  Replace with:
  ```ts
  type ImageSourceKind = 'static' | 'field' | 'upload';
  function setImageSourceKind(kind: ImageSourceKind): void {
    if (!sel.value || sel.value.type !== 'image') return;
    if (kind === 'url' || kind === 'static') {
      imageMode.value = 'url';
      store.updateElement(sel.value.id, {
        source: { kind: 'static', url: '' },
      } as Partial<TemplateElement>);
    } else if (kind === 'upload') {
      imageMode.value = 'upload';
      // Keep url empty; file picker will populate it
      store.updateElement(sel.value.id, {
        source: { kind: 'static', url: '' },
      } as Partial<TemplateElement>);
    } else {
      imageMode.value = 'field';
      store.updateElement(sel.value.id, {
        source: { kind: 'field', binding: '' },
      } as Partial<TemplateElement>);
    }
  }
  ```

- [ ] **Step 3: 模板中改用 imageMode**

  Find:
  ```vue
  <div class="srow">
    <div class="seg">
      <button
        :class="{
          on: sel.source.kind === 'static' && !sel.source.url.startsWith('/uploads/'),
        }"
        @click="setImageSourceKind('static')"
      >
        URL
      </button>
      <button
        :class="{
          on: sel.source.kind === 'static' && sel.source.url.startsWith('/uploads/'),
        }"
        @click="setImageSourceKind('upload')"
      >
        上传
      </button>
      <button
        :class="{ on: sel.source.kind === 'field' }"
        @click="setImageSourceKind('field')"
      >
        绑定字段
      </button>
    </div>
  </div>

  <div
    v-if="sel.source.kind === 'static' && !sel.source.url.startsWith('/uploads/')"
    class="srow"
  >
    <input
      class="snum"
      style="flex: 1"
      :value="sel.source.url"
      @input="(e: Event) => setStaticUrl((e.target as HTMLInputElement).value)"
      placeholder="https://..."
    />
  </div>
  <div v-else-if="sel.source.kind === 'static'" class="srow">
    <input type="file" accept="image/svg+xml,image/png,image/jpeg" @change="onFileChange" />
    <span v-if="uploading" class="sval">上传中…</span>
    <span v-if="uploadError" class="sval" style="color: #d94f4f">{{ uploadError }}</span>
    <span v-if="sel.source.url" class="sval mono">{{ sel.source.url }}</span>
  </div>
  ```
  Replace with:
  ```vue
  <div class="srow">
    <div class="seg">
      <button
        :class="{ on: imageMode === 'url' }"
        @click="setImageSourceKind('url')"
      >
        URL
      </button>
      <button
        :class="{ on: imageMode === 'upload' }"
        @click="setImageSourceKind('upload')"
      >
        上传
      </button>
      <button
        :class="{ on: imageMode === 'field' }"
        @click="setImageSourceKind('field')"
      >
        绑定字段
      </button>
    </div>
  </div>

  <div v-if="imageMode === 'url'" class="srow">
    <input
      class="snum"
      style="flex: 1"
      :value="sel.source.kind === 'static' ? sel.source.url : ''"
      @input="(e: Event) => setStaticUrl((e.target as HTMLInputElement).value)"
      placeholder="https://..."
    />
  </div>
  <div v-else-if="imageMode === 'upload'" class="srow">
    <input type="file" accept="image/svg+xml,image/png,image/jpeg" @change="onFileChange" />
    <span v-if="uploading" class="sval">上传中…</span>
    <span v-if="uploadError" class="sval" style="color: #d94f4f">{{ uploadError }}</span>
    <span
      v-if="sel.source.kind === 'static' && sel.source.url"
      class="sval mono"
    >{{ sel.source.url }}</span>
  </div>
  ```

  原来 `setImageSourceKind('static')` 改为 `setImageSourceKind('url')`，以匹配新的 `ImageSourceKind` 联合（兼容 'static' 也仍可工作，但 'url' 更语义化）。

- [ ] **Step 4: 类型检查 + commit**

  ```bash
  docker compose -f docker-compose.dev.yml exec -T web sh -c 'cd /workspace/apps/web && NODE_OPTIONS=--max-old-space-size=4096 ./node_modules/.bin/vue-tsc --noEmit'
  git add apps/web/src/designer/PropertyPanel.vue
  git commit -m "fix(designer): 图片源 URL/上传切换用独立 imageMode 状态，修复上传按钮无效"
  ```

---

### Task 3: §C — 图片 URL 防盗链

**Files:** Modify: `packages/template-renderer/src/elements/ImageElement.vue`

- [ ] **Step 1: 给 img 加 referrerpolicy + 加载失败处理**

  Find:
  ```vue
  <template>
    <div :style="containerStyle" :class="{ 'tp-image-design': props.designMode && !src }">
      <img v-if="src" :src="src" :style="{ width: '100%', height: '100%', objectFit }" />
      <span v-else-if="props.designMode" class="tp-image-placeholder">▤ 图片</span>
    </div>
  </template>
  ```
  Replace with:
  ```vue
  <template>
    <div
      :style="containerStyle"
      :class="{
        'tp-image-design': props.designMode && !src,
        'tp-image-failed': loadFailed,
      }"
    >
      <img
        v-if="src && !loadFailed"
        :src="src"
        referrerpolicy="no-referrer"
        :style="{ width: '100%', height: '100%', objectFit }"
        @load="onLoadSuccess"
        @error="onLoadError"
      />
      <span v-else-if="props.designMode && loadFailed" class="tp-image-placeholder">⚠ 图片加载失败</span>
      <span v-else-if="props.designMode" class="tp-image-placeholder">▤ 图片</span>
    </div>
  </template>
  ```

- [ ] **Step 2: 在 `<script setup>` 加 loadFailed 状态 + 回调 + 切 src 时复位**

  Find:
  ```ts
  const objectFit = computed(() => props.element.fit ?? 'contain');
  ```
  After this line, add:
  ```ts
  const loadFailed = ref(false);

  function onLoadError(): void {
    loadFailed.value = true;
  }
  function onLoadSuccess(): void {
    loadFailed.value = false;
  }

  watch(src, () => {
    loadFailed.value = false;
  });
  ```

  确认 `<script setup>` 顶部 `import { computed } from 'vue';` 改为 `import { computed, ref, watch } from 'vue';`。

- [ ] **Step 3: 给 .tp-image-failed 加视觉样式**

  在 `<style scoped>` 中找到 `.tp-image-placeholder` 块附近，追加：
  ```css
  .tp-image-failed {
    border: 1px dashed #d94f4f;
    background: #fff5f5;
  }
  .tp-image-failed .tp-image-placeholder {
    color: #d94f4f;
  }
  ```

- [ ] **Step 4: 类型检查 + commit**

  ```bash
  docker compose -f docker-compose.dev.yml exec -T web sh -c 'cd /workspace/apps/web && NODE_OPTIONS=--max-old-space-size=4096 ./node_modules/.bin/vue-tsc --noEmit'
  git add packages/template-renderer/src/elements/ImageElement.vue
  git commit -m "fix(renderer): img 加 referrerpolicy 绕过防盗链 + 加载失败时显示占位提示"
  ```

---

### Task 4: 最终验收

无文件改动。

- [ ] **Step 1: vue-tsc 通过**
- [ ] **Step 2: schema tests 46/46 通过**
- [ ] **Step 3: 浏览器走查（Ctrl+Shift+R 硬刷新）**

  **§A z-index**
  - [ ] 放两个有重叠的元素，给后面的元素设 z-index 5、前面的元素设 0 → 后面的元素显示在前面元素上方
  - [ ] 调整 z-index 立即生效

  **§B 图片上传按钮**
  - [ ] 新建图片元素 → 默认是 URL 输入模式
  - [ ] 点「上传」按钮 → **立即切换到文件 input**（不再卡在 URL 输入框）
  - [ ] 选择本地 PNG/JPG/SVG → 上传成功，图片显示
  - [ ] 点回「URL」→ 显示 URL 输入框
  - [ ] 点「绑定字段」→ 显示字段下拉

  **§C 图片 URL 防盗链**
  - [ ] 输入 `https://pics6.baidu.com/feed/a5c27d1ed21b0ef4d6d3366f6e44e8cb81cb3e5e.jpeg@f_auto?token=...` → 图片显示（baidu 防盗链被 no-referrer 绕过）
  - [ ] 输入一个 404 URL（比如 `https://example.com/nonexistent.png`）→ 显示「⚠ 图片加载失败」占位
  - [ ] 输入一个 GitHub raw URL → 正常显示
  - [ ] 上传本地图片后切到 URL 模式再切回 → 加载状态正确（不残留失败状态）

- [ ] **Step 4: TaskUpdate iter 15 master task → completed**

---

## 不在范围

- 不处理 API 集成（飞书调用方传图）— 那是另一个工作
- 不修「图片上传后端不可达」类问题 — 假设 API 容器正常运行
- 不发起 PR
