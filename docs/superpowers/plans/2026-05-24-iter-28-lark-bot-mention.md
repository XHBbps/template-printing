# Plan: iter 28 — 飞书机器人卡片交互渲染 + API 页面模板列表

> 对应 spec：[2026-05-24-lark-bot-mention-design.md](../specs/2026-05-24-lark-bot-mention-design.md)  
> 分支：`feature/lark-bot-mention`  
> 状态：待执行  
> 预计 commit：9 个

## 任务依赖

```
T1 (DB)
  └─▶ T2 (LarkBotService IM API)
        └─▶ T3 (LarkBotService 卡片构造)
              └─▶ T4 (/lark/bot/event)
                    └─▶ T5 (/lark/bot/card-action)
                          └─▶ T6 (/lark/bot/render-callback)

T7 (Part A：/api 页面) — 独立，可与 T1-T6 并行
T8 (.env.example + 业务接入手册)
T9 (PROGRESS + 端到端验证)
```

每个 task 单独 commit，前一个 typecheck 通过才进下一个。

---

## T1 · `LarkBotSession` 表 + migration

### 变更

**`apps/api/prisma/schema.prisma`** 新增：

```prisma
model LarkBotSession {
  id              String   @id @default(uuid())

  chatId          String   @map("chat_id")
  chatType        String   @map("chat_type")
  triggerOpenId   String   @map("trigger_open_id")

  cardMessageId   String?  @map("card_message_id")

  state           String   @default("select_template")
  templateId      String?  @map("template_id")
  formData        Json?    @map("form_data")

  renderJobId     String?  @unique @map("render_job_id")
  errorMsg        String?  @map("error_msg")

  createdAt       DateTime @default(now()) @map("created_at")
  updatedAt       DateTime @updatedAt        @map("updated_at")

  @@index([chatId, triggerOpenId, state])
  @@index([renderJobId])
  @@map("lark_bot_sessions")
}
```

无外键关联（state 机内部使用）。

### Migration

```
pnpm --filter @template-printing/api db:migrate:dev --name add_lark_bot_sessions
```

### 验收

- [ ] migration 生成
- [ ] db:generate 通过
- [ ] api typecheck 通过

### Commit

```
feat(db): lark_bot_sessions 表 — 飞书机器人卡片交互会话状态
```

---

## T2 · `LarkBotService` — 飞书 IM API 封装

### 文件

**新建 `apps/api/src/lark/lark-bot.service.ts`**（仅 IM API 封装，卡片构造在 T3）

### 方法

```ts
@Injectable()
export class LarkBotService {
  constructor(private readonly im: LarkImService, ...) {}

  /** 发送一张卡片到 chatId, 返回飞书 message_id（用于后续 PATCH）*/
  async sendCard(chatId: string, cardJson: object): Promise<string>;

  /** PATCH 已发卡片（更新 content）*/
  async updateCard(messageId: string, cardJson: object): Promise<void>;

  /** 上传文件到飞书 IM（msg_type=file 可用），返回 file_key */
  async uploadIMFile(buffer: Buffer, fileName: string, fileType: string): Promise<string>;

  /** 发送富文本 @ 消息（用于完成时通知触发者）*/
  async sendTextWithMention(args: {
    chatId: string;
    atOpenId: string;
    atName?: string; // 不填则飞书显示默认
    text: string;
  }): Promise<void>;

  /** 发送文件消息（用于推送 PDF 给群/用户）*/
  async sendFileMessage(chatId: string, fileKey: string): Promise<void>;
}
```

### 实现要点

- 复用 `LarkImService.getTenantAccessToken()`
- `sendCard`：POST `/open-apis/im/v1/messages?receive_id_type=chat_id`，body msg_type=`interactive`，content=stringify(cardJson)
- `updateCard`：PATCH `/open-apis/im/v1/messages/{message_id}`，body `{ content: JSON.stringify(cardJson) }`
- `uploadIMFile`：POST `/open-apis/im/v1/files`，multipart：`file_type=<pdf>` / `file_name` / `file`
- `sendTextWithMention`：msg_type=`text`，content `{ text: '<at user_id="ou_xxx">name</at> ...' }`
- `sendFileMessage`：msg_type=`file`，content `{ file_key }`

所有方法错误返回飞书 lark code/msg（参考 `lark-bitable.service.ts` 的模式）

### 单测

**新建 `apps/api/test/lark-bot-service.spec.ts`**

nock mock 飞书 API，覆盖：
- sendCard 成功 / 错误
- updateCard 成功 / 错误
- uploadIMFile 成功
- sendTextWithMention 成功
- sendFileMessage 成功

### 验收

- [ ] 单测通过
- [ ] typecheck 通过

### Commit

```
feat(api): LarkBotService — 飞书 IM API 封装（卡片 send/update + IM 文件 upload + 消息）
```

---

## T3 · `LarkBotService` — 4 个卡片构造方法

### 文件

`apps/api/src/lark/lark-bot.service.ts` 在 T2 基础上扩展。

或者把卡片构造拆 `apps/api/src/lark/lark-bot-cards.ts` 一个独立模块。**推荐拆**——纯函数易测试 + 卡片 JSON 体积大不污染 service。

### 方法（pure functions）

```ts
// apps/api/src/lark/lark-bot-cards.ts
export function buildSelectTemplateCard(args: {
  sessionId: string;
  templates: Array<{ id: string; name: string }>;
}): object;

export function buildFieldFormCard(args: {
  sessionId: string;
  templateName: string;
  fields: Array<{ key: string; label: string; type: string; required: boolean; options?: any; example?: any }>;
  values: Record<string, unknown>;
}): object;

export function buildRenderingCard(args: { jobId: string; templateName: string }): object;

export function buildResultCard(args: { templateName: string; status: 'done' | 'failed'; errorMsg?: string }): object;
```

### 实现要点

- 飞书 Card v2 JSON（schema 2.0）
- 表单字段类型映射：
  - `string` → `input`
  - `enum` → `select_static`（options 来自 schema.options）
  - `boolean` → `select_static` with [是/否] options（飞书 v2 没原生 switch 元素）
  - `date` → `date_picker`
  - `datetime` → `date_picker`（精度到天，无 datetime 元素，prepend a time input?；简化 — 用 date_picker）
  - `number` → `input` placeholder "数字"（飞书 v2 没专门 number 控件）
  - `image` → 卡片上**不支持**，渲染 footer 提示"该字段需要其他方式提供"，整卡可提交但 image 字段空
- 每个字段的 value 用 action `tag=input` + `value: { sessionId, action: "field_change", fieldKey: "..." }`
- 最后一个 button `tag=button` + `value: { sessionId, action: "submit_render" }`

### 单测

**新建 `apps/api/test/lark-bot-cards.spec.ts`**

纯函数，无 mock：
- 各类型字段渲染正确
- enum options 正确传递
- sessionId 嵌入到 value
- 必填字段标记

### 验收

- [ ] 单测通过
- [ ] typecheck 通过
- [ ] 4 个函数返回的 JSON 在飞书卡片预览工具里可视化校验（手动）

### Commit

```
feat(api): LarkBotCards — 4 类卡片 JSON 构造（select / form / rendering / result）
```

---

## T4 · `/lark/bot/event` 端点

### 文件

**新建 `apps/api/src/lark/lark-bot.controller.ts`**

### 方法

```ts
@Public()
@Post('event')
@HttpCode(200)
async event(@Body() raw: unknown): Promise<unknown> {
  // 1. URL challenge
  if (raw.type === 'url_verification') return { challenge: raw.challenge };

  // 2. Verification token check
  if (raw.header?.token !== ENV.LARK_BOT_VERIFICATION_TOKEN) throw new UnauthorizedException();

  // 3. Event type check
  const eventType = raw.header?.event_type;
  if (eventType !== 'im.message.receive_v1') return { ok: true };

  // 4. Parse message
  const ev = raw.event;
  const chatType = ev.message.chat_type;  // 'group' | 'p2p'
  const triggerOpenId = ev.sender.sender_id.open_id;

  // 5. Filter:
  //    p2p 任意消息 OK
  //    group 必须 @ 机器人（检查 ev.message.mentions 是否含机器人 open_id）
  if (chatType === 'group') {
    const mentions = ev.message.mentions ?? [];
    const botMentioned = mentions.some((m) => m.id?.open_id === BOT_OPEN_ID);
    if (!botMentioned) return { ok: true };
  }

  // 6. re-@ 静默忽略检查
  const existing = await prisma.larkBotSession.findFirst({
    where: {
      chatId: ev.message.chat_id,
      triggerOpenId,
      state: { in: ['select_template', 'fill_fields'] },
    },
  });
  if (existing) return { ok: true }; // 静默

  // 7. 创建 session + 发卡片
  const session = await prisma.larkBotSession.create({...});
  const templates = await prisma.template.findMany({ select: { id: true, name: true } });
  const card = buildSelectTemplateCard({ sessionId: session.id, templates });
  const msgId = await bot.sendCard(ev.message.chat_id, card);
  await prisma.larkBotSession.update({ where: { id: session.id }, data: { cardMessageId: msgId } });
  return { ok: true };
}
```

### 难点

- `BOT_OPEN_ID` 从哪拿？飞书 app 在你企业里的 bot open_id 可以在飞书后台 / 用 API 查。**新增 env `LARK_BOT_OPEN_ID`**（用户从飞书后台拷过来填）。
- 必须 3 秒内响应（飞书要求），所以"发卡片" 部分用 `void`（不 await）让响应先返回。但 cardMessageId 需要回写，所以**应该 await**。改进：把发卡片放到 controller 末尾 `await`，但飞书 sendCard 一般 < 1 秒，3 秒内有余地。

### 单测

`apps/api/test/lark-bot-event.e2e.spec.ts`：

- URL challenge → 返回 challenge
- token 不对 → 401
- 非 im.message.receive_v1 → 200 无副作用
- p2p 消息 → 创 session + 发卡片
- group 消息无 @ → 200 无副作用
- group @ 机器人 → 创 session + 发卡片
- 同 chat 同 user 已有 select_template session → 200 无副作用

### Commit

```
feat(api): LarkBotController /lark/bot/event — 事件订阅入口（含 challenge + 签名 + re-@ 去重）
```

---

## T5 · `/lark/bot/card-action` 端点

### 方法

```ts
@Public()
@Post('card-action')
@HttpCode(200)
async cardAction(@Body() raw: unknown): Promise<unknown> {
  if (raw.token !== ENV.LARK_BOT_VERIFICATION_TOKEN) throw new UnauthorizedException();

  const v = raw.action.value as { sessionId: string; action: string; [key: string]: any };
  const session = await prisma.larkBotSession.findUnique({ where: { id: v.sessionId } });
  if (!session) return { ok: true };

  if (session.state === 'select_template' && v.action === 'template_selected') {
    // raw.action.option 是用户选的 templateId
    const templateId = raw.action.option;
    const tpl = await prisma.template.findUnique({ where: { id: templateId } });
    if (!tpl) return { toast: { type: 'error', content: '模板已删除' } };

    await prisma.larkBotSession.update({
      where: { id: session.id },
      data: { templateId, state: 'fill_fields', formData: {} },
    });
    const card = buildFieldFormCard({
      sessionId: session.id,
      templateName: tpl.name,
      fields: extractFields(tpl.data.schema.fields),
      values: {},
    });
    await bot.updateCard(session.cardMessageId!, card);
    return { ok: true };
  }

  if (session.state === 'fill_fields' && v.action === 'submit_render') {
    // raw.action.value 应该包含用户在表单里填的所有字段（飞书把整个表单数据放 value？）
    // — 待实现时确认飞书 v2 提交 button 是否 aggregate 全部字段。
    // - 若否，需在每个字段 input change 时把 value 累积到 session.formData
    // 先按"每个 input change 触发 card-action, 累积 formData"实现；submit 时读 session.formData

    const tpl = await prisma.template.findUnique({ where: { id: session.templateId! } });
    if (!tpl) return { toast: { type: 'error', content: '模板已删除' } };

    // 必填校验
    const fields = extractFields(tpl.data.schema.fields);
    const missing = fields.filter((f) => f.required && !session.formData?.[f.key]);
    if (missing.length > 0) {
      return { toast: { type: 'error', content: `必填未填：${missing.map((m) => m.label).join(', ')}` } };
    }

    // 入队渲染
    const apiBase = ENV.API_INTERNAL_BASE;
    const token = ENV.LARK_BOT_VERIFICATION_TOKEN;
    const callbackUrl = `${apiBase}/lark/bot/render-callback?token=${encodeURIComponent(token)}`;
    const { jobId } = await render.enqueue(null, {
      templateId: session.templateId!,
      data: session.formData as object,
      formats: ['pdf'],
      callbackUrl,
    });

    await prisma.larkBotSession.update({
      where: { id: session.id },
      data: { renderJobId: jobId, state: 'rendering' },
    });
    await bot.updateCard(session.cardMessageId!, buildRenderingCard({ jobId, templateName: tpl.name }));
    return { ok: true };
  }

  if (session.state === 'fill_fields' && v.action === 'field_change') {
    // 累积字段值到 session.formData
    const next = { ...(session.formData as object), [v.fieldKey]: raw.action.option ?? raw.action.input };
    await prisma.larkBotSession.update({
      where: { id: session.id },
      data: { formData: next },
    });
    return { ok: true };
  }

  return { ok: true };
}
```

### 难点

- 飞书 card v2 是否每次 input change 都 callback？要查文档。**如果不**，需要让 submit button 把整个表单数据带在 value 里。
- 提交时如何收集所有 input 的当前值？飞书 v2 的 button action 似乎不自动 aggregate。**需要实现时验证**——若发现飞书把整表单值放在 action.form_value 之类，简化逻辑。

### 单测

`apps/api/test/lark-bot-card-action.e2e.spec.ts`：
- select_template → template_selected → 状态变 fill_fields + 卡片 PATCH 验证
- fill_fields → field_change → formData 累积
- fill_fields → submit_render → 调 render + 状态变 rendering
- 必填漏填 → toast 提示
- 已不存在的 templateId → toast

### Commit

```
feat(api): LarkBotController /lark/bot/card-action — 状态机分派（选模板/填字段/提交渲染）
```

---

## T6 · `/lark/bot/render-callback` 端点

### 方法

```ts
@Public()
@Post('render-callback')
@HttpCode(200)
async renderCallback(@Query('token') token: string, @Body() raw: unknown): Promise<unknown> {
  if (token !== ENV.LARK_BOT_VERIFICATION_TOKEN) throw new UnauthorizedException();

  const dto = RenderCallbackDto.parse(raw);
  const session = await prisma.larkBotSession.findUnique({ where: { renderJobId: dto.jobId } });
  if (!session) return { ok: true }; // 不是 bot 触发的 job

  const tpl = await prisma.template.findUnique({ where: { id: session.templateId! } });
  const tplName = tpl?.name ?? '模板';

  if (dto.status === 'done' && dto.pdfUrl) {
    try {
      const buf = await fs.readFile(path.join(STORAGE_ROOT, dto.pdfUrl.slice(1)));
      const fileKey = await bot.uploadIMFile(buf, `${tplName}.pdf`, 'pdf');

      // 发文件消息（PDF 出现在群/聊天里）
      await bot.sendFileMessage(session.chatId, fileKey);
      // 发 @ 消息通知触发者
      await bot.sendTextWithMention({
        chatId: session.chatId,
        atOpenId: session.triggerOpenId,
        text: `「${tplName}」渲染完成，请查收 PDF 文件。`,
      });
      // PATCH 卡片到完成状态
      await bot.updateCard(session.cardMessageId!, buildResultCard({ templateName: tplName, status: 'done' }));
      await prisma.larkBotSession.update({
        where: { id: session.id },
        data: { state: 'done' },
      });
    } catch (e) {
      await this.markFailed(session.id, tplName, (e as Error).message);
    }
  } else {
    await this.markFailed(session.id, tplName, dto.errorMsg ?? 'render_failed');
  }
  return { ok: true };
}

private async markFailed(sessionId: string, tplName: string, errorMsg: string): Promise<void> {
  const session = await prisma.larkBotSession.findUnique({ where: { id: sessionId } });
  if (!session) return;
  try {
    await bot.sendTextWithMention({
      chatId: session.chatId,
      atOpenId: session.triggerOpenId,
      text: `「${tplName}」渲染失败：${errorMsg}`,
    });
    await bot.updateCard(session.cardMessageId!, buildResultCard({
      templateName: tplName, status: 'failed', errorMsg,
    }));
  } catch (e) {
    logger.warn(`bot markFailed side-effect failed: ${(e as Error).message}`);
  }
  await prisma.larkBotSession.update({
    where: { id: sessionId },
    data: { state: 'failed', errorMsg },
  });
}
```

### 单测

`apps/api/test/lark-bot-render-callback.e2e.spec.ts`：
- done 路径：mock IM API 全过 → session.state=done
- failed 路径：errorMsg → session.state=failed + 发错误消息
- 不存在 session → 静默 200

### Commit

```
feat(api): LarkBotController /lark/bot/render-callback — 完成后上传 PDF 到 IM + @ 触发者
```

---

## T7 · Part A：`/api-docs` → `/api` + 模板列表展示

### 变更

- `apps/web/src/router/index.ts`：路由 path / name 改名
- `apps/web/src/layout/AppSidebar.vue`：菜单项文案 "API 说明" → "API"
- `apps/web/src/views/ApiDocsView.vue` → 改名 `ApiView.vue`：
  - 顶部原 curl/JS/Python tab 折叠（用 `el-collapse`），默认收起
  - 中间新增"模板列表"区，用 `el-table` 渲染
  - 列：
    - 模板（名 + ID + 复制 ID 按钮，复用 TemplateNameEditor 的复制样式）
    - 入参 — 通用项（每行同：templateId / data / formats / callbackUrl）
    - 入参 — 自定义字段（render from `template.data.schema.fields`）
  - 行展开 row 看完整 schema（用 `el-table-column type="expand"`）
- 数据：调 `/templates` 拉列表；为了拿 `data.schema`，要么再调每个 `/templates/:id`，要么 templates 列表 endpoint 增 include `schema` — 简化方式：列表 fetch 后，每行 lazy fetch 详情；或者改后端列表 endpoint 默认 include schema。

**先用前端 lazy fetch**（开新 controller endpoint 慢，先简后改）。

### 验收

- [ ] 路由 / sidebar 文案改对，刷新 web 看效果
- [ ] 模板列表显示，每行入参清单按 schema 展开
- [ ] 复制模板 ID 按钮 work

### Commit

```
feat(web): /api-docs → /api 页面重构 — 模板列表 + 入参清单展示
```

---

## T8 · env + 飞书后台 + 业务接入手册

### `.env.example` 新增

```
# 飞书机器人事件订阅 + 卡片回调（共享同一 token）
# 飞书后台：应用 → 事件与回调 → 复制 Verification Token
LARK_BOT_VERIFICATION_TOKEN=replace_me_with_random_16_byte_hex

# 飞书后台拷贝 — 应用 → 应用信息 → 机器人栏目里的 bot user_id 或 open_id
LARK_BOT_OPEN_ID=ou_xxxxxxxxxxxxxxxx
```

### `apps/api/src/common/env.ts`

```
LARK_BOT_VERIFICATION_TOKEN: z.string().min(16).optional(),
LARK_BOT_OPEN_ID: z.string().optional(),  // 用于判断群里 @ 是否针对机器人
```

### 飞书后台配置手册

**新建 `examples/lark-bot/README.md`**

章节：
1. 概览 — 群里 @ / 私聊机器人开始打印
2. 飞书后台设置：
   - 启用机器人 + 设置显示名
   - "事件与回调" → 配置事件订阅 URL `<base>/lark/bot/event` + Verification Token
   - 复制 Verification Token 填到服务端 .env
   - 订阅事件：`im.message.receive_v1`
   - **不启用 Encrypt Key**（MVP 简化）
   - "卡片回调" → URL `<base>/lark/bot/card-action`
   - 应用机器人 open_id 复制到 .env
   - 权限：`im:message`、`im:message:send_as_bot`、`im:resource`
3. 测试：
   - 把机器人加到群 / 私聊机器人发"hi"
   - 应该出现选模板卡片

### 验收

- [ ] env diff 含两个新变量 + 注释清晰
- [ ] README 自包含

### Commit

```
chore(env+docs): LARK_BOT_* + 飞书机器人接入手册
```

---

## T9 · PROGRESS + 端到端验证

### 更新

`docs/PROGRESS.md`：
- 第 1 节"整体进度"：原"飞书机器人 @ 指令" → "飞书机器人卡片交互" ✅ iter 28
- 第 2 节新增 2.6 节"飞书机器人卡片交互"
- 第 3 节追加 2026-05-24 iter 28
- 第 5 节后续计划：去掉机器人 @ 项，剩余从 #2 开始

### 端到端验证（用户在真飞书里走完整）

1. 服务器侧 .env 填好 LARK_BOT_VERIFICATION_TOKEN + LARK_BOT_OPEN_ID + force-recreate api
2. 飞书后台配好事件订阅 + 卡片回调 URL + Verification Token + 订阅事件 + 权限
3. 把机器人加进一个群 / 私聊机器人
4. 群里 @ 机器人 → 看选模板卡片
5. 选模板 → 看字段表单
6. 填字段 → 提交 → 看"渲染中"
7. 等 5-10s → 群里出现机器人 @ 触发者 + PDF 文件

### 验收

- [ ] 全部步骤手测通过
- [ ] CI 通过
- [ ] PR 合并到 master

### Commit

```
docs(progress): iter 28 飞书机器人卡片交互完整交付
```

---

## 整体验收（PR 合并前）

- [ ] T1-T9 commit 全部完成
- [ ] `pnpm typecheck` + `pnpm lint` + `pnpm test` 全过
- [ ] CI 通过（lint-and-test + docker-build）
- [ ] 真飞书端到端测试通过
- [ ] secret 没出现在任何 git tracked 文件

## 风险与缓解

| 风险 | 影响 | 缓解 |
|---|---|---|
| 飞书 card v2 字段提交逻辑跟我猜的不一样（input change 是否每次 callback？submit 时是否含全部字段？）| T5 状态机假设可能错 | 实现时先做最小 demo（1 个 input 字段卡片）观察飞书行为，再写状态机 |
| 飞书 sendFileMessage 在群里发文件可能需要额外权限 | T6 失败 | 飞书文档先核 `im:resource` 是否够；不够补 |
| 加密 payload 是否飞书强制开启？ | event 入口可能拒收 | 文档说 "可选"，先 MVP 不开。飞书后台事件订阅有 "Encrypt Key" 字段，可填可不填 |
| 机器人 open_id 不易找 | T4 群消息识别失败 | examples/README.md 写清楚去哪查（飞书后台 应用信息 → 应用凭证 / 应用功能 → 机器人 → 概览）|

## 不在范围

- 卡片加密 payload（Encrypt Key + AES 解密）
- image 字段卡片渲染
- session 清理 cron（量大时另做）
- 群里别人也能用同一张卡（卡片归触发者所有；按钮其他人点会被 session 校验拒）
