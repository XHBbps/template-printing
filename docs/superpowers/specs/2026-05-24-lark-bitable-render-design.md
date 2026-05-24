# 飞书多维表格 → 模板渲染回写附件 — 设计

> 状态：待用户审  
> 日期：2026-05-24  
> 相关：[iter 26 异步渲染服务](../plans/2026-05-23-iter-26-async-render.md)

## 1. 目标

把现有的"模板设计器 + 异步渲染服务"接到飞书多维表格里：

- 业务人员在多维表格里填好业务字段，**点一下按钮** → 几秒后该行**自动出现一个 PDF 附件**
- 整个过程对业务人员**零开发量**，只需会配多维表格自动化
- 同时支持机器人 @ 指令触发渲染（次要场景）

适用场景：出门证、出库单、价签、二维码贴纸等"一表数据 → 一批 PDF" 的小批量打印。

## 2. 用户故事

### 2.1 主流程（多维表格按钮触发）

```
管理员（一次性配置）：
  1. 在「模板打印平台」做好出门证模板，记录 templateId 与入参清单
  2. 在飞书多维表格里建出门证申请表，加：
     - 业务字段（姓名 / 来访原因 / 来访日期 / ...）
     - 「打印状态」单选字段（系统改）
     - 「PDF 附件」附件字段（系统写）
     - 「打印」按钮字段
  3. 给按钮配自动化：触发条件 = 点击按钮，操作 = 调用 webhook
     - URL: https://print.<company>.com/lark/print-trigger
     - Body：JSON，含 templateId 默认值 + 业务字段映射 + 多维表格元信息

业务人员（日常使用）：
  1. 在多维表格新增一行，填业务字段
  2. 点「打印」按钮
  3. 5-10 秒后看到「打印状态」自动变成「已完成」+「PDF 附件」列里出现 PDF
```

### 2.2 次要场景（机器人 @ 指令）

```
群里 @ 模板打印机器人 "打印 出门证 姓名=张三 来访人=李四"
  → 机器人回复"已发起，jobId=xxx"
  → 渲染完成后机器人发送 PDF 卡片到群里
```

本设计先做 2.1，2.2 留作后续迭代（DB 模型相同，只多一个事件订阅入口）。

## 3. 触发流程

```
[飞书多维表格]                          [模板打印平台 API]            [render worker]
 业务人员                                                
 1. 填好业务字段                                                       
 2. 点击按钮                                                          
        │                                                            
        ▼                                                            
 多维表格按钮自动化 ─POST─▶  /lark/print-trigger                       
   payload:                    1. 验证 verification token             
   - templateId (默认值)        2. 落 LarkPrintRequest 记录              
   - data (业务字段→入参 map)    3. 调内部 render.service.enqueue ────────▶ bullmq
   - app_token / table_id        4. 用 lark API 更新                  
   - record_id                     statusField = "处理中"             
   - statusField (字段名)      5. 立即 return { jobId, status }       
   - attachmentField (字段名)                                          
                                                          ┌──────────┘
                                                          ▼
                                                worker 渲染 PDF
                                                          │
                                              ┌──────────┘
                                              ▼
                              webhook callback → /lark/render-callback
                                1. 从 LarkPrintRequest 取 lark 上下文
                                2. 上传 PDF 到飞书云空间
                                   - < 20MB 一次性 upload_all
                                   - ≥ 20MB 分片 upload_prepare / part / finish
                                   → 得到 file_token
                                3. PATCH 多维表格 record:
                                   - attachmentField = [file_token]
                                   - statusField = "已完成"
                                4. 失败时：statusField = "失败"
                                   写 errorMsg 到附件字段相邻的备注（可选）
```

### 3.1 触发端 (POST /lark/print-trigger)

请求 body（业务人员在飞书自动化里手工填）：

```json
{
  "verificationToken": "由 .env 配置的随机串，飞书自动化里填",
  "templateId": "<出门证模板 UUID>",
  "data": {
    "name": "{{字段.姓名}}",
    "reason": "{{字段.来访原因}}",
    "date": "{{字段.来访日期}}"
  },
  "lark": {
    "appToken": "{{多维表格 app_token}}",
    "tableId": "{{多维表格 table_id}}",
    "recordId": "{{当前行 record_id}}",
    "statusField": "打印状态",
    "attachmentField": "PDF 附件"
  }
}
```

响应：

```json
{ "jobId": "xxx", "status": "pending" }
```

### 3.2 回调端 (POST /lark/render-callback)

被 render worker 调用（内部端点，但要 verification token 防外部伪造）：

```json
{
  "jobId": "xxx",
  "status": "done",
  "pdfUrl": "/uploads/render/xxx.pdf",
  "pngUrl": null,
  "errorMsg": null
}
```

处理逻辑：

1. 用 `jobId` 反查 `LarkPrintRequest` 拿 lark 上下文
2. 若 `status=done`：
   - 读 storage 里的 PDF 文件（buffer）
   - 调飞书 drive API 上传素材，附件类型 = `bitable_file`，parent_node = `tableId`
     - 文件 ≥ 20MB → upload_prepare / upload_part / upload_finish
     - 否则 → upload_all
   - 拿到 `file_token`
   - PATCH 多维表格 record，把 `attachmentField` 设为 `[{ file_token }]`，`statusField` 设为 `已完成`
3. 若 `status=failed`：
   - PATCH 多维表格 record，`statusField` = `失败`
   - 可选：把 `errorMsg` 写到 record 的某个备注字段（v1 不做）

## 4. 数据模型

仅新增一张表：

```prisma
model LarkPrintRequest {
  id              String   @id @default(uuid())
  renderJobId     String   @unique @map("render_job_id")
  appToken        String   @map("app_token")
  tableId         String   @map("table_id")
  recordId        String   @map("record_id")
  statusField     String   @map("status_field")
  attachmentField String   @map("attachment_field")
  createdAt       DateTime @default(now()) @map("created_at")

  renderJob       RenderJob @relation(fields: [renderJobId], references: [id], onDelete: Cascade)

  @@index([renderJobId])
  @@map("lark_print_requests")
}
```

`RenderJob` 加反向关系 `larkPrintRequest LarkPrintRequest?`。**不在 `RenderJob` 上加 lark 字段**，保持渲染服务对调用方解耦。

## 5. 代码组织

```
apps/api/src/lark/
├── lark-im.service.ts             # 已有：tenant_access_token + sendTextToUser
├── lark-bitable.service.ts        # 新建：read record / update record / upload material
├── lark-bitable.controller.ts     # 新建：POST /lark/print-trigger + /lark/render-callback
└── lark-im.module.ts → lark.module.ts (改名 + 注册新模块)
```

```
examples/lark-bitable/
└── README.md          # 业务人员接入说明（多维表格搭建步骤 + 自动化配置截图 + 字段约定）
```

复用：

- `lark-im.service.ts` 的 `tenant_access_token` 缓存逻辑
- `apps/api/src/render/render.service.ts` 的 enqueue 方法
- `apps/render/src/webhook.ts` 的 sendCallback 流程

## 6. 飞书 API 调用

### 6.1 tenant_access_token

复用 `LarkImService.getTenantAccessToken()`（已实现 + 2 小时缓存）。

### 6.2 上传素材到飞书云空间（bitable_file 用途）

文档：`https://open.feishu.cn/document/server-docs/docs/drive-v1/upload/upload-overview`

**小文件（< 20MB）：** `POST /open-apis/drive/v1/medias/upload_all`

```
multipart/form-data
- file_name: "xxx.pdf"
- parent_type: "bitable_file"
- parent_node: "<tableId>"
- size: <bytes>
- file: <binary>
```

返回 `file_token`。

**大文件（≥ 20MB）：** 三步走

1. `POST /open-apis/drive/v1/medias/upload_prepare` → 得到 `upload_id` + `block_size` + `block_num`
2. 对每个 block：`POST /open-apis/drive/v1/medias/upload_part`（multipart：upload_id + seq + file 块）
3. `POST /open-apis/drive/v1/medias/upload_finish` → 返回最终 `file_token`

实际渲染输出通常远小于 20MB，但分片逻辑作为通用实现一次性写完。

### 6.3 更新多维表格 record

`PUT /open-apis/bitable/v1/apps/{app_token}/tables/{table_id}/records/{record_id}`

```json
{
  "fields": {
    "<statusField>": "已完成",
    "<attachmentField>": [{ "file_token": "xxxxx" }]
  }
}
```

## 7. 凭证 / 配置

### 7.1 复用现有飞书 app

飞书自建应用同一对 `app_id / app_secret` 可同时享 SSO + bitable + drive + IM 权限。复用 `.env` 里的 `LARK_SSO_APP_ID` / `LARK_SSO_APP_SECRET`。

> ⚠️ 已在 2026-05-24 用户对话里暴露了一次 secret；用户应在飞书后台**轮换 secret** 后填新值到本地 / 生产 `.env`。

### 7.2 新增环境变量

`.env.example` 与 `.env` 都加：

```
# 飞书多维表格 webhook verification — 业务人员在自动化里需配同一值
LARK_BITABLE_VERIFICATION_TOKEN=<openssl rand -hex 16>
```

仓库内 `.env.example` 只放占位（`replace_me`），真实值不入库。

### 7.3 飞书后台权限申请清单

应用需要在飞书开放平台启用以下权限：

- `bitable:app`（读写多维表格）
- `drive:drive`（上传文件到云空间）
- 已有：`contact:user.*`、`authen:user_id.read`（SSO 用）
- 可选：`im:message:send_as_bot`（次要场景 2.2 用，本期不强求）

## 8. 字段约定（业务人员文档）

文档放 `examples/lark-bitable/README.md`，关键约定：

| 多维表格字段 | 类型 | 必需 | 由谁填 | 备注 |
|---|---|---|---|---|
| 模板入参字段（任意多个） | 任意 | 是 | 业务人员 | 字段名**由用户在自动化里映射**到模板入参，无强制命名 |
| 「打印状态」 | 单选（未发起/处理中/已完成/失败） | 是 | 系统 | 字段名也由用户在自动化里指定 |
| 「PDF 附件」 | 附件 | 是 | 系统 | 同上 |
| 「打印」 | 按钮 | 是 | 业务人员 | 配自动化触发 webhook |

字段名**不强制**叫"模板 ID" / "打印状态" — 业务人员在飞书自动化里通过 `statusField` / `attachmentField` 字段告诉服务"哪一列是状态、哪一列是附件"。这样不同表可以用不同字段名。

## 9. 错误处理

| 场景 | 行为 |
|---|---|
| verification token 不匹配 | 401 拒绝 |
| templateId 不存在 | 400，立即返回错误（不入队） |
| lark 上下文字段缺失 | 400 |
| 渲染失败 | callback 收到 status=failed → 更新 statusField = "失败"，不写附件 |
| 多维表格更新失败（权限 / 字段名错） | log + 不重试（业务人员手动看 lark 后台修） |
| 上传文件失败 | log + statusField = "失败"，errorMsg 写 LarkPrintRequest |

## 10. 验收标准

- [ ] 业务人员在飞书多维表格里点按钮 → 10 秒内看到「打印状态」变化 → 30 秒内看到 PDF 附件
- [ ] 飞书 secret 不出现在任何 git tracked 文件中
- [ ] `examples/lark-bitable/README.md` 含完整的多维表格搭建 + 自动化配置步骤
- [ ] 异常路径（失败、超时、权限错）的 statusField 都能正确更新

## 11. 不在范围（留后续迭代）

- 机器人 @ 指令触发（场景 2.2）
- 失败重试（render worker 加 attempts: 3 + 指数退避，单独迭代）
- 渲染历史 / 用户「我的渲染任务」视图
- Signed URL（防附件 URL 猜测）
- 多飞书 app（多租户）凭证管理
- 错误详情写回多维表格备注列

## 12. 后续 plan 拆分思路

预计 6 个 task：

1. **DB**：新建 `LarkPrintRequest` 表 + migration
2. **lark-bitable.service**：tenant_access_token + read/update record + upload material（含分片）
3. **lark-bitable.controller**：POST /lark/print-trigger + POST /lark/render-callback
4. **render worker** 适配：callback 接口可指向 /lark/render-callback（验证 token）
5. **`.env.example`** 新增 LARK_BITABLE_VERIFICATION_TOKEN + 文档同步
6. **`examples/lark-bitable/README.md`**：业务人员接入手册（多维表格搭建 + 自动化配置）

详细 task 列表见 plan 文档（待写）。
