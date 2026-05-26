# 页面表头红线统一 + 标题相对红线居中 设计文档

> 状态:已与用户确认设计,进入实现计划阶段。
> 日期:2026-05-26
> 范围:统一全站页面表头(`.page-bar`)的红色签名线,并让「图标 + 页面名」相对红线水平居中。纯 CSS,不改任何 view 模板。

---

## 1. 背景与问题

全站页面表头共用同一结构(`apps/web/src/styles/yangli/app-shell.css` 的全局 `.page-bar`):

```
<header class="page-bar">
  <div class="page-title"><span class="ico">…</span> 页面名</div>
  <div class="page-sub">MONO · 副标题</div>   ← border-left 即“灰色分隔线”
  [<div class="page-bar-spacer"></div> <button>…</button>]   ← 部分页有,至多 1 个按钮
</header>
```

红色签名线当前是 **各 view 自行重复定义**的 `.page-bar::before`(`2px × 96px` 定宽短线,`top:0 left:0`):

- **有红线**:`ApiView.vue`、`admin/UsersAdminView.vue`、`admin/AuditLogView.vue`(各重复一份 `.page-bar { position: relative } + .page-bar::before {…96px…}`)。
- **无红线**:`TemplatesView.vue`、`RenderLogsView.vue`、`MeView.vue`。

问题:①三有三无,风格不统一;②即便有,也是定宽 96px 短线、不到分隔线;③标题在表头里左对齐(`.page-bar` 左 padding 32px、title↔sub flex `gap` 16px,左重右轻),并未相对红线居中。

## 2. 目标视觉(六页一致)

- 红线:`2px` 实色 `var(--yangli-red)`,位于表头**顶边**(64px 高表头的最上沿)。
- 红线水平范围:从**侧边栏边缘**(`.page-bar` 左边缘,x=0)延伸到**灰色分隔线**(`.page-sub` 的 `border-left` 所在位置)。
- 「图标 + 页面名」在 `[x=0 → 灰色分隔线]` 区间内**水平居中**(左右边距相等),对任意标题宽度成立(中文 4 字 / `API` / `API 文档` 等均自动居中)。
- `.page-sub`(MONO 副标题)、spacer、右侧按钮位置与样式不变。
- 六个页面(模板中心 / 渲染日志 / 个人中心 / 用户管理 / 审计日志 / API 文档)表现完全一致。

## 3. 实现方案:纯 CSS,全局收口(无模板改动)

核心:把红线从“`.page-bar::before` 定宽伪元素”改为**由 `.page-title` 承载的整高顶边框**,并用“左 padding == title↔sub 间距”实现自动居中。

### 3.1 全局 `app-shell.css` 调整

`.page-bar`(现 `padding: 0 32px; gap: 16px; display:flex; align-items:center; height:64px`):
- 去掉**左** padding(保留右 padding,使最右按钮不贴边):`padding: 0 32px 0 0;`
- 把 flex `gap` 归零:`gap: 0;` —— 使 `.page-title` 右缘直接抵住 `.page-sub`(即灰色分隔线);经核对每页表头至多 1 个按钮,归零不会造成按钮相邻挤压(spacer `flex:1` 仍负责把按钮推到右侧)。

`.page-title`(现 `display:flex; align-items:center; gap:12px; font…`):
- `align-self: stretch;` —— 撑满 64px 表头高度,使其**顶边 == 表头顶边**。
- `border-top: 2px solid var(--yangli-red);` —— 红线即此顶边框,因元素整高,红线落在表头最上沿。
- `padding: 0 24px;` —— 左右**相等**内边距:左缘落在 x=0(`.page-bar` 已无左 padding、`.page-title` 为首子元素),右缘(含 24px 右 padding)抵住 `.page-sub`;左右等距使「图标+页面名」在 `[x=0→分隔线]` 内自动水平居中(与标题宽度无关)。
- 其余不变(`align-items:center` 保证内容在 64px 内垂直居中;`gap:12px` 图标与文字间距不变)。

> 居中原理:盒宽 = 左padding + 内容 + 右padding,左右 padding 相等 ⇒ 内容居于盒中;盒左缘 x=0、盒右缘=分隔线 ⇒ 内容居于 `[x=0→分隔线]` 正中。红线为该盒顶边框,长度恰好 = 盒宽 = `[x=0→分隔线]`。

> `24px` 为推荐起始值,实现时按目视微调(与图标视觉留白协调);关键是左右两侧取值**相等**。

### 3.2 删除三处重复

从以下文件的 `<style scoped>` 中**删除**重复的红线块(`.page-bar { position: relative }` 与 `.page-bar::before { …2px × 96px… }`),改由全局统一提供:
- `apps/web/src/views/ApiView.vue`
- `apps/web/src/views/admin/UsersAdminView.vue`
- `apps/web/src/views/admin/AuditLogView.vue`

(连同其上方注释行,如「Page-bar 签名:左对齐 2px × 96px 红实线…」一并删除。)

## 4. 影响文件

- 改:`apps/web/src/styles/yangli/app-shell.css`(`.page-bar` / `.page-title`)。
- 删块:`ApiView.vue`、`admin/UsersAdminView.vue`、`admin/AuditLogView.vue` 各自的 `.page-bar::before` 重复定义。
- **不改任何 view 模板**(`<template>`)。

## 5. 测试(纯 CSS,手测)

无自动化测试。手测矩阵:
- 六页逐一目视:模板中心 / 渲染日志 / 个人中心 / 用户管理 / 审计日志 / API 文档 —— 红线一致(顶边 2px 红、从侧边栏边缘到灰分隔线)、图标+名水平居中、副标题与右侧按钮未错位。
- 标题宽度差异:短标题(`API`)与较长标题(`API 文档`)均居中、红线均止于各自分隔线。
- 侧边栏折叠态:红线左缘仍贴侧边栏边缘(`.page-bar` 为 grid-column 2,折叠不影响其左缘)。
- 有按钮页(用户管理「新建」、渲染日志/审计「刷新」):按钮仍在最右、间距正常。

## 6. 不做 / 约束

- 不改红线颜色 / 粗细(保持 `2px` `var(--yangli-red)`)。
- 不动 `.page-sub`、spacer、按钮的样式。
- 不改任何 view 的 `<template>` 标记(纯 CSS)。
- 不引入新依赖;颜色走 `colors_and_type.css` 变量。
