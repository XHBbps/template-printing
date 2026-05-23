# PROGRESS.md

> 仓库当前事实进度。已交付能力 + 近期重大变更 + 后续计划。
> **变动频率**：每次迭代收尾或重要修复后追加。
> 详细协作规则见 [`AGENTS.md`](../AGENTS.md)。

**最近更新**：2026-05-23（iter 26 E2E smoke 通过 + RAF 同步 bug 修复）

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
| **异步渲染服务（队列 + worker + webhook + API 文档）** | ✅ 已完成 | iter 26（最新） |
| 部署：阿里云 ACR + ECS + GitHub Actions | 🟡 框架就绪 | iter 19，待外部条件（域名 / 备案 / 飞书应用） |
| 飞书机器人接入示例 | ⏳ 待开始 | 见第 5 节 |
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
| **飞书机器人调用方接入示例** | 完整 demo：从飞书多维表格触发 → 调 `/api/render` → 等 webhook → 上传附件回飞书 | 新建 `examples/` 目录 + ApiDocsView 增补 |
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
