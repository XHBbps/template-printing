# 页面表头红线统一 + 标题相对红线居中 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把全站页面表头(`.page-bar`)的红色签名线统一为全局样式,并让「图标 + 页面名」相对红线水平居中,红线从侧边栏边缘延伸到灰色分隔线。

**Architecture:** 纯 CSS,全局收口。红线由全局 `.page-title` 的 `border-top` 承载(`align-self: stretch` 撑满 64px 使其落在表头顶边);`.page-bar` 去左 padding + `gap:0` 使标题区左缘落在 x=0、右缘抵住 `.page-sub` 的灰色分隔线;`.page-title` 左右等距 padding 实现水平居中。删除 ApiView / UsersAdminView / AuditLogView 三处重复的 `.page-bar::before`。不改任何 view 模板。

**Tech Stack:** Vue 3 SFC scoped CSS + 全局 `apps/web/src/styles/yangli/app-shell.css`;颜色走 `colors_and_type.css` 变量(`--yangli-red`)。

**Spec:** `docs/superpowers/specs/2026-05-26-page-header-red-line-unify-design.md`

**全局约定:** 容器内跑命令(Docker dev):`docker exec template_printing-web sh -c "cd /workspace/apps/web && <cmd>"`。提交走 husky 钩子,不要 `--no-verify`。只 `git add` 本任务文件。

---

## File Structure

纯样式改动,无新文件:
- Modify `apps/web/src/styles/yangli/app-shell.css` —— 全局 `.page-bar` 与 `.page-bar .page-title`(红线 + 居中)。
- Modify `apps/web/src/views/ApiView.vue` —— 删除 scoped `.page-bar::before` 重复块。
- Modify `apps/web/src/views/admin/UsersAdminView.vue` —— 删除 scoped `.page-bar::before` 重复块。
- Modify `apps/web/src/views/admin/AuditLogView.vue` —— 删除 scoped `.page-bar::before` 重复块。

> 单一内聚改动,放在**一个 commit**:必须在同一提交里"加全局红线 + 删三处重复",否则中间态会让这三页同时出现旧 96px 短线和新 border-top 两条线。

---

## Task 1: 全局红线统一 + 标题居中(单提交)

**Files:**
- Modify: `apps/web/src/styles/yangli/app-shell.css`(`.page-bar` ≈ 行 133-142;`.page-bar .page-title` ≈ 行 143-148)
- Modify: `apps/web/src/views/ApiView.vue`(scoped `.page-bar::before` 块)
- Modify: `apps/web/src/views/admin/UsersAdminView.vue`(scoped `.page-bar::before` 块)
- Modify: `apps/web/src/views/admin/AuditLogView.vue`(scoped `.page-bar::before` 块)

- [ ] **Step 1: 改全局 `.page-bar`(去左 padding + gap 归零)**

在 `apps/web/src/styles/yangli/app-shell.css` 中,把:

```css
.page-bar {
  grid-column: 2;
  background: var(--paper-white);
  border-bottom: 1px solid var(--stone);
  display: flex; align-items: center;
  height: 64px;          /* 与 sidebar-head 同高 — 统一视觉锚线 */
  flex-shrink: 0;
  padding: 0 32px;
  gap: 16px;
}
```

改为:

```css
.page-bar {
  grid-column: 2;
  background: var(--paper-white);
  border-bottom: 1px solid var(--stone);
  display: flex; align-items: center;
  height: 64px;          /* 与 sidebar-head 同高 — 统一视觉锚线 */
  flex-shrink: 0;
  padding: 0 32px 0 0;   /* 去左 padding:标题区左缘落在侧边栏边缘 x=0 */
  gap: 0;                /* 标题区右缘抵住灰色分隔线(page-sub border-left) */
}
```

- [ ] **Step 2: 改全局 `.page-bar .page-title`(整高 + 红线 + 等距 padding 居中)**

紧接其后,把:

```css
.page-bar .page-title {
  display: flex; align-items: center; gap: 12px;
  font-family: var(--font-han);
  font-size: 18px; font-weight: 600;
  color: var(--ink);
}
```

改为:

```css
.page-bar .page-title {
  align-self: stretch;                       /* 撑满 64px:红线(border-top)落在表头顶边 */
  border-top: 2px solid var(--yangli-red);   /* 全站统一红色签名线 */
  display: flex; align-items: center; gap: 12px;
  padding: 0 24px;                           /* 左右等距 → 图标+名在 [边缘→灰分隔线] 内水平居中 */
  font-family: var(--font-han);
  font-size: 18px; font-weight: 600;
  color: var(--ink);
}
```

> 说明:全局已有 `*, *::before, *::after { box-sizing: border-box }`(app-shell.css:7),故 2px border-top 含在 64px 内,不溢出。`align-self: stretch` 覆盖 `.page-bar` 的 `align-items: center`,只让 page-title 撑满高度;其内部 `align-items: center` 仍让图标+文字垂直居中。

- [ ] **Step 3: 删除 ApiView 重复块**

在 `apps/web/src/views/ApiView.vue` 的 `<style scoped>` 中删除整段(连同注释):

```css
/* Page-bar 签名：左对齐 2px × 96px 红实线（与其它页一致） */
.page-bar {
  position: relative;
}
.page-bar::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  height: 2px;
  width: 96px;
  background: var(--yangli-red);
}
```

- [ ] **Step 4: 删除 UsersAdminView 重复块**

在 `apps/web/src/views/admin/UsersAdminView.vue` 的 `<style scoped>` 中删除整段:

```css
/* Page-bar 红签名线 */
.page-bar {
  position: relative;
}
.page-bar::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  height: 2px;
  width: 96px;
  background: var(--yangli-red);
}
```

- [ ] **Step 5: 删除 AuditLogView 重复块**

在 `apps/web/src/views/admin/AuditLogView.vue` 的 `<style scoped>` 中删除整段:

```css
/* Page-bar 签名：左对齐 2px × 96px 红实线（与模板中心 v2 一致） */
.page-bar {
  position: relative;
}
.page-bar::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  height: 2px;
  width: 96px;
  background: var(--yangli-red);
}
```

- [ ] **Step 6: typecheck + lint**

Run:
```
docker exec template_printing-web sh -c "cd /workspace/apps/web && pnpm run typecheck && pnpm run lint"
```
Expected: 无错误、零告警。(纯 CSS 改动,vue-tsc/eslint 不应受影响。)

- [ ] **Step 7: 手测六页(目视)**

启动/确认 web dev 可访问,登录后逐一打开并目视核对:
- 模板中心 `/templates`、渲染日志 `/logs`、个人中心 `/me`、用户管理 `/admin/users`、审计日志 `/admin/audit`、API 文档 `/api`。
- 核对项:① 每页表头顶边都有同样的 2px 红线;② 红线左缘贴侧边栏边缘、右缘止于灰色分隔线(page-sub 左边框);③「图标 + 页面名」在红线区间内水平居中;④ 副标题(MONO)与右侧按钮(用户管理「新建」、渲染日志/审计「刷新」)未错位。
- 标题宽度差异:`/api`(标题 `API`,短)与中文 4 字页对比,均居中、红线均止于各自分隔线。
- 折叠侧边栏:红线左缘仍贴侧边栏边缘(`.page-bar` 为 grid-column 2,折叠不影响)。

> 若 dev 环境不便交互登录,至少确认 build/lint 通过 + 静态审阅 CSS 计算逻辑;并在汇报中说明手测覆盖程度。

- [ ] **Step 8: 提交(只这 4 个文件,不 `--no-verify`)**

```bash
git add apps/web/src/styles/yangli/app-shell.css \
        apps/web/src/views/ApiView.vue \
        apps/web/src/views/admin/UsersAdminView.vue \
        apps/web/src/views/admin/AuditLogView.vue
git commit -m "style(web): 页面表头红线全站统一 + 标题相对红线居中（删 3 处重复，全局收口）"
```

---

## Task 2: 文档同步

**Files:**
- Modify: `docs/PROGRESS.md`(第 3 节 2026-05-26 "近期变更" 顶部追加一条)

- [ ] **Step 1: 追加 PROGRESS 近期变更**

在 `docs/PROGRESS.md` 的 `### 2026-05-26` 段顶部插入一条(匹配既有项目符号风格):

```markdown
- **style(web)：页面表头红线全站统一** —— 红色签名线收进全局 `.page-bar .page-title`(`border-top` + `align-self:stretch` 落顶边;`.page-bar` 去左 padding + `gap:0` 使标题区左缘贴侧边栏、右缘抵灰色分隔线;`.page-title` 左右等距 padding 使「图标+页面名」相对红线水平居中),删除 ApiView/UsersAdminView/AuditLogView 三处重复的 `.page-bar::before`。此前三页有红线、三页无,且为定宽 96px 短线。
```

- [ ] **Step 2: 提交**

```bash
git add docs/PROGRESS.md
git commit -m "docs: 同步页面表头红线统一"
```

---

## Self-Review(写计划后自检结果)

**Spec 覆盖:**
- §2 目标视觉(红线 2px 红、顶边、边缘→灰分隔线、图标+名居中、六页一致)→ Task 1 Step 1-2 ✅
- §3.1 全局 `.page-bar`/`.page-title` 调整(去左 padding、gap:0、stretch、border-top、等距 padding)→ Task 1 Step 1-2 ✅
- §3.2 删三处重复 → Task 1 Step 3-5 ✅
- §4 影响文件(app-shell.css + 3 view、不改模板)→ Task 1 文件清单一致 ✅
- §5 测试(六页 + 长短标题 + 折叠态 + 按钮)→ Task 1 Step 7 ✅
- §6 不做/约束(不改颜色粗细/不动 sub/按钮/不改模板)→ 计划仅含 CSS 属性增改与删重复,未触模板 ✅
- 文档同步(AGENTS §9)→ Task 2 ✅(无目录结构变化,故不动 AGENTS.md)

**占位符扫描:** 无 TBD/TODO;每个 CSS 改动给出完整 before/after 与待删整段。

**一致性:** 三处待删块文本均与各 view 现状逐字对应(已核对);全局 before 文本与 app-shell.css 现状一致;`--yangli-red`/`box-sizing:border-box` 均为既有全局定义。
