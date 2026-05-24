# Plan: 飞书多维表格集成（按钮触发渲染回写附件）

> 对应 spec：[2026-05-24-lark-bitable-render-design.md](../specs/2026-05-24-lark-bitable-render-design.md)  
> 状态：待执行  
> 预计 commit：7 个  
> 分支建议：`feature/lark-bitable-integration`

## 任务依赖图

```
T1 (DB schema)
  └─▶ T2 (LarkBitableService)
        └─▶ T3 (LarkBitableController)
              └─▶ T4 (RenderService 改造接 callbackUrl)
                    └─▶ T5 (env + docker-compose 同步)
                          └─▶ T6 (业务接入手册)
                                └─▶ T7 (PROGRESS + commits)
```

每个 task 单独 commit，前一个 typecheck 通过才进下一个。

---

## T1 · DB schema：`LarkPrintRequest` 表 + migration

### 变更

**`apps/api/prisma/schema.prisma`**：新增 model + 在 `RenderJob` 加反向关系。

```prisma
model LarkPrintRequest {
  id              String   @id @default(uuid())
  renderJobId     String   @unique @map("render_job_id")
  appToken        String   @map("app_token")
  tableId         String   @map("table_id")
  recordId        String   @map("record_id")
  statusField     String   @map("status_field")
  attachmentField String   @map("attachment_field")
  errorMsg        String?  @map("error_msg")
  callbackStatus  String?  @map("callback_status")   // pending / done / failed
  createdAt       DateTime @default(now()) @map("created_at")
  updatedAt       DateTime @updatedAt        @map("updated_at")

  renderJob       RenderJob @relation(fields: [renderJobId], references: [id], onDelete: Cascade)

  @@index([renderJobId])
  @@map("lark_print_requests")
}

model RenderJob {
  // ... 现有字段
  larkPrintRequest LarkPrintRequest?
}
```

### Migration

```
pnpm --filter @template-printing/api db:migrate:dev --name add_lark_print_requests
```

### 验收

- [ ] migration 生成成功
- [ ] `pnpm --filter @template-printing/api db:generate` 通过
- [ ] `prisma db pull` 反向确认表结构
- [ ] `apps/api` typecheck 通过

### Commit

```
feat(db): lark_print_requests 表 — 多维表格按钮触发渲染的上下文
```

---

## T2 · `LarkBitableService` — 飞书 API 封装

### 文件

**新建 `apps/api/src/lark/lark-bitable.service.ts`**

复用 `LarkImService.getTenantAccessToken()`（已实现，2h 缓存）。

### 接口

```ts
@Injectable()
export class LarkBitableService {
  constructor(private readonly im: LarkImService) {}

  /**
   * 更新多维表格 record 的指定字段。
   * fields 是 { 字段名: 值 } 的 map。
   * 对附件字段，值用 [{ file_token: "xxx" }]
   */
  async updateRecord(args: {
    appToken: string;
    tableId: string;
    recordId: string;
    fields: Record<string, unknown>;
  }): Promise<void>;

  /**
   * 上传文件到飞书云空间（bitable_file 用途）。
   * 自动判断分片：>= 20MB 用 prepare/part/finish；< 20MB 用 upload_all。
   * @returns file_token
   */
  async uploadMaterial(args: {
    parentNode: string;       // tableId
    fileName: string;
    fileBuffer: Buffer;
  }): Promise<string>;
}
```

### 实现要点

- HTTP 客户端：用 Node 内置 `fetch`（Node 20+ 全局可用）+ FormData
- token：每次调用前 `await this.im.getTenantAccessToken()`，header `Authorization: Bearer ${token}`
- 错误：飞书 API 失败时抛 `Error` 含 lark 返回的 code/msg；caller 决定怎么处理
- 分片阈值：`const CHUNK_THRESHOLD = 20 * 1024 * 1024`
- 分片大小：飞书规定 4MB，常量化 `const CHUNK_SIZE = 4 * 1024 * 1024`

### 单测

**新建 `apps/api/test/lark-bitable-service.spec.ts`**

- 用 `nock` mock 飞书 API
- 覆盖：updateRecord 成功 / 错误响应 / uploadMaterial 小文件 / uploadMaterial 大文件分片走完整 3 步

### 验收

- [ ] 单测通过（jest run）
- [ ] typecheck 通过
- [ ] lark API 失败时抛 Error 含可读消息

### Commit

```
feat(api): LarkBitableService — 多维表格 record 更新 + 云素材上传（含分片）
```

---

## T3 · `LarkBitableController` — webhook 与回调端点

### 文件

**新建 `apps/api/src/lark/lark-bitable.controller.ts`**

### 端点

**POST `/lark/print-trigger`**（外部 webhook，无 JwtAuthGuard，但要 verificationToken）

```ts
const PrintTriggerDto = z.object({
  verificationToken: z.string(),
  templateId: z.string(),
  data: z.record(z.unknown()).default({}),
  lark: z.object({
    appToken: z.string(),
    tableId: z.string(),
    recordId: z.string(),
    statusField: z.string(),
    attachmentField: z.string(),
  }),
});

@Public()
@Post('print-trigger')
async printTrigger(@Body() raw: unknown): Promise<{ jobId: string; status: string }> {
  const dto = PrintTriggerDto.parse(raw);
  if (dto.verificationToken !== process.env.LARK_BITABLE_VERIFICATION_TOKEN) {
    throw new UnauthorizedException();
  }

  // 1. 入队渲染（callbackUrl 指向自己的 /lark/render-callback）
  const internalToken = process.env.LARK_BITABLE_VERIFICATION_TOKEN;
  const callbackUrl = `${INTERNAL_BASE}/lark/render-callback?token=${internalToken}`;
  const { jobId, status } = await this.renderService.enqueue(SYSTEM_USER_ID, {
    templateId: dto.templateId,
    data: dto.data,
    formats: ['pdf'],
    callbackUrl,
  });

  // 2. 落 LarkPrintRequest
  await this.prisma.larkPrintRequest.create({
    data: {
      renderJobId: jobId,
      appToken: dto.lark.appToken,
      tableId: dto.lark.tableId,
      recordId: dto.lark.recordId,
      statusField: dto.lark.statusField,
      attachmentField: dto.lark.attachmentField,
      callbackStatus: 'pending',
    },
  });

  // 3. 立即更新多维表格 statusField = 处理中（容错：不阻塞 webhook 返回）
  this.bitable.updateRecord({
    appToken: dto.lark.appToken,
    tableId: dto.lark.tableId,
    recordId: dto.lark.recordId,
    fields: { [dto.lark.statusField]: '处理中' },
  }).catch((e) => this.logger.warn(`updateRecord 'processing' failed: ${e.message}`));

  return { jobId, status };
}
```

**POST `/lark/render-callback`**（内部 worker 调，URL token 校验）

```ts
@Public()
@Post('render-callback')
async renderCallback(
  @Query('token') token: string,
  @Body() raw: unknown,
): Promise<{ ok: true }> {
  if (token !== process.env.LARK_BITABLE_VERIFICATION_TOKEN) {
    throw new UnauthorizedException();
  }

  const dto = RenderCallbackDto.parse(raw);
  const req = await this.prisma.larkPrintRequest.findUnique({
    where: { renderJobId: dto.jobId },
  });
  if (!req) return { ok: true }; // 不是 lark 触发的 job，忽略

  if (dto.status === 'done' && dto.pdfUrl) {
    try {
      const pdfBuf = await fs.readFile(path.join(STORAGE_ROOT, dto.pdfUrl));
      const fileToken = await this.bitable.uploadMaterial({
        parentNode: req.tableId,
        fileName: `${req.recordId}.pdf`,
        fileBuffer: pdfBuf,
      });
      await this.bitable.updateRecord({
        appToken: req.appToken,
        tableId: req.tableId,
        recordId: req.recordId,
        fields: {
          [req.statusField]: '已完成',
          [req.attachmentField]: [{ file_token: fileToken }],
        },
      });
      await this.prisma.larkPrintRequest.update({
        where: { id: req.id },
        data: { callbackStatus: 'done' },
      });
    } catch (e) {
      await this.markFailed(req, (e as Error).message);
    }
  } else {
    await this.markFailed(req, dto.errorMsg ?? 'render_failed');
  }
  return { ok: true };
}
```

### 模块注册

**改 `apps/api/src/lark/lark-im.module.ts` → `lark.module.ts`**：

```ts
@Module({
  imports: [PrismaModule, RenderModule],
  providers: [LarkImService, LarkBitableService],
  controllers: [LarkBitableController],
  exports: [LarkImService, LarkBitableService],
})
export class LarkModule {}
```

`app.module.ts` 把 `LarkImModule` 改成 `LarkModule`。

### 验收

- [ ] `/lark/print-trigger` 验证 token，落 LarkPrintRequest，立即入队 + 返回 jobId
- [ ] `/lark/render-callback` 失败时 statusField = 失败
- [ ] e2e 测试用 nock mock 飞书 API，完整跑一遍

### Commit

```
feat(api): LarkBitable controller — /lark/print-trigger + /lark/render-callback
```

---

## T4 · `RenderService.enqueue` 接 callbackUrl

### 现状

`render.service.ts` 已支持 callbackUrl（iter 26 实现）。worker 在完成时 POST 到该 URL。

### 改动

**无需修改 render service 本身**，但要确认 `callbackUrl` 字段在 enqueue dto 中已有（不需新增）。

worker 现有 `apps/render/src/webhook.ts` 发送的 body 与本设计 §3.2 的 RenderCallbackDto 兼容。

### 验收

- [ ] 跑一遍现有 render E2E（上一迭代验证过），确认 callback 链路仍工作
- [ ] 加测试：lark 场景下 callback 收到后正确转给 /lark/render-callback

### Commit

仅文档：
```
docs(render): 说明 callback URL 含 query token 时的双重校验
```

如果实际无代码改动则跳过此 commit。

---

## T5 · `.env.example` + docker-compose + deployment 文档

### `.env.example` 新增

```
# 飞书多维表格自动化共享 verification token
# 业务人员在飞书自动化 webhook body 里填同一值
# 也用作 /lark/render-callback URL query token
# 生成：openssl rand -hex 16
LARK_BITABLE_VERIFICATION_TOKEN=replace_me_with_random_16_byte_hex
```

### 本地 `.env` 实际填值

```
LARK_BITABLE_VERIFICATION_TOKEN=<openssl rand -hex 16 生成>
```

### `docker-compose.dev.yml`

api 服务无需新增 env_file 项（已 `env_file: .env` 包含全部）。

### `docs/deployment.md`

新增章节"飞书多维表格自动化对接"，列出：
- 需要在飞书后台新增的权限（bitable:app / drive:drive）
- `LARK_BITABLE_VERIFICATION_TOKEN` 的生成与配置位置
- 业务人员在飞书自动化里如何填同一个 token

### 验收

- [ ] `.env.example` diff 含新变量 + 注释清晰
- [ ] `docs/deployment.md` 含新章节

### Commit

```
chore(env+docs): LARK_BITABLE_VERIFICATION_TOKEN + 部署说明
```

---

## T6 · 业务人员接入手册 `examples/lark-bitable/README.md`

### 文件

**新建 `examples/lark-bitable/README.md`**

### 章节

1. 概览（一句话讲清楚）
2. 准备工作（在模板打印平台先做好模板，记下 templateId 和入参列表）
3. 多维表格搭建步骤（截图占位）
   - 加业务字段
   - 加「打印状态」单选字段（4 个选项：未发起 / 处理中 / 已完成 / 失败）
   - 加「PDF 附件」附件字段
   - 加「打印」按钮字段
4. 配置按钮自动化
   - 触发：点击按钮
   - 操作：调用 webhook
   - URL：`https://print.<your-company>.com/lark/print-trigger`
   - Body（JSON，每个字段如何映射多维表格列）
5. 联调 + 验证
   - 填一条测试数据，点按钮
   - 看「打印状态」变化、「PDF 附件」出现
6. 常见问题
   - PDF 一直没出来 → 检查 verification token / API 权限
   - 「打印状态」字段名不匹配 → 自动化 body 里 statusField 要跟多维表格里的列名完全一致

### 附录

`payload-example.json`：可直接复制到飞书自动化 body 框的 JSON 模板。

### 验收

- [ ] README 自包含（业务人员不需查其他文档）
- [ ] 含 payload-example.json
- [ ] 截图位置占位（实际截图本期不强求，可留 TODO）

### Commit

```
docs(examples): lark-bitable — 业务人员接入手册
```

---

## T7 · PROGRESS.md + 收尾

### 更新

**`docs/PROGRESS.md`**：

- 第 1 节"整体进度"新增一行：`飞书多维表格集成 ✅`
- 第 2 节"已交付能力"新增 2.5 节：飞书多维表格触发渲染
- 第 3 节"近期变更"追加：2026-05-24 iter 27
- 第 5 节"后续计划"：把"飞书机器人接入示例"标为部分完成（按钮触发完成，@ 机器人留后续）

**`AGENTS.md`**（如有）：第 2 节目录结构如果 examples/ 是新目录，要加一行。

### 验收

- [ ] 文档更新一致
- [ ] 所有前面 task 的 commit 都已 push
- [ ] CI 通过

### Commit

```
docs(progress): iter 27 飞书多维表格按钮触发渲染回写附件
```

---

## 整体验收（合并到 master 前）

- [ ] 端到端手工测试：
  - [ ] 准备一个真实的飞书多维表格（用你已有的飞书 app）
  - [ ] 配好按钮自动化
  - [ ] 点按钮 → 看到 PDF 附件出现 + 状态变化
- [ ] `pnpm typecheck` + `pnpm lint` + `pnpm test` 全过
- [ ] CI 通过
- [ ] 文档同步（spec / plan / PROGRESS / .env.example / deployment / examples README）
- [ ] secret 没出现在任何 git tracked 文件

---

## 风险与缓解

| 风险 | 影响 | 缓解 |
|---|---|---|
| 飞书 API 调用失败（鉴权 / 限流） | 渲染完成但附件没回写 | 立即返回 200 给 webhook，后台用 try/catch；statusField = 失败时业务人员能看到 |
| 飞书 secret 又被泄露 | 同一 secret 多处使用，影响 SSO 和 bitable 两套链路 | 用户已被提醒：每次轮换后只在本地 .env 填 |
| 多维表格 record 已被业务人员手动修改 | 写附件时字段不存在或类型变了 | 写入失败 → statusField = 失败 + 日志告警 |
| PDF 文件太大（> 20MB） | upload_all 失败 | LarkBitableService 自动切分片 |
| 渲染 worker 慢 / 队列堆积 | 业务人员等很久 | spec 验收 10 秒响应是初步预期；后续加渲染优先级 / 多 worker |

---

## 不在本 plan 范围

- 机器人 @ 指令触发（场景 2.2，下一迭代）
- 渲染失败重试（attempts + 退避）
- Signed URL（防附件 URL 猜测）
- 多飞书 app 凭证管理
- 渲染历史 / 用户「我的渲染任务」视图
