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

新增 `packages/schema/src/render-payload.ts`,从 `packages/schema/src/index.ts` 导出。放共享包的理由:纯函数、只吃 `FieldDef` 类型、有现成 vitest 覆盖,且天然支撑日后 ApiView 复用同一口径(避免两处漂移);避免为一个纯函数给 `apps/web` 起一整套测试基建。

```ts
import type { FieldDef } from './template.js';

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

- 新增:`packages/schema/src/render-payload.ts` + 从 `index.ts` 导出 + `packages/schema/test/render-payload.spec.ts`。
- 改:`apps/web/src/designer/FieldManager.vue`(加按钮 + 弹窗 + computed + 复制)。

## 9. 不做(YAGNI / 明确排除)

- 不纳入 Request 1 的 ⑤(补 `GET /api/render/jobs` 文档 + 让 ApiView 复用 helper)——独立的文档/接口补全,单独开。但 **helper 设计为可被 ApiView 复用**(放共享包),将来接入近零成本。
- 不给 `apps/web` 起 vitest 基建(本可单独做;本 spec 借 `packages/schema` 的现成 vitest)。
- bitable 骨架不放 `version`、不做"自动填真 token"。
