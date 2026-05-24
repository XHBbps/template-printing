<script setup lang="ts">
import { ref, onMounted, watch, computed } from 'vue';
// eslint-disable-next-line import/no-unresolved
import {
  ElButton,
  ElDialog,
  ElInput,
  ElMessage,
  ElPagination,
  ElSelect,
  ElOption,
} from 'element-plus';
// eslint-disable-next-line import/no-unresolved
import { History, RefreshCw, Download, FileText, Copy } from 'lucide-vue-next';
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
  { value: 'pending', label: 'pending' },
  { value: 'processing', label: 'processing' },
  { value: 'done', label: 'done' },
  { value: 'failed', label: 'failed' },
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

// 用 debounce 搜模板名
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

function statusColor(s: string): string {
  if (s === 'done') return '#26a45c';
  if (s === 'failed') return '#d94f4f';
  if (s === 'processing') return '#e5a72c';
  return '#9c9ca3';
}
function statusBg(s: string): string {
  if (s === 'done') return '#e7f7ed';
  if (s === 'failed') return '#fdebec';
  if (s === 'processing') return '#fff7e0';
  return '#f3f3f5';
}
function statusLabel(s: string): string {
  if (s === 'done') return '✅ 已完成';
  if (s === 'failed') return '❌ 失败';
  if (s === 'processing') return '⏳ 处理中';
  if (s === 'pending') return '⌛ 等待中';
  return s;
}
function sourceLabel(s: string): string {
  if (s === 'bot') return '飞书机器人';
  if (s === 'bitable') return '飞书多维表格';
  return 'API 直调';
}
function sourceColor(s: string): string {
  if (s === 'bot') return '#4f9eff';
  if (s === 'bitable') return '#e5912c';
  return '#6c5ce7';
}
function sourceBg(s: string): string {
  if (s === 'bot') return '#e8f3ff';
  if (s === 'bitable') return '#fff3e0';
  return '#f0eeff';
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

onMounted(refresh);
</script>

<template>
  <div class="page-wrap">
    <header class="page-header">
      <h1 class="page-title">
        <History :size="22" :stroke-width="2" />
        <span>渲染日志</span>
      </h1>
      <ElButton @click="refresh">
        <RefreshCw :size="14" :stroke-width="2" style="margin-right: 4px" />
        刷新
      </ElButton>
    </header>

    <!-- 过滤器 -->
    <section class="filters">
      <div class="filter-item">
        <label>状态</label>
        <ElSelect v-model="statusFilter" placeholder="全部" style="width: 140px">
          <ElOption v-for="o in STATUS_OPTIONS" :key="o.value" :value="o.value" :label="o.label" />
        </ElSelect>
      </div>
      <div class="filter-item">
        <label>来源</label>
        <ElSelect v-model="sourceFilter" placeholder="全部" style="width: 160px">
          <ElOption v-for="o in SOURCE_OPTIONS" :key="o.value" :value="o.value" :label="o.label" />
        </ElSelect>
      </div>
      <div class="filter-item">
        <label>模板</label>
        <ElInput v-model="templateNameFilter" placeholder="按模板名搜索…" style="width: 220px" />
      </div>
    </section>

    <!-- 列表 -->
    <section class="section">
      <div v-if="loading && items.length === 0" class="empty">加载中…</div>
      <div v-else-if="!loading && items.length === 0" class="empty">无匹配的渲染任务。</div>
      <table v-else class="logs-table">
        <thead>
          <tr>
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
            <td>
              <div class="tpl-name">{{ job.templateName }}</div>
              <div class="tpl-id" :title="job.id">{{ job.id.slice(0, 8) }}…</div>
            </td>
            <td>
              <span
                class="badge"
                :style="{ color: statusColor(job.status), background: statusBg(job.status) }"
              >
                {{ statusLabel(job.status) }}
              </span>
            </td>
            <td>
              <span
                class="badge"
                :style="{ color: sourceColor(job.source), background: sourceBg(job.source) }"
              >
                {{ sourceLabel(job.source) }}
              </span>
            </td>
            <td>{{ formatAbs(job.createdAt) }}</td>
            <td>{{ formatDuration(job.durationMs) }}</td>
            <td>
              <ElButton link size="small" @click="openDetail(job)">
                <FileText :size="14" :stroke-width="2" />
                详情
              </ElButton>
            </td>
          </tr>
        </tbody>
      </table>
    </section>

    <div v-if="total > pageSize" class="pagination">
      <ElPagination
        v-model:current-page="page"
        :page-size="pageSize"
        :total="total"
        background
        layout="prev, pager, next, total"
      />
    </div>

    <!-- 详情 dialog -->
    <ElDialog v-model="detailOpen" title="渲染任务详情" width="640px">
      <div v-if="detailJob" class="detail-grid">
        <div class="grid-row">
          <span class="grid-key">Job ID</span>
          <span class="grid-val">
            <code>{{ detailJob.id }}</code>
            <ElButton link size="small" @click="copyText(detailJob.id, '已复制 Job ID')">
              <Copy :size="12" :stroke-width="2" />
            </ElButton>
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
            <span
              class="badge"
              :style="{
                color: statusColor(detailJob.status),
                background: statusBg(detailJob.status),
              }"
            >
              {{ statusLabel(detailJob.status) }}
            </span>
          </span>
        </div>
        <div class="grid-row">
          <span class="grid-key">来源</span>
          <span class="grid-val">
            <span
              class="badge"
              :style="{
                color: sourceColor(detailJob.source),
                background: sourceBg(detailJob.source),
              }"
            >
              {{ sourceLabel(detailJob.source) }}
            </span>
          </span>
        </div>
        <div class="grid-row">
          <span class="grid-key">触发时间</span>
          <span class="grid-val">{{ formatAbs(detailJob.createdAt) }}</span>
        </div>
        <div class="grid-row">
          <span class="grid-key">完成时间</span>
          <span class="grid-val"
            >{{ formatAbs(detailJob.completedAt) }}（用时
            {{ formatDuration(detailJob.durationMs) }}）</span
          >
        </div>
        <div v-if="detailJob.callbackUrl" class="grid-row">
          <span class="grid-key">Callback</span>
          <span class="grid-val"
            ><code class="muted">{{ detailJob.callbackUrl }}</code></span
          >
        </div>

        <div class="grid-section">请求数据 (data)</div>
        <pre class="code">{{ dataJsonPretty }}</pre>

        <div v-if="detailJob.pdfUrl || detailJob.pngUrl" class="grid-section">输出</div>
        <div v-if="detailJob.pdfUrl || detailJob.pngUrl" class="downloads">
          <a
            v-if="detailJob.pdfUrl"
            :href="detailJob.pdfUrl"
            target="_blank"
            class="download-btn"
            rel="noopener"
          >
            <Download :size="14" :stroke-width="2" />
            下载 PDF
          </a>
          <a
            v-if="detailJob.pngUrl"
            :href="detailJob.pngUrl"
            target="_blank"
            class="download-btn"
            rel="noopener"
          >
            <Download :size="14" :stroke-width="2" />
            下载 PNG
          </a>
        </div>

        <div v-if="detailJob.errorMsg" class="grid-section error">错误信息</div>
        <pre v-if="detailJob.errorMsg" class="code code-error">{{ detailJob.errorMsg }}</pre>
      </div>
    </ElDialog>
  </div>
</template>

<style scoped>
.page-wrap {
  padding: 24px 40px 60px;
  max-width: 1200px;
  margin: 0 auto;
  font-family: -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Noto Sans SC', 'Microsoft YaHei',
    system-ui, sans-serif;
}
.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}
.page-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 22px;
  font-weight: 600;
  margin: 0;
}

.filters {
  display: flex;
  gap: 18px;
  align-items: center;
  padding: 12px 16px;
  background: #fff;
  border: 1px solid var(--tp-line, #ececef);
  border-radius: 10px;
  margin-bottom: 14px;
}
.filter-item {
  display: flex;
  align-items: center;
  gap: 8px;
}
.filter-item label {
  font-size: 13px;
  color: var(--tp-ink-soft, #5e5e66);
}

.section {
  background: #fff;
  border: 1px solid var(--tp-line, #ececef);
  border-radius: 12px;
  overflow: hidden;
}
.empty {
  padding: 60px;
  text-align: center;
  color: var(--tp-ink-faint, #9c9ca3);
}
.logs-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13.5px;
}
.logs-table thead {
  background: #f6f6fa;
}
.logs-table th {
  text-align: left;
  padding: 10px 14px;
  font-weight: 600;
  font-size: 12px;
  color: var(--tp-ink-soft, #5e5e66);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.logs-table td {
  padding: 12px 14px;
  border-top: 1px solid var(--tp-line, #ececef);
}
.tpl-name {
  font-weight: 500;
}
.tpl-id {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11px;
  color: var(--tp-ink-faint, #9c9ca3);
}
.badge {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 10px;
  font-size: 11.5px;
  font-weight: 500;
}

.pagination {
  margin-top: 14px;
  display: flex;
  justify-content: center;
}

/* detail dialog */
.detail-grid {
  font-size: 13px;
}
.grid-row {
  display: grid;
  grid-template-columns: 110px 1fr;
  gap: 10px;
  padding: 6px 0;
  border-bottom: 1px dashed var(--tp-line, #ececef);
}
.grid-row:last-of-type {
  border-bottom: none;
}
.grid-key {
  color: var(--tp-ink-soft, #5e5e66);
  font-size: 12px;
}
.grid-val {
  color: var(--tp-ink, #1f1f23);
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.grid-val code {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11.5px;
  background: var(--tp-accent-bg, #f0eeff);
  color: var(--tp-accent-ink, #4f3fcc);
  padding: 1px 5px;
  border-radius: 3px;
}
.grid-val code.muted {
  background: transparent;
  color: var(--tp-ink-faint, #9c9ca3);
}
.grid-section {
  font-size: 12px;
  font-weight: 600;
  color: var(--tp-accent-ink, #4f3fcc);
  margin: 12px 0 6px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}
.grid-section.error {
  color: #d94f4f;
}
.code {
  background: #1f1f23;
  color: #e0e0e6;
  padding: 12px 14px;
  border-radius: 6px;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 12.5px;
  line-height: 1.7;
  max-height: 240px;
  overflow: auto;
  margin: 0;
}
.code-error {
  background: #fff8e7;
  color: #8a6500;
  border-left: 3px solid #f0c14b;
  border-radius: 4px;
  font-family: inherit;
  white-space: pre-wrap;
}
.downloads {
  display: flex;
  gap: 8px;
}
.download-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 5px 12px;
  background: var(--tp-accent, #6c5ce7);
  color: #fff;
  border-radius: 6px;
  font-size: 12.5px;
  text-decoration: none;
  transition: background 100ms ease;
}
.download-btn:hover {
  background: var(--tp-accent-ink, #4f3fcc);
}
.muted {
  color: var(--tp-ink-faint, #9c9ca3);
}
</style>
