# PROGRESS.md

> 仓库当前事实进度。已交付能力 + 近期重大变更 + 后续计划。
> **变动频率**：每次迭代收尾或重要修复后追加。
> 详细协作规则见 [`AGENTS.md`](../AGENTS.md)。

**最近更新**：2026-05-24（iter 29 渲染日志 + API Token 管理）

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
| **渲染日志 + API Token 管理（Bearer）** | ✅ 已完成 | iter 29（最新） |
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
| **Admin 用户管理 CRUD** | 列表 / 新建（本地账号） / 改角色 / 重置密码 / 禁用 | `apps/api/src/users/` 新模块 + `views/admin/UsersAdminView.vue` |
| **渲染任务历史 / 我的渲染任务** | 用户在 `/me` 看自己发起的渲染任务列表 + 重新下载 | `apps/api/src/render/` 加 list 端点 + 新 view |
| **渲染失败重试策略** | bullmq job options：`attempts: 3` + 指数退避；错误分类（暂时性 vs 永久性） | `apps/render/src/main.ts` + `render.service.ts` |
| **Signed URL** | 渲染输出 URL 带 HMAC 签名 + 过期时间，防止猜测越权 | `apps/api/src/render/` + Nginx 配合 |
| **渲染 quota 与计费** | user-level 月配额 + 磁盘清理策略（>30 天自动删） | DB schema + 定时 job |
| **生产 render Dockerfile 优化** | 改用多阶段 Alpine 或国内镜像，将镜像缩到 < 1GB | `docker/render.Dockerfile` |
| **多维表格回写示例** | 飞书 SDK 接入：上传文件到云空间 → 写附件字段 → 触发通知 | `apps/api/src/lark/` 增补 |
| **模板分享 / 公共模板库** | 模板支持公开 / 团队共享；公共模板复制到自己账号 | DB 加 `visibility` 字段 + 列表 view 增 tab |

---

**修改本文件规则**：每次迭代收尾或重大修复完成时，按 `AGENTS.md` 第 9 节触发映射表追加第 3 节"近期变更"，并同步更新顶部"最近更新"日期。第 2 节"已交付能力"应只反映**当前主分支真实代码状态**，不写 WIP 或未合并内容。
