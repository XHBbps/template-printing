# 模板打印 → 灯塔 Pharos 平台适配说明

> 交接对象:模板打印项目的实现 Claude。
> 背景:模板打印将作为**首个真实应用**部署到公司内网的「灯塔 Pharos」部署+监控平台
> (SSH 部署到被管机、Harbor 拉镜像、平台健康探活/日志/资源监控/飞书告警/更新回滚)。
> 本说明 = 平台部署模型约束 + 四项改造 + 服务登记表 + 验收自检。改造均在本仓库完成。

---

## 1. 平台部署模型(改造的依据,先读)

| 平台约束 | 对本项目的含义 |
|---|---|
| **宿主端口由平台分配**(8000-9000),compose 不写宿主端口;仅「对外」服务获得端口映射 | 去掉 `ports:` 写死;只有 web 对外 |
| **镜像统一从生产 Harbor 拉取**(`192.168.10.124`,HTTP insecure),命名 `tools/<应用>/<服务>:<tag>`;部署时平台注入 registry 前缀与 tag | 模板里 image 写**相对路径**(如 `tools/template-printing/api`),不带 registry/tag |
| **env 由平台部署时注入**:模板只声明 key,值在部署界面填写(敏感值平台 AES-GCM 加密存储) | 取消 `env_file: .env.prod` 模式;梳理 env key 清单(见 §4) |
| **数据用命名卷**:平台更新/回滚/停用均不动卷(回滚只回代码不回数据) | bind mounts(`./data/*`)全部改命名卷 |
| **restart 用 `unless-stopped`**:匹配平台「停用」语义(restart:always 会让已停用应用在宿主重启后复活) | 全服务 `unless-stopped` |
| **平台探活**:每服务登记 http(路径)/ tcp(端口)/ alive 三类之一,部署期健康门 + 10s 轮询 + 飞书告警 | 容器内部 healthcheck 可保留(供 depends_on 健康条件用),与平台探活并存不冲突 |
| **边缘反代/443/certbot 不上平台**:对外 = 平台分配端口 + 公司网关映射 | prod compose 里的 `nginx` 服务整个去掉 |
| 服务间互访走 compose 内网 DNS(服务名) | `postgres`/`redis`/`api`/`web:80` 等地址全部不用改 |

## 2. 四项改造

### A. web 镜像内置 `/api` 反代(关键)

现状 `docker/web-nginx.conf` 是纯静态;边缘 nginx 才有 `/api` 代理。上平台后只暴露 web 一个对外端口,SPA 须同源调 API。
仓库里 `deploy/nginx.conf` **已有正确形态**(root html + `location /api/ → proxy_pass http://api:3000/`)——把它作为 web 镜像的 nginx 配置(保留原 assets 长缓存段则合并两份),重建 tp-web 镜像即可。注意 `/api/` 尾斜杠的去前缀语义与现状保持一致。

### B. bind mounts → 命名卷

| 现状 | 改为 |
|---|---|
| `./data/postgres:/var/lib/postgresql/data` | `pg_data:/var/lib/postgresql/data` |
| `./data/redis:/data` | `redis_data:/data` |
| `./data/storage:/storage`(api 与 render **共享**) | `storage:/storage`(两服务同名卷共享) |

> ⚠ 待你方确认:prod 边缘 nginx 曾把 storage 只读挂出(`/srv/storage`)。若文件下载已全部经 api 提供则无事;若有 nginx 直出静态文件的路径,需改为经 api 出(或在 web 反代加对应 location)。请核实文件出口链路。

### C. 镜像构建与推送(x86_64;被管机为 x86_64)

```
# 构建机配置(一次性):/etc/docker/daemon.json 或 Docker Desktop 设置加
#   { "insecure-registries": ["192.168.10.124"] }  并重启 Docker
docker login 192.168.10.124        # 推送账号由平台侧提供

# 自有镜像(prod 构建)
docker build -t 192.168.10.124/tools/template-printing/api:v1    <api 构建上下文>
docker build -t 192.168.10.124/tools/template-printing/web:v1    <web 构建上下文,含改造 A>
docker build -t 192.168.10.124/tools/template-printing/render:v1 -f docker/render.Dockerfile .
# 公共镜像转推(与平台 seed 应用同模式)
docker pull postgres:16-alpine && docker tag postgres:16-alpine 192.168.10.124/tools/template-printing/postgres:16-alpine
docker pull redis:7-alpine    && docker tag redis:7-alpine    192.168.10.124/tools/template-printing/redis:7-alpine
docker push ...(全部五个)
```

### D. 取消 env_file,梳理 env key 清单

`.env.prod` 中的每个键整理成清单(名称+用途+示例值+是否敏感),部署时在平台界面填值。
`DATABASE_URL`/`REDIS_URL` 这类含密码的连接串作为整值在部署时填(服务名 DNS 不变,如 `postgres://user:pass@postgres:5432/template_printing`)。

## 3. 平台服务登记表(onboarding 时照填;以你方核实为准)

| 服务 | 镜像(相对路径) | 对外 | 平台探活 | 卷 | depends_on | healthcheck(容器级) | mem_limit | env keys |
|---|---|---|---|---|---|---|---|---|
| web | tools/template-printing/web | **是** | http `/`(容器 80) | — | api | — | 128m | — |
| api | tools/template-printing/api | 否 | http `/healthz`(容器 3000) | storage | postgres·redis(等健康) | wget /healthz | 512m | DATABASE_URL、REDIS_URL、NODE_ENV、…(§2D 清单) |
| render | tools/template-printing/render | 否 | alive | storage | postgres·redis(等健康) | — | 2g | DATABASE_URL、REDIS_URL、WEB_BASE、STORAGE_ROOT |
| postgres | tools/template-printing/postgres | 否 | tcp 5432 | pg_data | — | pg_isready | 512m | POSTGRES_USER、POSTGRES_PASSWORD、POSTGRES_DB |
| redis | tools/template-printing/redis | 否 | tcp 6379 | redis_data | — | redis-cli ping | 256m | — |

> `WEB_BASE=http://web:80`、`STORAGE_ROOT=/storage` 维持不变(compose 内网)。

## 4. 验收自检(交付前在本仓库跑通)

1. 按 §2 改造后,本地 `docker compose up`(prod 形态、命名卷)整套起得来
2. 浏览器经 **web 端口**访问:页面正常 + 业务 API 调用走 `/api` 同源成功(改造 A 生效)
3. `curl web:port/api/healthz`(或容器内)→ api 健康端点经反代可达
4. render 正常产出;storage 文件经确认的出口可下载(§2B 待确认项闭环)
5. 五个镜像 x86_64 构建并推送 Harbor 成功(`docker manifest inspect` 或 Harbor UI 可见)
6. 输出:env key 清单(§2D)+ 登记表修订版(§3 如有出入)交回灯塔侧

## 5. 时间线衔接

灯塔平台侧正在实现 B2(结构化表单补 卷/depends_on/healthcheck/mem_limit 字段,正是为承接本应用)。
你方完成 §2-§4 并推好镜像后,由灯塔侧执行 onboarding + 部署到被管机(192.168.10.59)做端到端实战。
有任何与平台模型冲突的点(如必须 bind mount、必须特权等),先反馈灯塔侧评估,不要绕。
