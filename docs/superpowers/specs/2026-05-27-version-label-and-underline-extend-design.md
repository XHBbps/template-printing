# 未发布版本标签修正 + 下划线对称延长 设计文档

> 状态:已与用户确认设计,进入实现计划阶段。
> 日期:2026-05-27
> 范围:两个独立的通用小改动(全模板生效,不针对单个模板):① 设计器子标题对未发布模板误显示 "V1" → 改为"未发布";② 文字元素下划线向左右各等量延长。

---

## 问题 1:未发布模板误显示 "V1"

### 现状
`apps/web/src/views/DesignerView.vue:184` 子标题渲染:
```
<span>V{{ store.template.meta.version }}</span> · {{ saveCaption.cap }} · {{ saveCaption.han }}
```
`meta.version` 是模板**元数据版本**(`TemplateMetaSchema.version`,schema 默认 = 1),与"是否已发布"无关 —— 故未发布模板也显示 "V1"。而 `saveCaption`(`DesignerView.vue:25-38`)**已正确**反映发布状态:
- `publishedVersion == null` → `{ cap:'UNPUBLISHED', han:'未发布' }`
- 有未发布改动 → `V{publishedVersion} · 有未发布改动`
- 已发布 → `V{publishedVersion} · 已发布`

所以独立的 `V{meta.version}` 既冗余又误导。

### 改法
删除该独立 `V{{ store.template.meta.version }}` span 及其后的分隔 `·`。子标题改为 `{{ saveCaption.cap }} · {{ saveCaption.han }}`。
- 未发布:显示 **"UNPUBLISHED · 未发布"**(不再有 V1)。
- 已发布 V2:显示 "V2 · PUBLISHED · V2 · 已发布"(发布版号由 saveCaption 提供,正确)。

仅改 `DesignerView.vue` 一处模板标记;不动 `saveCaption` 逻辑、不改 `meta.version` 数据。

---

## 问题 2:下划线向左右各等量延长(通用)

### 现状
上一轮修复后,`TextElement`(渲染器,设计器画布/预览/打印共用)的下划线用 `text-decoration: underline` + 拆末字去尾距 → 下划线**恰好等于文字宽度、左右对称**(实测左右边距相等),但**贴着文字两端、无法延伸到文字之外**。用户要求下划线像实物那样**向左右各延长等长的一小段**。

### 改法
`text-decoration` 无法超出文字范围,故下划线改用 **`border-bottom`** 渲染在文字 run 上,并用**左右等量内边距**制造延长、**底部内边距**制造与文字的间距:
- 文字 run(`TextElement.vue` 内层 span)在 `textDecoration==='underline'` 时:
  - 去掉原 `text-decoration` / `text-underline-offset`;
  - 加 `border-bottom: 1px solid currentColor`(颜色随文字色);
  - 加 `padding: 0 0.5em 0.15em`(左右各 **0.5em** = 延长量,随字号缩放;底部 **0.15em** = 下划线与文字间距;顶部 0)。
- 非分散对齐(center/right/left):run 为收缩宽度(flex 子项按内容收缩),被容器 `justify-content` 居中 → `border-bottom` = 文字宽 + 2×0.5em,居中即**左右对称延长 0.5em**。
- 分散对齐(justify):run 为 `display:block; width:100%`,`border-bottom` 跨整框宽;左右 0.5em padding 使分散的文字内缩,下划线相对文字仍两侧各延长 ~0.5em。
- 拆末字去尾距(上一轮)逻辑保留(保证文字本体居中对称)。

延长量 **0.5em 固定**(随字号),对所有带下划线的文字元素通用;不新增 schema 字段 / 不改属性面板。

> 说明:此改动把全站下划线从 `text-decoration` 切换为 `border-bottom`,下划线粗细统一为 1px(原 text-decoration 粗细随字体);视觉上更接近实物(连续直线 + 两端延长 + 间距)。

---

## 影响文件

- 改:`apps/web/src/views/DesignerView.vue`(删 `V{meta.version}` span)。
- 改:`packages/template-renderer/src/elements/TextElement.vue`(下划线改 border-bottom + 0.5em 延长 + 间距)。

## 测试

- 问题 1:手测 —— 打开一个未发布模板(`publishedVersion=null`),设计器左上子标题显示"…未发布",不再出现 "V1";已发布模板仍显示 "V{n} · 已发布"。
- 问题 2:Chromium 实测(沿用上一轮的量框脚本)—— 渲染居中 + 字间距 + 下划线的文字,断言:① 下划线(border-bottom)左右延长量相等(run 在容器内左右边距相等);② 下划线总宽 = 文字宽 + 2×0.5em(±1px)。并手测设计器画布/打印预览中下划线两端等量延长、与文字有间距。
- typecheck + lint:`template-renderer` 与 `apps/web`。

## 不做 / 约束

- 不改任何模板数据(通用渲染/UI 改动)。
- 不新增下划线延长量的配置字段(固定 0.5em)。
- 不改 `meta.version` 数据或 `saveCaption` 的发布状态逻辑。
- 不引入新依赖。
