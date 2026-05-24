# iter 30B · 实施计划 — 数据 / 管理页扬力化

**日期**：2026-05-25
**Spec**：[`docs/superpowers/specs/2026-05-25-iter-30-yangli-rebrand-design.md`](../specs/2026-05-25-iter-30-yangli-rebrand-design.md)
**分支**：`feature/iter-30b-data-views`

---

## 目标

按 `handoff/target-renderlog.html` / `target-apicredentials.html` / `target-api.html` 重写三个 view 的模板 + 样式，对齐扬力品牌（红 / 石墨 / 工业方正）。保留所有 script 逻辑不动。

---

## 三个 view 共用结构（来自 target HTML）

```
<view-root>
  <header class="page-bar">       <!-- 64px 高，bg white，1px stone 底 -->
    <div class="page-title">      <!-- font-han 18px + 红 icon -->
    <div class="page-sub">        <!-- mono caption right of title -->
    <div class="page-bar-spacer">
    <button class="btn btn-...">  <!-- 右侧 CTA -->
  </header>
  <div class="page-body">         <!-- padding 32px, overflow auto -->
    <div class="max">             <!-- max-width 1120px -->
      <!-- view 内容 -->
    </div>
  </div>
</view-root>
```

`.page-bar` 和 `.page-body` 的样式由 `styles/yangli/app-shell.css` 提供（grid-column 在 flex 布局里无害被忽略）。view root 用 `display: flex; flex-direction: column; height: 100%; overflow: hidden;` 撑满 AppShell 的 main。

---

## T1 — RenderLogsView 重写

**保留逻辑**：list / filter（status + source + templateName）/ pagination / detail dialog / status & source badges 着色。

**重写结构**（按 target-renderlog.html）：

- `page-bar`：title「渲染日志」+ icon History（红）+ sub `RENDER · JOB HISTORY`（mono caption）+ 右侧「刷新」按钮（btn-secondary sm + RefreshCw icon）
- `page-body > .max`：
  - `.filters` 卡片：3 field（状态 select / 来源 select / 模板 input wide）+ actions（重置 / 查询）
  - `.results-head`：h2「任务列表」+ `count` mono `N OF M` + `.rule` 1px 横线
  - `.card`：
    - 空态：`empty-state` eyebrow + 中文 msg + mono hint
    - 有数据：`table.log` — th UPPERCASE 10.5px caption / td 14px 行 / hover bg mist / mono ID
- 状态列改为 `.pill.ok` / `.pill.warn` / `.pill.danger` / `.pill.idle`（来自 app-shell.css）
- 操作列改用红下划线链接（参考 target `.row-actions a`）
- 详情 dialog 沿用 ElDialog 但改 token

### 验收

- 浏览器看 `/logs`：page-bar + 过滤区 + 表格按 target 像素对齐
- 状态徽标用 `.pill` 系列（不再用自写 statusColor / statusBg JS 字面量返红/紫）
- 来源徽标用 `.pill.outline` 或 `.pill.idle`
- mono 字段用 var(--font-mono)

---

## T2 — ApiTokensView 重写

**保留逻辑**：list / create dialog / 一次性明文 dialog / 复制 / 吊销。

**重写结构**（按 target-apicredentials.html）：

- `page-bar`：title「API 凭证」+ icon KeyRound（红）+ sub `BEARER · TOKEN MANAGEMENT` + 右侧「创建 Token」（btn-primary 红填充 + 加号 icon）
- `page-body > .max`：
  - `.intro` 段（max-width 760）：760-char 说明文字
  - 有 token 时：`.card` 内 `table.tokens`，列：名称 / 前缀 / 状态 pill / 最近使用 mono / 创建时间 mono / 操作（红下划线「立即吊销」）
  - 空态：`empty-state` eyebrow `No tokens · 暂无凭证` + 中文 msg + hint `FORMAT · tpkn_•••••• (32 hex)`
- 创建 dialog + 明文 dialog 沿用 ElDialog，正文用 yangli 字体 + token

### 验收

- 创建按钮是页面唯一红色填充
- 「立即吊销」是红色下划线链接
- 状态用 `.pill.ok`（活跃）/ `.pill.idle`（已吊销 / 闲置）

---

## T3 — ApiView 重写

最复杂。**保留逻辑**：模板列表 fetch / 展开 / TOC 跳转 / endpoint 折叠 / schema JSON 显示。

**重写结构**（按 target-api.html）：

- `page-bar`：title「API」+ icon Code（红）+ sub `DEVELOPER · REFERENCE` + 右侧「下载 OpenAPI」（btn-ghost sm）— 此按钮暂时无功能，留 `disabled` 或注释 TODO
- `page-body.narrow`：内含 `.api-layout`（240 + 1fr grid + 32 gap，max 1240）
  - 左侧 `.toc` sticky top:96px / 1px stone 左边线
    - 主项 13px font-han / active 红边条 + 红字
    - sub 项 12px font-mono / fg-3
  - 右侧 `.docs`：
    - h1 36px + h-cap `REST · BEARER TOKEN · 飞书 WEBHOOK` (mono caption)
    - section（mb 56px）+ h2（22px + .han 注解 14px fg-3）
    - 段落：font-han 14px line-height 1.85，红色 `li::marker`
    - **callout 卡**：顶 2px 红 rule + cap UPPERCASE 红 + title 15px + desc 13px
    - **endpoint card**：head `bg: var(--mist)` + 方法 pill（post 绿 / get 石墨）+ mono path + 右描述 + chev；body 18 22 22 padding
    - **spec table**：4 列网格 / th UPPERCASE caption / mono code 列 / mono type 列 / center req 列
    - **code block**：bg ink + paper-white 字 + mono
    - **template list row**：grid 1fr 1fr / name + ID / 右侧展开链接

### 验收

- TOC sticky 滚动跟随
- endpoint card 折叠 / 展开
- POST 方法标签绿色 / GET 石墨灰
- callout 顶部 2px 红 rule（唯一红装饰元素之一）
- code block 黑底白字

---

## T4 — 全局清理（顺手做）

- AppShell.vue：把 `.app-main { background: #f4f4f7 }` 改为 `var(--mist)`（移除硬编码灰色）
- 3 个 view 内剩余 `var(--tp-*, #紫色fallback)` 形式残留 — 直接消费 yangli vars 不留 fallback

---

## T5 — 验收 + PROGRESS + PR

- vue-tsc 0 错误
- Vite 编译 0 错
- 浏览器手测 3 个 view：page-bar / 过滤 / 表格 / 空态 / dialog / TOC / endpoint 折叠
- grep：3 个 view 不再有 `#6c5ce7` / `#f0eeff` / `#4f3fcc`
- PROGRESS 追加 30B
- commits（每 view 一个 + global 清理 + PROGRESS）
- push + PR #7

---

## 不在本 PR 范围

- MeView / TemplatesView（→ 30C）
- DesignerView 全套（→ 30D）
- 「下载 OpenAPI」按钮的后端 spec 文件（前端只占位）

---

**末**
