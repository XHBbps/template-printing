# CLAUDE.md

> 本文件由 Claude Code 在每次对话开始时自动加载到上下文。
> **短**且**只含最关键约束**，详细规则在 [`AGENTS.md`](AGENTS.md)。

---

## 优先阅读顺序

1. **`AGENTS.md`** — 仓库完整协作规则、文档同步协议、代码约定（必读）
2. **`docs/PROGRESS.md`** — 当前事实进度和近期变更
3. **`docs/superpowers/plans/` 下最新计划** — 若延续上一迭代或开始新迭代
4. **`docs/superpowers/specs/` 下对应 spec** — 若涉及该迭代设计意图
5. 按需读 `README.md` / `docs/deployment.md` / `docs/PRE_DEPLOYMENT_CHECKLIST.md`

---

## 不可违反的底线

### 代码

- **最小化改动**：只改与当前任务直接相关的部分，不顺手重构、不添加未请求的功能
- **复用优先**：先查 `apps/web/src/lib/*`、`apps/web/src/components/*`、`packages/schema`、`packages/template-renderer` 是否已有实现
- **前端鉴权**：路由守卫只在 `apps/web/src/router/index.ts` 的 `beforeEach`；admin 同时含 `'admin'` 与 `'emergency_admin'`
- **后端分层**：Controller 只做 DTO 校验 + 调用 service；Service 调用 Prisma；**Controller 不直接写 Prisma 查询**
- **长任务**（PDF / PNG 渲染）一律入 bullmq 队列，**不在请求线程内同步执行**
- **Designer schema**：mm-anchor 单位一律 mm；不在代码里随意切到 px

### 文档同步（强制）

代码变动后，**必须**按 `AGENTS.md` 第 9 节触发映射表同步对应 `docs/` 文件，否则任务不算完成。关闭清单参考 `AGENTS.md` 附录 A。

### 安全 / 禁止操作

- ❌ 提交 `.env` / `storage/` / `.pgdata/` / `.redisdata/` / `node_modules/`
- ❌ 把飞书 app secret / DB 密码 / JWT secret 写进代码或可提交文档；敏感凭证一律经 env 注入（飞书为单一全局 `LARK_SSO_APP_SECRET`），`.env` 已 gitignore
- ❌ SSO 自动建账号使用硬编码默认密码（必须随机 + 飞书 IM 通知）
- ❌ 强制推送 main / master（`git push --force`）
- ❌ 跳过 git hooks（`--no-verify`）/ 跳过签名（`-c commit.gpgsign=false`）
- ❌ 在仓库里运行 `prisma migrate reset` / `db push --accept-data-loss`
- ❌ 生产环境直接修改数据库 / 在 render worker 运行时手动改 `render_jobs` 状态
- ❌ 引入不在技术栈表中的主要依赖（需先更新 `AGENTS.md` 第 3 节）

### 用户指令优先

- **AGENTS.md 和本文件的规则可被用户的显式指令覆盖**
- 若用户当前要求与文档冲突，以用户当前要求为准，并在回复中指出冲突
- 永远不要假设用户忘记了规则，而是假设他们有理由临时豁免

---

## 任务完成前自检

```
[ ] 代码改动是否最小化、是否复用现有工具？
[ ] pnpm typecheck 通过？关键路径（设计器/打印/登录/渲染）手测？
[ ] 按 AGENTS.md 第 9 节触发映射表同步了 docs/ 文档？
[ ] docs/PROGRESS.md 第 3 节"近期变更"已追加，"最近更新"日期已同步？
[ ] commit 消息符合前缀规范（feat / fix / refactor / docs / chore / perf）？
[ ] 没有提交 .env / storage / 测试输出等忽略文件？
```

---

**剩余所有细节（技术栈、目录、命令、协作原则、Git 规范、文档协议、迭代工作流）全部在 `AGENTS.md` 中。**
