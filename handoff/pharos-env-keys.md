# Pharos 适配交付物 — env key 清单 + 登记表修订 + 待确认项

> 配套 `handoff/pharos-adaptation.md` §2D/§3/§4.6。本仓库侧改造已落:
> - 改造 A:`docker/web-nginx.conf` 重写(合并 assets 长缓存 + SPA + `/api` 反代 + `/uploads` 经 api 出)。
> - 改造 B:新增 `docker-compose.pharos.yml`(平台形态,命名卷 `pg_data`/`redis_data`/`storage`,无 ports/env_file/nginx)。
> - storage ⚠ 已解:全部 `/uploads/*` 经 api 出(api ServeStaticModule root=STORAGE_ROOT 提供 `/uploads/*`,`/uploads/render/*` 由 SignedUploadsController 校验 HMAC),web nginx 加 `/uploads/ → api` 反代,**web 不挂 storage 卷**。

## 1. env key 清单(部署界面填值)

> 敏感=平台 AES-GCM 加密存储。「整值」连接串用服务名 DNS(compose 内网)。

### postgres
| key | 用途 | 示例 | 敏感 | 必填 |
|---|---|---|---|---|
| POSTGRES_USER | DB 用户 | `postgres` | 否 | 是 |
| POSTGRES_PASSWORD | DB 密码 | `openssl rand -base64 24` | **是** | 是 |
| POSTGRES_DB | 库名 | `template_printing` | 否 | 是 |

### api
| key | 用途 | 示例 | 敏感 | 必填 |
|---|---|---|---|---|
| NODE_ENV | 运行模式(compose 已内联) | `production` | 否 | 是(内联) |
| DATABASE_URL | PG 连接串(整值) | `postgres://postgres:PASS@postgres:5432/template_printing` | **是** | 是 |
| REDIS_URL | Redis 连接串 | `redis://redis:6379` | 否 | 是 |
| JWT_SECRET | 登录 token 签名 | `openssl rand -hex 32`(≥32) | **是** | 是 |
| FILE_SIG_SECRET | 文件签名 HMAC(**api 与 render 同值**) | `openssl rand -hex 32` | **是** | 是 |
| LARK_SSO_APP_ID | 飞书自建应用 ID | `cli_xxx` | 否 | 是 |
| LARK_SSO_APP_SECRET | 飞书 App Secret | — | **是** | 是 |
| LARK_SSO_REDIRECT_URI | SSO 回调(对外域名 + `/api/auth/lark/callback`) | `https://<域名>/api/auth/lark/callback` | 否 | 是 |
| CORS_ORIGIN | 允许的前端来源(**生产必设真实域名**) | `https://<域名>` | 否 | 是 |
| COOKIE_DOMAIN | cookie 域(空=请求 host) | `<域名>` | 否 | 否 |
| INITIAL_ADMIN_LARK_USER_IDS | 初始 admin 飞书 user_id(逗号分隔) | `80007273` | 否 | 否 |
| INITIAL_ADMIN_LOCAL_USERNAME | 应急本地管理员名 | `emergency_admin` | 否 | 否 |
| INITIAL_ADMIN_LOCAL_PASSWORD | 应急管理员初始密码(首登强制改) | `openssl rand -hex 16` | **是** | 否 |
| LARK_BITABLE_VERIFICATION_TOKEN | 多维表格 webhook 校验 | `openssl rand -hex 16` | **是** | 启用多维表格才填 |
| RENDER_CALLBACK_SECRET | render→api 内部回调 secret | `openssl rand -hex 16` | **是** | ⚠ 见下「跨字段断言」 |
| LARK_BOT_VERIFICATION_TOKEN | bot HTTP fallback 校验 | `openssl rand -hex 16` | **是** | 启用 bot 才填 |
| LARK_BOT_OPEN_ID | 群内识别 @机器人 | `ou_xxx` | 否 | 启用 bot 必填 |
| LARK_BOT_LONG_CONN_ENABLED | bot 长连接开关(**单副本设 true**) | `true` | 否 | 否 |
| LARK_ALERT_CHAT_ID | 运行时告警群 chat_id(空=关) | `oc_xxx` | 否 | 否 |
| API_INTERNAL_BASE | render 回调 api 内部 base | `http://api:3000` | 否 | 否(有默认) |
| UPLOAD_ORPHAN_GRACE_DAYS / AUDIT_LOG_RETENTION_DAYS / BOT_SESSION_RETENTION_DAYS | 清理 cron(≤0=关) | `7` / `90` / `30` | 否 | 否 |

> ⚠ **跨字段启动断言**(`apps/api/src/common/env.ts`):配了 `LARK_BITABLE_VERIFICATION_TOKEN` 却缺 `RENDER_CALLBACK_SECRET` → **生产硬阻断启动**;配了 `LARK_BOT_VERIFICATION_TOKEN` 却缺 `LARK_BOT_OPEN_ID` → 启动 warn。两对要么都填要么都不填。

### render
| key | 用途 | 示例 | 敏感 | 必填 |
|---|---|---|---|---|
| STORAGE_ROOT | 产物根(compose 已内联) | `/storage` | 否 | 是(内联) |
| WEB_BASE | render 访问 SPA 内网地址(compose 已内联) | `http://web:80` | 否 | 是(内联) |
| DATABASE_URL / REDIS_URL | 同 api | — | 见上 | 是 |
| FILE_SIG_SECRET | **与 api 同值**(签 `/uploads/render` URL) | 同 api | **是** | 是 |
| RENDER_BROWSERS / RENDER_PAGES_PER_BROWSER / RENDER_JOB_TIMEOUT_MS / RENDER_ACQUIRE_TIMEOUT_MS / RENDER_LOCK_DURATION_MS / RENDER_PAGE_MAX_USES / RENDER_STUCK_TIMEOUT_MIN / RENDER_DEVICE_SCALE_FACTOR / RENDER_BACKOFF_BASE_MS / CALLBACK_RESEND_MAX_ATTEMPTS | 渲染调优 | 见 `.env.prod.example` | 否 | 否(均有默认) |

## 2. 登记表修订(对 §3 的更正)

| 服务 | 镜像(相对路径) | 对外 | 平台探活 | 卷 | env |
|---|---|---|---|---|---|
| web | tools/template-printing/web | **是** | http `/`(容器 80) | — | —(nginx 已内置 `/api` + `/uploads` 反代,**无需 env、无需挂 storage**) |
| api | tools/template-printing/api | 否 | http `/healthz`(容器 3000) | `storage` | 见上清单 |
| render | tools/template-printing/render | 否 | alive | `storage` | **原表少列**:实际还需 `FILE_SIG_SECRET` + `RENDER_*` 调优(见上) |
| postgres | tools/template-printing/postgres | 否 | tcp 5432 | `pg_data` | POSTGRES_USER/PASSWORD/DB |
| redis | tools/template-printing/redis | 否 | tcp 6379 | `redis_data` | — |

> 镜像 tag(平台注入):api/web/render = 发布版本(如 `v1`);postgres = `16-alpine`;redis = `7-alpine`。

## 3. 待灯塔侧确认 / 冲突反馈(§5「不要绕」)

1. **prod compose vs 新文件**:我把平台形态写成**独立 `docker-compose.pharos.yml`,未覆盖 `docker-compose.prod.yml`** —— 后者被现有 GHCR 流水线(`release.yml`/`deploy.yml`/`scripts/deploy/update.sh`/边缘 nginx/certbot)依赖,就地改会破坏它。若确认**彻底改用 Pharos、弃用 GHCR 路径**,我再就地替换 prod 并清理那套流水线。
2. **env 注入机制**:`docker-compose.pharos.yml` 用 `environment: - KEY`(pass-through 声明键名)。若 Pharos 是**直接往容器注入 env**(不经 compose pass-through),这些声明冗余但无害 —— 请确认机制,必要时调整为平台期望写法。
3. **C 推送 Harbor 被阻塞**:`192.168.10.124` 为内网 + 需平台侧推送账号,**当前开发机无法连通/无凭据,无法执行 push**。构建命令已在 §2C 就绪,需在**有 Harbor 访问的构建机**上执行(insecure-registries + docker login)。可代为「本地 x86_64 构建验证(不推送)」。
4. **§4 本地验收**:1–4 项需先本地构建 5 个镜像(render 含 Chromium,较重)再 `docker compose -f docker-compose.pharos.yml up`;5 项推送被 #3 阻塞。按需可跑「本地构建 + pharos compose up」验证(不含推送)。
