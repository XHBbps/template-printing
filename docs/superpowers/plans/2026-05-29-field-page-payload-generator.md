# 模板字段页「生成入参格式」Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 字段页(`FieldManager.vue`)加「生成入参」按钮 → 弹窗选接口(渲染 API / 多维表格 webhook)→ 按当前模板字段生成默认请求体 JSON,一键复制。

**Architecture:** 生成逻辑是纯函数 `buildRenderPayload`,落 `packages/schema`(吃 `FieldDef` 类型,有现成 vitest),经**专用子路径** `@template-printing/schema/render-payload` 导出 + 内部**仅 `import type`** → web 引用零 runtime 依赖(不把 zod 拖进 bundle)。FieldManager 加薄 UI(按钮+弹窗+computed+复制)。

**Tech Stack:** TypeScript / zod(仅类型)/ Vue 3 + Element Plus / vitest(packages/schema)。

**设计依据:** `docs/superpowers/specs/2026-05-29-field-page-payload-generator-design.md`(务必先读 §3 安全护栏、§4.0 子路径导出、§4.1 取值规则)。

**测试运行:** `cd packages/schema && npx vitest run test/render-payload.spec.ts`。typecheck:`pnpm --filter @template-printing/schema typecheck` 与 `pnpm --filter @template-printing/web typecheck`(web 用 vue-tsc)。

---

## File Structure
- 改 `packages/schema/src/template.ts` — 加 `export type FieldDef`。
- 新增 `packages/schema/src/render-payload.ts` — 纯函数 helper(仅 `import type FieldDef`)。
- 改 `packages/schema/package.json` — `exports` 加 `"./render-payload"` 子路径(指向原始 src,不经 index)。
- 新增 `packages/schema/test/render-payload.spec.ts` — helper 单测(vitest)。
- 改 `apps/web/src/designer/FieldManager.vue` — 按钮 + 弹窗 + computed + 复制。

---

### Task 1: 导出 `FieldDef` 类型

**Files:**
- Modify: `packages/schema/src/template.ts`(`FieldDefSchema` 定义之后)

- [ ] **Step 1: 加类型导出**

在 `packages/schema/src/template.ts` 的 `export const FieldDefSchema = z.discriminatedUnion(...)` 块**结束之后**(即 `]);` 的下一行)加:
```ts
export type FieldDef = z.infer<typeof FieldDefSchema>;
```

- [ ] **Step 2: typecheck**

Run: `pnpm --filter @template-printing/schema typecheck`
Expected: 通过(0 errors)。

- [ ] **Step 3: 提交**

```bash
git add packages/schema/src/template.ts
git commit -m "feat(schema): 导出 FieldDef 类型(z.infer<FieldDefSchema>)"
```

---

### Task 2: helper `buildRenderPayload` + 子路径导出(TDD)

**Files:**
- Create: `packages/schema/src/render-payload.ts`
- Create: `packages/schema/test/render-payload.spec.ts`
- Modify: `packages/schema/package.json`

- [ ] **Step 1: 写失败测试**

`packages/schema/test/render-payload.spec.ts`:
```ts
import { describe, it, expect } from 'vitest';

import type { FieldDef } from '../src/template.js';
import { buildRenderPayload } from '../src/render-payload.js';

// 测试用 FieldDef 构造(只填 helper 读到的属性,cast 绕过判别联合其余必填项)
function fd(o: Record<string, unknown>): FieldDef {
  return o as unknown as FieldDef;
}
const f = (key: string, def: Record<string, unknown>): { key: string; def: FieldDef } => ({
  key,
  def: fd(def),
});

describe('buildRenderPayload', () => {
  it('render target:结构为 {templateId, data, formats:["pdf"]}', () => {
    const json = buildRenderPayload('tpl-1', [f('name', { type: 'string', example: '孔鸣' })], 'render');
    const o = JSON.parse(json);
    expect(o).toEqual({ templateId: 'tpl-1', data: { name: '孔鸣' }, formats: ['pdf'] });
  });

  it('bitable target:含 verificationToken 占位 + lark 块(statusField/attachmentField 默认值)', () => {
    const json = buildRenderPayload('tpl-1', [], 'bitable');
    const o = JSON.parse(json);
    expect(o.verificationToken).toBe('<verificationToken>');
    expect(o.templateId).toBe('tpl-1');
    expect(o.data).toEqual({});
    expect(o.lark).toEqual({
      appToken: '<appToken>',
      tableId: '<tableId>',
      recordId: '<recordId>',
      statusField: '状态',
      attachmentField: '附件',
    });
  });

  it('各类型占位(无 example)', () => {
    const fields = [
      f('s', { type: 'string' }),
      f('n', { type: 'number' }),
      f('b', { type: 'boolean' }),
      f('d', { type: 'date' }),
      f('dt', { type: 'datetime' }),
      f('e', { type: 'enum', options: [{ value: 'A', label: '甲' }, { value: 'B', label: '乙' }] }),
      f('img', { type: 'image' }),
      f('arr', { type: 'array' }),
    ];
    const o = JSON.parse(buildRenderPayload('t', fields, 'render'));
    expect(o.data).toEqual({
      s: '',
      n: 0,
      b: false,
      d: '2026-01-01',
      dt: '2026-01-01 12:00',
      e: 'A',
      img: 'https://example.com/sample.png',
      arr: [],
    });
  });

  it('example 优先 + number 的 NaN guard', () => {
    const fields = [
      f('n1', { type: 'number', example: '50' }), // → 50
      f('n2', { type: 'number', example: 'abc' }), // NaN → 0
      f('n3', { type: 'number', example: '' }), // 空 → 占位 0
      f('bt', { type: 'boolean', example: 'true' }), // → true
      f('dd', { type: 'date', example: '2026-05-29' }), // 原样
    ];
    const o = JSON.parse(buildRenderPayload('t', fields, 'render'));
    expect(o.data).toEqual({ n1: 50, n2: 0, n3: 0, bt: true, dd: '2026-05-29' });
  });

  it('未保存模板(templateId 空)→ 占位字符串', () => {
    const o = JSON.parse(buildRenderPayload(null, [], 'render'));
    expect(o.templateId).toBe('<保存模板后获得>');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/schema && npx vitest run test/render-payload.spec.ts`
Expected: FAIL —「Cannot find module ... render-payload.js」。

- [ ] **Step 3: 写 helper**

`packages/schema/src/render-payload.ts`:
```ts
import type { FieldDef } from './template.js'; // 仅类型,编译期擦除,不拖 runtime(zod 不进 web bundle)

export type RenderPayloadTarget = 'render' | 'bitable';

/** 单字段默认值:有 example(非空字符串)优先(按类型强转),否则类型占位。 */
function fieldValue(def: FieldDef): unknown {
  const ex = typeof def.example === 'string' ? def.example.trim() : '';
  const hasEx = ex !== '';
  switch (def.type) {
    case 'number': {
      if (hasEx) {
        const n = Number(ex);
        return Number.isFinite(n) ? n : 0;
      }
      return 0;
    }
    case 'boolean':
      return hasEx ? ex === 'true' : false;
    case 'date':
      return hasEx ? ex : '2026-01-01';
    case 'datetime':
      return hasEx ? ex : '2026-01-01 12:00';
    case 'enum':
      return hasEx ? ex : (def.options[0]?.value ?? '');
    case 'image':
      return hasEx ? ex : 'https://example.com/sample.png';
    case 'array':
      return [];
    case 'string':
    default:
      return hasEx ? ex : '';
  }
}

/**
 * 按 target 生成默认请求体 JSON 文本(2-space)。data 键=字段 key,值由 def 推导。
 * 安全:占位均为字面字符串,永不含真 secret。
 */
export function buildRenderPayload(
  templateId: string | null | undefined,
  fields: Array<{ key: string; def: FieldDef }>,
  target: RenderPayloadTarget,
): string {
  const tid = (templateId ?? '').trim() || '<保存模板后获得>';
  const data: Record<string, unknown> = {};
  for (const f of fields) data[f.key] = fieldValue(f.def);
  const payload =
    target === 'bitable'
      ? {
          verificationToken: '<verificationToken>',
          templateId: tid,
          data,
          lark: {
            appToken: '<appToken>',
            tableId: '<tableId>',
            recordId: '<recordId>',
            statusField: '状态',
            attachmentField: '附件',
          },
        }
      : { templateId: tid, data, formats: ['pdf'] };
  return JSON.stringify(payload, null, 2);
}
```

- [ ] **Step 4: 加子路径导出**

在 `packages/schema/package.json` 的 `exports` 对象里,`"./template"` 同级加(指向原始 src,与 `"."` 一致):
```json
    "./render-payload": "./src/render-payload.ts"
```
(即 `exports` 变为 `{ ".": "./src/index.ts", "./render-payload": "./src/render-payload.ts", "./template": { ... } }`。**不**改 `src/index.ts`——保持 web 从根 import 时不触达本 helper。)

- [ ] **Step 5: 跑测试确认通过 + typecheck**

Run: `cd packages/schema && npx vitest run test/render-payload.spec.ts`
Expected: PASS(5 个用例)。
Run: `pnpm --filter @template-printing/schema typecheck`
Expected: 0 errors。

- [ ] **Step 6: 提交**

```bash
git add packages/schema/src/render-payload.ts packages/schema/test/render-payload.spec.ts packages/schema/package.json
git commit -m "feat(schema): buildRenderPayload 入参生成纯函数 + 专用子路径导出(零 runtime 入 web)"
```

---

### Task 3: 字段页「生成入参」按钮 + 弹窗

**Files:**
- Modify: `apps/web/src/designer/FieldManager.vue`

> 无 web 单测 harness;本任务靠 `vue-tsc` typecheck + 手测验证。生成逻辑已在 Task 2 单测覆盖,这里只是薄 UI 接线。

- [ ] **Step 1: script 加导入 + 状态 + 方法**

`<script setup>` 顶部 import 区,在 `useDesignerStore` import 之后加(子路径,仅拉纯函数):
```ts
// eslint-disable-next-line import/no-unresolved
import { buildRenderPayload, type RenderPayloadTarget } from '@template-printing/schema/render-payload';
```
`lucide-vue-next` 的 import 改为加 `Braces` 图标:
```ts
// eslint-disable-next-line import/no-unresolved
import { Plus, Pencil, Trash2, Search, Braces } from 'lucide-vue-next';
```
在 `const dialogOpen = ref(false)` 附近加:
```ts
const payloadDialogOpen = ref(false);
const payloadTarget = ref<RenderPayloadTarget>('render');
const generatedPayload = computed(() =>
  buildRenderPayload(store.templateId, store.fieldDefs, payloadTarget.value),
);
function openPayload(): void {
  payloadDialogOpen.value = true;
}
async function copyPayload(): Promise<void> {
  try {
    await navigator.clipboard.writeText(generatedPayload.value);
    ElMessage.success('已复制入参格式');
  } catch {
    ElMessage.error('复制失败,请手动选择文本复制');
  }
}
```

- [ ] **Step 2: 头部加按钮**

在 `.fm-head` 里 `tp-sub-add`(添加变量)按钮**之前**插入「生成入参」按钮:
```html
      <button class="tp-sub-add" title="生成入参格式" @click="openPayload">
        <Braces :size="14" :stroke-width="1.5" />
      </button>
```
(放在 `<button class="tp-sub-add" title="添加变量" @click="openAdd">` 之前,两个按钮并排。)

- [ ] **Step 3: 加弹窗(template 末尾,现有 ElDialog / ConfirmDialog 同级)**

```html
  <ElDialog v-model="payloadDialogOpen" title="生成入参格式" width="560px">
    <ElSelect v-model="payloadTarget" style="width: 100%; margin-bottom: 12px">
      <ElOption label="渲染 API (POST /api/render)" value="render" />
      <ElOption label="多维表格 webhook (POST /lark/print-trigger)" value="bitable" />
    </ElSelect>
    <p v-if="!store.templateId" class="payload-hint">
      模板未保存,templateId 为占位,保存后替换为真实值。
    </p>
    <pre class="payload-json">{{ generatedPayload }}</pre>
    <template #footer>
      <ElButton @click="payloadDialogOpen = false">关闭</ElButton>
      <ElButton type="primary" @click="copyPayload">复制</ElButton>
    </template>
  </ElDialog>
```
> 安全:JSON 走 `{{ }}` 文本插值(自动转义),**不用 `v-html`**;复制走 `navigator.clipboard.writeText`(纯文本)。

- [ ] **Step 4: 加样式(`<style scoped>` 末尾)**

```css
.payload-json {
  max-height: 320px;
  overflow: auto;
  background: var(--ink);
  color: var(--paper-white);
  padding: 12px;
  border-radius: var(--radius-2);
  font-family: var(--font-mono);
  font-size: 12px;
  line-height: 1.5;
  white-space: pre;
  margin: 0;
}
.payload-hint {
  margin: 0 0 8px;
  color: var(--iron);
  font-size: 12px;
}
```

- [ ] **Step 5: typecheck**

Run: `pnpm --filter @template-printing/web typecheck`
Expected: 0 errors(vue-tsc 能解析 `@template-printing/schema/render-payload` 子路径)。

- [ ] **Step 6: 手测**
  - 起 web(docker dev 栈已跑)→ 打开任意模板的设计器 → 字段面板。
  - 点头部「生成入参」按钮 → 弹窗出现,默认 render,JSON 含 `templateId/data/formats`,`data` 各字段按类型/example 填值。
  - 切到「多维表格 webhook」→ JSON 变为含 `verificationToken/lark` 的骨架。
  - 改/增删字段 → 重新打开弹窗 JSON 跟着变(computed)。
  - 点「复制」→ toast「已复制入参格式」,粘贴到别处验证是合法 JSON。
  - 新建未保存模板 → 弹窗顶部出现「模板未保存…」提示,templateId 为占位。

- [ ] **Step 7: 提交**

```bash
git add apps/web/src/designer/FieldManager.vue
git commit -m "feat(web): 字段页「生成入参」按钮 + 弹窗(选接口/复制)"
```

---

## Self-Review
- **Spec 覆盖**:§4 helper→Task2;§4.0 子路径导出+不进 index+仅 type import→Task2 Step3/4;FieldDef 导出前置→Task1;§4.1 取值规则(8 类/NaN guard/example 优先)→Task2 helper + 测试;§5 字段页交互(按钮/弹窗/下拉/computed/复制/未保存提示)→Task3;§3 安全(占位/无 v-html/clipboard 纯文本)→Task2 占位字面值 + Task3 Step3 注记;§7 测试→Task2 单测 + Task3 手测;§8 受影响文件全覆盖。✅
- **占位扫描**:无 TBD;每步含完整代码/命令/预期。
- **类型一致**:`buildRenderPayload(templateId, fields: Array<{key,def:FieldDef}>, target: RenderPayloadTarget)` 在 Task2 定义、Task3 同签名调用;`store.fieldDefs` 正是 `Array<{key,def:FieldDef}>`;`RenderPayloadTarget='render'|'bitable'` 全程一致。
- **YAGNI**:不放 version、不做自动填真 token、不纳入 ⑤(GET /api/render/jobs 文档)、不给 web 起 vitest。
