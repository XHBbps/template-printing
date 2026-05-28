# 批次5:前端首屏/打包 快赢(F1+F5+F7) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development 逐 task 实现。步骤用 `- [ ]` 跟踪。

**Goal:** 砍首屏体积 + 并行首屏请求,低风险快赢:F1 Element Plus 按需(去全量 JS+CSS)、F7 vite manualChunks(拆 vendor)、F5 TemplatesView 两请求并行。

**Architecture:** 纯 `apps/web` 构建/入口改动,不动业务逻辑/后端/渲染。F1 用 `unplugin-element-plus`(为显式 import 注入按需 CSS,含 ElMessage)+ `unplugin-vue-components`+`ElementPlusResolver`(自动注册模板 `<ElX>` 标签 + 样式,覆盖依赖全局注册的用法,零文件改动)取代 `app.use(ElementPlus)` + 全量 CSS。

**Tech Stack:** Vite 5.3.3 + Vue 3.4 + Element Plus 2.7.7;`apps/web` 容器构建。

**Spec:** `docs/superpowers/specs/2026-05-28-system-review-audit.md` 桶二 F1/F5/F7。

**已测 baseline(生产构建,gz):** `index.js` 930KB(307gz)、`index.css` 351KB(50gz)、`TemplateRenderer.js` 904KB(256gz,F3 留下批)、`TemplatesView.js` 114KB(36gz)。

**已核实事实:**
- `main.ts:2` `import 'element-plus/dist/index.css'`;`:10` `import ElementPlus`;`:24` `app.use(ElementPlus)`(全量注册,index.js 大头来源)。
- EP **无 `<el-*>` kebab 标签**;用法为 21 文件显式 `import { ElX } from 'element-plus'`(组件经 script-setup 暴露到模板)+ 模板 PascalCase `<ElX>`。`ElMessage` 程序式 ×83、`ElMessageBox` ×1。
- 模板 `<ElX>` 标签集:Avatar/Button/Checkbox/Dialog/Dropdown(+Item/Menu)/Form/FormItem/Input/Option/Pagination/Scrollbar/Select。其中 **Avatar(AppHeader.vue)、Checkbox/Form/FormItem(FieldManager.vue)依赖全局注册**(无显式 import)→ 故需 `unplugin-vue-components` resolver 兜所有模板标签,避免逐文件补 import 的遗漏风险。
- `@element-plus/icons-vue` 在 src 无引用(grep 空);lucide-vue-next 为主图标库。
- `vite.config.ts` 无 build 优化;`package.json` build = `vue-tsc --noEmit && vite build`。
- `TemplatesView.vue:152-160` `reloadActive`:active-view load 后**串行** `await refreshRecentId()`。

---

## 全局约定
- 构建/类型:`docker exec template_printing-web sh -c "cd /workspace/apps/web && pnpm run build"`(含 vue-tsc + vite build,输出 chunk 体积);lint `pnpm run lint`。
- 装依赖:`docker exec template_printing-web sh -c "cd /workspace && pnpm install --filter @template-printing/web"`(改 package.json 后);提交 `pnpm-lock.yaml`。
- 只动 `apps/web`(+ lock);不动后端/渲染/template-renderer。Git 不 `--no-verify`。
- **F1 视觉回归**:按需 CSS 漏样式是视觉问题,自动构建测不出 → 每 task 后(尤其 F1)需人工眼校关键页(登录/模板列表/设计器/管理/API),由编排者在 task 完成后请用户走查。

---

## Task 1(F1):Element Plus 按需

**Files:** Modify `apps/web/package.json`、`apps/web/vite.config.ts`、`apps/web/src/main.ts`、`pnpm-lock.yaml`。

- [ ] **Step 1: 加 devDep** `apps/web/package.json` devDependencies 加:
```json
    "unplugin-element-plus": "^0.8.0",
    "unplugin-vue-components": "^0.27.0",
```
(版本以 pnpm 能解析的最新兼容 Vite5/Vue3 为准;若 `^0.8.0`/`^0.27.0` 装不上,装兼容版并在报告注明实际版本。)
`docker exec template_printing-web sh -c "cd /workspace && pnpm install --filter @template-printing/web"`。

- [ ] **Step 2: vite.config 加插件** `apps/web/vite.config.ts`:
```ts
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';
// eslint-disable-next-line import/no-unresolved
import ElementPlus from 'unplugin-element-plus/vite';
// eslint-disable-next-line import/no-unresolved
import Components from 'unplugin-vue-components/vite';
// eslint-disable-next-line import/no-unresolved
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers';

export default defineConfig({
  plugins: [
    vue(),
    // 显式 import { ElX } from 'element-plus' → 按需注入对应 CSS(含 ElMessage/ElLoading)
    ElementPlus({}),
    // 模板里直接用的 <ElX>(依赖原全局注册的)→ 自动注册组件 + 样式
    Components({ resolvers: [ElementPlusResolver()], dts: false }),
  ],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: { /* 原 server 块原样保留 */ },
});
```
(保留原 `resolve.alias`、`server`(host/port/watch/proxy)块不变;只加 plugins。`dts:false` 避免生成 components.d.ts 噪声。)

- [ ] **Step 3: main.ts 去全量** `apps/web/src/main.ts` 删三行:`import 'element-plus/dist/index.css';`(:2)、`import ElementPlus from 'element-plus';`(:10)、`app.use(ElementPlus);`(:24)。其余(pinia/router/csrf/mount)不动。保留其它 `./styles/*.css` import(那些是自有样式,非 EP)。

- [ ] **Step 4: 构建验证 + 体积对比** `docker exec template_printing-web sh -c "cd /workspace/apps/web && pnpm run build 2>&1 | tail -45"`。
Expected:构建成功;`index.js` 显著缩小(预期 ~300-400KB gz JS 移出 → index.js 应从 307gz 降到 ~150-200gz 量级,EP 进按需/独立 chunk);`index.css` 大幅缩小(351KB→只剩用到的组件样式)。贴改后 chunk 列表,与 baseline 对比关键行。`pnpm run lint` 绿。

- [ ] **Step 5: 提交**
```bash
git add apps/web/package.json apps/web/vite.config.ts apps/web/src/main.ts pnpm-lock.yaml
git commit -m "perf(web): Element Plus 按需(unplugin-element-plus + vue-components resolver),去全量 JS/CSS(F1)"
```

> 完成后**人工视觉门**:编排者请用户眼校 登录/模板列表/设计器(含字段管理 ElForm/ElCheckbox、AppHeader ElAvatar)/管理/API 页,确认 EP 组件样式(对话框/下拉/分页/表单/头像/滚动条/消息提示)完整无丢。发现丢样式 → 该组件可能既非显式 import 又未被 resolver 命中,补查。

---

## Task 2(F7):vite manualChunks 拆 vendor

**Files:** Modify `apps/web/vite.config.ts`。依赖 T1(EP 已按需后再拆,chunk 才合理)。

- [ ] **Step 1: 加 build.rollupOptions** `vite.config.ts` defineConfig 加 `build` 块:
```ts
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'vue-vendor': ['vue', 'vue-router', 'pinia'],
          'element-plus': ['element-plus', '@element-plus/icons-vue'],
        },
      },
    },
  },
```
(放在 plugins/resolve/server 同级。`element-plus` 显式分包:把按需引入的 EP 组件聚到一个长缓存 chunk,entry 更小。)

- [ ] **Step 2: 构建验证** rebuild,确认出现 `vue-vendor-*.js` 与 `element-plus-*.js` 独立 chunk,`index.js`(entry)进一步变小;无构建错误。贴 chunk 列表。`pnpm run lint` 绿。

- [ ] **Step 3: 提交**
```bash
git add apps/web/vite.config.ts
git commit -m "perf(web): vite manualChunks 拆 vue-vendor / element-plus,缩 entry 提缓存(F7)"
```

---

## Task 3(F5):TemplatesView 两请求并行

**Files:** Modify `apps/web/src/views/TemplatesView.vue`。

- [ ] **Step 1: 改 reloadActive** `:152-160` 改为并行(active-view load 与 refreshRecentId 互不依赖):
```ts
async function reloadActive(): Promise<void> {
  const active =
    viewMode.value === 'grid'
      ? (() => {
          gridPage.value = 1;
          return loadGridPage(1);
        })()
      : loadListInitial();
  await Promise.all([active, refreshRecentId()]);
}
```
(语义不变:grid 仍重置到第 1 页;只是两个独立请求并发而非串行。)

- [ ] **Step 2: 验证** `pnpm run typecheck`(vue-tsc)+ `pnpm run lint` 绿;构建成功。

- [ ] **Step 3: 提交**
```bash
git add apps/web/src/views/TemplatesView.vue
git commit -m "perf(web): TemplatesView reloadActive 两请求 Promise.all 并行(F5)"
```

> 完成后人工眼校:模板列表页(grid/list 切换、搜索)加载正常,最近编辑标记正确。

---

## Task 4:最终体积对比 + 文档

**Files:** Modify `docs/PROGRESS.md`(+ 体积对比记录)。

- [ ] **Step 1: 最终构建对比** rebuild,整理 baseline vs 改后关键 chunk 体积表(index.js / index.css / vue-vendor / element-plus / TemplatesView 的 raw+gz)。
- [ ] **Step 2: PROGRESS** `### 2026-05-28` 追加批次5 条目(F1 EP 按需 + F7 manualChunks + F5 并行,附体积对比 before→after;注明 F3 904KB 渲染器 / F2/F4/F6 等留后续批)。更新「最近更新」。
- [ ] **Step 3: 提交**
```bash
git add docs/PROGRESS.md
git commit -m "docs: 批次5 前端首屏快赢(F1/F5/F7)同步 + 体积对比"
```

---

## Self-Review
**Spec 覆盖:** F1→T1、F7→T2、F5→T3、对比/文档→T4。F2/F3/F4/F6/F8-F11 明确不在本批(留后续)。
**占位符:** 插件配置/main.ts 删行/manualChunks/reloadActive 均给完整代码;devDep 版本标注"装不上则用兼容版并注明"。
**风险点:** (1) **F1 漏样式**(最大):resolver 兜模板标签 + unplugin-element-plus 兜显式 import,双覆盖应无漏;但仍以**人工视觉门**兜底(自动构建测不出样式缺失)。(2) F1+F7 交互:先 F1 后 F7,manualChunks 的 `element-plus` 分组在按需后仍有效(聚合 import 到的组件)。(3) 纯前端构建改动,无后端/渲染/数据风险;每步独立可回滚。
