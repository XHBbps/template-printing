# 飞书 bot 长连接(WebSocket)接管事件 + 卡片回调 —— 设计

**日期**:2026-05-29
**状态**:已审定(经独立校验,SDK 源码佐证关键点)
**范围**:仅 **bot 相关**的事件订阅(`im.message.receive_v1`)与卡片交互回调(`card.action.trigger`)改为飞书长连接(WSClient);**多维表格 print-trigger、内部 render-callback 仍走 HTTP,不动**。

---

## 1. 背景与目标

- 飞书自建应用后台**已切为长连接模式** → 现有 HTTP `/lark/bot/event`、`/lark/bot/card-action` 已收不到事件,bot 实际处于失效状态。落地 WS 客户端是让 bot 恢复工作的前提。
- 长连接**不需要公网 HTTPS 回调 URL** → 在域名/ICP 备案就绪前即可跑通 bot(关键收益)。
- `@larksuiteoapi/node-sdk@1.40.0` **已是 `apps/api` 依赖**,自带 `WSClient` + `EventDispatcher`。**无需新增依赖、不动技术栈表**。

## 2. SDK 关键事实(已用源码佐证)

| 项 | 证据 | 结论 |
|---|---|---|
| 长连接支持卡片回调 | WSClient 启动日志 "receive events or callbacks through persistent connection" | ✅ 事件 + 卡片同一连接 |
| 卡片返回值如何回传 | 入站帧经 `eventDispatcher.invoke()`,返回值 → `respPayload.data = base64(JSON(result))` 经 WS `sendMessage` 回传 | ✅ handler 返回 `{toast, card}` 即回传卡片 |
| 现有卡片模型 | `lark-bot.controller.ts:78` 注明"新版卡片 schema 2.0,`event_type=card.action.trigger`" | ✅ 同事件类型,卡片本身无需改 |
| WS 模式是否校 verification token | WS 调 `invoke(data, { needCheck:false })` 跳过 token 校验,靠握手期 app 凭证鉴权 | ✅ 事件入口不再用 token |
| card 注册到哪 | `EventDispatcher.register({ 'card.action.trigger': handler })`(非 `CardActionHandler`——后者是旧 HTTP 回调 URL 模型) | ✅ 注册到 EventDispatcher |

### 2.1 ⚠️ payload 形态会变(已亲验 `lib/index.js` `parse()` L73063-73068)

`EventDispatcher.invoke()` 内部 `targetData = requestHandle.parse(data)` 后把 `targetData` 传给 handler。对 v2 事件(`'schema' in targetData`),`parse()` 返回:

```js
Object.assign({ [CEventType]: header.event_type }, rest, header, event)
```

即 **header 与 event 字段被「扁平化」到顶层**。handler 收到的不是 HTTP 原始 `{schema, header, event}`,而是扁平结构:

- `header.event_id` → 顶层 `event_id`
- `event.message` → 顶层 `message`
- `event.sender` → 顶层 `sender`
- `event.action`(卡片)→ 顶层 `action`

**因此现有 controller 按 `body.header.*` / `body.event.*` 取值的代码在 WS 下会取空。** 业务逻辑(会话状态机、卡片构造、render 入队)可复用,但**入口字段访问层必须改**:dispatch service 接收**归一化 payload**,WS 与 HTTP 两入口各自适配。

> **实现第一步(plan task 0)**:本地临时 `LARK_BOT_LONG_CONN_ENABLED=true` 连真飞书,对"私聊消息 / 群内 @ / 一次卡片点击"各打一条真实 `targetData` 日志,确认形态后再定 fixture。SDK 源码已给出确定形态,live-log 仅作最终确认,防 fixture 与真实不符。

## 3. 架构与组件

### 3.1 新增 `LarkBotDispatchService`(纯业务,可脱离 WS/HTTP 测试)
把现 `LarkBotController.event()` / `cardAction()` 的业务体迁入,**入参改为归一化结构**:

- `handleMessageReceive(p: NormalizedMessageEvent): Promise<void>` —— 自回环过滤 + 群 @ 检测 + `event_id` 去重 + 会话创建/状态机。
- `handleCardAction(p: NormalizedCardAction): Promise<CardResponse>` —— 状态机分派(`template_selected` / `field_change` / `submit_render`),**返回要回传的卡片/toast**。
- 迁入 `seenEventIds` 去重 Map、`isFirstSeenEvent`、`listBotTemplates`。
- 复用现有 `LarkBotService` / `PrismaService` / `RenderService` / `LarkBotCards`(逻辑不变,仅字段来源改为归一化 payload)。

归一化结构(从 SDK 扁平 `targetData` 与 HTTP body 两边都能映射出):
```
NormalizedMessageEvent { eventId?, senderOpenId, senderType?, message:{messageId,chatId,chatType,messageType,mentions[]} }
NormalizedCardAction   { eventId?, operatorOpenId?, action:{value?:{sessionId,action}, name?, option?, input_value?, form_value?} }
```

### 3.2 新增 `LarkBotWsService`(薄胶水,生命周期)
- `OnApplicationBootstrap`(`OnModuleInit` 亦可):若 `LARK_BOT_LONG_CONN_ENABLED==='true'` 且 app 凭证齐 →
  `new lark.WSClient({ appId, appSecret, domain: lark.Domain.Feishu })`(**指定 Feishu 域,非默认国际站**),
  构造 `new lark.EventDispatcher({}).register({ 'im.message.receive_v1': p=>adapt(p)→dispatch.handleMessageReceive, 'card.action.trigger': p=>adapt(p)→dispatch.handleCardAction })`,
  `wsClient.start({ eventDispatcher })`。
- 否则 `warn` 跳过(本地/CI 默认不连)。
- 启动异常只 `warn`,**不阻塞 api 启动**;断线由 SDK 内部自动重连。
- `OnApplicationShutdown`:关闭 WS 连接(防滚动部署期间旧实例不释放连接 → 与新实例短暂双收致重复处理)。

### 3.3 `LarkBotController`(改为薄壳,保留作 fallback)
- `/lark/bot/event`、`/lark/bot/card-action` **保留**,改为:适配 HTTP body → 归一化 payload → 调同一 `dispatch.*`;**保留 url_verification challenge 与 verification token 校验**(HTTP 路径仍需)。
- `/lark/bot/render-callback` **完全不动**(内部 worker 回调)。
- 飞书后台已配长连接 → 这俩 HTTP 端点无人调用、零副作用;**留作"WS 出问题时不改代码切回 webhook"的退路**。
- **删除留到 WS 生产稳跑 1-2 迭代后,单独 cleanup commit。**

### 3.4 模块接线
`LarkModule`(`@Global`)新增 `LarkBotDispatchService` + `LarkBotWsService` 两个 provider;`LarkBotWsService` 注入 `LarkBotDispatchService`。`LarkBotController` 改注入 `LarkBotDispatchService`(替代内联逻辑)。

## 4. 数据流

```
飞书(长连接)──WSS出站──> SDK WSClient ─> EventDispatcher.invoke(data,{needCheck:false})
   ├─ im.message.receive_v1 ─> adapt ─> dispatch.handleMessageReceive ─> 会话状态机 / 发选择卡
   └─ card.action.trigger    ─> adapt ─> dispatch.handleCardAction ──return{toast,card}──> SDK 经 WS 回传

[fallback] HTTP /lark/bot/event|card-action ─> adapt ─> 同一 dispatch.*(WS 模式下无人调用)

render worker 完成 ──HTTP──> /lark/bot/render-callback(不变)─> 上传 PDF + 发文件消息 + PATCH 卡片
```

## 5. 错误处理与健壮性

- **handler 内 try/catch**:异常时返回友好 toast(别让用户点了没反应);SDK 层 handler 抛错→记日志、连接不断。
- **启动失败**:`warn` 不阻塞 api。
- **断线重连**:SDK 内置。
- **event_id 去重**:进程内 Map 保留(SDK 仍可能重投)。
- **多副本(未来风险)**:去重 Map 是进程内的,跨副本不去重 → 多副本各开一条 WS = 重复建会话/重复渲染(与 UserState 多副本同类)。**门控手段:仅在指定单副本设 `LARK_BOT_LONG_CONN_ENABLED=true`,其余副本 false。** 当前单机单实例无此问题。

## 6. 环境变量与清理

- **新增** `LARK_BOT_LONG_CONN_ENABLED`(bool,默认 `false`;生产 `.env.prod` 设 `true`)→ `apps/api/src/common/env.ts` + `.env.prod.example` + `env-example-sync.spec` 白名单。
- **保留** `LARK_BOT_VERIFICATION_TOKEN`:WS 事件入口不用(SDK `needCheck:false`),但 **HTTP fallback 仍用** → 不删,加注释"WS 模式下不使用(保留以兼容 HTTP fallback)"。
- `LARK_BOT_OPEN_ID` **仍必需**(群内 @ 检测,WS/HTTP 皆用)。
- 批次5 的 env 跨字段断言调整:由"配 `LARK_BOT_VERIFICATION_TOKEN` 却缺 `LARK_BOT_OPEN_ID` → warn" 改为以 `LARK_BOT_LONG_CONN_ENABLED` 或 bot 凭证存在为触发、只看 `LARK_BOT_OPEN_ID`。

## 7. 测试

- **`LarkBotDispatchService` 单测(核心,脱离 WS/HTTP)**:fixture 用 **§2.1 spike 出的真实 `targetData` 形态**(非 HTTP body)。覆盖:私聊消息建会话 / 群内 @ 触发 / 非 @ 群消息忽略 / 自回环(sender 非 user 或 = bot open_id)忽略 / 重复 `event_id` 跳过 / `card.action.trigger` 各状态流转 + 返回卡片。
- **`LarkBotWsService` 门控单测**:`LARK_BOT_LONG_CONN_ENABLED` 未设/为 false → 不构造 WSClient、不连接。
- **真实连接**:需真飞书,不在 CI 测 → 手测(开关打开 + 群里 @ 机器人跑通选模板→填字段→渲染→出 PDF)。
- **现有 HTTP e2e**:因保留 fallback 端点,**维持原样不重写**(它们打 HTTP 路径,经适配后调同一 dispatch service)。

## 8. 文档同步(实现时)

- `docs/PROGRESS.md` 第 3 节。
- `docs/deployment.md`:补长连接说明(env、出网 WSS、单副本门控)。
- `docs/PRE_DEPLOYMENT_CHECKLIST.md`:① 飞书应用配置由"事件订阅 URL"改为"长连接模式";② **ECS 出网放行到飞书的 WSS(出站连接,nginx 反代只管入站,易漏)**;③ `LARK_BOT_LONG_CONN_ENABLED` 生产置 true。
- `examples/lark-bot/README.md`:配置步骤从"配事件订阅回调 URL"改为"开启长连接"。

## 9. 不做(YAGNI / 明确排除)

- 不动多维表格 `print-trigger`(飞书自动化调 HTTP,非平台事件,长连接覆盖不到)。
- 不动内部 `render-callback`(worker→api 内部 HTTP)。
- 本迭代**不删** HTTP fallback 端点(留待 WS 生产验证后的 cleanup)。
- 不引入新依赖、不动技术栈表。
- 不做多副本去重(当前单实例;门控即可)。

## 10. 受影响文件清单(预估)

- 新增:`apps/api/src/lark/lark-bot-dispatch.service.ts`、`apps/api/src/lark/lark-bot-ws.service.ts`、对应单测。
- 改:`apps/api/src/lark/lark-bot.controller.ts`(瘦身为适配壳)、`apps/api/src/lark/lark.module.ts`(加 provider)、`apps/api/src/common/env.ts`(加 `LARK_BOT_LONG_CONN_ENABLED` + 调断言)、`.env.prod.example`、`apps/api/test/env-example-sync.spec.ts`。
- 文档:见 §8。
