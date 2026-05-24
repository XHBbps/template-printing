# 飞书多维表格 → 一键打印 PDF

> 业务人员接入指南：在飞书多维表格里点一下按钮，几秒后该行自动出现 PDF 附件。
>
> 适用场景：出门证 / 出库单 / 价签 / 二维码贴纸 / 凭证 / 邀请函 ……

---

## 整体流程

```
你在多维表格填好业务数据 → 点「打印」按钮 → 5-10 秒 → 该行出现 PDF 附件
                ↑
       系统自动渲染 PDF 并写回
```

零开发，纯多维表格自动化配置。

---

## 准备工作（一次性）

### 1. 在模板打印平台先做好模板

登录 `https://print.<your-company>.com` → 模板中心 → 新建模板。

设计完成后，在浏览器地址栏看到 `…/templates?open=<UUID>` 这一段 UUID 就是 **模板 ID**，记下来。

同时记下模板里所有"变量字段"的 key（例如出门证常用：`name` / `reason` / `visitor` / `date` / `signature` …），这些 key 之后要在多维表格里建对应的列。

### 2. 找管理员要 `verificationToken`

管理员在服务器 `.env` 里配的 `LARK_BITABLE_VERIFICATION_TOKEN` 值。这个值你和系统两边要对上。

---

## 多维表格搭建

新建多维表格（或用已有表），加以下列：

| 列名（你来命名） | 列类型 | 用途 |
|---|---|---|
| 姓名 | 文本 | 模板入参 → `name` |
| 来访原因 | 文本 | 模板入参 → `reason` |
| 来访日期 | 日期 | 模板入参 → `date` |
| …（其他模板入参） | 任意 | 按需 |
| **打印状态** | 单选 | 系统自动改：`未发起 / 处理中 / 已完成 / 失败` |
| **PDF 附件** | 附件 | 系统自动写 PDF 文件 |
| **打印** | 按钮 | 业务人员点击触发 |

> 列名你自由命名（叫"模板状态"、"输出"、"立即打印"都行），下面自动化里用同名映射就行。

---

## 配置按钮自动化

### 选中「打印」按钮列 → 编辑按钮 → 添加自动化

#### 触发器

- 类型：**点击按钮**

#### 操作 1：调用 webhook

- 类型：**调用 HTTP 请求**
- 方法：`POST`
- URL：`https://print.<your-company>.com/lark/print-trigger`
- Headers：`Content-Type: application/json`
- Body（JSON）：

```json
{
  "verificationToken": "<管理员给你的 token>",
  "templateId": "<你的模板 UUID>",
  "data": {
    "name": "{{字段.姓名}}",
    "reason": "{{字段.来访原因}}",
    "date": "{{字段.来访日期}}"
  },
  "lark": {
    "appToken": "{{多维表格.app_token}}",
    "tableId": "{{多维表格.table_id}}",
    "recordId": "{{当前记录.record_id}}",
    "statusField": "打印状态",
    "attachmentField": "PDF 附件"
  }
}
```

> **关键点**：
>
> - `data` 里的 key（`name` / `reason` ...）= 你模板里的变量 key（**不是**多维表格的列名）
> - `data` 里的 value = `{{字段.<多维表格列名>}}`（飞书自动化的字段引用语法）
> - `statusField` / `attachmentField` = 你在多维表格里命名的"打印状态"和"PDF 附件"列名（**必须一字不差**）

完整可复制版本见同目录 [`payload-example.json`](./payload-example.json)。

---

## 联调验证

1. 在多维表格新增一行测试数据，填好所有业务字段
2. 点击「打印」按钮
3. 「打印状态」列应在 1 秒内变成 `处理中`
4. 5-10 秒后变成 `已完成`，「PDF 附件」列出现 PDF 文件
5. 点开 PDF 文件，内容是渲染好的模板

---

## 常见问题

### 「打印状态」一直停在 `处理中`

- 看后端日志（`docker logs template-printing-api`）找 `bitable updateRecord` 失败原因
- 90% 是字段名不匹配 —— 自动化里写的 `statusField` / `attachmentField` 值必须**与多维表格列名完全一致**（区分大小写、空格、标点）
- 检查飞书后台应用的 `bitable:app` / `drive:drive` 权限是否启用

### 「打印状态」变成 `失败`

- 看后端日志的对应 `jobId` 的失败原因
- 常见：模板 ID 写错 / 模板里某变量必填但 `data` 里没传 / PDF 上传到云空间被拒（文件过大或权限）

### 接口返回 `401 verification_token_mismatch`

- 自动化 body 里的 `verificationToken` 跟管理员服务器 `.env` 里不一致
- 重新跟管理员对一遍

### 接口返回 `400 template_not_found`

- `templateId` 写错（UUID 多/少字符）
- 模板被删除

### 接口返回 `403`

- 通常是 SSL 证书或者 CORS 问题，问运维

---

## 字段命名约定（速查表）

| 自动化 body 字段 | 你填什么 | 来源 |
|---|---|---|
| `verificationToken` | 字符串 | 管理员告知 |
| `templateId` | UUID | 模板打印平台 URL 里 |
| `data.<key>` | `{{字段.<列名>}}` | 模板入参 key → 多维表格列引用 |
| `lark.appToken` | `{{多维表格.app_token}}` | 飞书内建变量 |
| `lark.tableId` | `{{多维表格.table_id}}` | 飞书内建变量 |
| `lark.recordId` | `{{当前记录.record_id}}` | 飞书内建变量 |
| `lark.statusField` | 你的列名（如"打印状态"） | 你自定义 |
| `lark.attachmentField` | 你的列名（如"PDF 附件"） | 你自定义 |

---

## 出问题找谁

- 模板设计 → 设计师 / 内容负责人
- 飞书自动化配置 → IT
- 后端 API / 渲染问题 → 模板打印平台运维
