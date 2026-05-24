# 飞书机器人卡片交互渲染 + API 页面模板列表 — 设计

> 状态：待用户审  
> 日期：2026-05-24  
> iter 编号：28  
> 相关：[iter 27 多维表格按钮触发](2026-05-24-lark-bitable-render-design.md)

## 1. 目标

把"模板渲染"通过**两个新入口**让业务人员零成本使用：

1. **群里 @ 机器人 / 私聊机器人** → 推送交互卡片 → 选模板 + 填字段 + 点渲染 → 异步完成后机器人 @ 触发者 + 发 PDF 文件
2. **模板打印平台的 `/api` 页面** → 模板列表 + 入参清单展示（给开发 / 测试 / 接入方查阅模板可用字段）

两条路 metadata 同源（都吃模板的 `schema.fields`），所以加新模板时两边自动同步。

## 2. 用户故事

### 2.1 主流程（飞书机器人）

```
[业务人员在群里 @ 模板打印机器人]
  ↓ 机器人收到事件
[机器人推送卡片 v1：选模板（下拉，options=所有模板列表）]
  ↓ 用户选 "出门证Demo"
[卡片更新 v2：字段输入表单 + "渲染"按钮]
  - 字段按模板 schema.fields 类型渲染：string=input / enum=select / boolean=switch / date=datepicker / number=number-input
  - image 类型暂不支持（v1 范围外）
  ↓ 用户填字段 + 点"渲染"
[卡片更新 v3："渲染中…"+ jobId]
  ↓ render worker 异步完成
[机器人发新消息（不是更新原卡片）：@ 原触发者 + 文件消息 (.pdf)]
  - 失败时：发文本消息说明原因，@ 触发者
```

### 2.2 次要流程（API 页面浏览）

```
用户进 /api 页面
  ↓
[顶部（折叠）]：原通用 HTTP 调用文档（curl / JS / Python）
[中部]：模板列表表格
  - 行可展开：看完整 schema.fields（包括 example 值）
  - 每行不带"操作"列（按用户决定不做 JSON 生成器 / playground）
```

## 3. Part A — API 页面增强

### 3.1 路由 / 文案

| 项 | 当前 | 改后 |
|---|---|---|
| 路由 path | `/api-docs` | `/api` |
| 路由 name | `api-docs` | `api` |
| 视图组件 | `ApiDocsView.vue` | `ApiView.vue`（rename） |
| sidebar 文案 | "API 说明" | "API" |
| 其他引用 | 全局 grep 替换 | — |

### 3.2 视图结构

```
┌────────────────────────────────────────────────────┐
│ API                                                │
├────────────────────────────────────────────────────┤
│ [收起 / 展开] 通用调用文档                          │
│   tabs: curl | JavaScript | Python                 │
│   POST /api/render 调用示例 + webhook 说明（保留）  │
├────────────────────────────────────────────────────┤
│ 模板列表                                            │
│ ┌──────────────┬────────────────────┬──────────┐  │
│ │ 模板名 / ID  │ 入参清单            │ 通用项   │  │
│ ├──────────────┼────────────────────┼──────────┤  │
│ │ 出门证Demo   │ group (enum)        │ template │  │
│ │ e0798b17…📋  │   options: 扬机/重机│ Id       │  │
│ │              │   required: false   │ data     │  │
│ │              │ [展开看 schema 全量] │ formats  │  │
│ │              │                    │ callback │  │
│ └──────────────┴────────────────────┴──────────┘  │
└────────────────────────────────────────────────────┘
```

### 3.3 列定义

| 列 | 内容 |
|---|---|
| **模板** | 名字 + UUID（旁边一个复制图标，复用 `TemplateNameEditor` 里的样式） |
| **自定义字段（入参）** | 来自 `data.schema.fields` 的 map：`{ key, label, type, required, example, options(if enum), accept(if image), trueLabel/falseLabel(if boolean) }`，渲染成可读列表；点击展开查看完整 schema |
| **通用项**（每行展示同一份） | `templateId / data / formats / callbackUrl` 的简短说明 |

数据源：`GET /templates`（已有 endpoint，返回 list；每项含 `data.schema`）。

### 3.4 不在范围

- "调用"按钮 / Dialog 表单生成器 / JSON 输出 / curl 生成器 — 全部不做（按用户决定）
- 仅纯展示

## 4. Part B — 飞书机器人卡片交互

### 4.1 触发场景

| 场景 | 行为 |
|---|---|
| 群里 @ 机器人（mention）+ 任意 / 无文本 | 触发（条件见下） |
| 私聊机器人发任意消息 | 触发（条件见下） |
| 群里普通消息（无 @）| 忽略 |

**re-@ 静默忽略规则**（减轻服务器负担 + 避免群里刷屏）：

- 触发前先查同一 `(chatId, triggerOpenId)` 下是否有 **"未完成且未发起渲染"** 的 session — 即 `state IN ('select_template', 'fill_fields')`
- 若有：直接 return 200，不创新 session、不发新卡片。用户应该在群里向上翻找原卡片继续使用
- 若无：正常创建新 session + 发新卡片
- `rendering` / `done` / `failed` 状态**不阻止**新触发——用户可在等待 / 完成后立刻开新任务

这样设计：rapid-click 不会刷屏，完成一个任务后立即开新任务也不受影响。

### 4.2 数据模型

```prisma
model LarkBotSession {
  id              String   @id @default(uuid())

  // 飞书会话上下文
  chatId          String   @map("chat_id")
  chatType        String   @map("chat_type")           // 'group' | 'p2p'
  triggerOpenId   String   @map("trigger_open_id")     // 触发者 user open_id (用于 @)

  // 卡片消息（用于 PATCH 更新）
  cardMessageId   String?  @map("card_message_id")

  // 会话状态机
  state           String   @default("select_template")
  // select_template / fill_fields / rendering / done / failed

  // 选定的模板与表单数据
  templateId      String?  @map("template_id")
  formData        Json?    @map("form_data")

  // 关联渲染任务
  renderJobId     String?  @unique @map("render_job_id")
  errorMsg        String?  @map("error_msg")

  createdAt       DateTime @default(now()) @map("created_at")
  updatedAt       DateTime @updatedAt        @map("updated_at")

  @@index([chatId, triggerOpenId, state])
  @@index([renderJobId])
  @@map("lark_bot_sessions")
}
```

`RenderJob` **不需要新关联** — 通过 `LarkBotSession.renderJobId` 单向引用即可。

### 4.3 API 端点（全部 `@Public()`）

#### `POST /lark/bot/event` — 飞书事件订阅入口

接收 `im.message.receive_v1` 事件。

**Body 形态**（飞书规范）：

```json
{
  "schema": "2.0",
  "header": {
    "event_id": "...",
    "token": "<verification_token>",
    "create_time": "...",
    "event_type": "im.message.receive_v1",
    "tenant_key": "...",
    "app_id": "..."
  },
  "event": {
    "sender": { "sender_id": { "open_id": "ou_xxx" }, "sender_type": "user" },
    "message": {
      "message_id": "om_xxx",
      "chat_id": "oc_xxx",
      "chat_type": "group" | "p2p",
      "message_type": "text",
      "mentions": [ ... ]
    }
  }
}
```

**特殊请求 1：URL Challenge**（飞书后台首次配置时）

```json
// 请求
{ "challenge": "ai_dasf", "type": "url_verification" }
// 响应
{ "challenge": "ai_dasf" }
```

**特殊请求 2：加密 payload**（如果后台开了 Encrypt Key）

Body 是 `{ "encrypt": "AES-256-CBC(...)" }`，需要用 Encrypt Key 解密；MVP 阶段**不启用加密**简化实现，仅校验 verification_token。

**业务处理**（解密后）：

1. 检验 `header.token === LARK_BOT_VERIFICATION_TOKEN`，不对 → 401
2. 判断 `event_type`：
   - `im.message.receive_v1`：
     - `chat_type=p2p` 或 `message.mentions` 包含机器人 open_id → 触发
     - 否则忽略，返回 `{ ok: true }`
3. 触发分支：
   - 创建 `LarkBotSession`（state=`select_template`，chatId/chatType/triggerOpenId）
   - 调 `LarkBotService.sendSelectTemplateCard()` → 拿到 message_id → 更新 session
   - 立即返回 200（飞书要求 3 秒内响应）

#### `POST /lark/bot/card-action` — 卡片交互回调

用户在卡片上选下拉 / 点按钮时飞书调此端点。

**Body**（飞书规范）：

```json
{
  "open_id": "ou_xxx",
  "user_id": "...",
  "open_message_id": "om_xxx",
  "tenant_key": "...",
  "token": "<card verification token>",
  "action": {
    "value": { "sessionId": "<uuid>", "action": "template_selected", "templateId": "<id>" },
    "tag": "select" | "button",
    "option": "<dropdown value>"
  }
}
```

**业务处理**：

1. 检验 `token === LARK_BOT_VERIFICATION_TOKEN`（飞书同一个机器人事件订阅 / 卡片回调共享 token）
2. 解析 `action.value.sessionId` → 查 `LarkBotSession`
3. 按 state + action 分派：
   - `state=select_template` + `action=template_selected` →
     - 更新 session(`templateId=<x>`, `state=fill_fields`, `formData={}`)
     - 读 `Template.data.schema.fields` 构造字段表单卡片
     - PATCH 飞书消息 → 卡片更新为表单
     - 返回 `{ toast: { type: "success", content: "已选模板，请填字段" } }`（飞书会自动 toast）
   - `state=fill_fields` + `action=submit_render` →
     - 从 action.value 读取 formData（用户的字段输入）
     - 校验：必填字段都填了
     - 调 `RenderService.enqueue(null, { templateId, data: formData, formats: ['pdf'], callbackUrl: '<API_INTERNAL_BASE>/lark/bot/render-callback?token=...' })`
     - 更新 session(renderJobId, state=`rendering`)
     - PATCH 卡片为"渲染中…" + jobId
     - 返回 200
   - 其他状态：忽略 / 错误提示

#### `POST /lark/bot/render-callback?token=...` — render worker 回调

**业务处理**：

1. 验证 query token
2. 查 `LarkBotSession`（通过 renderJobId）
3. `status=done`：
   - 读 PDF 文件 buffer
   - 上传到飞书 IM（`POST /open-apis/im/v1/files`，file_type=pdf）→ 拿 `file_key`
   - 发新消息到 chatId：
     - `msg_type=file`
     - `content={ "file_key": "<file_key>" }`
     - **用 `at` 富文本 + `at_mention` 在消息开头 @ triggerOpenId**？飞书 file 消息不支持内嵌 @，所以**分两步发**：
       - 1 条富文本 `<at user_id="ou_xxx">姓名</at> 你的渲染好了`
       - 1 条 file 消息
   - 更新 session(state=`done`)
4. `status=failed`：
   - 发富文本错误消息 + @ 触发者
   - 更新 session(state=`failed`, errorMsg)
5. 同时 PATCH 原卡片为"已完成 / 失败"终态

### 4.4 卡片 JSON 模板

飞书 Interactive Card v2 模板（key 字段简化）：

**v1 — 选模板**

```json
{
  "config": { "wide_screen_mode": true },
  "header": { "title": { "tag": "plain_text", "content": "模板渲染" } },
  "elements": [
    { "tag": "div", "text": { "tag": "lark_md", "content": "请选择要渲染的模板：" } },
    {
      "tag": "action",
      "actions": [
        {
          "tag": "select_static",
          "placeholder": { "tag": "plain_text", "content": "选择模板…" },
          "value": { "sessionId": "<uuid>", "action": "template_selected" },
          "options": [
            { "value": "<id1>", "text": { "tag": "plain_text", "content": "出门证Demo (e0798b17…)" } },
            ...
          ]
        }
      ]
    }
  ]
}
```

**v2 — 字段表单 + 渲染按钮**

按模板 schema.fields 生成 element 列表，每字段一个 input/select/switch 元素，最后一个 submit button。

**v3 — 渲染中**

```
"⏳ 渲染中… jobId=<jobId>"
（保留卡片上下文，等回调）
```

**v4 — 完成 / 失败**（PATCH 时更新原卡片到此状态）

```
"✅ 已完成 PDF 文件在群里查看"
"❌ 渲染失败：<error msg>"
```

### 4.5 飞书后台配置

新增机器人配置（不影响 iter 27 的 SSO / 多维表格）：

- "应用功能" → "机器人" → 启用
- 设置机器人显示名 / 头像
- "事件与回调" → 配置：
  - 事件订阅 URL：`<base>/lark/bot/event`
  - Verification Token：填一个新生成的随机 hex（也填到 .env `LARK_BOT_VERIFICATION_TOKEN`）
  - 加密 Key：本期**不启用**（启用会触发 `encrypt` payload，需要 AES 解密，简化）
  - 订阅事件：`im.message.receive_v1`
- "卡片回调" → 配置：
  - 请求 URL：`<base>/lark/bot/card-action`
  - 复用同一个 verification token
- 权限：
  - `im:message`（接收消息）
  - `im:message:send_as_bot`（发消息）
  - `im:resource`（上传文件到 IM）
  - `im:chat:readonly`（看会话基本信息，可选）

### 4.6 代码组织

```
apps/api/src/lark/
├── lark.module.ts                        (已有，注册 LarkBotService + LarkBotController)
├── lark-im.service.ts                    (已有)
├── lark-bitable.service.ts               (已有)
├── lark-bitable.controller.ts            (已有)
├── lark-bot.service.ts                   (新)
│   - sendCard(chatId, cardJson) → message_id
│   - updateCard(messageId, cardJson)
│   - uploadIMFile(buffer, fileName, fileType) → file_key
│   - sendTextWithMention(chatId, atOpenId, text)
│   - sendFile(chatId, fileKey)
│   - buildSelectTemplateCard(sessionId, templateList)
│   - buildFieldFormCard(sessionId, template, currentValues)
│   - buildRenderingCard(jobId)
│   - buildResultCard(status, errorMsg?)
└── lark-bot.controller.ts                (新)
    - POST /lark/bot/event
    - POST /lark/bot/card-action
    - POST /lark/bot/render-callback
```

复用：
- `LarkImService.getTenantAccessToken()` — token 共享
- `RenderService.enqueue(null, ...)` — 系统调用，跳 ownership
- `Prisma.larkBotSession` — 新 model

## 5. 凭证 / 配置

新增 `.env` 变量（仓库只 `.env.example` 占位）：

```
LARK_BOT_VERIFICATION_TOKEN=<openssl rand -hex 16>
```

飞书后台事件订阅 + 卡片回调共享同一 token。

`LARK_SSO_APP_ID / SECRET` 仍复用（同一 app 多权限）。

## 6. 状态机

```
[receive @bot 或 私聊消息]
  ↓ 先查 (chatId, triggerOpenId) 有无 state IN (select_template, fill_fields) 的 session
  ↓ 若有 → 静默忽略
  ↓ 若无 → 创建新 session
LarkBotSession (state=select_template, cardMessageId=msg_v1)
  ↓ 用户选模板（card action: template_selected）
LarkBotSession (state=fill_fields, templateId=x, formData={}, cardMessageId 不变)
  ↓ 用户填字段 + 点提交（card action: submit_render）
LarkBotSession (state=rendering, formData={…}, renderJobId=y)
  ↓ render worker 完成 callback
LarkBotSession (state=done) → 发新消息 + PATCH 原卡片
  或
LarkBotSession (state=failed, errorMsg=…) → 发新消息 + PATCH 原卡片
```

## 7. 错误处理

| 场景 | 行为 |
|---|---|
| 事件订阅 token 校验失败 | 401，飞书自动重试 3 次后停 |
| 卡片回调 token 校验失败 | 401 |
| 卡片 action 找不到 session | 静默 200（可能是过期卡片） |
| 字段必填漏填 | 卡片 toast 红色提示，不进入渲染 |
| 渲染入队失败（模板不存在等） | 卡片 PATCH 失败状态 |
| 渲染失败（callback status=failed） | 卡片失败 + 发文本消息 @ 触发者说明 |
| 上传 PDF 到 IM 失败 | 发文本说明渲染好了但上传失败，附带 internal URL（不暴露） |

## 8. 不在范围（留后续）

- 卡片加密 payload（Encrypt Key 路径） — 简单 verification token 够用
- image 类型字段输入 — schema 支持但 v1 卡片不渲染
- 私聊会话历史记忆 — 每次 @ 都是全新 session
- 会话超时清理（session 表清理 cron） — 量大后再说
- 卡片支持 markdown 富格式 — 用 plain_text 简单可靠

## 9. 验收标准

- [ ] `/api` 页面（rename from `/api-docs`）展示模板列表，含完整 schema.fields 入参
- [ ] 飞书群里 @ 机器人 → 收到选模板卡片
- [ ] 选模板后卡片变字段表单
- [ ] 填好字段点渲染 → 卡片"渲染中" → 渲染完成后机器人在群里 @ 触发者发 PDF 文件
- [ ] 失败路径：模板字段缺漏 → 提示；渲染失败 → 错误消息 @ 触发者
- [ ] 私聊机器人发任意消息也能触发整个流程
- [ ] `examples/lark-bot/README.md` 业务接入手册（飞书后台配置步骤）
- [ ] 单测：LarkBotService 卡片构造 + 状态机分派
- [ ] e2e：mock 飞书 API，模拟事件 → card-action → 完成 callback 一条链路

## 10. Task 拆分（plan 详化）

预计 9 个 task：

1. **T1**：DB `LarkPrintRequest` → `LarkBotSession` 表 + migration
2. **T2**：`LarkBotService` — 飞书 IM API 封装（send/update/upload/sendFile/sendMention）
3. **T3**：`LarkBotService` — 4 个卡片构造方法（select / form / rendering / result）
4. **T4**：`LarkBotController` `/lark/bot/event` — challenge + 校验 + 派发
5. **T5**：`LarkBotController` `/lark/bot/card-action` — 状态机
6. **T6**：`LarkBotController` `/lark/bot/render-callback` — 上传 PDF + 发结果消息
7. **T7**：Part A — `ApiDocsView` → `ApiView`，模板列表渲染 + 路由 / 侧栏文案 rename
8. **T8**：`.env.example` 加 `LARK_BOT_VERIFICATION_TOKEN` + `examples/lark-bot/README.md` 接入手册
9. **T9**：PROGRESS.md 同步 + 端到端验证
