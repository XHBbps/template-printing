<script setup lang="ts">
import { ref, onMounted, watch, computed } from 'vue';
// eslint-disable-next-line import/no-unresolved
import { ElDialog, ElMessage, ElPagination } from 'element-plus';
// eslint-disable-next-line import/no-unresolved
import { History, RefreshCw, Download, Copy } from 'lucide-vue-next';
// eslint-disable-next-line import/no-unresolved
import { apiFetch } from '../lib/api';

interface RenderJob {
  id: string;
  templateId: string;
  templateName: string;
  status: 'pending' | 'processing' | 'done' | 'failed';
  source: 'bot' | 'bitable' | 'api';
  createdAt: string;
  completedAt: string | null;
  durationMs: number | null;
  pdfUrl: string | null;
  pngUrl: string | null;
  errorMsg: string | null;
  data: unknown;
  callbackUrl: string | null;
}

const items = ref<RenderJob[]>([]);
const total = ref(0);
const page = ref(1);
const pageSize = ref(20);
const loading = ref(false);

const statusFilter = ref<string>('');
const sourceFilter = ref<string>('');
const templateNameFilter = ref<string>('');

const detailOpen = ref(false);
const detailJob = ref<RenderJob | null>(null);

const STATUS_OPTIONS = [
  { value: '', label: '全部' },
  { value: 'pending', label: '等待中' },
  { value: 'processing', label: '处理中' },
  { value: 'done', label: '已完成' },
  { value: 'failed', label: '失败' },
];
const SOURCE_OPTIONS = [
  { value: '', label: '全部' },
  { value: 'api', label: 'API 直调' },
  { value: 'bot', label: '飞书机器人' },
  { value: 'bitable', label: '飞书多维表格' },
];

async function refresh(): Promise<void> {
  loading.value = true;
  try {
    const qs = new URLSearchParams({
      page: String(page.value),
      pageSize: String(pageSize.value),
    });
    if (statusFilter.value) qs.set('status', statusFilter.value);
    if (sourceFilter.value) qs.set('source', sourceFilter.value);
    if (templateNameFilter.value.trim()) qs.set('templateName', templateNameFilter.value.trim());
    const r = await apiFetch<{
      items: RenderJob[];
      total: number;
      page: number;
      pageSize: number;
    }>(`/render/jobs?${qs.toString()}`);
    items.value = r.items;
    total.value = r.total;
  } catch (e) {
    ElMessage.error(`加载失败：${(e as Error).message}`);
  } finally {
    loading.value = false;
  }
}

function resetFilters(): void {
  statusFilter.value = '';
  sourceFilter.value = '';
  templateNameFilter.value = '';
  page.value = 1;
  void refresh();
}

let searchTimer: number | null = null;
watch(templateNameFilter, () => {
  if (searchTimer) window.clearTimeout(searchTimer);
  searchTimer = window.setTimeout(() => {
    page.value = 1;
    void refresh();
  }, 350);
});
watch([statusFilter, sourceFilter], () => {
  page.value = 1;
  void refresh();
});
watch([page, pageSize], () => void refresh());

function openDetail(job: RenderJob): void {
  detailJob.value = job;
  detailOpen.value = true;
}

async function copyText(text: string, label = '已复制'): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    ElMessage.success(label);
  } catch {
    ElMessage.error('复制失败');
  }
}

function statusPill(s: string): string {
  if (s === 'done') return 'ok';
  if (s === 'failed') return 'danger';
  if (s === 'processing') return 'warn';
  return 'idle';
}
function statusLabel(s: string): string {
  if (s === 'done') return '完成';
  if (s === 'failed') return '失败';
  if (s === 'processing') return '处理中';
  if (s === 'pending') return '等待中';
  return s;
}
function sourceLabel(s: string): string {
  if (s === 'bot') return '飞书机器人';
  if (s === 'bitable') return '飞书多维表格';
  return 'API';
}
function formatAbs(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
function formatDuration(ms: number | null): string {
  if (ms == null) return '—';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.floor((ms % 60_000) / 1000)}s`;
}

const dataJsonPretty = computed(() => {
  if (!detailJob.value) return '';
  try {
    return JSON.stringify(detailJob.value.data ?? {}, null, 2);
  } catch {
    return String(detailJob.value.data);
  }
});

const countLabel = computed(() => {
  if (loading.value && items.value.length === 0) return 'LOADING';
  if (total.value === 0) return '0 OF 0';
  const from = (page.value - 1) * pageSize.value + 1;
  const to = Math.min(page.value * pageSize.value, total.value);
  return `${from}–${to} OF ${total.value}`;
});

onMounted(refresh);
</script>

<template>
  <div class="view-root">
    <!-- ============ Page bar ============ -->
    <header class="page-bar">
      <div class="page-title">
        <span class="ico"><History :size="20" :stroke-width="1.5" /></span>
        渲染日志
      </div>
      <div class="page-sub">RENDER · JOB HISTORY</div>
      <div class="page-bar-spacer"></div>
      <button class="btn btn-secondary sm" type="button" @click="refresh">
        <span class="ico"><RefreshCw :size="14" :stroke-width="1.5" /></span>
        刷新
      </button>
    </header>

    <!-- ============ Body ============ -->
    <div class="page-body">
      <div class="max">
        <!-- 过滤区 -->
        <div class="filters">
          <label class="field">
            <span class="lbl">状态 <span class="han">· Status</span></span>
            <select v-model="statusFilter">
              <option v-for="o in STATUS_OPTIONS" :key="o.value" :value="o.value">
                {{ o.label }}
              </option>
            </select>
          </label>
          <label class="field">
            <span class="lbl">来源 <span class="han">· Source</span></span>
            <select v-model="sourceFilter">
              <option v-for="o in SOURCE_OPTIONS" :key="o.value" :value="o.value">
                {{ o.label }}
              </option>
            </select>
          </label>
          <label class="field wide">
            <span class="lbl">模板 <span class="han">· Template</span></span>
            <input v-model="templateNameFilter" type="text" placeholder="按模板名搜索..." />
          </label>
          <div class="actions">
            <button class="btn btn-secondary sm" type="button" @click="resetFilters">重置</button>
            <button class="btn btn-primary sm" type="button" @click="refresh">查询</button>
          </div>
        </div>

        <!-- 结果区 -->
        <div class="results">
          <div class="results-head">
            <h2>任务列表</h2>
            <span class="count">{{ countLabel }}</span>
            <span class="rule"></span>
          </div>

          <!-- 空态 -->
          <div v-if="!loading && items.length === 0" class="card">
            <div class="empty-state">
              <div class="eyebrow">No matching jobs · 暂无任务</div>
              <div class="msg">无匹配的渲染任务。<br />调整筛选条件或在模板中心发起一次渲染。</div>
              <div class="hint">RENDER · QUEUED · COMPLETED · FAILED</div>
            </div>
          </div>

          <!-- 列表 -->
          <div v-else class="card">
            <div class="card-body flush">
              <table class="log">
                <thead>
                  <tr>
                    <th>JOB ID</th>
                    <th>模板</th>
                    <th>状态</th>
                    <th>来源</th>
                    <th>触发时间</th>
                    <th>用时</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="job in items" :key="job.id">
                    <td class="mono id" :title="job.id">{{ job.id.slice(0, 8) }}…</td>
                    <td>{{ job.templateName }}</td>
                    <td>
                      <span class="pill" :class="statusPill(job.status)">
                        {{ statusLabel(job.status) }}
                      </span>
                    </td>
                    <td>{{ sourceLabel(job.source) }}</td>
                    <td class="mono">{{ formatAbs(job.createdAt) }}</td>
                    <td class="mono">{{ formatDuration(job.durationMs) }}</td>
                    <td>
                      <div class="row-actions">
                        <a href="#" @click.prevent="openDetail(job)">详情</a>
                        <a v-if="job.pdfUrl" :href="job.pdfUrl" target="_blank" rel="noopener">
                          下载 PDF
                        </a>
                      </div>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <!-- 分页 -->
          <div v-if="total > pageSize" class="pagination">
            <ElPagination
              v-model:current-page="page"
              :page-size="pageSize"
              :total="total"
              background
              layout="prev, pager, next, total"
            />
          </div>
        </div>
      </div>
    </div>

    <!-- ============ 详情 dialog ============ -->
    <ElDialog v-model="detailOpen" title="渲染任务详情" width="640px">
      <div v-if="detailJob" class="detail-grid">
        <div class="grid-row">
          <span class="grid-key">Job ID</span>
          <span class="grid-val">
            <code>{{ detailJob.id }}</code>
            <button class="copy-btn" type="button" @click="copyText(detailJob.id, '已复制 Job ID')">
              <Copy :size="12" :stroke-width="1.5" />
            </button>
          </span>
        </div>
        <div class="grid-row">
          <span class="grid-key">模板</span>
          <span class="grid-val">
            {{ detailJob.templateName }}
            <code class="muted">{{ detailJob.templateId }}</code>
          </span>
        </div>
        <div class="grid-row">
          <span class="grid-key">状态</span>
          <span class="grid-val">
            <span class="pill" :class="statusPill(detailJob.status)">
              {{ statusLabel(detailJob.status) }}
            </span>
          </span>
        </div>
        <div class="grid-row">
          <span class="grid-key">来源</span>
          <span class="grid-val">{{ sourceLabel(detailJob.source) }}</span>
        </div>
        <div class="grid-row">
          <span class="grid-key">触发时间</span>
          <span class="grid-val mono">{{ formatAbs(detailJob.createdAt) }}</span>
        </div>
        <div class="grid-row">
          <span class="grid-key">完成时间</span>
          <span class="grid-val mono">
            {{ formatAbs(detailJob.completedAt) }}（用时
            {{ formatDuration(detailJob.durationMs) }}）
          </span>
        </div>
        <div v-if="detailJob.callbackUrl" class="grid-row">
          <span class="grid-key">Callback</span>
          <span class="grid-val">
            <code class="muted">{{ detailJob.callbackUrl }}</code>
          </span>
        </div>

        <div class="grid-section">请求数据 (data)</div>
        <pre class="code-block">{{ dataJsonPretty }}</pre>

        <template v-if="detailJob.pdfUrl || detailJob.pngUrl">
          <div class="grid-section">输出</div>
          <div class="downloads">
            <a
              v-if="detailJob.pdfUrl"
              :href="detailJob.pdfUrl"
              target="_blank"
              class="download-btn"
              rel="noopener"
            >
              <Download :size="14" :stroke-width="1.5" />
              下载 PDF
            </a>
            <a
              v-if="detailJob.pngUrl"
              :href="detailJob.pngUrl"
              target="_blank"
              class="download-btn"
              rel="noopener"
            >
              <Download :size="14" :stroke-width="1.5" />
              下载 PNG
            </a>
          </div>
        </template>

        <template v-if="detailJob.errorMsg">
          <div class="grid-section error">错误信息</div>
          <pre class="code-block code-error">{{ detailJob.errorMsg }}</pre>
        </template>
      </div>
    </ElDialog>
  </div>
</template>

<style scoped>
.view-root {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

/* 过滤区 — 卡片化 */
.filters {
  display: flex;
  align-items: end;
  gap: 16px;
  padding: 20px 24px;
  background: var(--paper-white);
  border: 1px solid var(--stone);
  border-radius: var(--radius-2);
}
.filters .field {
  min-width: 200px;
}
.filters .field.wide {
  flex: 1;
}
.filters .actions {
  display: flex;
  gap: 10px;
  align-self: end;
}

/* 结果头 */
.results {
  margin-top: 24px;
}
.results-head {
  display: flex;
  align-items: baseline;
  gap: 12px;
  margin-bottom: 14px;
}
.results-head h2 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: var(--ink);
  font-family: var(--font-han);
}
.results-head .count {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--fg-3);
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
.results-head .rule {
  flex: 1;
  height: 1px;
  background: var(--stone);
}

/* Log table */
table.log {
  width: 100%;
  border-collapse: collapse;
}
table.log th {
  text-align: left;
  font-family: var(--font-sans);
  font-size: 10.5px;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: var(--tr-caption);
  color: var(--fg-3);
  padding: 12px 20px;
  border-bottom: 1px solid var(--stone);
  background: var(--mist);
}
table.log td {
  padding: 14px 20px;
  border-bottom: 1px solid var(--stone);
  font-family: var(--font-han);
  font-size: 13px;
  color: var(--fg-1);
  vertical-align: middle;
}
table.log tr:last-child td {
  border-bottom: 0;
}
table.log tr:hover td {
  background: var(--mist);
}
table.log .mono {
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--fg-2);
}
table.log .id {
  color: var(--fg-3);
}

.row-actions {
  display: flex;
  gap: 12px;
}
.row-actions a {
  font-family: var(--font-han);
  font-size: 12.5px;
  color: var(--ink);
  text-decoration: none;
  border-bottom: 1px solid transparent;
  padding-bottom: 1px;
  cursor: pointer;
}
.row-actions a:hover {
  color: var(--yangli-red);
  border-bottom-color: var(--yangli-red);
}

.pagination {
  margin-top: 20px;
  display: flex;
  justify-content: center;
}

/* Detail dialog */
.detail-grid {
  display: flex;
  flex-direction: column;
  gap: 0;
}
.grid-row {
  display: grid;
  grid-template-columns: 100px 1fr;
  gap: 12px;
  padding: 10px 0;
  border-bottom: 1px solid var(--stone);
}
.grid-row:last-of-type {
  border-bottom: 0;
}
.grid-key {
  font-family: var(--font-sans);
  font-size: 10.5px;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: var(--tr-caption);
  color: var(--fg-3);
  align-self: center;
}
.grid-val {
  font-family: var(--font-han);
  font-size: 13px;
  color: var(--ink);
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.grid-val.mono {
  font-family: var(--font-mono);
  font-size: 12px;
}
.grid-val code {
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--ink);
  background: var(--mist);
  border: 1px solid var(--stone);
  padding: 2px 6px;
  border-radius: var(--radius-1);
}
.grid-val code.muted {
  color: var(--fg-3);
}
.copy-btn {
  border: none;
  background: transparent;
  cursor: pointer;
  color: var(--fg-3);
  padding: 2px;
  display: inline-flex;
}
.copy-btn:hover {
  color: var(--yangli-red);
}

.grid-section {
  font-family: var(--font-sans);
  font-size: 10.5px;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: var(--tr-caption);
  color: var(--fg-3);
  margin: 16px 0 8px;
}
.grid-section.error {
  color: var(--yangli-red);
}

.code-block {
  margin: 0 0 4px;
  padding: 12px 14px;
  background: var(--ink);
  color: var(--paper-white);
  font-family: var(--font-mono);
  font-size: 12px;
  line-height: 1.55;
  border-radius: var(--radius-2);
  overflow-x: auto;
  max-height: 200px;
  white-space: pre-wrap;
  word-break: break-all;
}
.code-block.code-error {
  background: rgba(211, 45, 39, 0.08);
  color: var(--yangli-red);
  border: 1px solid rgba(211, 45, 39, 0.25);
}

.downloads {
  display: flex;
  gap: 10px;
}
.download-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  font-family: var(--font-han);
  font-size: 13px;
  color: var(--ink);
  background: var(--paper-white);
  border: 1px solid var(--yangli-graphite);
  border-radius: var(--radius-2);
  text-decoration: none;
  cursor: pointer;
  transition: all var(--dur-fast) var(--ease-default);
}
.download-btn:hover {
  background: var(--ink);
  color: var(--paper-white);
}
</style>
