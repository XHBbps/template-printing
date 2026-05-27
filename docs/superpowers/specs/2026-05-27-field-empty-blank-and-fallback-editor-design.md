# 字段空数据真实输出留空 + 缺省值可编辑 设计文档

> 状态:已与用户确认设计,进入实现计划阶段。
> 日期:2026-05-27
> 范围:通用(全模板字段生效,不替单个模板改数据):① 字段「缺省值 `fallback`」默认由 `—` 改为空 → 真实输出(预览/打印/渲染)空数据时不显示横线;② 属性面板新增「缺省值」输入框,可改/清空 fallback。

---

## 问题

`扬力出门证` 等模板里,字段(field)绑定的变量在**真实输出**(预览 / 打印 / 渲染,`FieldElement` 的 `designMode=false`)中、当数据为空时,会显示一条"横线" `—`。用户期望:真实输出空数据 → **留空(不显示)**;设计器画布仍要能看到字段占位;系统其他地方的 `—` 占位不动。

### 根因
- `FieldElement.vue` `displayValue`:`designMode` 下显示 `{{ binding }}`;否则数据为空(`null`/`''`)时返回 `props.element.fallback`。
- `fallback` 默认值是 `—`:
  - `packages/schema/src/template.ts:93` `fallback: z.string().default('—')`
  - `apps/web/src/designer/elementFactory.ts:111` `fallback: '—'`
- 属性面板(`PropertyPanel.vue`)**没有** fallback 编辑入口 → 用户无法改/清空,被迫一直显示 `—`。
- 设计器画布显示的是 `{{ out_date }}`(binding 占位),所以设计时看不到 `—`,只在真实输出暴露。

---

## 改法

通用渲染 / 配置改动,不改任何模板数据:

1. **缺省值默认改空**
   - `packages/schema/src/template.ts`:`fallback: z.string().default('')`(原 `'—'`)。
   - `apps/web/src/designer/elementFactory.ts`:新建 field 的 `fallback: ''`(原 `'—'`)。
   - 效果:**新建**字段空数据 → 真实输出为空。

2. **属性面板新增「缺省值」输入框**(field 元素)
   - 位置:`PropertyPanel.vue` 中 `sel.type === 'field'` 的「绑定」行下方,新增一行文本 `<input>`,值 = `sel.fallback`,`@input` → `store.updateElement(sel.id, { fallback: v })`(经 `setFallback` 函数,与现有 `setBinding` 同构)。
   - 提示文案:占位符 `空数据时显示(留空=不显示)`。
   - 效果:可把已存模板里旧字段的 `—` 清空,也可按需填自定义占位(如 `N/A`)。

3. **`FieldElement.vue` 渲染逻辑不变**
   - 仍为「`designMode`→`{{ binding }}`;否则空→`fallback`」。`fallback` 为 `''` 时即不显示。

4. **测试 / 文档**
   - 更新 `packages/schema/test/template.spec.ts`(原断言 `fallback` 默认 `'—'` → `''`)。
   - `docs/PROGRESS.md` §3 近期变更追加。

### 一致性
预览(`预览模板` 弹窗)与打印 / 渲染均为 `designMode=false`,改后空数据都显示为空 → 三者一致。设计器画布(`designMode=true`)仍显示 `{{ binding }}`(系统内占位保留)。系统其他位置(模板列表 / 飞书卡片等)的 `—` 占位不在本次范围,不动。

---

## 影响文件

- 改:`packages/schema/src/template.ts`(`fallback` 默认 `''`)。
- 改:`apps/web/src/designer/elementFactory.ts`(新建 field `fallback: ''`)。
- 改:`apps/web/src/designer/PropertyPanel.vue`(新增「缺省值」输入框 + `setFallback`)。
- 改:`packages/schema/test/template.spec.ts`(默认值断言)。
- 改:`docs/PROGRESS.md`(近期变更)。

## 测试

- schema 单测:field 默认 `fallback === ''`;`pnpm --filter @template-printing/schema test`(或容器内 vitest)。
- 手测:① 新建字段不填数据 → 预览空白;② 打开「扬力出门证」,选中 out_date 字段,属性面板出现「缺省值」框且当前为 `—`,清空后预览该处空白;③ 填自定义缺省值(N/A)→ 预览空数据显示 N/A;④ 设计器画布仍显示 `{{ out_date }}`。
- typecheck + lint(schema + web)。

## 不做 / 约束

- 不改任何模板的字段数据(默认值 + UI 通用改动;旧模板由用户在设计器清空)。
- 不改 `FieldElement` 空值判定逻辑。
- 不动系统其他位置的 `—` 占位(模板列表、飞书卡片等)。
- 不引入新依赖。
