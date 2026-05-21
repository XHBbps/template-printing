# 模板打印平台 — Template Printing Platform

> 团队自部署的模板设计 + 打印平台。基于栅格化设计器，深度集成飞书（多维表格回写）。

## Quickstart (本地开发)

### 前置依赖

- Node.js 20 LTS（推荐用 nvm / volta）
- pnpm 9.x（`corepack enable && corepack prepare pnpm@9.12.0 --activate`）
- Docker Desktop / Docker Engine + Docker Compose v2

### 启动

```bash
# 1. 安装依赖
pnpm install

# 2. 复制环境变量样板
cp .env.example .env
# 编辑 .env，填入真实 MASTER_KEY / JWT_SECRET / FILE_SIG_SECRET（用 openssl rand -hex 32 生成）
# 以及飞书自建应用的 LARK_SSO_APP_ID / LARK_SSO_APP_SECRET

# 3. 启动 Postgres + Redis
docker compose -f docker-compose.dev.yml up -d postgres redis

# 4. 应用数据库迁移
pnpm --filter @template-printing/api db:migrate:dev

# 5. 启动全栈
docker compose -f docker-compose.dev.yml up -d

# 6. 访问
# - 前端: http://localhost:5173
# - 后端 API: http://localhost:3000/healthz
```

### 仓库结构

```
apps/
├── api/        # NestJS 后端
├── web/        # Vue 3 前端
└── render/     # Puppeteer worker

packages/
├── types/              # 共享 TS 类型
├── schema/             # 共享 zod schema
└── template-renderer/  # 前后端共享 Vue 渲染组件
```

### 文档

- 设计 spec：`docs/superpowers/specs/2026-05-21-template-printing-platform-design.md`
- 实施计划：`docs/superpowers/plans/`
- 上线前清单：`docs/PRE_DEPLOYMENT_CHECKLIST.md`

### 开发流程

- 分支：`feature/*` / `fix/*`；PR 合 `main`
- Commit message：Conventional Commits (`feat:` / `fix:` / `chore:` …)
- 每次 push 自动跑 CI（lint + typecheck + test + Docker build）

### 测试

```bash
pnpm test          # 全部单测
pnpm typecheck     # 类型检查
pnpm lint          # ESLint
pnpm build         # 全部构建
```
