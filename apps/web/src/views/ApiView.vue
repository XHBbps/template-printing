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
    schema?: {
      fields?: Record<string, FieldDef>;
    };
  };
}

interface FieldDef {
  type: string;
  label?: string;
  required?: boolean;
  example?: unknown;
  options?: Array<{ value: string; label: string }>;
}

const tab = ref<'curl' | 'js' | 'python'>('curl');
const docOpen = ref(false); // 顶部文档默认收起

const templates = ref<TemplateListItem[]>([]);
const detailCache = ref<Record<string, TemplateDetail>>({});
const expanded = ref<Record<string, boolean>>({});
const loading = ref(true);

const commonFields = [
  { key: 'templateId', desc: '模板 UUID（必填）' },
  { key: 'data', desc: '业务字段 map（按下方 schema 字段填）' },
  { key: 'formats', desc: '导出格式数组，默认 ["pdf"]，可加 "png"' },
  { key: 'callbackUrl', desc: '渲染完成回调 URL（可选）' },
];

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
  const fields = d?.data?.schema?.fields ?? {};
  return Object.entries(fields).map(([key, def]) => ({ key, def }));
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
</script>

<template>
  <div class="page-wrap">
    <h1 class="page-title">API</h1>

    <!-- ============ 通用调用文档（默认收起）============ -->
    <section class="api-section">
      <button class="api-doc-toggle" @click="docOpen = !docOpen">
        <component :is="docOpen ? ChevronDown : ChevronRight" :size="16" :stroke-width="2.5" />
        <span>通用 HTTP 调用文档（curl / JavaScript / Python）</span>
      </button>

      <div v-if="docOpen" class="api-doc-body">
        <h3>端点</h3>
        <div class="api-endpoint">
          <code>POST /api/render</code>
          <span class="api-auth-note">需要登录（cookie 或 CSRF）</span>
        </div>

        <h3>请求体</h3>
        <pre class="api-code">
{
  "templateId": "tpl_xxx",
  "data": { "name": "张三", "amount": 1200 },
  "formats": ["pdf", "png"],
  "callbackUrl": "https://your-server.com/print-callback"
}</pre
        >

        <h3>同步返回</h3>
        <pre class="api-code">{ "jobId": "abc-123-...", "status": "pending" }</pre>

        <h3>Webhook 回调 payload（异步）</h3>
        <pre class="api-code">
{
  "jobId": "abc-123-...",
  "status": "done",
  "pdfUrl": "/uploads/render/abc-123.pdf",
  "pngUrl": null,
  "errorMsg": null
}</pre
        >

        <h3>调用示例</h3>
        <div class="api-tabs">
          <button :class="{ on: tab === 'curl' }" @click="tab = 'curl'">curl</button>
          <button :class="{ on: tab === 'js' }" @click="tab = 'js'">JavaScript</button>
          <button :class="{ on: tab === 'python' }" @click="tab = 'python'">Python</button>
        </div>

        <pre v-if="tab === 'curl'" class="api-code">
curl -X POST https://your-host/api/render \
  -H "Content-Type: application/json" \
  -H "Cookie: tp_access=&lt;token&gt;" \
  -H "X-CSRF-Token: &lt;csrf&gt;" \
  -d '{ "templateId": "tpl_xxx", "data": { "name": "张三" } }'</pre
        >

        <pre v-else-if="tab === 'js'" class="api-code">
const res = await fetch('https://your-host/api/render', {
  method: 'POST',
  credentials: 'include',
  headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
  body: JSON.stringify({ templateId: 'tpl_xxx', data: { name: '张三' } }),
});
const { jobId } = await res.json();</pre
        >

        <pre v-else class="api-code">
import requests
resp = requests.post(
    'https://your-host/api/render',
    json={'templateId': 'tpl_xxx', 'data': {'name': '张三'}},
    cookies={'tp_access': '&lt;token&gt;'},
    headers={'X-CSRF-Token': '&lt;csrf&gt;'},
)
job_id = resp.json()['jobId']</pre
        >
      </div>
    </section>

    <!-- ============ 模板列表 ============ -->
    <section class="api-section api-templates-section">
      <h2>模板列表</h2>
      <p class="api-intro">
        列出所有可调用的模板，及其入参（通用项 + 自定义字段）。展开查看完整 schema。
      </p>

      <div v-if="loading" class="api-loading">加载中…</div>
      <div v-else-if="!hasTemplates" class="api-empty">
        当前没有模板。请先在「模板中心」创建模板。
      </div>

      <table v-else class="api-table">
        <thead>
          <tr>
            <th style="width: 25%">模板</th>
            <th style="width: 35%">通用入参</th>
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
                <ul class="api-common-list">
                  <li v-for="cf in commonFields" :key="cf.key">
                    <code>{{ cf.key }}</code>
                    <span class="api-field-desc">{{ cf.desc }}</span>
                  </li>
                </ul>
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
              <td colspan="3">
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
  </div>
</template>

<style scoped>
.page-wrap {
  padding: 32px 40px;
  max-width: 1100px;
  margin: 0 auto;
}
.page-title {
  font-size: 24px;
  font-weight: 600;
  margin: 0 0 24px;
  color: var(--tp-ink, #1f1f23);
}
.api-section {
  background: #fff;
  border: 1px solid var(--tp-line, #ececef);
  border-radius: 12px;
  padding: 28px;
  margin-bottom: 24px;
}
.api-section h2 {
  font-size: 18px;
  font-weight: 600;
  margin: 0 0 12px;
}
.api-section h3 {
  font-size: 14px;
  font-weight: 600;
  margin: 20px 0 8px;
  color: var(--tp-accent-ink, #4f3fcc);
}
.api-intro {
  color: var(--tp-ink-soft, #5e5e66);
  font-size: 13px;
  margin-bottom: 16px;
  line-height: 1.7;
}

.api-doc-toggle {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  border: none;
  background: transparent;
  padding: 4px 0;
  cursor: pointer;
  font-size: 14px;
  font-weight: 600;
  color: var(--tp-ink, #1f1f23);
}
.api-doc-toggle:hover {
  color: var(--tp-accent, #6c5ce7);
}
.api-doc-body {
  margin-top: 16px;
}

.api-endpoint {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 8px 0;
}
.api-endpoint code {
  background: var(--tp-accent-bg, #f0eeff);
  color: var(--tp-accent-ink, #4f3fcc);
  padding: 4px 12px;
  border-radius: 6px;
  font-family: ui-monospace, monospace;
  font-size: 13px;
}
.api-auth-note {
  font-size: 11px;
  color: var(--tp-ink-faint, #9c9ca3);
}
.api-code {
  background: #1f1f23;
  color: #e0e0e6;
  padding: 14px 18px;
  border-radius: 8px;
  font-family: ui-monospace, monospace;
  font-size: 12px;
  line-height: 1.7;
  overflow-x: auto;
  white-space: pre-wrap;
}
.api-tabs {
  display: flex;
  gap: 6px;
  margin: 8px 0;
}
.api-tabs button {
  background: transparent;
  border: 1px solid var(--tp-line, #ececef);
  padding: 5px 14px;
  border-radius: 6px;
  font-size: 12px;
  cursor: pointer;
  color: var(--tp-ink-soft, #5e5e66);
}
.api-tabs button.on {
  background: var(--tp-accent, #6c5ce7);
  color: #fff;
  border-color: var(--tp-accent, #6c5ce7);
}

/* ============ Templates table ============ */
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
  transition: background 120ms ease;
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
  color: var(--tp-ink, #1f1f23);
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

.api-common-list,
.api-field-list {
  margin: 0;
  padding: 0;
  list-style: none;
}
.api-common-list li,
.api-field-list li {
  margin-bottom: 6px;
}
.api-common-list code {
  font-family: ui-monospace, monospace;
  color: var(--tp-accent-ink, #4f3fcc);
  font-size: 12px;
  background: var(--tp-accent-bg, #f0eeff);
  padding: 1px 5px;
  border-radius: 3px;
  margin-right: 6px;
}
.api-field-desc {
  font-size: 11px;
  color: var(--tp-ink-soft, #5e5e66);
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
  margin-left: 4px;
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
</style>
