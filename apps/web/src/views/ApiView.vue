<script setup lang="ts">
import { ref, onMounted, computed, onBeforeUnmount, nextTick } from 'vue';
// eslint-disable-next-line import/no-unresolved
import { ElMessage } from 'element-plus';
// eslint-disable-next-line import/no-unresolved
import { ChevronDown, ChevronRight, Code as CodeIcon } from 'lucide-vue-next';
// eslint-disable-next-line import/no-unresolved
import { apiFetch } from '../lib/api';

interface TemplateListItem {
  id: string;
  name: string;
  description: string | null;
  updatedAt: string;
}

interface TemplateDetail extends TemplateListItem {
  data: {
    schema?: { fields?: Record<string, FieldDef> } | Record<string, FieldDef>;
  };
}

interface FieldDef {
  type: string;
  label?: string;
  required?: boolean;
  example?: unknown;
  options?: Array<{ value: string; label: string }>;
}

const templates = ref<TemplateListItem[]>([]);
const detailCache = ref<Record<string, TemplateDetail>>({});
const expanded = ref<Record<string, boolean>>({});
const loading = ref(true);

async function ensureDetail(id: string): Promise<void> {
  if (detailCache.value[id]) return;
  try {
    const d = await apiFetch<TemplateDetail>(`/templates/${id}`);
    detailCache.value[id] = d;
  } catch (e) {
    ElMessage.error(`加载模板详情失败：${(e as Error).message}`);
  }
}

async function toggle(id: string): Promise<void> {
  expanded.value[id] = !expanded.value[id];
  if (expanded.value[id]) await ensureDetail(id);
}

function fieldsOf(id: string): Array<{ key: string; def: FieldDef }> {
  const d = detailCache.value[id];
  if (!d?.data?.schema) return [];
  const s = d.data.schema as Record<string, unknown>;
  const fieldsMap = (s.fields && typeof s.fields === 'object' ? s.fields : s) as Record<
    string,
    FieldDef
  >;
  return Object.entries(fieldsMap)
    .filter(([, v]) => v && typeof v === 'object' && (v as FieldDef).type)
    .map(([key, def]) => ({ key, def }));
}

onMounted(async () => {
  try {
    templates.value = await apiFetch<TemplateListItem[]>('/templates');
  } finally {
    loading.value = false;
  }
});

const hasTemplates = computed(() => templates.value.length > 0);

// --- TOC ---
interface TocItem {
  id: string;
  title: string;
  sub?: boolean;
}
const sections: TocItem[] = [
  { id: 'templates', title: '模板列表' },
  { id: 'auth', title: '鉴权' },
  { id: 'endpoints', title: '接口列表' },
  { id: 'ep-enqueue', title: 'POST /api/render', sub: true },
  { id: 'ep-get-job', title: 'GET /api/render/:jobId', sub: true },
  { id: 'ep-lark-trigger', title: 'POST /lark/print-trigger', sub: true },
];

const activeToc = ref<string>('templates');

function jumpTo(id: string): void {
  const el = document.getElementById(id);
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// IntersectionObserver — 高亮当前可见的 section
let observer: IntersectionObserver | null = null;
onMounted(() => {
  void nextTick(() => {
    const scrollRoot = document.querySelector('.view-root > .page-body');
    observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) activeToc.value = visible[0].target.id;
      },
      { root: scrollRoot, rootMargin: '-96px 0px -60% 0px', threshold: 0 },
    );
    for (const s of sections) {
      const el = document.getElementById(s.id);
      if (el) observer.observe(el);
    }
  });
});
onBeforeUnmount(() => {
  observer?.disconnect();
});

// --- endpoint 折叠 ---
const epOpen = ref<Record<string, boolean>>({
  'ep-enqueue': true,
  'ep-get-job': false,
  'ep-lark-trigger': false,
});
function toggleEp(id: string): void {
  epOpen.value[id] = !epOpen.value[id];
}
</script>

<template>
  <div class="view-root">
    <!-- ============ Page bar ============ -->
    <header class="page-bar">
      <div class="page-title">
        <span class="ico"><CodeIcon :size="20" :stroke-width="1.5" /></span>
        API
      </div>
      <div class="page-sub">DEVELOPER · REFERENCE</div>
      <div class="page-bar-spacer"></div>
    </header>

    <!-- ============ Body ============ -->
    <div class="page-body narrow">
      <div class="api-layout">
        <!-- 左侧 TOC -->
        <aside class="toc">
          <div class="toc-head">API 文档 · Docs</div>
          <nav>
            <a
              v-for="s in sections"
              :key="s.id"
              href="#"
              :class="{ active: activeToc === s.id, sub: s.sub }"
              @click.prevent="jumpTo(s.id)"
            >
              {{ s.title }}
            </a>
          </nav>
        </aside>

        <!-- 右侧 docs -->
        <article class="docs">
          <h1>API</h1>
          <div class="h-cap">REST · BEARER TOKEN · 飞书 WEBHOOK</div>

          <!-- ============ 模板列表 ============ -->
          <section id="templates">
            <h2>模板列表 <span class="han">· Templates</span></h2>
            <p>
              下面列出当前账号可访问的模板及其自定义字段（<code>schema.fields</code>）。模板 ID
              在「模板中心」打开模板时也会出现在 URL 上。
            </p>

            <div v-if="loading" class="card">
              <div class="empty-state">
                <div class="eyebrow">Loading · 加载中</div>
              </div>
            </div>
            <div v-else-if="!hasTemplates" class="card">
              <div class="empty-state">
                <div class="eyebrow">No templates · 暂无模板</div>
                <div class="msg">当前没有模板。请先在「模板中心」创建。</div>
              </div>
            </div>
            <div v-else class="card">
              <div class="card-body flush">
                <div class="tpl-row head">
                  <div>模板</div>
                  <div>自定义字段 (schema.fields)</div>
                </div>
                <template v-for="t in templates" :key="t.id">
                  <div class="tpl-row" @click="toggle(t.id)">
                    <div>
                      <div class="name">{{ t.name }}</div>
                      <div class="id">{{ t.id }}</div>
                    </div>
                    <div>
                      <a v-if="!detailCache[t.id]" class="expand">
                        <component
                          :is="expanded[t.id] ? ChevronDown : ChevronRight"
                          :size="12"
                          :stroke-width="2"
                        />
                        点击展开查看字段
                      </a>
                      <div v-else-if="fieldsOf(t.id).length === 0" class="field-hint">
                        （该模板无自定义字段，data 传 <code>{}</code> 即可）
                      </div>
                      <ul v-else class="field-list">
                        <li v-for="f in fieldsOf(t.id)" :key="f.key">
                          <div class="field-row">
                            <code class="field-key">{{ f.key }}</code>
                            <span class="field-type">{{ f.def.type }}</span>
                            <span v-if="f.def.required" class="field-required">必填</span>
                          </div>
                          <div v-if="f.def.label" class="field-meta">标签：{{ f.def.label }}</div>
                          <div v-if="f.def.example !== undefined" class="field-meta">
                            示例：<code>{{ String(f.def.example) }}</code>
                          </div>
                          <div v-if="f.def.options?.length" class="field-meta">
                            可选：{{ f.def.options.map((o) => o.value).join(' / ') }}
                          </div>
                        </li>
                      </ul>
                    </div>
                  </div>
                  <div v-if="expanded[t.id] && detailCache[t.id]" class="tpl-schema">
                    <details>
                      <summary>完整 schema JSON</summary>
                      <pre class="code">{{
                        JSON.stringify(detailCache[t.id]?.data?.schema ?? {}, null, 2)
                      }}</pre>
                    </details>
                  </div>
                </template>
              </div>
            </div>
          </section>

          <!-- ============ 鉴权 ============ -->
          <section id="auth">
            <h2>鉴权 <span class="han">· Auth</span></h2>
            <p>
              <code>POST /api/render</code> 与 <code>GET /api/render/:jobId</code> 使用
              <strong>Bearer API Token</strong>；飞书 webhook 类（<code>/lark/print-trigger</code>）
              使用 body 中的 <code>verificationToken</code>，由服务端 <code>.env</code> 配置共享。
            </p>

            <div class="callout">
              <div class="cap">METHOD 1 · 标准接口</div>
              <div class="title">Bearer API Token</div>
              <div class="desc">每个请求加请求头：</div>
            </div>

            <pre class="code">
<span class="k">Authorization:</span> <span class="v">Bearer tpkn_a1b2c3d4e5f60718a9bcdef0123456789</span></pre>

            <ul>
              <li>
                <strong>Token 格式：</strong><code>tpkn_</code> 前缀 + 32 hex 字符。
                前缀方便日志检索 / 误提交检测。
              </li>
              <li>
                <strong>管理位置：</strong>
                <a href="#" @click.prevent="$router.push('/me/api-tokens')">个人中心 → API 凭证</a>
                （创建 / 命名 / 查看最近使用 / 立即吊销）。
              </li>
              <li><strong>Token 仅创建时显示一次</strong>，DB 中以 SHA-256 哈希存储。</li>
              <li>浏览器场景（设计器内置调用）仍兼容 cookie；服务端 guard 优先 Bearer。</li>
            </ul>

            <div class="callout" style="margin-top: 24px">
              <div class="cap">METHOD 2 · 飞书集成</div>
              <div class="title">Webhook verification token</div>
              <div class="desc">
                飞书后台事件订阅 / 卡片回调 / 自动化 webhook 在 body 内传一个共享 token， 服务端从
                <code>.env</code> 读取并校验。不需要用户级 token。
              </div>
            </div>
          </section>

          <!-- ============ 接口列表 ============ -->
          <section id="endpoints">
            <h2>接口列表 <span class="han">· Endpoints</span></h2>

            <!-- POST /api/render -->
            <div id="ep-enqueue" class="endpoint">
              <div class="endpoint-head" @click="toggleEp('ep-enqueue')">
                <span class="method post">POST</span>
                <span class="endpoint-path">/api/render</span>
                <span class="endpoint-desc">入队渲染 (异步)</span>
                <span class="chev">
                  <component
                    :is="epOpen['ep-enqueue'] ? ChevronDown : ChevronRight"
                    :size="14"
                    :stroke-width="1.5"
                  />
                </span>
              </div>
              <div v-show="epOpen['ep-enqueue']" class="endpoint-body">
                <p>
                  把渲染任务入队，立即返回 <code>jobId</code>（异步）。完成时通过
                  <code>callbackUrl</code> 收 webhook，或主动轮询 GET 接口。鉴权方式见
                  <a href="#" @click.prevent="jumpTo('auth')">鉴权章节</a>。
                </p>

                <h3>请求头 · Headers</h3>
                <table class="spec">
                  <thead>
                    <tr>
                      <th>字段</th>
                      <th>必需</th>
                      <th>说明</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td class="code">Authorization</td>
                      <td class="req">是</td>
                      <td><code>Bearer &lt;token&gt;</code></td>
                    </tr>
                    <tr>
                      <td class="code">Content-Type</td>
                      <td class="req">是</td>
                      <td><code>application/json</code></td>
                    </tr>
                    <tr>
                      <td class="code">X-Idempotency-Key</td>
                      <td class="req">否</td>
                      <td>幂等键，避免重复入队（推荐）</td>
                    </tr>
                  </tbody>
                </table>

                <h3>请求体 · Body</h3>
                <table class="spec">
                  <thead>
                    <tr>
                      <th>字段</th>
                      <th>类型</th>
                      <th>必需</th>
                      <th>说明</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td class="code">templateId</td>
                      <td class="type">string (UUID)</td>
                      <td class="req">是</td>
                      <td>模板 ID（在「模板中心」打开模板时 URL 上有）</td>
                    </tr>
                    <tr>
                      <td class="code">data</td>
                      <td class="type">object</td>
                      <td class="req">否</td>
                      <td>业务字段 map，key 对应模板 schema.fields；默认 <code>{}</code></td>
                    </tr>
                    <tr>
                      <td class="code">formats</td>
                      <td class="type">string[]</td>
                      <td class="req">否</td>
                      <td>导出格式，默认 <code>["pdf"]</code>，可加 <code>"png"</code></td>
                    </tr>
                    <tr>
                      <td class="code">callbackUrl</td>
                      <td class="type">string</td>
                      <td class="req">否</td>
                      <td>完成时回调地址</td>
                    </tr>
                  </tbody>
                </table>

                <h3>请求示例</h3>
                <pre class="code">
{
  "templateId": "e0798b17-5d90-449a-b881-f5c0dc13d6b3",
  "data": { "group": "扬机", "material_num": "10100" },
  "formats": ["pdf"],
  "callbackUrl": "https://your-server.com/print-callback"
}</pre
                >

                <h3>响应体（200）</h3>
                <table class="spec">
                  <thead>
                    <tr>
                      <th>字段</th>
                      <th>类型</th>
                      <th>说明</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td class="code">jobId</td>
                      <td class="type">string (UUID)</td>
                      <td>渲染任务 ID，后续查询 / callback 中关联</td>
                    </tr>
                    <tr>
                      <td class="code">status</td>
                      <td class="type">string</td>
                      <td>初始固定为 <code>"pending"</code></td>
                    </tr>
                  </tbody>
                </table>
                <pre class="code">{ "jobId": "abc-123-...", "status": "pending" }</pre>

                <h3>Webhook 回调 payload</h3>
                <p>渲染完成（成功 / 失败）后，平台 POST 以下结构到 <code>callbackUrl</code>：</p>
                <pre class="code">
{
  "jobId": "abc-123-...",
  "status": "done" | "failed",
  "pdfUrl": "/uploads/render/abc-123.pdf" | null,
  "pngUrl": "/uploads/render/abc-123.png" | null,
  "errorMsg": null | "..."
}</pre
                >

                <h3>错误码</h3>
                <table class="spec">
                  <thead>
                    <tr>
                      <th>HTTP</th>
                      <th>错误</th>
                      <th>原因</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td class="code">400</td>
                      <td class="type">BAD_REQUEST</td>
                      <td>请求体校验失败（templateId / data 等格式问题）</td>
                    </tr>
                    <tr>
                      <td class="code">401</td>
                      <td class="type">UNAUTHORIZED</td>
                      <td>无 Bearer / token 失效 / cookie 无效</td>
                    </tr>
                    <tr>
                      <td class="code">404</td>
                      <td class="type">template_not_found</td>
                      <td>templateId 不存在或当前用户无权限</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            <!-- GET /api/render/:jobId -->
            <div id="ep-get-job" class="endpoint">
              <div class="endpoint-head" @click="toggleEp('ep-get-job')">
                <span class="method get">GET</span>
                <span class="endpoint-path">/api/render/:jobId</span>
                <span class="endpoint-desc">查询渲染状态</span>
                <span class="chev">
                  <component
                    :is="epOpen['ep-get-job'] ? ChevronDown : ChevronRight"
                    :size="14"
                    :stroke-width="1.5"
                  />
                </span>
              </div>
              <div v-show="epOpen['ep-get-job']" class="endpoint-body">
                <p>查询渲染任务当前状态。对 webhook 不便接入的调用方提供轮询路径。</p>

                <h3>路径参数</h3>
                <table class="spec">
                  <thead>
                    <tr>
                      <th>字段</th>
                      <th>类型</th>
                      <th>说明</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td class="code">jobId</td>
                      <td class="type">string (UUID)</td>
                      <td>POST 时返回的任务 ID</td>
                    </tr>
                  </tbody>
                </table>

                <h3>响应体（200）</h3>
                <table class="spec">
                  <thead>
                    <tr>
                      <th>字段</th>
                      <th>类型</th>
                      <th>说明</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td class="code">status</td>
                      <td class="type">string</td>
                      <td>
                        <code>pending</code> / <code>processing</code> / <code>done</code> /
                        <code>failed</code>
                      </td>
                    </tr>
                    <tr>
                      <td class="code">pdfUrl</td>
                      <td class="type">string | null</td>
                      <td>完成后才有，相对路径 <code>/uploads/render/...</code></td>
                    </tr>
                    <tr>
                      <td class="code">errorMsg</td>
                      <td class="type">string | null</td>
                      <td>失败时含错误描述</td>
                    </tr>
                  </tbody>
                </table>
                <pre class="code">
{
  "jobId": "abc-123-...",
  "status": "done",
  "pdfUrl": "/uploads/render/abc-123.pdf",
  "pngUrl": null,
  "errorMsg": null,
  "createdAt": "2026-05-24T10:30:00Z",
  "completedAt": "2026-05-24T10:30:02Z"
}</pre
                >
              </div>
            </div>

            <!-- POST /lark/print-trigger -->
            <div id="ep-lark-trigger" class="endpoint">
              <div class="endpoint-head" @click="toggleEp('ep-lark-trigger')">
                <span class="method post">POST</span>
                <span class="endpoint-path">/lark/print-trigger</span>
                <span class="endpoint-desc">飞书多维表格按钮 webhook</span>
                <span class="chev">
                  <component
                    :is="epOpen['ep-lark-trigger'] ? ChevronDown : ChevronRight"
                    :size="14"
                    :stroke-width="1.5"
                  />
                </span>
              </div>
              <div v-show="epOpen['ep-lark-trigger']" class="endpoint-body">
                <p>
                  飞书多维表格按钮自动化的 webhook 入口。详细接入步骤见
                  <code>examples/lark-bitable/README.md</code>。
                </p>

                <h3>鉴权</h3>
                <p>
                  无需登录。通过 body 内 <code>verificationToken</code> 校验调用方（与服务端
                  <code>.env</code> 里的 <code>LARK_BITABLE_VERIFICATION_TOKEN</code> 对齐）。
                </p>

                <h3>请求体 · Body</h3>
                <table class="spec">
                  <thead>
                    <tr>
                      <th>字段</th>
                      <th>类型</th>
                      <th>必需</th>
                      <th>说明</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td class="code">verificationToken</td>
                      <td class="type">string</td>
                      <td class="req">是</td>
                      <td>服务端配置的共享 token</td>
                    </tr>
                    <tr>
                      <td class="code">templateId</td>
                      <td class="type">string (UUID)</td>
                      <td class="req">是</td>
                      <td>模板 ID</td>
                    </tr>
                    <tr>
                      <td class="code">data</td>
                      <td class="type">object</td>
                      <td class="req">否</td>
                      <td v-pre>
                        业务字段 map（从飞书自动化变量 <code>{{ 字段.xxx }}</code> 引用）
                      </td>
                    </tr>
                    <tr>
                      <td class="code">lark.appToken</td>
                      <td class="type">string</td>
                      <td class="req">是</td>
                      <td>多维表格 app_token</td>
                    </tr>
                    <tr>
                      <td class="code">lark.tableId</td>
                      <td class="type">string</td>
                      <td class="req">是</td>
                      <td>表 ID</td>
                    </tr>
                    <tr>
                      <td class="code">lark.recordId</td>
                      <td class="type">string</td>
                      <td class="req">是</td>
                      <td>当前行 record_id</td>
                    </tr>
                    <tr>
                      <td class="code">lark.statusField</td>
                      <td class="type">string</td>
                      <td class="req">是</td>
                      <td>"打印状态" 单选列的列名</td>
                    </tr>
                    <tr>
                      <td class="code">lark.attachmentField</td>
                      <td class="type">string</td>
                      <td class="req">是</td>
                      <td>"PDF 附件" 附件列的列名</td>
                    </tr>
                  </tbody>
                </table>

                <h3>行为</h3>
                <ul>
                  <li>立即落 LarkPrintRequest 记录 + 入队渲染</li>
                  <li>异步把多维表格 <code>statusField</code> 改为 <code>处理中</code></li>
                  <li>
                    渲染完成 → 上传 PDF 到飞书云空间 → 写回 <code>attachmentField</code> +
                    <code>statusField = 已完成</code>
                  </li>
                  <li>失败 → <code>statusField = 失败</code></li>
                </ul>
              </div>
            </div>
          </section>
        </article>
      </div>
    </div>
  </div>
</template>

<style scoped>
.view-root {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.api-layout {
  display: grid;
  grid-template-columns: 240px 1fr;
  gap: 32px;
  max-width: 1240px;
  margin: 0 auto;
}

/* ============ TOC ============ */
.toc {
  position: sticky;
  top: 32px;
  align-self: start;
  border-left: 1px solid var(--stone);
}
.toc-head {
  font-family: var(--font-sans);
  font-size: 10px;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: var(--tr-caption);
  color: var(--fg-3);
  padding: 0 0 12px 16px;
}
.toc nav {
  display: flex;
  flex-direction: column;
}
.toc a {
  display: block;
  padding: 6px 0 6px 16px;
  margin-left: -1px;
  border-left: 1px solid transparent;
  font-family: var(--font-han);
  font-size: 13px;
  color: var(--fg-2);
  text-decoration: none;
  transition:
    color var(--dur-fast) var(--ease-default),
    border-color var(--dur-fast) var(--ease-default);
  cursor: pointer;
}
.toc a:hover {
  color: var(--ink);
}
.toc a.active {
  color: var(--yangli-red);
  border-left-color: var(--yangli-red);
  font-weight: 500;
}
.toc a.sub {
  padding-left: 32px;
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--fg-3);
}
.toc a.sub:hover {
  color: var(--ink);
}
.toc a.sub.active {
  color: var(--yangli-red);
  border-left-color: var(--yangli-red);
}

/* ============ Docs ============ */
.docs h1 {
  font-size: 36px;
  font-weight: 700;
  color: var(--ink);
  letter-spacing: -0.015em;
  margin: 0 0 8px;
}
.docs .h-cap {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--fg-3);
  letter-spacing: 0.08em;
  text-transform: uppercase;
  margin-bottom: 32px;
}
.docs section {
  margin-bottom: 56px;
}
.docs h2 {
  font-size: 22px;
  font-weight: 600;
  color: var(--ink);
  margin: 0 0 12px;
  display: flex;
  align-items: baseline;
  gap: 12px;
}
.docs h2 .han {
  font-family: var(--font-han);
  font-size: 14px;
  color: var(--fg-3);
  font-weight: 400;
}
.docs p {
  font-family: var(--font-han);
  font-size: 14px;
  color: var(--fg-2);
  line-height: 1.85;
  margin: 0 0 14px;
}
.docs p code {
  font-size: 12.5px;
}
.docs ul {
  font-family: var(--font-han);
  font-size: 13.5px;
  color: var(--fg-2);
  line-height: 1.85;
  padding-left: 22px;
  margin: 0 0 14px;
}
.docs ul li::marker {
  color: var(--yangli-red);
}
.docs h3 {
  font-size: 14px;
  font-weight: 600;
  color: var(--ink);
  margin: 22px 0 10px;
  font-family: var(--font-sans);
}
.docs a {
  color: var(--ink);
  border-bottom: 1px solid var(--yangli-red);
  text-decoration: none;
  cursor: pointer;
}
.docs a:hover {
  color: var(--yangli-red);
}

/* Spec tables */
table.spec {
  width: 100%;
  border-collapse: collapse;
  border: 1px solid var(--stone);
  margin: 6px 0 18px;
  background: var(--paper-white);
}
table.spec th {
  text-align: left;
  font-family: var(--font-sans);
  font-size: 10.5px;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: var(--tr-caption);
  color: var(--fg-3);
  padding: 10px 14px;
  border-bottom: 1px solid var(--stone);
  background: var(--mist);
}
table.spec td {
  padding: 11px 14px;
  border-bottom: 1px solid var(--stone);
  font-family: var(--font-han);
  font-size: 13px;
  color: var(--fg-1);
  vertical-align: top;
}
table.spec tr:last-child td {
  border-bottom: 0;
}
table.spec td.code {
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--ink);
  width: 22%;
}
table.spec td.type {
  font-family: var(--font-mono);
  font-size: 11.5px;
  color: var(--fg-3);
  width: 18%;
}
table.spec td.req {
  width: 8%;
  text-align: center;
  font-family: var(--font-han);
  color: var(--ink);
}

/* Code block */
pre.code {
  margin: 6px 0 14px;
  padding: 16px 20px;
  background: var(--ink);
  color: var(--paper-white);
  font-family: var(--font-mono);
  font-size: 13px;
  line-height: 1.6;
  border-radius: var(--radius-2);
  overflow-x: auto;
  border: 1px solid var(--ink);
  white-space: pre;
}
pre.code :deep(.k) {
  color: #dcd8d2;
}
pre.code :deep(.v) {
  color: #ffffff;
}
pre.code :deep(.c) {
  color: var(--iron);
}

/* Endpoint card */
.endpoint {
  background: var(--paper-white);
  border: 1px solid var(--stone);
  border-radius: var(--radius-2);
  margin-bottom: 16px;
  overflow: hidden;
}
.endpoint-head {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 16px 20px;
  border-bottom: 1px solid var(--stone);
  background: var(--mist);
  cursor: pointer;
  user-select: none;
}
.endpoint-head:hover {
  background: rgba(220, 216, 210, 0.5);
}
.method {
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  padding: 4px 10px;
  color: var(--paper-white);
  border-radius: var(--radius-1);
}
.method.post {
  background: #0f8c5a;
}
.method.get {
  background: var(--yangli-graphite);
}
.endpoint-path {
  font-family: var(--font-mono);
  font-size: 14px;
  color: var(--ink);
  font-weight: 500;
}
.endpoint-desc {
  margin-left: auto;
  font-family: var(--font-han);
  font-size: 12.5px;
  color: var(--fg-3);
}
.chev {
  color: var(--fg-3);
  width: 14px;
  height: 14px;
  display: inline-flex;
  align-items: center;
  margin-left: 8px;
}
.endpoint-body {
  padding: 18px 22px 22px;
}

/* Callout */
.callout {
  background: var(--paper-white);
  border: 1px solid var(--stone);
  border-top: 2px solid var(--yangli-red);
  padding: 18px 22px;
  margin-bottom: 18px;
}
.callout .cap {
  font-family: var(--font-sans);
  font-size: 10.5px;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: var(--tr-caption);
  color: var(--yangli-red);
  margin-bottom: 6px;
}
.callout .title {
  font-family: var(--font-han);
  font-size: 15px;
  color: var(--ink);
  font-weight: 600;
  margin-bottom: 4px;
}
.callout .desc {
  font-family: var(--font-han);
  font-size: 13px;
  color: var(--fg-2);
  line-height: 1.75;
}

/* Template list row */
.tpl-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  padding: 16px 18px;
  border-bottom: 1px solid var(--stone);
  gap: 24px;
  align-items: start;
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease-default);
}
.tpl-row:hover {
  background: rgba(220, 216, 210, 0.25);
}
.tpl-row.head {
  background: var(--mist);
  font-family: var(--font-sans);
  font-size: 10.5px;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: var(--tr-caption);
  color: var(--fg-3);
  padding: 12px 18px;
  cursor: default;
}
.tpl-row.head:hover {
  background: var(--mist);
}
.tpl-row:last-child {
  border-bottom: 0;
}
.tpl-row .name {
  font-family: var(--font-han);
  font-size: 14px;
  color: var(--ink);
  font-weight: 500;
}
.tpl-row .id {
  font-family: var(--font-mono);
  font-size: 11.5px;
  color: var(--fg-3);
  margin-top: 4px;
  letter-spacing: 0.02em;
  word-break: break-all;
}
.tpl-row .expand {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-family: var(--font-han);
  font-size: 13px;
  color: var(--ink);
  text-decoration: none;
  border-bottom: 1px solid transparent;
  cursor: pointer;
}
.tpl-row .expand:hover {
  color: var(--yangli-red);
  border-bottom-color: var(--yangli-red);
}
.tpl-row .expand svg {
  color: var(--fg-3);
}

.field-hint {
  font-family: var(--font-han);
  font-size: 12.5px;
  color: var(--fg-3);
  line-height: 1.7;
}
.field-list {
  list-style: none;
  padding: 0;
  margin: 0;
}
.field-list li {
  margin-bottom: 8px;
  padding-bottom: 8px;
  border-bottom: 1px dashed var(--stone);
}
.field-list li:last-child {
  margin-bottom: 0;
  border-bottom: 0;
}
.field-list li::marker {
  content: '';
}
.field-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.field-key {
  font-family: var(--font-mono);
  font-size: 12.5px;
  color: var(--ink);
  background: var(--mist);
  border: 1px solid var(--stone);
  padding: 1px 6px;
  border-radius: var(--radius-1);
}
.field-type {
  font-family: var(--font-mono);
  font-size: 11.5px;
  color: var(--fg-3);
}
.field-required {
  font-family: var(--font-han);
  font-size: 11px;
  color: var(--yangli-red);
  padding: 1px 6px;
  border: 1px solid var(--yangli-red);
  border-radius: var(--radius-1);
}
.field-meta {
  font-family: var(--font-han);
  font-size: 12px;
  color: var(--fg-3);
  margin-top: 3px;
}
.field-meta code {
  font-family: var(--font-mono);
  font-size: 11.5px;
}

.tpl-schema {
  padding: 8px 18px 16px;
  border-bottom: 1px solid var(--stone);
}
.tpl-schema summary {
  cursor: pointer;
  font-family: var(--font-sans);
  font-size: 11px;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: var(--tr-caption);
  color: var(--fg-3);
}
.tpl-schema summary:hover {
  color: var(--ink);
}
.tpl-schema pre.code {
  margin-top: 8px;
  max-height: 280px;
  overflow: auto;
}
</style>
