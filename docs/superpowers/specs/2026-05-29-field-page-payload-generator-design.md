# 模板字段页「生成入参格式」—— 设计

**日期**:2026-05-29
**状态**:已审定(独立校验 + 源码佐证关键事实)
**范围**:在设计器「模板字段页」(`FieldManager.vue`)加一个「生成入参」动作——选择目标接口(渲染 API / 多维表格 webhook),按当前模板字段生成默认请求体 JSON,一键复制。纯前端;不改后端。

---

## 1. 背景与目标

- 字段页(`FieldManager.vue`)管理模板 schema 字段;API 页(`ApiView.vue`)已能按模板字段展示入参格式并文档化 `POST /api/render` 与多维表格 webhook。
- 目标:把「按字段生成默认入参 JSON」这个能力放进**字段页**,即编即生成、可选接口、一键复制,省去用户手拼请求体。

## 2. 源码佐证的关键事实

- `FieldDefSchema`(`packages/schema/src/template.ts`)是 **8 类**判别联合:`string` / `number`(min/max/thousands)/ `date`(format 默认 `YYYY-MM-DD`)/ `datetime`(format 默认 `YYYY-MM-DD HH:mm`)/ `boolean`(trueLabel/falseLabel)/ `enum`(options `[{value,label}]`,**min 1 必有**)/ `image`(accept[])/ `array`(itemSchema?)。`example` 恒为 `z.string().optional()`(始终是字符串或缺省)。
- `store.fieldDefs` = `Array<{ key: string; def: FieldDef }>`(`apps/web/src/stores/designer.ts:204`);`store.template.schema` = `Record<string, FieldDef>`;`data` 对象的键是 `key`,值由 `def` 推导。
- `apps/web` **无测试 harness**(`package.json` test = `echo 'no tests yet'`,无 vitest config / 无 .spec);`packages/schema` **有现成 vitest**(`vitest run` + `vitest.config.ts` + `test/`)。
- `ApiView.vue` 多维表格示例的 token 用字面占位 `"<shared>"`(`:515`),前端无任何真 secret、无 `VITE_*` 暴露 token。

## 3. 安全约束(护栏)

- **占位即真理**:bitable 的 `verificationToken` 等敏感值**永远是字面占位字符串**,前端**绝不**调用任何返回真 secret 的接口去填充。真 `LARK_BITABLE_VERIFICATION_TOKEN` 只在服务端 env。
- **无注入面**:JSON 经 `<pre>{{ json }}</pre>` 走 Vue 文本插值(自动转义),`JSON.stringify` 负责字段值转义;**禁止 `v-html`**;复制走 `navigator.clipboard.writeText`(纯文本)。

## 4. helper(纯函数,落 `packages/schema`,可测可复用)

新增 `packages/schema/src/render-payload.ts`。放共享包的理由:纯函数、只吃 `FieldDef` 类型、有现成 vitest 覆盖,且天然支撑日后 ApiView 复用同一口径(避免两处漂移);避免为一个纯函数给 `apps/web` 起一整套测试基建。

### ⚠️ 4.0 必须经专用子路径导出,且不进 `index.ts`(否则 zod 进 web bundle,违背 F1–F11 优化)
- web 当前运行时**不 bundle zod**(只 import 过 type)。`index.ts`/`template.ts` 顶层有 ~100 处 `z.object(...)` 实例化(模块级带副作用 const,tree-shaking 未必删净);若 helper 经 `index.ts` 导出、FieldManager 从**包根** import,会执行整个 index → 把 zod + 全部 schema 打进 web bundle。
- 修法(让落共享包真·零成本):
  1. `packages/schema/package.json` 的 `exports` 加 `"./render-payload": "./src/render-payload.ts"`(指向**原始 src**,与根 `"."` 一致;Vite 转译 TS、tsc 都已验证可吃原始 src)。**不**从 `index.ts` 导出。
  2. `FieldManager.vue` 从 `@template-printing/schema/render-payload` import(**不**从包根)。
  3. `render-payload.ts` 内**只** `import type { FieldDef }`(编译期擦除)→ web bundle 一个 runtime 依赖都不拖。
- **前置依赖**:`template.ts` 目前**只导出 `FieldDefSchema`(zod 值),未导出 `FieldDef` 类型**(designer store 在 `designer.ts:14` 本地自造)。plan 须在 `template.ts` 加 `export type FieldDef = z.infer<typeof FieldDefSchema>;`,否则下面的 `import type { FieldDef }` 编译失败。(顺带可让 store 改用导出的类型,属 spec 外小清理,可不动。)

```ts
import type { FieldDef } from './template.js'; // 仅类型,编译期擦除,不拖 runtime

export type RenderPayloadTarget = 'render' | 'bitable';

/** 按 target 生成默认请求体 JSON 文本(2-space)。data 键=字段 key,值由 def 推导。 */
export function buildRenderPayload(
  templateId: string | null | undefined,
  fields: Array<{ key: string; def: FieldDef }>,
  target: RenderPayloadTarget,
): string;
```

### 4.1 单字段取值规则 `fieldValue(def)`
`example` 始终是字符串;视 `example.trim() !== ''` 为「有 example」。

| type | 有 example | 无 example(占位) |
|---|---|---|
| `string` | 原样字符串 | `""` |
| `number` | `const n = Number(ex); Number.isFinite(n) ? n : 0`(**NaN guard**) | `0` |
| `boolean` | `ex === 'true'`(注:不识别 trueLabel「是/否」,可接受的小语义损失) | `false` |
| `date` | 原样 | `"2026-01-01"` |
| `datetime` | 原样 | `"2026-01-01 12:00"` |
| `enum` | 原样 | `def.options[0].value`(min 1 必有) |
| `image` | 原样 | `"https://example.com/sample.png"` |
| `array` | `[]`(忽略 example;数组字段恒给空数组) | `[]` |

> ⚠️ 必须**显式处理 `image` 与 `array`**,不能掉进 string 默认分支——`array` 给 `""` 会产出坏 payload(table 绑定数组字段),`image` 也应给有意义占位。

### 4.2 接口骨架
`tid = templateId?.trim() || '<保存模板后获得>'`;`data = Object.fromEntries(fields.map(f => [f.key, fieldValue(f.def)]))`。

- **render**:`{ templateId: tid, data, formats: ["pdf"] }`
- **bitable**:
```json
{
  "verificationToken": "<verificationToken>",
  "templateId": tid,
  "data": { ... },
  "lark": {
    "appToken": "<appToken>",
    "tableId": "<tableId>",
    "recordId": "<recordId>",
    "statusField": "状态",
    "attachmentField": "附件"
  }
}
```
返回 `JSON.stringify(payload, null, 2)`。占位统一用尖括号 `<...>` 风格;`statusField`/`attachmentField` 给可用默认值(「状态」「附件」,与机器人侧一致)。`version`(DTO 选填)本版不放,保持骨架精简。

## 5. 字段页交互(`FieldManager.vue`)

头部「添加变量」按钮旁加「生成入参」按钮 → `ElDialog`:
- 顶部 `ElSelect`:`渲染 API (POST /api/render)` / `多维表格 webhook (POST /lark/print-trigger)`。
- 中部只读 `<pre>{{ generatedJson }}</pre>`,`generatedJson` 为 computed:`buildRenderPayload(store.templateId, store.fieldDefs, target)`,随接口选择 / 字段增删改实时变。
- 底部「复制」按钮:`navigator.clipboard.writeText(generatedJson)` + 成功 toast(复用现有 ElMessage)。
- `store.templateId` 为空(未保存模板)时,弹窗内一行灰字提示:「模板未保存,templateId 为占位,保存后替换为真实值」。

## 6. 边界

- 无字段 → `data: {}`(骨架仍完整)。
- 未保存模板 → templateId 占位 + 提示(见上)。
- `enum` 恒有 options(schema min 1),取 `[0].value`。
- 纯前端;不改后端、不新增 env、不拉真 token。

## 7. 测试

- **helper 单测**:`packages/schema/test/render-payload.spec.ts`(现成 vitest)。覆盖:
  - render / bitable 两 target 的骨架结构。
  - 每种 field type 的占位值(尤其 `array→[]`、`image→url`、`enum→options[0].value`)。
  - example 优先 + number 的 NaN guard(`example="abc"`→`0`、`example="50"`→`50`、`example=""`→占位)。
  - 未保存 templateId → 占位字符串;无字段 → `data:{}`。
- **字段页手测**:打开弹窗、切接口、改字段后 JSON 实时变、复制到剪贴板。

## 8. 受影响文件

- 新增:`packages/schema/src/render-payload.ts`(`import type { FieldDef }` 仅类型)+ `packages/schema/test/render-payload.spec.ts`。
- 改:`packages/schema/src/template.ts`(加 `export type FieldDef = z.infer<typeof FieldDefSchema>;`)。
- 改:`packages/schema/package.json`(`exports` 加 `"./render-payload": "./src/render-payload.ts"`;**不**改 `index.ts`)。
- 改:`apps/web/src/designer/FieldManager.vue`(从 `@template-printing/schema/render-payload` 子路径 import;加按钮 + 弹窗 + computed + 复制)。

## 9. 不做(YAGNI / 明确排除)

- 不纳入 Request 1 的 ⑤(补 `GET /api/render/jobs` 文档 + 让 ApiView 复用 helper)——独立的文档/接口补全,单独开。但 **helper 设计为可被 ApiView 复用**(放共享包),将来接入近零成本。
- 不给 `apps/web` 起 vitest 基建(本可单独做;本 spec 借 `packages/schema` 的现成 vitest)。
- bitable 骨架不放 `version`、不做"自动填真 token"。
