# 批次2:生产部署产物修正(开发机就绪,不真部署) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 `docker-compose.prod.yml` + prod 镜像在开发机能完整起一次、渲染能往返,拿到服务器把密钥填进 `.env.prod` 即可一把跑通(不真部署)。

**Architecture:** 修正"生产部署产物"的配置正确性:先实建 prod 镜像(最高不确定性)→ 统一 CI/release 用同一 Dockerfile → `.env.prod.example` 严格对齐 `env.ts` → compose.prod 补 render 的 WEB_BASE/storage 卷 → mem_limit → nginx /metrics 白名单 → 本地起栈跑通渲染往返。验证靠 `docker build` + `docker compose config` + 本地起栈,而非单元测试。

**Tech Stack:** Docker / docker compose v2;NestJS prod 镜像;GitHub Actions;nginx。

**Spec:** `docs/superpowers/specs/2026-05-28-system-review-audit.md`(部署桶 D1/D2/D3/D6 + B3 + V7)

**全局约定:** 容器/构建命令在仓库根(开发机,docker 已起)。提交走 husky,不 `--no-verify`,每 task 只 `git add` 本 task 文件。**不真部署**;不引入 B10(render healthcheck,需先定探针)、B11(异地备份)、O9(迁移回滚)——推到首次部署有数据后。

**已核实事实:**
- `release.yml` build:`apps/api/Dockerfile.prod`、`apps/web/Dockerfile.prod`、`docker/render.Dockerfile`。`ci.yml` build(验证):`docker/api.Dockerfile`、`docker/web.Dockerfile`、`docker/render.Dockerfile` → **api/web 出货镜像 CI 从没 build 过**。
- prod web 镜像 = nginx `EXPOSE 80` → render `WEB_BASE` 应 `http://web:80`。
- compose.prod render 服务当前只有 `REDIS_URL`,无 WEB_BASE、无 `/storage` 卷;api 有 `./data/storage:/storage`、nginx 只读挂 `./data/storage:/srv/storage:ro`。
- `env.ts` 必填(无 default/optional)字段:`DATABASE_URL`、`REDIS_URL`、`JWT_SECRET`、`FILE_SIG_SECRET`、`MASTER_KEY`、`LARK_SSO_APP_ID`、`LARK_SSO_APP_SECRET`、`LARK_SSO_REDIRECT_URI`。其中 `DATABASE_URL`/`REDIS_URL`/`NODE_ENV` 由 compose.prod 的 `api.environment` 直接提供(不走 .env.prod)。
- 渲染 worker 经 `process.env` 读(不在 env.ts):`WEB_BASE`、`STORAGE_ROOT`、`RENDER_JOB_TIMEOUT_MS`/`RENDER_ACQUIRE_TIMEOUT_MS`/`RENDER_LOCK_DURATION_MS`/`RENDER_PAGE_MAX_USES`/`RENDER_STUCK_TIMEOUT_MIN`/`RENDER_DEVICE_SCALE_FACTOR`、`PUPPETEER_EXECUTABLE_PATH`、`FILE_SIG_SECRET`。
- 迁移:`docker compose -f docker-compose.prod.yml exec -T api npx prisma migrate deploy`(见 `scripts/deploy/init.sh:34`)。

---

## File Structure
- (Task1 无文件改动,只 build 验证)
- Modify `.github/workflows/ci.yml`;Delete `docker/api.Dockerfile`、`docker/web.Dockerfile`(确认无引用后)(Task2)
- Rewrite `.env.prod.example`;Modify `apps/api/src/common/env.ts`(export EnvSchema);Create `apps/api/test/env-example-sync.spec.ts`(Task3)
- Modify `docker-compose.prod.yml`(render env+volume)(Task4);(mem_limit)(Task5)
- Modify `docker/nginx/conf.d/*.conf`(Task6)
- (Task7 无持久文件改动,临时 .env.prod 用后删)
- Modify `docs/PROGRESS.md`、`docs/deployment.md`、review spec(Task8)

---

## Task 1(先决):本地实建三个 prod 镜像

**Files:** 无改动(纯构建验证)。这是整批不确定性最高项,**必须最先做**——出货 prod 镜像从没被 CI build 过,可能根本构建不过;若失败,先修通再做其余。

- [ ] **Step 1: 建 api prod 镜像**

Run(仓库根):
```
docker build -f apps/api/Dockerfile.prod -t tpprod/tp-api:local .
```
Expected: 成功出镜像。失败则记录失败阶段(依赖装不上 / prisma generate / tsc / COPY 路径等),**这是先决项——先修 Dockerfile.prod 或其依赖直到能 build**,再继续。

- [ ] **Step 2: 建 web prod 镜像**

Run: `docker build -f apps/web/Dockerfile.prod -t tpprod/tp-web:local .`
Expected: 成功(多阶段:vite build → nginx COPY dist)。失败同上先修。

- [ ] **Step 3: 建 render prod 镜像**

Run: `docker build -f docker/render.Dockerfile -t tpprod/tp-render:local .`
Expected: 成功(Alpine + 系统 Chromium,体积较大,耗时较长)。失败先修。

- [ ] **Step 4: 记录结果**

三镜像 `docker images | grep tpprod` 都在。本 task 无 commit(无文件改动)。若过程中为修 build 改了 Dockerfile,则:
```bash
git add apps/api/Dockerfile.prod apps/web/Dockerfile.prod docker/render.Dockerfile
git commit -m "fix(docker): 修复 prod 镜像构建(批次2 Task1 先决)"
```
(无改动则跳过 commit,报告"三镜像均可构建"。)

---

## Task 2(D6):统一 CI 与 release 的 Dockerfile

**Files:** Modify `.github/workflows/ci.yml`;Delete `docker/api.Dockerfile`、`docker/web.Dockerfile`。

- [ ] **Step 1: 改 ci.yml 的 api/web build 指向 prod Dockerfile**

`ci.yml` 中 docker-build job:
```yaml
          file: docker/api.Dockerfile
```
改为:
```yaml
          file: apps/api/Dockerfile.prod
```
同理 `file: docker/web.Dockerfile` → `file: apps/web/Dockerfile.prod`。render 行 `docker/render.Dockerfile` 不变(release 已用它)。这样 CI 验证的就是 release 实际出货的镜像。

- [ ] **Step 2: 确认 `docker/api.Dockerfile`、`docker/web.Dockerfile` 无其他引用**

Run(Grep):搜索整仓 `docker/api.Dockerfile` 与 `docker/web.Dockerfile` 的引用(workflows、compose、scripts、docs)。Expected:除刚改的 ci.yml 已不引用,无其他生产引用。若 `docs/` 有引用,Task8 一并更正。

- [ ] **Step 3: 删除冗余 Dockerfile**

```bash
git rm docker/api.Dockerfile docker/web.Dockerfile
```
(render.Dockerfile 保留。)

- [ ] **Step 4: 提交**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: 构建并验证 release 实际出货的 prod Dockerfile，删冗余 docker/{api,web}.Dockerfile(D6)"
```

---

## Task 3(D1):`.env.prod.example` 严格对齐 `env.ts` + 双向校验

**Files:** Rewrite `.env.prod.example`;Modify `apps/api/src/common/env.ts`(导出 `EnvSchema`);Create `apps/api/test/env-example-sync.spec.ts`。

- [ ] **Step 1: 导出 EnvSchema**

`apps/api/src/common/env.ts`:把 `const EnvSchema = z.object({...})` 改为 `export const EnvSchema = z.object({...})`(其余不动)。

- [ ] **Step 2: 重写 `.env.prod.example`**

按"已核实事实"的字段集重写。规则:**只列代码真读的键**(env.ts 字段 + 渲染 worker process.env 字段 + compose/部署变量);删掉 env.ts 不存在的 `JWT_ACCESS_SECRET`/`JWT_REFRESH_SECRET`。内容:
```bash
# ==== Database (POSTGRES_* 供 compose 拼 DATABASE_URL；DATABASE_URL/REDIS_URL/NODE_ENV 由 compose.prod 注入) ====
POSTGRES_USER=postgres
POSTGRES_PASSWORD=          # 必填:强随机,如 openssl rand -base64 24
POSTGRES_DB=template_printing

# ==== JWT / 签名密钥(必填) ====
JWT_SECRET=                 # 必填:openssl rand -hex 32
FILE_SIG_SECRET=            # 必填:openssl rand -hex 32(api 与 render 共用同一值)
MASTER_KEY=                 # 必填:openssl rand -hex 32(=64 hex chars;当前仅校验存在,凭证加密未实现 见 review D-A2)

# ==== Lark / 飞书 SSO(必填) ====
LARK_SSO_APP_ID=cli_xxxxxxxxxxxxxxxx
LARK_SSO_APP_SECRET=
LARK_SSO_REDIRECT_URI=https://your-domain.com/api/auth/lark/callback
INITIAL_ADMIN_LARK_USER_IDS=          # 逗号分隔的初始 admin lark user_id(可空)

# ==== 初始本地管理员(可选;设则部署时 bootstrap emergency_admin) ====
INITIAL_ADMIN_LOCAL_USERNAME=emergency_admin
INITIAL_ADMIN_LOCAL_PASSWORD=         # 可选:≥8;建议 openssl rand -hex 16,首登强制改密

# ==== Web / CORS / Cookie ====
CORS_ORIGIN=https://your-domain.com   # 生产必设为正式前端来源(默认仅 localhost:5173)
COOKIE_DOMAIN=your-domain.com         # 可选:空=用请求 host

# ==== 飞书集成 token(启用对应功能才必填) ====
LARK_BITABLE_VERIFICATION_TOKEN=      # 多维表格 webhook;openssl rand -hex 16
LARK_BOT_VERIFICATION_TOKEN=          # 机器人事件/卡片;openssl rand -hex 16
LARK_BOT_OPEN_ID=                     # 群内识别 @机器人用
RENDER_CALLBACK_SECRET=               # render→API 内部回调专用;openssl rand -hex 16(与 webhook token 分离)
API_INTERNAL_BASE=http://api:3000     # render 回调 api 的内部 base

# ==== 渲染 worker 调优(可选,见 docs/deployment.md) ====
WEB_BASE=http://web:80                # render 访问 SPA 的内部地址(prod web=nginx:80)
STORAGE_ROOT=/storage
RENDER_BROWSERS=2
RENDER_PAGES_PER_BROWSER=2
RENDER_JOB_TIMEOUT_MS=60000
RENDER_ACQUIRE_TIMEOUT_MS=30000
RENDER_LOCK_DURATION_MS=120000
RENDER_PAGE_MAX_USES=200
RENDER_STUCK_TIMEOUT_MIN=10
RENDER_DEVICE_SCALE_FACTOR=2

# ==== Deploy meta ====
TAG=latest
REGISTRY=ghcr.io/your-org
NODE_ENV=production
```
(注:`DATABASE_URL`/`REDIS_URL` 不放此文件——compose.prod 的 `api.environment` 已注入;校验脚本据此放行。)

- [ ] **Step 3: 写双向校验测试**

`apps/api/test/env-example-sync.spec.ts`(用真实 `EnvSchema.shape`,稳健):
```ts
import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, it, expect } from '@jest/globals';
// eslint-disable-next-line import/no-unresolved
import { EnvSchema } from '../src/common/env.js';

// 解析 .env.prod.example 的键
const exampleText = readFileSync(join(__dirname, '../../../.env.prod.example'), 'utf8');
const exampleKeys = new Set(
  exampleText
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => l.split('=')[0]!.trim()),
);

// compose.prod 的 api.environment 直接注入的键(不需在 .env.prod)
const COMPOSE_INJECTED = new Set(['DATABASE_URL', 'REDIS_URL', 'NODE_ENV']);
// 渲染 worker / compose / 部署用、非 env.ts schema 的合法键(允许出现在 example)
const NON_ENVTS_ALLOWED = new Set([
  'POSTGRES_USER', 'POSTGRES_PASSWORD', 'POSTGRES_DB', 'TAG', 'REGISTRY', 'NODE_ENV',
  'WEB_BASE', 'STORAGE_ROOT', 'PUPPETEER_EXECUTABLE_PATH',
  'RENDER_JOB_TIMEOUT_MS', 'RENDER_ACQUIRE_TIMEOUT_MS', 'RENDER_LOCK_DURATION_MS',
  'RENDER_PAGE_MAX_USES', 'RENDER_STUCK_TIMEOUT_MIN', 'RENDER_DEVICE_SCALE_FACTOR',
  'RENDER_CALLBACK_SECRET',
]);

const schemaKeys = Object.keys(EnvSchema.shape);
// 必填 = 给 undefined 解析失败的字段(无 default、非 optional)
const requiredKeys = schemaKeys.filter(
  (k) => !(EnvSchema.shape as Record<string, { safeParse: (v: unknown) => { success: boolean } }>)[k].safeParse(undefined).success,
);

describe('.env.prod.example ⟷ env.ts 双向一致', () => {
  it('每个必填 env.ts 字段都被 .env.prod.example 或 compose 注入覆盖', () => {
    const missing = requiredKeys.filter((k) => !exampleKeys.has(k) && !COMPOSE_INJECTED.has(k));
    expect(missing).toEqual([]);
  });
  it('.env.prod.example 无 env.ts/允许清单 都不认识的键(防 JWT_ACCESS_SECRET 式 drift)', () => {
    const known = new Set([...schemaKeys, ...NON_ENVTS_ALLOWED]);
    const unknown = [...exampleKeys].filter((k) => !known.has(k));
    expect(unknown).toEqual([]);
  });
});
```

- [ ] **Step 4: 跑测试 → 通过;typecheck + lint**

Run: `docker exec template_printing-api sh -c "cd /workspace/apps/api && pnpm test -- test/env-example-sync.spec.ts && pnpm run typecheck && pnpm run lint"`
Expected: 两断言均过。若 `unknown` 非空 → 说明 example 有多余/拼错键,删掉;若 `missing` 非空 → 补该必填键。

- [ ] **Step 5: 提交**

```bash
git add .env.prod.example apps/api/src/common/env.ts apps/api/test/env-example-sync.spec.ts
git commit -m "fix(deploy): .env.prod.example 严格对齐 env.ts + 双向一致测试(D1)"
```

---

## Task 4(D2+D3):compose.prod 的 render 补 WEB_BASE / storage 卷

**Files:** Modify `docker-compose.prod.yml`(render 服务,约 57-65 行)。

- [ ] **Step 1: 改 render 服务**

把:
```yaml
  render:
    image: ${REGISTRY:-ghcr.io/your-org}/tp-render:${TAG:-latest}
    env_file: .env.prod
    environment:
      REDIS_URL: redis://redis:6379
    depends_on:
      redis:
        condition: service_healthy
    restart: unless-stopped
```
改为(加 WEB_BASE/STORAGE_ROOT + storage 卷 + 显式 DATABASE_URL,render 直连 DB 取模板/job):
```yaml
  render:
    image: ${REGISTRY:-ghcr.io/your-org}/tp-render:${TAG:-latest}
    env_file: .env.prod
    environment:
      DATABASE_URL: postgres://${POSTGRES_USER:-postgres}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB:-template_printing}
      REDIS_URL: redis://redis:6379
      WEB_BASE: http://web:80
      STORAGE_ROOT: /storage
    volumes:
      - ./data/storage:/storage
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    restart: unless-stopped
```
> 说明:render 的 `db.ts` 用 `DATABASE_URL` 直连 PG(默认 fallback 指向 `postgres:5432`,但生产密码须显式注入),故补 `DATABASE_URL` 与 `depends_on postgres`。`/storage` 卷与 api 共享(api 写签名 URL 指向的文件、render 写渲染产物到同卷)。

- [ ] **Step 2: 校验 compose 语法**

Run: `docker compose -f docker-compose.prod.yml config >/dev/null && echo OK`
Expected: `OK`(无语法错;变量未设会告警但 config 仍输出)。

- [ ] **Step 3: 提交**

```bash
git add docker-compose.prod.yml
git commit -m "fix(deploy): compose.prod 的 render 补 WEB_BASE/STORAGE_ROOT/DATABASE_URL + storage 卷(D2/D3)"
```

---

## Task 5(B3):各服务 mem_limit

**Files:** Modify `docker-compose.prod.yml`。

- [ ] **Step 1: 给每个服务加顶层 `mem_limit`**

非 swarm 的 `docker compose up` 用**顶层 `mem_limit`**(`deploy.resources.limits` 仅 swarm 生效,不可用)。给各服务加:
- `postgres: mem_limit: 512m`
- `redis: mem_limit: 256m`
- `api: mem_limit: 512m`
- `web: mem_limit: 128m`
- `render: mem_limit: 2g`(RENDER_BROWSERS=2 × ~数百MB Chromium + 大幅面 PNG)
- `nginx: mem_limit: 128m`
每个加在该服务块内(与 `restart: unless-stopped` 同级)。例:
```yaml
  render:
    image: ...
    mem_limit: 2g
    env_file: .env.prod
    ...
```

- [ ] **Step 2: 校验**

Run: `docker compose -f docker-compose.prod.yml config 2>/dev/null | grep -iE "mem_limit|memory" | head`
Expected: 看到各服务的内存限制被解析(compose v2 会把 `mem_limit` 归一到 `deploy.resources.limits.memory` 或保留,二者皆可;关键是 config 不报错且值在)。再 `docker compose -f docker-compose.prod.yml config >/dev/null && echo OK`。

- [ ] **Step 3: 提交**

```bash
git add docker-compose.prod.yml
git commit -m "feat(deploy): compose.prod 各服务加 mem_limit，防 Chromium OOM 拖垮宿主(B3)"
```

---

## Task 6(V7):nginx `/metrics` IP 白名单

**Files:** Modify `docker/nginx/conf.d/template-printing.conf`(先读现状)。

- [ ] **Step 1: 读 nginx conf,找 `/api/` location**

读 `docker/nginx/conf.d/template-printing.conf`,确认 `location /api/ { proxy_pass http://api:3000/; }`(剥 `/api` 前缀,故后端是 `/metrics`)。

- [ ] **Step 2: 加 `/api/metrics` 受限 location**

在 `/api/` location **之前**加一个更精确的 location(nginx 精确/前缀匹配优先级:更长前缀优先),限制内网/采集器:
```nginx
    # Prometheus 指标:仅允许内网 / 采集器拉取(V7)
    location = /api/metrics {
        allow 127.0.0.1;
        allow 10.0.0.0/8;
        allow 172.16.0.0/12;
        allow 192.168.0.0/16;
        deny all;
        proxy_pass http://api:3000/metrics;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
```
(allow 段按实际采集器网段调整;默认放行常见私网段 + 本机,deny 其余。`proxy_pass` 去掉 `/api` 前缀同 `/api/` 行为。)

- [ ] **Step 3: 校验 nginx 配置语法(用 nginx 镜像 dry-run)**

Run:
```
docker run --rm -v "$PWD/docker/nginx/conf.d:/etc/nginx/conf.d:ro" -v "$PWD/docker/nginx/nginx.conf:/etc/nginx/nginx.conf:ro" nginx:1.27-alpine nginx -t
```
Expected: `syntax is ok` / `test is successful`(`__DOMAIN__` 占位/证书路径缺失可能报 ssl 相关错——若因证书路径报错属预期(部署时 init-ssl 替换),只需确认无**本 location 语法错**;必要时临时跳过 ssl server 块单测该 location)。

- [ ] **Step 4: 提交**

```bash
git add docker/nginx/conf.d/template-printing.conf
git commit -m "fix(deploy): nginx /api/metrics 加 IP 白名单(V7)"
```

---

## Task 7(集成验证):开发机本地起 prod 栈跑通渲染往返

**Files:** 无持久改动(临时 `.env.prod` 用后删,确认 `.gitignore` 含 `.env.prod`)。前置:Task1 的 `tpprod/tp-{api,web,render}:local` 镜像在;Task4/5 已改 compose.prod。

- [ ] **Step 1: 确认 `.env.prod` 被 gitignore**

Run(Grep / 读 `.gitignore`):确认 `.env.prod` 在忽略列表(应已忽略 `.env*`)。若否,先加。

- [ ] **Step 2: 造临时 `.env.prod`(占位密钥)**

写 `.env.prod`(临时):`POSTGRES_PASSWORD=localtestpw`、`JWT_SECRET=`/`FILE_SIG_SECRET=`各填 `openssl rand -hex 32`、`MASTER_KEY=`填 `openssl rand -hex 32`、`LARK_SSO_APP_ID=cli_local`、`LARK_SSO_APP_SECRET=local`、`LARK_SSO_REDIRECT_URI=http://localhost/api/auth/lark/callback`、`CORS_ORIGIN=http://localhost`、`RENDER_CALLBACK_SECRET=`填 hex16、`WEB_BASE=http://web:80`、`REGISTRY=tpprod`、`TAG=local`、`STORAGE_ROOT=/storage`、`INITIAL_ADMIN_LOCAL_PASSWORD=localadmin123`。(`REGISTRY=tpprod`+`TAG=local` 让 compose 用 Task1 本地镜像 `tpprod/tp-api:local` 等。)

- [ ] **Step 3: 起 prod 栈(独立 project,跳过 nginx)**

先停 dev 栈避免端口/容器名冲突:`docker compose -f docker-compose.dev.yml down`。
起 prod app 服务(不含需 TLS 的 nginx):
```
docker compose -p tpprod -f docker-compose.prod.yml up -d postgres redis api web render
```
等健康:轮询 `docker compose -p tpprod -f docker-compose.prod.yml ps`,api healthcheck healthy。

- [ ] **Step 4: 迁移 + 造已发布模板 + 跑一次渲染往返**

迁移:`docker compose -p tpprod -f docker-compose.prod.yml exec -T api npx prisma migrate deploy`(同 init.sh:34)。
造数据 + 渲染:用 psql 直插一个已发布模板(visibility 任意,system enqueue),或最简——直接复刻批次1验证里的方式:在 prod DB 插 templates + template_versions 一条已发布模板,插 render_jobs(status pending,formats pdf+png),用 bullmq 入队(可在 render 容器内跑一段最小 enqueue 脚本,REDIS_URL=redis://redis:6379)。
**验证点**:
- worker 日志 `[render] done <jobId>`;
- 渲染产物文件出现在共享卷:`docker compose -p tpprod -f docker-compose.prod.yml exec -T render sh -c "ls -la /storage/uploads/render/"` 有 `<jobId>.pdf/.png`;
- 同卷 api 侧可见:`... exec -T api sh -c "ls /storage/uploads/render/"` 同样有(证明卷共享、WEB_BASE 通、密钥链路通)。
Expected: render 往返成功、产物在共享卷两端都可见。**这一步是本批次唯一目标的达成判据。**

- [ ] **Step 5: 拆栈 + 清理 + 恢复 dev**

```
docker compose -p tpprod -f docker-compose.prod.yml down -v
rm -f .env.prod
docker compose -f docker-compose.dev.yml up -d
```
(`-v` 删临时 prod 卷;`rm .env.prod` 删占位密钥;恢复 dev 栈。)

- [ ] **Step 6: 全栈 compose config 终校验**

Run: `docker compose -f docker-compose.prod.yml config >/dev/null && echo CONFIG_OK`
Expected: `CONFIG_OK`(整份 compose.prod 语法/引用正确)。

- [ ] **Step 7: 记录(无 commit,验证性 task)**

报告:三镜像可起、渲染往返成功、产物双端可见、compose config OK。无文件改动则无 commit。

---

## Task 8:文档同步

**Files:** Modify `docs/PROGRESS.md`、`docs/deployment.md`、`docs/superpowers/specs/2026-05-28-system-review-audit.md`。

- [ ] **Step 1: PROGRESS 追加**

`docs/PROGRESS.md` `### 2026-05-28` 追加:
```markdown
- **批次2:生产部署产物修正(开发机就绪)** —— ① 本地实建并验证三个 prod 镜像可构建(出货镜像此前从未被 CI build);② CI 改为构建 release 实际出货的 `apps/{api,web}/Dockerfile.prod`,删冗余 `docker/{api,web}.Dockerfile`(D6);③ `.env.prod.example` 严格对齐 `env.ts`(修 `JWT_ACCESS/REFRESH_SECRET`→`JWT_SECRET`,补 `MASTER_KEY/FILE_SIG_SECRET/CORS_ORIGIN/RENDER_CALLBACK_SECRET/WEB_BASE/飞书 token` 等)+ 双向一致测试(D1);④ compose.prod 的 render 补 `WEB_BASE:http://web:80`/`STORAGE_ROOT`/`DATABASE_URL` + `/storage` 卷(D2/D3,修渲染产物丢失/连不上 SPA);⑤ 各服务加 `mem_limit`(B3);⑥ nginx `/api/metrics` 加 IP 白名单(V7)。开发机以独立 project 起 prod 栈(跳过 TLS nginx)跑通一次渲染往返、产物在共享卷双端可见 —— 服务器填 `.env.prod` 密钥即可一把跑通。未含 render healthcheck(B10,需先定探针)/异地备份(B11)/迁移回滚(O9),推后到首次部署有数据后。
```

- [ ] **Step 2: deployment.md 校正**

`docs/deployment.md`:若提及 `docker/api.Dockerfile`/`docker/web.Dockerfile` 改为 `apps/{api,web}/Dockerfile.prod`;确认 env 段含 Task3 的必填项(`JWT_SECRET`/`MASTER_KEY`/`FILE_SIG_SECRET`/`CORS_ORIGIN`/`RENDER_CALLBACK_SECRET`/`WEB_BASE`);"部署准备"提到 ICP/飞书审核为长前置、服务器选址决定 ICP+镜像仓库联动(见 review 部署桶)。

- [ ] **Step 3: review spec 标记**

`docs/superpowers/specs/2026-05-28-system-review-audit.md`:对 D1/D2/D3/D6 + B3 + V7 标注「✅ 批次2 已修(2026-05-28)」;优先级 §2 标完成。

- [ ] **Step 4: 提交**

```bash
git add docs/PROGRESS.md docs/deployment.md docs/superpowers/specs/2026-05-28-system-review-audit.md
git commit -m "docs: 批次2 生产部署产物修正完成同步 + review 部署项标记已修"
```

---

## Self-Review(写计划后自检)

**Spec 覆盖:** D6→T2 ✅;D1→T3 ✅;D2+D3→T4 ✅;B3→T5 ✅;V7→T6 ✅;prod 镜像可构建(D6 验证前置)→T1 ✅;本地起栈渲染往返(唯一目标)→T7 ✅;文档→T8 ✅。砍 B10、推后 B11/O9 已在 header 声明。

**占位符扫描:** 无 TBD;env.example 全文、双向校验测试、compose render 块、mem_limit、nginx location、本地起栈命令均完整给出。T7 造数据一步给了两种可行路径(psql 直插 / 复刻批次1 enqueue)并指明判据,非占位。

**类型/一致性:** Task1 镜像 tag `tpprod/tp-*:local` 与 T7 的 `REGISTRY=tpprod`+`TAG=local` 一致(compose 镜像名 `${REGISTRY}/tp-api:${TAG}` = `tpprod/tp-api:local`);`EnvSchema` 导出名与测试 import 一致;WEB_BASE 值 `http://web:80` 与 web Dockerfile `EXPOSE 80` 一致;render 补 `DATABASE_URL` 与 db.ts 读取一致;compose-injected `DATABASE_URL/REDIS_URL/NODE_ENV` 在校验脚本放行,与 compose.prod api.environment 一致。

**风险点:** T1 prod 镜像可能 build 失败(已置最前、声明先决);T7 本地起 prod 栈需先停 dev 栈(已含),临时 `.env.prod` 用后即删(已含 + gitignore 校验);nginx -t 可能因证书占位报 ssl 错(已说明只验本 location 语法)。
