# PROGRESS.md

> 仓库当前事实进度。已交付能力 + 近期重大变更 + 后续计划。
> **变动频率**：每次迭代收尾或重要修复后追加。
> 详细协作规则见 [`AGENTS.md`](../AGENTS.md)。

**最近更新**：2026-05-26（模板版本：草稿/发布/回滚/版本化渲染）

---

## 1. 整体进度

| 阶段 | 状态 | 备注 |
|---|---|---|
| Plan 0：基础设施（monorepo / Docker / CI / 数据库） | ✅ 已完成 | iter 0 |
| Plan 1：鉴权（飞书 SSO + JWT + emergency_admin） | ✅ 已完成 | iter 17 / 18 整合 |
| Plan 2：设计器（栅格化 + 8 类元素 + 拖动 / resize / snap） | ✅ 已完成 | iter 2-15 共 14 个迭代 |
| 全局布局（AppShell + AppSidebar + 路由守卫） | ✅ 已完成 | iter 17 |
| 模板中心 inline 编辑（取消 /designer/* 独立路由） | ✅ 已完成 | iter 20 / 21 |
| Auto-save（debounced PATCH + 状态指示 + beforeunload） | ✅ 已完成 | iter 22 |
| Admin 角色 / logout 硬跳 / 401 自动 refresh / Header Hero 风格 | ✅ 已完成 | iter 23 |
| 设计器细节优化（浮动 toolbar / pan mode / snap 简化 / 打印 CSS） | ✅ 已完成 | iter 24 / 25 |
| **异步渲染服务（队列 + worker + webhook + API 文档）** | ✅ 已完成 | iter 26 |
| **飞书多维表格按钮触发渲染回写附件** | ✅ 已完成 | iter 27 |
| **飞书机器人卡片交互渲染 + API 页面模板列表** | ✅ 已完成 | iter 28 |
| **渲染日志 + API Token 管理（Bearer）** | ✅ 已完成 | iter 29 |
| **扬力品牌 UI 改造 · 30A 基础 + Sidebar** | ✅ 已完成 | iter 30A |
| **扬力品牌 UI 改造 · 30B 数据/管理页** | ✅ 已完成 | iter 30B（含 30C 全部：MeView + TemplatesView） |
| **扬力品牌 UI 改造 · 30D 设计器收敛** | ✅ 已完成 | iter 30D |
| **生产就绪三件套（Signed URL / 重试 + 限流 / Quota + 清理）** | ✅ 已完成 | iter 31 |
| **观测性 + 审计日志（Sentry / Prometheus / audit_log）** | ✅ 已完成 | iter 32（最新） |
| 部署：阿里云 ACR + ECS + GitHub Actions | 🟡 框架就绪 | iter 19，待外部条件（域名 / 备案 / 飞书应用） |
| Admin 用户管理后台（CRUD） | 🟡 仅占位页 | `apps/web/src/views/admin/UsersAdminView.vue` 已存在，后端 CRUD 未补 |
| 渲染任务历史 / 我的渲染任务 | ⏳ 待开始 | 见第 5 节 |

---

## 2. 已交付能力

### 2.1 鉴权与用户

- **飞书 SSO 登录**：`/auth/lark/start` → 飞书授权 → `/auth/lark/callback` → 写 JWT cookie；首次登录自动建用户（随机密码 + 飞书 IM 通知）
- **本地 emergency_admin 登录**：`/auth/local/login`（username + password）；首次登录强制改密
- **角色体系**：`admin` / `emergency_admin` / `user`；前两者路径权限等同
- **Token 链路**：access cookie（短） + refresh cookie（长，DB 哈希存储） + CSRF；`apiFetch` 自动 401 retry
- **Logout**：硬跳 `/login`（避免 bfcache 复活）+ 幂等清 cookie 端点
- **个人中心**：`/me` 显示当前用户 + 改密码 + 解绑飞书（已实现 80%）

### 2.2 模板中心 + 设计器

- **模板列表**：`/templates`（Hero 风格 header），inline 切到设计器（无独立路由，View Transitions 形变动画）
- **CRUD**：`POST/GET/PATCH/DELETE /api/templates`；自愈机制（残缺模板 PATCH 回写）
- **栅格化设计器**：
  - 8 类元素：text / image / barcode / qr / rect / line / table / variable-text
  - mm-anchor schema（每元素含 `anchor: {x, y, w, h}` mm）
  - 拖动 / 8 向 resize / 旋转 / 复制 / 删除 / Z 序
  - Snap 辅助线（threshold 2mm，每轴最多 1 条最近匹配）
  - 浮动工具栏：右下角 undo / redo / pan mode / zoom in / out / 单击 zoom % 编辑（25-400）
  - Pan mode：cursor 变 grab，拖动滚动 canvas
  - 拖动边缘 30px 自动滚动
  - 三态 grip：大→内部 / 小→外上 / 小贴顶→外下
  - 自定义纸张 + 常用纸张快选（A4 / A5 / A6 / 100×60 / 100×100 / 100×150）
- **属性面板**：位置 / 尺寸 / 文字 / 边框 / 内边距 / 字段绑定 / 条码格式 / 二维码内容
- **数据字段**：模板自带 schema；侧栏管理；预览时按示例值渲染
- **预览 + 打印**：`/templates?open=:id` → 预览模式 → `Ctrl+P`；@media print 隐藏 sidebar / 面包屑 / 浮动 toolbar；纸张溢出修复
- **Auto-save**：debounced PATCH（800ms）+ 状态指示器（保存中 / 已保存 / 失败重试） + beforeunload 阻止丢失；拖动期跳过避免卡顿

### 2.5 飞书多维表格按钮触发渲染回写附件（iter 27）

- **数据模型**：`lark_print_requests` 表（renderJobId 1:1 → RenderJob / appToken / tableId / recordId / statusField / attachmentField / callbackStatus / errorMsg / 时间戳）
- **API 端点**：
  - `POST /lark/print-trigger`（外部 webhook，`Public` + body 中 verificationToken 校验）：入队渲染 + 落 LarkPrintRequest + best-effort 写"处理中"
  - `POST /lark/render-callback?token=...`（worker 回调，`Public` + URL query token 校验）：完成上传 PDF + 写附件 + 状态"已完成"；失败写"失败"
- **Lark API 封装**：
  - `LarkBitableService.updateRecord` — PUT bitable record fields
  - `LarkBitableService.uploadMaterial` — 自动分片：< 20MB `upload_all`，≥ 20MB `upload_prepare / part(4MB/块) / finish`
  - 复用 `LarkImService.getTenantAccessToken`（2h 缓存）
- **架构调整**：`RenderService.enqueue` 接受 `ownerId: string | null`（lark 系统调用跳过 ownership 检查）；`lark-im.module` 合并到 `lark.module`
- **业务人员接入手册**：`examples/lark-bitable/README.md` 含建表步骤 + 自动化配置 + payload 模板 + 常见问题
- **凭证**：复用 `LARK_SSO_APP_ID/SECRET`（同 app 多权限），新增 `LARK_BITABLE_VERIFICATION_TOKEN` 仅在本地 .env

### 2.6 飞书机器人卡片交互渲染（iter 28）

- **数据模型**：`lark_bot_sessions` 表（chatId / chatType / triggerOpenId / cardMessageId / state / templateId / formData / renderJobId / errorMsg / 时间戳）
- **API 端点（全部 `@Public()`）**：
  - `POST /lark/bot/event`：飞书事件订阅入口，含 URL challenge + verification token + `im.message.receive_v1` 解析 + 群 @ 检测 + 私聊触发 + re-@ 去重
  - `POST /lark/bot/card-action`：卡片交互回调，状态机分派（template_selected → fill_fields；field_change → 累积 formData；submit_render → 必填校验 + 调 render.enqueue）
  - `POST /lark/bot/render-callback?token=...`：worker 完成后上传 PDF 到飞书 IM + 发文件消息 + @ 触发者 + PATCH 卡片完成态
- **服务封装** `LarkBotService`：
  - `sendCard` / `updateCard` / `uploadIMFile` / `sendTextWithMention` / `sendFileMessage`
- **卡片构造** `LarkBotCards`（纯函数 + 11 单测）：
  - `buildSelectTemplateCard`（选模板下拉）
  - `buildFieldFormCard`（按 schema.fields 动态生成 input/select/datepicker）
  - `buildRenderingCard`（渲染中）
  - `buildResultCard`（完成 / 失败）
- **业务接入手册**：`examples/lark-bot/README.md`（飞书后台 6 步配置 + 使用 + 常见问题）

### 2.5 API 页面模板列表（iter 28）

- 路由 `/api-docs` → `/api`，sidebar "API 说明" → "API"（旧 URL 自动 redirect）
- 顶部"通用调用文档"默认收起（curl / JS / Python）
- 中部模板列表表格：模板名 + ID（带复制图标）+ 通用入参 + 自定义字段（lazy fetch schema.fields）
- 行展开看完整 schema JSON

### 2.7 渲染日志（iter 29）

- 新路由 `/logs` + sidebar 入口「渲染日志」
- 后端 `GET /api/render/jobs`：findMany include template + larkBotSession + larkPrintRequest，
  后处理推断 source = `bot` / `bitable` / `api`
- 权限：admin / emergency_admin 看全部；普通用户按 `template.ownerId` 过滤
- 过滤：状态 / 来源 / 模板名（ILIKE 模糊）；分页 20/页（最大 100）
- 详情 dialog：Job ID 含复制 / 元信息 grid / 完整 data JSON / PDF/PNG 下载 / 错误信息
- 状态徽标着色 (done 绿 / failed 红 / processing 黄)；来源徽标 (bot 蓝 / bitable 橙 / api 紫)

### 2.8 API Token 管理（iter 29）

- 新表 `api_tokens`：userId / name / tokenHash (SHA-256 unique) / prefix (`tpkn_` + 8 字符) /
  lastUsedAt / revokedAt / createdAt
- 新端点：`GET / POST / DELETE /users/me/api-tokens(/:id)` — 管理端点仅 JWT cookie 鉴权
- 新 guard `ApiAuthGuard`：双栈回退（Bearer `tpkn_xxx` → JWT cookie + CSRF），应用到 `/api/render`
- 新视图 `/me/api-tokens` + sidebar「API 凭证」：列表 / 创建 dialog / 一次性明文展示 / 吊销
- 浏览器场景仍兼容 cookie（设计器调 /api/render 不受影响）

### 2.13 观测性 + 审计日志（iter 32）

为 2000 人集团生产部署补齐"出问题能知道、合规能回答"的能力。

- **T1 审计日志**：新表 `audit_log`（actor + action + resource + details + ip + ua）+
  `AuditLogService` fire-and-forget + `@Global AuditModule`。接入 10 个关键 action：
  login.local / logout / profile.update / password.set/change / lark.unbind /
  template.create/update/delete / render.enqueue / token.create/revoke。
  失败不影响业务（Logger.warn）。

- **T1+ 审计日志查询后台**：`AuditLogService.list()` + `distinctActions()`，
  `GET /audit-logs`（分页 + action / actorId / resourceType / resourceId / 日期范围过滤）
  与 `GET /audit-logs/actions`（去重 action 下拉），`@Roles('admin','emergency_admin')` 限制。
  前端 `views/admin/AuditLogView.vue`（筛选 + 分页 + 详情弹窗 + 复制），
  路由 `/admin/audit` + Sidebar「审计日志」入口（仅 admin 可见）。

- **T2 Sentry 错误追踪**：`@sentry/node` v8 装入 api 端。`instrument.ts` 在所有
  import 之前 init（v8 要求），SENTRY_DSN 为空 = noop。
  `GlobalExceptionFilter` 接 Sentry：5xx + 未知错误自动 captureException +
  上下文（user / request / ip）。`beforeSend` 过滤 4xx 预期错误。
  前端 Sentry（@sentry/vue）留 iter 33 followup。

- **T3 Prometheus /metrics**：`prom-client` v15 + `MetricsModule @Global`。
  端点 `GET /metrics` @Public @SkipThrottle，返 Prometheus exposition 文本。
  自定义业务指标：
  · `tp_render_jobs_total{status,source}` — RenderService.enqueue 时 +1
  · `tp_render_quota_exceeded_total` — quota 超限时 +1
  · `tp_http_*` — 占位（express middleware 接入留 followup）
  + Node defaultMetrics（process_cpu / heap / event_loop / GC）

- **T4 前端 cleanedAt 收尾**（iter 31 T5 配套）：
  RenderService.get/listJobs 返字段加 `cleanedAt: Date | null`。
  `RenderLogsView`：
  · 列表操作列 cleanedAt != null → 隐藏「下载 PDF」+ 显示「已清理」mono outline pill
  · 详情 dialog 输出 section cleanedAt 时显示 mist 卡片 "已于 X 自动清理"
  · 否则原下载按钮

新增 env：`SENTRY_DSN` / `SENTRY_TRACES_SAMPLE_RATE` / `APP_VERSION`。

DB migration：`add_audit_log`（actor_id / action / resource_type / resource_id /
details / ip / ua / created_at + 3 索引）。

### 2.12 生产就绪三件套（iter 31）

为 2000 人集团生产部署解决 3 个 blocker：

- **T1 Signed URL（合规红线）**：`/uploads/render/<id>.pdf` 加 HMAC token + 24h 过期。
  · `FileSigService.sign/verify/signUrl` — `<hex hmac>.<expiryUnix>` token
  · `SignedUploadsController` 替代 `ServeStaticModule` 服务 render 输出，
    token 校验失败 401，路径穿越 / 文件不存在 404
  · `RenderService.get/listJobs` 返 URL 前实时签名（DB 仍存原始路径，
    旧数据天然兼容 + TTL 短不会因缓存 stale）
  · `apps/render/src/file-sig.ts` 与 api 端共享 HMAC，worker 给外部
    callbackUrl 推送 PDF/PNG URL 时也带 token
  · 单测 11/11 PASS（篡改 / 过期 / 路径穿越全部拒绝）

- **T2 渲染失败重试 + 错误分类**：bullmq attempts: 3 + exponential backoff（2s/4s/8s）。
  · template_not_found / job not found → `UnrecoverableError` 跳过剩余 attempts
  · 其他 renderer 错误（Puppeteer crash / 字体抖动 / 网络）默认 transient，自动重试
  · `markFailed` 仅最后一次 attempt 调用，避免 retry 期间 status 反复闪烁
  · DB 加 `attempts_made INT DEFAULT 1` 跟踪重试次数

- **T3 API rate limit**：`@nestjs/throttler` 全局 60 req/min/user，
  POST /api/render override 至 30 req/min（可 `RENDER_RATE_LIMIT_PER_MIN` 覆盖）。
  · `UserThrottlerGuard` override getTracker：优先 `user:<sub>`，fallback `ip:`
  · `SignedUploadsController` 加 `@SkipThrottle()`（已由 token 限流）
  · 429 + Retry-After header（throttler 默认）
  · 验收：连续 70 次 healthz → 60 个 200 + 10 个 429（精确）

- **T4 渲染 quota**：单用户日上限 200（可 `RENDER_QUOTA_PER_USER_DAILY` 覆盖）。
  · `RenderService.checkDailyQuota`：COUNT(render_jobs WHERE template.ownerId AND
    createdAt >= 当日 00:00) 超 limit 抛 HttpException(429)
  · body 含 `{ code: 'QUOTA_EXCEEDED', used, limit, resetAt }`
  · Lark webhook（ownerId=null）跳过此检查

- **T5 自动清理 cron**：`@nestjs/schedule` `@Cron(EVERY_DAY_AT_3AM)` 触发
  `RenderCleanupService.cleanupOldOutputs`。
  · 查 createdAt < N 天 + cleanedAt IS NULL + status in (done/failed)
  · 对 pdfUrl / pngUrl unlink 物理文件，ENOENT 视为已清
  · DB updateMany SET cleanedAt = NOW(), pdfUrl/pngUrl = NULL
  · 保留 render_jobs DB 记录用于审计
  · `RENDER_CLEANUP_DAYS=30` 默认（0 关闭）

新增 env：`FILE_SIG_TTL_SEC` / `RENDER_QUOTA_PER_USER_DAILY` /
`RENDER_RATE_LIMIT_PER_MIN` / `RENDER_CLEANUP_DAYS`。

DB migration：`add_render_attempts_and_cleanup`（attempts_made + cleaned_at +
索引 (cleaned_at, created_at)）。

### 2.11 扬力品牌 UI 改造 · 30D 设计器收敛（iter 30D）

完成设计器整套的扬力品牌化（DesignerView + 22 子组件 + designer.css，
共 ~4500 行），按 brief §5.3-5.5 与 target-mockup.html 对齐：

- **T1 token 全量收敛**：sed 一次性替换 designer/*.vue 与 designer.css
  共 202 处 `var(--tp-*)` 引用为直接 yangli vars / 字面色，删除 30A
  引入的兼容映射 :root 块（38 行）。视觉零变化（数值与映射等价），
  后续微调可直接基于 yangli 体系。
- **T2 画布**：紫色圆点 16px → stone rgba(89,87,89,0.18) 12px tile；
  A4 纸 3 层 box-shadow → 1px stone 描边 + 无 shadow（扁平）；
  拖拽 grid 紫 → stone；滚动条 thumb 紫 → stone graphite。
- **T3 浮岛**（CanvasFloatingToolbar）：胶囊 999px + box-shadow →
  radius 4 + 1px stone + 无 shadow；按钮 32×32 圆 → 28×28 radius 1，
  default fg-2 / hover mist+ink / active ink+paper；缩放数字 mono。
- **T4 ElementLibrary** 分组标题 Eyebrow 模式：中文 + 英文 + 1px stone
  延展 rule (\"文字 · Text\" / \"图形 · Shapes\" / \"数据 · Data\")。
- **T5 CanvasElementsList** 空态：纯文字 → 1px dashed stone 框 + iron
  文字（brief §5.3）；清空按钮 hover 旧红 → yangli-red。
- **T6 FieldManager** (brief §5.5)：
  · 头部 11 UPPERCASE → .fm-head 14 semibold + mono caption
    \"N DECLARED · 共 N 个\" + 右上 28 outline + 按钮
  · 搜索框 6 radius graphite → 2 radius stone + 嵌入放大镜 + focus red
  · 空态 → UPPERCASE eyebrow + 中文 + mono \"VAR · {{ NAME }}\"
  · field-card 灰底紫 hover → paper + stone / graphite hover；bound
    硬编码绿 → rgba(15,140,90) 软调
- **T7 PropertyPanel**（与 FieldManager 对称）：
  · .pp-head 14 semibold + mono \"PROPERTIES · 已选 N 个\"
  · 空态卡 mist + 1px stone + eyebrow + 中文 msg
- **T8 残留紫红清扫**：CanvasElement is-selected 移除 16px 紫光环（保留
  inset 红描边）；3 处旧 danger 红 #d94f4f → var(--yangli-red)

至此 designer 紫色 / 旧红硬编码完全清零（grep 验证 = 0）。

### 2.10 扬力品牌 UI 改造 · 30B 数据/管理页（iter 30B）

按 `handoff/target-*.html` 像素对齐重写 3 个 view 的模板 + 样式（保留所有 script 逻辑）：

- **`RenderLogsView.vue`**（`/logs`）：
  - 顶部 `.page-bar`（icon + title + mono caption `RENDER · JOB HISTORY` + 刷新按钮）
  - 过滤区卡片：3 个 `.field`（状态 / 来源 / 模板搜索）+ 重置 / 查询按钮
  - 结果头：h2 + mono count `N–M OF TOTAL` + 1px 横线 rule
  - `.log` table：11px UPPERCASE 表头 / 14px 行 / hover bg mist / mono Job ID & 时间 / `.pill` 状态徽标（ok / warn / danger / idle）
  - 详情 dialog 重写为 grid 结构 + 黑底白字 code-block
- **`ApiTokensView.vue`**（`/me/api-tokens`）：
  - `.page-bar` 含红色「创建 Token」CTA
  - `.intro` 段（max-width 760）
  - `.tokens` table：name 加粗 / prefix mono / `.pill` 状态 / 红色下划线「立即吊销」
  - 创建 dialog + 一次性明文 dialog 改用 yangli 字体 + 暗底明文显示
- **`ApiView.vue`**（`/api`）：详见 iter 32 v2 重构（顶部 3 tab + 接口手风琴），下方 3 节"近期变更"记录
- 全局：`AppShell.app-main` 背景 `#f4f4f7` → `var(--mist)`

3 个 view 不再使用 `var(--tp-*, #紫色fallback)` 死代码形式，全部直接消费 yangli vars。

### 2.9 扬力品牌 UI 改造 · 30A 基础 + Sidebar（iter 30A）

- 引入品牌办公室交付的设计 token：`apps/web/src/styles/yangli/colors_and_type.css` + `app-shell.css`
  - 颜色：`--yangli-red #D32D27` / `--ink #1C1C1C` / `--yangli-graphite #595759` / `--mist #F4F2EF`
    / `--stone #DCD8D2` / `--iron #8A8A8C` / `--paper-white`
  - 字体：Geist (Latin) + Noto Sans SC (Han, drop-in for HarmonyOS Sans SC) + JetBrains Mono
  - 圆角：`--radius-1 2px` / `--radius-2 4px` / `--radius-3 8px` / `--radius-pill 999px`
  - 阴影：默认 `--shadow-0 none`（扁平品牌）
- 主版 LOGO PNG → `apps/web/public/yangli-logo-master.png`
- `designer.css` 顶部 `--tp-*` 命名空间整体映射到 yangli vars — 全应用一次性从紫→红 / 大圆角→方正 / 软阴影→扁平，所有现有视图无需逐一改 token
- `AppSidebar.vue` 按 `app-shell.css` 规范重做：
  - 顶部 brand-lockup：LOGO 18px 高 + 1px 竖线 + `var(--font-han)` "模板打印" 标题
  - active 状态：左侧 2px `--yangli-red` 边条 + 红字 + 红图标（去除紫色填充背景）
  - 用户区：方形 28px `--ink` 底白字 monogram + 用户名 + ghost 退出按钮（去除部门 / 角色行）
  - 分组小标题："Workspace · 工作区" / "Account · 账号" / "Integration · 集成" / "Admin · 管理"
  - 所有图标 Lucide stroke-width 1.5
- 5 视图（TemplatesView / RenderLogsView / ApiTokensView / ApiView / MeView）布局未动，但视觉已全面去紫化；目标稿像素对齐留到 30B / 30C / 30D

### 2.3 异步渲染服务（iter 26）

- **数据模型**：`render_jobs` 表（id / templateId / data / formats / status / pdfUrl / pngUrl / errorMsg / callbackUrl / callbackStatus / 时间戳）
- **API 端点**：
  - `POST /api/render`：入队（创建 RenderJob + 推 bullmq）→ 返回 `{ jobId, status: 'pending' }`
  - `GET /api/render/:jobId`：状态查询 → 返回 `{ status, pdfUrl, pngUrl, errorMsg }`
- **Headless 渲染页**：`/print-headless/:id`（`fullscreen: true`，无需鉴权），等待 `window.__renderInput` 注入后渲染并设 `window.__renderReady = true`
- **Render worker**：
  - `apps/render/src/main.ts`：bullmq Worker 消费 `'render'` 队列
  - `puppeteer-pool.ts`：multi-browser × multi-page 池（`RENDER_BROWSERS × RENDER_PAGES_PER_BROWSER`）
  - `renderer.ts`：`page.goto` → `page.evaluate` 注入 → 等 ready → `page.pdf` + `page.screenshot`
  - 输出落 `storage/uploads/render/{jobId}.pdf` / `.png`
- **Webhook 回调**：完成/失败均 POST `callbackUrl`（payload 含 `jobId / status / pdfUrl / pngUrl / errorMsg`），写回 `callbackStatus`
- **调用文档**：`/api-docs` 路由（`ApiDocsView.vue`）— tab 切换 curl / JS / Python 示例 + webhook payload 说明

### 2.4 部署与运维（框架）

- **本地栈**：`docker-compose.dev.yml`（postgres:16-alpine / redis:7-alpine / api / web / render，全部 healthcheck）
- **生产栈**：`docker-compose.prod.yml`（待外部条件 ready 后实测）
- **CI/CD**：`.github/workflows/` 三条
  - `ci.yml`：PR 跑 lint + typecheck + test + Docker build
  - `deploy.yml`：push to main → 推 ACR → SSH ECS 拉新镜像 + restart
  - `release.yml`：tag 触发版本归档
- **Dockerfile**：api / web / render（dev + prod 分离；render 用 Alpine + `chromium-browser` 解决国内 apt mirror DNS 不通）
- **Nginx 反代**：`docker/nginx/nginx.conf` + `web-nginx.conf`

---

## 3. 近期变更

> 按时间倒序，最近 ~15 次重大变更。详细 commit 见 `git log --oneline`。

### 2026-05-26

- **模板版本系统：草稿 / 发布 / 回滚 / 版本化渲染**（spec+plan：`docs/superpowers/{specs,plans}/2026-05-26-template-versioning*`）
  - 模型：一份可变草稿（`Template.data`，autosave PATCH）+ N 个不可变已发布快照（新表 `TemplateVersion`：
    templateId/version/data/publishedAt/publishedBy/restoredFrom，`@@unique([templateId,version])`）。
    "当前已发布版" = `max(version)`，冗余存 `Template.publishedVersion`；`Template.hasUnpublishedChanges`
    标记草稿是否偏离已发布版。`RenderJob.templateVersion` 锁定本次渲染的版本。纯增量迁移，存量 dev 模板已清空。
  - 发布/版本接口（`templates.service/controller`）：`POST /templates/:id/publish`（草稿快照成自增版本）、
    `GET /templates/:id/versions`、`GET /templates/:id/versions/:version`、`POST /templates/:id/rollback`
    （一键回滚 Vk → 追加 V(n+1)，restoredFrom=k）；publish/rollback 记审计；`update()` data 变更置
    `hasUnpublishedChanges=true`；`list()` 返回版本字段。
  - 版本化渲染（`render.service` + `apps/render` worker）：`POST /api/render` 与飞书 `print-trigger` 新增可选
    `version`；不传=最新已发布版（无则 **400 no_published_version**），传了校验存在（否则 **404
    template_version_not_found**）；解析出的版本号落 `RenderJob.templateVersion`，worker 据此加载对应
    `TemplateVersion` 快照渲染（历史可复现）。编辑器「预览/立即打印」是客户端 `window.print()`，渲染草稿、不受影响。
  - 前端：设计器「保存」按钮 → **「发布」**（草稿==已发布版时置灰）；状态徽章三态（未发布 / V{n}·有未发布改动 /
    V{n}·已发布），模板中心列表写死的 "V1 DRAFT" 改真实徽章；面包屑模板名点击打开**版本管理弹窗**
    （`designer/VersionDialog.vue`：左侧版本列表可滚动、右侧只读快照预览复用 `TemplateRenderer`、一键回滚并发布）；
    API 文档页 `ApiView` 同步 version 入参 / 错误码 / `jobId` 响应 templateVersion。`meta.version` 保留作结构标记。
  - 验证：API 级 publish 自增/versions/rollback V(n+1)=Vk/render 默认+指定+400+404+落 templateVersion+完整模板
    渲染 done；Playwright — 发布按钮三态、列表徽章、面包屑弹窗版本列表+预览+回滚（V2,V1→回滚 V1→V3 当前）；
    前后端 typecheck 通过。
- **模板中心默认排序改为「创建时间·最新在前」（修复保存后列表重排）**
  - 现象：默认排序是「最近编辑」(`updatedAt desc`)，每次保存模板会 bump `updatedAt`，
    返回列表（`reloadActive` 重新拉取）时该模板跳到顶部 → 用户每次保存都看到列表重排
  - 改动：后端 `TemplatesService.list` sort 新增 `'created'`（`createdAt desc`），controller
    zod enum 加 `'created'` 且**默认值从 `updated` 改为 `created`**；前端 store/视图 sort 类型
    加 `'created'`，`sortBy` 默认 `'created'`，下拉框新增「创建时间」选项（「最近编辑」「名称 A→Z」保留）
  - 稳定性：三种排序均加 `id` 二级排序键，避免同毫秒/同名记录顺序漂移
  - 「最近编辑」红框标识不受影响：`refreshRecentId` 独立查询 `sort=updated&limit=1`，仍精确
    标记最近保存的那张（即便它在列表里不挪位）
  - 验证：API 级 — 默认 createdAt desc；PATCH 某模板 bump updatedAt 后 created-sort 顺序**不变**，
    而 updated-sort 仍把它排首（红框仍跟踪）；浏览器 — 下拉默认「创建时间」、open→return 顺序一致；
    前后端 typecheck 通过
- **404 页品牌叙事改造（`errors/NotFoundView.vue`）——"打印失败"概念**
  - 从"灰 404 + 蓝按钮"换成品牌空态：3 行 grid（64 顶栏 + 1fr 主体 + 80 底栏）+ mist 底
    + 14px 极淡圆点底纹；顶栏品牌锁定 + 右上 mono 版本戳 + 2px×96px 红签名线；底栏 mono
    链接 + `REQ · {id}`（无则省略）+ © 版权
  - 左栏几何："模板叠纸"——底层 #2A2A2C(-5°)/中层红(2°,5s 浮动)/顶层白纸(-8°)，白纸内
    正常行 + 灰行 + 「打印失败」虚线行（repeating-linear-gradient）混排，右上盖一枚 VOID
    双线红印章（600ms 从 -30°/scale2.5 弹入 -12°），点缀红方块 pulse + stone 方框 24s 慢转
  - 右栏编辑级文案：mono eyebrow（前置 36px 红线）+ 巨号 `4 □ 4`（144px mono，中间 0 换 96×96
    红方块 + 白边小装饰）+ CN/EN 双标题 + body 文 + 请求收据卡（左 2px 红边条 / URL 标签 /
    实际路径 ellipsis / 红 `HTTP 404`）+ 双按钮（红 primary 箭头 hover 右移 / outline secondary hover 反白）
  - 行为：路径占位读 `window.location.pathname`；请求 ID 尽力读后端 `X-Request-Id` 响应头，
    没有就省略；「回到模板中心」直链 `/templates`，「返回上一页」`history.back()` 无历史降级首页
  - **router**：catch-all `/:pathMatch(.*)*` 从 `redirect:'/404'` 改为直接渲染 NotFoundView，
    保留用户输入的原始 URL（否则 pathname 永远是 /404，收据卡无法显示真实路径）
  - 全程纯 CSS `@keyframes` 动画无 JS 依赖、无 box-shadow（VOID 用半透明白底）、禁蓝、禁居中孤字
  - **抽出共享骨架 `errors/ErrorStage.vue`**（props：numLeft/numRight/stamp/eyebrow/titleCn/
    titleEn/bodyLines/status），404 / 403 / 500 三页共用同一版面，仅数字 / 印章字 / 文案 / HTTP
    code 不同：404=4□4·VOID、403=4□3·DENIED「你没有这台机器的权限」、500=5□0·ERROR
    「这一版没印出来」；新增 `/500` 路由 + `ServerErrorView.vue`，403 改用同款模版（原灰字+按钮废弃）
  - **修复顶栏空缺**：品牌文字原用 `class="app"`，撞上全局 `.app{display:grid;...min-height:100vh}`
    容器类 → lockup 被撑成 364×900 溢出、顶栏看着缺一块。改用约定的 `.app-name` 类后顶栏恢复
    满宽白条（lockup 177×21 正常居中）
  - 印章框改 `min-width:110 + padding` 以容纳 DENIED/ERROR 等更长印章字
  - 验证：Playwright — 三页 num/stamp/status/title 正确、顶栏满宽 lockup 归位、bogus URL 保留、
    收据真实路径、primary 红 `rgb(211,45,39)`、typecheck 通过
- **API 页 v2 重构（`ApiView.vue`）——消除"一屏喷射所有信息"**
  - 顶部拆 3 个 tab（page-bar 下方，padding 0 32px，下边线 1px stone，每个 44px 高，
    active 态 2px 红下边线 + ink 字 + mono 副标转红，禁蓝/禁胶囊）：
    **凭证 Tokens**（SECURITY 警告 + token 表 + 创建/吊销 dialog）/ **文档 Docs**（默认）/
    **模板字段 Schemas**（模板列表 + `schema.fields` 展开）
  - 文档 tab：左 220px 粘性 TOC（`On this page`）+ 右内容（max-width 880）；section 头统一
    `[01 mono 红] [8px 红方块] [han 18px] [mono EN] [延展线]`
  - 鉴权大瘦身：原 METHOD 1+2 两个 callout（~150 行）→ 一个紧凑 callout（mist 底 + 左 2px 红边条 +
    mono `Bearer Token` eyebrow + 一句话 + ink 底代码块）；"飞书 webhook 怎么做？"收进默认折叠
    `<details>`（summary 前置红 ＋/－）
  - 接口列表改**手风琴**（`.endpoints` 描边 + radius 4）：每行 `.ep-head`
    `[METHOD chip] [mono path] [han 描述] [chevron]`；**单开模式**（默认只展开 POST /api/render，
    展开第二个自动收起其它），chevron 展开 180° 旋转并转红
  - 接口展开内容用**内部 sub-tabs**（请求 / 响应 / 回调 / 错误 / 示例），一次只显示一栏：
    字段表紧凑化（padding 10/12、12.5px、必/否 用红实心 ● / 灰空 ○ 取代"是/否"）；
    示例栏单个代码块带 cURL / Node.js / Python 顶部切换 + 右上 COPY（暗底，hover 0.14 白）；
    GET 无回调栏、lark 无回调栏（按数据驱动只渲染存在的栏）
  - 错误码不再做顶层 section，挪进各接口"错误"sub-tab；文案瘦身（lede 仅
    `REST · BEARER TOKEN · 飞书 WEBHOOK` 一行 mono，概览压成一句，删除过门语）
  - page-bar 顶部加 2px×96px 红实线签名（与审计/模板中心一致）
  - 数据驱动：`endpoints[]` 结构化（含 headers/body/resp/callback/errors/samples 多语言），
    sub-tab 与代码语言均按存在性渲染；`?to=tokens`（/me/api-tokens 重定向）映射到凭证 tab
  - 验证：Playwright — 默认文档 tab、3 接口仅 1 展开、单开切换、示例 3 语言切换、tab 切换
    显隐、page-bar 红线 96px、typecheck 通过

### 2026-05-25

- **本地 Docker 端口避让修复**
  - Windows `netsh interface ipv4 show excludedportrange protocol=tcp` 可能把 `6379` 纳入保留端口段，
    导致 Redis 容器启动时报 `ports are not available`。`docker-compose.dev.yml` 将 Redis 宿主机映射改为
    `6479:6379`，容器内 `api` / `render` 仍连 `redis://redis:6379`。
  - 同步修正 `.env.example`：宿主机 `DATABASE_URL` 使用 dev compose 已配置的 `localhost:6432`，
    `REDIS_URL` 使用 `localhost:6479`；README / deployment 文档补充本地端口约定。
- **模板中心两处修复**
  - 「最近编辑」红框：原按当前页/已加载项算 max(updatedAt) → 每页都各高亮一张。改为
    查询全局（当前筛选下）`sort=updated&limit=1` 的唯一 id（`recentId` 由 computed 改 ref），
    全列表只标识一张、且为最近保存的那张；增删改 / 返回列表后刷新
  - 无限滚动回顶：`loadListMore` 经 `fetchSlice` 切了全局 `loading`，触发模板 `v-if` 卸载
    重建 `ElScrollbar` → 滚动条归 0。给 `fetchSlice` 加 `{silent}` 选项，加载下一批与取
    最近编辑标识均静默（不切 loading），滚动位置保留
- **模板中心：服务端分页（网格）+ 无限滚动（列表）+ 全站统一翻页组件**
  - 后端：`TemplatesService.list` 改为偏移分页 `{offset,limit,search,sort}` →
    `{items,total,offset,limit}`，搜索（name contains / id）+ 排序下沉 DB，复用
    `(owner_id, updated_at DESC)` 索引；Controller zod 校验（limit 上限 100，默认 15）。
    从"一次性返回全量"改为按需取一段，模板上千也只查一段
  - store：`fetchSlice({offset,limit,...})` 纯取数（不持有页码），视图编排
  - 新组件 `components/BrandPagination.vue`：包装 ElPagination + 「首页/末页」直达按钮
    + 主色覆盖扬力红（禁默认蓝）+ 单页自动隐藏；**审计日志 / 渲染日志 / 模板中心三处
    统一复用**，修正原审计页分页蓝色 + 风格不统一
  - `TemplatesView` 网格：新建卡固定第一排第一个（仅第 1 页）；第 1 页 = 新建 + 9 模板，
    第 2 页起每页 10、无新建卡（非均匀分页，`BrandPagination` 传 `page-count`）
  - `TemplatesView` 列表：改为**无限滚动**（无分页）——新建卡固定第一个，首批 14 模板
    （+新建=15 格），滚到接近底部（96px）自动拉下一批 15 个，直到加载完显示「已到底」
  - `ApiView`：模板参考列表适配（`?limit=100` 的 `.items`）
  - 验证：Playwright e2e — 网格新建卡居首、`1–9 OF 61`、第 2 页无新建卡、首/末页跳转
    + 边界禁用、激活页码红 `rgb(211,45,39)`；列表初始 14 行→滚动加载至 61 行→「已到底」，
    批次 offset 14/29/44/59 正确
- **扬力品牌 UI 改造：审计日志页（按 `handoff/target-audit.html`）**
  - 新组件 `components/BrandDatePicker.vue`：替代原生 datetime-local 的自定义日期时间
    选择器（无新依赖）。触发器 38px + lucide calendar 图标；popover 320px + 顶部 2px
    红线 + 月份导航 + 周一为首列 6×7 网格（今天 inset 红下划线 / 选中 ink 实色底）+
    时分输入 + 清除/今天/确定。v-model 发本地 `YYYY-MM-DDTHH:mm`，与父级
    `new Date().toISOString()` 兼容
  - `AuditLogView.vue`：① 起/止改用 BrandDatePicker ② page-bar 加 2px×96px 红签名线
    ③ 结果区改 Section 头 `[mono 01][红方块][事件列表][mono N OF M · EVENTS][延展线]`
    ④ 表格简化——操作者/资源只显名称（系统显「— · 系统」灰字、资源显小写英文），
    UUID 仅在详情 dialog 展开 ⑤ 动作徽章三档配色（绿登录·创建 / 琥珀登出·撤销·删除 /
    灰模板修改·一般），前置 5px 同色圆点
  - 验证：vue-tsc 通过；Playwright e2e 实测——徽章三色 + 圆点、page-bar 红线、
    datepicker 选日/时分/确定回填、查询带 `from=...ISO`、清除复位均正常
  - 注：「操作者」筛选仍按 actorId(UUID) 精确过滤（后端未提供用户名搜索，超出本次范围）
- **扬力品牌 UI 改造：登录页重构**
  - `LoginView.vue` 全量重写为左品牌面板 + 右表单面板布局，按 `handoff/target-login.html`
    高保真稿落地（品牌锁定 + 几何动效 + 月渲染量/P50/成功率统计 + 双语排版 +
    浮动 label 输入 + 保持登录 + 飞书登录 + 页脚链接）
  - 命名空间 `tp-l-*` 隔离全局样式；颜色/间距/字体全部消费设计 token（无紫色、
    无装饰阴影、无 8px+ 圆角、无 emoji）；引用 `public/yangli-logo-master.png`
  - 登录逻辑（本地登录 / 飞书 SSO / continue 跳转 / 错误提示）完整保留不变
  - followup：`保持登录 30 天` 复选框与 CN/EN 切换目前为视觉态，待接后端 session
    时长 / i18n 文案切换
- **iter 32 T1+：审计日志查询后台**
  - 后端：`AuditLogService.list()`（分页 + 多字段 + 日期范围过滤）/ `distinctActions()`；
    新 `AuditLogController` 暴露 `GET /audit-logs` + `GET /audit-logs/actions`，
    `@Roles('admin','emergency_admin')` 限制；`AuditModule` 注册 controller
  - 前端：`views/admin/AuditLogView.vue`（筛选 + 分页 + 详情弹窗 + 复制）；
    路由 `/admin/audit`（adminOnly）+ Sidebar「审计日志」入口
  - 验证：docker 栈 e2e — admin 登录后 `/audit-logs` 返 31 条降序、action 筛选生效、
    `/audit-logs/actions` 去重正确

### 2026-05-24

- **iter 28：飞书机器人卡片交互 + API 页面模板列表**
  - DB：`lark_bot_sessions` 表 + Prisma migration `add_lark_bot_sessions`
  - `LarkBotService`：sendCard / updateCard / uploadIMFile / sendTextWithMention / sendFileMessage（7 单测）
  - `LarkBotCards`：4 类卡片纯函数构造（11 单测）
  - `LarkBotController`：3 端点完整链路（event / card-action / render-callback）
  - re-@ 静默忽略减刷屏 + 减服务器负担
  - `/api-docs` → `/api`，模板列表纯展示（无 JSON 生成器）
  - `examples/lark-bot/README.md` 业务接入手册
- **iter 27：飞书多维表格按钮触发渲染回写附件**
  - DB：`lark_print_requests` 表 + Prisma migration `add_lark_print_requests`
  - Service：`LarkBitableService`（updateRecord + uploadMaterial 含分片，6 单测全过 nock mock 飞书）
  - Controller：`/lark/print-trigger` + `/lark/render-callback`，双重 verification token 校验
  - 架构：`enqueue(ownerId | null, ...)` 支持系统调用；`lark-im.module → lark.module` 合并
  - 文档：`docs/deployment.md` 飞书章节 + `examples/lark-bitable/README.md` 业务接入手册
  - 凭证：复用 `LARK_SSO_APP_ID/SECRET` + 新增 `LARK_BITABLE_VERIFICATION_TOKEN` + `API_INTERNAL_BASE`
- **附带修**：jest test 加 `--runInBand` 修预存的 e2e DB 共享并行竞态（多 suite 跑 deleteMany 互相删用户）

### 2026-05-23

- **iter 26 E2E smoke 验证 + RAF bug 修复** ✅
  - 用 emergency_admin 走完整链路：login → list templates → POST /render → poll → 下载 PDF + PNG，三次连测稳定 ~1.2s/任务
  - **发现真 bug**：`PrintHeadlessView` 用 `requestAnimationFrame` 双 tick 设 `__renderReady`，在 puppeteer headless page 不活跃时 RAF 会被推迟/不调度，导致 worker 30s 超时
  - **修复**：`apps/web/src/views/PrintHeadlessView.vue` 改用 `nextTick + setTimeout(50ms)`
  - **额外**：`apps/render/src/renderer.ts` 新增 `page.console` / `page.pageerror` listener（仅 error/warning），生产排障可见
- **iter 26：异步渲染服务上线**
  - DB：`render_jobs` 表 + Prisma migration `add_render_jobs`
  - API：`POST/GET /api/render` 端点 + Zod 校验
  - Web：`/print-headless/:id` 路由 + ApiDocsView 调用文档
  - Render worker：实际 puppeteer 渲染 + webhook 回调 + storage 落地
  - 适应性：新增 `docker/render.Dockerfile.dev`（Alpine + chromium-browser）
- **iter 25：设计器细节优化**
  - 浮动 toolbar 移到非滚动 host 内 + safe center 修水平 pan + zoom label 单击编辑
  - 去掉 ResizeObserver 自动 fit（zoom > 1 时滚动条出现会强行 fit 回去）
  - Snap 辅助线 threshold 5→2mm + 每轴最多 1 条最近匹配
  - 全局 @media print 隐藏 AppSidebar / 面包屑 / 浮动 toolbar
  - Esc 取消时先重置 inputValue 避免被 blur-commit 覆盖
  - 打印重置 `.tp-canvas-host`（host wrapper 在 print 下需还原为静态流）
- **iter 24：拖动 / 上传 / 鉴权**
  - Auto-save deep watch 跳过拖动期，避免每个 pointermove 触发整树遍历
  - 上传：去掉 file-type sniff（ESM 与 Nest CJS 不兼容），信任 multer + controller 白名单
  - Logout 加确认弹窗 + 跳过本地状态清理避免闪烁
  - `main.ts` `await router.isReady()` 防 /login 刷新闪 sidebar
- **iter 23：admin 角色 + logout + 自动 refresh + Header 风格**
  - `emergency_admin` 同享 admin 路径访问 + sidebar 显示用户管理
  - `/auth/logout` 加 `@Public` + 幂等清 cookie（修过期 token 退不掉）
  - `apiFetch` 自动 refresh on 401 + retry 一次
  - logout 用 `location.assign` 硬跳 `/login`，丢弃 bfcache
  - 模板中心 header 改 Hero 风格（渐变 + 大字号渐变色标题）
  - sidebar 底部用户信息一行水平布局（头像 + 名字 + LogOut 图标）+ 折叠图标改 chevron

### 2026-05-22

- **iter 22：Auto-save + 模块验收清单**
  - Designer store 加 `templateId / saveStatus`
  - DesignerView debounced auto-save + beforeunload 阻止丢失改动
  - Toolbar 保存状态指示器（保存中 / 已保存 / 失败重试）
  - `docs/qa/template-module-verification-checklist.md` — 11 个模块的功能验收清单
- **Plan 2 设计器 Iteration 9-15**
  - iter 9-12：QR 占位 / 元素最大长宽 / 旋转手柄 / Z 轴 / Z 轴对齐 PreviewView
  - iter 13：打印纸张溢出
  - iter 15：图片上传 + URL/二进制双模式

---

## 4. 已知问题

| 问题 | 状态 | 影响 / 备注 |
|---|---|---|
| Render 容器镜像 ~2.1GB | 🟡 体积偏大 | Alpine + chromium，生产用多阶段可缩到 ~800MB |
| 生产 render Dockerfile 用 bookworm + aliyun mirror | 🔴 CI 网络可能失败 | 上线前需切回 Alpine 或换镜像源 |
| 飞书未设密码用户解绑 | 🟡 未测 | iter 23 时遗留 |
| 渲染任务无重试 | 🔴 失败即终态 | 后续迭代加策略 |
| 渲染输出 URL 可猜测 | 🔴 无 signed URL | 待加 HMAC-signed URL 防越权 |
| Admin 用户管理后台仅占位 | 🟡 view 存在 / 后端 CRUD 未实现 | `views/admin/UsersAdminView.vue` |
| Render 输出 quota 无限制 | 🔴 磁盘可被打满 | 待加 user-level quota |

---

## 5. 后续计划

> 优先级从高到低，等待用户决策开始顺序。

| 方向 | 描述 | 涉及代码区域 |
|---|---|---|
| ~~飞书多维表格按钮触发渲染回写附件~~ | ✅ iter 27 完成 | `apps/api/src/lark/` + `examples/lark-bitable/` |
| ~~飞书机器人卡片交互渲染~~ | ✅ iter 28 完成 | `apps/api/src/lark/lark-bot.*` + `examples/lark-bot/` |
| ~~渲染失败重试策略~~ | ✅ iter 31（bullmq `attempts:3` + 指数退避 + 永久错误 UnrecoverableError） | `apps/render/src/main.ts` |
| ~~Signed URL~~ | ✅ iter 31（HMAC 签名 + 过期，`FileSigService`） | `apps/api/src/uploads/` |
| ~~渲染 quota 与磁盘清理~~ | ✅ iter 31（user 日配额 + cron 清理过期输出；"计费"未做也未必需要） | `render.service.ts` + cleanup service |
| ~~渲染任务历史~~ | ✅ 已实现 `/logs`（admin 看全部 / 用户看自己；含下载） | `RenderLogsView.vue` + `/render/jobs` |
| **Admin 用户管理 CRUD** | 列表 / 新建（本地账号） / 改角色 / 重置密码 / 启用禁用。当前 `UsersAdminView` 仍是占位、无后端模块 | `apps/api/src/users/` 新模块 + `views/admin/UsersAdminView.vue` |
| **生产 render Dockerfile 优化** | 改用多阶段 Alpine 或国内镜像，将镜像缩到 < 1GB | `docker/render.Dockerfile` |
| **模板分享 / 公共模板库** | 模板支持公开 / 团队共享；公共模板复制到自己账号 | DB 加 `visibility` 字段 + 列表 view 增 tab |
| **首次生产部署 / 验证** | 项目尚未部署过；需在类生产环境跑通 compose / CI deploy，验证迁移、worker、飞书回调 | `docker-compose` + `.github/workflows/deploy.yml` |

---

**修改本文件规则**：每次迭代收尾或重大修复完成时，按 `AGENTS.md` 第 9 节触发映射表追加第 3 节"近期变更"，并同步更新顶部"最近更新"日期。第 2 节"已交付能力"应只反映**当前主分支真实代码状态**，不写 WIP 或未合并内容。
