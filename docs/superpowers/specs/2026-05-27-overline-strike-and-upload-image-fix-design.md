# 上划线/删除线恢复 + 上传图片显示修复 设计文档

> 状态:已与用户确认设计,进入实现计划阶段。
> 日期:2026-05-27
> 范围:两个独立的通用修复(全模板生效,不针对单个模板、不改模板数据):① 文字元素的上划线(overline)/删除线(line-through)在下划线改造后丢失 → 恢复;② 上传图片在设计器画布显示"图片加载失败"(dev 环境)→ 修复。

---

## 问题 1:上划线 / 删除线消失(回归)

### 现状
上一轮(commit `c99ed1c2`)把下划线从 `text-decoration: underline` 改成 `border-bottom` 渲染时,`packages/template-renderer/src/elements/TextElement.vue` 的 `containerStyle` 用 `delete css.textDecoration` 剥掉了 **所有** `text-decoration`,而 `runStyle` 只对 `textDecoration === 'underline'` 重新补了 `border-bottom`。结果 `overline` 与 `line-through` 被删掉后再未补回 → 完全不渲染。

`StyleSchema.textDecoration` 枚举为 `'none' | 'underline' | 'overline' | 'line-through'`(单值,同一时间只有一种)。

### 改法
仅改 `TextElement.vue` 的 `runStyle`(及 `underline` 计算属性合并为 `decoration`):
- `underline` → 保持现状:`border-bottom: 1px solid currentColor` + `padding: 0 0.5em 0.15em`(下划线需左右等量延长 + 与文字间距,原生 `text-decoration` 做不到,故仍用 border-bottom)。
- `overline` / `line-through` → 用原生 `text-decoration` 重新渲染(它们不需要超出文字范围):`s.textDecoration = decoration.value`。
- `none` / 未设置 → 不加任何装饰。

```ts
const decoration = computed(() => props.element.style.textDecoration);
// runStyle 内:
if (decoration.value === 'underline') {
  s.borderBottom = '1px solid currentColor';
  s.padding = '0 0.5em 0.15em';
} else if (decoration.value === 'overline' || decoration.value === 'line-through') {
  s.textDecoration = decoration.value;
}
```

`text-decoration` 加在内层 run span 上,会自然作用于拆末字的 head/tail 两个子 span,overline/line-through 跨整段渲染。`useSplit`/`head`/`tail`/`headStyle`、justify 分支均不变。`containerStyle` 仍删除 `textDecoration`(装饰统一由 run 负责)。

通用:对所有带 overline/line-through 的文字元素生效,不新增 schema 字段、不改属性面板、不改模板数据。

---

## 问题 2:上传图片显示"图片加载失败"(dev 环境)

### 现状
上传成功后,`UploadsService.storeImage` 把文件写到 `STORAGE_ROOT/uploads/<sha256前16>.<ext>`,返回 `url: /uploads/<filename>`,存入 image 元素 `source.url`。`ImageElement.vue` 用 `<img :src="source.url">` 渲染。

- **生产**:API 通过 `ServeStaticModule`(`app.module.ts`,`rootPath = STORAGE_ROOT`,`serveRoot: '/'`,仅排除 `/uploads/render/*` 等)把 `STORAGE_ROOT/uploads/<file>` 服务在 `/uploads/<file>`,与 SPA 同源 → 正常加载。
- **dev**:web 跑在 Vite dev server `:5173`;`apps/web/vite.config.ts` 的 proxy **只转发 `/api/`**。`<img src="/uploads/xxx.png">` 请求 `:5173/uploads/xxx.png` 未被代理 → Vite SPA fallback 返回 `index.html`(HTML 而非图片)→ `<img>` 解码失败 → 显示"图片加载失败"。

上传请求本身走 `/api/uploads/image`(被代理、rewrite 去掉 `/api`),所以 **上传成功**;只是回显的 `/uploads/...` 路径在 dev 未被代理。

### 改法
仅改 `apps/web/vite.config.ts` 的 dev proxy,新增 `/uploads/` 转发到 API(不 rewrite —— API 本身就在 `/uploads/*` 提供静态文件):

```ts
proxy: {
  '/api/': { target: apiTarget, changeOrigin: true, rewrite: (p) => p.replace(/^\/api/, '') },
  '/uploads/': { target: apiTarget, changeOrigin: true },
},
```

这使 dev 行为与生产一致(同时修好 dev 下 `/uploads/render/*` 签名预览/下载的直链访问)。

不改存储 URL 格式、不加 `/api` 前缀(生产 API 无 `/api` 前缀,真实路径就是 `/uploads/*`,与 SPA 同源;给数据硬编码环境前缀是错的)、不改后端、不改任何模板数据。

---

## 影响文件

- 改:`packages/template-renderer/src/elements/TextElement.vue`(`runStyle`/`decoration`:恢复 overline/line-through)。
- 改:`apps/web/vite.config.ts`(dev proxy 增加 `/uploads/`)。
- 改:`docs/PROGRESS.md`(§3 近期变更追加)。

## 测试

- 问题 1:打开含上划线 / 删除线文字的模板(或临时给某文字元素设 `textDecoration: overline` / `line-through`)→ 设计器画布 / 预览 / 打印中,上划线 / 删除线正常渲染;下划线仍为 border-bottom 左右对称延长 + 间距;`none` 文字无装饰。typecheck + lint(renderer + web)。
- 问题 2:dev 环境上传一张 png/jpg → 设计器画布立即显示图片(不再"图片加载失败");刷新后仍显示;浏览器 Network 中 `/uploads/<file>` 返回 200 image/*。

## 不做 / 约束

- 不改任何模板数据(纯渲染 / dev 配置修复)。
- 不新增 schema 字段、不改属性面板。
- 不改后端上传 / 静态服务逻辑、不改存储 URL 格式。
- 不引入新依赖。
- 不支持多重装饰组合(schema 为单值枚举,本次不扩展)。
