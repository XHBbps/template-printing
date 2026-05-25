# iter 30D · 实施计划 — 设计器扬力品牌化

**日期**：2026-05-25
**Spec**：[`docs/superpowers/specs/2026-05-25-iter-30-yangli-rebrand-design.md`](../specs/2026-05-25-iter-30-yangli-rebrand-design.md)
**分支**：`feature/iter-30d-designer`

---

## 目标

按 `handoff/target-mockup.html` 与 `handoff/UI_REFACTOR_BRIEF.md` §5.3-5.5 完成设计器（DesignerView + 22 子组件 + designer.css，共 ~4578 行）的扬力品牌化。

30A-30B 已完成的设计器相关工作：
- DesignerHeader 上提到顶部 breadcrumb（4 chip + secondary 保存 + primary 立即打印 + 6px 圆点状态）
- ElementLibrary 数据组重排 + lib-btn border stone + 9 元素图标不动
- TemplateNameEditor 字体对齐 target spec
- tp-panel-head 副标题改 mono caption + 6×6 红方块 ::before
- 变量面板 + 按钮改 28 outline
- designer.css 顶部 `--tp-*` 整体映射到 yangli vars（兼容层）

本轮要做的剩余事项，按 brief 优先级：

---

## T0 — 准备

- 在新分支上 commit 这份 plan
- 先全量 grep 紫色残留：`#6c5ce7 / #6e59f2 / #f0eeff / #4f3fcc / rgba(108,92,231,...) / 5847d4`

## T1 — designer.css 大清理 / 直接消费 yangli vars

兼容映射层在 30A 用于"零侵入"过渡，30D 进入收敛阶段：

- 删除 designer.css 顶部 `:root` 兼容映射块
- 全文 search-replace：
  - `var(--tp-bg)` → `var(--mist)`
  - `var(--tp-panel)` → `var(--paper-white)`
  - `var(--tp-ink)` → `var(--ink)`
  - `var(--tp-ink-soft)` → `var(--yangli-graphite)`
  - `var(--tp-ink-faint)` → `var(--iron)` / `var(--fg-3)`
  - `var(--tp-line)` → `var(--stone)`
  - `var(--tp-line-strong)` → `var(--yangli-graphite)`
  - `var(--tp-accent)` → `var(--yangli-red)`
  - `var(--tp-accent-bg)` → `rgba(211,45,39,0.08)`
  - `var(--tp-accent-ink)` → `var(--yangli-red)`
  - `var(--tp-field-bg)` → `rgba(211,45,39,0.04)`
  - `var(--tp-radius-panel)` / `--tp-radius-btn` / `--tp-radius-item` → `var(--radius-2)`
  - `var(--tp-shadow-*)` → 直接删除（none）
- 全文 search-replace 在 designer/*.vue 中：相同的 token 替换

## T2 — DesignerCanvas 画布区按 brief §5.4

- **背景** `var(--mist)` + **圆点网格**（radial-gradient 1px var(--stone), 12px tile，更冷更工业 vs 当前方点）
- **A4 纸面** `var(--paper-white)` 底 + **1px var(--stone) 描边**，**无 shadow**（当前是浮起卡片感）
- 边缘 30px 自动滚动行为保留

## T3 — 右下浮岛 CanvasFloatingToolbar（cft-bar）

- 容器：`var(--paper-white)` 底 + 1px var(--stone) + var(--radius-2) 4px + 无 shadow
- 按钮：28×28，hover 底 `var(--mist)`
- 缩放百分比文本：`var(--font-mono)`
- 撤销 / 重做 / pan / zoom 等 icon 颜色 `var(--fg-2)`

## T4 — ElementLibrary 分组标题 Eyebrow 模式

- 当前 `.lib-group-title` 10 UPPERCASE，简单文字
- 改为 brief §5.3 Eyebrow 模式：
  - "文字 · Text" / "图形 · Shapes" / "数据 · Data"
  - 11.5px `var(--fg-3)`
  - 右侧延展 1px `var(--stone)` rule
- 元素卡 9 个图标保留现状（用户 30B 已要求保持）

## T5 — CanvasElementsList「画布元素」底部 sticky

按 brief §5.3：
- 底部 sticky 块，1px 上分隔
- 空态：1px **dashed** `var(--stone)` + iron 文字"从上方拖入或点击元素开始设计"

## T6 — FieldManager 变量面板按 brief §5.5

- 变量头：标题 14px semibold + mono caption `0 DECLARED · 共 0 个`
- 搜索框：内嵌放大镜（svg），1px stone，radius 2，focus 边 var(--yangli-red)
- 空态：UPPERCASE eyebrow `No variables · 暂无变量` + 中文说明 + mono 提示 `VAR · {{ NAME }}`
- 变量卡片：保持现有逻辑，token 替换

## T7 — PropertyPanel 属性面板

- 头："属性 · Properties" 标题（与变量面板对称）
- 空态：1px var(--stone) 框 + var(--mist) 底
- 属性表单内容（每种元素类型的 form fields）：仅做品牌化 token 替换，不重做逻辑
- 涉及组件：BarcodeProperties / QrProperties / BorderControl / PaddingControl / SliderWithInput / TableColumnsEditor

## T8 — 选中态 / 交互元件

- CanvasElement 选中态：紫色虚线 → `var(--yangli-red)` 实线 + 4 角 grip
- ElementGrip：grip 颜色对齐 var(--yangli-red)
- SnapGuides / HitZones：紫色硬编码全部换 yangli vars
- BarcodeContentPicker dialog：复用 ElDialog 全局覆盖即可

## T9 — 验收 + PR

- `pnpm exec vue-tsc --noEmit` 0 错
- Vite HMR 全程 0 error
- 浏览器手测：
  - 打开模板进入编辑器
  - 拖入文字 / 字段 / 矩形 / 图片 / 二维码 / 条码 / 明细 — 各元素可创建 + 拖动 + resize
  - 选中元素 → PropertyPanel 显示对应表单 → 改属性
  - 添加变量 / 重命名 / 删除
  - 撤销 / 重做 / pan / zoom
  - 旋转 90°
  - 自定义画布尺寸
  - 预览
  - 立即打印
- grep 验证：apps/web/src/designer 与 styles/designer.css 不再有 `#6c5ce7` / `#f0eeff` / `--tp-*` 残留（除注释外）
- PROGRESS 追加 iter 30D
- commits 拆 3-5 个（按 T1-T8 逻辑）+ docs + PROGRESS
- push + PR #8

---

## Commit 拆分建议

```
1. docs(plans): iter 30D 实施计划
2. refactor(designer): designer.css + designer/*.vue --tp-* → yangli vars 全量替换
3. feat(designer): DesignerCanvas 圆点网格 + A4 纸面无 shadow + 浮岛重做
4. feat(designer): ElementLibrary + CanvasElementsList 按 brief §5.3 重做
5. feat(designer): FieldManager + PropertyPanel 按 brief §5.5 重做
6. fix(designer): CanvasElement 选中态 + grip + snap 残留紫色清扫
7. docs(progress): iter 30D 完成
```

---

## 不在本 PR 范围

- 8 个元素类型的功能逻辑（保持现状）
- 自定义 SVG 渲染 / mm-anchor 计算（与品牌无关）
- TableColumnsEditor 内部 form 逻辑（仅 token 替换）

---

## 风险与回退

- **风险 1**：删除 `--tp-*` 兼容映射后，所有 .vue 引用必须同步替换，遗漏会变 unset → fallback 默认色（多半 inherit / 黑）。**应对**：T1 完成后立即 grep 验证 `--tp-` 出现次数 = 0。
- **风险 2**：CanvasElement 选中态颜色硬编码紫色多处（z-index 计算 / 拖拽预览）。**应对**：grep `6c5ce7` 一次定位所有。
- **风险 3**：PropertyPanel 920 行体量，token 替换不彻底容易遗漏。**应对**：依赖 vue-tsc 不报错 + 浏览器走完元素属性面板每个 tab。
- **回退**：每个 commit 可独立 revert；30A 的兼容映射拷贝在 spec 文档里随时可恢复。

---

**末**
