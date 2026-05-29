# AGENTS.md

> **仓库范围**：`E:\Ai_project\template_printing` — 独立仓库（pnpm + turbo monorepo），不是上层多项目工作区入口。
> **本文件性质**：长期稳定的协作规则和文档入口，**变动较少**。短期目标、当前进度、具体迭代细节均在 `docs/` 下。
>
> 每次进入仓库先读本文件，再按"默认阅读顺序"继续。

---

## 1. 仓库定位

`template-printing` 是面向**团队（1-20 用户）**的模板设计与打印平台，定位类似 vue-plugin-hiprint，但更聚焦、深度集成飞书。

**核心业务流**：

```
栅格化设计器（设计模板）→ 保存模板 JSON（Prisma） →
  浏览器内打印 / 异步渲染（Puppeteer → PDF / PNG） → 文件落地 storage / 回写飞书多维表格
```

**典型用途**：

- 出入门证、出库单、快递面单、价签、二维码贴纸等中小批量打印
- 飞书机器人/多维表格自动拉数据 + 异步渲染后回写附件

**规模约束**：

- **对公网开放**（飞书自建应用要求 HTTPS 公网回调；部署在阿里云 ECS + ICP 备案）
- 用户数 1-20 人
- 单机 Docker Compose 部署（postgres / redis / api / web / render）
- 单库容量可容纳；渲染 worker 走队列横向扩展

---

## 2. 目录结构

```
template_printing/
├── apps/
│   ├── api/                       # NestJS 后端（auth / templates / render / lark / uploads）
│   │   ├── src/
│   │   │   ├── auth/              # JWT + refresh token + 飞书 SSO + 本地登录 + UserStateService
│   │   │   ├── users/             # 用户管理 CRUD（admin）：列表/新建本地/改角色/重置密码/禁用启用
│   │   │   ├── templates/         # 模板 CRUD
│   │   │   ├── render/            # 渲染任务入队 + 状态查询
│   │   │   ├── stats/             # 公开运营指标聚合（GET /stats/overview，近30天渲染量/P50/成功率）
│   │   │   ├── uploads/           # 图片上传（multer + 白名单）
│   │   │   ├── lark/              # 飞书 IM 通知
│   │   │   ├── common/            # logger / security headers / 公共中间件
│   │   │   ├── health/            # /healthz
│   │   │   └── prisma/            # PrismaModule
│   │   └── prisma/                # schema.prisma + migrations/
│   ├── web/                       # Vue 3 + Vite 前端
│   │   └── src/
│   │       ├── designer/          # 设计器（CanvasElement / ElementGrip / SnapGuides …）
│   │       ├── views/             # TemplatesView / DesignerView(inline) / PreviewView / LoginView / MeView / ApiDocsView / PrintHeadlessView / admin/UsersAdminView
│   │       ├── layout/            # AppShell + AppSidebar
│   │       ├── stores/            # Pinia: auth / designer
│   │       ├── router/            # vue-router + beforeEach 鉴权 / 角色
│   │       ├── lib/               # apiFetch（带 401 自动 refresh）
│   │       ├── styles/            # designer.css / print.css / transitions.css
│   │       └── components/        # 通用组件
│   └── render/                    # Puppeteer worker（bullmq 消费者）
│       └── src/
│           ├── main.ts            # Worker bootstrap
│           ├── db.ts              # pg 直连：fetchJob / fetchTemplate / mark*
│           ├── renderer.ts        # page.goto print-headless → page.pdf + screenshot
│           ├── puppeteer-pool.ts  # 多 page / 多 browser 池
│           └── webhook.ts         # 完成/失败回调 callbackUrl
│
├── packages/
│   ├── types/                     # 共享 TS 类型
│   ├── schema/                    # 共享 zod schema（Template / Element）
│   └── template-renderer/         # 前后端共享 Vue 渲染组件（设计器预览 + headless 都用）
│
├── docker/                        # Dockerfile（api / web / render + nginx 反代配置）
├── docker-compose.dev.yml         # 本地开发栈
├── docker-compose.prod.yml        # 生产部署栈
├── deploy/                        # 服务器侧部署脚本
├── scripts/                       # 工程脚本
├── storage/                       # 上传 + 渲染输出（Git 忽略）
├── docs/                          # 文档（短期目标与当前事实所在位置）
├── .github/workflows/             # CI / 部署 / 发布
├── .claude/skills/                # speckit 本地 skill
├── .specify/                      # spec 工作流目录
├── CLAUDE.md                      # Claude Code 自动加载的精简约束
├── AGENTS.md                      # 本文件
└── README.md                      # 仓库 Quickstart
```

---

## 3. 技术栈

| 层 | 技术 |
|---|---|
| 后端 | Node.js 20 / NestJS 10 / TypeScript 5 / Prisma 5 / Pino / bullmq |
| 前端 | Vue 3 / TypeScript 5 / Vite 5 / Pinia / Vue Router 4 / Element Plus / lucide-vue-next |
| 渲染 | Puppeteer + Chromium / bullmq Worker / 自实现 puppeteer-pool |
| 数据库 | PostgreSQL 16（Prisma 客户端，开发用 docker `postgres:16-alpine`） |
| 队列 | Redis 7 + bullmq |
| 设计器 | 自研 mm-anchor schema + 栅格化 + zod 校验 |
| 条码/二维码 | bwip-js（1D） + qrcode-generator（QR） |
| 外部集成 | 飞书自建应用（SSO + IM 通知 + 多维表格回写） |
| 工程 | pnpm 9 / turbo 2 / husky + lint-staged / ESLint / Prettier / Vitest |
| 部署 | Docker Compose v2 + Nginx + 阿里云 ACR + ECS / GitHub Actions |

**技术栈变动频率**：低。若添加新的主要依赖或替换核心框架，属于架构变更，需更新本节 + 对应迭代设计 spec。

---

## 4. 文档地图

**AGENTS.md 是长期协作规则，短期信息全部在 `docs/`**。

| 文档 | 定位 | 变动频率 |
|---|---|---|
| `AGENTS.md`（本文件） | 仓库协作入口，长期规则 | 低 |
| `CLAUDE.md` | Claude Code 自动加载的精简约束（指向 AGENTS.md） | 低 |
| `README.md` | 仓库 Quickstart（本地启动 + 测试命令） | 低 |
| `docs/PROGRESS.md` | 已交付能力 + 近期重大变更 + 后续计划 | **高**（每次迭代交付） |
| `docs/PRE_DEPLOYMENT_CHECKLIST.md` | 上线前外部准备（域名 / 备案 / 飞书应用 / GitHub Secrets） | 中（上线前 / 配置变化时） |
| `docs/deployment.md` | 部署流程与环境变量说明 | 中（部署配置变更时） |
| `docs/qa/` | 模块验收清单（功能 + 手动 UX 走查） | 中（每次大版本验收时） |
| `docs/superpowers/specs/` | 各迭代设计稿（用户审过后落盘） | 每迭代新增 |
| `docs/superpowers/plans/` | 各迭代实施计划（spec → plan → execute） | 每迭代新增 |
| `docs/demos/` | UX 方案 mockup HTML（多方案对比时） | 偶发 |

---

## 5. 默认阅读顺序

1. **AGENTS.md**（本文件）— 协作规则、文档入口、同步协议
2. **`docs/PROGRESS.md`** — 当前事实进度和近期变更
3. **`docs/superpowers/plans/` 下最新计划** — 若延续上一迭代或开始新迭代
4. **`docs/superpowers/specs/` 下对应 spec** — 若涉及该迭代设计意图
5. **`README.md`** — 若需要本地启动
6. **`docs/PRE_DEPLOYMENT_CHECKLIST.md` / `docs/deployment.md`** — 若涉及部署 / 环境变量

敏感明文（飞书 secret / DB 密码 / JWT secret）**永不**进入可提交文档；本地 `.env` 被 `.gitignore` 忽略，仓库内只保留 `.env.example`。

---

## 6. 协作原则

### 6.1 核心原则

**需求不明确时，先澄清再动手。** 设计器和认证已较稳定，小改动也要避免误改现有流程；尤其是动到 Template JSON schema / 鉴权 / 渲染流水线时。

### 6.2 输出原则

- **执行类任务**：直接说明改了什么、为什么改、文件路径 + 行号
- **方案类任务**：先给结论，再说明取舍
- **多方案**：最多 3 个，并明确推荐项
- **发现风险、口径冲突、文档失真**：直接指出

### 6.2.1 执行连续性

- **默认连续执行**：用户给出执行类任务后，Agent 应持续推进到可验证的最终结果，不在每个中间步骤反复请求确认。
- **提权操作**：遇到需要提升权限、网络访问、推送、部署、运行受限命令等平台权限场景时，Agent 直接发起对应授权请求并说明用途；不额外用文字反复询问是否继续。
- **仅在高风险时停下确认**：涉及破坏性操作（删除数据、强制覆盖、回滚生产、重写远端历史、`prisma migrate reset` 等）、需求口径明显冲突或缺少关键信息导致无法安全判断时，才暂停并向用户确认。
- **直到最终输出**：授权通过后继续执行验证、文档同步、提交、收尾检查，最后一次性汇报结果、阻塞点和必要的后续动作。

### 6.3 代码原则

- **最小化改动**：只改和当前任务直接相关的部分，不顺手大改、不引入未请求的抽象
- **复用优先**：先查 `@/lib/*`、`@/components/*`、`packages/schema`、`packages/template-renderer` 是否已有实现
- **中文展示**：面向用户的页面文案、状态文案、错误提示优先使用中文；按钮/菜单/标题用动词短语
- **字段分层**：内部模型、API、Prisma 字段保持英文（`snake_case` DB / `camelCase` Code）；界面展示用中文
- **保持现状一致**：遵循现有模块边界（NestJS module / Vue view 目录）和命名风格，不擅自重构目录
- **不添加未经请求的功能**：只实现被要求的改动，不做推测性优化

### 6.4 前端约定

- 路由集中在 `apps/web/src/router/index.ts`，鉴权与角色守卫只走 `beforeEach`，不在组件内重复
- 全局布局由 `layout/AppShell.vue` + `layout/AppSidebar.vue` 提供；新建独立页面（如 login / print-headless）需在路由 meta 上设 `fullscreen: true`
- 路由 meta 用 `requiresAuth` / `adminOnly` 控制访问；admin 同时包含 `'admin'` 与 `'emergency_admin'` 两个 role
- Pinia store 拆按业务域：`stores/auth.ts`（鉴权） / `stores/designer.ts`（设计器，含 templateId / saveStatus / panMode / view.zoom 等）
- API 调用统一走 `lib/api.ts` 的 `apiFetch`（含 CSRF、401 自动 refresh、JSON parse）
- 设计器 mm-anchor schema：每个元素都有 `anchor: { x, y, w, h }`（mm 单位），渲染时由 PX_PER_MM × zoom 映射到 px
- `@media print` 全局规则在 `styles/print.css`（隐藏 sidebar / breadcrumb / 浮动 toolbar；重置 canvas host）

### 6.5 后端约定

- NestJS module 按业务域拆：`auth / templates / render / uploads / lark / health / common / prisma`
- Controller 只做 DTO 校验 + 调用 service；Service 调用 Prisma；**Controller 不直接写 Prisma 查询**
- DTO 校验优先用 zod（与 `packages/schema` 共享） + `ZodValidationPipe`，避免与 class-validator 混用
- 鉴权统一走 `@CurrentUser()` / `JwtAuthGuard` / `RolesGuard`；公共端点显式 `@Public()`
- 长任务（PDF / PNG 渲染）一律入 bullmq 队列，**不在请求线程内同步执行**
- 飞书 app secret 经 env `LARK_SSO_APP_SECRET` 注入（单一全局 app），不入 DB / 不入仓库；敏感字段（password / secret / token）不打日志
- 日志用 `nestjs-pino`；敏感字段（password / secret / token）不打日志

### 6.6 渲染 worker 约定

- worker 通过 postgres 直连（`pg`）+ bullmq 消费者运行；**不依赖** NestJS 容器
- 每个 job 流：`markProcessing` → `puppeteer page.goto /print-headless/:id` → 注入 `window.__renderInput` → 等待 `window.__renderReady` → `page.pdf` + `page.screenshot` → 落地 storage → `markDone` → `sendCallback`
- 失败时 `markFailed(errorMsg)` + `sendCallback(status='failed')`，**不重试**（重试策略待后续迭代）
- 容量由 `RENDER_BROWSERS × RENDER_PAGES_PER_BROWSER` 控制（env）

---

## 7. 测试与校验

### 7.1 全仓 turbo 命令（在仓库根）

```bash
pnpm install                       # 装依赖（必须 pnpm，不要用 npm / yarn）
pnpm typecheck                     # 全部 typecheck（必须通过）
pnpm lint                          # ESLint
pnpm test                          # 单元测试（Vitest）
pnpm build                         # 全部构建
```

### 7.2 数据库迁移

```bash
# 开发：创建迁移并应用（在 apps/api 下）
pnpm --filter @template-printing/api db:migrate:dev -- --name <name>

# 生产/CI：仅 apply 已存在的迁移
pnpm --filter @template-printing/api db:migrate:deploy
```

**永远不要**在仓库里运行 `prisma migrate reset` / `db push --accept-data-loss`，会丢生产数据。

### 7.3 Docker 本地栈

```bash
docker compose -f docker-compose.dev.yml up -d                # 全栈起
docker compose -f docker-compose.dev.yml logs -f api          # 看 api 日志
docker compose -f docker-compose.dev.yml restart render       # render worker 重启
```

健康检查：

- `http://localhost:3000/healthz`（API）
- `http://localhost:5173/`（Web，Vite dev）
- render worker 启动日志应出现 `pool ready (capacity=N)`

### 7.4 端到端验证（每个迭代收尾时）

- 浏览器内打印：模板列表 → 打开 → `Ctrl+P` 预览 → 只看到纸张内容，不含 sidebar / toolbar
- 异步渲染：POST `/api/render` → 轮询 GET `/api/render/:jobId` → 拉 `/uploads/render/:id.pdf` 校验内容完整
- 鉴权：飞书 SSO 登录 / 本地 emergency_admin 登录 / refresh 链路 / logout 后按返回不能复活

---

## 8. Git 规范

- **Commit 前缀**：`feat:` / `fix:` / `refactor:` / `docs:` / `test:` / `chore:` / `perf:`
- **Commit 消息**：前缀 + 简洁中文描述（必要时附"根因 — 修复"）
- **作用域**（可选）：`feat(designer):` / `fix(auth):` / `feat(render):` / `feat(api):` / `feat(web):` / `feat(db):` / `docs(plans):`
- **分支命名**：`feature/<功能名>` / `fix/<问题>` / `refactor/<范围>`
- **提交粒度**：一个完整功能或一个完整修复对应一个 commit；迭代内按 task 切多个 commit
- **禁止**：
  - `--no-verify`（跳过 git hooks）
  - `-c commit.gpgsign=false`（跳过签名）
  - `--force` 推送 main / master
  - 提交 `.env`、`storage/`、`.pgdata/`、`.redisdata/`、`node_modules/`、`apps/web/test-results/`
- **GitHub 同步**：每个版本（迭代收尾）push 到 GitHub；CI（lint + typecheck + test + Docker build）必须通过

---

## 9. 文档同步协议（强制）

> **核心原则**：AGENTS.md 是长期规则，短期事实在 `docs/`。代码变动后，**必须**通过本协议同步对应文档，否则任务不算完成。

### 9.1 触发映射表

| 代码变更类型 | 必须同步的文档 |
|---|---|
| **新增 / 删除 API 端点** | `docs/PROGRESS.md` 第 2 节已交付能力 + 对应迭代 plan 中"接口清单" |
| **新增 / 删除前端 view / 路由** | `docs/PROGRESS.md` 第 2 节 + `AGENTS.md` 第 2 节目录结构（若新增 view 目录） |
| **数据库 migration（新增/修改表或字段）** | `docs/PROGRESS.md` 第 3 节近期变更 + 对应迭代 spec 中"数据模型" |
| **新增 / 删除 NestJS module** | `AGENTS.md` 第 2 节目录结构 + `docs/PROGRESS.md` 第 2 节 |
| **Designer schema（Template JSON）变化** | `packages/schema/` 同步 + `docs/PROGRESS.md` 第 3 节 + 对应迭代 plan |
| **新增 / 删除环境变量** | `.env.example` + `docs/deployment.md` + `docs/PRE_DEPLOYMENT_CHECKLIST.md`（若涉及生产 secret） |
| **Docker 服务增删 / Dockerfile 调整** | `docs/deployment.md` + `README.md` Quickstart（若影响本地启动） |
| **CI / GitHub Actions 变化** | `docs/PROGRESS.md` 第 3 节 + 必要时新增 `docs/` 子文档 |
| **渲染流水线（puppeteer / 队列 / webhook）变化** | `docs/PROGRESS.md` 第 3 节 + `apps/web/src/views/ApiDocsView.vue` 调用文档同步更新 |
| **鉴权 / 角色 / SSO 流程变化** | `docs/PROGRESS.md` 第 3 节 + 对应迭代 spec |
| **技术栈依赖新增 / 主要版本升级** | `AGENTS.md` 第 3 节 + `package.json` |
| **目录结构调整** | `AGENTS.md` 第 2 节 + `README.md` 仓库结构段 |
| **协作规则 / 代码约定变化** | `AGENTS.md` 第 6 节（同步更新本文件） |

### 9.2 关闭清单（每次任务完成前自检）

```
[ ] 代码改动是否触发 9.1 中的任何一条？
[ ] 若触发：相应文档是否已同步更新？
[ ] 若未同步：说明为什么不需要（例如仅内部重构无语义变化）或立即补写
[ ] 文档更新是否保持格式一致（表格、层级、UTF-8 编码）？
[ ] docs/PROGRESS.md 的"最近更新"日期是否同步为本次任务日期？
```

### 9.3 文档写作规范

- **只写已确认事实**，不写猜测或未来计划（未来计划放在 `docs/PROGRESS.md` 第 5 节"后续计划"）
- **保持 UTF-8 编码**，避免乱码（若 Edit/Write 工具无法匹配，先用 Read 确认当前编码状态再改）
- **引用代码时附带文件路径**（`apps/api/src/render/render.service.ts:42`），方便检索
- **表格优先于长段落**，便于扫描
- **章节层级不超过 3 级**（`##` / `###` / `####`），避免过度嵌套
- **中文标点符号**：正文使用中文标点（`，。：；""''`），代码/命令保留英文标点

### 9.4 文档之间的关系

```
AGENTS.md                                  (长期稳定)
    │
    ├──▶ docs/PROGRESS.md                  (已交付能力 + 近期变更 + 后续计划)
    ├──▶ docs/PRE_DEPLOYMENT_CHECKLIST.md  (上线前外部准备)
    ├──▶ docs/deployment.md                (部署流程 + 环境变量)
    ├──▶ docs/qa/                          (模块验收清单)
    ├──▶ docs/superpowers/specs/           (迭代设计稿)
    └──▶ docs/superpowers/plans/           (迭代实施计划)
```

**优先级**：

- **冲突时**以代码实际行为为准
- 代码 vs 文档冲突 → 修复文档
- 文档 vs 文档冲突 → 以 `docs/superpowers/specs/` 最新 spec 为准，其次 `PROGRESS.md`
- 规则冲突 → 以用户**当前**指令为准（AGENTS.md 规则可被用户显式覆盖）

---

## 10. 复杂变更工作流

涉及架构级变更、新功能、新迭代时，按以下工作流进行（即 spec → plan → execute）：

1. **brainstorming**：先讨论设计，形成范围、取舍和验收口径
2. **写 spec**：落到 `docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md`
3. **用户审 spec 并确认**
4. **写 plan**：落到 `docs/superpowers/plans/YYYY-MM-DD-<topic>.md`，按可验证粒度拆 task
5. **subagent-driven-development**：每个 task 派子 agent 执行 + 验证；主上下文不直接编码
6. **每步通过校验后才算验收**（type-check / 关键路径手测）
7. **按第 9 节触发映射表同步文档**
8. **commit + push 到 GitHub**

常用 skill：

- `superpowers:brainstorming` — 形成设计前
- `superpowers:writing-plans` — spec → plan
- `superpowers:subagent-driven-development` — 执行 plan
- `superpowers:systematic-debugging` — 遇到 bug 时先用这个确定根因
- `superpowers:verification-before-completion` — 声明"完成"前运行验证命令

---

## 11. 仓库约束

- **`.env` 文件永不入库**；仓库只保留 `.env.example`。新增 env 变量必须同步更新 `.env.example` 并在 `docs/deployment.md` 中说明
- **飞书 app secret**经 env `LARK_SSO_APP_SECRET` 注入（单一全局 app，单组织内部工具，12-factor 配置），不入 DB、不入仓库；不实现 per-tenant 加密凭证库（见 2026-05-29 review D-A2）
- **emergency_admin 路径权限与 admin 相同**：所有 `adminOnly` 路由对 `'admin'` 与 `'emergency_admin'` 两个 role 同时开放
- **SSO 自动建账号**：飞书首次登录时自动创建用户，本地随机密码 + 通过飞书 IM 通知，**禁止硬编码默认密码**
- **Designer Template JSON**：mm-anchor schema 中 `canvas.cell.{w,h}` 与 `anchor` 单位一律为 mm；不能在代码中随意切到 px
- **数据库迁移不自动 downgrade**，依赖"恢复备份 + 回退应用版本"
- **生产环境的渲染输出**（`storage/uploads/render/`）按需清理，**未来加 quota 与 signed URL**（见 PROGRESS 后续计划）
- **渲染容器 chromium**：开发用 Alpine + `chromium-browser`（`PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser`），生产 Dockerfile 用 bookworm + 多阶段（待优化）
- **打印 CSS 全局规则**集中在 `apps/web/src/styles/print.css`，新增遮挡打印的全局 chrome 时**必须**在此处加 `@media print { display: none }`

---

## 附录 A：任务完成声明前的自检清单

```
功能完整性
[ ] 代码改动实现了用户请求的所有子项
[ ] 没有添加未请求的功能
[ ] 边界场景已考虑（null / 空数组 / 越权 / 并发 / 拖动越界）

质量校验
[ ] pnpm typecheck 通过（如有改动）
[ ] 关键路径手测（设计器拖动 / 打印 / 登录 / 渲染任务）
[ ] lint / format 按需通过

文档同步（参考第 9 节）
[ ] 触发映射表已逐行自检
[ ] 相关 docs/ 文档已同步或明确不需要更新
[ ] docs/PROGRESS.md 第 3 节"近期变更"已追加 + "最近更新"日期已改

提交规范
[ ] commit 消息符合前缀规范
[ ] commit 粒度合理（一个 task 一个 commit）
[ ] 不跨越不相关的文件
[ ] .env / storage / .pgdata 等忽略文件未被误提交
```

---

**本文件变动规则**：AGENTS.md 本身的变更属于协作规则变更。修改前应先说明原因，修改后应在 commit 消息中明确标注（`docs(agents): …`）。
