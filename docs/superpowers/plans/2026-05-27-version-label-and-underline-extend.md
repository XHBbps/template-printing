# 未发布版本标签修正 + 下划线对称延长 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ① 设计器子标题不再对未发布模板误显示 "V1"(改为"未发布");② 文字元素下划线向左右各等量延长 0.5em(贴近实物)。两者均通用,不改模板数据。

**Architecture:** #1 删 `DesignerView.vue` 子标题里独立的 `V{meta.version}`(`saveCaption` 已正确含发布状态)。#2 在共享渲染组件 `TextElement.vue`(设计器画布/预览/打印共用)把下划线从 `text-decoration` 改为 `border-bottom` + 左右各 `0.5em` padding(延长)+ 底部 `0.15em` padding(间距);run 居中即左右对称延长。

**Tech Stack:** Vue3 SFC;`packages/template-renderer`(共享);CSS。

**Spec:** `docs/superpowers/specs/2026-05-27-version-label-and-underline-extend-design.md`

**全局约定:** 容器内跑命令:`docker exec template_printing-web sh -c "cd /workspace/apps/web && <cmd>"`(renderer 包用 `cd /workspace/packages/template-renderer`)。提交走 husky,不 `--no-verify`。只 `git add` 本任务文件。

---

## File Structure
- Modify `apps/web/src/views/DesignerView.vue` —— 删子标题的 `V{meta.version}` span(+其分隔符)。
- Modify `packages/template-renderer/src/elements/TextElement.vue` —— 下划线改 border-bottom + 延长 + 间距。
- Modify `docs/PROGRESS.md` —— 近期变更追加。

---

## Task 1: 未发布模板子标题不再显示 "V1"

**Files:** Modify `apps/web/src/views/DesignerView.vue`(模板 `<div class="tp-head-sub">`,约 183-189 行)。

- [ ] **Step 1: 改模板**

把:
```html
          <div class="tp-head-sub">
            <span>V{{ store.template.meta.version }}</span>
            <span class="sep">·</span>
            <span>{{ saveCaption.cap }}</span>
            <span class="sep">·</span>
            <span class="han">{{ saveCaption.han }}</span>
          </div>
```
改为(删掉首个 `V{meta.version}` span 及其后的分隔符):
```html
          <div class="tp-head-sub">
            <span>{{ saveCaption.cap }}</span>
            <span class="sep">·</span>
            <span class="han">{{ saveCaption.han }}</span>
          </div>
```
不动 `saveCaption` 的 computed 逻辑(`DesignerView.vue:25-38`,已正确:未发布→UNPUBLISHED/未发布;已发布→V{n}/已发布)。

- [ ] **Step 2: typecheck + lint**

Run: `docker exec template_printing-web sh -c "cd /workspace/apps/web && pnpm run typecheck && pnpm run lint"`
Expected: 0 错误、0 告警。

- [ ] **Step 3: 手测**

打开一个**未发布**模板(无已发布版本)进设计器 → 左上模板名下子标题显示 "UNPUBLISHED · 未发布",**不再出现 "V1"**;打开一个已发布模板 → 显示 "V{n} · PUBLISHED · V{n} · 已发布"。(子标题文案由 saveCaption 决定。)

- [ ] **Step 4: 提交**

```bash
git add apps/web/src/views/DesignerView.vue
git commit -m "fix(web): 设计器子标题不再对未发布模板显示 V1（去掉冗余 meta.version 标记）"
```

---

## Task 2: 下划线向左右各等量延长 0.5em(通用)

**Files:** Modify `packages/template-renderer/src/elements/TextElement.vue`(`runStyle` computed + 必要时注释)。

- [ ] **Step 1: 改 `runStyle` —— 下划线用 border-bottom + 延长 + 间距**

在 `packages/template-renderer/src/elements/TextElement.vue` 的 `runStyle` computed 中,把下划线分支:
```ts
  if (underline.value) {
    s.textDecoration = 'underline';
    s.textUnderlineOffset = '0.15em'; // 下划线与字体留一点间距
  }
```
改为:
```ts
  if (underline.value) {
    // 下划线用 border-bottom 渲染(text-decoration 无法超出文字范围):
    // 左右各 0.5em padding = 等量延长;底部 0.15em padding = 与文字的间距。
    // run 被容器居中 → 下划线左右对称延长。
    s.borderBottom = '1px solid currentColor';
    s.padding = '0 0.5em 0.15em';
  }
```
其余不变(`isJustify` 分支保持 `display:block; width:100%; text-align:justify; text-align-last:justify`;拆末字 `useSplit`/`head`/`tail`/`headStyle` 逻辑保留)。

> 说明:`currentColor` 让下划线随文字色;run 在非 justify 时为收缩宽度的 flex 子项,`border-bottom` = 文字宽 + 2×0.5em,被 `justify-content` 居中 → 左右各延长 0.5em、对称。justify 时 run 为 `block; width:100%`,padding 使分散文字内缩,下划线相对文字两侧各延长 ~0.5em。全局 `box-sizing: border-box` 已生效。

- [ ] **Step 2: typecheck + lint(renderer + web)**

Run:
```
docker exec template_printing-web sh -c "cd /workspace/packages/template-renderer && pnpm run typecheck"
docker exec template_printing-web sh -c "cd /workspace/apps/web && pnpm run typecheck && pnpm run lint"
```
Expected: 0 错误、0 告警。

- [ ] **Step 3: Chromium 实测延长对称 + 宽度**

写临时脚本 `apps/render/.measure.mjs`(渲染容器有 puppeteer + chromium):
```js
import puppeteer from 'puppeteer';
const b = await puppeteer.launch({ executablePath: process.env.PUPPETEER_EXECUTABLE_PATH, headless: true, args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--disable-gpu'] });
const p = await b.newPage();
// 复刻新版 run:center + 字间距40 + 下划线(border-bottom + padding:0 0.5em 0.15em),容器宽 400、字号 24
await p.setContent(`<!doctype html><meta charset=utf-8><body style="margin:0">
<div id="box" style="display:flex;justify-content:center;align-items:center;width:400px;height:80px;font-size:24px;font-family:sans-serif">
  <span id="run" style="border-bottom:1px solid currentColor;padding:0 0.5em 0.15em"><span style="letter-spacing:40px">出门</span><span>证</span></span>
</div></body>`);
const m = await p.evaluate(() => {
  const box = document.getElementById('box').getBoundingClientRect();
  const run = document.getElementById('run').getBoundingClientRect();
  // 文字内容范围:run 去掉左右各 0.5em(=12px @24px font)padding
  const emPx = 24 * 0.5;
  return {
    leftMargin: run.left - box.left,
    rightMargin: box.right - run.right,
    runW: run.width,
    textW: run.width - 2 * emPx,
    extPerSide: emPx,
  };
});
console.log(JSON.stringify(m, null, 2));
console.log('对称(左右边距相等):', Math.abs(m.leftMargin - m.rightMargin) < 1, ' diff=', (m.leftMargin - m.rightMargin).toFixed(2));
console.log('每侧延长 ≈ 0.5em(12px):', m.extPerSide === 12);
await b.close();
```
Run:
```
docker exec template_printing-render sh -c "cd /workspace/apps/render && node .measure.mjs"
```
Expected: `对称(左右边距相等): true diff= 0.00`;`runW` = 文字宽 + 24(两侧各 12px)。确认后删脚本:`rm -f apps/render/.measure.mjs`。
(若渲染容器不可用,改用 dev web 页面手测:打开带下划线标题的模板,目视下划线两端等量延长、与字有间距。)

- [ ] **Step 4: 手测**

打开含下划线标题(如出门证)的模板 → 设计器画布/预览/打印中,下划线两端各延长一小段且左右等长、与文字有间距。普通(无下划线)文字不受影响。

- [ ] **Step 5: 提交**

```bash
git add packages/template-renderer/src/elements/TextElement.vue
git commit -m "fix(renderer): 下划线改 border-bottom + 左右各 0.5em 对称延长 + 间距（通用）"
```

---

## Task 3: 文档同步

**Files:** Modify `docs/PROGRESS.md`(§3 近期变更 2026-05-27 追加)。

- [ ] **Step 1: 追加近期变更**

在 `docs/PROGRESS.md` 的 `### 2026-05-27` 段顶部追加:
```markdown
- **fix：未发布模板版本标签 + 下划线对称延长(通用)** —— ① 设计器子标题去掉冗余的 `V{meta.version}`(元数据版本恒为 1、与发布无关),未发布模板改显示"未发布"(`saveCaption` 提供发布状态);② `TextElement` 下划线由 `text-decoration` 改为 `border-bottom` + 左右各 `0.5em`(随字号)padding 延长 + 底部 `0.15em` 间距,居中即左右对称延长(贴近实物),Chromium 实测左右延长相等。两者通用、不改模板数据。
```

- [ ] **Step 2: 提交**

```bash
git add docs/PROGRESS.md
git commit -m "docs: 同步未发布标签修正 + 下划线对称延长"
```

---

## Self-Review(写计划后自检)

**Spec 覆盖:** §问题1(删 V{meta.version},saveCaption 已对)→ Task 1 ✅;§问题2(border-bottom + 0.5em 延长 + 0.15em 间距 + 居中对称 + 保留拆末字)→ Task 2 ✅;§测试(#1 手测、#2 Chromium 量框 + 手测、typecheck/lint)→ Task 1/2 步骤 ✅;§影响文件(DesignerView + TextElement)→ Task 1/2 ✅;文档同步 → Task 3 ✅。

**占位符扫描:** 无 TBD/TODO;每步含完整 before/after 代码与确切命令。

**类型一致性:** `runStyle` 仍返回 `Record<string,string>`,新增 `borderBottom`/`padding` 键合法;`saveCaption`/`useSplit`/`head`/`tail`/`headStyle` 均为既有、未改签名。Task 1 仅删模板节点,不涉类型。
