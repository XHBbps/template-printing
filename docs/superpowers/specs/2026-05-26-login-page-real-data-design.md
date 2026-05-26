# 登录页"假控件/假数据"转真实 设计文档

> 状态:已与用户确认设计，进入实现计划阶段。
> 日期:2026-05-26
> 范围:登录页(`apps/web/src/views/LoginView.vue`)两处目前是装饰性的元素 —— "保持登录 30 天"开关、左侧三个统计指标 —— 改为真实生效。

---

## 1. 背景与问题

登录页当前存在两处"看起来真实、实际是假"的元素:

1. **"保持登录 30 天"复选框**:前端 `remember` 变量从未发送到后端;后端 `LoginBodySchema` 也不接受该字段。会话时长恒为固定 30 天(`REFRESH_TTL_SECONDS` 默认值),与勾选无关。开关是无效控件。

2. **左侧三个指标**(月渲染量 `128k+` / P50 延迟 `1.2s` / 渲染成功率 `99.97%`):硬编码在模板里(`LoginView.vue:112/116/120`),非接口数据。

本迭代把两者改为真实生效。

**明确不在范围**:页脚「系统状态」「变更日志」空链接(`href="#"`)保持不动(YAGNI,无真实页面可指)。飞书 OAuth 登录无"保持登录"开关,保持现状默认 30 天持久。

---

## 2. Part A — "保持登录" 接通(含 cookie helper / refresh / logout)

### 2.1 现状

`apps/api/src/auth/jwt/jwt-cookie.helper.ts` 当前**尚未实现** `remember` 语义(已核对代码 `jwt-cookie.helper.ts:26-44`):

- 只导出 `ACCESS_COOKIE` / `REFRESH_COOKIE`,**没有** `REMEMBER_COOKIE`。
- `setAuthCookies(res, env, tokens)` **不接收 options**,恒为 access/refresh 两个 cookie 带固定 `maxAge`(持久),无法表达 session-cookie。
- `clearAuthCookies` 只清 access/refresh 两个 cookie。

因此本迭代需:**在 helper 中实现 remember 语义**(新增 `REMEMBER_COOKIE`、给 `setAuthCookies` 加 `options.remember`、`clearAuthCookies` 同步清理),再把开关从前端一路接到 helper,并让 `/auth/refresh` 续签时延续。

### 2.2 目标语义

- **勾选(默认)**:access cookie 24h,refresh cookie + `tp_remember` 30d `maxAge` —— 持久,关浏览器仍登录。
- **不勾选**:三个 cookie 均为 session cookie(无 `maxAge`)—— 关闭浏览器即登出。DB 中 refresh token 行仍是 30d 过期,**不改 `RefreshTokenService`**(标准 remember-me 语义:服务端 token 有效,但客户端 cookie 在会话结束时被浏览器丢弃)。
- **续签时延续**:`/auth/refresh` 读取 `tp_remember` cookie,以相同 `remember` 语义重新下发 cookie。session 登录续签后仍是 session,持久登录续签后仍是持久。
- **登出时清理**:`clearAuthCookies` 增加清理 `tp_remember`,`/auth/logout` 复用之 + 测试验证。

### 2.3 改动点

**后端**

1. `apps/api/src/auth/local/local.controller.ts`
   - `LoginBodySchema` 增加 `remember: z.boolean().optional().default(true)`(默认 `true`,兼容未传该字段的旧客户端/其他调用方)。
   - `setAuthCookies(res, this.cookieEnv, { access, refresh: refreshTok }, { remember: body.remember })`。

2. `apps/api/src/auth/controllers/auth.controller.ts`(`refresh_` 方法)
   - 从 `cookies` 读取 `REMEMBER_COOKIE`(`tp_remember`):`'0'` → `false`,`'1'` 或缺失 → `true`(缺失按 `true` 兜底,兼容存量持久登录会话)。
   - `setAuthCookies(res, this.cookieEnv, { access: newAccess, refresh: newRefresh }, { remember })`。
   - 需 import `REMEMBER_COOKIE`(同文件已 import 其它 helper 符号)。

3. `apps/api/src/auth/jwt/jwt-cookie.helper.ts`(**本迭代实现 remember 语义**)
   - 新增 `export const REMEMBER_COOKIE = 'tp_remember';`。
   - `setAuthCookies` 增加第四参 `options: { remember?: boolean } = {}`,`const remember = options.remember ?? true;`:
     - `remember === true` → access cookie 带 `maxAge: accessTtlSeconds*1000`,refresh + `tp_remember` 带 `maxAge: refreshTtlSeconds*1000`。
     - `remember === false` → 三个 cookie 均**省略** `maxAge`(session cookie)。
     - `tp_remember` 值为 `'1'`(remember)或 `'0'`,与 access/refresh 同 `baseOptions`(注意 `httpOnly:true` —— refresh 端在服务端读 cookie,无需 JS 访问)。
   - `clearAuthCookies` 增加 `res.clearCookie(REMEMBER_COOKIE, baseOptions(env));`。

**前端**

4. `apps/web/src/views/LoginView.vue`
   - `submitLocal` 的请求体加 `remember: remember.value`:
     ```ts
     body: JSON.stringify({
       username: username.value,
       password: password.value,
       remember: remember.value,
     }),
     ```

### 2.4 测试(Part A)

`apps/api/test/` 下 supertest e2e:

- `remember: false` 登录 → 响应 `Set-Cookie` 中 `tp_access` / `tp_refresh` / `tp_remember` **均无** `Max-Age` 与 `Expires`(session cookie)。
- `remember: true`(或不传)登录 → `tp_refresh` / `tp_remember` 带 `Max-Age` 约 `2592000`(30d 容差),`tp_access` 带 `Max-Age` 约 `86400`(24h)。
- 携 `tp_remember=0` 调 `/auth/refresh` → 新下发的 cookie 仍为 session cookie(无 `Max-Age`)。
- 携 `tp_remember=1` 调 `/auth/refresh` → 新下发 cookie 带 30d `Max-Age`。
- `/auth/logout` → 响应清理三个 cookie(`Max-Age=0` 或过期)。

---

## 3. Part B — 三个指标接真实数据

### 3.1 数据来源

`render_jobs` 表(`apps/api/prisma/schema.prisma` 的 `RenderJob`)字段:`status`(pending/processing/done/failed)、`createdAt`、`startedAt`、`completedAt`。已有索引 `@@index([status, createdAt])`。

### 3.2 新模块 `apps/api/src/stats/`

遵循分层:controller 只做 `@Public` 装饰 + 调 service;service 用 Prisma 查询并缓存;不在 controller 写 Prisma。

- `stats.module.ts` —— 注册 controller + service,导入 Prisma(沿用项目现有 PrismaClient/PrismaService 注入方式,与 `users.module` 对齐)。
- `stats.service.ts` —— 计算 + 60s 内存缓存。
- `stats.controller.ts` —— `@Controller('stats')` 上的 `@Public() @Get('overview')`,即路径 `GET /stats/overview`(`@Get()` 无参会落在 `/stats`,务必带 `'overview'`;`/metrics` 已被 Prometheus 占用,故另起 `stats`)。
- 在 `app.module.ts` 的 `imports` 注册 `StatsModule`。

### 3.3 端点契约

```
GET /stats/overview        (@Public, 无需鉴权)
200 →
{
  windowDays: 30,
  monthlyRenders: number,        // 近30天全部 render_jobs 计数(任意 status)
  p50LatencyMs: number | null,   // 近30天 done 任务渲染耗时中位数(ms);无样本 → null
  successRate: number | null     // done / (done + failed);分母为0 → null;取值 0..1
}
```

### 3.4 计算口径(滚动近 30 天:`created_at >= now() - interval '30 days'`)

- `monthlyRenders` = 近30天 **全部** `render_jobs` 行数(任意 status,含 pending/processing/done/failed)。
  > 按用户确认:统计"提交量",非仅成功量。
- `p50LatencyMs` = 近30天 `status='done'` 且 `started_at`、`completed_at` 均非空的任务,`(completed_at - started_at)` 的中位数,毫秒。用 Postgres `percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (completed_at - started_at)) * 1000)`。无样本 → `null`。
- `successRate` = `count(done) / (count(done) + count(failed))`,近30天;分母为 0 → `null`。

实现用一条 `$queryRaw`(聚合 + `percentile_cont`)一次取齐,或拆 count 与 percentile 两条查询(实现者择简洁者)。

### 3.5 缓存

`stats.service.ts` 内存缓存:`{ data, computedAt }`,TTL 60s。命中则直接返回,未命中重新查询。无需分布式缓存(单值、可接受跨实例轻微不一致)。

### 3.6 前端展示

`apps/web/src/views/LoginView.vue`:

- 新增响应式 `stats = ref<StatsOverview | null>(null)`。
- `onMounted` 调 `apiFetch<StatsOverview>('/stats/overview')`;**失败或字段为 null 一律显示 `—`,不回退任何硬编码旧数字**;不阻塞页面、不弹错误提示(静默)。
- 移除模板中硬编码的 `128`/`1.2`/`99.97`,改为 computed 派生的 `{ value, unit }`(复用现有 `.tp-l-num` / `.tp-l-unit` 结构):
  - **月渲染量**:`stats===null` → `{ value:'—', unit:'' }`;否则按量级格式化 ——
    - `n >= 1000` → `{ value: (n/1000).toFixed(n>=10000?0:1), unit: 'k' }`(如 `1234`→`1.2k`,`128000`→`128k`)。
    - 否则 → `{ value: String(n), unit: '' }`(含 `0`)。
    - 不再带误导性的 `+` 后缀。
  - **P50 延迟**:`p50LatencyMs==null` → `{ value:'—', unit:'' }`;否则 `{ value:(ms/1000).toFixed(1), unit:'s' }`。
  - **渲染成功率**:`successRate==null` → `{ value:'—', unit:'' }`;否则 `{ value:(rate*100).toFixed(2), unit:'%' }`。
- 初始(加载中)状态即 `—`(因 `stats` 初值为 `null`)。

### 3.7 测试(Part B)

- **后端 e2e**(`apps/api/test/`):造若干 `render_jobs`(含 done 带 started/completed、failed、pending),验:
  - `monthlyRenders` = 近30天全部行数(含 pending/failed)。
  - `p50LatencyMs` 等于构造样本的中位数(容差)。
  - `successRate` = done/(done+failed)。
  - 空窗口(无任何近30天任务)→ `monthlyRenders:0`、`p50LatencyMs:null`、`successRate:null`。
  - 端点 `@Public`:不带任何 cookie/token 也返回 200。
- **前端单测**(若项目有前端测试基建则加,否则手测):格式化函数 —— k 格式化、`null`→`—`、成功率两位小数。

---

## 4. 文档同步(强制,按 AGENTS.md 第 9 节)

- `docs/PROGRESS.md`:第 3 节"近期变更"追加本次;"最近更新"日期同步;"已交付能力"补登录页真实指标 + 可控会话时长。
- `AGENTS.md`:第 2 节目录结构补 `apps/api/src/stats/`。
- 若 `.env.example` 涉及(本次不新增环境变量,无需改)。

---

## 5. 提交粒度

按 Part 拆分,避免鉴权改动与展示改动混在一个难回滚的 commit:

1. `feat(auth): 接通"保持登录"开关 — 登录/刷新延续 tp_remember + logout 清理`(Part A 后端 + 前端 body + 测试)。
2. `feat(stats): 新增 GET /stats/overview 公开聚合端点(近30天渲染量/P50/成功率)`(Part B 后端 + 测试)。
3. `feat(web): 登录页三指标接真实接口 — 失败/无数据显示 —`(Part B 前端 + 移除硬编码)。
4. `docs: 同步登录页真实数据特性`(文档)。

(实现者可按需合并 2/3,但 A 与 B 不混。)
