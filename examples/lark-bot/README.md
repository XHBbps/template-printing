# 飞书机器人 → 一键生成 PDF

> 业务人员接入指南：群里 @ 模板打印机器人 / 私聊机器人 → 选模板 → 填字段 → 几秒后机器人 @ 你并发送 PDF。

---

## 整体流程

```
群里 @ 机器人 (or 私聊)
   ↓
机器人发卡片：选模板（下拉）
   ↓
选完模板 → 卡片变填字段表单
   ↓
填字段 + 点「开始渲染」
   ↓
卡片变「渲染中…」+ 异步处理
   ↓
渲染完成 → 机器人发文件 + @ 你提醒
```

零开发，纯飞书操作。

---

## 飞书后台配置（一次性）

### 1. 启用机器人

进飞书开放平台 → 你的自建应用 → **应用功能** → **机器人** → 启用。

设置机器人显示名和头像。

### 2. 配置事件订阅

进 **事件与回调** → **事件订阅**：

- **请求地址**：`https://print.<your-domain>/lark/bot/event`
  - 开发临时用 cloudflared 隧道地址 + `/lark/bot/event`
- **Verification Token**：点击"生成"飞书会出一个；复制下来填到服务端 `.env` 的 `LARK_BOT_VERIFICATION_TOKEN`
- **Encrypt Key**：**不要启用**（本版本未实现 AES 解密）
- 点击"保存"。飞书会立即对 URL 发 `url_verification` 请求验证连通性，正确响应应该立即变绿。

订阅事件：
- ☑️ `im.message.receive_v1` — 接收消息

### 3. 配置卡片回调

进 **事件与回调** → **消息卡片回调**：

- **请求地址**：`https://print.<your-domain>/lark/bot/card-action`
- Verification Token：**和上面是同一个**（共享）

### 4. 复制机器人 open_id

进 **应用信息** → **应用凭证** 或 **机器人** 板块，找到机器人的 `open_id`（形如 `ou_xxxxxxxxxxxxx`）。

填到服务端 `.env` 的 `LARK_BOT_OPEN_ID`。

> 群里 @ 检测必须用 open_id，没填的话群消息会被静默忽略；私聊不受影响。

### 5. 权限申请

进 **权限管理**，启用以下权限：

- `im:message` — 接收消息
- `im:message:send_as_bot` — 以机器人身份发消息
- `im:resource` — 上传文件到飞书 IM

提交版本审核 → 发布。

### 6. 把机器人加进群（可选）

如果想在群里用：群设置 → 机器人 → 添加 → 选你的应用。
私聊则不需要这一步。

---

## 服务端配置

`.env` 里填好两个变量：

```
LARK_BOT_VERIFICATION_TOKEN=<飞书后台复制的 verification token>
LARK_BOT_OPEN_ID=<飞书后台复制的机器人 open_id>
```

然后**重建容器让 env 生效**（restart 不读 env_file）：

```bash
docker compose -f docker-compose.dev.yml up -d --force-recreate api
```

确认路由注册：

```bash
docker compose -f docker-compose.dev.yml logs api --tail 30 | grep '/lark/bot'
```

应该看到：
```
Mapped {/lark/bot/event, POST}
Mapped {/lark/bot/card-action, POST}
Mapped {/lark/bot/render-callback, POST}
```

---

## 使用

1. 在飞书里 **@ 机器人**（任意文本都行）/ 或私聊机器人发任意消息
2. 机器人会立即推送一张卡片，里面有"选模板"下拉
3. 选好模板后卡片自动更新成"填字段"表单
4. 填完字段（必填的会标红 `*`），点底部 **🚀 开始渲染** 按钮
5. 卡片变成"⏳ 渲染中…"，PDF 在几秒内出现在同一会话里
6. 机器人会 @ 你提示"渲染完成，请查收 PDF"

---

## 常见问题

### 群里 @ 机器人没有任何反应

- 检查机器人是否已被加进群（群设置 → 机器人）
- 检查 `LARK_BOT_OPEN_ID` 是否填对（飞书后台 → 应用信息 → 机器人板块）
- 检查飞书后台事件订阅 URL 是否绿色已验证

### 私聊机器人没有任何反应

- 检查事件订阅 URL 是否绿色已验证
- 检查 `LARK_BOT_VERIFICATION_TOKEN` 是否两边一致
- 看后端日志：`docker compose logs api | grep print/lark/bot/event`

### 卡片"渲染中…"很久不结束

- 看 render worker 日志：`docker compose logs render --tail 30`
- 大概率是模板有问题（schema 字段没设全 / 元素引用了不存在的变量）

### 「打印状态」/「PDF 附件」没出现，只有错误提示

- 看后端日志找 `bitable updateRecord` / `drive upload_all` 的错误码：
  - `99991668 permission denied` → 应用没被加为多维表格协作者
  - `99991663 missing scope` → 权限没启用 / 未发布版本

---

## 字段类型支持范围

| 模板 schema.fields.type | 卡片渲染 |
|---|---|
| `string` | input 输入框 |
| `number` | input 输入框（提交时自动转 number） |
| `boolean` | select 下拉（是/否） |
| `enum` | select 下拉（按 schema.options） |
| `date` / `datetime` | date_picker |
| `image` | ⚠️ 卡片暂不支持，渲染时该字段为空 |
| `array` | ⚠️ 卡片暂不支持，渲染时该字段为空 |

---

## 同时点了多次 @ 机器人会怎么样？

服务端做了 **re-@ 去重**：如果你已经有一张正在使用的卡片（state=`select_template` 或 `fill_fields`），后续 @ 会被**静默忽略**，避免群里刷屏。

完成一张卡片（点了"开始渲染"或最终失败）后，你可以立即 @ 开新任务。
