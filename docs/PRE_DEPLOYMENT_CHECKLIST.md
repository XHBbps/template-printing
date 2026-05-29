# Pre-Deployment Checklist

本清单追踪上线前**代码之外**的准备工作(域名/备案/服务器/飞书应用/密钥)。

> **部署机制(现状)**:release workflow 自动 build 并 push 镜像到 **GHCR**(`ghcr.io/<org>/tp-api|tp-web|tp-render`);`deploy.yml` 经 SSH 登录服务器执行 `scripts/deploy/update.sh <tag>`,脚本载入服务器上的 `.env.prod` 后 `prisma migrate deploy` + `docker compose -f docker-compose.prod.yml up`。
>
> **应用密钥/配置放在服务器 `.env.prod`(不是 GitHub Secrets)**,权威模板与说明见仓库根 [`.env.prod.example`](../.env.prod.example)(有 `env-example-sync.spec` 守着与 `apps/api/src/common/env.ts` 双向同步)。GitHub Secrets 只用于"如何连服务器 + 拉私有镜像"。

## 域名 + ICP 备案(关键路径,最长杆)

> Spec § 9.4. 飞书 SSO 要求 redirect_uri 是 HTTPS 公网域名,国内阿里云 ECS 要求 ICP 备案。**预计 2-3 周,尽早提交。**

- [ ] 公司主体备案信息确认(营业执照 / 法人 / 应急联系人)
- [ ] 在阿里云购买域名(建议 `.com` / `.cn`,注册时主体填公司)
- [ ] 阿里云控制台提交备案申请("网站备案" → "新增网站")
- [ ] 备案管局审核通过(**预计 2-3 周**,期间不能用域名跑公网 HTTPS)
- [ ] DNS 解析:A 记录 `print.<your-company>.com` → ECS 公网 IP
- [ ] SSL 证书:阿里云免费 DV 证书,或 `scripts/deploy/init-ssl.sh`(certbot/Let's Encrypt)

## 阿里云 ECS

- [ ] 购买 `ecs.c7.xlarge`(4 vCPU / 8 GB),系统盘 100 GB ESSD
- [ ] 系统:Ubuntu 22.04 LTS
- [ ] 区域:根据主体所在地(华北 2 / 华东 1)
- [ ] 安全组:开放 22(SSH 限办公 IP)+ 80 + 443;拒绝其他
- [ ] 创建 `deploy` 用户(sudo 限定 docker 命令)
- [ ] SSH 关闭密码登录;root 禁登;只用 key
- [ ] 安装 Docker Engine + Docker Compose v2
- [ ] 服务器 `docker login ghcr.io`:若 GHCR 镜像包为私有,需用 GitHub PAT(`read:packages`)登录以便拉取(镜像设为 public 则免)
- [ ] 拉取仓库到 `/opt/template-printing`,填好 `.env.prod`(见下方"服务器 .env.prod")
- [ ] 数据库备份:`scripts/deploy/backup.sh`(每日 `pg_dump` → OSS,保留 30 天,配 cron)

## 镜像仓库(GHCR)

> release workflow 用内置 `GITHUB_TOKEN` 自动 build+push,**无需额外注册表密钥**。

- [ ] 确认 GitHub 仓库的 Packages(GHCR)已启用
- [ ] 确认三个镜像包命名空间:`ghcr.io/<org>/tp-api` / `tp-web` / `tp-render`(随首次 release 自动创建)
- [ ] 决定镜像可见性:public(服务器免登录拉取)或 private(服务器需 `docker login ghcr.io` + `read:packages` PAT)
- [ ] (可选)`.env.prod` 里 `REGISTRY=ghcr.io/<org>`、`TAG=<版本>`

## 飞书自建应用

> Spec § 13.3. P0 包含飞书 SSO 登录 + 工作台入口 + 回写多维表格附件。

- [ ] 进入飞书管理后台 → "开发者后台" → "创建企业自建应用"
- [ ] 应用名 / Icon / 描述填好
- [ ] 启用 "身份验证",配置:
  - 重定向 URL: `https://print.<your-company>.com/api/auth/lark/callback`(**含 `/api` 前缀**——nginx 把 `/api` 反代到后端;漏了会回调 404 登录失败)
  - 允许跨域:`https://print.<your-company>.com`
- [ ] 启用 "工作台入口":home_url = `https://print.<your-company>.com`
- [ ] 权限申请(多维表格 + 云空间 + 通讯录 + 身份验证):
  - `contact:user.id:readonly` 拿 user_id
  - `contact:user.base:readonly` 拿姓名 / 头像
  - `drive:drive` 上传文件到云空间
  - `bitable:app` 读写多维表格
  - `authen:user_id.read` 身份验证
- [ ] 提交版本,发布到企业(仅限本企业可用)
- [ ] 复制 `App ID` 和 `App Secret` 备用(填入服务器 `.env.prod`,**非** GitHub Secrets)
- [ ] 指定初始 admin:在飞书拿一两个 user_id(如 IT 负责人),填入 `.env.prod` 的 `INITIAL_ADMIN_LARK_USER_IDS`
- [ ] (启用多维表格按钮触发渲染时)在飞书自动化 webhook body 填 `LARK_BITABLE_VERIFICATION_TOKEN` 同值
- [ ] (启用机器人卡片交互时)事件订阅/卡片回调配 `LARK_BOT_VERIFICATION_TOKEN`;群内 @ 识别需 `LARK_BOT_OPEN_ID`

## GitHub Secrets(仅"连服务器")

> 应用密钥**不在这里**——见下方服务器 `.env.prod`。这里只配 deploy.yml 用到的 SSH 连接。

- [ ] `DEPLOY_HOST`(ECS 公网 IP / 域名)
- [ ] `DEPLOY_USER`(部署用户,如 `deploy`)
- [ ] `DEPLOY_SSH_KEY`(对应私钥)

## 服务器 `.env.prod`(应用密钥与配置)

> 在 ECS 的 `/opt/template-printing/.env.prod`。**完整项与生成命令见仓库根 [`.env.prod.example`](../.env.prod.example)**,以下为必填 / 易漏要点:

- [ ] `POSTGRES_PASSWORD`(强随机,`openssl rand -base64 24`)
- [ ] `JWT_SECRET`(`openssl rand -hex 32`,≥32)
- [ ] `FILE_SIG_SECRET`(`openssl rand -hex 32`;**api 与 render 必须同值**)
- [ ] `LARK_SSO_APP_ID` / `LARK_SSO_APP_SECRET`
- [ ] `LARK_SSO_REDIRECT_URI=https://print.<your-company>.com/api/auth/lark/callback`(与飞书后台一致,含 `/api`)
- [ ] `CORS_ORIGIN=https://print.<your-company>.com`(**生产必设**,默认仅 localhost → 前端跨域全挂)
- [ ] `COOKIE_DOMAIN=print.<your-company>.com`(可选,空=用请求 host)
- [ ] `INITIAL_ADMIN_LARK_USER_IDS` / `INITIAL_ADMIN_LOCAL_PASSWORD`(可选,设则 bootstrap 超管,首登强制改密)
- [ ] **启用多维表格集成时**:`LARK_BITABLE_VERIFICATION_TOKEN` + `RENDER_CALLBACK_SECRET`(`openssl rand -hex 16`)——⚠️ **配了 bitable token 却漏 `RENDER_CALLBACK_SECRET`,生产会启动断言失败拒绝启动**(回调永久 401、状态卡处理中的 fail-fast 保护)
- [ ] **启用机器人时**:`LARK_BOT_VERIFICATION_TOKEN` + `LARK_BOT_OPEN_ID`(漏 open_id 群消息被静默吞,启动期 warn)
- [ ] `REGISTRY=ghcr.io/<org>` / `TAG=<要部署的版本>`
- [ ] (可选,有默认)渲染调优 / 清理 cron / Sentry:`RENDER_*`、`UPLOAD_ORPHAN_GRACE_DAYS`、`AUDIT_LOG_RETENTION_DAYS`、`BOT_SESSION_RETENTION_DAYS`、`SENTRY_DSN`、`APP_VERSION` —— 见 `.env.prod.example` 与 `docs/deployment.md`

## 飞书运维群(部署/告警通知)

> ⚠️ 现状:`deploy.yml` 的成功/失败通知仍是 `# TODO: 接入飞书 webhook`,**尚未实现**。建群+机器人可先备好,接入待后续补。

- [ ] 创建运维群
- [ ] 添加飞书自定义机器人,复制 webhook URL
- [ ] (待实现)在 `deploy.yml` 接入 webhook 通知,并约定对应 GitHub Secret 名
