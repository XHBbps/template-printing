# iter 30A · 实施计划 — 扬力品牌基础 + Sidebar

**日期**：2026-05-25
**Spec**：[`docs/superpowers/specs/2026-05-25-iter-30-yangli-rebrand-design.md`](../specs/2026-05-25-iter-30-yangli-rebrand-design.md)
**分支**：`feature/iter-30a-yangli-foundation`

---

## 目标

把扬力 design token 接入项目；建 `--tp-* → --yangli-*` 兼容映射层，一次性让全应用从紫→红 / 大圆角→方正 / 软阴影→扁平；按 `app-shell.css` 规范重写 `AppSidebar.vue`。

**完成后效果**：sidebar 完全符合品牌（LOGO + 方头像 + 红边 active），其他页面虽未按 target 重排但视觉已全面去紫化。

---

## 任务清单

### T1 — 引入资源

- 新建目录 `apps/web/src/styles/yangli/`
- 复制：
  - `handoff/colors_and_type.css` → `apps/web/src/styles/yangli/colors_and_type.css`
  - `handoff/app-shell.css` → `apps/web/src/styles/yangli/app-shell.css`
- 复制：`handoff/assets/yangli-logo-master.png` → `apps/web/public/yangli-logo-master.png`
- `apps/web/src/main.ts`：在 `theme.css` 之前 `import './styles/yangli/colors_and_type.css';` 和 `import './styles/yangli/app-shell.css';`，确保 yangli token 在所有自定义样式之前加载

### T2 — `--tp-*` 兼容映射

修改 `apps/web/src/styles/designer.css` 顶部 `:root` 块：

- 颜色：`--tp-bg`/`--tp-panel`/`--tp-ink`/`--tp-ink-soft`/`--tp-ink-faint`/`--tp-line`/`--tp-accent`/`--tp-accent-bg`/`--tp-accent-ink`/`--tp-field-bg` → 对应 yangli vars
- 圆角：`--tp-radius-panel` (18px → `--radius-2` 4px)、`--tp-radius-btn` (10 → 4)、`--tp-radius-item` (8 → 4)；保留 `--tp-radius-pill: 999px`
- 阴影：`--tp-shadow-panel` / `--tp-shadow-pill` → `none`（扁平化）

### T3 — `AppSidebar.vue` 重做

按 `app-shell.css` 的 `.sidebar` 类规范，但保留组件的 collapsed 状态、登出确认、Pinia store 集成、router-link active 检测：

**结构**：

```
<aside class="sidebar">
  <div class="sidebar-head">
    <div class="brand-lockup">
      <img src="/yangli-logo-master.png" alt="YANGLI" />
      <span class="pipe"></span>
      <span class="app-name">模板打印</span>
    </div>
    <button class="collapse-btn" />
  </div>

  <nav class="nav">
    <!-- 5 个主路由 + 1 admin -->
    <!-- 字体 var(--font-han) 13.5px / 默认 var(--fg-2) / icon var(--iron) -->
    <!-- active: border-left 2px var(--yangli-red) / 文字 + icon 红 -->
  </nav>

  <div class="sidebar-foot">
    <div class="avatar">{首字母}</div>   <!-- 28×28 方形 / radius 2 / ink 底白字 -->
    <div class="user-meta">
      <div class="name">{user.name}</div>
      <!-- 不再渲染 role / 部门 行 -->
    </div>
    <button class="logout-btn" />  <!-- ghost / hover red -->
  </div>
</aside>
```

折叠态保留：collapsed 时 LOGO 隐藏、文字隐藏、保留图标和头像。

**Brief §5.1 关键点**：

- 不要重绘 LOGO，引用 PNG
- active 必须左侧 2px 红边条 + 红字 + 红图标，**禁止紫色填充背景**
- 头像方形 28px `--ink` 底白字 monogram，**禁止圆形紫色渐变**
- 用户区只 3 个元素：头像 + 用户名 + 退出按钮，不再显示部门/角色行
- icon 统一 Lucide stroke-width 1.5

### T4 — 验收 + PROGRESS + PR

- `pnpm exec vue-tsc --noEmit` 0 错误
- Vite dev server 正常编译
- 浏览器手测 5 个路由：模板中心 / 渲染日志 / 个人中心 / API 凭证 / API；切换显示红边条 active
- 浏览器手测 sidebar 折叠 / 展开
- 浏览器手测登出
- `grep -r "#6c5ce7\|#6e59f2\|#f0eeff\|#4f3fcc" apps/web/src --exclude-dir=node_modules`：除 demo / specs / handoff 引用外应为空（实际：`designer.css` 顶层声明被全替换；浮动 element 卡 hover 等子组件颜色靠兼容映射间接走红）
- `docs/PROGRESS.md` 第 3 节追加；"最近更新" 日期 → 2026-05-25
- 提交 commits（语义化前缀）：
  - `feat(web): 引入扬力 design token + LOGO 资源`
  - `refactor(web): designer.css --tp-* → yangli vars 兼容映射`
  - `feat(web): AppSidebar 按品牌重做 — LOGO/红边 active/方头像`
- push + 开 PR #6（题目：`iter 30A: 扬力品牌基础 + Sidebar 重做`）

---

## 不在本 PR 范围

- 5 个数据 view 按 target 像素重排（→ 30B / 30C）
- 设计器布局重排（→ 30D）
- 拓扑结构调整（路由、layout 容器仍为现状）
- 中文字体替换 HarmonyOS Sans SC（待品牌办公室提供文件）

---

## 风险与回退

- **风险**：兼容映射后某些组件用了硬编码紫色 hex（非 `--tp-*`），还会残留。**应对**：T4 grep 检查；硬编码处单独 patch。
- **风险**：`element-plus/dist/index.css` 自带 `#409eff` 蓝主色，本次不替换（el-button / el-dialog 等保留默认）。**约定**：30B 起的新 view 不依赖 el-button-primary 样式，改用 `app-shell.css` 的 `.btn-primary`。
- **回退**：单 commit 可独立 revert；兼容映射变更可整体撤回到 `designer.css` 原 `:root` 块。

---

**末**
