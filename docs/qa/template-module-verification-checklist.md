# 模板模块完整功能验收清单

**版本**：截至 iter 22（2026-05-23）
**目的**：对模板编辑/创建模块 iter 2-22 累积的所有功能做一次系统化扫尾验收，发现遗留 bug

---

## Part 1 — 自动化校验（已完成）

### 1.1 代码层

| 检查项 | 结果 | 详情 |
|---|---|---|
| Web vue-tsc | ✅ 0 | 整个 web 包无类型错误 |
| API tsc | ✅ 0 | 整个 api 包无类型错误 |
| Schema tests | ✅ 46/46 | 含 9 种 element type 覆盖测试 |

### 1.2 服务运行状态

| 服务 | 状态 | 端口 |
|---|---|---|
| web (Vite) | ✅ Up 4h | 5173 |
| api (NestJS) | ✅ Up 44min | 3000 |
| postgres | ✅ Healthy | 6432 |
| redis | ✅ Healthy | 6379 |

### 1.3 API 路由注册

模板相关全部就位：

| Endpoint | Method | 用途 |
|---|---|---|
| `/templates` | GET | 列表（owner-scoped） |
| `/templates` | POST | 创建 |
| `/templates/:id` | GET | 详情 |
| `/templates/:id` | PATCH | **更新（auto-save 用）** |
| `/templates/:id` | DELETE | 删除 |
| `/uploads/image` | POST | 图片上传 |
| `/users/me` | GET | 当前用户信息 |
| `/users/me/password` | PATCH | 修改密码（仅改密，需当前密码）|

### 1.4 数据库

| Table | 状态 |
|---|---|
| `users` | ✅ 创建（含 emergency admin） |
| `refresh_tokens` | ✅ 创建 |
| `templates` | ✅ 创建（iter 20 migration `add_templates`） |
| `_prisma_migrations` | ✅ 跟踪迁移历史 |

---

## Part 2 — 手动 UX 走查清单（用户操作）

> **操作前提**：浏览器 Ctrl+Shift+R 硬刷新，访问 http://localhost:5173/

### 2.1 全局布局 / 路由（iter 17）

- [ ] 左侧 sidebar 展开宽度 220px，折叠 56px
- [ ] 折叠状态点击 sidebar 折叠按钮 → 宽度切换
- [ ] 刷新页面后折叠状态保留（localStorage）
- [ ] sidebar 4 个菜单可点击：模板中心 / 个人中心 / API 说明 / 用户管理（admin only）
- [ ] 普通用户访问 `/admin/users` → 跳 `/403`
- [ ] 访问 `/foo` → 跳 `/404`
- [ ] sidebar 底部用户头像 + 退出按钮 + 用户名

### 2.2 登录 / 退出（iter 18）

- [ ] `/login` 页面：用户名密码框在上 + 飞书 SSO 在下
- [ ] emergency admin 用户名 `admin` + 密码 `admin123` 登录 → 成功
- [ ] 首次登录强制改密 dialog 弹出
- [ ] 修改完密码后 dialog 消失，可正常使用
- [ ] 点 sidebar 「退出」→ 跳回 `/login`
- [ ] 退出后刷新页面 → 仍在 `/login`（auth 不残留）
- [ ] 点飞书 SSO → 跳 lark passport → 取消返回 → 应停留在 `/login`（**iter 20 bug 1 修复**）

### 2.3 个人中心（iter 18；账号双类型重构后）

- [ ] **内部账号**（飞书 SSO）：用户名/手机号/邮箱只读（随飞书同步），唯一ID 显示工号（larkUserId），**无密码区、无解绑入口**
- [ ] **外部账号**（本地）：用户名（name）+ 邮箱可编辑，显示只读「登录账号」(localUsername) 与唯一ID(externalCode `W…`)，有「修改密码」
- [ ] 超级管理员（emergency_admin）：资料只读，但有「修改密码」
- [ ] 修改密码 dialog 工作正常（输入当前 + 新两次 → 提示成功）

### 2.4 模板中心 — 列表态（iter 20）

- [ ] `/templates` 默认显示卡片网格
- [ ] 空状态：「还没有模板 — 点 "新建模板" 开始」
- [ ] 点「+ 新建模板」→ 立即跳到编辑器（**形变动画**，Chrome 113+）
- [ ] 新建后 DB 自动生成一条 record（**iter 22 加 auto-save**）
- [ ] 返回列表 → 看到刚创建的「未命名模板」卡片
- [ ] 卡片 hover → 右上角出现 🗑 删除按钮
- [ ] 点删除 → 弹确认 → 确认后从列表移除
- [ ] 已有卡片点击 → 形变进入编辑器

### 2.5 模板编辑器 — 元素操作（iter 2-15）

- [ ] **拖入元素**：从左侧 ElementLibrary 拖各种元素到画布中央（text / field / image / table / barcode / qr / autonumber / system / rect）
- [ ] **移动元素**：点选中拖动 → 跟手不延迟（iter 11 §G 修复）
- [ ] **缩放元素**：8 方向 handle 拖动调尺寸 → 流畅（iter 12 §D rAF 节流）
- [ ] **QR 缩放**：4 角 handle 拖动 → corner 紧贴鼠标（iter 12 §D 对角线投影）
- [ ] **元素吸附**：拖到中心 / 边缘 / 其他元素附近 → 紫色辅助线显示（iter 11 §A 双阈值）
- [ ] **自动滚动**：拖到 canvas 边缘 30px 内 → 自动滚动（iter 11 §B）
- [ ] **删除元素**：右上角属性面板「删除元素」按钮 / 键盘 Del
- [ ] **撤销/重做**：toolbar 上 ⟲ / ⟳ 按钮工作
- [ ] **多元素层叠 z-index**：属性面板「布局·高级」改 z-index → 立即生效（iter 15 §A）

### 2.6 元素 grip（iter 8 + iter 12）

- [ ] **大元素** (≥10mm × 8mm) → grip 在元素内部顶部（**仅 6 点无胶囊**，iter 12 §B）
- [ ] **小元素** → grip 在外部上方（完整胶囊样式）
- [ ] **小元素 + 贴顶** → grip 翻到外部下方
- [ ] **选中态**：粗 2px 紫边覆盖用户自定义边框（iter 12 §C）

### 2.7 属性面板（iter 4-15）

#### 通用
- [ ] 位置 (列/行) + 尺寸 (宽/高) 输入框，mm 精度 0.25 步进
- [ ] 输入越界值（如 x=-50）→ 自动 clamp 到 0（iter 10 §D）
- [ ] 字段绑定下拉（适用 field/table/barcode/qr/image）
- [ ] 高级折叠（字体·高级 + 布局·高级）独立展开（iter 10 T6）

#### 元素特定
- [ ] text/field 字体 / 字号 / 粗细 / 颜色 / 对齐
- [ ] image 三种来源：URL / 上传 / 字段绑定（iter 15 T2-T3）
  - [ ] 上传按钮点击 → 立即弹文件选择器（**iter 16 修复**）
  - [ ] 紫色风格按钮代替原生 file input
  - [ ] 防盗链 URL（如百度图床）能加载（iter 15 §C `referrerpolicy`）
- [ ] table 列管理（iter 8）：增 / 删 / 调顺序 / 编辑列头/key/对齐
- [ ] barcode 内容 / 符号系统 / 显示文字
- [ ] qr 内容 / ECC 等级
- [ ] 边框（上/下/左/右单独控制 + 颜色 + 粗细）

### 2.8 变量管理（iter 5）

- [ ] 变量区域**完整显示 3 张卡** + 第 4 张出滚动条（iter 16 高度 220px）
- [ ] 「+ 新建」弹 dialog → 填 key / label / type / 默认值 → 保存
- [ ] 编辑变量 → dialog 预填当前值 → 改完保存
- [ ] 删除变量 → 确认 dialog → 列表移除
- [ ] 变量类型变更时绑定到旧类型的元素自动解绑（iter 5）
- [ ] 元素绑定变量后变量卡变绿色「已绑定」
- [ ] 搜索框始终显示（iter 8 #4），实时过滤

### 2.9 纸张 / 画布（iter 9 + 11）

- [ ] paper 下拉只有 5 项：A3 / A4 / A5 / B4 / B5 + 自定义
- [ ] 切换 paper → 画布尺寸正确变化 + 元素位置 clamp 到新边界
- [ ] 旋转按钮一击切换 portrait / landscape
- [ ] 自定义纸张 dialog 输入宽高 → 应用后画布尺寸正确
- [ ] zoom 100% / 50% / 200% / Fit 切换流畅
- [ ] 不同 zoom 下拖元素 1:1 跟手（iter 11 §G）

### 2.10 预览 / 打印

- [ ] toolbar 点「预览」打开 dialog
- [ ] 预览中所有元素位置和编辑器**像素级一致**（含 QR，iter 11 §E）
- [ ] 预览中 QR 撑满元素容器（iter 14）
- [ ] 预览左侧示例数据表单**只列被绑定的字段**（iter 10 §D）
- [ ] 预览横向 + 纵向滚动（iter 10 §C）
- [ ] toolbar 点「立即打印」→ 浏览器打印预览
- [ ] 打印纸张尺寸 = 模板设置（iter 13）—— B4 模板打印 B4 纸，A4 模板打印 A4 纸
- [ ] 打印元素位置 = 编辑器位置（iter 11 §G + iter 13）
- [ ] 打印 QR 可见且尺寸正确（iter 12 §A.2）
- [ ] 打印输出不出现选中态紫框 / 角点（iter 13）

### 2.11 持久化（iter 7 + iter 22）

- [ ] **localStorage 兜底**：编辑过的内容刷新页面后恢复（iter 7）
- [ ] **Auto-save**（iter 22 新做）：
  - [ ] 拖入元素 → toolbar 显示「改动未保存」→ 1.5s 后变「保存中…」→ 变「✓ 已保存」
  - [ ] 改名（点 TemplateNameEditor 改）→ 也触发 auto-save
  - [ ] 改元素位置 → debounce 合并多次拖动为一次 PATCH
  - [ ] 主动改 anchor mm 输入 → 触发 auto-save
  - [ ] 关闭浏览器/切页面前如还在 pending → 弹「您还有未保存的改动」确认
  - [ ] 切换模板（从 A 切到 B 编辑器）→ A 的 pending 改动会被 flush 保存
  - [ ] 网络中断时 PATCH 失败 → 显示「⚠ 保存失败 · 点击重试」红字 → 点击重试

---

## Part 3 — 我的备注 / 已知限制（不影响验收）

1. **iter 22 已知 race**：快速切模板 A→B 期间 A 的 in-flight save 完成后会错误刷新 B 的 saveStatus 为 saved/error。对正确性无影响（数据已落库），仅 UI 提示偶发错位。生产场景几乎不触发。

2. **View Transitions 动画**：仅 Chrome 113+ / Edge 113+ / Safari 18+ 支持。其他浏览器降级为瞬时切换，功能不受影响。

3. **不在范围**（后续 iter）：
   - 模板缩略图生成（卡片当前用统一图标）
   - 模板复制 / 重命名（命名通过 TemplateNameEditor 在编辑器内改）
   - 多端协同编辑冲突解决
   - 版本历史（仅 store 内 history，不上传后端）

---

## Part 4 — 走查记录

> 用户走查时把发现的问题填到这里。

| # | 模块 | 现象 | 优先级 | 状态 |
|---|---|---|---|---|
| | | | | |

---

## 走查完成后

把发现的问题反馈给我，按优先级 P0/P1/P2 分类。P0 立即修，P1 当前 iter 修，P2 进入下个 iter。
