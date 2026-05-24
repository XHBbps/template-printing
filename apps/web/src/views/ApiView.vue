<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
// eslint-disable-next-line import/no-unresolved
import { ElMessage } from 'element-plus';
// eslint-disable-next-line import/no-unresolved
import { Copy, ChevronDown, ChevronRight } from 'lucide-vue-next';
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
  // 兼容 schema.fields wrapper 与设计器实际存的 schema.<key> 两种形态
  const s = d.data.schema as Record<string, unknown>;
  const fieldsMap = (s.fields && typeof s.fields === 'object' ? s.fields : s) as Record<
    string,
    FieldDef
  >;
  return Object.entries(fieldsMap)
    .filter(([, v]) => v && typeof v === 'object' && (v as FieldDef).type)
    .map(([key, def]) => ({ key, def }));
}

async function copy(text: string, label = '已复制'): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    ElMessage.success(label);
  } catch {
    ElMessage.error('复制失败');
  }
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
const sections = [
  { id: 'templates', title: '模板列表' },
  { id: 'endpoints', title: '接口列表' },
  { id: 'ep-enqueue', title: 'POST /api/render', indent: true },
  { id: 'ep-get-job', title: 'GET /api/render/:jobId', indent: true },
  { id: 'ep-lark-trigger', title: 'POST /lark/print-trigger', indent: true },
];

function jumpTo(id: string): void {
  const el = document.getElementById(id);
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
</script>

<template>
  <div class="api-page">
    <!-- 左侧 TOC -->
    <aside class="api-toc">
      <div class="api-toc-title">API 文档</div>
      <ul class="api-toc-list">
        <li
          v-for="s in sections"
          :key="s.id"
          :class="{ 'api-toc-item': true, 'api-toc-item--indent': s.indent }"
          @click="jumpTo(s.id)"
        >
          {{ s.title }}
        </li>
      </ul>
    </aside>

    <!-- 主体 -->
    <div class="api-main">
      <h1 class="api-page-title">API</h1>

      <!-- ============ 模板列表 ============ -->
      <section id="templates" class="api-section">
        <h2 class="api-h2">模板列表</h2>

        <div v-if="loading" class="api-loading">加载中…</div>
        <div v-else-if="!hasTemplates" class="api-empty">
          当前没有模板。请先在「模板中心」创建模板。
        </div>

        <table v-else class="api-table">
          <thead>
            <tr>
              <th style="width: 30%">模板</th>
              <th>自定义字段（schema.fields）</th>
            </tr>
          </thead>
          <tbody>
            <template v-for="t in templates" :key="t.id">
              <tr class="api-row" @click="toggle(t.id)">
                <td>
                  <div class="api-tpl-name">{{ t.name }}</div>
                  <div class="api-tpl-id">
                    <code>{{ t.id }}</code>
                    <button
                      class="api-copy-btn"
                      title="复制模板 ID"
                      @click.stop="copy(t.id, '已复制模板 ID')"
                    >
                      <Copy :size="11" :stroke-width="2" />
                    </button>
                  </div>
                </td>
                <td>
                  <div v-if="!detailCache[t.id]" class="api-field-hint">
                    <component
                      :is="expanded[t.id] ? ChevronDown : ChevronRight"
                      :size="14"
                      :stroke-width="2"
                    />
                    点击展开查看字段
                  </div>
                  <div v-else-if="fieldsOf(t.id).length === 0" class="api-field-hint">
                    （该模板无自定义字段，data 传 <code>{}</code> 即可）
                  </div>
                  <ul v-else class="api-field-list">
                    <li v-for="f in fieldsOf(t.id)" :key="f.key">
                      <div class="api-field-row">
                        <code class="api-field-key">{{ f.key }}</code>
                        <span class="api-field-type">{{ f.def.type }}</span>
                        <span v-if="f.def.required" class="api-field-required">必填</span>
                      </div>
                      <div v-if="f.def.label" class="api-field-meta">标签：{{ f.def.label }}</div>
                      <div v-if="f.def.example !== undefined" class="api-field-meta">
                        示例：<code>{{ String(f.def.example) }}</code>
                      </div>
                      <div v-if="f.def.options?.length" class="api-field-meta">
                        可选：{{ f.def.options.map((o) => o.value).join(' / ') }}
                      </div>
                    </li>
                  </ul>
                </td>
              </tr>
              <tr v-if="expanded[t.id] && detailCache[t.id]" class="api-row-expanded">
                <td colspan="2">
                  <details>
                    <summary>完整 schema JSON</summary>
                    <pre class="api-code">{{
                      JSON.stringify(detailCache[t.id]?.data?.schema ?? {}, null, 2)
                    }}</pre>
                  </details>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </section>

      <!-- ============ 接口列表 ============ -->
      <section id="endpoints" class="api-section">
        <h2 class="api-h2">接口列表</h2>
        <p class="api-section-intro">外部调用方（开发 / 集成方 / 自动化）可使用的 3 个端点。</p>

        <!-- POST /api/render -->
        <article id="ep-enqueue" class="api-endpoint-card">
          <div class="api-ep-head">
            <span class="api-method api-method--post">POST</span>
            <code class="api-ep-path">/api/render</code>
          </div>
          <p class="api-ep-desc">
            把渲染任务入队，立即返回 jobId（异步）。完成时可通过 callbackUrl 收 webhook，或主动轮询
            GET 接口。
          </p>

          <h3 class="api-h3">鉴权</h3>
          <p class="api-auth">
            需要登录 cookie + CSRF。系统调用（如飞书 webhook 内部转调）可绕过 ownership 检查。
          </p>

          <h3 class="api-h3">请求头</h3>
          <table class="api-spec-table">
            <thead>
              <tr>
                <th>字段</th>
                <th>必需</th>
                <th>说明</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><code>Content-Type</code></td>
                <td>是</td>
                <td><code>application/json</code></td>
              </tr>
              <tr>
                <td><code>Cookie</code></td>
                <td>是</td>
                <td>含 <code>tp_access</code> 鉴权 cookie</td>
              </tr>
              <tr>
                <td><code>X-CSRF-Token</code></td>
                <td>是</td>
                <td>CSRF token（登录返回 / cookie 中的 tp_csrf）</td>
              </tr>
            </tbody>
          </table>

          <h3 class="api-h3">请求体</h3>
          <table class="api-spec-table">
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
                <td><code>templateId</code></td>
                <td>string (UUID)</td>
                <td>是</td>
                <td>模板 ID（在「模板中心」打开模板时 URL 上有）</td>
              </tr>
              <tr>
                <td><code>data</code></td>
                <td>object</td>
                <td>否</td>
                <td>业务字段 map，key 对应模板 schema.fields 的 key；默认 <code>{}</code></td>
              </tr>
              <tr>
                <td><code>formats</code></td>
                <td>string[]</td>
                <td>否</td>
                <td>导出格式，默认 <code>["pdf"]</code>，可加 <code>"png"</code></td>
              </tr>
              <tr>
                <td><code>callbackUrl</code></td>
                <td>string (URL)</td>
                <td>否</td>
                <td>渲染完成后 POST 通知此 URL（可选）</td>
              </tr>
            </tbody>
          </table>

          <h3 class="api-h3">请求示例</h3>
          <pre class="api-code">
{
  "templateId": "e0798b17-5d90-449a-b881-f5c0dc13d6b3",
  "data": { "group": "扬机", "material_num": "10100" },
  "formats": ["pdf"],
  "callbackUrl": "https://your-server.com/print-callback"
}</pre
          >

          <h3 class="api-h3">响应体（200）</h3>
          <table class="api-spec-table">
            <thead>
              <tr>
                <th>字段</th>
                <th>类型</th>
                <th>说明</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><code>jobId</code></td>
                <td>string (UUID)</td>
                <td>渲染任务 ID，后续查询 / callback 中关联</td>
              </tr>
              <tr>
                <td><code>status</code></td>
                <td>string</td>
                <td>初始固定为 <code>"pending"</code></td>
              </tr>
            </tbody>
          </table>
          <pre class="api-code">{ "jobId": "abc-123-...", "status": "pending" }</pre>

          <h3 class="api-h3">Webhook 回调 payload</h3>
          <p class="api-tiny">
            渲染完成（成功 / 失败）后，平台 POST 以下结构到调用方传入的 <code>callbackUrl</code>：
          </p>
          <pre class="api-code">
{
  "jobId": "abc-123-...",
  "status": "done" | "failed",
  "pdfUrl": "/uploads/render/abc-123.pdf" | null,
  "pngUrl": "/uploads/render/abc-123.png" | null,
  "errorMsg": null | "..."
}</pre
          >

          <h3 class="api-h3">错误码</h3>
          <table class="api-spec-table">
            <thead>
              <tr>
                <th>HTTP</th>
                <th>错误</th>
                <th>原因</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>400</td>
                <td>BAD_REQUEST</td>
                <td>请求体校验失败（templateId / data 等格式问题）</td>
              </tr>
              <tr>
                <td>401</td>
                <td>UNAUTHORIZED</td>
                <td>未登录 / cookie 失效 / CSRF token 错</td>
              </tr>
              <tr>
                <td>404</td>
                <td>template_not_found</td>
                <td>templateId 不存在或当前用户无权限</td>
              </tr>
            </tbody>
          </table>
        </article>

        <!-- GET /api/render/:jobId -->
        <article id="ep-get-job" class="api-endpoint-card">
          <div class="api-ep-head">
            <span class="api-method api-method--get">GET</span>
            <code class="api-ep-path">/api/render/:jobId</code>
          </div>
          <p class="api-ep-desc">查询渲染任务当前状态。对 webhook 不便接入的调用方提供轮询路径。</p>

          <h3 class="api-h3">鉴权</h3>
          <p class="api-auth">需要登录 cookie。</p>

          <h3 class="api-h3">路径参数</h3>
          <table class="api-spec-table">
            <thead>
              <tr>
                <th>字段</th>
                <th>类型</th>
                <th>说明</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><code>jobId</code></td>
                <td>string (UUID)</td>
                <td>POST 时返回的任务 ID</td>
              </tr>
            </tbody>
          </table>

          <h3 class="api-h3">响应体（200）</h3>
          <table class="api-spec-table">
            <thead>
              <tr>
                <th>字段</th>
                <th>类型</th>
                <th>说明</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><code>jobId</code></td>
                <td>string</td>
                <td>任务 ID</td>
              </tr>
              <tr>
                <td><code>status</code></td>
                <td>string</td>
                <td>
                  <code>pending</code> / <code>processing</code> / <code>done</code> /
                  <code>failed</code>
                </td>
              </tr>
              <tr>
                <td><code>pdfUrl</code></td>
                <td>string | null</td>
                <td>完成后才有，相对路径 <code>/uploads/render/...</code></td>
              </tr>
              <tr>
                <td><code>pngUrl</code></td>
                <td>string | null</td>
                <td>同上</td>
              </tr>
              <tr>
                <td><code>errorMsg</code></td>
                <td>string | null</td>
                <td>失败时含错误描述</td>
              </tr>
              <tr>
                <td><code>createdAt</code></td>
                <td>ISO 8601</td>
                <td>入队时间</td>
              </tr>
              <tr>
                <td><code>completedAt</code></td>
                <td>ISO 8601 | null</td>
                <td>完成时间</td>
              </tr>
            </tbody>
          </table>
          <pre class="api-code">
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

          <h3 class="api-h3">错误码</h3>
          <table class="api-spec-table">
            <thead>
              <tr>
                <th>HTTP</th>
                <th>错误</th>
                <th>原因</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>401</td>
                <td>UNAUTHORIZED</td>
                <td>未登录</td>
              </tr>
              <tr>
                <td>404</td>
                <td>job_not_found</td>
                <td>jobId 不存在</td>
              </tr>
            </tbody>
          </table>
        </article>

        <!-- POST /lark/print-trigger -->
        <article id="ep-lark-trigger" class="api-endpoint-card">
          <div class="api-ep-head">
            <span class="api-method api-method--post">POST</span>
            <code class="api-ep-path">/lark/print-trigger</code>
          </div>
          <p class="api-ep-desc">
            飞书多维表格按钮自动化的 webhook 入口。业务人员在飞书自动化里配此
            URL，点按钮触发渲染并自动写回 PDF 附件。详细接入步骤见
            <code>examples/lark-bitable/README.md</code>。
          </p>

          <h3 class="api-h3">鉴权</h3>
          <p class="api-auth">
            无需登录。通过 body 内 <code>verificationToken</code> 校验调用方（与服务端
            <code>.env</code> 里的 <code>LARK_BITABLE_VERIFICATION_TOKEN</code> 对齐）。
          </p>

          <h3 class="api-h3">请求头</h3>
          <table class="api-spec-table">
            <thead>
              <tr>
                <th>字段</th>
                <th>必需</th>
                <th>说明</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><code>Content-Type</code></td>
                <td>是</td>
                <td><code>application/json</code></td>
              </tr>
            </tbody>
          </table>

          <h3 class="api-h3">请求体</h3>
          <table class="api-spec-table">
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
                <td><code>verificationToken</code></td>
                <td>string</td>
                <td>是</td>
                <td>服务端配置的共享 token</td>
              </tr>
              <tr>
                <td><code>templateId</code></td>
                <td>string (UUID)</td>
                <td>是</td>
                <td>模板 ID</td>
              </tr>
              <tr>
                <td><code>data</code></td>
                <td>object</td>
                <td>否</td>
                <td v-pre>
                  业务字段 map（从飞书自动化变量 <code>{{ 字段.xxx }}</code> 引用）
                </td>
              </tr>
              <tr>
                <td><code>lark.appToken</code></td>
                <td>string</td>
                <td>是</td>
                <td>多维表格的 app_token（飞书内建变量）</td>
              </tr>
              <tr>
                <td><code>lark.tableId</code></td>
                <td>string</td>
                <td>是</td>
                <td>表 ID</td>
              </tr>
              <tr>
                <td><code>lark.recordId</code></td>
                <td>string</td>
                <td>是</td>
                <td>当前行 record_id</td>
              </tr>
              <tr>
                <td><code>lark.statusField</code></td>
                <td>string</td>
                <td>是</td>
                <td>多维表格中"打印状态"单选列的列名</td>
              </tr>
              <tr>
                <td><code>lark.attachmentField</code></td>
                <td>string</td>
                <td>是</td>
                <td>多维表格中"PDF 附件"附件列的列名</td>
              </tr>
            </tbody>
          </table>

          <h3 class="api-h3">请求示例</h3>
          <pre class="api-code" v-pre>
{
  "verificationToken": "126dc1303ab9cf90...",
  "templateId": "e0798b17-...",
  "data": { "group": "扬机" },
  "lark": {
    "appToken": "{{ 多维表格.app_token }}",
    "tableId": "{{ 多维表格.table_id }}",
    "recordId": "{{ 当前记录.record_id }}",
    "statusField": "打印状态",
    "attachmentField": "PDF 附件"
  }
}</pre
          >

          <h3 class="api-h3">响应体（200）</h3>
          <table class="api-spec-table">
            <thead>
              <tr>
                <th>字段</th>
                <th>类型</th>
                <th>说明</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><code>jobId</code></td>
                <td>string</td>
                <td>渲染任务 ID</td>
              </tr>
              <tr>
                <td><code>status</code></td>
                <td>string</td>
                <td>初始 <code>"pending"</code></td>
              </tr>
            </tbody>
          </table>

          <h3 class="api-h3">行为</h3>
          <ul class="api-behavior-list">
            <li>立即落 LarkPrintRequest 记录 + 入队渲染</li>
            <li>异步把多维表格 <code>statusField</code> 改为 <code>处理中</code></li>
            <li>
              渲染完成 → 上传 PDF 到飞书云空间 → 写回 <code>attachmentField</code> +
              <code>statusField = 已完成</code>
            </li>
            <li>失败 → <code>statusField = 失败</code></li>
          </ul>

          <h3 class="api-h3">错误码</h3>
          <table class="api-spec-table">
            <thead>
              <tr>
                <th>HTTP</th>
                <th>错误</th>
                <th>原因</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>400</td>
                <td>BAD_REQUEST</td>
                <td>body 校验失败 / 字段缺失</td>
              </tr>
              <tr>
                <td>401</td>
                <td>verification_token_mismatch</td>
                <td>verificationToken 与服务端不一致</td>
              </tr>
              <tr>
                <td>500</td>
                <td>template_not_found</td>
                <td>templateId 不存在</td>
              </tr>
            </tbody>
          </table>
        </article>
      </section>
    </div>
  </div>
</template>

<style scoped>
.api-page {
  display: grid;
  grid-template-columns: 220px 1fr;
  gap: 24px;
  padding: 24px 40px 40px;
  max-width: 1300px;
  margin: 0 auto;
}

/* ============ TOC ============ */
.api-toc {
  position: sticky;
  top: 24px;
  align-self: start;
  padding: 16px;
  background: #fff;
  border: 1px solid var(--tp-line, #ececef);
  border-radius: 10px;
  font-size: 13px;
}
.api-toc-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--tp-ink-faint, #9c9ca3);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  margin-bottom: 10px;
}
.api-toc-list {
  list-style: none;
  margin: 0;
  padding: 0;
}
.api-toc-item {
  padding: 5px 8px;
  border-radius: 5px;
  color: var(--tp-ink, #1f1f23);
  cursor: pointer;
  transition: all 100ms ease;
  font-size: 13px;
}
.api-toc-item:hover {
  background: var(--tp-accent-bg, #f0eeff);
  color: var(--tp-accent-ink, #4f3fcc);
}
.api-toc-item--indent {
  padding-left: 18px;
  font-size: 12px;
  color: var(--tp-ink-soft, #5e5e66);
  font-family: ui-monospace, monospace;
}

/* ============ Main ============ */
.api-main {
  min-width: 0;
}
.api-page-title {
  font-size: 24px;
  font-weight: 600;
  margin: 0 0 16px;
  color: var(--tp-ink, #1f1f23);
}
.api-section {
  background: #fff;
  border: 1px solid var(--tp-line, #ececef);
  border-radius: 12px;
  padding: 24px;
  margin-bottom: 20px;
  scroll-margin-top: 16px;
}
.api-h2 {
  font-size: 18px;
  font-weight: 600;
  margin: 0 0 16px;
  color: var(--tp-ink, #1f1f23);
}
.api-section-intro {
  color: var(--tp-ink-soft, #5e5e66);
  font-size: 13px;
  margin: -8px 0 16px;
}

.api-loading,
.api-empty {
  padding: 24px;
  text-align: center;
  color: var(--tp-ink-faint, #9c9ca3);
}
.api-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
.api-table thead {
  background: var(--tp-accent-bg, #f0eeff);
}
.api-table th {
  text-align: left;
  padding: 10px 14px;
  font-weight: 600;
  color: var(--tp-accent-ink, #4f3fcc);
  border-bottom: 2px solid var(--tp-line, #ececef);
}
.api-table td {
  padding: 14px;
  vertical-align: top;
  border-bottom: 1px solid var(--tp-line, #ececef);
}
.api-row {
  cursor: pointer;
  transition: background 100ms ease;
}
.api-row:hover {
  background: var(--tp-field-bg, rgba(108, 92, 231, 0.04));
}
.api-row-expanded td {
  background: #fafafa;
  padding: 16px;
}

.api-tpl-name {
  font-weight: 600;
  margin-bottom: 4px;
}
.api-tpl-id {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: var(--tp-ink-faint, #9c9ca3);
}
.api-tpl-id code {
  font-family: ui-monospace, monospace;
  font-size: 11px;
  background: transparent;
}
.api-copy-btn {
  border: none;
  background: transparent;
  padding: 2px;
  cursor: pointer;
  color: var(--tp-ink-faint, #9c9ca3);
  border-radius: 3px;
  display: inline-flex;
}
.api-copy-btn:hover {
  color: var(--tp-accent, #6c5ce7);
  background: var(--tp-field-bg, rgba(108, 92, 231, 0.08));
}

.api-field-list {
  margin: 0;
  padding: 0;
  list-style: none;
}
.api-field-list li {
  margin-bottom: 6px;
}
.api-field-hint {
  display: flex;
  align-items: center;
  gap: 4px;
  color: var(--tp-ink-faint, #9c9ca3);
  font-size: 12px;
}
.api-field-hint code {
  background: var(--tp-accent-bg, #f0eeff);
  padding: 0 4px;
  border-radius: 3px;
  font-family: ui-monospace, monospace;
}
.api-field-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.api-field-key {
  font-family: ui-monospace, monospace;
  background: var(--tp-accent-bg, #f0eeff);
  color: var(--tp-accent-ink, #4f3fcc);
  padding: 1px 6px;
  border-radius: 3px;
  font-size: 12px;
}
.api-field-type {
  font-size: 10px;
  color: var(--tp-ink-soft, #5e5e66);
  text-transform: uppercase;
  background: #eee;
  padding: 1px 5px;
  border-radius: 3px;
}
.api-field-required {
  font-size: 10px;
  color: #d94f4f;
  background: #fdebec;
  padding: 1px 5px;
  border-radius: 3px;
}
.api-field-meta {
  font-size: 11px;
  color: var(--tp-ink-soft, #5e5e66);
  margin-top: 2px;
}
.api-field-meta code {
  font-family: ui-monospace, monospace;
  font-size: 11px;
  background: #f5f5f7;
  padding: 0 3px;
  border-radius: 2px;
}

details summary {
  cursor: pointer;
  color: var(--tp-ink-soft, #5e5e66);
  font-size: 12px;
  padding: 6px 0;
}
details[open] summary {
  color: var(--tp-accent, #6c5ce7);
}

/* ============ Endpoint card ============ */
.api-endpoint-card {
  padding: 18px 20px;
  border: 1px solid var(--tp-line, #ececef);
  border-radius: 10px;
  margin-bottom: 16px;
  scroll-margin-top: 16px;
}
.api-ep-head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
}
.api-method {
  display: inline-block;
  padding: 2px 9px;
  border-radius: 4px;
  font-family: ui-monospace, monospace;
  font-size: 11px;
  font-weight: 700;
  color: #fff;
  letter-spacing: 0.04em;
}
.api-method--post {
  background: #2ecc71;
}
.api-method--get {
  background: #4f9eff;
}
.api-ep-path {
  font-family: ui-monospace, monospace;
  font-size: 14px;
  color: var(--tp-ink, #1f1f23);
  font-weight: 600;
}
.api-ep-desc {
  color: var(--tp-ink-soft, #5e5e66);
  font-size: 13px;
  margin: 4px 0 12px;
  line-height: 1.7;
}
.api-h3 {
  font-size: 13px;
  font-weight: 600;
  margin: 16px 0 6px;
  color: var(--tp-accent-ink, #4f3fcc);
}
.api-auth {
  font-size: 12px;
  color: var(--tp-ink-soft, #5e5e66);
  margin: 0 0 8px;
}
.api-spec-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
  margin: 4px 0 0;
}
.api-spec-table thead th {
  background: #f6f6fa;
  color: var(--tp-ink-soft, #5e5e66);
  font-weight: 600;
  text-align: left;
  padding: 6px 10px;
  border-bottom: 1px solid var(--tp-line, #ececef);
}
.api-spec-table td {
  padding: 6px 10px;
  border-bottom: 1px solid var(--tp-line, #ececef);
  color: var(--tp-ink, #1f1f23);
  vertical-align: top;
}
.api-spec-table code {
  font-family: ui-monospace, monospace;
  font-size: 11.5px;
  background: var(--tp-accent-bg, #f0eeff);
  color: var(--tp-accent-ink, #4f3fcc);
  padding: 1px 4px;
  border-radius: 3px;
}
.api-code {
  background: #1f1f23;
  color: #e0e0e6;
  padding: 12px 16px;
  border-radius: 6px;
  font-family: ui-monospace, monospace;
  font-size: 12px;
  line-height: 1.7;
  overflow-x: auto;
  white-space: pre-wrap;
}
.api-behavior-list {
  font-size: 12.5px;
  color: var(--tp-ink, #1f1f23);
  margin: 4px 0 0;
  padding-left: 18px;
}
.api-behavior-list li {
  margin-bottom: 3px;
}
.api-tiny {
  font-size: 11.5px;
  color: var(--tp-ink-faint, #9c9ca3);
  margin: 0 0 6px;
}
</style>
