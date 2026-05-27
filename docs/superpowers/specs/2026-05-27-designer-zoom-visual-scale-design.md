# 设计器缩放改为纯视觉缩放(transform: scale) 设计文档

> 状态:已与用户确认设计,进入实现计划阶段。
> 日期:2026-05-27
> 范围:修复设计器画布缩放(zoom)会改变排版的 bug。把 zoom 从"逐元素几何乘 zoom(字体不缩)"改为"整张纸 `transform: scale(zoom)`",使任何缩放比例下排版与 100%(=实际打印产出)完全一致。zoom 仅用于放大查看细节,绝不影响内容。

---

## 问题

设计器画布对元素**几何盒子**乘了 zoom,但**字体/字间距/边框/padding 是固定 px、不随 zoom 缩放**:
- `apps/web/src/designer/CanvasElement.vue`:`left/top/width/height = anchor × PX_PER_MM(4) × zoom`。
- `packages/template-renderer/src/styleToCss.ts`:`fontSize: ${px}px` 等为固定 px。

后果:
- **100%**:盒子 = `anchor×4`,与渲染器(`TemplateRenderer`,预览/打印同样 `PX_PER_MM=4` 无 zoom)比例一致 → 正确。
- **66% 或更小**:盒子缩到 `anchor×4×0.66`,字号不变 → 字相对盒子变大 → 文本溢出、重叠、异常换行(用户截图所示)。
- 本质:zoom 改变了盒子与字体的比例 → 改变排版 → 与实际产出不符。

用户要求:缩放是**纯视觉**操作(方便放大调细节),任何比例下排版都等于 100% 即实际打印产出。

## 方案:整张纸 `transform: scale(zoom)`

画布以**固定 intrinsic 比例**(`PX_PER_MM=4`,zoom=1 的几何)渲染所有元素,再对纸张元素施加 CSS `transform: scale(zoom)`(`transform-origin: top left`)。盒子+字体+边框随同一 transform 等比缩放 → 任何 zoom 下排版与 100% 完全一致 = 纯视觉缩放。

### 改动点

1. **`apps/web/src/designer/CanvasElement.vue`** —— `positionStyle` 去掉 `× z`:
   `left/top/width/height = anchor.{x,y,w,h} × PX_PER_MM`(intrinsic,不乘 zoom)。

2. **`apps/web/src/designer/DesignerCanvas.vue`**:
   - `cssVars`:`--cell-w/h`、`--canvas-w/h` 去掉 `× z`(intrinsic 尺寸)。
   - 结构:外层加一个 **frame** 容器,其宽高 = `intrinsic × zoom`(为缩放后的纸预留布局空间,使滚动条/居中正常);内层 `.tp-paper` 用 intrinsic 尺寸 + `transform: scale(zoom); transform-origin: top left`。
   - **`paperRef` 必须指向被 transform 的 `.tp-paper`**(保证 `onDrop` 里 `paperRef.getBoundingClientRect()` 取到的是缩放后的视觉矩形)。

3. **`apps/web/src/designer/SnapGuides.vue`** —— `mmToCanvasPx` 去掉 `× store.view.zoom`:返回 intrinsic `mm × PX_PER_MM`(辅助线现在画在被 transform 缩放的纸内部,坐标须用 intrinsic)。

### 不需要改(已逐行核实坐标换算对缩放方式不敏感)

- **拖拽 / 缩放**(`usePointerDrag.ts:95-96, 147-148`):`dxMm = (clientX − startX) / (PX_PER_MM × zoom)` —— 屏幕像素位移 ÷ (4×zoom)。两种缩放方式下元素视觉大小一致,同样鼠标位移换算同样 mm,公式不变、正确。
- **拖入新元素**(`DesignerCanvas.vue:60-64`):`(clientX − paperRect.left) / (PX_PER_MM × zoom)`,`paperRect` 为 transform 后视觉矩形,结果仍是正确 mm,公式不变。
- **选中/点击**:transform 不破坏指针命中;点击落在视觉缩放后的元素上 → 正常选中。
- **元素内容编辑**:内容/字号/位置在右侧 `PropertyPanel`(画布之外、不被缩放)里编辑,与 zoom 完全解耦。
- **autoScroll**(`usePointerDrag.ts:13`):基于 `.tp-canvas-area`(滚动视口,未被 transform)的 rect,屏幕像素判定,不受影响。
- **fitView**(`DesignerHeader.vue`)/`elementFactory` 网格换算:用 intrinsic mm,逻辑不变;fitView 仍设 zoom 使 `intrinsic × zoom` 适配视口(frame 已预留该尺寸)。
- **渲染器 / 预览 / 打印 / 模板数据**:完全不动。

## 验证

- **核心**:同一模板在 50% / 66% / 100% / 150% / 200% 各比例下,元素相对位置与文本排版**完全一致**(无溢出/重叠/异常换行差异),且与预览/打印一致。
- 拖拽移动元素:在 66% 与 150% 下移动,落点 mm 与 100% 一致(吸附、边界 clamp 正常)。
- 缩放手柄改尺寸:在非 100% 下改 w/h,得到的 mm 与视觉一致。
- 拖入新元素:在非 100% 下从组件区拖到画布某点,落点正确。
- 吸附辅助线(SnapGuides):非 100% 下辅助线与元素边对齐。
- 选中元素 + 属性面板编辑:任意比例下点击选中、改属性正常生效。
- typecheck + lint(web)。

## 不做 / 约束

- 不改渲染器(`packages/template-renderer`)、预览、打印、模板数据。
- 不改 `PX_PER_MM`(4)基准、不改 zoom 的取值范围/fit 逻辑本身。
- 不改属性面板编辑逻辑。
- 不引入新依赖。
- 不顺手处理"某元素盒子本身偏窄导致 100% 也换行"这类**模板数据**问题(由用户在设计器调整);本次只保证 zoom 不再扭曲排版。
