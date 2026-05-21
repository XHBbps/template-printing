# 模板打印平台 — 设计文档

| 字段 | 值 |
|---|---|
| 状态 | Draft（待评审） |
| 版本 | v0.1 |
| 起草日期 | 2026-05-21 |
| 作者 | mavis_perferendisdm@mail.com |
| 受众 | 实施工程师、运维、相关产品 |

---

## 1. 背景与目标

参考 `vue-plugin-hiprint` 等开源模板打印项目，搭建一个团队自部署的模板打印平台。覆盖**模板设计、保存、调用、输出**全链路，并和**飞书多维表格**深度集成。

相比 hiprint 的"任意像素绝对定位 + 大量属性面板"，本平台通过**栅格化（grid-based）+ 飞书风简洁 UI** 大幅降低业务用户的上手成本。

### 核心目标

- **业务可上手**：业务人员（非工程师）能 30 分钟内创建一份能用的模板。
- **API 可集成**：飞书 / Anycross / 自有系统可通过 API 调用打印，传入数据 → 拿到 PDF/PNG 或直接回写到飞书记录。
- **可自部署**：Docker Compose 一键部署到一台阿里云 ECS。

### 非目标

- 不做 SaaS（不接租户隔离 / 计费）。
- 不做"直连物理打印机"的小票/标签机硬件中间件（保留扩展点，但不在 MVP 内）。
- 不做实时多光标协作编辑（Figma / 在线 Office 那种）。但允许多人**非同时**编辑同一模板：通过乐观锁（基于版本号） + 完整版本历史 + 冲突弹层 + 轻量在线提示，避免覆盖与白做工。详见 § 6.8。

---

## 2. 范围（P0 / P1 / P2）

### P0（MVP，本 spec 主体）

| 域 | 内容 |
|---|---|
| 设计器 | 栅格化拖拽，8 类元素，所见即所得 |
| 模板中心 | CRUD + 版本（append-only） + 预览 |
| 输出 | 浏览器打印 + 服务端 PDF + PNG |
| 数据 | 单条字段 + 明细表格（多行循环） |
| 集成 | 飞书回写（API 调用 + credentialId 鉴权） |
| Web 鉴权 | 飞书 SSO（OAuth 2.0）+ httpOnly cookie JWT；保留 1 个本地应急 admin 通道；飞书工作台入口（侧栏 home_url） |
| API 鉴权 | API Key (`apk_xxx`)，scope 化（templates:read/write、print:execute、lark:credentials:use）|
| 异步 | 长轮询（GET /jobs/:id?wait=10s） |
| 部署 | Docker Compose on 阿里云 ECS，GitHub Actions CI/CD，阿里云 ACR 镜像仓库 |

### P1

- 多联次（同一份数据印 N 份，可有差异：水印 / 隐藏部分字段）
- 批量打印（data 是数组）
- Webhook 推送（取代/补充长轮询）
- Staging 环境
- 标签型模板（小票布局优化）
- 文件存储抽象到 S3/OSS

### P2

- 直连物理打印机的客户端中间件
- 实时协作（多人编辑）
- 多租户 / 组织隔离
- 模板市场（系统预置模板）

---

## 3. 系统概览

### 3.1 核心域

```
 ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
 │   设计器 Domain  │ → │  模板中心 Domain  │ → │  打印执行 Domain │
 │  Designer       │    │  Template Hub    │   │  Print Engine   │
 │  (栅格化拖拽 +   │    │  (CRUD/版本/搜索) │   │  (浏览器/PDF/PNG/│
 │   字段定义)     │    │                  │   │   飞书回写)      │
 └─────────────────┘    └─────────────────┘    └─────────────────┘
                              ↑                       ↑
                       Web 用户/admin              API 调用方（含飞书）
```

### 3.2 技术栈

| 层 | 选型 | 理由 |
|---|---|---|
| 前端 | Vue 3 + TypeScript + Pinia + Element Plus（飞书风改色） | 与 hiprint 生态相似，便于借鉴；同构渲染契合 |
| 后端 API | Node.js + NestJS + Prisma | 模块化结构清晰；Prisma 防 SQL 注入 |
| 渲染 Worker | 独立 Node 进程 + Puppeteer + Chromium | 与 API 共享 Vue 渲染组件，所见即所得严格保真 |
| 数据库 | PostgreSQL 16 | 行锁 `FOR UPDATE` 支持自增编号场景；JSON 字段支持模板内容 |
| 缓存 / 队列 | Redis 7 | BullMQ 任务队列、分布式锁、飞书 token 缓存 |
| 文件存储 | 本地磁盘（MVP） / S3-兼容（P1） | 抽象 `FileStorage` 接口，落地可换 |
| 反代 | Nginx | 前端静态 + API 反代 + Let's Encrypt 证书 |
| 部署 | Docker Compose on 阿里云 ECS | 小团队 + 单机起步 |

### 3.3 同构渲染（关键决策）

**前端设计器** 和 **后端 PDF 生成** 共享同一个 Vue 渲染组件 `<TemplateRenderer />`：

- 前端：在浏览器中渲染，用于设计器内的实时预览 / `window.print`。
- 后端：Render Worker 内置一个本地 Vue SSR，把模板 JSON 喂给 `<TemplateRenderer />` 输出 HTML 字符串，由 Puppeteer 加载该 HTML → `page.pdf()` / `page.screenshot()`。

收益：模板渲染逻辑只写一份；调用方在浏览器看到的设计稿和 PDF 输出**像素级一致**。

---

## 4. 核心概念

| 概念 | 定义 |
|---|---|
| **Template** | 一份模板。包含 `canvas`（画布尺寸 + 栅格）、`schema`（数据契约，声明需要哪些字段）、`elements[]`（元素位置 + 类型 + 数据绑定 + 样式）。 |
| **TemplateVersion** | 模板的某一个版本。append-only，每次保存 +1。 |
| **PrintJob** | 一次打印。包含 `templateId` + `data`（满足该模板 schema 的实际数据）+ `output`（格式 + 目的地）。 |
| **Cell（格子）** | 画布的最小定位单位。所有元素的 `col/row/colSpan/rowSpan` 都按格子表达，永不出现"任意像素"。cell 的长 × 宽**独立可编辑**（不强制正方形）。 |
| **Destination** | 输出目的地的抽象。`download` 返回签名 URL；`lark` 走飞书上传 + 回写记录；未来可扩展 `wework` / `dingtalk` / `email`。 |
| **Credential** | 第三方鉴权凭证。MVP 仅 `lark` 类型，AES-256-GCM 加密落库，API 调用传 `credentialId` 而非明文 secret。 |
| **EditorPresence** | 模板编辑器的"在线状态"。3 分钟内打开过编辑器的用户被视为"在线"，前端右上角显示头像列表。**不是锁**，仅作社交提示。 |
| **OptimisticVersionLock** | 保存模板时的乐观并发控制：客户端进入编辑器时记下 `version=N`，保存时携带 `If-Match-Version: N` 请求头；服务端用 `UPDATE ... WHERE current_version=N` 原子更新，失败则返回 409 + 冲突详情。 |
| **LarkSSO** | Web 用户登录唯一正常通道：OAuth 2.0 授权码模式。`users.lark_open_id` 是业务主键；姓名 / 头像 / 邮箱每次登录同步飞书。飞书自建应用（非商店应用）。 |
| **LocalEmergencyAdmin** | 飞书不可用时的应急通道：仅 admin 角色，本地用户名 + 密码登录 `/auth/local/login`。env 配 `INITIAL_ADMIN_LOCAL_PASSWORD` 初始化，强制首次登录修改。 |
| **LarkWorkspaceEntry** | 飞书侧栏点击应用图标直接打开后台（P0 范围）。飞书后台配 `home_url`；前端处理 webview 嵌入特殊性（cookie SameSite=None + Secure、CSP frame-ancestors 允许 feishu.cn）。 |

---

## 5. 模板 JSON Schema

### 5.1 顶层结构

```jsonc
{
  "id": "tpl_01HXYZ...",
  "meta": {
    "name": "扬力出门证",
    "description": "出门证模板，含三联次结构（存根/出门/财务）",
    "version": 3,
    "tags": ["出门证", "扬力集团"],
    "createdBy": "user_xxx",
    "updatedAt": "2026-05-21T10:00:00Z"
  },

  "canvas": {
    "cols": 240,                       // 画布列数（格子数，不是像素）
    "rows": 160,                       // 画布行数
    "cell": { "w": 4, "h": 4 },        // 单格像素（长方形可不等）
    "paper": "A4-Landscape",           // 或 { "w_mm": 210, "h_mm": 297 } 自定义
    "background": null
  },

  // 数据契约：声明本模板需要哪些字段；API 调用方按此传值
  "schema": {
    "tihuoDanwei": {
      "type": "string",
      "label": "提货单位",
      "required": true,
      "example": "运易科技"
    },
    "shuliang": { "type": "number", "label": "数量" },
    "date":     { "type": "date",   "label": "出公司日期" },
    "items": {
      "type": "array",
      "label": "明细",
      "shape": { "项目": "string", "金额": "number" }
    }
  },

  "elements": [ /* 见 5.3 */ ]
}
```

### 5.2 命名约定

- 模板字段名（`schema` 的 key）：**英文 / 拼音**，下划线或小驼峰。
- 显示名：放 `schema[key].label`，中文。
- 这样 API 调用方传参时用英文 key（URL/JSON 友好），设计器和打印输出展示中文 label。

### 5.3 元素清单（8 类）

所有元素共享通用属性：

```jsonc
{
  "id": "e_xxx",
  "type": "...",
  "grid": { "c": <col>, "r": <row>, "cs": <colSpan>, "rs": <rowSpan> },
  "style": {
    "border": {
      "top":    { "show": false, "width": 1, "style": "solid", "color": "#1f2328" },
      "right":  { "show": false, "width": 1, "style": "solid", "color": "#1f2328" },
      "bottom": { "show": true,  "width": 1.5, "style": "solid", "color": "#1f2328" },
      "left":   { "show": false, "width": 1, "style": "solid", "color": "#1f2328" }
    },
    "padding": { "t": 0, "r": 4, "b": 2, "l": 4 },
    "background": null,
    "borderRadius": 0
  }
}
```

> **关键设计**：去掉了"线条"作为独立元素。下划线、分隔线由元素自身的 `border.<side>` 承载，跟随元素移动 / 对齐。纯装饰线用 `rect`（高度 = 1 格）。

#### 5.3.1 text — 静态文本

```jsonc
{ "id":"e1", "type":"text", "grid":{...},
  "content": { "static": "出 门 证" },
  "style": { "fontSize": 24, "fontWeight": "bold", "align": "center", ... } }
```

#### 5.3.2 field — 动态字段

```jsonc
{ "id":"e2", "type":"field", "grid":{...},
  "binding": "tihuoDanwei",         // 绑定到 schema 中的 key
  "fallback": "—",                  // 数据缺失时显示
  "format": null,                   // 见 5.4 格式化
  "style": { "fontSize": 14, "align": "left", ... } }
```

#### 5.3.3 image — 图片

```jsonc
{ "id":"e3", "type":"image", "grid":{...},
  "source": { "kind": "static", "url": "/assets/logo.png" },
  // 或
  // "source": { "kind": "field", "binding": "logoUrl" },
  "fit": "contain"                  // contain | cover | fill
}
```

#### 5.3.4 table — 明细表（多行循环）

```jsonc
{ "id":"e4", "type":"table", "grid":{...}, "binding":"items",
  "columns": [
    { "key": "项目", "header": "项目", "cs": 30, "align": "left",  "format": null },
    { "key": "金额", "header": "金额", "cs": 12, "align": "right", "format": "money" }
  ],
  "rowHeight": 4,                   // 单行高度（格子数）
  "headerStyle": {...},
  "rowStyle": {...},
  "showHeader": true
}
```

#### 5.3.5 barcode — 二维码 / 条形码

```jsonc
{ "id":"e5", "type":"barcode", "grid":{...},
  "binding": "orderNo",             // 或 "content": { "static": "https://..." }
  "symbology": "qr",                // qr | code128 | code39 | ean13
  "showText": false }
```

#### 5.3.6 autonumber — 自动递增编号

```jsonc
{ "id":"e6", "type":"autonumber", "grid":{...},
  "sequence": "outpass",            // 后端发号器名称，对应 sequences 表
  "format": "0000000",              // 至少 7 位补零
  "prefix": "",
  "style": { "fontSize": 14, "color": "#d23631", "fontFamily": "monospace", ... }
}
```

> 发号器线程安全：DB 中 `SELECT current_value FROM sequences WHERE name=? FOR UPDATE`。

#### 5.3.7 system — 系统变量

```jsonc
{ "id":"e7", "type":"system", "grid":{...},
  "variable": "pageNo",             // pageNo | totalPages | now | printedBy
  "format": "yyyy年MM月dd日"         // 仅 now 用
}
```

#### 5.3.8 rect — 矩形（装饰框 / 印章框 / 分隔线）

```jsonc
{ "id":"e8", "type":"rect", "grid":{...},
  "style": { "background": "#fff", "borderRadius": 4, ... }
}
```

> 纯装饰横线：`rect` + `rs:1`（一格高）+ `style.background:"#000"`。

> 注：`barcode` 是单一 type，通过 `symbology` 区分 QR 码、Code128、Code39、EAN13 等。用户视角上"二维码"和"条码"是两个元素入口（左栏分两个 icon），但底层共享 schema 和渲染逻辑。

### 5.4 格式化（format）

| 类型 | format 值示例 | 输出 |
|---|---|---|
| 日期 | `"yyyy年MM月dd日"` | `2026年07月12日` |
| 金额 | `"money"` 或 `"#,##0.00"` | `1,234.50` |
| 数字 | `"int"` / `"#,##0"` | `1,234` |
| 百分比 | `"percent"` | `45.0%` |
| 自定义 | （后端 dayjs / numeral） | — |

格式化由后端执行，前端展示使用相同的 JS 函数（保持一致性）。

---

## 6. 设计器交互模型

### 6.1 三栏布局

```
 ┌────────────────────────────────────────────────────────────────────┐
 │ Header: [模板名] [↶ ↷] [👁 预览] [⊞ 模拟拖拽]                       │
 │   cell w[ 4 ]× h[ 4 ]px ▾  [A4 横向 ▾]  [保存] [立即打印]            │
 ├──────────┬───────────────────────────────────┬─────────────────────┤
 │          │                                   │                     │
 │  元素栏   │            画 布 (栅格)            │   字段管理          │
 │  (88px)  │       (自适应居中)                  │   (300px)          │
 │          │                                   │                     │
 │  基础     │                                   │  + 添加字段         │
 │  T 文字   │                                   │  [字段卡片列表]      │
 │  {} 字段  │                                   │  ─────────────      │
 │  ▤ 图片   │                                   │   选中元素属性      │
 │  ▢ 矩形   │                                   │   类型 / 绑定       │
 │          │                                   │   位置 / 尺寸       │
 │  表格     │                                   │   字号 / 对齐       │
 │  ▦ 明细   │                                   │   边框 (田字格)      │
 │          │                                   │   内边距 (4 方向)    │
 │  编码     │                                   │   缺省值            │
 │  ...     │                                   │                     │
 └──────────┴───────────────────────────────────┴─────────────────────┘
```

### 6.2 栅格的可见性策略

- **默认隐藏**：画布是干净的纯白。
- **拖拽中显示**：用户开始拖动 / resize 任何元素时，栅格虚线淡入（180ms）；动作结束后淡出。
- **用户主动触发**：右上角"模拟拖拽"按钮可临时显示，用于布局对齐参考。

### 6.3 元素选中态

选中态视觉采用 **`outline` + `box-shadow`**（而非 `border`），不覆盖元素自己的 4 边框配置：

```css
.elem.is-selected {
  outline: 1.5px solid #0969da;
  outline-offset: 2px;
  border-radius: 4px;
  box-shadow: 0 0 0 5px rgba(9,105,218,0.10);
}
```

### 6.4 双区域交互（参考飞书仪表盘）

| 区域 | 鼠标光标 | 行为 |
|---|---|---|
| 顶部边框中点的 `⠿` grip 按钮（白底蓝边圆角） | `grab` / `grabbing` | **拖动整个元素** |
| 4 条边（边内 8px） | `ns-resize` / `ew-resize` | 调宽度或高度 |
| 4 个角（12×12 区域） | `nwse-resize` / `nesw-resize` | 同时调宽高 |
| 中心区域 | `text` / `pointer` | 单击进入编辑（text 编辑文字 / 其它聚焦右栏） |

**为什么用 grip 而非"边缘 + 中心拖动"**：避免和 resize 的边缘判定冲突，飞书仪表盘验证过的克制方案。

### 6.5 cell 尺寸切换动画

用户在 Header 修改 cell 长 / 宽并失焦（或回车）后，触发 **方案 C 动画**：

1. **栅格淡出**（150ms）：背景虚线 opacity → 0。
2. **画布形变 + 元素同步移动**（360ms ease-in-out）：cell 像素值变化，画布的 width/height 以及每个元素的 left/top/width/height 用 cubic-bezier(.4,0,.2,1) 平滑过渡。
3. **新栅格淡入**（180ms）。

切换期间禁用所有交互（防误拖）。元素数 > 500 时降级为整体淡入淡出（方案 A）。

### 6.6 字段管理

右栏上半部分：

- **+ 添加字段**：弹层填 `key`（英文 / 拼音）+ `label`（中文显示名）+ `type`（string / number / date / array）+ `required` + `example`。
- 字段列表：每张卡片显示 key、label、类型、必填标记。
- **未使用字段警示**：已声明但模板中没有元素绑定的字段，卡片背景黄色 + "⚠ 未在模板中使用"。
- **反向警示**：模板中有 `field` 元素绑定到不存在的 key，画布上该元素红色高亮。

### 6.7 预览模式

切到"预览"标签：

- 弹层让用户填一组示例数据（或读取上次保存的）。
- 不可编辑，显示最终打印效果（同 PDF 渲染逻辑）。
- 检查动态字段过长是否换行 / 截断、表格行数过多是否分页。

### 6.8 多人并发编辑（乐观锁 + 版本史 + 预警 + 冲突弹层）

**场景**：用户 A 正在编辑模板 v5，用户 B 也打开了同一模板。

**机制总览**（4 层防护，从轻到重）：

#### 第 1 层：在线提示（社交提示，非强制）

- 编辑器右上角显示**头像列表** = 3 分钟内打开过本模板的用户。
- B 一进入就看到 A 的头像 → 自然意识到"还有人在改，先沟通一下"。
- 数据来源：`template_access_log` 表，前端每 60s 刷新。
- 这是**不强制**的提示，不阻止任何操作。

#### 第 2 层：顶部条幅预警（实时变化感知）

- 编辑器每 30s 静默调用 `GET /templates/:id` 拉最新 version 号（仅 head 字段，不拉完整内容）。
- 发现 `current_version` 已大于本地编辑时记录的版本 → 顶部弹出**黄色条幅**：
  ```
  ⚠ 此模板已被「用户 A」于 2 分钟前更新到 v6。
     [ 查看 A 的修改 ]   [ 保留我的修改继续 ]   [ ✕ 关闭提示 ]
  ```
- B 能在编辑过程中早期发现冲突（30s 内），避免改 30 分钟后才知道。
- 用户点"查看 A 的修改" → 弹层 diff 视图（v6 vs B 进入时的 v5）；不强制中断。

#### 第 3 层：乐观锁保存（数据库强约束）

- `PUT /templates/:id` 请求必须带 `If-Match-Version: <N>` 请求头。
- 服务端：
  ```sql
  -- 原子更新，避免双人同秒提交
  UPDATE templates
     SET current_version = N + 1, updated_at = now()
   WHERE id = ? AND current_version = N
  RETURNING current_version;
  ```
  - `RETURNING` 拿到 N+1 → 接受，同时插入 `template_versions` 一行。
  - 0 行受影响 → 已被他人更新，返回 **409 VERSION_CONFLICT** + 当前最新版本完整内容。

#### 第 4 层：冲突弹层（不让 B 白做工）

服务端返回 409 时，前端**不会丢弃** B 当前内存中的修改，而是弹"冲突解决对话框"：

```
┌─────────────────────────────────────────────────┐
│  ⚠ 模板已被「用户 A」于 2 分钟前更新到 v6        │
│                                                  │
│  ┌──────────────┐    ┌──────────────┐           │
│  │  A 的 v6     │    │  你的修改      │           │
│  │  （已保存）   │    │  （基于 v5）   │           │
│  └──────────────┘    └──────────────┘           │
│                                                  │
│  请选择：                                         │
│   [ 放弃我的修改，刷新到 v6 ]                      │
│   [ 强行覆盖，提交为 v7 ]   ← 默认禁用，见下      │
│   [ 取消，让我先截图再处理 ]                       │
└─────────────────────────────────────────────────┘
```

**"强行覆盖"按钮的反思路设计**：默认禁用，必须先点开"A 的 v6"详情至少看 5 秒（前端埋点 + UX），再启用。避免 B 没看就盖了。

强行覆盖的语义：
- B 内存中的内容（基于 v5）+ B 自己的修改 → 提交为 **v7**。
- A 的 v6 不丢失，永久存在版本历史里。
- 后续如要找回 A 的修改，admin / owner 可走"版本恢复"功能（见 § 7.x）。

#### 版本历史 + 恢复

- 任意用户：可查看模板版本历史列表、任意两版本 diff。
- **Owner + admin**：可执行"恢复到 v6"操作 → 用 v6 的内容创建新版本（如 v8），**不破坏历史**（v7、v6、v5 都还在）。
- 这个"复制旧版本为新版本"的设计保证版本号永远单调递增，任何 PrintJob 引用的版本号永远有效。

#### 总结对比

| 阶段 | 提示形式 | 是否强制 | 用户损失 |
|---|---|---|---|
| 进入编辑器 | 在线头像 | ❌ | 无 |
| 编辑中 30s | 顶部条幅预警 | ❌ | 几乎无（30s 内发现） |
| 保存 | 409 冲突弹层 | ✅ 强制 | 内存修改保留，可选覆盖 |
| 极端情况 | 强行覆盖 | 用户主动 | A 的 v6 进历史，可恢复 |

---

## 7. API 设计

### 7.1 路由树

```
公共
  GET    /auth/lark/login         # 重定向到飞书授权页（生成 state，写入 cookie 防 CSRF）
  GET    /auth/lark/callback      # 飞书 OAuth 回调：code→token→拉用户信息→upsert→签 JWT cookie
  POST   /auth/local/login        # 应急：本地 admin 用户名+密码（仅 emergency_admin 角色可用）
  POST   /auth/logout             # 清 cookie
  POST   /auth/refresh            # JWT refresh

模板管理（JWT）
  GET    /templates                       # 列表（分页 + 搜索 + tag）
  POST   /templates                       # 创建
  GET    /templates/:id                   # 详情（最新版，含 current_version 号）
  GET    /templates/:id/head              # 仅版本号 + 元信息（用于 30s 静默预警轮询，轻量）
  PUT    /templates/:id                   # 更新（必须带 If-Match-Version 请求头，乐观锁）
  DELETE /templates/:id                   # 软删
  GET    /templates/:id/versions          # 版本列表
  GET    /templates/:id/versions/:ver     # 某版本详情
  GET    /templates/:id/versions/diff?from=:v1&to=:v2  # 两版本 diff（结构化）
  POST   /templates/:id/versions/:ver/restore          # 用历史版本创建新版本（owner / admin）
  POST   /templates/:id/preview           # 用示例数据即时预览
  POST   /templates/:id/access            # 记录"打开过编辑器"（用于 presence）
  GET    /templates/:id/presence          # 当前 3 分钟内打开过此模板的用户列表（头像 + 时间）

打印（JWT 或 API Key）
  POST   /print                   # 同步（短任务 < 5s）
  POST   /print/async             # 异步
  GET    /jobs/:id                # 任务状态（支持 ?wait=10 长轮询）
  GET    /files/:id               # 下载产物（签名 URL）

凭证管理（admin）
  GET/POST/DELETE /apikeys
  GET/POST/DELETE /credentials/lark

运维
  GET /healthz
  GET /metrics                    # Prometheus
```

### 7.2 鉴权

**Web 用户（人）**：飞书 SSO 是**正常通道**，本地用户名密码是**应急通道**。

| 通道 | 流程 | 适用 |
|---|---|---|
| **飞书 SSO** | OAuth 2.0 授权码模式 → 服务端签 JWT 写入 httpOnly Secure cookie；CSRF token 双重提交（X-CSRF-Token header） | 所有 Web 用户 |
| **本地应急** | POST `/auth/local/login` username + password，bcrypt 校验，签同样的 JWT cookie | 仅角色 = `emergency_admin` 的本地账号，飞书不可用时使用 |

**JWT 内容**：
```json
{ "sub": "<users.id>", "role": "admin|user|emergency_admin",
  "iat": ..., "exp": ... }
```

**有效期**：24h；refresh token 30d，存数据库 `refresh_tokens` 表（含 hash + revoked_at）。

**外部系统调用**：API Key (`apk_xxx`)。Key 落库存 bcrypt hash，明文仅创建时一次性弹层显示 + 复制。携带：`Authorization: Bearer apk_xxx`。

**API Key scope**（4 个细粒度，可组合）：
- `templates:read` — 只读模板（列表 / 详情 / 版本）
- `templates:write` — 创建 / 修改 / 删除模板
- `print:execute` — 调用 `/print` 和 `/print/async`
- `lark:credentials:use` — 使用预存飞书凭证打印（无此 scope 则只能 `download` destination）

### 7.2.x 飞书 SSO 详细流程

```
[用户访问 https://print.your-company.com]
       ↓
中间件检查 JWT cookie
       ↓ 无 / 过期
重定向到 GET /auth/lark/login
       ↓
服务端：
  1. 生成随机 state，写入 short-lived cookie（5min，HttpOnly+SameSite=Lax）
  2. 302 → https://accounts.feishu.cn/open-apis/authen/v1/index
            ?app_id=<LARK_APP_ID>
            &redirect_uri=https://print.your-company.com/auth/lark/callback
            &state=<state>
       ↓
飞书侧用户授权 → 302 回 /auth/lark/callback?code=xxx&state=xxx
       ↓
GET /auth/lark/callback
  1. 校验 state cookie == 查询参数 state（CSRF 防护）
  2. POST 飞书 /open-apis/authen/v1/oidc/access_token  ← code → user_access_token
  3. GET  飞书 /open-apis/authen/v1/user_info          ← 拉 open_id/union_id/name/email/avatar_url
  4. upsert users (lark_open_id 为业务主键)：
     - 不存在 → 创建（role 默认 'user'，但若 lark_user_id 在 INITIAL_ADMIN_LARK_USER_IDS 则 'admin'）
     - 存在 → 更新 name/email/avatar_url/last_login_at
  5. 生成 JWT + refresh token，写 httpOnly cookie
  6. 清 state cookie
  7. 302 回 原始来源（来自 ?continue= 参数，校验同源）
```

### 7.2.y 飞书工作台入口（P0）

- 飞书自建应用后台填 `home_url = https://print.your-company.com`（用户在飞书侧栏点应用图标 → 在飞书 webview 中打开此 URL）。
- 应对 webview 嵌入：
  - 所有 cookie 设 `SameSite=None; Secure`（webview iframe 跨域请求需要）
  - 响应头 `Content-Security-Policy: frame-ancestors 'self' https://*.feishu.cn https://*.larksuite.com`
  - 不假设 `window.opener`、`window.parent` 存在
- 用户在飞书内打开 → 走相同的 SSO 流程 → 由于已在飞书登录，无感跳转。

### 7.3 打印接口：`POST /print`

**核心抽象：`output.destination` 是可扩展枚举**。MVP 支持 `download` 和 `lark`。

#### 请求（普通下载）

```json
{
  "templateId": "tpl_01HXYZ...",
  "data": {
    "tihuoDanwei": "运易科技",
    "tihuoRen": "朱仏多",
    "pinming": "网经设备",
    "shuliang": 3,
    "date": "2026-07-12"
  },
  "output": {
    "format": "pdf",
    "destination": { "type": "download" }
  },
  "options": {
    "fileName": "出门证-0004917.pdf"
  }
}
```

#### 响应（200 OK）

```json
{
  "ok": true,
  "jobId": "job_01HXYZ...",
  "file": {
    "id": "file_01HXYZ...",
    "url": "/files/file_01HXYZ...?sig=xxx&expires=1716300000",
    "size": 124356,
    "mimeType": "application/pdf"
  }
}
```

#### 请求（飞书回写）

```json
{
  "templateId": "tpl_01HXYZ...",
  "data": { ... },
  "output": {
    "format": "pdf",
    "destination": {
      "type": "lark",
      "lark": {
        "credentialId": "cred_lark_001",
        "appToken": "bascn_xxx",
        "tableId":  "tblxxx",
        "recordId": "recxxx",
        "fieldName": "出门证文件"
      }
    }
  }
}
```

#### 响应

```json
{
  "ok": true,
  "jobId": "job_xxx",
  "lark": {
    "fileToken": "boxbnxxx",
    "recordUpdated": true,
    "fieldName": "出门证文件"
  }
}
```

### 7.4 异步打印：`POST /print/async`

**触发条件**（任一满足走异步）：
- `data` 是数组（批量，P1）
- 预计页数 > 5
- 调用方显式传 `async: true`

#### 响应（202 Accepted）

```json
{
  "ok": true,
  "jobId": "job_xxx",
  "statusUrl": "/jobs/job_xxx",
  "estimatedSeconds": 12
}
```

#### 任务状态 `GET /jobs/:id`

```json
{
  "id": "job_xxx",
  "status": "queued|running|succeeded|failed",
  "progress": 0.45,
  "result": null,
  "error": null,
  "createdAt": "...",
  "finishedAt": null
}
```

#### 长轮询 `GET /jobs/:id?wait=10`

服务端最多挂起 10 秒等待状态变化。状态变化时立即返回；超时返回当前快照。调用方体感"几乎实时"。

### 7.5 错误响应

```json
{
  "ok": false,
  "error": {
    "code": "DATA_VALIDATION_FAILED",
    "message": "数据校验未通过",
    "fieldErrors": [
      { "path": "tihuoDanwei", "code": "REQUIRED", "message": "提货单位必填" },
      { "path": "shuliang", "code": "TYPE_MISMATCH", "message": "应为 number，收到 string" }
    ]
  }
}
```

**HTTP 状态码**：

| 码 | 场景 |
|---|---|
| 200 | 同步成功 |
| 202 | 异步入队 |
| 400 | 数据 / 参数错误 |
| 401 / 403 | 未认证 / 无权限 |
| 404 | 资源不存在 |
| 429 | 限流 / 渲染池满 |
| 500 | 服务端错（隐藏细节） |
| 502 | 飞书上游错（含上游摘要） |

**典型错误码**：`TEMPLATE_NOT_FOUND` / `DATA_VALIDATION_FAILED` / `RENDER_TIMEOUT` / `LARK_AUTH_FAILED` / `LARK_FIELD_NOT_FOUND` / `LARK_RECORD_NOT_FOUND` / `RATE_LIMITED` / `RENDER_POOL_FULL` / `VERSION_CONFLICT`（保存模板时版本号不匹配，详见 § 6.8）。

### 7.x 模板编辑的乐观锁请求头

`PUT /templates/:id` 必须带 `If-Match-Version: <N>`。`N` 是客户端进入编辑器时拿到的 `current_version`。

**冲突响应（409 VERSION_CONFLICT）**：
```json
{
  "ok": false,
  "error": {
    "code": "VERSION_CONFLICT",
    "message": "模板已被他人更新",
    "details": {
      "expectedVersion": 5,
      "currentVersion": 6,
      "currentVersionContent": { /* v6 完整内容，供前端 diff */ },
      "lastUpdatedBy": { "id": "user_xxx", "name": "用户 A" },
      "lastUpdatedAt": "2026-05-21T10:32:00Z"
    }
  }
}
```

**版本恢复响应（POST /templates/:id/versions/:ver/restore）**：
- 内部实现：拷贝 v6 的 `content_json` + `schema_json` → 创建一个新版本（如 v8）。
- 不破坏历史：v7 / v6 / v5 都保留。
- 权限：仅 `templates.owner_id == 当前用户` 或 `role == admin` 通过；否则 403。

### 7.6 飞书回写流水线

```
[POST /print]
  ↓
 1. API Key 鉴权 + scope 检查
 2. 加载模板 + 用 schema 校验 data（缺字段/类型错 → 400 DATA_VALIDATION_FAILED）
 3. 加分布式锁 lock:(appToken, tableId, recordId, fieldName)   ← 防并发覆盖
 4. 走渲染池：Puppeteer headless → PDF buffer
 5. 飞书 SDK 流程：
    a. tenant_access_token   ← credentialId（90min 缓存）
    b. POST /open-apis/drive/v1/medias/upload_all   → file_token
    c. PATCH /open-apis/bitable/v1/.../records/:recordId
       { fields: { "出门证文件": [{ "file_token": "xxx" }] } }
 6. 写入 PrintJob 表（含 file_token、record 操作日志）
 7. 释放锁 → 同步返回（或 P1 触发 webhook）

失败时：3 次指数退避重试（仅对幂等步骤 b、c）
```

### 7.7 限流

- 默认每 API Key 60 req/min（可配）。
- 每 IP 100 req/min（防滥用）。
- 渲染池满时直接返回 429 + `Retry-After`。

---

## 8. 后端架构

### 8.1 容器拓扑

```
┌─────────────────────────────────────────────────────────────┐
│                        Docker Compose                        │
│                                                              │
│  ┌────────────┐    ┌────────────────┐    ┌────────────────┐ │
│  │   Nginx    │ →  │   API Server   │ →  │  Render Worker │ │
│  │ (静态+反代) │    │   (NestJS)     │    │  (Puppeteer)   │ │
│  └────────────┘    └────────┬───────┘    └────────┬───────┘ │
│                             │                      │         │
│                             ↓                      ↓         │
│                     ┌───────────────┐   ┌──────────────┐    │
│                     │  PostgreSQL   │   │    Redis     │    │
│                     └───────┬───────┘   └──────────────┘    │
│                             │                                │
│                             ↓                                │
│                     ┌───────────────┐                        │
│                     │  Files (本地)  │                        │
│                     └───────────────┘                        │
└─────────────────────────────────────────────────────────────┘
```

### 8.2 为什么 API 和 Render Worker 分两个容器

- Puppeteer + Chromium 内存占用大（每个 Chrome 实例 ~150MB），需独立 OOM 边界。
- 渲染池可独立水平扩展（业务负载和渲染负载不同步）。
- Chromium 偶尔崩溃 → 只重启 worker 容器，API 不受影响。

### 8.3 API Server 模块（NestJS）

```
src/
├── auth/                # JWT + API Key
├── templates/           # 模板 CRUD + 版本
├── print/               # 同步/异步打印入口、调度
├── jobs/                # 任务状态查询、长轮询
├── files/               # 文件签名 URL、下载
├── credentials/         # 飞书凭证（AES-256-GCM 加密存储）
├── lark/                # 飞书 SDK 封装：token / upload / patch record
├── render-client/       # 渲染 worker 通信：同步走 Redis Pub/Sub 请求-响应，异步入 BullMQ 队列
└── common/              # 限流、统一错误、Pino 结构化日志
```

### 8.4 Render Worker

- 独立 Node 进程（非 NestJS，BullMQ consumer）。
- 启动时初始化 Puppeteer 池：N=4 个 browser × M=2 个 page = 8 并发槽位。
- 任务流：从 Redis 拉任务 → 加载模板 HTML（经本地 Vue SSR）→ Puppeteer 渲染 → 输出 buffer → 写文件存储 → 标记 job 完成。
- 同步打印：用 Redis Pub/Sub 短路径，p95 < 2s。

### 8.5 数据模型

```
users                       (id,
                             lark_open_id    UNIQUE NOT NULL,    -- 业务主键
                             lark_union_id,
                             lark_user_id,
                             name, email, avatar_url,            -- 每次 SSO 同步飞书
                             role,                                -- admin | user | emergency_admin
                             local_username  UNIQUE NULL,         -- 仅 emergency_admin 有
                             local_password_hash NULL,            -- bcrypt
                             must_change_password BOOLEAN,        -- 首次登录强制改
                             last_login_at, created_at)
refresh_tokens              (id, user_id, token_hash, expires_at, revoked_at, created_at)
templates                   (id, name, name_pinyin, description, current_version, tags[],
                             owner_id, deleted_at, created_at, updated_at)
                             -- name_pinyin: 用 pinyin 库生成，支持 B6 拼音搜索
template_versions           (id, template_id, version, content_json, schema_json,
                             created_by, created_at)                  -- append-only
api_keys                    (id, key_hash, name, scopes[], rate_limit,
                             created_by, last_used_at, revoked_at)
lark_credentials            (id, name, app_id, app_secret_encrypted,
                             created_by, created_at)
print_jobs                  (id, template_id, template_version, data_json, output_json,
                             status, progress, result_json, error_json,
                             created_by_user, created_by_apikey,
                             created_at, started_at, finished_at, retention_until)
files                       (id, job_id, mime_type, size, storage_path,
                             sig_secret, created_at, expires_at)
sequences                   (id, name, current_value, updated_at)     -- 自动递增编号
print_audit_log             (id, job_id, action, target, payload_summary, created_at)
template_access_log         (id, template_id, user_id, opened_at)     -- 编辑器打开记录，用于 presence
                                                                       -- 索引 (template_id, opened_at DESC)
```

**关键约束**：

- `lark_credentials.app_secret_encrypted`：AES-256-GCM 加密，密钥从 env `MASTER_KEY` 派生。DB 落库不见明文。
- `template_versions`：append-only。删除模板只软删 `templates.deleted_at`，版本表保留以便已发出的 PrintJob 仍能溯源到当时的模板内容。
- `print_jobs.retention_until`：默认 +24h。过期清理 job 行但保留 audit log（轻量）。
- `sequences`：用 `SELECT FOR UPDATE` 加行锁，保证并发自增不漏号。
- `templates.current_version`：保存时用 `UPDATE ... WHERE current_version = ?` 原子更新，影响行数 = 0 即为乐观锁冲突（见 § 6.8、§ 7.x）。
- `template_access_log`：保留 7 天后由后台任务清理。presence 查询只取 `opened_at > now() - 3 minutes`。
- `users.lark_open_id`：唯一非空索引；本地应急 admin 仍占一行，但 lark_open_id 设为占位（如 `local_emergency_<id>`），以维持 schema 一致。
- `users.role`：枚举 `admin | user | emergency_admin`。`emergency_admin` 只能通过本地登录，不能通过飞书 SSO 创建。
- `refresh_tokens`：token_hash 用 SHA-256（refresh token 是高熵随机串，不需要 bcrypt）；定期清理 expires_at < now() - 7d 的记录。

### 8.6 渲染池配置

| 参数 | 默认值 | 说明 |
|---|---|---|
| `RENDER_BROWSERS` | 4 | Chromium 进程数（≈ vCPU - 1） |
| `RENDER_PAGES_PER_BROWSER` | 2 | 每进程 page 数 |
| `RENDER_PAGE_TIMEOUT` | 30s | 单次渲染超时 |
| `RENDER_QUEUE_DEPTH_MAX` | 100 | 队列上限，超出返回 429 |
| `RENDER_BROWSER_RESTART_AFTER` | 200 jobs | 处理 N 个任务后重启，避免内存泄漏 |
| `RENDER_WARMUP` | true | 启动时跑一次空白渲染预热 |

### 8.7 文件存储

- **MVP**：本地磁盘 `/var/app/files/{yyyy}/{mm}/{dd}/{fileId}.pdf`。
- **签名 URL**：`/files/:id?sig=<hmac(secret, id+expires)>&expires=<ts>`，默认有效期 1h。
- **抽象接口** `FileStorage { put, get, sign, delete }`，P1 加 S3/OSS/Minio 实现，env 切换。

### 8.8 配置与 secrets

所有敏感配置走 env，**绝不进 repo**：

```
# 核心密钥
MASTER_KEY                       # 飞书凭证加密用主密钥（32 字节十六进制）
JWT_SECRET                       # JWT 签名
FILE_SIG_SECRET                  # 文件签名 URL

# 存储
DATABASE_URL                     # postgres://...
REDIS_URL                        # redis://redis:6379

# 飞书 SSO（Web 用户登录用，自建应用）
LARK_SSO_APP_ID                  # cli_xxx
LARK_SSO_APP_SECRET              # 自建应用的 app_secret
LARK_SSO_REDIRECT_URI            # https://print.your-company.com/auth/lark/callback
INITIAL_ADMIN_LARK_USER_IDS      # 逗号分隔的飞书 user_id；这些人首次登录自动 admin

# 飞书 API（飞书回写用，与 SSO 应用可同可不同；多 credential 用 DB 的 lark_credentials）
LARK_API_BASE                    # 默认 https://open.feishu.cn

# 本地应急 admin
INITIAL_ADMIN_LOCAL_USERNAME     # 默认 emergency_admin
INITIAL_ADMIN_LOCAL_PASSWORD     # 随机生成；首次登录强制改

# 渲染池
RENDER_BROWSERS                  # 4
RENDER_PAGES_PER_BROWSER         # 2
```

启动时校验：缺一个就 fail-fast（启动失败 + 明确日志）。

---

## 9. 部署与 CI/CD

### 9.1 仓库结构（GitHub monorepo）

```
template-printing/
├── apps/
│   ├── web/                # Vue 3 前端
│   ├── api/                # NestJS 后端
│   └── render/             # Puppeteer worker
├── packages/
│   ├── template-renderer/  # 前后端共用渲染组件
│   ├── schema/             # 共享 zod schema（API 契约 + 模板 schema）
│   └── types/              # 共享 TS 类型
├── .github/workflows/
│   ├── ci.yml              # PR 触发：lint + 测试
│   └── deploy.yml          # main 推送 → 阿里云部署
├── docker/
│   ├── web.Dockerfile
│   ├── api.Dockerfile
│   └── render.Dockerfile   # 含 Chromium + 思源黑体 / 思源宋体
├── deploy/
│   ├── docker-compose.prod.yml
│   ├── nginx.conf
│   └── scripts/
│       ├── deploy.sh
│       ├── healthcheck.sh
│       └── rollback.sh
└── docker-compose.dev.yml
```

### 9.2 CI/CD 流程

```
[开发机] git push origin main
           ↓
[GitHub Actions deploy.yml]
    │
    ├── job: test            (并行 lint + unit + integration + 渲染保真)
    ├── job: build-images    (依赖 test)
    │   ├─ build web.Dockerfile  → web:<sha7>
    │   ├─ build api.Dockerfile  → api:<sha7>
    │   └─ build render.Dockerfile → render:<sha7>
    └── job: deploy          (依赖 build)
        ├─ push 镜像到 阿里云 ACR
        ├─ ssh deploy@aliyun-ecs (用 GitHub Secret 中的私钥)
        │  └─ 执行 deploy/scripts/deploy.sh <sha7>
        │     ├─ docker compose pull                       # 先拉新镜像
        │     ├─ docker compose run --rm api npm run db:migrate   # 用新镜像跑 migrate
        │     ├─ docker compose up -d --remove-orphans
        │     ├─ healthcheck.sh 探 /healthz 最多 60s
        │     ├─ 失败 → rollback.sh (回到上一个 sha tag + 反向 migrate)
        │     └─ 成功 → docker image prune -f
        └─ 飞书 / Slack 通知
```

### 9.3 关键决策

| 项 | 决策 |
|---|---|
| 镜像仓库 | **阿里云容器镜像服务 ACR**（个人版免费，ECS 内网拉取速度快） |
| 部署策略 | **Recreate**（接受 5-15s 中断，MVP 阶段够用） |
| 分支策略 | **GitHub Flow**：`main` 永远可部署 + `feature/*` PR |
| 镜像 tag | `<git-sha7>` + `latest`。回滚 = `IMAGE_TAG=<previous> docker compose up -d` |
| 数据库迁移 | 部署脚本中 `docker compose up` 之前先跑 migrate；失败不部署 |
| 健康检查 | `/healthz` 60s 不通 → 自动回滚 |
| 环境 | MVP 只 prod（P1 加 staging） |

### 9.4 阿里云 ECS 准备

| 项 | 推荐 |
|---|---|
| 实例规格 | ecs.c7.xlarge（4 vCPU / 8 GB）起步 |
| 系统盘 | 100 GB ESSD |
| 系统 | Ubuntu 22.04 LTS |
| 区域 | 按用户主体所在地（华北 2 / 华东 1） |
| 安全组 | 22 (SSH 限 IP) / 80 / 443，拒绝其他公网入站 |
| 域名 + 备案 | **路径 2**：公司主体购买域名 + 阿里云一键备案，**与开发并行启动**（2-3 周）。备案期间用 IP 内部测试，上线前完成。飞书 SSO 强制要求 HTTPS 公网域名。 |
| HTTPS | Let's Encrypt + certbot 容器 + 自动续期 |
| 数据库备份 | 每日 cron `pg_dump` → 阿里云 OSS（保留 30 天） |
| 日志 | docker logs + logrotate（MVP）；P1 接 Loki |
| 监控 | 阿里云云监控 + Prometheus `/metrics` |

### 9.5 安全要求

- SSH 关闭密码登录，只用 key。
- root 用户禁登；部署用专用 `deploy` 用户（带 sudo 限定 docker 命令）。
- 服务器上 `.env` 文件权限 600，owner = deploy。
- GitHub Secrets 存放：`ALIYUN_ACR_USERNAME` / `ALIYUN_ACR_PASSWORD` / `ECS_SSH_PRIVATE_KEY` / `ECS_HOST` / `MASTER_KEY` / `JWT_SECRET` / `FILE_SIG_SECRET` / `DATABASE_URL` / `REDIS_URL` / `LARK_SSO_APP_ID` / `LARK_SSO_APP_SECRET` / `LARK_SSO_REDIRECT_URI` / `INITIAL_ADMIN_LARK_USER_IDS` / `INITIAL_ADMIN_LOCAL_PASSWORD`。

### 9.6 资源建议（容器共享宿主机资源，非独占）

| 服务 | 平均负载 | 峰值 | 内存 |
|---|---|---|---|
| API | < 1 vCPU | 2 vCPU | 1 GB |
| Render × 2 副本 | 0.5 vCPU（空闲）/ 1.5 vCPU（渲染中） | 3 vCPU/each | 1.5 GB/each |
| PostgreSQL | < 0.5 vCPU | 1.5 vCPU | 1.5 GB |
| Redis | < 0.2 vCPU | 0.5 vCPU | 256 MB |

`ecs.c7.xlarge` (4 vCPU / 8 GB) 满足 MVP 期日常使用；并发渲染峰值约 8 路同时（受 `RENDER_BROWSERS × RENDER_PAGES_PER_BROWSER` 限制），CPU 短期跑满可接受。业务上来后纵向扩到 `c7.2xlarge`（8 vCPU / 16 GB），或横向加一台 ECS 专门跑 render worker。

---

## 10. 测试与质量

| 类型 | 工具 | 范围 |
|---|---|---|
| 单元测试 | Vitest（前端） + Jest（后端） | 核心模块覆盖率 > 70% |
| 集成测试 | supertest + testcontainers PG | 每个 API 路由端到端；飞书用 nock 录制 fixture |
| 渲染保真 | Puppeteer 截图 + pixelmatch | 10 个标准模板，每次 release 与基准图 diff（> 0.5% 报警） |
| 负载测试 | k6 | 50 并发 × 60 秒 PDF 生成，要求 p95 < 3s |
| 安全 | npm audit + Snyk | 依赖扫描 |
| 模板内容 XSS | 渲染时强转义 | 用户提供的模板内容不直接 innerHTML |
| CI | GitHub Actions | lint + 单测 + 集成测 + 渲染保真 + Docker 构建 |

### 10.1 观测

- **日志**：Pino 结构化 JSON → stdout，由 docker logs 收集，logrotate 切分。
- **Metrics**：`/metrics` 暴露 Prometheus 格式。
- **关键告警**（阿里云云监控规则）：
  - 渲染池满 > 1 分钟
  - 队列深度 > 50
  - 飞书 5xx 率 > 5%
  - CPU > 85% 持续 5 分钟
  - 磁盘剩余 < 10%

---

## 11. 路线图

### P0 (MVP) — 预计 7-9 周（含飞书 SSO + 工作台入口 + 搜索 A++ 的额外工作量）

| 周 | 里程碑 |
|---|---|
| W1-2 | 基础设施：pnpm + turborepo 仓库初始化、CI 骨架、Docker 化、PG/Redis 接入、Prisma 初始化、域名备案启动 |
| W2-3 | 鉴权：飞书 SSO 完整链路（含飞书工作台 webview 适配 + 本地应急 admin + JWT cookie + CSRF）|
| W3-4 | 设计器：栅格画布 + 元素拖拽 + 选中态 + 8 类元素 |
| W4-5 | 模板中心：CRUD + 版本历史 + 预览 + 字段管理 + 乐观锁冲突弹层 + 在线 presence + 搜索 A++（多词+加权+pg_trgm+拼音+字段反查+历史/热词） |
| W5-6 | 渲染池：Puppeteer worker + Vue SSR + PDF/PNG |
| W6-7 | API：同步打印 + 长轮询 + 飞书回写（独立 lark_credentials 配置） |
| W7-8 | 部署：阿里云 ECS 上线 + 域名备案完成 + 飞书自建应用上线 + CI/CD 通流 + 联调 |

### P1 — MVP 上线后 4-6 周

- 批量打印（data 数组 + 进度条 + 下载 ZIP）
- 多联次（同一模板印 N 份，每份可有差异）
- Webhook 推送
- Staging 环境
- 标签型模板支持
- 文件存储抽象到 S3/OSS

### P2 — 远期

- 直连物理打印机的客户端中间件
- 多人协作编辑
- 模板市场
- 多租户隔离

---

## 12. 风险与开放问题

| 风险 | 影响 | 缓解 |
|---|---|---|
| Puppeteer 在 Docker 中字体渲染异常 | 中文模板乱码 | 镜像内置思源黑体 / 思源宋体；CI 跑渲染保真测试 |
| 飞书 API 限流 | 批量回写失败 | 单租户 50 QPS 内不会触限；批量场景串行化 + 重试 |
| 阿里云 ECS 单点故障 | 服务中断 | MVP 可接受；P2 上多可用区 + RDS |
| 用户传错 schema 导致模板用不了 | 已保存模板渲染失败 | schema 变更兼容性校验（type 变更需新版本，新增字段为可选） |
| 大模板（元素 > 200）设计器卡顿 | 体验差 | 已设计：元素数 > 500 时切换动画降级为淡入淡出 |
| 备案周期长 | 上线延迟 | 备案与开发并行启动，预留 3 周 |

### 开放问题（实施期决定）

- **Vue 渲染组件做 SSR 的具体方案**：`@vue/server-renderer` 还是 Vite SSR？需在 W5 渲染池开工前确定。
- **HTML 中文断字 / 换行规则**：CSS `word-break` 默认值需基于真实样本调整。
- **Token 缓存粒度**：飞书 `tenant_access_token` 是否要每个 `appId` 一份独立缓存（如果多个 credentialId 共用同一 appId）。

---

---

## 13. 实施约定（决策汇总）

### 13.1 工程骨架

| 项 | 决策 |
|---|---|
| 包管理 | **pnpm workspace**（节磁盘 + 快） |
| 任务编排 | **turborepo**（构建缓存 + 任务图） |
| Node 版本 | **20 LTS**，`.nvmrc` + `package.json engines.node ">=20.10"` |
| CI Node | 同上，GitHub Actions matrix 锁定 |

### 13.2 数据库

| 项 | 决策 |
|---|---|
| 迁移工具 | **Prisma Migrate**，CI 跑 `prisma migrate deploy` |
| 回滚策略 | **写正向 migration 回滚**（不依赖 down，Prisma 官方做法） |
| 时区 | DB / API 全 **UTC**；前端按浏览器本地时区展示；模板 `system.now` 按 env `TZ=Asia/Shanghai` 渲染 |
| 字符集 | UTF-8 |

### 13.3 鉴权

| 项 | 决策 |
|---|---|
| Web 鉴权 | 飞书 SSO（自建应用，OAuth 2.0）+ httpOnly cookie JWT + CSRF token |
| 应急通道 | 本地 admin 用户名密码 `/auth/local/login`（仅 `emergency_admin` 角色） |
| 工作台入口 | P0 做：飞书后台配 `home_url`，cookie SameSite=None+Secure，CSP frame-ancestors 允许 feishu.cn |
| API Key | scope 化（`templates:read/write`、`print:execute`、`lark:credentials:use`） |
| Key 显示 | 创建时一次性弹层，列表只显前 8 位 + revoke |

### 13.4 模板与搜索

| 项 | 决策 |
|---|---|
| 模板权限 | 全员可看可用；owner + admin 可改 / 删 / 恢复版本 |
| 搜索 | **A++**：多词分割 + 字段加权 + `pg_trgm` 错别字容错 + 拼音搜索 + 字段反查 (`#fieldKey`) + 历史/热词 + tag chip + 高亮 |
| 资源限制 | 模板 JSON ≤ 256 KB / 图片 ≤ 5 MB / data ≤ 1 MB / PDF ≤ 50 MB；超出 413 |
| schema 兼容性 | 新增可选字段 ✓ / 删除字段 ⚠ 警告但允许（已发 PrintJob 锁旧版本）/ 字段 type 变更必须新模板 |

### 13.5 前端

| 项 | 决策 |
|---|---|
| 框架 | Vue 3 + TS + Pinia |
| UI | Element Plus + CSS variable 覆盖飞书风（不引 Tailwind） |
| 拖拽 | 自研（栅格吸附 + 双区域 hit-zone 是定制需求，库不好套） |
| 日期 | dayjs |
| 数字格式 | numeral |
| 二维码 | qrcode-generator |
| 条形码 | bwip-js（多 symbology） |
| 拼音 | pinyin（前后端共用，纯 JS） |

### 13.6 后端

| 项 | 决策 |
|---|---|
| 框架 | NestJS |
| ORM | Prisma |
| 飞书 SDK | **@larksuiteoapi/node-sdk**（官方 SDK） |
| 飞书区域 | MVP 仅国内 `open.feishu.cn`；P1 加 `Credential.region` 支持国际版 |
| Vue SSR | `@vue/server-renderer`（不引 Nuxt） |
| Token 缓存 | 按 `appId` 缓存（不按 credentialId）—— 多 credential 共用同一 app 时不浪费 token quota |
| 日志 | Pino → stdout |
| 任务队列 | BullMQ |

### 13.7 API 约定

| 项 | 决策 |
|---|---|
| 路径版本 | **不加 `/v1`**（YAGNI，将来加 `/v2` 即可） |
| API 文档 | `@nestjs/swagger` 自动生成，`/api/docs` |
| 错误响应 | 统一 `{ ok:false, error:{code,message,...} }` |
| HTTP 状态 | 200/202/400/401/403/404/409/413/429/500/502 |

### 13.8 测试

| 项 | 决策 |
|---|---|
| 单测 | Vitest（前）/ Jest（后） |
| 覆盖率门槛 | **核心模块** (auth/templates/print/lark) ≥ 70%；其他不卡死 |
| 集成 | supertest + testcontainers PG；飞书用 nock 录制 fixture |
| E2E | Playwright，5 个关键场景：登录 / 创建模板 / 保存（含冲突） / 打印拿 PDF / 飞书回写 |
| 渲染保真 | Puppeteer 截图 + pixelmatch，10 标准模板，阈值 0.5% |

### 13.9 XSS / 安全细节

| 项 | 决策 |
|---|---|
| 文本插值 | 走 Vue 默认插值（自动转义） |
| 图片 URL | 仅允许 `http://` `https://` 协议；禁 `javascript:` `data:` |
| 用户上传图片 | 走后端代理（避免外链泄漏 referer + 防引外部脚本） |
| Cookie | httpOnly + Secure + SameSite=None（工作台 webview 兼容） |
| CSP | frame-ancestors 限 feishu.cn / larksuite.com；其它 'self' |

### 13.10 运维 / 工程礼仪

| 项 | 决策 |
|---|---|
| Commit message | Conventional Commits（feat/fix/chore/docs/refactor/test 等 + scope） |
| 分支策略 | GitHub Flow：main + feature/* + PR 必 review |
| PR 模板 | `.github/PULL_REQUEST_TEMPLATE.md`，含变更/测试/截图 |
| 代码风格 | ESLint + Prettier + lint-staged + husky pre-commit；CI 同步跑 |
| 依赖更新 | Dependabot 每周 PR，安全立刻合 |
| 日志保留 | docker logs 7 天 + logrotate；审计日志（飞书回写、API Key 使用、登录）库内 90 天 |
| 告警 | **飞书自定义机器人 webhook** 推到运维群 |
| 头像 | 飞书侧 avatar_url 直接用，0 上传 |
| 用户初始化 | 飞书 SSO 自动 upsert；初始 admin 通过 env 指定 lark_user_id；本地应急 admin 通过 env 指定密码（首次登强制改） |

---

**评审通过后**：本文档冻结为 spec 基线。后续修改需提 ADR（Architecture Decision Record）。下一步交由 writing-plans skill 生成实施计划。
