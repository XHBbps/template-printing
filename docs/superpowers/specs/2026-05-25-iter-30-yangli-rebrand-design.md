# iter 30 系列 — 扬力品牌 UI 改造 · 总设计

**日期**：2026-05-25
**作者**：Claude Code（基于扬力品牌办公室 `handoff/UI_REFACTOR_BRIEF.md` v1）
**范围**：apps/web 全前端 UI 视觉与基础组件改造

---

## 1 · 背景

当前 web 前端采用紫色（`#6c5ce7` 主，浮卡 + 大圆角 + 软阴影）的通用 SaaS 风格，与扬力集团红 / 石墨灰 / 方正工业的品牌语言不一致。本系列按品牌办公室交付的 `handoff/` 包改造到目标稿。

**唯一权威来源**：

- `handoff/UI_REFACTOR_BRIEF.md` — 规范、Token、组件级清单、§10 验收
- `handoff/colors_and_type.css` — 颜色 / 字体 / 间距 / 圆角 token，直接引入，**禁止重新声明**
- `handoff/app-shell.css` — sidebar / page-bar / 按钮基础类
- `handoff/target-*.html`（5 张）— 像素级目标稿，分别对应：
  - `target-mockup.html` → `DesignerView`（编辑器）
  - `target-renderlog.html` → `RenderLogsView`
  - `target-apicredentials.html` → `ApiTokensView`
  - `target-api.html` → `ApiView`
  - `target-account.html` → `MeView`

---

## 2 · 设计锚点（来自 brief §3）

1. **70 % 中性 · 25 % 石墨 · 5 % 红**。红色是标点，不是壁纸。
2. **方正、扁平、有重量**。无渐变 / 毛玻璃 / 浮夸阴影 / 圆角胶囊（状态徽章除外）。
3. **EN / 中文视觉等权**。

---

## 3 · 全局 Token 切换策略

当前所有视图共用 `apps/web/src/styles/designer.css` 顶部 `--tp-*` 命名空间（紫色 / 圆角 18px / 软阴影）。直接全量重命名会造成 ~30 个文件 × 多处的 churn，且各 PR 都要重做大量行。

**采用兼容映射**：保留 `--tp-*` 变量名，但 **重新映射到 yangli vars**。一次性让全应用从紫→红 / 圆角→方正 / 阴影→无。后续 30B-30D 按 target HTML 重写时再针对性引用 `--yangli-*` / `--ink` / `--mist` 等原生 token。

`designer.css` 顶部映射示例：

```css
:root {
  --tp-bg: var(--mist);
  --tp-panel: var(--paper-white);
  --tp-ink: var(--ink);
  --tp-ink-soft: var(--yangli-graphite);
  --tp-ink-faint: var(--iron);
  --tp-line: var(--stone);
  --tp-accent: var(--yangli-red);
  --tp-accent-bg: rgba(211, 45, 39, 0.08);
  --tp-accent-ink: var(--yangli-red);
  --tp-radius-panel: var(--radius-2);   /* 18px → 4px */
  --tp-radius-btn: var(--radius-2);     /* 10px → 4px */
  --tp-radius-item: var(--radius-2);    /* 8px → 4px */
  --tp-shadow-panel: none;              /* flat */
  --tp-shadow-pill: none;
}
```

---

## 4 · 系列拆分（4 PR）

每个 PR 独立可验收 / 合并，不阻塞。

| PR | 范围 | 主要文件 | 预估行 |
|---|---|---|---|
| **30A** 基础 + Sidebar | colors_and_type.css + app-shell.css 引入；`--tp-*` 兼容映射；AppSidebar 按品牌重做 | main.ts / styles/yangli/ / designer.css 顶部 / AppSidebar.vue / 全应用视觉立即翻盘 | ~300 |
| **30B** 数据/管理页 | RenderLogsView + ApiTokensView + ApiView 按 target HTML 重写 | 3 个 view + 局部 component | ~1000 |
| **30C** 账号 + 模板中心 | MeView + TemplatesView 按 target HTML 重写 | 2 个 view | ~800 |
| **30D** 设计器 | DesignerView + 22 子组件按 target-mockup 重写（4 列布局、右下浮岛、元素卡二列网格、变量面板空态等） | designer.css 重写 + designer/*.vue 全量 token & 结构 | ~2000 |

**30A 之后**：紫色完全消失、方头像 + 红边导航生效，但内部页面布局未动（沿用现结构 + 新 token）。后续 PR 按 target 像素对齐。

---

## 5 · 全局规则（brief §5.6）

所有 PR 共同遵守：

- 去掉自定义阴影；分隔靠 `1px solid var(--stone)`；
- 去掉所有渐变（按钮 / 头像 / 背景一律实色）；
- 链接默认 `var(--ink)`，hover → `var(--yangli-red)`；
- focus 态：2 px `--yangli-red` outline，offset 2 px；
- 禁止 emoji 与装饰 Unicode；
- 图标统一 Lucide stroke-width 1.5 / 颜色 `var(--fg-2)`，尺寸：导航 16 / 元素卡 22 / 工具栏 14 / 画布控件 14；
- 「立即打印」是页面唯一红色填充按钮（其他场景红色仅用于：active 边条、链接 hover、focus outline、destructive pill）。

---

## 6 · 验收（来自 brief §10）

各 PR 提交前自检：

- [ ] 全站 grep：无 `#6c5ce7` / `#6e59f2` / `#f0eeff` / `#4f3fcc`（不含 demo / specs / handoff 目录）；
- [ ] 全站 grep：无 `border-radius: 8px` 以上的常规元素（大卡 `--radius-3` 例外）；
- [ ] 全站 grep：无 `box-shadow:` 用于普通按钮 / 卡片；
- [ ] 立即打印为唯一红色填充按钮；
- [ ] 模板中心 active 用左侧红边条；
- [ ] 头像方形石墨灰底；
- [ ] LOGO PNG 正确引入；
- [ ] 字体加载 Geist + Noto Sans SC（DevTools 可见）；
- [ ] 所有图标 stroke-width 1.5、`var(--fg-2)`；
- [ ] 页面 emoji = 0。

---

## 7 · 不在本系列范围

- HarmonyOS Sans SC 字体替换（brief §11 待定）— 暂用 Noto Sans SC drop-in
- 厂房照片 hero 引导页（brief §11 后续）
- 后端 API / 数据模型 / 权限调整（纯前端视觉）
- 黑暗模式（brief 未涵盖）

---

**末**
