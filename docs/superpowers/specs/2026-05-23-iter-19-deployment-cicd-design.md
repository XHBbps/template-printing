# Iteration 19 — Production Deployment + CI/CD Design

**Goal:** 把当前开发机上的项目按可重复、可回滚的方式部署到公司服务器，建立 CI/CD 流水线后续每次提交自动更新。

**Scope:** 配置文件 + 部署脚本 + CI workflow 模板。**不实施真正部署**（项目目前还在开发机上），只准备好「部署一键化」的所有产物，等服务器到位后即可启用。

---

## 现状

- 开发：`docker-compose.dev.yml`（postgres / redis / api / web / render）
- 5 个服务都 `build: dockerfile.dev`，挂源码卷，开发时热重载
- 无 prod 配置、无 CI、无部署脚本

## 目标

| 文件 / 工件 | 用途 |
|---|---|
| `docker-compose.prod.yml` | 生产 stack 定义（镜像而非 build context、无源码挂载、env_file） |
| `apps/api/Dockerfile.prod` | 多阶段 build → 体积更小的 production image |
| `apps/web/Dockerfile.prod` | Vite build → nginx 静态服务 |
| `docker/render.Dockerfile` | （已有，复用） |
| `docker/nginx.conf` | 反向代理 + SSL + 静态文件 + CORS |
| `.github/workflows/ci.yml` | 提交触发：lint + type-check + tests |
| `.github/workflows/release.yml` | tag 触发：build images + push registry |
| `.github/workflows/deploy.yml` | release 完成或手动触发：SSH 到服务器 pull 新 image + 重启 |
| `scripts/deploy/install.sh` | 服务器首次部署 — 拉镜像、初始化 db、配置 nginx |
| `scripts/deploy/update.sh` | 更新 — pull + 重启 + health check |
| `scripts/deploy/backup.sh` | 备份 postgres + storage |
| `scripts/deploy/rollback.sh` | 回滚到上个 tag |
| `docs/deployment.md` | 部署手册 |

---

## 部署架构

```
┌─────────────────────────────────────────────────┐
│ 公司服务器（公网 IP / 域名）                    │
│                                                 │
│  ┌──────────┐                                   │
│  │  nginx   │ ← :443 SSL（Let's Encrypt）       │
│  └────┬─────┘                                   │
│       │ /api/*       /uploads/*    /*           │
│       ▼              ▼             ▼            │
│  ┌─────────┐   ┌──────────┐   ┌────────┐        │
│  │ api 容器 │   │ /storage │   │ web 容器│        │
│  │ :3000   │   │ 静态挂载 │   │ nginx  │        │
│  └────┬────┘   └──────────┘   │ :80    │        │
│       │                       └────────┘        │
│       ▼                                         │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐       │
│  │ postgres │  │  redis   │  │  render  │       │
│  │ :5432    │  │  :6379   │  │ (worker) │       │
│  └──────────┘  └──────────┘  └──────────┘       │
│                                                 │
│  /opt/template-printing/                        │
│  ├── docker-compose.prod.yml                    │
│  ├── .env (生产 secrets)                        │
│  ├── nginx/conf.d/                              │
│  ├── data/                                      │
│  │   ├── postgres/ (volume)                     │
│  │   ├── redis/                                 │
│  │   └── storage/ (uploads)                     │
│  ├── backups/                                   │
│  │   └── pg-2026-05-23.sql.gz                  │
│  └── logs/                                      │
└─────────────────────────────────────────────────┘
```

---

## CI/CD 流水线设计

### 阶段 1: PR / push 到 dev branch
**`.github/workflows/ci.yml`**：
- pnpm install
- lint (eslint + prettier)
- type-check (vue-tsc + tsc)
- unit tests (`npm test --workspaces`)
- e2e tests (Playwright) — optional, slow

不构建镜像、不部署。纯检查。

### 阶段 2: push tag `v*.*.*` 到 main
**`.github/workflows/release.yml`**：
- 跑 CI 全套检查
- 用 `Dockerfile.prod` build 3 个 image: `tp-api:vX.Y.Z`, `tp-web:vX.Y.Z`, `tp-render:vX.Y.Z`
- push 到 registry（公司内部 docker registry 或 ghcr.io）
- 发 GitHub Release notes（自动从 commit 提取 changelog）

### 阶段 3: 手动 trigger 或 release 完成
**`.github/workflows/deploy.yml`**：
- 通过 GitHub Action runner SSH 到生产服务器
- 服务器上：`cd /opt/template-printing && ./scripts/deploy/update.sh v1.2.3`
- update.sh 内部：
  1. `docker compose pull` 拉新 image
  2. 备份 db: `./backup.sh`
  3. 重启服务：`docker compose up -d --remove-orphans`
  4. health check: 等 60s, curl `/api/health`，失败则回滚
  5. 通知 IM（飞书 webhook）部署结果

不直接对外暴露 ssh 密钥；通过 GitHub Action secrets 存。

---

## 关键决策

### registry 选型
- **A**: 公司内部 registry（如有）→ 网络更稳、合规
- **B**: GHCR (GitHub Container Registry) — 免费、和 repo 整合好
- **C**: Docker Hub — 公共有限免费

**推荐 B**（GHCR），后续如果公司有 registry 再切。

### nginx vs traefik
- nginx：成熟、配置直白、SSL 用 certbot 自动续
- traefik：自动发现服务、自动 Let's Encrypt，但额外学习成本

**推荐 nginx + certbot**（团队熟悉度高）。

### SSL 证书
Let's Encrypt + certbot 自动续期（cron 跑）。
- 域名指向服务器公网 IP
- certbot 用 standalone mode 首次签发
- 后续 `certbot renew` cron 跑

### 备份策略
- **频率**：postgres 每日一次 dump + storage rsync 到 `/opt/template-printing/backups/`
- **保留**：本地 7 天，每周一次同步到外部存储（公司 NAS / 飞书云盘）
- **测试**：每月一次 restore 演练（用 staging 库验证 dump 可恢复）

---

## 实施步骤（iter 19 内 ~12 task）

### 阶段 A — 生产镜像
1. 写 `apps/api/Dockerfile.prod`：多阶段 build（builder → runtime），最终用 distroless / alpine + node
2. 写 `apps/web/Dockerfile.prod`：Vite build → nginx 镜像 + 静态文件
3. 写 `docker-compose.prod.yml`：用 image 名引用、env_file、健康检查、重启策略
4. 验证：本地用 `docker-compose -f docker-compose.prod.yml up` 跑通

### 阶段 B — nginx + SSL
5. 写 `docker/nginx/nginx.conf` + `conf.d/template-printing.conf`：
   - 80 → 重定向 443
   - 443 → SSL + proxy_pass `/api/` 到 api:3000
   - `/uploads/*` → 静态文件 from /storage volume
   - 其他路径 → web 容器
6. 集成 certbot：`scripts/deploy/init-ssl.sh` 首次签发流程

### 阶段 C — 部署脚本
7. 写 `scripts/deploy/install.sh`（一次性首次部署）
8. 写 `scripts/deploy/update.sh`（拉镜像 + 重启 + health check）
9. 写 `scripts/deploy/backup.sh`（pg_dump + rsync storage）
10. 写 `scripts/deploy/rollback.sh`（指定上一个 tag 重新部署）

### 阶段 D — CI/CD workflows
11. `.github/workflows/ci.yml` —— PR / push 触发
12. `.github/workflows/release.yml` —— tag 触发
13. `.github/workflows/deploy.yml` —— release 完成触发

### 阶段 E — 文档
14. 写 `docs/deployment.md`：从零开始把 spec 中提到的所有步骤落地到操作手册

---

## 强约束（必须遵守）

- **prod .env 不入 git**。GitHub secret 注入到 deploy.yml 时再下发。
- **不在 dev 镜像和 prod 镜像间混用**。Dockerfile.dev 永远不发 registry。
- **CI/CD secrets 用 GitHub Secrets**，不在 workflow yaml 里写。
- **deploy.yml 必须能从 main branch 手动 dispatch**（不只是 release 自动触发）。
- **每次部署前自动备份**。备份失败则部署中止。
- **health check 失败 → 自动回滚**。不留半 broken 状态。

---

## 不在范围

- 不做实际部署（项目还在开发机阶段）
- 不申请域名 / SSL 证书（等服务器准备好再做）
- 不接公司内部 registry（用 GHCR 起步）
- 不做监控（Prometheus / Grafana 等留给后续 iter）
- 不做日志收集（journald + docker logs 起步，etl 留给后续）

---

## 验收清单

- [ ] `docker compose -f docker-compose.prod.yml config` 解析无错
- [ ] 本地能用 prod compose 起一个完整 stack（postgres + redis + api prod image + web prod image）
- [ ] CI workflow 在 PR 上跑通（lint + type-check + tests 全绿）
- [ ] tag 触发 release workflow 能成功 push 到 GHCR（dry-run 验证）
- [ ] deploy workflow 在 staging 环境（如有）能跑通；否则文档记录手动触发步骤
- [ ] backup.sh 单独跑能产生有效的 .sql.gz + storage tarball
- [ ] rollback.sh 能从指定 tag 重新部署，db schema 兼容
- [ ] `docs/deployment.md` 包含完整 step-by-step，新工程师能照着把项目部署到一台空 ubuntu 机器上
