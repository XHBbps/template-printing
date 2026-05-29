# 批次7:前端剩余优化(F8/F11/F9/F10/F4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development 逐 task 实现。步骤用 `- [ ]` 跟踪。

**Goal:** 收尾 review 桶二剩余前端项:F8 ApiView 按 tab 懒拉、F11 snapshot localStorage 写 debounce、F9 自动保存改版本计数(去深 watch)、F10 公共 tab 分页、F4 首屏 hydrate 乐观渲染。

**Architecture:** 纯 `apps/web`。**排序按风险递增**:F8/F11(易)→ F9/F10(中,设计器/列表 perf)→ **F4 最后**(auth/boot 流改造,唯一需登录流程手测的高风险项,单独 task + 硬手测门)。

**Tech Stack:** Vue 3.4 + Pinia + vue-router 4。

**Spec:** `docs/superpowers/specs/2026-05-28-system-review-audit.md` 桶二 F4/F8/F9/F10/F11。

**已核实事实:**
- F8:`ApiView.vue:201-210` onMounted 无条件 `void refreshTokens()` + `await apiFetch('/templates?limit=100')`;默认 tab 是 `docs`(`activeTab='docs'`),tokens tab 用 tokens、schemas tab 用 templates。
- F11:`stores/designer.ts:210-221` `snapshot()` 每次 `JSON.stringify`(history,需要)+ `persist()`(localStorage 写)。`persist()` 在 :234。undo/redo/load/reset 也调 persist。
- F9:`DesignerView.vue:109-125` `watch(() => store.template, ..., {deep:true})` 自动保存(debounce 1500ms,isResizing 跳过)。`snapshot()`(designer.ts:210)在 template 变更时调(:442 等);**注意 history.length 在 HISTORY_LIMIT 后 shift+push 不变 → 不可直接 watch length**,改加单调 `editVersion` 计数。
- F10:`TemplatesView.vue:180-193` `loadPublic()` `fetchPublicSlice({offset:0, limit:100})` 无分页;"mine" tab 有 gridPage/loadGridPage 分页可参照。F6 已让缩略图懒加载,F10 仅剩元数据一次拉 100。
- F4:`router/index.ts:124-151` beforeEach `await auth.hydrate()`(boot 必跑)后 enforce;`main.ts` `router.isReady().then(mount)` 门控 → 首屏阻塞 1(正常)~3(access 过期)RTT。`AppShell.vue` 已有 `watch(auth.user)` user→null 驱逐 + bfcache re-hydrate。`auth.ts` `loading` 初始 true、`isAuthenticated=user!==null`、hydrate/tryRefresh。

---

## 全局约定
- typecheck/lint:`docker exec template_printing-web sh -c "cd /workspace/apps/web && pnpm run typecheck && pnpm run lint"`;构建 `pnpm run build`。
- 只动 `apps/web`。Git 不 `--no-verify`,每 task 只 add 本 task 文件。
- 视觉/功能门(我开不了浏览器,编排者请用户走查):F8(各 tab 切换正常)、F9(编辑自动保存仍生效)、F10(公共 tab 分页/加载更多)、**F4(登录流程全量手测——见 T5)**。

---

## Task 1(F8):ApiView 按 tab 懒拉

**Files:** Modify `apps/web/src/views/ApiView.vue`。

- [ ] **Step 1: onMounted 改条件** 当前 onMounted 无条件拉 tokens + templates。改为:仅按当前/激活 tab 懒拉,且每类只拉一次。
  - 抽 `ensureTokens()`(首次拉 tokens,`tokensLoaded` 守卫)、`ensureTemplates()`(首次拉 templates,`templatesLoaded` 守卫,设 loading)。
  - onMounted:依 `activeTab` 初值(及 `route.query.to` 已设的 tab)只拉对应数据;`docs` tab 不拉任何。
  - `watch(activeTab, (t) => { if (t==='tokens') void ensureTokens(); else if (t==='schemas') void ensureTemplates(); })`(切到该 tab 才拉)。
  - 保留 `route.query.to` 初始化 activeTab 的逻辑(onMounted 里);初始若是 tokens/schemas 则对应 ensure。
  > 实现者按 ApiView 现有 tokens/templates state + loading 改造;确保切 tab 不重复拉(loaded 守卫)、docs 默认不拉。

- [ ] **Step 2: 验证** typecheck/lint/build 绿。
- [ ] **Step 3: 提交** `git add apps/web/src/views/ApiView.vue && git commit -m "perf(web): ApiView 按 tab 懒拉 tokens/templates,默认 docs tab 不拉(F8)"`
  > 功能门:进 /api 默认文档 tab 不发 /templates 请求;切到"凭证"拉 tokens、"模板字段"拉 templates,各只一次。

---

## Task 2(F11):snapshot 的 localStorage 写 debounce

**Files:** Modify `apps/web/src/stores/designer.ts`。

- [ ] **Step 1: persist debounce** `snapshot()` 仍同步 `JSON.stringify` + push history(undo 需要,内存操作),但把 `this.persist()`(localStorage 写)改为 debounce(~500ms)。新增 `persistDebounced()`:模块级 timer,500ms 后调真正 `persist()`;`snapshot()` 末尾改调 `this.persistDebounced()`。**undo/redo/load/reset/save 等需即时持久化的路径仍调 `persist()` 直写**(只 snapshot 高频路径 debounce)。
```ts
// 模块级(store 外或闭包):
let persistTimer: ReturnType<typeof setTimeout> | null = null;
// action:
persistDebounced(): void {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => { this.persist(); persistTimer = null; }, 500);
},
```
> Pinia action 内访问模块级 timer 即可。snapshot() 的 `this.persist()` → `this.persistDebounced()`。其它 persist 调用点(undo/redo/load/reset)保持直接 persist(用户预期这些即时落盘;且它们非高频)。

- [ ] **Step 2: 验证** typecheck/lint/build 绿。
- [ ] **Step 3: 提交** `git add apps/web/src/stores/designer.ts && git commit -m "perf(web): 设计器 snapshot 的 localStorage 写 debounce 500ms(F11)"`
  > 功能门:连续编辑不再每次写 localStorage(停手 ~500ms 后落盘);刷新页能恢复草稿(debounce 落盘后)。

---

## Task 3(F9):自动保存改版本计数(去深 watch)

**Files:** Modify `apps/web/src/stores/designer.ts`、`apps/web/src/views/DesignerView.vue`。依赖 T2(同改 designer.ts,顺序执行)。

- [ ] **Step 1: store 加单调版本计数** `designer.ts` state 加 `editVersion: 0`;在 **`snapshot()`** 末尾 `this.editVersion++`(每次有效内容变更 +1,单调,不受 HISTORY_LIMIT shift 影响)。
  > **验证 snapshot 覆盖**:先 grep/确认所有"应触发自动保存"的 template 变更都经 `snapshot()`(designer.ts 各 mutation)。若有不经 snapshot 的 template 写(如某直接赋值),要么让其也 `snapshot()`/`editVersion++`,要么保留对其的处理——以"自动保存触发集 ⊇ 原 deep-watch 触发集"为准,报告说明核查结果。load/reset 重置 history 时 editVersion 也应 ++（视为一次变更基线,或单独处理使首次加载不误触发保存——实现者按"加载不应触发对后端的保存"调整:可在 DesignerView watch 里用 templateId 守卫,如现有 `if(!store.templateId) return`)。

- [ ] **Step 2: DesignerView watch 改 editVersion** `DesignerView.vue:109-125` 的 `watch(() => store.template, ..., {deep:true})` 改为 `watch(() => store.editVersion, ...)`(浅 watch 一个 number,去掉 `{deep:true}`)。回调逻辑(templateId 守卫、isResizing 跳过、markPendingSave + debounce saveToBackend)不变。
```ts
watch(
  () => store.editVersion,
  () => {
    if (!store.templateId) return;
    if (store.isResizing) return;
    store.markPendingSave();
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { void store.saveToBackend(); saveTimer = null; }, SAVE_DEBOUNCE_MS);
  },
);
```
> isResizing 跳过仍靠下方既有 isResizing watch 收尾补一次保存(不变)。

- [ ] **Step 3: 验证** typecheck/lint/build 绿。
- [ ] **Step 4: 提交** `git add apps/web/src/stores/designer.ts apps/web/src/views/DesignerView.vue && git commit -m "perf(web): 自动保存 watch editVersion 计数取代整 template 深 watch(F9)"`
  > 功能门:设计器编辑(增删改元素/属性)仍触发自动保存(网络面板见 debounce 后的 PATCH/PUT);拖拽结束补存正常;首次加载模板不误触发保存。

---

## Task 4(F10):公共 tab 分页

**Files:** Modify `apps/web/src/views/TemplatesView.vue`。

- [ ] **Step 1: 公共 tab 加分页/加载更多** `loadPublic()` 现 `offset:0, limit:100` 一次拉。改为分页或"加载更多":参照 "mine" tab 的 grid 分页(`gridPage`/`loadGridPage`/`fetchSlice` 含 total),给公共 tab 加 `publicPage`/`publicTotal`,首屏拉第 1 页(如 limit:24),滚动到底或点"加载更多"拉下一页 append。`fetchPublicSlice` 已支持 offset/limit。
  > 实现者按现有 grid 分页模式(BrandPagination 组件?或"加载更多"按钮)实现,与 mine tab 体验一致;F6 缩略图懒加载已在,分页后每页缩略图仍懒载。保留 search/sort 透传。最小可行:从 limit:100 改 limit:24 + "加载更多"按钮 append。

- [ ] **Step 2: 验证** typecheck/lint/build 绿。
- [ ] **Step 3: 提交** `git add apps/web/src/views/TemplatesView.vue && git commit -m "perf(web): 公共模板 tab 分页/加载更多,避免一次拉 100 条元数据(F10)"`
  > 功能门:公共 tab 首屏只拉第 1 页;加载更多/翻页正常 append;搜索/排序正常。

---

## Task 5(F4):首屏 hydrate 乐观渲染 ⚠️ 高风险(auth/boot 流)

**Files:** Modify `apps/web/src/main.ts`、`apps/web/src/router/index.ts`、`apps/web/src/layout/AppShell.vue`(+ 可能 `stores/auth.ts`)。**这是 auth 流改造,bug = 全员登录异常;Step 4 用户手测是硬门,未通过不算完成。**

- [ ] **Step 1: 设计确认(乐观 boot)** 目标:首屏不阻塞 hydrate。方案:
  1. **guard 首次不 await hydrate**:`router/index.ts` beforeEach,首次 boot(`!hasHydratedOnce`)**异步**起 `auth.hydrate()`(不 await)、`hasHydratedOnce=true`、**放行**(不在 auth 未知时重定向);hydrate 完成后再纠正。后续导航(hasHydratedOnce 后)维持原同步 enforce(`requiresAuth && !isAuthenticated → /login` 等)。
  2. **boot 骨架**:`auth.loading` 为 true(首次 hydrate 进行中)时,AppShell 在**非 fullscreen** 应用页显示全屏骨架(占位),避免未授权用户瞥见受保护内容 + 避免布局闪。fullscreen 页(登录/打印/错误)不显骨架。
  3. **hydrate 后纠正重定向**:hydrate 完成(loading→false)后,若当前路由 `requiresAuth && !isAuthenticated` → `router.replace('/login?continue=...')`;若在 `/login` 且 isAuthenticated → `router.replace('/templates')`;adminOnly 同理。可在 AppShell 加 `watch(() => auth.loading, (l)=>{ if(!l) enforceCurrentRoute() })` 或在 hydrate().then 里做。
  4. `main.ts`:可保留 `router.isReady().then(mount)`(guard 不再 await hydrate → isReady 很快 resolve → mount 快);骨架由 AppShell 控制。
  实现者先把上述边界(authed 刷新受保护页 / 未授权深链 / 过期会话 / 登出 / adminOnly / 已登录访问 /login / continue 参数)列全,设计覆盖每条,报告说明各边界如何处理。**保守起见**:若某边界难以无闪覆盖,宁可对该边界保持"等 hydrate"(退化为原行为)也不要错放未授权内容。

- [ ] **Step 2: 实现** 按 Step 1 改 main.ts/router/AppShell(+auth 若需加 hydrated 标志)。骨架可简单(居中 logo/spinner + "正在加载…"),复用现有样式变量。

- [ ] **Step 3: typecheck/lint/build** 绿。

- [ ] **Step 4: 🔴 用户手测硬门(我无法浏览器验证,必须用户走查全部 auth 流)** 重启 web 后,请用户验证(编排者转交):
  1. 已登录刷新 `/templates` → 不闪登录页、骨架后正常显示。
  2. 未登录深链 `/templates` → 骨架后跳 /login(不闪受保护内容)。
  3. 过期会话(可删 access cookie 模拟)刷新 → refresh 成功则正常进、失败则跳登录。
  4. 登出 → 跳登录;另一 tab 登出后本 tab 操作 → 驱逐登录(AppShell 既有 watch)。
  5. 已登录访问 `/login` → 跳 /templates。
  6. adminOnly 页(/admin/*)非 admin → /403。
  7. `?continue=` 登录后回跳目标。
  **任一异常 → 不提交 / 回退 F4**(F4 单独 commit,可独立 revert)。

- [ ] **Step 5: 提交(仅手测全过后)**
```bash
git add apps/web/src/main.ts apps/web/src/router/index.ts apps/web/src/layout/AppShell.vue apps/web/src/stores/auth.ts
git commit -m "perf(web): 首屏乐观渲染——boot 不阻塞 hydrate,挂骨架后台 hydrate+纠正重定向(F4)"
```
> F4 风险最高,单独 commit 便于独立回滚。若手测发现回归且短时难修 → 回退本 task,保留 F8/F9/F10/F11,F4 再议。

---

## Task 6:文档 + 收尾

**Files:** Modify `docs/PROGRESS.md`。

- [ ] **Step 1: PROGRESS** `### 2026-05-29` 追加批次7 条目(F8 ApiView 懒拉 / F11 persist debounce / F9 自动保存版本计数 / F10 公共 tab 分页 / F4 乐观 hydrate——注明 F4 经用户登录流程手测)。更新「最近更新」。**至此 review 桶二前端 F1-F11 全部完成或明确处理**。
- [ ] **Step 2: 全量构建 + 提交** `pnpm run build` 绿;`git add docs/PROGRESS.md && git commit -m "docs: 批次7 前端剩余优化(F8/F9/F10/F11/F4)同步"`

---

## Self-Review
**Spec 覆盖:** F8→T1、F11→T2、F9→T3、F10→T4、F4→T5、文档→T6。F1-F11 全覆盖。
**占位符:** F8/F11/F9 给完整代码思路 + 关键代码;F10/F4 给设计 + 边界要求,精确行由实现者据现有模式填(F10 参照 grid 分页;F4 列全边界)。
**顺序/依赖:** T2、T3 同改 designer.ts(顺序);T3 依赖 T2(editVersion 加在 snapshot,persist 已 debounce)。F4(T5)独立、排最后、单独 commit。
**风险点:** (1) **F4 最高**:auth/boot 改造,Step4 用户手测 7 条 auth 流是硬门,保守退化优于错放;单独 commit 可回滚。(2) F9:editVersion 必须覆盖原 deep-watch 的触发集(snapshot 全覆盖核查);首次加载不误存(templateId 守卫)。(3) F11:只 debounce snapshot 路径,undo/redo/load/reset 仍即时 persist。(4) F8:loaded 守卫防重复拉。
