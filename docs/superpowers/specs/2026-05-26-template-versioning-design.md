# 模板版本（草稿 / 发布 / 回滚 / 版本化渲染）· 设计

**日期**：2026-05-26
**Spec author**：Claude Code
**范围**：apps/api（Prisma + templates/render）+ apps/web（设计器 + 模板中心 + API 文档）
**前置状态**：项目尚未上线，仍在开发机；存量开发模板可清空

---

## 1. 背景

### 1.1 现状 —— "版本"是空壳

当前模板的"版本"概念名存实亡：

- **DB `Template` 表无任何 version 字段**：只有 `id / name / description / data(Json) / ownerId / createdAt / updatedAt`。无版本列、无历史表、无草稿/发布区分。
- **`meta.version: 1`** 在 `defaultTemplate()` 写死为 `1`，之后永不递增 —— 每次保存把整个 `data`（含 `version:1`）原样 PATCH 回去，是死字段。
- **模板中心列表里的「V1 DRAFT」是写死的字符串字面量**（`TemplatesView.vue` 内 `<span>V1 DRAFT</span>`），与 `meta.version` 无关联，所有模板都显示同样文本，具误导性。
- **渲染读"实时模板"**：render worker 直接读 `tpl.data` 当前值，不锁定快照。边改模板边被调用 → 历史渲染无法复现。
- **无"发布"概念**：设计器自动保存（debounced PATCH）直接覆盖唯一一份活模板。

### 1.2 目标

把版本做成真实能力：**一份可变草稿 + N 个不可变的已发布快照**。

- 自动保存保留为**草稿**机制。
- 设计器原「保存」按钮 → **「发布」**；发布给草稿快照分配版本号 V1 / V2 / V3…
- 状态展示：从未发布→「未发布」；已发布→「V{n}」（+ 是否有未发布改动）。
- 点击模板名（编辑器面包屑）→ **版本管理弹窗**：左侧版本列表可滚动切换查看、支持**一键回滚并发布**。
- **渲染默认用最新已发布版**；渲染接口新增可选 `version` 入参：不填=最新已发布；填了=按该版本快照渲染（**变量/字段随该版本走**）。
- 编辑器内「预览」「立即打印」渲染**草稿**（设计者发布前自测）。

---

## 2. 决策汇总（已与用户确认）

| # | 决策 | 取值 |
|---|------|------|
| D1 | 自动保存 | 保留，写 `Template.data` 草稿 |
| D2 | 「保存」按钮 | 改为「发布」，发布即快照分配版号 |
| D3 | 版本号 | 仅发布时分配，模板内自增 V1/V2/V3… |
| D4 | 状态三态 | 未发布 / V{n}·有未发布改动 / V{n}·已发布 |
| D5 | 回滚语义 | **一键回滚并发布**：回滚 Vk → 追加 V{n+1}（data=Vk），成为最新发布版 |
| D6 | "当前发布版" | 恒等于 `max(version)`，无需独立可移动指针 |
| D7 | 外部 API 渲染 | 默认最新已发布版；可传 `version`；无已发布版→400；版本不存在→404；输入按该版本 schema 校验 |
| D8 | 编辑器预览/立即打印 | 渲染草稿（`templateVersion=null`） |
| D9 | 版本弹窗入口 | 编辑器面包屑的模板名 |
| D10 | 迁移 | 纯增量 schema migration；存量开发模板一次性清空（不回填、不写进迁移文件） |

---

## 3. 详细设计

### 3.1 数据模型

```prisma
model Template {
  id                    String   @id @default(uuid())
  name                  String
  description           String?
  data                  Json     // 仍是"草稿"：autosave PATCH 写这里
  ownerId               String   @map("owner_id")
  owner                 User     @relation(fields: [ownerId], references: [id], onDelete: Cascade)
  publishedVersion      Int?     @map("published_version")        // 当前已发布版号 = max(version)；null=从未发布
  hasUnpublishedChanges Boolean  @default(false) @map("has_unpublished_changes")
  createdAt             DateTime @default(now()) @map("created_at")
  updatedAt             DateTime @updatedAt @map("updated_at")

  versions   TemplateVersion[]
  renderJobs RenderJob[]

  @@index([ownerId, updatedAt(sort: Desc)])   // 沿用现有索引（本期不新增 createdAt 索引）
  @@map("templates")
}

model TemplateVersion {
  id           String   @id @default(uuid())
  templateId   String   @map("template_id")
  template     Template @relation(fields: [templateId], references: [id], onDelete: Cascade)
  version      Int                                   // 模板内自增 1,2,3…
  data         Json                                  // 发布那一刻草稿的完整快照（canvas+elements+schema）
  publishedAt  DateTime @default(now()) @map("published_at")
  publishedBy  String?  @map("published_by")         // 发布人 userId（冗余，user 删除后仍可读）
  restoredFrom Int?     @map("restored_from")         // 回滚来源版号（"V7 ← 回滚自 V3"）

  @@unique([templateId, version])
  @@index([templateId, version(sort: Desc)])
  @@map("template_versions")
}

model RenderJob {
  // …沿用现有字段…
  templateVersion Int?  @map("template_version")      // 本次渲染锁定的版本号；null=渲染草稿（编辑器内）
}
```

- `publishedVersion` / `hasUnpublishedChanges` 是冗余字段，便于列表/状态便宜读取（前者可由 `max(version)` 推导，后者驱动徽章与发布按钮态）。
- `TemplateVersion.data` 不可变：发布后绝不修改/删除（回滚也是追加新版，不动旧版）。

### 3.2 草稿 / 发布 / 状态

- **自动保存**（不变）：debounced PATCH `/templates/:id` 写 `Template.data`，并置 `hasUnpublishedChanges=true`。
- **发布**（新）：`POST /templates/:id/publish`
  1. 读当前 `Template.data` 草稿；
  2. `version = (该模板 max(version) ?? 0) + 1`；
  3. 插入 `TemplateVersion`（data=草稿、publishedBy=当前用户、restoredFrom=null）；
  4. 更新 `Template.publishedVersion = version`、`hasUnpublishedChanges = false`；
  5. 事务内完成，避免并发发布产生重复版号（依赖 `@@unique([templateId, version])` 兜底）。
- **发布按钮态**（设计器右上）：
  - `publishedVersion==null`（未发布）→ 可用；
  - `hasUnpublishedChanges==true` → 可用；
  - 否则（草稿 == 最新发布版）→ **置灰**（避免空版本/重复版本）。
- **状态徽章**（设计器左面板 + 模板中心列表，取代写死的 "V1 DRAFT"）：
  - 未发布 → 「未发布」
  - 有改动 → 「V{n} · 有未发布改动」
  - 无改动 → 「V{n} · 已发布」

### 3.3 渲染解析（含 API `version` 入参）

**外部渲染**（`POST /api/render`、飞书 `POST /lark/print-trigger`）渲染**已发布版**：

- 入参新增可选 `version`（正整数）。
- 解析规则：
  - 不传 → `resolved = Template.publishedVersion`；若为 `null` → **400 `no_published_version`**；
  - 传了 → 查 `TemplateVersion(templateId, version)`；不存在 → **404 `template_version_not_found`**；
  - 命中 → 用该版本 `data` 快照。
- 输入 `data` 按**该版本快照内的 `schema.fields`** 校验（变量集合随版本走）。
- 入队时把 `resolved` 写进 `RenderJob.templateVersion`；worker 加载 `TemplateVersion(templateId, templateVersion).data` 渲染 → 历史渲染可复现。

**内部渲染**（编辑器「预览」「立即打印」）渲染**草稿**：

- 入队 `RenderJob.templateVersion = null`；worker 读 `Template.data`（实时草稿，符合"所见即所印"）。

**Worker 解析**（`apps/render/src/main.ts`）：
- `templateVersion != null` → 加载对应 `TemplateVersion.data`；
- `templateVersion == null` → 加载 `Template.data`（草稿）。

### 3.4 版本管理弹窗

- **入口**：编辑器面包屑的模板名（`TemplatesView.vue` editor 模式的 `.tv-bc-current`）点击打开。
- **布局**：
  - 左栏：版本列表，V{n}→V1 倒序（最新在顶），超出高度上下滚动（`ElScrollbar`）；
    - 每项：`V{n}` + 发布时间；最新发布版标「当前」；回滚版标「← 回滚自 V{k}」；
    - 顶部可含一个特殊项「草稿（有未发布改动）」当存在未发布改动时；
  - 右栏：选中版本的**只读预览**（复用渲染/画布只读渲染该快照 `data`）。
- **操作**：选中某旧版 → **「回滚并发布」**：
  - `POST /templates/:id/rollback`，body `{ version: k }`；
  - 服务端读 `TemplateVersion(id, k).data`，按发布流程追加 `V{n+1}`（data=Vk.data、restoredFrom=k）；
  - 不修改草稿 `Template.data`（如需在此基础上继续改，用户进编辑器编辑草稿再发布即可 —— 注意：回滚不改草稿，草稿仍是回滚前内容；若需要"基于该版本继续编辑"，后续可加"恢复到草稿"，本期 YAGNI）。
  - **注意一致性**：回滚后 `publishedVersion = n+1`，但 `Template.data`（草稿）未变。若此前草稿无未发布改动，则回滚后 `hasUnpublishedChanges` 应置 `true`（草稿 ≠ 最新发布版），徽章显示「V{n+1} · 有未发布改动」。

### 3.5 API 契约变更

- `POST /api/render` body 增加可选 `version?: number`（正整数）。
- `POST /lark/print-trigger` body 同样支持可选 `version?: number`。
- 新增 `POST /templates/:id/publish` → 返回新版本 `{ version, publishedAt }`。
- 新增 `POST /templates/:id/rollback` body `{ version }` → 返回新版本 `{ version, restoredFrom }`。
- 新增 `GET /templates/:id/versions` → 版本列表（`{ items: [{version, publishedAt, restoredFrom, isCurrent}], publishedVersion }`），供弹窗左栏。
- 新增 `GET /templates/:id/versions/:version` → 单版本快照（含 data），供弹窗右栏只读预览。
- `GET /templates`（列表）返回项增加 `publishedVersion` / `hasUnpublishedChanges`，供列表徽章。
- 审计（沿用 iter 32 AuditLog）：`template.publish`、`template.rollback` 记审计。

#### 3.5.1 API 文档页（`ApiView.vue` v2）必须同步的内容

文档页接口区是数据驱动的 `endpoints[]`（每个接口含 intro/headers/body/resp/callback/errors/samples 多语言）。版本化要改动以下处：

- **概览（Overview）**：补一句"渲染针对模板的**已发布版本**：默认最新已发布版，可在请求里指定 `version` 渲染历史版本"。
- **`POST /api/render` · 请求体 Body**：新增字段行
  - `version` · `number` · 可选 · "指定渲染的已发布版本号；不传=最新已发布版"
  - 同时把 `data` 行说明改为"业务字段 map，key 对应**该版本**模板 `schema.fields`"（变量随版本走）。
- **`POST /api/render` · 错误栏**：新增两条
  - `400 · no_published_version` · "该模板尚无已发布版本（请先在设计器发布）"
  - `404 · template_version_not_found` · "指定的 version 不存在或不属于该模板"
- **`POST /api/render` · 示例栏**（cURL / Node.js / Python）：至少一处示例体现可选 `version`（如注释或追加一行 `"version": 2`）。
- **`GET /api/render/:jobId` · 响应栏**：响应体补 `templateVersion` 字段（本次渲染锁定的版本号；草稿渲染为 null），便于排障/复现。
- **`POST /lark/print-trigger` · 请求体 Body**：同样新增可选 `version` 行（语义一致）。
- 其余（凭证 Tokens / 模板字段 Schemas 两个 tab）无需改动。

### 3.6 前端改动

- `stores/designer.ts`：删除死字段 `meta.version`；新增 `publish()`（调 publish 接口）、发布状态/版本号状态、`hasUnpublishedChanges` 跟踪（autosave 置 true、publish 置 false）。
- `DesignerHeader.vue`：「保存」按钮 → 「发布」（含置灰逻辑）；状态徽章显示版本/未发布。
- 设计器左面板（图中 "V1 · DRAFT SAVED" 处）：改读真实状态三态。
- `TemplatesView.vue`：列表 `<span>V1 DRAFT</span>` → 真实状态徽章（读 `publishedVersion`/`hasUnpublishedChanges`）。
- 新增版本管理弹窗组件（如 `designer/VersionDialog.vue`），由面包屑模板名触发。

### 3.7 迁移

- **Prisma migration（纯增量、可提交、任何环境安全）**：建 `template_versions` 表 + `templates.published_version` / `templates.has_unpublished_changes` + `render_jobs.template_version`。
- **存量开发数据**：一次性清空现有模板（独立 dev 清理动作，**不写进 migration 文件**，避免把破坏性 DELETE 烤进可提交迁移）。清空后零模板，新列用默认值，无需回填。
- 不违反 CLAUDE.md：不跑 `migrate reset` / `db push --accept-data-loss`，仅做增量 migration + 手动 dev 数据清理。

---

## 4. 非目标（YAGNI）

不做：版本 diff/对比、版本命名/标签/备注、分支、定时发布、跨模板版本共享、版本删除/压缩、"恢复旧版到草稿再编辑"（仅一键回滚并发布）。`meta.version` 死字段删除。

---

## 5. 测试要点

- 单元/集成（api）：publish 自增版号 + 并发发布唯一约束兜底；rollback 追加 V{n+1}=Vk 且 restoredFrom=k；render 解析（默认最新 / 指定版本 / 无发布版 400 / 版本不存在 404）；输入按对应版本 schema 校验。
- 渲染复现：发布 V1 → 改草稿发布 V2 → 用 `version=1` 渲染应得 V1 结果。
- 前端（Playwright）：发布按钮三态；面包屑打开版本弹窗、左栏滚动、选中预览、一键回滚生成新版且成为当前；列表/设计器徽章随状态变化；编辑器"立即打印"用草稿、外部 API 用已发布版。

---

## 6. 受影响文件（预估）

- `apps/api/prisma/schema.prisma`（+migration）
- `apps/api/src/templates/templates.{service,controller}.ts`（publish/rollback/versions 接口）
- `apps/api/src/render/*`（render 入参 version + 解析 + RenderJob.templateVersion）
- `apps/api/src/lark/lark-bitable.controller.ts`（webhook version 透传）
- `apps/render/src/main.ts`（worker 按 templateVersion 加载快照 / 草稿）
- `apps/web/src/stores/designer.ts`、`designer/DesignerHeader.vue`、新增 `designer/VersionDialog.vue`
- `apps/web/src/views/TemplatesView.vue`（列表徽章 + 面包屑入口）
- `apps/web/src/views/ApiView.vue`（文档页按 §3.5.1 同步：概览 / render 请求体 version / 错误栏两条 / 示例 / jobId 响应 templateVersion / lark version）
- `apps/web/src/stores/templates.ts`（列表项 publishedVersion/hasUnpublishedChanges）
