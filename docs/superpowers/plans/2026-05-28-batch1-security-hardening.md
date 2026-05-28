# 批次1:远程可触达核心漏洞 安全加固 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复系统 review 报告中"远程可触达核心漏洞"批次:渲染 IDOR、飞书越权渲染、回调路径穿越、CORS 反射、SVG 公开服务注入面、bitable token 复用。

**Architecture:** 后端 NestJS;每个漏洞一个独立 task(便于评审),TDD(authz/路径/CORS 用 e2e,SVG 消毒/token 用单测)。不改入队 attempts、渲染视觉、前端。

**Tech Stack:** NestJS + Prisma(PostgreSQL)+ Jest/supertest;`apps/api` 容器跑测试。

**Spec:** `docs/superpowers/specs/2026-05-28-system-review-audit.md`(以"校验修订"节为权威)

**全局约定:** 测试 `docker exec template_printing-api sh -c "cd /workspace/apps/api && pnpm test -- <file>"`(e2e 命中真实 DB);typecheck/lint 同容器 `pnpm run typecheck` / `pnpm run lint`。husky 提交不 `--no-verify`,每 task 只 `git add` 本 task 文件。用 `@jest/globals`。

---

## File Structure
- Modify `apps/api/src/render/render.service.ts` + `render.controller.ts` —— V1 归属校验。
- Modify `apps/api/src/lark/lark-bot.controller.ts` —— V2 模板过滤(+ V3 路径校验)。
- Modify `apps/api/src/lark/lark-bitable.controller.ts` —— V3 路径校验 + V5 token 拆分。
- Modify `apps/api/src/main.ts` + `common/env.ts` —— V4 CORS allowlist。
- Modify `apps/api/src/uploads/svg-sanitiser.ts` + `app.module.ts` —— V8 消毒 + svg 响应头。
- Tests: `apps/api/test/*.e2e.spec.ts`(V1/V3/V4/V5)、`apps/api/test/svg-sanitiser.spec.ts`(V8)、V2 定向测试。

---

## Task 1 (V1): 渲染任务读取加归属校验(IDOR)

**Files:** Modify `apps/api/src/render/render.service.ts`(`get`)、`render.controller.ts`(`:80-93`);Test `apps/api/test/render-get-ownership.e2e.spec.ts`(新)。

- [ ] **Step 1: 写失败 e2e**

新建 `apps/api/test/render-get-ownership.e2e.spec.ts`(照搬同目录 e2e 的 app 引导/登录/CSRF helper;需要造 owner A、owner B 两用户 + 各自模板 + 一条 A 的 render_job)。断言:
- B 登录后 `GET /render/<A的jobId>` → 403 或 404(不泄露)。
- A 本人 `GET /render/<A的jobId>` → 200。
- admin/emergency_admin `GET /render/<A的jobId>` → 200。
(若引导成本高,可直接 `new RenderService(...)`/从 TestingModule `app.get(RenderService)`,用 prisma 造数据后调 `svc.get(jobId, user)`;与同目录现有 e2e 风格一致。)

- [ ] **Step 2: 跑测试确认失败**

Run: `docker exec template_printing-api sh -c "cd /workspace/apps/api && pnpm test -- test/render-get-ownership.e2e.spec.ts"`
Expected: FAIL(当前 B 能取到 200)。

- [ ] **Step 3: 改 `RenderService.get` 签名加归属过滤**

`render.service.ts` 把 `async get(jobId: string)` 改为接受调用者并过滤:
```ts
  async get(
    jobId: string,
    user: { sub: string; role: string },
  ): Promise<{ /* …原返回类型不变… */ }> {
    const isAdmin = user.role === 'admin' || user.role === 'emergency_admin';
    const job = await this.prisma.renderJob.findUnique({
      where: { id: jobId },
      include: { template: { select: { ownerId: true } } },
    });
    if (!job) throw new NotFoundException('job_not_found');
    if (!isAdmin && job.template?.ownerId !== user.sub) {
      // 不泄露存在与否
      throw new NotFoundException('job_not_found');
    }
    return {
      jobId: job.id,
      status: job.status,
      pdfUrl: this.fileSig.signUrl(job.pdfUrl),
      pngUrl: this.fileSig.signUrl(job.pngUrl),
      errorMsg: job.errorMsg,
      createdAt: job.createdAt,
      completedAt: job.completedAt,
      cleanedAt: job.cleanedAt,
      templateVersion: job.templateVersion,
    };
  }
```
(`NotFoundException` 已 import。注意:原 `findUnique` 无 include;新增 `include.template.ownerId`。)

- [ ] **Step 4: 改 controller 传入 user**

`render.controller.ts` `get`(:80)加 `@CurrentUser() me: JwtClaims` 并传:
```ts
  @Get(':jobId')
  async get(@CurrentUser() me: JwtClaims, @Param('jobId') jobId: string): Promise<{ /* 类型不变 */ }> {
    return this.svc.get(jobId, { sub: me.sub, role: me.role });
  }
```
(`@CurrentUser()`/`JwtClaims` 该文件 `listJobs` 已在用,照搬 import。)

- [ ] **Step 5: 测试通过 + typecheck + lint**

Run: `docker exec template_printing-api sh -c "cd /workspace/apps/api && pnpm test -- test/render-get-ownership.e2e.spec.ts && pnpm run typecheck && pnpm run lint"`
另跑既有 render e2e 确认无回归。

- [ ] **Step 6: 提交**
```bash
git add apps/api/src/render/render.service.ts apps/api/src/render/render.controller.ts apps/api/test/render-get-ownership.e2e.spec.ts
git commit -m "fix(api): 渲染任务读取加归属校验，修 GET /render/:jobId IDOR(V1)"
```

---

## Task 2 (V2): 飞书机器人仅列/渲染 公共+已发布 模板

**Files:** Modify `apps/api/src/lark/lark-bot.controller.ts`(模板列表 `~:231`/`~:326`;渲染前 lookup);Test:定向测试(见下)。

- [ ] **Step 1: 先读现状**

读 `lark-bot.controller.ts` 中两处 `prisma.template.findMany`(机器人列模板)与选择模板后的 `prisma.template.findUnique`(渲染前 lookup)。确认字段名 `visibility`(`'public'|'private'`)与 `publishedVersion`。

- [ ] **Step 2: 写定向测试**

新建 `apps/api/test/lark-bot-template-visibility.e2e.spec.ts`:用 prisma 造三模板:① public+published、② private+published、③ public+未发布(publishedVersion=null)。把"列出机器人可选模板"的查询抽成 service 方法或直接在测试里复刻断言:仅 ① 返回。若抽方法(推荐):在 controller 加 `private async listBotTemplates()` 返回 `findMany({ where: { visibility: 'public', publishedVersion: { not: null } }, ... })`,测试调它。断言结果只含 ①。

- [ ] **Step 3: 跑测试确认失败**

Run: `docker exec template_printing-api sh -c "cd /workspace/apps/api && pnpm test -- test/lark-bot-template-visibility.e2e.spec.ts"`
Expected: FAIL(当前返回全部)。

- [ ] **Step 4: 实现过滤**

两处 `findMany`(列模板)加 `where: { visibility: 'public', publishedVersion: { not: null } }`。渲染前的 `findUnique({ where: { id: templateId } })` 改为 `findFirst({ where: { id: templateId, visibility: 'public', publishedVersion: { not: null } } })`,取不到则返回友好错误(机器人卡片提示"模板不可用"),不进入 `enqueue`。

- [ ] **Step 5: 测试通过 + typecheck + lint**

Run: `docker exec template_printing-api sh -c "cd /workspace/apps/api && pnpm test -- test/lark-bot-template-visibility.e2e.spec.ts && pnpm run typecheck && pnpm run lint"`

- [ ] **Step 6: 提交**
```bash
git add apps/api/src/lark/lark-bot.controller.ts apps/api/test/lark-bot-template-visibility.e2e.spec.ts
git commit -m "fix(api): 飞书机器人仅列/渲染 公共且已发布 模板，修越权渲染他人模板(V2)"
```

---

## Task 3 (V3): 渲染回调 pdfUrl 路径穿越校验

**Files:** Modify `apps/api/src/lark/lark-bitable.controller.ts`(`~:151-153`)、`apps/api/src/lark/lark-bot.controller.ts`(`~:441-443`);Test `apps/api/test/render-callback-path-traversal.e2e.spec.ts`(新)。

- [ ] **Step 1: 写失败 e2e**

新建 `apps/api/test/render-callback-path-traversal.e2e.spec.ts`:对 bitable render-callback(带正确 token,见 Task 6 后用 `RENDER_CALLBACK_SECRET`;本 task 先用现行 token)发 `{ jobId:<已存在的 larkPrintRequest 对应 job>, status:'done', pdfUrl:'/../../../../etc/hostname' }`。断言:不抛出文件内容、不 500-with-file;应安全拒绝(如 400 `invalid_path` 或静默 ack 不读文件)。同样覆盖 bot 回调。

- [ ] **Step 2: 跑测试确认失败**

Run: `docker exec template_printing-api sh -c "cd /workspace/apps/api && pnpm test -- test/render-callback-path-traversal.e2e.spec.ts"`

- [ ] **Step 3: 两处加前缀校验**

在两个 controller 的 `const filePath = path.join(STORAGE_ROOT, relative);` 之后、`fs.readFile(filePath)` 之前,插入(参照 `signed-uploads.controller.ts:64`):
```ts
        if (!path.resolve(filePath).startsWith(path.resolve(STORAGE_ROOT) + path.sep)) {
          throw new BadRequestException('invalid_pdf_path');
        }
```
(`BadRequestException` 已 import;`path`/`STORAGE_ROOT` 已在用。`+ path.sep` 防 `/storageX` 前缀绕过。)

- [ ] **Step 4: 测试通过 + typecheck + lint**

Run: `docker exec template_printing-api sh -c "cd /workspace/apps/api && pnpm test -- test/render-callback-path-traversal.e2e.spec.ts && pnpm run typecheck && pnpm run lint"`

- [ ] **Step 5: 提交**
```bash
git add apps/api/src/lark/lark-bitable.controller.ts apps/api/src/lark/lark-bot.controller.ts apps/api/test/render-callback-path-traversal.e2e.spec.ts
git commit -m "fix(api): 渲染回调 pdfUrl 加路径穿越前缀校验(V3)"
```

---

## Task 4 (V4): CORS 改 env allowlist

**Files:** Modify `apps/api/src/common/env.ts`、`apps/api/src/main.ts`(`:31-34`);Test `apps/api/test/cors.e2e.spec.ts`(新)。

- [ ] **Step 1: env 增字段**

`env.ts` 加(dev 默认放行本地 web):
```ts
  // 逗号分隔的允许来源;生产必须显式设(如 https://print.x.com)
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
```

- [ ] **Step 2: 写失败 e2e**

新建 `apps/api/test/cors.e2e.spec.ts`:supertest 对任一端点发带 `Origin: https://evil.example` 的请求,断言响应**不含** `access-control-allow-origin: https://evil.example`(且不为 `*`);再发 `Origin: http://localhost:5173`,断言 `access-control-allow-origin: http://localhost:5173` 且 `access-control-allow-credentials: true`。(测试前设 `process.env.CORS_ORIGIN='http://localhost:5173'`。)

- [ ] **Step 3: 跑测试确认失败**

Run: `docker exec template_printing-api sh -c "cd /workspace/apps/api && pnpm test -- test/cors.e2e.spec.ts"`
Expected: FAIL(当前反射 evil origin)。

- [ ] **Step 4: 改 main.ts CORS**

把 `:31-34`:
```ts
  app.enableCors({ origin: true, credentials: true });
```
改为:
```ts
  const allowed = env.CORS_ORIGIN.split(',').map((s) => s.trim()).filter(Boolean);
  app.enableCors({
    origin: (origin, cb) => {
      // 无 Origin(同源/服务端/curl)放行;有 Origin 须在白名单
      if (!origin || allowed.includes(origin)) cb(null, true);
      else cb(null, false);
    },
    credentials: true,
  });
```
(`env` 已在 `bootstrap` 内可用——确认 `validateEnv()` 的返回赋给 `env`;若 main.ts 用 `process.env`,改读 `env.CORS_ORIGIN`。)

- [ ] **Step 5: 测试通过 + typecheck + lint**

Run: `docker exec template_printing-api sh -c "cd /workspace/apps/api && pnpm test -- test/cors.e2e.spec.ts && pnpm run typecheck && pnpm run lint"`

- [ ] **Step 6: 提交**
```bash
git add apps/api/src/common/env.ts apps/api/src/main.ts apps/api/test/cors.e2e.spec.ts
git commit -m "fix(api): CORS 改 env allowlist，禁止任意来源带凭证跨站(V4)"
```

---

## Task 5 (V8): SVG 消毒去 `<style>`/`data:` + svg 响应头

**Files:** Modify `apps/api/src/uploads/svg-sanitiser.ts`(`ALLOWED_TAGS`/`ALLOWED_ATTRS`/`allowedSchemes`)、`apps/api/src/app.module.ts`(ServeStatic setHeaders);Test `apps/api/test/svg-sanitiser.spec.ts`(新,纯单测)。

- [ ] **Step 1: 写失败单测**

新建 `apps/api/test/svg-sanitiser.spec.ts`:
```ts
import { describe, it, expect } from '@jest/globals';
// eslint-disable-next-line import/no-unresolved
import { sanitiseSvg } from '../src/uploads/svg-sanitiser.js';

const wrap = (inner: string) =>
  Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">${inner}</svg>`);

describe('sanitiseSvg', () => {
  it('strips <style> blocks', () => {
    const out = sanitiseSvg(wrap('<style>@import url(http://evil/x.css);</style><rect/>'))!.toString('utf8');
    expect(out).not.toContain('<style');
    expect(out).not.toContain('@import');
  });
  it('drops data: in href/xlink:href', () => {
    const out = sanitiseSvg(wrap('<image href="data:text/html,<b>x</b>"/>'))!.toString('utf8');
    expect(out).not.toContain('data:text/html');
  });
  it('still keeps a plain rect', () => {
    const out = sanitiseSvg(wrap('<rect x="0" y="0" r="1"/>'))!.toString('utf8');
    expect(out).toContain('<rect');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `docker exec template_printing-api sh -c "cd /workspace/apps/api && pnpm test -- test/svg-sanitiser.spec.ts"`

- [ ] **Step 3: 改消毒器**

`svg-sanitiser.ts`:从 `ALLOWED_TAGS` 删 `'style'`(`:35`);从 `ALLOWED_ATTRS` 删 `'style'`(`:73`);把 `allowedSchemes: ['http', 'https', 'data']`(`:108`)改为 `allowedSchemes: ['http', 'https']`(移除 `data`)。其余不动。

- [ ] **Step 4: ServeStatic 对 svg 加防御响应头**

`app.module.ts` 的 `ServeStaticModule.forRoot({...})` 加 `serveStaticOptions.setHeaders`,对 `.svg` 强制 `Content-Disposition: attachment` + 严格 CSP(防作为活体文档执行):
```ts
    ServeStaticModule.forRoot({
      rootPath: join(process.env.STORAGE_ROOT ?? '/storage'),
      serveRoot: '/',
      exclude: ['/healthz', '/auth/*', '/users/*', '/uploads/render/*'],
      serveStaticOptions: {
        setHeaders: (res, filePath) => {
          if (filePath.toLowerCase().endsWith('.svg')) {
            res.setHeader('Content-Disposition', 'attachment');
            res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");
          }
        },
      },
    }),
```
(`res`/`filePath` 类型来自 serve-static;如 TS 报隐式 any,标注 `(res: import('express').Response, filePath: string)`。)

- [ ] **Step 5: 测试通过 + typecheck + lint**

Run: `docker exec template_printing-api sh -c "cd /workspace/apps/api && pnpm test -- test/svg-sanitiser.spec.ts && pnpm run typecheck && pnpm run lint"`

- [ ] **Step 6: 提交**
```bash
git add apps/api/src/uploads/svg-sanitiser.ts apps/api/src/app.module.ts apps/api/test/svg-sanitiser.spec.ts
git commit -m "fix(api): SVG 消毒去 style/data scheme + uploads svg 加 attachment/CSP 响应头(V8)"
```

---

## Task 6 (V5): bitable webhook 与内部回调 token 拆分 + 常量时间比较

**Files:** Modify `apps/api/src/common/env.ts`、`apps/api/src/lark/lark-bitable.controller.ts`;Test `apps/api/test/render-callback-token.e2e.spec.ts`(新)。

- [ ] **Step 1: env 增内部回调 secret**

`env.ts` 加:
```ts
  // render worker → /lark/render-callback 内部回调专用 secret(与外部 webhook token 分离)
  RENDER_CALLBACK_SECRET: z.string().min(16).optional(),
```

- [ ] **Step 2: 写失败 e2e**

新建 `apps/api/test/render-callback-token.e2e.spec.ts`:设 `process.env.RENDER_CALLBACK_SECRET='cb-secret-xxxxxxxx'`、`LARK_BITABLE_VERIFICATION_TOKEN='wh-token-yyyyyyyy'`。断言:① 用 webhook token 调 `POST /lark/render-callback?token=wh-token-...` → 401(不再接受 webhook token);② 用 `cb-secret-...` → 通过(对已存在 larkPrintRequest 的 job)。

- [ ] **Step 3: 跑测试确认失败**

Run: `docker exec template_printing-api sh -c "cd /workspace/apps/api && pnpm test -- test/render-callback-token.e2e.spec.ts"`

- [ ] **Step 4: 实现拆分 + 常量时间比较**

`lark-bitable.controller.ts`:
- 顶部加 `import { timingSafeEqual } from 'crypto';` + 一个工具:
```ts
function safeEqual(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}
```
- `printTrigger`(:83)构造 `callbackUrl` 改用内部 secret:
```ts
  const cbSecret = process.env.RENDER_CALLBACK_SECRET;
  const callbackUrl = `${apiBase}/lark/render-callback?token=${encodeURIComponent(cbSecret ?? '')}`;
```
- `renderCallback`(:131-134)校验改用内部 secret + 常量时间:
```ts
  const expected = process.env.RENDER_CALLBACK_SECRET;
  if (!safeEqual(token, expected)) {
    throw new UnauthorizedException('verification_token_mismatch');
  }
```
- `printTrigger` 的入站 webhook 校验(:76-79)保持用 `LARK_BITABLE_VERIFICATION_TOKEN`,但比较改 `if (!safeEqual(dto.verificationToken, process.env.LARK_BITABLE_VERIFICATION_TOKEN)) throw ...`。

> 注:`RENDER_CALLBACK_SECRET` 须同时配给 render worker(它已有的回调 URL 来自 API 入队时构造的 `callbackUrl`,故只需 API 这侧构造正确即可;worker 原样回发该 URL)。本 task 仅改 API。文档(批次外)`.env.example` 增该项 —— 在 Task 6 顺带加一行 `.env.example`。

- [ ] **Step 5: `.env.example` 加一行**

`.env.example` 渲染段加:`RENDER_CALLBACK_SECRET=<openssl rand -hex 16>  # render→API 内部回调,与飞书 webhook token 分离`。

- [ ] **Step 6: 测试通过 + typecheck + lint**

Run: `docker exec template_printing-api sh -c "cd /workspace/apps/api && pnpm test -- test/render-callback-token.e2e.spec.ts && pnpm run typecheck && pnpm run lint"`

- [ ] **Step 7: 提交**
```bash
git add apps/api/src/common/env.ts apps/api/src/lark/lark-bitable.controller.ts apps/api/test/render-callback-token.e2e.spec.ts .env.example
git commit -m "fix(api): render-callback 用独立 RENDER_CALLBACK_SECRET + 常量时间比较(V5)"
```

---

## Task 7: 全量回归 + 文档同步

- [ ] **Step 1: 全量 api 测试**

Run: `docker exec template_printing-api sh -c "cd /workspace/apps/api && pnpm test && pnpm run typecheck && pnpm run lint"`
Expected: 全绿、无回归。

- [ ] **Step 2: PROGRESS 追加 + spec 标记批次1完成**

`docs/PROGRESS.md` `### 2026-05-28` 追加一条 feat/fix:批次1 安全加固(V1 渲染 IDOR / V2 飞书越权 / V3 回调路径穿越 / V4 CORS allowlist / V8 SVG 消毒+响应头 / V5 回调 token 拆分),引用 review spec。在 `docs/superpowers/specs/2026-05-28-system-review-audit.md` 对应项标注「✅ 批次1 已修」。

- [ ] **Step 3: 提交**
```bash
git add docs/PROGRESS.md docs/superpowers/specs/2026-05-28-system-review-audit.md
git commit -m "docs: 批次1 安全加固完成同步 + review 项标记已修"
```

---

## Self-Review(写计划后自检)

**Spec 覆盖:** V1→T1 ✅;V2→T2 ✅;V3→T3 ✅;V4→T4 ✅;V8→T5 ✅;V5→T6 ✅;回归+文档→T7 ✅。V6/V7/V9 不在本批(V6 已删、V7 ops 批、V9 多副本另议)——符合"批次1=远程可触达核心"范围。

**占位符扫描:** 无 TBD;关键代码(get 归属过滤、路径校验、CORS callback、消毒删项、setHeaders、safeEqual/token 拆分)均给出完整 before/after。e2e 因须照搬各文件现有 app 引导,标注"照搬同目录现有 e2e 风格"而非硬编可能失配的 bootstrap——属对现有约定引用。

**类型一致性:** `RenderService.get(jobId, user:{sub,role})` 与 controller 调用一致;`CurrentUser/JwtClaims` 沿用 listJobs 既有;`safeEqual` 在 bitable controller 内定义并被三处调用;`CORS_ORIGIN`/`RENDER_CALLBACK_SECRET` env 字段名前后一致;`NotFoundException`/`BadRequestException`/`UnauthorizedException` 均 NestJS 已 import 项。
