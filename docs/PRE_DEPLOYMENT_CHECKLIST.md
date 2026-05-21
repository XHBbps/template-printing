# Pre-Deployment Checklist

This checklist tracks the **out-of-code** preparation that must happen in parallel with development to ensure the MVP can launch on schedule.

## 域名 + ICP 备案（路径 2：购买 + 备案并行）

> Spec § 9.4. 飞书 SSO 要求 redirect_uri 是 HTTPS 公网域名，国内阿里云 ECS 要求 ICP 备案。

- [ ] 公司主体备案信息确认（营业执照 / 法人 / 应急联系人）
- [ ] 在阿里云购买域名（建议 `.com` / `.cn`，注册时主体填公司）
- [ ] 阿里云控制台提交备案申请（"网站备案" → "新增网站"）
- [ ] 备案管局审核通过（**预计 2-3 周**，期间不能用域名跑公网 HTTPS）
- [ ] DNS 解析：A 记录 `print.<your-company>.com` → ECS 公网 IP
- [ ] 阿里云 SSL 证书申请（免费 DV 证书，或 Let's Encrypt 通过 certbot）

## 阿里云 ECS

- [ ] 购买 `ecs.c7.xlarge`（4 vCPU / 8 GB），系统盘 100 GB ESSD
- [ ] 系统：Ubuntu 22.04 LTS
- [ ] 区域：根据主体所在地（华北 2 / 华东 1）
- [ ] 安全组:开放 22（SSH 限办公 IP）+ 80 + 443；拒绝其他
- [ ] 创建 `deploy` 用户（sudo 限定 docker 命令）
- [ ] SSH 关闭密码登录；root 禁登；只用 key
- [ ] 安装 Docker Engine + Docker Compose v2
- [ ] 数据库备份脚本（每日 `pg_dump` → OSS，保留 30 天）

## 阿里云容器镜像服务 ACR

- [ ] 创建命名空间（建议公司名）
- [ ] 创建 3 个镜像仓库：`template-printing-api` / `template-printing-web` / `template-printing-render`
- [ ] 配置 GitHub Actions 部署 token（在 ACR 控制台创建 RAM 子账号 + AccessKey）

## 飞书自建应用

> Spec § 13.3. P0 包含飞书 SSO 登录 + 工作台入口 + 回写多维表格附件。

- [ ] 进入飞书管理后台 → "开发者后台" → "创建企业自建应用"
- [ ] 应用名 / Icon / 描述填好
- [ ] 启用 "身份验证"，配置：
  - 重定向 URL: `https://print.<your-company>.com/auth/lark/callback`
  - 允许跨域：`https://print.<your-company>.com`
- [ ] 启用 "工作台入口"：home_url = `https://print.<your-company>.com`
- [ ] 权限申请（多维表格 + 云空间 + 通讯录 + 身份验证）：
  - `contact:user.id:readonly` 拿 user_id
  - `contact:user.base:readonly` 拿姓名 / 头像
  - `drive:drive` 上传文件到云空间
  - `bitable:app` 读写多维表格
  - `authen:user_id.read` 身份验证
- [ ] 提交版本，发布到企业（仅限本企业可用）
- [ ] 复制 `App ID` 和 `App Secret` 备用（部署时填入 GitHub Secrets）
- [ ] 指定初始 admin：在飞书拿到一两个 user_id（如 IT 负责人），填入 `INITIAL_ADMIN_LARK_USER_IDS`

## GitHub Secrets

- [ ] `ALIYUN_ACR_USERNAME`
- [ ] `ALIYUN_ACR_PASSWORD`
- [ ] `ECS_SSH_PRIVATE_KEY`
- [ ] `ECS_HOST`
- [ ] `MASTER_KEY`（32 字节 hex，`openssl rand -hex 32`）
- [ ] `JWT_SECRET`（≥ 32 字符，`openssl rand -hex 32`）
- [ ] `FILE_SIG_SECRET`（≥ 32 字符，同上）
- [ ] `DATABASE_URL`（生产 PG 连接串）
- [ ] `REDIS_URL`
- [ ] `LARK_SSO_APP_ID`
- [ ] `LARK_SSO_APP_SECRET`
- [ ] `LARK_SSO_REDIRECT_URI`
- [ ] `INITIAL_ADMIN_LARK_USER_IDS`
- [ ] `INITIAL_ADMIN_LOCAL_PASSWORD`

## 飞书运维群（用于告警）

- [ ] 创建运维群
- [ ] 添加飞书自定义机器人，复制 webhook URL
- [ ] 将 webhook URL 配到部署 env（具体 env 名待 Plan 6 中定义）
