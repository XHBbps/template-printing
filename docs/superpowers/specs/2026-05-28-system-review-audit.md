# 系统整体 Review — 重大漏洞 / 待优化 / 部署运维待办

> 日期:2026-05-28
> 方式:4 路并行深度审计(安全核心流程 / 前端性能打包 / 后端 API 性能存储 / 部署运维),逐项核对真实代码与配置。
> 性质:**体检报告 + 定级清单**,本身即 spec;后续按项挑选进入 writing-plans 修复。每项含 `file:line` + 严重度/影响 + 修复方向。
> 去重:跨路重复项已合并并交叉标注(如 飞书模板可见性、CORS、审计日志膨胀、/metrics 鉴权、orphan uploads)。

---

## 校验修订(2026-05-28,两轮核查 + Opus 交叉复核 + 独立抽验确认 — **以本节为准**)

下文表格保留原始审计明细;**定级/取舍以本节为权威**(已逐项读真实代码确认):

**删除(4 项,非真问题):**
- **V6**(challenge 回显):飞书 URL 验证握手强制,回显攻击者自传值、不泄密/不改状态(`lark-bot.controller.ts:151-152`)。删。
- **P9**(markFailed 冗余 findUnique):`markFailed(reqId)` 仅传 id,必须查出 `appToken/tableId/recordId/statusField` 用于回写表格/发卡片(`lark-bitable.controller.ts:188-196`),是副作用用途非冗余。删。
- **D7**(nginx `.bak` 冲突):conf.d 为 `:ro` 只读挂载(`docker-compose.prod.yml:74`),`include *.conf` 不匹配 `.conf.bak`,最多无害残留。删(连同 O7)。
- **F5**(位置引错):`:152-160` 是 `reloadActive` 非 `onMounted`(后者在 `:268`);**精神成立保留**,改述为"`reloadActive` 内 `:153-159` 的 `loadGridPage`+`refreshRecentId` 可 `Promise.all`"。

**机制/定级修正(6 项):**
- **V2** High→保留 High 但**改写暴露面**:`ownerId=null` 是系统调用方设计、非漏洞技巧;未发布模板被 `no_published_version` 挡住。真实暴露面 = **他人已发布的私有模板**可被飞书机器人选中渲染。
- **V5** High→**降 Medium 且机制说反了**:是 `LARK_BITABLE_*` 与 `LARK_BOT_*` **两个独立 token**(非全局共用一个);漏配时 `!expected || x!==y` → **fail-closed 全拒**(非"无鉴权")。真实问题仅:**bitable 集成内** webhook 值与内部 render-callback token 复用(`:77`/`:83`/`:132`)+ 比较用 `!==` 非常量时间(微弱硬化点)。
- **F4** High→**限定场景**:3 个串行 RTT 仅在"access 过期但 refresh 有效"态;正常 1 RTT、未登录 2 RTT。仍值得乐观渲染,但叙述限定。
- **F11** Low→**改频率描述**:每次"编辑操作"触发(非"每次元素变更");Low 合适。
- **D1** P0→**限定崩溃字段**:真会启动崩的是 `JWT_SECRET`(名字不符)+ 缺 `MASTER_KEY`/`FILE_SIG_SECRET`(+ `LARK_SSO_APP_ID/SECRET/REDIRECT_URI` 也必填无默认);`COOKIE_DOMAIN/SENTRY_DSN/APP_VERSION/LARK_*_VERIFICATION_TOKEN/INITIAL_ADMIN_LOCAL_PASSWORD` 均 optional **不崩**。
- **D5** P0→**降 Low**(硬化项)+ 行号纠正:弱密码在 `.env.example:36`(`:35` 是 username);`env.ts:26` 是 `.min(8).optional()`,dev 样例占位、prod example 未设。
- **D6** 补关键洞察:不仅 api+web 两端 Dockerfile 不同(render 两端相同),**更严重的是 CI 验证的是非-prod 镜像,prod Dockerfile(`apps/*/Dockerfile.prod`)从未被 CI 构建过**。

**提级/提显眼(2 项):**
- **V8**(SVG `<style>`/`data:`)**不降级**:`/uploads/*.svg` 无鉴权直送**活体浏览器**(非仅 Puppeteer,见 ServeStatic serveRoot `/` 仅排除 `/uploads/render`)→ 存储型内容/CSS 外联/SSRF 面真实。`<script>`/`on*` 已剥(挡脚本型 XSS),但应 drop `<style>`、限 href scheme、uploads 加 CSP/Content-Disposition。
- **D-A2**(凭证加密未实现)**提到显眼处**:全仓 `MASTER_KEY` 零加密调用、无凭证表、无 `createCipheriv`/AES;飞书 secret 是 `LARK_SSO_APP_SECRET` 明文 env 注入。`AGENTS.md:190/:353` 宣称"飞书 secret 用 MASTER_KEY 加密存 DB + 传 credentialId" **完全未实现**(`examples/lark-bot/README.md:42` 自承"本版本未实现 AES 解密")。= 功能缺失 + 文档失真,需产品决策(实现 or 改文档)。

**✅ 批次1 已修(2026-05-28)**:V1 / V2 / V3 / V4 / V5 / V8 全部修复并通过 e2e/单测(全量 api 162 用例绿);计划见 `docs/superpowers/plans/2026-05-28-batch1-security-hardening.md`,变更见 PROGRESS 2026-05-28。下文优先级 §1 整批完成;§2 起为后续批次。

**修订后修复优先级(替换文末"建议优先级"):**
1. ✅ **远程可触达核心漏洞(批次1 已修)**:V1(IDOR,叙述去"枚举即得")→ V3(路径穿越,token 门控)→ V4(CORS)→ **V8(SVG 公开服务,提级)**;V2 改写后并入(他人已发布私有模板);V5 降 Medium 单列。
2. ✅ **上线即崩/渲染全废(真 P0)— 批次2 已修(2026-05-28)**:D1(JWT_SECRET/MASTER_KEY/FILE_SIG_SECRET)、D2(WEB_BASE)、D3(storage 卷)、D4(密钥一致,compose 共享 .env.prod 满足)、D6(统一 Dockerfile **且让 CI 跑 prod 镜像**)+ B3(mem_limit)+ V7(/metrics 白名单)。D5/D7 移出 P0(D7 已删,D5 降 Low)。**实建/起栈验证额外发现并修复 3 个原审计未覆盖的真实部署阻断**:**GAP#1** api prod 镜像 pnpm 悬空依赖(`Dockerfile.prod` 改 `pnpm deploy --prod` + undici 误标 devDep 修正)、**GAP#2** compose `${REGISTRY}/${TAG}` 插值需 shell/根 `.env`(部署脚本 `set -a; . .env.prod`)、**GAP#3** 空库首次部署迁移顺序(`init/update.sh` 改 `run --rm migrate` 前置 + `EmergencyAdminBootstrap` 容忍空库)。开发机起 prod 栈渲染往返通过。计划见 `docs/superpowers/plans/2026-05-28-batch2-prod-deploy-artifacts.md`。
3. **凭证加密未实现(D-A2)**:功能缺失 + 文档失真,需产品决策。
4. ✅ **存储无限增长 — 批次3 已修(2026-05-28)**:P1(orphan uploads)、P2(audit_log)、P12(飞书会话)三个清理 cron 全部实现并通过 e2e + `env-example-sync`(三个新 env `UPLOAD_ORPHAN_GRACE_DAYS`/`AUDIT_LOG_RETENTION_DAYS`/`BOT_SESSION_RETENTION_DAYS`,默认 7/90/30,0/≤0=关)。**规划期额外发现并修复** `RENDER_DIR` 漏 `uploads/` 路径 bug:`render-cleanup.service.ts` 的渲染产物清理(`cleanupOldOutputs`)与签名下载此前指向不存在的 `STORAGE_ROOT/render/` → 删错路径 + 签名下载 404,改为正确的 `STORAGE_ROOT/uploads/render/`。
5. **首屏快赢**:F1、F7、(改写后的)`reloadActive` 并行。

---

## 桶一:重大漏洞(影响核心功能使用 / 安全)

> 排序:Critical → High → Medium。这些会被远程触达或破坏核心流程(API 调用 / 模板编辑 / 飞书侧)。

| # | 级别 | 标题 | 位置 | 影响 | 修复方向 |
|---|---|---|---|---|---|
| V1 | **Critical** | `GET /render/:jobId` 无归属校验(IDOR) | `render.service.ts:134` `get()`、`render.controller.ts:80` | 任意已登录用户/api-token 持有者枚举 jobId 即可读他人任务状态 + 拿到 24h 有效 HMAC 签名下载 URL(他人渲染产物)。`listJobs` 有 owner 过滤,单条 get 没有 | `get()` 传入 `me.sub`,按 `template.ownerId` 过滤(admin 放行) |
| V2 | **High** | 飞书机器人列出**全部**模板(私有/未发布/他人)并可渲染 | `lark-bot.controller.ts:231,326`;入队 `:390` 用 `ownerId=null` 绕过归属 | 飞书用户能在机器人下拉里选到他人私有/未发布模板并触发渲染 → 越权读取他人模板内容 | 列表与渲染前均过滤 `visibility='public' AND publishedVersion != null`(C-#7 同源) |
| V3 | **High** | 渲染回调端点 `pdfUrl` 无路径穿越防护 → 任意文件读 | `lark-bitable.controller.ts:151-153`、`lark-bot.controller.ts:441-443` | 回调体 `pdfUrl=/../../etc/passwd` 经 `path.join(STORAGE_ROOT,...)` + `fs.readFile` 读任意可读文件回传飞书(被攻破/重放 worker 时);`signed-uploads.controller.ts:64` 已正确做了该校验,这两处漏了 | 加 `path.resolve(full).startsWith(path.resolve(STORAGE_ROOT))` 前缀校验 |
| V4 | **High** | CORS `origin:true` + `credentials:true` | `apps/api/src/main.ts:32` | 反射任意 Origin 且允许携带 cookie → 任意站点可对 API 发起带凭证的跨站请求(读 cookie 鉴权响应体)。等于 CORS 防护失效 | 改为显式 allowlist(读 `CORS_ORIGIN` env,生产填正式域名);与 D-B8 同项 |
| V5 | **High** | 同一 verification token 同时用于"外部飞书 webhook 鉴权"和"内部 render→API 回调",且均 `.optional()` | `common/env.ts:36-48`;`lark-bitable.controller.ts:76`、`lark-bot.controller.ts:160,386` | token 从飞书后台(租户管理员可见)泄露即可调内部回调端点伪造 jobId/pdfUrl;且漏配时集成静默失效 | 拆成两个独立必填 secret(外部 webhook 用一个、内部回调用 `RENDER_CALLBACK_SECRET`) |
| V6 | Medium | 飞书机器人 `url_verification` challenge 先于 token 校验回显 | `lark-bot.controller.ts:151-152`、`:274` | 任意公网请求可探测/在注册窗口期抢注端点(飞书设计要求,风险有限) | 启用飞书 encrypt 模式,或 challenge 也校验 token |
| V7 | Medium | `GET /metrics` 完全无鉴权(`@Public`) | `metrics.controller.ts:22` | Prometheus 指标(渲染量/配额/用户活动/队列深度)对公网泄露;注释说"在 nginx 加白名单"但未实现 | nginx `/metrics` 加 IP allow/deny,或加 bearer secret;与 D-B5 同项 |
| V8 | Medium | SVG 消毒器放行 `<style>` 标签与 `data:` URI | `uploads/svg-sanitiser.ts:35,73,108` | 上传 SVG 可含任意 CSS(`@import`)/`data:` 载荷,送 Chromium 渲染时存在注入/外联面 | 移除 `<style>`;`data:` 仅限 `data:image/*` |
| V9 | Medium | 飞书机器人事件去重为**进程内内存** | `lark-bot.controller.ts:120-139` | 多副本部署时同一事件每副本各处理一次 → 重复渲染/重复计费 | 去重移到 Redis `SET NX EX 300`(与 D-B 多副本相关) |

> 说明(已核查 **非**漏洞,免误判):SSO 自动建号不设本地密码(纯 SSO 登录,无硬编码默认密码,符合底线);`resetPassword`/`setPassword` 对非本地账号已正确 403;`changeRole` 外部账号禁 admin 已生效;签名 `verify()` 用 `timingSafeEqual`。

---

## 桶二:待优化项(首屏 / 请求时间 / 存储 / 打包 / API 性能)

### 2A 前端性能 / 打包体积

| # | 影响 | 标题 | 位置 | 修复方向 | 类型 |
|---|---|---|---|---|---|
| F1 | High | Element Plus 全量引入(无按需) | `web/src/main.ts:10,24` | 上 `unplugin-vue-components`+auto-import 按需;省 ~300-400KB gz JS + ~100KB CSS | 快赢 |
| F2 | High | `DesignerView` 及 20+ 设计器组件被 `TemplatesView` 静态引入 | `web/src/views/TemplatesView.vue:31`(+ `:21-22` Header/VersionDialog) | 改 `defineAsyncComponent`,设计器+renderer 单独分包,仅编辑时加载 | 中重构 |
| F3 | High | `bwip-js`(~250KB)+ qrcode 经 `TemplateThumb`→renderer 进首屏包 | `template-renderer/.../BarcodeElement.vue:8`、`QrElement.vue:6` | 条码/QR 元素懒加载;或缩略图改用已发布 PNG 而非实时渲染 | 中重构 |
| F4 | High | 首屏被 hydrate 串行瀑布阻塞(过期会话最多 3 个 RTT) | `web/src/router/index.ts:124-137`、`stores/auth.ts:47-76` | 乐观渲染(先挂骨架,hydrate 后台跑);或 hydrate 短 TTL 缓存 | 中重构 |
| F5 | High | `TemplatesView` 挂载时 2 个独立请求串行 | `TemplatesView.vue:152-160` | `Promise.all([loadGridPage(1), refreshRecentId()])` | 快赢 |
| F6 | High | `TemplateThumb` 每张缩略图一个 GET(取完整 data 大 blob)→ N+1 | `views/TemplateThumb.vue:37` | IntersectionObserver 仅可视加载;或列表 API 直接返回缩略图 URL | 中 |
| F7 | Med | `vite.config.ts` 零构建优化(无 manualChunks) | `web/vite.config.ts` | 加 `build.rollupOptions.output.manualChunks` 拆 element-plus / vue 全家桶 / renderer | 快赢 |
| F8 | Med | `ApiView` 挂载即拉 `/templates?limit=100`(默认 Docs tab 用不到) | `views/ApiView.vue:201-209` | 按 tab 激活懒加载 | 中 |
| F9 | Med | 自动保存对整个 `template` 深 watch | `views/DesignerView.vue:109-125` | 改用快照版本计数器(watch `history.length`) | 中 |
| F10 | Med | 公共模板 tab `limit=100` 无虚拟化/分页 | `TemplatesView.vue:177-189` | 分页或"加载更多" + 缩略图懒加载 | 中 |
| F11 | Low | `snapshot()` 每次元素变更都 `JSON.stringify`+localStorage 写 | `stores/designer.ts:210-220` | persist 与 snapshot 解耦,localStorage 写 debounce ~500ms | 低 |

> 其余小项:`refreshRecentId` 可前端从已取列表算出省一个请求(F-#13);`/auth/refresh` 可直接返回 user 省二次 `/users/me`(F-#14,后端);`AuditLogView` 挂载两请求可并行(F-#17)。

### 2B 后端 API 性能 / 存储清理

| # | 影响 | 标题 | 位置 | 修复方向 |
|---|---|---|---|---|
| P1 | High | ✅ 批次3 已修 · **上传图片永不清理**,`/storage/uploads/` 无限增长 | `uploads/uploads.service.ts:91-95` + cleanup 仅清 render | ✅ 新增 `cleanupOrphanUploads()` cron:扫 `templates.data` 引用后删 mtime 早于 `UPLOAD_ORPHAN_GRACE_DAYS`(默认7,0=关)的顶层孤儿文件 |
| P2 | High | ✅ 批次3 已修 · `audit_log` 无任何保留/清理 → 无限增长 | `audit/audit-log.service.ts`(无 prune)、`schema.prisma:200` | ✅ 新增 `cleanupAuditLog()` cron:`deleteMany(createdAt < cutoff)`,`AUDIT_LOG_RETENTION_DAYS` 默认 90(≤0=关);与 D-B12 同项 |
| P3 | High | ✅ 批次8 已修 · 日配额 `count`(join templates)每次入队同步执行,无缓存 | `render.service.ts:266-296` | ✅ Redis 缓存当日计数(GET 命中/miss 跑 DB + SETEX 至午夜 + enqueue 后 incr;**Redis 错误 fail-open 回 DB**,软配额不阻塞入队);未做反范式 `ownerId`(缓存原查询语义零变更,优先低风险) |
| P4 | Med | ✅ 批次8 已修 · `listVersions` 无分页上限 | `templates.service.ts:129-133` | ✅ 加 `take:100`(orderBy version desc,取最新 100 版) |
| P5 | Med | ✅ 批次8 已修 · 清理 cron 一次性把所有旧 job 读进内存 | `render-cleanup.service.ts:45-52` | ✅ 分批 `take:500` 循环(每批置 cleanedAt 单调推进) |
| P6 | Med | ✅ 批次8 已修 · `reconcileStuckJobs` N 条逐条 update(N 次往返) | `render-cleanup.service.ts:98-115` | ✅ 单条 bulk `updateMany` 翻转 + 回查本次翻转行回调(N→2 往返),**保批次4 竞态安全** |
| P7 | Med | ✅ 批次8 已修 · 上传 PNG/JPEG `sharp` 解码两次 | `uploads.service.ts:59-77` | ✅ 复用单 `sharp` 实例(`metadata()` 取 density + `.toBuffer()` 取宽高),免输入二次解码 |
| P8 | Med | ✅ 批次8 已修 · `distinctActions` 全表扫描无日期窗 | `audit-log.service.ts:136` | ✅ 改 `$queryRaw SELECT DISTINCT action FROM audit_log ORDER BY action ASC`(去 Prisma distinct 全行 hydrate) |
| P9 | Med | ✅ 已修(2026-05-29) · `markFailed`(Bitable+Bot)update 前冗余 `findUnique` | `lark-bitable.controller.ts:204`、`lark-bot.controller.ts:498` | ✅ `markFailed` 改收调用方(renderCallback)已取的记录(传 record 而非 id),去重复 `findUnique`;`appToken/recordId/chatId` 等创建后不可变,与重查语义等价 |
| P10 | Med | ✅ 批次8 已修 · 缺 `render_jobs(status, startedAt)` 索引(对账 cron 用) | `schema.prisma:108-111` | ✅ 加 `@@index([status, startedAt])` + migration `add_renderjob_status_startedat_index` |
| P11 | Low | ✅ 评估后维持现状(2026-05-29) · `listJobs` 返回每行完整 `data` JSON blob | `render.service.ts:249` | 详情弹窗直接复用 list 行 `data`（`GET /:jobId` 不返回 data）;单组织 + 分页(默认 20 / 上限 100)下边际成本小,精简需详情面板改按需拉取(动可用功能 + 加 loading,低 ROI)→ **决定维持现状**,见 PROGRESS 2026-05-29 |
| P12 | Low | ✅ 批次3 已修 · `lark_bot_sessions` done/failed 永不清理 | `schema.prisma:135` | ✅ 新增 `cleanupBotSessions()` cron:删 `done`/`failed` 且 `updatedAt` 早于 `BOT_SESSION_RETENTION_DAYS`(默认30,≤0=关)的行 |
| P13 | Low(未来) | ✅ 决策落定(2026-05-29) · `render_jobs` 行永不删,长期百万行 | 设计选择 | **维持现状不删**;部署上量后按"行数 / 表体积阈值"再做按月分区或归档,6-12 月评估,**不提前实现**,见 PROGRESS 2026-05-29 |

---

## 桶三:部署运维待办(部署确认项 + 便于运维的方案改动)

> ⚠️ 项目**从未部署过**。下列 P0 多为"不改则生产直接不工作/启动失败",其中 D5/D6 会让**渲染功能在生产完全失效**(属影响核心功能,与桶一关联)。

### 3A 部署确认项(首次上线前必须核实/修)

| # | 级别 | 项 | 位置 | 后果 / 必须做 |
|---|---|---|---|---|
| D1 | **P0** | `.env.prod.example` 字段名与 `env.ts` 校验不符 | `.env.prod.example` vs `common/env.ts:11` | example 写 `JWT_ACCESS_SECRET`,代码要 `JWT_SECRET`;还缺 `MASTER_KEY/FILE_SIG_SECRET/COOKIE_DOMAIN/SENTRY_DSN/APP_VERSION/LARK_*_VERIFICATION_TOKEN`。按 env.ts 字段名设全,否则 `validateEnv()` 启动即崩 |
| D2 | **P0** | render 容器 `WEB_BASE` 仍 fallback `http://web:5173` | `render/src/renderer.ts:7`;`docker-compose.prod.yml` render 无该 env | 生产 web 在 80,渲染全部连不上超时失败。必须设 `WEB_BASE=http://web:80` + `STORAGE_ROOT=/storage` |
| D3 | **P0** | render 容器未挂 storage 卷 | `docker-compose.prod.yml` render 无 volumes | 输出写 `/storage` 但与 api 不共享 → 下载 404。必须加 `- ./data/storage:/storage` |
| D4 | **P0** | `FILE_SIG_SECRET` 须 api 与 render 一致 | `render/file-sig.ts:10`、`uploads/file-sig.service.ts` | 不一致则签名 URL 校验 401。确认两容器同一 `.env.prod` |
| D5 | P0 | `INITIAL_ADMIN_LOCAL_PASSWORD` 用强随机 | `.env.example:35` 弱默认 | `openssl rand -hex 16`,首次登录立即改 |
| D6 | P0 | CI 与 release 用不同 Dockerfile | `ci.yml`(`docker/api.Dockerfile`) vs `release`(`apps/api/Dockerfile.prod`) | CI 绿但 release 是不同构建路径(tini/ENTRYPOINT 差异)。统一 |
| D7 | P0 | `init-ssl.sh` 的 `sed -i.bak` 残留 `.conf.bak` 被 nginx include | `scripts/deploy/init-ssl.sh:40` | nginx 报 duplicate server/语法错。sed 后 `rm` 掉 .bak |
| D8 | P1 | `LARK_SSO_REDIRECT_URI` 须 nginx 剥前缀 + 飞书后台三方一致 | `.env.prod.example:9`、`auth/lark/lark.service.ts` | 人工走通一次 SSO |
| D9 | P1 | 启用飞书功能须设两个 verification token | `env.ts:36-48`(optional) | 用 `openssl rand -hex 16` 生成填入(与 V5 拆分配合) |
| D10 | P1 | `SENTRY_DSN` + `APP_VERSION` 留空则无告警 | `instrument.ts:13` | 生产建议建 Sentry 项目并填 |
| D11 | P1(外部) | 域名/ICP 备案/SSL、飞书应用审核、ACR vs GHCR 仓库选择 | `docs/PRE_DEPLOYMENT_CHECKLIST.md` | 框架就绪,外部条件待办;`release.yml` 目前只 GHCR login,用 ACR 需补 |

> 关键发现 **D-A2**:`MASTER_KEY` 代码里仅在 env.ts 校验存在,**无任何加密业务调用**;文档称"飞书 secret 用 MASTER_KEY 加密存 DB"实际**未实现**(飞书是单一全局 `LARK_SSO_APP_SECRET` 明文注入,无 per-tenant credential 表)。部署填合法 64-hex 占位即可,但"凭证加密"是缺失功能,需记入待办。

### 3B 便于后续运维的方案改动(价值/成本排序)

| # | 价值/成本 | 改动 | 位置 |
|---|---|---|---|
| O1 | 高/低 | 修 `.env.prod.example` 字段对齐 env.ts(让 `cp` 即可用) | `.env.prod.example` |
| O2 | 高/低 | compose.prod 的 render 补 `WEB_BASE/STORAGE_ROOT/volume`(否则渲染不工作) | `docker-compose.prod.yml` |
| O3 | 高/低 | 所有服务加 `mem_limit`(render 2g/api 512m/pg 512m/redis 256m),防 Chromium OOM 拖垮宿主 | `docker-compose.prod.yml` |
| O4 | 高/低 | 统一 CI 与 release 的 Dockerfile | `.github/workflows/ci.yml` |
| O5 | 高安全/低 | nginx `/metrics` 加 IP 白名单(配合 V7) | `docker/nginx/conf.d/*.conf` |
| O6 | 中/低 | deploy workflow 接飞书群通知(代码留有 TODO) | `.github/workflows/deploy.yml:39` |
| O7 | 中/低 | `init-ssl.sh` 删 `.bak`(配合 D7) | `scripts/deploy/init-ssl.sh` |
| O8 | 中安全/低 | CORS 改 env allowlist(配合 V4) | `apps/api/src/main.ts:32` |
| O9 | 高数据安全/中 | `update.sh` migrate 前备份 + 失败回滚 | `scripts/deploy/update.sh:37` |
| O10 | 中/低 | render 容器加 healthcheck | `docker-compose.prod.yml` |
| O11 | 高数据安全/中 | `backup.sh` 加异地(OSS)备份(现仅本地 7 天) | `scripts/deploy/backup.sh:21` |
| O12 | 中/低 | audit_log 清理 cron(配合 P2) | `render-cleanup.service.ts` |
| O13 | 低/低 | 补全 PRE_DEPLOYMENT_CHECKLIST 的 secrets 清单 | `docs/PRE_DEPLOYMENT_CHECKLIST.md` |

### 现有亮点(已就绪,无需动)
healthcheck(pg/redis/api)+依赖链;nestjs-pino 结构化日志 + 敏感字段屏蔽 + X-Request-Id;prom-client `/metrics` 业务指标;Sentry(5xx 上报/4xx 过滤);render worker SIGTERM 优雅关机(worker.close+pool.shutdown);僵尸任务对账 cron;HMAC 文件签名 + timingSafeEqual + 路径穿越防护(signed-uploads);render 非 root + tini;`prisma migrate deploy`(非 reset)+ migration_lock;emergency_admin 首次强制改密;web 生产为 Vite 构建静态 + nginx(非 dev server)。

---

## 建议优先级(若后续逐项修)

1. **先堵远程可触达的核心漏洞**:V1(渲染 IDOR)、V2(飞书越权渲染他人模板)、V3(回调路径穿越)、V4(CORS)。
2. **上线前阻断项**:D1/D2/D3/D4(否则启动失败或渲染全废)、D6/D7。
3. **存储无限增长**(运行数周即显现):P1(orphan uploads)、P2(audit_log)。
4. **首屏/打包快赢**:F1、F5、F7(低成本高感知)。
5. 其余按表内级别择机。

## 不做 / 约束(本报告范围)
- 本轮**只产出报告 + 定级清单**,不改代码(用户选定)。
- 每项已核对真实代码/配置,非臆测;"现有亮点"为已验证就绪项。
- 修复各项请另起 spec/plan(可按"建议优先级"分批)。
