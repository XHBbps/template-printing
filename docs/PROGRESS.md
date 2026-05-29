# PROGRESS.md

> 仓库当前事实进度。已交付能力 + 近期重大变更 + 后续计划。
> **变动频率**：每次迭代收尾或重要修复后追加。
> 详细协作规则见 [`AGENTS.md`](../AGENTS.md)。

**最近更新**：2026-05-29（前端零碎 F-#13/#14/#17 收尾:F-#14『/auth/refresh 直接返回 user 省二次 /users/me』已修(后端抽共享 buildMeResponse、前端 tryRefresh 用返回 user),F-#17『AuditLogView 两请求』复核本就并发、F-#13『refreshRecentId』已并行且取全局最近不能从当前列表算故维持现状——至此 review 桶二 2A 前端 perf 全部完毕;前为 P9 收掉:markFailed 去 Bitable/Bot 回调冗余 findUnique(改收调用方已取的记录,不可变字段语义等价、不破坏批次4 P0 幂等),**至此 review 桶二 2B(P1–P13)全部处理完毕**;前为 review 桶二 2B 收尾:P11『listJobs 每行返回完整 data blob』评估后维持现状(详情弹窗复用 list 行 data、单组织分页下边际成本小、改造低 ROI)+ P13『render_jobs 永不删』决策落定(上量后按阈值再分区/归档,现在不实现)均零代码、落定决策文档,审计表批次8 完成项补 ✅,桶二 2B 仅剩 P9(Med)待办;前为批次8 后端 perf 小批:P3 日配额计数 Redis 缓存(GET 命中/miss 跑 DB+SETEX 至午夜+enqueue 后 incr,**Redis 错误 fail-open 回 DB**,软配额不阻塞入队)+ P10 render_jobs 加 (status,startedAt) 索引提速对账 + P6 对账 cron 单条 bulk 翻转+回查本次翻转行回调(N→2 往返,保批次4 竞态安全)+ P5 清理 cron take:500 分批读 + P4 listVersions take:100 + P8 distinctActions $queryRaw 去全行 hydrate + P7 上传 PNG/JPEG 复用单 sharp 实例免二次解码;全量 api 185 passed,review 桶二 2B 仅剩 P11(Low)/P13(未来);前为 review D-A2:正名现实——移除未用 MASTER_KEY + 删 CredentialId 死类型 + 文档去未实现的飞书凭证加密声明;前为批次7 前端剩余项收口:F8 ApiView 按 tab 懒拉(默认 docs 零请求)+ F11 设计器 snapshot persist debounce 500ms(undo/redo/load 即时)+ F9 自动保存改 `editVersion` 单调计数(去整 template 深 watch)+ F10 公共模板 tab `BrandPagination` 翻页(size 24)+ F4 首屏乐观 hydrate(boot 挂骨架不阻塞 + hydrate 后 `enforceAfterHydrate` 纠正重定向 + 尊重 `?continue=`,经用户 7 条 auth 流 + 弱网手测通过);**至此 review 桶二前端 F1–F11 全部完成**(批次5 F1/F5/F7、批次6 F2/F3/F6、批次7 F4/F8/F9/F10/F11);前为批次6 `/templates` 落地页加载优化:F2 设计器 `defineAsyncComponent` 异步分包(TemplatesView 35.94→12.58gz、拆出 DesignerView/DesignerHeader/VersionDialog 懒 chunk)+ F6 缩略图 IntersectionObserver 懒加载(可视才取数,砍 N+1)+ F3 bwip-js/qrcode 动态 import 懒拆(settle-safe,TemplateRenderer 255.64→4.45gz、bwip-js/qrcode 拆独立懒 chunk,无条码页不载条码库;端到端验打印条码不漏渲);**/templates 首屏 JS(无条码模板)≈291gz → ≈17gz、约 -94%**;F4 hydrate 瀑布 / F8 ApiView tab 懒拉 / F9-F11 等留后续批;前为批次5 前端首屏快赢:F1 Element Plus 按需引入(去全量 JS/CSS)+ F7 vite manualChunks 拆 vue-vendor/element-plus 长缓存 vendor + F5 TemplatesView reloadActive 两请求 Promise.all 并行;实测 entry `index.js` 930KB/307gz → 29.30KB/9.67gz、全量 `index.css` 351KB/50gz 拆为按需 CSS chunk;F3 904KB TemplateRenderer(bwip-js/qrcode)基本不变、与 F2/F4/F6 留后续批;前为批次4 Plan2 渲染可靠性续:P1a 自定义退避 + jitter(`RENDER_BACKOFF_BASE_MS` 默认2000、退避 base×2^(n-1)×[0.5,1.5) 防惊群、api+render 同版本部署耦合)+ P2a-worker zod 预校验(`schema_invalid`)+ P2a-web 永久错误 fail-fast(`barcode_invalid`/`qr_invalid`/`image_404`/`render_error` 立即失败不重试不出残图);前为登录页:CN/EN 整页切换接上 + 底部三栏改公开弹窗(系统状态/变更日志/API 文档)、删副标题文字保留占位;前为批次4 Plan1 渲染可靠性加固完成:P0 状态机单调性(终态粘性 db + main 短路 + 对账 cron `count===1` 守卫 + 飞书 handler 幂等)+ P1b 回调失败补发(`CALLBACK_RESEND_MAX_ATTEMPTS` 默认5,退避 5/10/20/40/80min)+ P2b stuck_timeout 指标与 Prometheus 告警;P1a jitter 暂缓(bullmq 5.10.4 无 jitter 选项,需自定义 backoffStrategy 跨进程)、P2a 永久错误细分留待 Plan 2;前为批次3 存储清理完成:修 `RENDER_DIR` 漏 uploads/ 路径 bug + P1 孤儿上传清理 / P2 审计日志保留 / P12 飞书会话清理三个清理 cron 及 env;前为批次2 生产部署产物修正:D6 统一 Dockerfile / D1 env 对齐 / D2·D3 render WEB_BASE+卷 / B3 mem_limit / V7 metrics 白名单;build/run 实证发现并修 GAP#1 api 镜像 pnpm 依赖、GAP#2 compose 插值、GAP#3 首部署迁移顺序;开发机起 prod 栈渲染往返成功——服务器填 .env.prod 密钥即可一把跑通）

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
| **Admin 用户管理后台（CRUD + 禁用 + 角色）** | ✅ 已完成 | iter 33（最新）：`apps/api/src/users/` + 真实 `UsersAdminView` |
| 渲染任务历史 / 我的渲染任务 | ✅ 已实现 `/logs` | admin 看全部 / 用户看自己 |

---

## 2. 已交付能力

### 2.1 鉴权与用户

- **飞书 SSO 登录**：`/auth/lark/start` → 飞书授权 → `/auth/lark/callback` → 写 JWT cookie；首次登录自动建用户（随机密码 + 飞书 IM 通知）
- **本地账号登录**：`/auth/local/login`（username + password）——任意未禁用、有本地密码的用户均可登录，按真实 role 签发；首次登录强制改密
- **角色体系**：`admin` / `emergency_admin` / `user`；前两者路径权限等同
- **用户管理（admin）**：`/admin/users` CRUD —— 新建本地账号（一次性密码）/ 改角色 / 重置密码 / 禁用启用；禁用或降级经 `UserStateService` 缓存 evict **下一请求即生效**（吊销 refresh + API token），守卫每请求用 DB 最新 role 覆盖 JWT；安全规则（不能动自己 / emergency_admin 受保护 / 保留最后一个活跃 admin，FOR UPDATE 事务）
- **Token 链路**：access cookie（短） + refresh cookie（长，DB 哈希存储） + CSRF；`apiFetch` 自动 401 retry
- **Logout**：硬跳 `/login`（避免 bfcache 复活）+ 幂等清 cookie 端点
- **个人中心**：`/me` 显示当前用户 + 改密码 + 解绑飞书（已实现 80%）
- **登录会话时长**：由"保持登录"开关控制（不勾 = session cookie；勾 = 30 天持久 + `tp_remember`）；登录页运营指标来自真实 `GET /stats/overview`

### 2.2 模板中心 + 设计器

- **模板列表**：`/templates`（Hero 风格 header），inline 切到设计器（无独立路由，View Transitions 形变动画）
- **CRUD**：`POST/GET/PATCH/DELETE /api/templates`；自愈机制（残缺模板 PATCH 回写）
- **模板分享 / 公共模板库**：`visibility`(private/public)；admin 把已发布模板上架(`PATCH :id/visibility`)；公共库 `GET /templates/public`(跨 owner、只读)；任意用户 `POST :id/copy` 复制公共模板(取最新发布版)到自己名下的私有草稿；模板中心「我的/公共」tab
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

### 2026-05-29

- **bug-review 批次4:P1 飞书并发幂等(SSO 首登 upsert + bitable print-trigger record 级幂等)** —— 依 review 第 4 节。**① SSO 首登 upsert**(`auth/lark/lark.controller.ts`):原 `findUnique`→`create` 非原子,`larkOpenId @unique`,同一新用户并发首登(双击/多端)第二个 `create` 撞唯一约束 → P2002 → 回调 500 登录失败。改为先只读一次(判禁用 + 是否首登决定欢迎语),再 `prisma.user.upsert({where:{larkOpenId}})`——并发第二个走 ON CONFLICT DO UPDATE 而非再 create,消除 500;被禁用的已有用户仍在任何写入前拒绝(只读判定);欢迎语仍按"首登"发(极罕见并发首登可能各发一次,纯展示层可接受)。**② bitable print-trigger record 级幂等**(`lark/lark-bitable.controller.ts`):原 `print-trigger` 无幂等,飞书 at-least-once 重投 / 业务连点 → 重复入队 + 同一行多份重复 PDF 附件。入队前加存在性检查:同一 `(appToken,tableId,recordId)` 已有 `callbackStatus='pending'` 的进行中请求 → 直接复用其 jobId、不再入队(已 done/failed 的历史行不挡,允许正常重新打印)。**残留**:真·同毫秒并发双投仍可能各建一行(未加 pending 偏索引,需 migration,留待;现实重投间隔秒级 / 连点百毫秒级,顺序检查即可命中)。**验证**:`auth-lark.e2e` 加并发首登用例(Promise.all 两回调均 302、只建一个用户)、新增 `lark-print-trigger-idempotency.e2e.spec.ts`(重复两次复用同 job/只一行+一 job;已 done 不挡允许重打);全量 api **193 passed** + typecheck 通过,无回归。
- **bug-review 批次3:P1 强制改密后端落地(堵前端软拦截绕过)** —— 依 review 第 5 节。此前 `mustChangePassword=true` 仅前端 `MustChangePasswordDialog` 软拦截,后端仍签发完整有效 token,用户可不走弹窗直接调任意业务 API(**含创建长期 API token**)绕过强制改密。**修复**:新增后端闸 `auth/guards/password-change-gate.ts`(`assertPasswordChanged` + `@AllowDuringPasswordChange()` 白名单装饰器)。`mustChangePassword` 随每请求 DB 状态可得——`UserState` / `VerifiedToken` 各加该字段(select 同步),与 role 覆盖机制一致。在两处已注入 `req.user` 的鉴权 guard 内调用闸门:`JwtAuthGuard`(cookie/全局,覆盖业务 API + 创建 token)与 `ApiAuthGuard`(注入 Reflector;Bearer + cookie 双路径,覆盖 `/api/render`)。白名单仅 `GET /users/me`(读 me)与 `PATCH /users/me/password`(改密);登出/续签走 `@Public` 天然不经闸。命中非白名单 → `403 { code: 'MUST_CHANGE_PASSWORD' }`。**即时生效**:改密成功后 `me.controller` evict 自身缓存(闸下一请求即放行);admin 重置密码后 `users.controller` 也补 evict(闸下一请求即生效,与 disable/role 一致)。**验证**:新增 `must-change-password-gate.e2e.spec.ts`(emergency_admin mustChangePassword 用户完整流程:登录→`/templates` 403→创建 token 403→Bearer 调 render 403→读 me 200→改密 200→`/templates` 恢复 200);全量 api **190 passed** + typecheck 通过,无回归。
- **bug-review 批次2:P1 限流失效修复(trust proxy + render per-user tracker)** —— 依 review 第 3 节。两处叠加导致 `POST /api/render` 的 30/min per-user 限流退化为**全站共享单桶**。**根因1**:`render.controller` 用 controller 级 `@UseGuards(ApiAuthGuard)`,而 NestJS 全局 throttler 必早于 controller 级 guard 执行,`getTracker` 取 `req.user` 时 ApiAuthGuard 尚未注入 → 永远走 IP 分支。**修复(选 getTracker 自解析方案,不改全局 guard 架构、零 @Public 语义破坏)**:`UserThrottlerGuard.getTracker` 对无 `req.user` 的请求自行按凭证指纹分桶——`Bearer tpkn_` → `token:<sha256前缀>`、access cookie → `sess:<sha256前缀>`、否则 `ip:` fallback(只取指纹,不验签/不反查 DB/不落明文 secret;同 token/同会话=同桶=同用户,不同用户凭证不同→不同桶)。**根因2**:bootstrap 未设 `trust proxy`,反代后 `req.ip` 恒为反代地址 → IP fallback 与审计/Sentry IP 失真。**修复**:`configureApp` 设 `app...set('trust proxy', 1)`(生产 nginx 单层反代)。**验证**:新增 `test/user-throttler-guard.spec.ts` 4 例(user/Bearer 同 token 跨 IP 同桶+不同 token 同 IP 不同桶/cookie 会话/IP fallback,均断言不落明文);全量 api **189 passed**(185+4)+ typecheck 通过,无回归。
- **bug-review 批次1:P0 渲染终态守卫补全(`markProcessing`)** —— 依 `docs/qa/2026-05-29-codebase-review.md` 第 2 节唯一渲染缺口。批次4 Plan1 已给 `markDone`/`markFailed` 加 `AND status NOT IN ('done','failed')` 终态守卫,但 `markProcessing` 仍是**唯一无条件写 status** 的地方:job 已被对账 cron 翻 `failed` 后,若某次 bullmq stalled 重投/慢 attempt 仍在跑,`main.ts` 第 76 行"已终态跳过"检查到 `markProcessing` 之间有 DB 往返窗,能把终态行**拉回 `processing`**,撕开终态粘性 → failed+done 双回调/重复计数。**修复**:`apps/render/src/db.ts` `markProcessing` 加同样守卫并返回 `rowCount`;`apps/render/src/main.ts` `markProcessing` 返回 0 时直接 `return`(放弃本次渲染,与已有终态跳过语义对齐)。**验证**:`apps/render/test/db-sticky.spec.ts` 补两例(已 failed 行 markProcessing 返 0 且不翻 / pending 行返 1 且翻 processing),db-sticky 5 passed + render typecheck 通过。
- **前端零碎 F-#13 / F-#14 / F-#17 收尾** —— review 桶二 2A 的三个尾巴小项。**F-#14 已修**(commit `e5a96d41`):`/auth/refresh` 此前只返回 `{csrf}`、前端 `tryRefresh` 续签后还得再打一次 `/users/me`;后端该 handler **本就已 `findUnique` 取了完整 user**,改为额外返回 `user`(抽共享 `buildMeResponse(user, csrf)`,`me()` 与 `refresh` 共用;`csrf` 仍保留在响应顶层向后兼容),前端 `tryRefresh` 直接用返回的 user、删掉二次 `/users/me`——每次续签(401 重试 / boot hydrate 回退)少一次往返;auth-refresh e2e 加 user 断言(6 passed)。**F-#17 复核为已满足(无需改动)**:`AuditLogView` `onMounted` 本就 `void loadActionOptions(); void refresh();` 两请求 fire-and-forget 并发,无串行 await。**F-#13 评估后维持现状**:`refreshRecentId` 已与激活列表加载 `Promise.all` 并行(无额外延迟),且它取的是「当前筛选下全局 updatedAt 最大」的 id——不能从任意 sort/page 的当前列表算出(否则误标「最近编辑」红框),保留独立 `limit:1` 查询正确。**验证**:api 185 passed + typecheck + lint;web vue-tsc + 生产构建(9.46s)全过。**至此 review 桶二 2A 前端 perf(F1–F11 + 尾巴小项 F-#13/#14/#17)全部处理完毕。**
- **P9 收掉 —— review 桶二 2B 后端 perf/存储 全部清零** —— `markFailed` 去 Bitable/Bot 回调路径的冗余 `findUnique`(commit `48e7a3b3`)。两处 `renderCallback` 已在顶部按 `renderJobId` 取了 `req`/`session`,失败分支再调 `markFailed(id, …)` 时方法内**又按 id 重查一次同一记录**;改为 `markFailed(record, …)` 直接收调用方已取的记录,省一次查询。安全性:`markFailed` 只读 `appToken/tableId/recordId/statusField`(Bitable)、`chatId/triggerOpenId/cardMessageId`(Bot)——均创建后**不可变**,且重查并非 TOCTOU/幂等守卫(幂等是顶部 `callbackStatus==='done'`/`state==='done'` 短路,markFailed 的 update 本就无状态守卫),故调用方副本与重查**语义等价**,不破坏批次4 P0 幂等。`markFailed` 在两文件均仅被各自 `renderCallback` 调用。**验证**:全量 api 185 passed + typecheck + lint 全过。**至此 review 桶二 2B(P1–P13)全部 ✅ 处理完毕**(P1/P2/P12 批次3、P3–P8/P10 批次8、P9 本次、P11 维持现状、P13 决策落定)。
- **review 桶二 2B 收尾:P11 评估后维持现状 + P13 决策落定(均零代码,落定决策文档)** —— 批次8 后剩的两个 Low 项不实现、以带理由的决策关闭。**P11(`listJobs` 每行返回完整 `data` blob)→ 维持现状**:渲染日志详情弹窗(`RenderLogsView` `openDetail`)当前直接复用 list 行的 `data`,而 `GET /render/:jobId` 不返回 `data`;要精简 list 必须配合详情面板按需拉取(改 render.service/controller + 前端加一次请求与 loading 态,动到正在工作的功能)。考虑单组织 + 分页(默认 20 / 上限 100 行)下 `data`(渲染填充字段,多为小 KB)边际成本小、且详情秒开体验更优,判定改造低 ROI → **决定维持现状**(若日后管理员全量日志上量再议)。**P13(`render_jobs` 行永不删,长期百万行)→ 决策落定**:维持现状不删;部署上量后按"行数 / 表体积阈值"触发按月分区或归档,6-12 月评估,**现在不提前实现**。同时把审计表 `2026-05-28-system-review-audit.md` 桶二 2B 的批次8 完成项(P3/P4/P5/P6/P7/P8/P10)补 ✅、P11/P13 标决议。**至此 review 桶二 2B 仅剩 P9(Med,`markFailed` 前冗余 `findUnique`,独立小项,批次8 未纳入)一项待办。**
- **批次8:后端 API 性能小批(P3/P10/P6/P5/P4/P7/P8)完成** —— 依 `docs/superpowers/specs/2026-05-28-system-review-audit.md` 桶二 2B,7 项纯 `apps/api`、语义不变、低风险。**P10 对账索引**(commit `c81fe2b4`):`render_jobs` 加 `@@index([status, startedAt])` + migration `add_renderjob_status_startedat_index`,提速对账 cron 的 `WHERE status='processing' AND startedAt<cutoff`。**P3 日配额计数 Redis 缓存**(commit `cd677109` + 测试跟进 `4cb68241`):`checkDailyQuota` 由每次 join-`count(template.ownerId=X, createdAt≥今)` 改为 `dailyUsed` —— GET 缓存命中直接用 / miss 跑原 DB count + SETEX 至当日午夜;enqueue 建 job 后 best-effort `multi().incr().expire()`(fire-and-forget)保当日后续准确;**任何 Redis 错误 fail-open 回 DB count**(软配额,绝不因 Redis 挂而阻塞入队),缓存值=原查询语义不变;专用独立 IORedis client(不复用 bullmq 连接)。单测 7 例(hit / miss+SETEX / `get` 抛错 fail-open / `set` 抛错 fail-open / 429 / 不超限 / `limit=0` 短路),key 断言改动态构造消时区依赖(默认 TZ 与 `TZ=Asia/Shanghai` 各 7 passed)。**P6 对账批量翻转**(commit `503f1f98`):`reconcileStuckJobs` 由 N 条逐条 `updateMany` 改为单条 bulk `updateMany({id:{in:ids}, status:'processing'})` 翻转 + 回查本次翻成 `stuck_timeout` 的行做回调/metrics,DB 往返 N→2;**保批次4 竞态安全**(bulk 的 `status='processing'` 守卫排除被 worker 抢先 markDone 的行;`flipped` 回查精确锁定本次翻转集,不重不漏),`render-stuck-reconcile.e2e` 5 passed(含竞态用例 + 新增多条翻转用例)。**P5 清理分批读**(commit `12123af0`):`cleanupOldOutputs` 由一次 `findMany` 把全部旧 job 读进内存改为 `take:500` 分批循环(每批置 `cleanedAt` 单调推进、`<BATCH` 提前 break),语义不变。**P4 listVersions 上限**(commit `6c7cf6c7`):`templateVersion.findMany` 加 `take:100`(orderBy version desc,防版本极多全量返回)。**P8 distinctActions $queryRaw**(commit `6c7cf6c7`):由 Prisma `distinct:['action']`(全行 hydrate)改 `$queryRaw SELECT DISTINCT action FROM audit_log ORDER BY action ASC`。**P7 上传单次解码**(commit `82d00305`):PNG/JPEG 由各建两个 `sharp(buffer)`(toBuffer + metadata)改为复用单实例(先 `metadata()` 取 density,再 `.png()/.jpeg().toBuffer()` 取宽高),免输入二次解码,`uploads.e2e` 4 passed。**验证**:全量 api 185 passed / 44 套件 + typecheck + lint 全过,无回归。**至此 review 桶二 2B 仅剩 P11(Low)/P13(未来归档)**。
- **review D-A2:正名现实 + 移除 MASTER_KEY(去未实现的飞书凭证加密脚手架)** —— 决议:飞书 app secret 经 env 单一全局 `LARK_SSO_APP_SECRET` 注入(12-factor,单组织内部工具,明文用于 token 交换,足够安全)为**既定架构**;此前文档把"per-tenant 加密凭证库 / `credentialId` / `MASTER_KEY` 加密"当已实现,实为**从未落地的脚手架**(全仓零加密调用、`CredentialId` 类型零引用),本批**正名而非实现**:**移除死配置 `MASTER_KEY`**(`apps/api/src/common/env.ts` 删该 Zod 必填字段 + `env.spec.ts` 删 setup 行与 too-short 用例 + `.env.example`/`.env.prod.example`/`docs/PRE_DEPLOYMENT_CHECKLIST.md` 删对应行);**删死类型 `CredentialId`**(`packages/types/src/index.ts`,`Brand` 工具类型仍被 UserId/TemplateId 等使用故保留);**文档去未实现声明**(`CLAUDE.md`/`AGENTS.md` 两处规则改述为真实约束「敏感凭证经 env 注入、不入 DB/仓库」、`AGENTS.md` 11 节同步、`2026-05-21` 设计 doc 加历史注记不重写)。`EnvSchema` 为 `z.object()`(非 `.strict()`)默认 strip 未知键,残留 `.env`/`.env.test`/CI 的 `MASTER_KEY` 无害(本批不动这些非清单文件)。**不实现加密**(用户决策)、不动 `LARK_SSO_APP_SECRET` 现有用法。**验证**:全量 api 测试绿(`env.spec`/`env-example-sync.spec` 重点确认移除后 env 校验仍正确、`.env.prod.example ⟷ env.ts` 双向同步仍成立)+ api/types/web typecheck + lint 全过。
- **批次7:前端剩余项(F8 / F11 / F9 / F10 / F4)完成 —— review 桶二前端 F1–F11 全部收口** —— 五项均不动业务语义、纯加载/状态调度优化。**F8 ApiView 按 tab 懒拉**(commit `eaf63b87`):`ApiView` 改为按当前 tab 懒拉 tokens / templates,默认 docs tab **零请求**(进控制台不再无条件拉两份数据)。**F11 设计器 snapshot 的 localStorage persist debounce 500ms**(commit `9497f3c1`):设计器 snapshot 写 localStorage 持久化加 500ms debounce(连续编辑不再每帧落盘);undo / redo / load / reset 仍即时持久化。**F9 自动保存改 `editVersion` 单调计数**(commit `6a8f5bce`):自动保存由对整 template 深 watch 改为 watch 单调递增的 `editVersion` 计数(snapshot / undo / redo 时 ++,加载 / 重置不 ++),去掉昂贵的整树深比较。**F10 公共模板 tab 翻页**(commit `02224084`):公共模板 tab 由一次拉 100 改为 `BrandPagination` 分页(page-size 24),按页拉取。**F4 首屏乐观 hydrate**(commit `e780b551` + 跟进 `c4a5e69b`):boot 不再阻塞等待 hydrate —— 先挂骨架乐观放行,hydrate 完成后 `enforceAfterHydrate` 纠正重定向(`/login` 也显骨架防已登录闪现,`enforceAfterHydrate` 尊重 `?continue=` 回跳)。**已经用户手测 7 条 auth 流(已登录刷新 / 未登录深链 / 过期会话 / 登出 / 已登录访问登录页 / adminOnly / continue 回跳)+ 弱网骨架,全部通过**。**总结:review 桶二前端 F1–F11 全部完成**(批次5 F1/F5/F7、批次6 F2/F3/F6、批次7 F4/F8/F9/F10/F11)。**验证**:全量生产构建通过(`docker exec template_printing-web … pnpm run build`,`✓ built in 9.27s`);F4 经用户 7 条 auth 流 + 弱网手测通过。
- **批次6:`/templates` 落地页加载优化(F2 / F6 / F3)完成** —— 三项不动业务逻辑、纯异步分包/懒加载,把模板中心落地页首屏 JS 大幅压缩,设计器与条码/二维码生成库全部按需懒加载。**F2 设计器 `defineAsyncComponent` 异步分包**(commit `8065d9e2`):`TemplatesView` 把 `DesignerView`/`DesignerHeader`/`VersionDialog` 拆为 `defineAsyncComponent` 懒加载(进入设计/编辑态才下载),落地页不再静态打包整个设计器 → `TemplatesView` **35.94gz → 12.58gz**;拆出 `DesignerView`(66.00KB/20.83gz)、`DesignerHeader`(12.53KB/5.32gz)、`VersionDialog`(3.55KB/1.89gz)三个独立懒 chunk。**F6 缩略图 `IntersectionObserver` 懒加载**(commit `3f142c38`):`TemplateThumb` 改为进入视口才取数 + 渲染,砍掉列表一次性 N+1 取数与离屏渲染。**F3 bwip-js / qrcode 动态 `import` 懒拆**(commit `fab74327`):`Barcode`/`QrElement` 改 `await import('bwip-js')` / `import('qrcode')`(settle-safe:渲染就绪 barrier 的 begin 先行登记,确保动态导入期间渲染-settle 不漏算),`TemplateRenderer` **255.64gz → 4.45gz**(13.87KB raw),`bwip-js`(874.93KB/243.31gz)与 `qrcode`(21.64KB/8.14gz)拆为独立懒 chunk,**无条码/二维码的模板页完全不下载条码库**;端到端已验含条码模板打印仍正确出条码(动态导入不漏渲)。**`/templates` 首屏 JS gz 对比(无条码模板时,落地页 = `TemplatesView` + `TemplateRenderer`,设计器/bwip-js/qrcode 全懒不载)**:**改前 ≈291gz**(`TemplatesView` 35.94 + `TemplateRenderer` 255.64,后者含内联 bwip)→ **改后 ≈17gz**(`TemplatesView` 12.58 + `TemplateRenderer` 4.45),**首屏下降 ≈274gz(约 -94%)**。**留后续批**:F4(hydrate 瀑布)、F8(ApiView tab 懒拉)、F9-F11 等单独成批。**验证**:生产构建实证以上体积(`pnpm run build`,9.68s);F3 端到端验打印含条码不漏渲。
- **批次5:前端首屏快赢(F1 / F5 / F7)完成** —— 三项不动业务逻辑、纯加载/打包优化,显著压缩首屏字节并把框架/组件库移入长缓存 vendor chunk。**F1 Element Plus 按需引入**(`apps/web`,commit `c39dc90a`):接入 `unplugin-element-plus`(按需注入组件 CSS)+ `unplugin-vue-components` 的 `ElementPlusResolver`(自动按用到的组件 import),移除 `main.ts` 的 `app.use(ElementPlus)` 全量注册 + 全量 `element-plus/dist/index.css` 引入 —— 去掉了整库 JS 与整库 CSS 的无差别打包。**F7 vite `manualChunks`**(commit `11b4d7b0`):`vite.config.ts` 增加 `build.rollupOptions.output.manualChunks`,把 `vue`/`vue-router`/`pinia` 等框架拆到 `vue-vendor`、Element Plus 拆到独立 `element-plus` chunk,二者内容稳定 → 长缓存命中、业务代码变更不再使其失效。**F5 `TemplatesView.reloadActive` 并行**(commit `a506f040`):原先串行 `await` 的两个请求改为 `Promise.all` 并发,缩短模板中心激活态刷新等待。**体积对比(生产构建,raw / gz)**:entry `index.js` **930KB/307gz → 29.30KB/9.67gz**(瘦身后仅含应用骨架);全量 `index.css` **351KB/50gz** → 拆为按需 CSS chunk(入口 `index.css` 37.54KB/7.95gz + 各视图/组件独立 CSS,如 `el-overlay` 4.49KB/1.07gz);**新增长缓存 vendor**:`vue-vendor` 98.13KB/38.65gz、`element-plus` 236.11KB/78.36gz;`TemplatesView` 115.02KB/35.94gz(JS 基本持平,CSS 87.61KB/12.44gz 拆出);`TemplateRenderer` **904.93KB/255.64gz 基本不变**(F3 含 bwip-js/qrcode 未做,留后续批)。**首屏 gz 总量(entry + 其首屏依赖 vue-vendor + element-plus + 入口 CSS):≈357gz(整体 monolithic entry+全量 CSS)→ ≈134.6gz(9.67+38.65+78.36+7.95),首屏 gz 下降 ≈222gz(约 -62%)**;且框架/组件库已分离为长缓存,后续业务迭代不再重复下发。**留后续批**:F3(904KB TemplateRenderer 拆 bwip-js/qrcode 异步)、F2(设计器静态引入改异步)、F4(hydrate 瀑布)、F6(缩略图 N+1)等单独成批。**验证**:已生产构建实证以上体积(`pnpm run build`,3357 modules,9.03s);F1 已构建验证 + 经人工视觉走查(待视觉确认)。

### 2026-05-28

- **批次4 Plan2:渲染可靠性续(P1a 自定义退避+jitter / P2a 永久错误细分 fail-fast)完成** —— 依 `docs/superpowers/specs/2026-05-28-render-reliability-hardening-design.md` Plan 2(为 Plan2 已落地代码补 env/文档 + 全量回归收尾)。**P1a 自定义退避 + jitter**:bullmq 5.10.4 无内置 jitter,改由 render Worker 注册自定义 `settings.backoffStrategy`(`backoff.ts` 的 `jitterBackoff`,退避 = `RENDER_BACKOFF_BASE_MS(默认2000) × 2^(n-1) × [0.5,1.5)` 指数+±50% jitter,打散并发齐步重试惊群)+ API 入队改 `backoff:{type:'custom'}`;**⚠️ 部署耦合:api 与 render 必须同版本部署**(旧 worker 收 custom 抛 "Unknown backoff strategy")。**P2a-worker zod 预校验**:`@template-printing/schema` 加 build + `exports["./template"]→dist`(`.` 仍 src),render 导航前 `TemplateSchema.safeParse(tpl.data)` 失败 → `UnrecoverableError('schema_invalid')`;`docker/render.Dockerfile` 构建阶段先 build schema 再 build/deploy render(实证 node 可解析 `./template`,避 raw-TS `ERR_UNKNOWN_FILE_EXTENSION`)。**P2a-web 永久错误 fail-fast**:`PrintHeadlessView` 渲染-settle 注册表 + 错误 sink,Barcode/Qr/Image 元件 **designMode 门控**上报(`barcode_invalid`/`qr_invalid`/`image_404`,不回归设计器编辑),worker `renderer.ts` 读 `window.__renderError` → `main.ts` `UnrecoverableError`(不出残图)。**永久错误分类总览**:`schema_invalid`(worker zod 预校)/`barcode_invalid`/`qr_invalid`/`image_404`/`render_error`(渲染期同步抛错)→ 立即 `failed`、`attempts=1` 跳过重试、不产出残缺 PDF/PNG(对账与回调补发不触发);端到端已验图片404 job→failed/image_404/attempts=1、正常→done。env `RENDER_BACKOFF_BASE_MS`(默认2000,render 进程 process.env,不在 api env.ts schema)入 `.env.example`/`.env.prod.example` + `env-example-sync.spec.ts` 白名单;`docs/deployment.md` 补「批次4 续(Plan2)」小节(P1a 退避公式+部署耦合警示、P2a 永久错误 reason 表 + schema 构建依赖)。全量回归:schema 47/47、render 15/15、api 43套件/178用例 全绿,web/template-renderer/schema/render/api typecheck+lint 全过,render prod 镜像重建 runtime-verify `VERIFY_OK function`(node 解析 `@template-printing/schema/template`),无回归。
- **登录页:CN/EN 整页切换 + 底部三栏公开弹窗** —— `LoginView.vue`。接上原有 CN/EN 切换按钮(此前 `lang` 变量未驱动任何文案):新增登录页文案字典 `messages.{cn,en}` + `t` computed,左侧品牌叙事 + 右侧表单 + 弹窗 + toast **整页**按语言切换(原"中文+英文小字"并置改为单语显示)。删除"使用扬力账号继续…首次飞书登录会自动建号…"副标题文字,**保留空占位 `<p>` + `min-height` 维持与表单原间距**。底部「系统状态 / 变更日志 / API 文档」三链接均改为**公开弹窗**(`<Teleport to="body">`,命名空间 `tp-l-modal-*`,不跳转受限页):系统状态=点击实时 ping `/healthz`(运行正常/不可用 + uptime)+ 复用月渲染量/P50/成功率;变更日志=**手维护**版本列表(写死在 `LoginView.vue` 的 `changelog` 数组,中英双份,发版手动加条目——暂不做自动同步);API 文档=公开 API 速览(Bearer 鉴权 / `POST /api/render` / `GET /api/render/:jobId` / 回调结构 / curl,内容取自 `/api` 控制台文档 tab,`/api` 控制台本身仍 `requiresAuth`)。web typecheck(vue-tsc)+ lint 全过。
- **批次4 Plan1:渲染可靠性加固(服务端,P0/P1b/P2b)完成** —— 依 `docs/superpowers/specs/2026-05-28-render-reliability-hardening-design.md` Plan 1。**P0 渲染状态机单调性(真 bug 修复)**:终态(done/failed)一旦写入不可被覆盖,一处 SQL 守卫 + 三处短路收掉 stalled 晚到执行 / 对账 cron 快照窗口覆盖终态导致的 DB 与回调不一致、重复渲染、重复写回飞书 —— render `db.ts` `markDone`/`markFailed` 加 `AND status NOT IN ('done','failed')` 并返回 rowCount;render `main.ts` `fetchJob` 后已终态直接短路 `return` + 仅 rowCount>0(真翻转)才 `sendCallback`;API 对账 cron `reconcileStuckJobs` 改 `updateMany({where:{id,status:'processing'}})` 且仅 `count===1` 才 `sendStuckCallback`;飞书 bitable / bot 两侧 `renderCallback` 顶部对已 `done` 请求幂等短路。**P1b 回调失败补发**:`RenderJob` 加 `callback_attempts` 列(migration `add_callback_attempts`),新增 API 补发 cron `resendFailedCallbacks()`(`@Cron(EVERY_5_MINUTES)`,退避 `completedAt + 5*2^callbackAttempts` 分钟 = 实际 5/10/20/40/80min、horizon≈80min,5 次耗尽永久 `failed`),env `CALLBACK_RESEND_MAX_ATTEMPTS`(默认 5,≤0 关)入 `.env.example`/`.env.prod.example` + `env-example-sync.spec.ts` 白名单;**仅服务外部 callbackUrl 调用方**(飞书内部回调恒 HTTP 200 故不触发),要求外部调用方按 jobId 幂等去重。**P2b stuck_timeout 可观测**:对账 cron 翻转 stuck job(`count===1`)时 inc `tp_render_jobs_total{status='stuck_timeout',source='cron'}`;`docs/deployment.md` 补「渲染可靠性(批次4)」小节(回调补发 env + 退避公式 + 幂等要求 + Prometheus 告警规则 `RenderWorkerStuckJobs`)。**P1a backoff jitter 暂缓** —— 实测 bullmq 5.10.4 无 `jitter` 选项,真做需 render Worker 自定义 `backoffStrategy` + API `type:'custom'`(跨进程 + 部署耦合),本批跳过,保持现有 exponential 2/4/8s,留待后续。**P2a 永久错误细分整体留待 Plan 2**(schema raw-TS 打包陷阱 + `PrintHeadlessView` 50ms 就绪 barrier race,碰共享包/设计器回归,单独 plan)。全量回归:api 43 套件/178 用例全绿、render 2 文件/11 用例全绿,两端 typecheck + lint 全过,无回归。
- **批次3:存储清理(防无限增长)完成** —— 依 `docs/superpowers/specs/2026-05-28-system-review-audit.md` 存储桶,修复 4 项:**规划期发现并修复** `RENDER_DIR` 漏 `uploads/` 路径 bug(`render-cleanup.service.ts` 渲染产物清理 `cleanupOldOutputs` 与签名下载此前指向 `STORAGE_ROOT/render/` 实际不存在的目录 → 删错路径 + 签名下载 404,改为正确的 `STORAGE_ROOT/uploads/render/`);**P1** 新增孤儿上传清理 cron `cleanupOrphanUploads()`(删 `uploads/` 顶层中未被模板引用、mtime 早于 `UPLOAD_ORPHAN_GRACE_DAYS` 默认 7 天的文件,0=关);**P2** 新增审计日志保留 cron `cleanupAuditLog()`(删 `createdAt` 早于 `AUDIT_LOG_RETENTION_DAYS` 默认 90 天的行,≤0=关);**P12** 新增飞书会话清理 cron `cleanupBotSessions()`(删 `done`/`failed` 且 `updatedAt` 早于 `BOT_SESSION_RETENTION_DAYS` 默认 30 天的行,≤0=关)。三个新 env 为 `process.env` 直读(不在 `env.ts` Zod schema),`.env.example`/`.env.prod.example` 同步追加并加入 `env-example-sync.spec.ts` 白名单;`docs/deployment.md` 补「存储清理与保留」小节。全量 api 测试绿(含批次3 新增 e2e + env-example-sync)。
- **批次2:生产部署产物修正(开发机就绪)完成** —— 依 review spec 部署桶,把"拿到服务器一把跑通"所需的产物全部修正并在开发机实证:**D6** CI 改为构建 release 实际出货的 `apps/{api,web}/Dockerfile.prod`、删冗余 `docker/{api,web}.Dockerfile`(出货镜像此前从未被 CI build);**D1** `.env.prod.example` 严格对齐 `env.ts`(删 `JWT_ACCESS/REFRESH_SECRET`→`JWT_SECRET`、补 `MASTER_KEY/FILE_SIG_SECRET/CORS_ORIGIN/RENDER_CALLBACK_SECRET/WEB_BASE` 等)+ 双向一致测试 `env-example-sync.spec.ts`(`EnvSchema` 导出);**D2/D3** compose.prod 的 render 补 `WEB_BASE:http://web:80`/`STORAGE_ROOT`/`DATABASE_URL` + `/storage` 卷(原先渲染连不上 SPA、产物丢失);**B3** 各服务 `mem_limit`(render 2g 等)+ `.env.prod` 入 gitignore;**V7** nginx `/api/metrics` IP 白名单。**实建三个 prod 镜像**(此前从未 build,均可构建)。**本地以独立 project 起 prod 栈跑通渲染往返、产物在 api/render 共享卷双端可见**——此过程**额外发现并修复 3 个真实部署阻断**:GAP#1(api 镜像 pnpm 悬空依赖→启动崩,见下条)、GAP#2(compose `${REGISTRY}/${TAG}` 插值读 shell/根 `.env` 而非 `env_file`,部署脚本已 `set -a; . .env.prod`)、GAP#3(空库首部署迁移顺序崩,见下条)。最终全新空库走修复后顺序:起库→`run --rm migrate`→起 api,**api 首启即 healthy、渲染往返成功**。砍 B10(render healthcheck 需先定探针)、推后 B11/O9(异地备份/迁移回滚,待首次部署有数据后)。
- **fix(deploy)：迁移在 api 起服务前用 `run --rm` 执行 + `EmergencyAdminBootstrap` 容忍空库,修首次部署崩溃(GAP#3)** —— 空库首次部署时 `emergency-admin.bootstrap.ts` 的 `onModuleInit()` 在 api 启动即 `prisma.user.findUnique()` → `P2021: table public.users does not exist` → api 崩溃循环;而旧 `scripts/deploy/init.sh` 先 `up -d ... api`、**等 api `/healthz` healthy 才** `migrate deploy`,空库 api 永远不 healthy → 等待循环耗尽 → migrate 跑在重启中的容器上失败 → 一把跑通的首次部署直接 FAIL。**Part A(脚本顺序)**:`init.sh` 改为 ①只起 `postgres redis`(`up -d --wait`)→ ②用一次性容器 `docker compose run --rm --no-deps api npx prisma migrate deploy` 在 api 对外服务前建表 → ③再 `up -d api web render`;`update.sh` 同理在 `up -d --remove-orphans` 重启前先 `run --rm` migrate(去掉原先 healthy 后才 migrate 的步骤)。两脚本均显式 `set -a; . ./.env.prod; set +a` 把 `REGISTRY/TAG/POSTGRES_PASSWORD` 载入 shell,使 `${REGISTRY}/${TAG}` 在 `run`/`up` 插值正确解析(连带修 GAP#2)。**Part B(防御)**:`onModuleInit` 全体 DB 逻辑包 try/catch,捕获 `P2021`/`P2022`(表/列不存在)时 `logger.warn('schema not ready … skipping')` + 优雅返回(下次启动迁移后再建管理员),未知错误仍 `throw` 上抛;表存在的正常路径完全不变。**验证(全新空库 + 本地 prod 镜像 `tpprod/tp-*:local`)**:修复后顺序——起库→`run --rm migrate`(16 个迁移全建表成功)→起 api → api **首启即 healthy、0 重启、无 P2021**,`EmergencyAdminBootstrap` 成功建超管;额外验证 Part B 守卫——不迁移直接起 api,api 仍 healthy 0 重启,日志见 "schema not ready … skipping" 警告(`/healthz` 不打 DB)。typecheck + lint 全过。
- **fix(docker)：api 生产镜像用 `pnpm deploy` 产出自包含 node_modules,修运行时 `Cannot find module`(GAP#1)** —— `apps/api/Dockerfile.prod` 原 runtime 阶段只 `COPY apps/api/node_modules`(pnpm workspace 的 **符号链接农场**,指向根 `/app/node_modules/.pnpm` 真实存储),不带根 `.pnpm` → 镜像能 build 但启动即 `Cannot find module '@sentry/node'`(`bullmq`/`ioredis`/`prom-client`/`pino`/`prisma` CLI 全部悬空链接)。改为对齐 `docker/render.Dockerfile` 的做法:build 阶段 `pnpm --filter @template-printing/api deploy --prod /prod/api` 产出扁平、**全真实文件**的自包含 node_modules(prod 依赖 + workspace 包,无 .pnpm 悬空链接);runtime 阶段 `COPY /prod/api ./`。`--prod` 会剥掉 `prisma` CLI(devDependency),但 `scripts/deploy/{init,update}.sh` 的 `npx prisma migrate deploy` 需要它 → 在隔离目录 `npm install prisma@5.16.2` 后把真实文件并入 `/prod/api/node_modules`,并在 `/prod/api` 内 `prisma generate`;runtime 阶段加装 `openssl` apk 包,使 Prisma 正确探测 OpenSSL 3 并加载 `linux-musl-openssl-3.0.x` 查询引擎(否则默认 1.1.x 引擎 → "engines not compatible")。**连带修复**:`undici` 在 `apps/api/package.json` 误标为 devDependency,但 `lark-*.service`/`render-cleanup.service` 运行时 `import 'undici'`,`--prod` 剥掉后启动二次崩溃 → 移入 `dependencies`(同版本 6.19.8,lockfile 同步)。验证:镜像 build + `require(@sentry/node/bullmq/ioredis/prom-client/pino/undici)` 全过、`node_modules/.bin/prisma` 存在且 `prisma migrate status` 可执行到 DB 配置校验、`PrismaClient` 实例化无引擎报错、`node dist/src/main.js` 越过模块解析与 Prisma 引擎直达 `validateEnv`(仅因无 env 退出,符合预期)。不改镜像运行命令(仍 tini + `node dist/src/main.js`),不动 web/render Dockerfile。
- **批次1:远程可触达核心漏洞 安全加固(系统 review)完成** —— 依 `docs/superpowers/specs/2026-05-28-system-review-audit.md`(校验修订版)修复 6 项 + 1 项测试基建:**V1** 渲染 `GET /render/:jobId` IDOR 归属校验(详见 2026-05-27 条);**V2** 飞书机器人仅列/渲染 公共且已发布 模板(`lark-bot.controller` 抽 `BOT_TEMPLATE_WHERE` 共享过滤,picker/选择/入队前三处一致,堵越权渲染他人已发布私有模板);**V3** 两个 render-callback 在 `fs.readFile` 前加 `path.resolve().startsWith(STORAGE_ROOT+sep)` 路径穿越守卫(RED 测试实证读到 /etc/hostname);**V4** CORS 由 `origin:true` 改 `CORS_ORIGIN` env allowlist(回调式 origin 校验,保留 credentials,`configureApp` 抽到 `app-bootstrap.ts` 供测试与生产同路径);**V8** SVG 消毒去 `<style>` 标签/属性 + 去 `data:` scheme,uploads `.svg` 静态响应加 `Content-Disposition: attachment` + 严格 CSP;**V5** render-callback 独立 `RENDER_CALLBACK_SECRET` + 常量时间比较(详见下条)。**测试基建**:`configureApp` 移出 `main.ts` 顶层副作用至无副作用 `app-bootstrap.ts`,修 e2e 导入触发 `bootstrap()` 的环境泄漏。全量 api 测试 **36 套件 / 162 用例全绿**;不改入队 attempts/渲染视觉/前端。
- **fix(api)：render-callback 用独立 `RENDER_CALLBACK_SECRET` + 常量时间比较(安全加固 V5)** —— 原先 `LARK_BITABLE_VERIFICATION_TOKEN` 同时用于外部飞书 webhook(`printTrigger`)与内部 render worker→API 回调(`renderCallback`),复用一个 token 导致任一泄露即互相牵连;且校验用 `!==` 非常量时间比较。改:新增内部回调专用 `RENDER_CALLBACK_SECRET`(`env.ts` optional ≥16 chars),`printTrigger` 的 `callbackUrl` 改用该 secret 构造、`renderCallback` 改校验该 secret;新增模块级 `safeEqual()` 用 `crypto.timingSafeEqual`(先比长度再比内容),`printTrigger` webhook 校验与 `renderCallback` 校验均改常量时间。`printTrigger` 仍校验 `LARK_BITABLE_VERIFICATION_TOKEN`(外部 webhook 不变);保留 Task 3 的 path-traversal 守卫。新增 e2e `render-callback-token.e2e.spec.ts`(webhook token→401、callback secret→200);path-traversal e2e 改用新 secret 鉴权。`.env.example`/`docs/deployment.md` 同步。

### 2026-05-27

- **fix(api)：渲染任务读取加归属校验,修 `GET /render/:jobId` IDOR(安全加固 V1)** —— 原 `RenderService.get(jobId)` 仅 `findUnique({where:{id}})` 无任何归属/角色校验即返回 24h 签名下载 URL,任何持有 jobId 的登录用户/API token 都能读他人渲染任务及其下载链接(`listJobs` 早已按 owner 收敛,单条 GET 漏了)。`get` 改为接收调用方 `{sub,role}`:非 admin/emergency_admin 仅当 `job.template.ownerId === sub` 才可读,否则抛 404(不泄露存在性,与"不存在"同 404 而非 403);controller 复用已有的 `@CurrentUser()`/`JwtClaims` 传入。返回对象 shape 不变。e2e(`render-get-ownership.e2e.spec.ts`):B 读 A 的 job→404、A 读自己→200、admin→200。不动 `listJobs`/`enqueue`/其他端点。
- **fix:渲染页跳过 boot hydrate,消除 headless 渲染日志 401 噪声** —— `print-headless` 路由(`requiresAuth:false`,只渲染注入的 `__renderInput`)在 `router.beforeEach` 顶部早返回放行,跳过 boot 期 `auth.hydrate()`;否则无 cookie 的 headless 浏览器会发 `GET /users/me`(及其 401 触发的 `/auth/refresh`)产生两条 401 日志噪声 + 无用请求。原现象不影响出图(hydrate 吞掉 401),纯去噪 + 省请求。精确按 `to.name === 'print-headless'` 短路(不一刀切 `requiresAuth:false`,以免破坏 `/login` 首跳"已登录→重定向"依赖的 hydrate)。
- **feat:渲染 worker 健壮性强化(大批量并发)** —— ① `PuppeteerPool` 坏页/坏浏览器回收重建(per-slot 锁、同步清 idleQueue 旧页防并发 re-dispatch 死页、launch 退避重试、最终失败 reject waiter)+ acquire 超时 + 用量计数(防内存蠕变)+ closing 守卫,8 例单测(注入 fake launch,无需 Chromium);② worker 单 job 硬超时(成功 release/失败 recycle,recycle 再套 15s 超时防 page.close 卡死)+ bullmq `lockDuration` 对齐(不变量 lock≥acquire+render+余量,杜绝超时 job 被 stalled 重复派发);③ API 侧僵尸 `processing` 对账 cron(每 5 分钟,超 `RENDER_STUCK_TIMEOUT_MIN` 标 `stuck_timeout` + 补发回调,payload/callbackStatus/超时对齐 worker)+ e2e;④ `deviceScaleFactor` env 可配 + `--disable-extensions` + 并发/内存文档。双层防御(worker 实时自愈 + cron 兜底),不引入新依赖、不动 `--no-sandbox`/入队 attempts/渲染视觉结果。
- **fix：设计器缩放改为纯视觉缩放(通用)** —— 画布元素改为固定 intrinsic 比例(`PX_PER_MM=4`)渲染、整张纸套 `transform: scale(zoom)`(外层 frame 预留缩放尺寸,`paperRef` 仍指向被 transform 的纸),修复非 100%(如 66%)缩放时字体不随盒子缩放导致的文本重叠/异常换行。任何比例下排版与 100%(=实际打印产出)完全一致;拖拽/缩放/拖放/吸附/属性编辑不受影响(坐标基于屏幕像素÷(4×zoom),对缩放方式不敏感);打印前已强制 zoom=1(transform=none),无副作用。不改渲染器/预览/打印/模板数据。
- **feat：账号内部/外部双类型 + 身份展示 + 权限强制** —— 账号收敛为两类互斥(飞书SSO=内部 / 本地账号密码=外部,初始账号=内部超管);`isInternal` 纯派生(`larkOpenId != null || role==='emergency_admin'`,无新增分类列)。User 加 `mobile`(飞书登录同步)、`externalCode`(外部建号分配 `W`+8位、事务 advisory-lock max+1)两可空列(additive 迁移)。个人中心按类型展示:内部(SSO)用户名/手机/邮箱只读、唯一ID=工号,无密码区/无解绑;外部用户名(name)+邮箱可编辑、显示只读登录账号(localUsername)与唯一ID(externalCode),有改密。权限:外部禁签发 API token(`ApiTokenService` 403 + `ApiAuthGuard` 兜底)、禁被授权 admin(`changeRole` 403 `external_cannot_be_admin`);公共可见性仍仅 admin(create/update 不可设 public,已加回归测试)。"应急管理员"更名「超级管理员」(仅展示、不可经 UI 分配,外部账号禁选「管理员」);用户列表/类型筛选改为内部/外部。移除会死锁的「解绑飞书」(`DELETE /me/lark-binding` + 前端 UI),`setPassword` 改为仅改密(去 `local_username_required` 死分支)。
- **chore：移除模板中心失效的「分类筛选」下拉** —— `TemplatesView` 的 `categoryFilter` 下拉是从未接通的死 UI(值从不被读取、`fetchSlice` 仅传 search/sort,模板亦无 category 字段,选项为写死猜测值)。删除 `categoryFilter` ref + `<select>`。如未来需要真正的分类,应做完整版(可查询的分类列/标签 + 设计器写入 + 服务端 where 过滤),而非保留占位。
- **feat：字段缺省值默认改空 + 属性面板可编辑(通用)** —— 字段(field)的「缺省值 `fallback`」默认值由 `—` 改为空字符串(`packages/schema` + `elementFactory`),真实输出(预览/打印/渲染,`FieldElement` `designMode=false`)空数据时不再显示横线 `—`、改为留空;设计器画布(`designMode=true`)仍显示 `{{ binding }}` 占位。属性面板新增 field「缺省值」输入框(`setFallback`),可清空旧模板里残留的 `—` 或填自定义占位(如 N/A)。schema 补默认值断言测试。系统其他位置(模板列表/飞书卡片)的 `—` 占位不在此次范围。
- **fix：上划线/删除线恢复 + 上传图片 dev 显示(通用)** —— ① 上一轮把下划线改 `border-bottom` 时,`TextElement` 的 `containerStyle` 统一 `delete textDecoration`,而 `runStyle` 只对 `underline` 补回 → `overline`/`line-through` 丢失。`runStyle` 改为按 `textDecoration` 分支:`underline` 仍走 border-bottom(需延长+间距),`overline`/`line-through` 重新用原生 `text-decoration`。② 上传图片回显"图片加载失败":上传产物 URL 为 `/uploads/<file>`,生产由 API `ServeStaticModule` 同源服务,但 dev 下 Vite 只代理 `/api/` → `/uploads/*` 落到 SPA fallback 返回 HTML。`vite.config.ts` proxy 增加 `/uploads/` 转发到 API(不 rewrite),使 dev 与生产一致(改 vite 配置需重启 web dev server 生效)。两者通用、不改后端/模板数据。
- **fix：未发布模板版本标签 + 下划线对称延长(通用)** —— ① 设计器子标题去掉冗余的 `V{meta.version}`(元数据版本恒为 1、与发布无关),未发布模板改显示"未发布"(发布状态由 `saveCaption` 提供);② `TextElement` 下划线由 `text-decoration` 改为 `border-bottom` + 左右各 `0.5em`(随字号)padding 延长 + 底部 `0.15em` 间距 → 居中即左右对称延长(贴近实物),Chromium 实测左右延长各 112px 相等。通用、不改模板数据。
- **fix(renderer)：文字元素对齐 + 下划线左右完全对称(通用,全模板生效)** —— `TextElement`(设计器画布/打印/预览复用同一组件):① center/right + 字间距时**拆分末字**——"除最后一字外"加 `letter-spacing`、末字不带尾部字距,使整段盒宽=真实字形范围、无尾部多余间距 → 字形与下划线一起左右对称(Chromium 实测左右边距 124px=124px,误差 0);② `textAlign='justify'` 改用**真·分散对齐**(`text-align: justify; text-align-last: justify` 块级,原先被映射成无效的 flex space-between);③ 有下划线时加 `text-underline-offset: 0.15em` 与字体留间距。不改任何模板数据。
- **fix(templates)：公共模板库缩略图/预览可显示** —— 卡片缩略图(`TemplateThumb`)走 `GET /templates/:id/versions/:version`,原 `getVersion` 仅 owner 可读,导致公共模板(属他人)取版本 404、预览空白。放宽为「本人模板任意版本 **或** 公共模板的已发布版本」可跨 owner 读;私有模板 / 公共模板的非发布版本对他人仍 404。e2e 补 2 例(公共已发布版可读 / 私有版本 404)。
- **feat：模板分享 / 公共模板库** —— `Template` 加 `visibility`(private/public)。新增三端点(均不带 ownerId 过滤):`GET /templates/public`(列已发布的公开模板,跨 owner,作者名 `User.name` 可空时兜底 `—`,默认按 updatedAt;搜索仅 name)、`PATCH /templates/:id/visibility`(仅 `admin`/`emergency_admin`,设 public 要求已发布否则 400)、`POST /templates/:id/copy`(任意登录用户:取源最新发布版 data → 我名下私有新草稿 `publishedVersion=null`、`hasUnpublishedChanges=true`)。copy 取版本走 `publishedVersion` 列 + `templateId_version` 唯一键(非 max)。前端模板中心加「我的/公共」tab、公共库只读卡片 + 「复制到我的」、admin 🌐 公开开关(grid+list,未发布提示先发布)。e2e 8/8(含跨 owner 复制、403/400/404、作者名兜底)。
- **perf(docker)：render 生产镜像 Alpine 瘦身** —— `docker/render.Dockerfile` 由 `node:20-bookworm-slim` 改为多阶段 `node:20-alpine` + 系统 Chromium(apk),`PUPPETEER_SKIP_DOWNLOAD` 不下载 puppeteer 自带 chromium。node_modules 改用 `pnpm deploy --prod` 产出**自包含、仅生产依赖**目录(修掉原先直接 copy pnpm 软链运行期断链的隐患 —— 旧镜像其实从未真正运行过)。字体只留 `font-noto-cjk`(去掉 emoji 与 `fonts-noto-cjk-extra` 生僻字);apk 源走 aliyun(`ARG APK_MIRROR` 可覆盖海外),顺带解掉「bookworm+aliyun apt 源 CI 易失败」。体积:解压 ~2.1GB → ~1.0GB、压缩拉取 ~429MB;本地已验证 Chromium 148 启动 + 中文 PDF/PNG 渲染(思源黑体不缺字)。

### 2026-05-26

- **fix(test)：refresh-token-service.spec 不再清空全表** —— 该 spec 原在 beforeAll/afterAll 无条件 `prisma.user.deleteMany({})`,对 dev/共享库跑 e2e 会连真实 `admin` 一起删除,随后被 emergency-admin bootstrap 以 `INITIAL_ADMIN_LOCAL_PASSWORD` 默认密码重建(导致此前用密码失效、登录 401)。改为只创建/清理本测试自己的用户(按 `userId` 范围删除)。
- **style(web)：页面表头红线全站统一** —— 红色签名线收进全局 `.page-bar .page-title`(`border-top` + `align-self:stretch` 落顶边;`.page-bar` 去左 padding + `gap:0` 使标题区左缘贴侧边栏、右缘抵灰色分隔线;`.page-title` 左右等距 padding 使「图标+页面名」相对红线水平居中),删除 ApiView/UsersAdminView/AuditLogView 三处重复的 `.page-bar::before`。此前三页有红线、三页无,且为定宽 96px 短线。
- **feat：个人中心可编辑邮箱** —— 「账号信息」卡用户名下方新增「邮箱 · Email」行(行内编辑,与用户名一致的笔形按钮 + 保存/取消);后端 `PATCH /users/me/profile` 的 DTO 扩为 `name`/`email` 均可选(至少一项),`email` 空字符串→清空(null)、非空校验合法格式,审计 details 记录新旧邮箱。
- **feat(web)：首登改密弹窗扬力品牌改造** —— `MustChangePasswordDialog` 由 Element Plus `ElDialog`(通用蓝 + 灰边框)改为自绘 Teleport 模态(`handoff/target-first-password.html` 目标稿):480px paper-white 容器 + 2px 红签名线 + ink 遮罩;mono eyebrow / han 标题层次;42px 输入框红色 focus(无蓝 ring)+ lucide eye 显隐切换;新密码强度计(4 段 红/琥珀/绿)+ 校验清单(≥8/字母/数字/符号)+ 再次输入不一致内联红字;强制改密故移除"稍后再说"。颜色/字体/radius 全走 `colors_and_type.css` 变量。
- **fix(web)：首登改密弹窗不再浮在错误页上** —— `AppShell` 仅在非全屏路由(排除登录/回调/打印及 401/403/404/500)渲染 `MustChangePasswordDialog`;此前 must-change 用户手输错误 URL 进 404 时改密表单仍叠加在错误页上。改密入口在真实页面保留(错误页点"回到模板中心"即恢复)。
- **登录页"假控件/假数据"转真实** —— ①"保持登录 30 天"接通：cookie helper 实现 remember 语义（不勾 = session cookie、勾 = 30d 持久 + `tp_remember`），`/auth/refresh` 读 `tp_remember` 延续、`/auth/logout` 清理；②新增 `@Public` 端点 `GET /stats/overview`（近 30 天全部 render_jobs 计数 / done 任务 P50 渲染耗时 / 成功率，60s 内存缓存），登录页三指标改为真实拉取，失败或无数据显示 `—`。
- **用户管理（CRUD + 禁用/角色即时生效 + 本地登录打通）**（spec+plan：`docs/superpowers/{specs,plans}/2026-05-26-user-management*`）
  - 新增 `apps/api/src/users/` 模块（admin 守卫 `@Roles('admin','emergency_admin')`）：`GET /admin/users`
    （服务端分页 + 搜索 name/localUsername/email/larkUserId + 过滤 role/status/type；每行带 `can{disable,
    changeRole,resetPassword}` + `disabledReason`，前端仅据此置灰，后端权威校验）、`POST /admin/users`
    （新建本地账号，系统一次性密码 + `mustChangePassword`，撞名 409）、`PATCH :id/role`、
    `POST :id/reset-password`（仅本地账号）、`POST :id/disable|enable`。审计 dot 命名 `user.create/role.change/
    password.reset/disable/enable`。
  - **禁用/降级即时生效**：新增 `UserStateService`（进程内 TTL 10s 缓存 `{role,disabledAt}`，主动 `evict`）；
    `JwtAuthGuard` 改 async + `ApiAuthGuard` cookie 路径复用同一校验：用户不存在/被禁用→401，用 DB 最新 role
    覆盖 JWT role；禁用时吊销该用户全部 refresh + API token（`revokeAllForUser`）并 evict → 下一请求即生效
    （cookie / refresh / Bearer 三路径均拦截）。Bearer 路径在 `ApiTokenService.verify()` 查 `owner.disabledAt`。
  - **本地登录打通**：`/auth/local/login` 放开 emergency_admin 限制，任意未禁用 + 有 `localPasswordHash` 的用户
    均可登录、按**真实 role** 签发；禁用拒绝。
  - **安全规则（service 权威 + 事务）**：不能操作自己 / emergency_admin 受保护 / 不能降级或禁用最后一个活跃
    `role==='admin'`（`SELECT … FOR UPDATE` 行锁事务，真并发测试验证不归零）/ 角色仅 `user↔admin`。
  - **飞书与 localUsername 解耦**：飞书 SSO 建号不再写 `localUsername=user_id`（迁移清理历史 dev 数据）；
    `/users/me/password` 去掉 `larkUserId` 兜底（无 localUsername 返回 `local_username_required`，保留已有的不破坏 emergency_admin 改密）。
  - 前端 `UsersAdminView` 占位 → 真实页（过滤/分页/能力位置灰/新建+重置一次性密码弹框/禁用启用确认）；
    `MustChangePasswordDialog` 文案中性化（初始/临时密码）。
  - 验证：jest e2e 真实 DB **24 suites / 114 tests 全绿**（含 user-state、本地登录、users 列表/新建/改角色并发/重置/禁用三路径拦截）；
    Playwright：能力位后端驱动置灰（emergency 禁用灰 vs 新建用户可用）、新建→一次性密码、A3↔A4 cookie 路径一致禁用 401。
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
| ~~Render 容器镜像 ~2.1GB~~ | ✅ 已优化 | 改 Alpine 多阶段 + 系统 Chromium：解压 ~1.0GB / 压缩 ~429MB（2026-05-27） |
| ~~生产 render Dockerfile 用 bookworm + aliyun mirror~~ | ✅ 已解决 | 改 Alpine + apk aliyun 源（`ARG APK_MIRROR` 可覆盖海外） |
| ~~飞书未设密码用户解绑~~ | ✅ 已解决 | 2026-05-27 账号双类型重构:SSO=内部不再设本地密码,「解绑」语义消失、入口移除,死锁消除 |
| ~~渲染任务无重试~~ | ✅ 已解决 | iter 31：bullmq `attempts:3` + 指数退避 + 永久错误 `UnrecoverableError` |
| ~~渲染输出 URL 可猜测~~ | ✅ 已解决 | iter 31：HMAC signed URL + 过期（`FileSigService` / `/uploads/render/*`） |
| ~~Admin 用户管理后台仅占位~~ | ✅ 已解决 | 2026-05-26：列表/新建本地/改角色/重置密码/禁用启用 + 降级即时生效 |
| ~~Render 输出 quota 无限制~~ | ✅ 已解决 | iter 31：user 日配额 + cron 清理过期输出 |

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
| ~~Admin 用户管理 CRUD~~ | ✅ 已完成（见下方 2026-05-26 近期变更）：列表/新建本地/改角色/重置密码/禁用启用 + 禁用降级即时生效 | `apps/api/src/users/` + `views/admin/UsersAdminView.vue` |
| ~~生产 render Dockerfile 优化~~ | ✅ 2026-05-27：多阶段 Alpine + 系统 Chromium + `pnpm deploy`，解压 ~1.0GB / 压缩 ~429MB | `docker/render.Dockerfile` |
| ~~模板分享 / 公共模板库~~ | ✅ 2026-05-27：`visibility` + `/templates/public`、`:id/visibility`(admin)、`:id/copy`；模板中心我的/公共 tab + 复制 + admin 开关 | `apps/api/src/templates/` + `TemplatesView.vue` |
| **首次生产部署 / 验证** | 项目尚未部署过；需在类生产环境跑通 compose / CI deploy，验证迁移、worker、飞书回调 | `docker-compose` + `.github/workflows/deploy.yml` |

---

**修改本文件规则**：每次迭代收尾或重大修复完成时，按 `AGENTS.md` 第 9 节触发映射表追加第 3 节"近期变更"，并同步更新顶部"最近更新"日期。第 2 节"已交付能力"应只反映**当前主分支真实代码状态**，不写 WIP 或未合并内容。
