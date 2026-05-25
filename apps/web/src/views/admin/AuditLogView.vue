<script setup lang="ts">
/* eslint-disable import/no-unresolved */
import { ElDialog, ElMessage, ElPagination } from 'element-plus';
import { ShieldAlert, RefreshCw, Copy } from 'lucide-vue-next';
/* eslint-enable import/no-unresolved */
import { ref, onMounted, watch, computed } from 'vue';

import { apiFetch } from '../../lib/api';

interface AuditEntry {
  id: string;
  actorId: string | null;
  actorName: string | null;
  action: string;
  resourceType: string | null;
  resourceId: string | null;
  details: unknown;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
}

const items = ref<AuditEntry[]>([]);
const total = ref(0);
const page = ref(1);
const pageSize = ref(20);
const loading = ref(false);

const actionFilter = ref<string>('');
const actorIdFilter = ref<string>('');
const resourceTypeFilter = ref<string>('');
const fromFilter = ref<string>('');
const toFilter = ref<string>('');
const actionOptions = ref<string[]>([]);

const detailOpen = ref(false);
const detailEntry = ref<AuditEntry | null>(null);

const RESOURCE_OPTIONS = [
  { value: '', label: '全部' },
  { value: 'user', label: 'user · 用户' },
  { value: 'template', label: 'template · 模板' },
  { value: 'render_job', label: 'render_job · 渲染' },
  { value: 'api_token', label: 'api_token · API Token' },
];

async function refresh(): Promise<void> {
  loading.value = true;
  try {
    const qs = new URLSearchParams({
      page: String(page.value),
      pageSize: String(pageSize.value),
    });
    if (actionFilter.value) qs.set('action', actionFilter.value);
    if (actorIdFilter.value.trim()) qs.set('actorId', actorIdFilter.value.trim());
    if (resourceTypeFilter.value) qs.set('resourceType', resourceTypeFilter.value);
    if (fromFilter.value) qs.set('from', new Date(fromFilter.value).toISOString());
    if (toFilter.value) qs.set('to', new Date(toFilter.value).toISOString());
    const r = await apiFetch<{
      items: AuditEntry[];
      total: number;
      page: number;
      pageSize: number;
    }>(`/audit-logs?${qs.toString()}`);
    items.value = r.items;
    total.value = r.total;
  } catch (e) {
    ElMessage.error(`加载失败：${(e as Error).message}`);
  } finally {
    loading.value = false;
  }
}

async function loadActionOptions(): Promise<void> {
  try {
    const r = await apiFetch<{ items: string[] }>('/audit-logs/actions');
    actionOptions.value = r.items;
  } catch {
    // 失败不阻塞页面 — 下拉退化为空选项即可
  }
}

function resetFilters(): void {
  actionFilter.value = '';
  actorIdFilter.value = '';
  resourceTypeFilter.value = '';
  fromFilter.value = '';
  toFilter.value = '';
  page.value = 1;
  void refresh();
}

let searchTimer: number | null = null;
watch(actorIdFilter, () => {
  if (searchTimer) window.clearTimeout(searchTimer);
  searchTimer = window.setTimeout(() => {
    page.value = 1;
    void refresh();
  }, 350);
});
watch([actionFilter, resourceTypeFilter], () => {
  page.value = 1;
  void refresh();
});
watch([page, pageSize], () => void refresh());

function openDetail(entry: AuditEntry): void {
  detailEntry.value = entry;
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

function formatAbs(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

// 把 action 切成「类别 · 动作」便于扫读：'template.delete' → '模板 · 删除'
const ACTION_LABEL: Record<string, string> = {
  'user.login.local': '用户 · 本地登录',
  'user.logout': '用户 · 登出',
  'user.lark.unbind': '用户 · 解绑飞书',
  'user.profile.update': '用户 · 改基本信息',
  'user.password.change': '用户 · 改密码',
  'template.create': '模板 · 新建',
  'template.update': '模板 · 修改',
  'template.delete': '模板 · 删除',
  'token.create': 'Token · 新建',
  'token.revoke': 'Token · 吊销',
  'render.enqueue': '渲染 · 入队',
};
function actionLabel(a: string): string {
  return ACTION_LABEL[a] ?? a;
}
// 动作类别对应一个色调（绿创建 / 蓝改 / 红删除 / 灰中性）
function actionPill(a: string): string {
  if (a.endsWith('.create') || a.endsWith('.enqueue') || a === 'user.login.local') return 'ok';
  if (a.endsWith('.delete') || a.endsWith('.revoke') || a.endsWith('.unbind')) return 'danger';
  if (a.endsWith('.update') || a.endsWith('.change') || a === 'user.logout') return 'idle';
  return 'outline';
}

const detailsJsonPretty = computed(() => {
  if (!detailEntry.value) return '';
  try {
    return JSON.stringify(detailEntry.value.details ?? {}, null, 2);
  } catch {
    return String(detailEntry.value.details);
  }
});

const countLabel = computed(() => {
  if (loading.value && items.value.length === 0) return 'LOADING';
  if (total.value === 0) return '0 OF 0';
  const from = (page.value - 1) * pageSize.value + 1;
  const to = Math.min(page.value * pageSize.value, total.value);
  return `${from}–${to} OF ${total.value}`;
});

onMounted(() => {
  void loadActionOptions();
  void refresh();
});
</script>

<template>
  <div class="view-root">
    <!-- ============ Page bar ============ -->
    <header class="page-bar">
      <div class="page-title">
        <span class="ico"><ShieldAlert :size="20" :stroke-width="1.5" /></span>
        审计日志
      </div>
      <div class="page-sub">AUDIT · WHO DID WHAT WHEN</div>
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
            <span class="lbl">动作 <span class="han">· Action</span></span>
            <select v-model="actionFilter">
              <option value="">全部</option>
              <option v-for="a in actionOptions" :key="a" :value="a">
                {{ actionLabel(a) }}
              </option>
            </select>
          </label>
          <label class="field">
            <span class="lbl">资源类型 <span class="han">· Resource</span></span>
            <select v-model="resourceTypeFilter">
              <option v-for="o in RESOURCE_OPTIONS" :key="o.value" :value="o.value">
                {{ o.label }}
              </option>
            </select>
          </label>
          <label class="field">
            <span class="lbl">起 <span class="han">· From</span></span>
            <input v-model="fromFilter" type="datetime-local" />
          </label>
          <label class="field">
            <span class="lbl">止 <span class="han">· To</span></span>
            <input v-model="toFilter" type="datetime-local" />
          </label>
          <label class="field wide">
            <span class="lbl">操作者 ID <span class="han">· Actor ID</span></span>
            <input v-model="actorIdFilter" type="text" placeholder="按 user UUID 搜索..." />
          </label>
          <div class="actions">
            <button class="btn btn-secondary sm" type="button" @click="resetFilters">重置</button>
            <button class="btn btn-primary sm" type="button" @click="refresh">查询</button>
          </div>
        </div>

        <!-- 结果区 -->
        <div class="results">
          <div class="results-head">
            <h2>事件列表</h2>
            <span class="count">{{ countLabel }}</span>
            <span class="rule"></span>
          </div>

          <!-- 空态 -->
          <div v-if="!loading && items.length === 0" class="card">
            <div class="empty-state">
              <div class="eyebrow">No matching events · 暂无事件</div>
              <div class="hint">AUDIT · LOGIN · MUTATION · ADMIN ACTION</div>
            </div>
          </div>

          <!-- 列表 -->
          <div v-else class="card">
            <div class="card-body flush">
              <table class="log">
                <thead>
                  <tr>
                    <th>时间</th>
                    <th>动作</th>
                    <th>操作者</th>
                    <th>资源</th>
                    <th>IP</th>
                    <th class="th-right">操作</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="e in items" :key="e.id">
                    <td class="mono">{{ formatAbs(e.createdAt) }}</td>
                    <td>
                      <span class="pill" :class="actionPill(e.action)">
                        {{ actionLabel(e.action) }}
                      </span>
                    </td>
                    <td>
                      <div class="actor">
                        <span class="actor-name">{{ e.actorName ?? '— · 系统' }}</span>
                        <code v-if="e.actorId" class="actor-id" :title="e.actorId">
                          {{ e.actorId.slice(0, 8) }}…
                        </code>
                      </div>
                    </td>
                    <td>
                      <div v-if="e.resourceType" class="resource">
                        <span class="rt mono">{{ e.resourceType }}</span>
                        <code v-if="e.resourceId" class="rid" :title="e.resourceId">
                          {{ e.resourceId.slice(0, 8) }}…
                        </code>
                      </div>
                      <span v-else class="empty-dash">—</span>
                    </td>
                    <td class="mono ip">{{ e.ip ?? '—' }}</td>
                    <td class="th-right">
                      <a href="#" @click.prevent="openDetail(e)">详情</a>
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
    <ElDialog v-model="detailOpen" title="审计事件详情" width="640px">
      <div v-if="detailEntry" class="detail-grid">
        <div class="grid-row">
          <span class="grid-key">事件 ID</span>
          <span class="grid-val">
            <code>{{ detailEntry.id }}</code>
            <button
              class="copy-btn"
              type="button"
              @click="copyText(detailEntry.id, '已复制事件 ID')"
            >
              <Copy :size="12" :stroke-width="1.5" />
            </button>
          </span>
        </div>
        <div class="grid-row">
          <span class="grid-key">时间</span>
          <span class="grid-val mono">{{ formatAbs(detailEntry.createdAt) }}</span>
        </div>
        <div class="grid-row">
          <span class="grid-key">动作</span>
          <span class="grid-val">
            <span class="pill" :class="actionPill(detailEntry.action)">
              {{ actionLabel(detailEntry.action) }}
            </span>
            <code class="muted">{{ detailEntry.action }}</code>
          </span>
        </div>
        <div class="grid-row">
          <span class="grid-key">操作者</span>
          <span class="grid-val">
            <template v-if="detailEntry.actorId">
              {{ detailEntry.actorName ?? '(已删除用户)' }}
              <code class="muted">{{ detailEntry.actorId }}</code>
            </template>
            <template v-else>
              <span class="muted-text">系统调用（无用户身份）</span>
            </template>
          </span>
        </div>
        <div v-if="detailEntry.resourceType" class="grid-row">
          <span class="grid-key">资源</span>
          <span class="grid-val">
            <code>{{ detailEntry.resourceType }}</code>
            <code v-if="detailEntry.resourceId" class="muted">{{ detailEntry.resourceId }}</code>
          </span>
        </div>
        <div v-if="detailEntry.ip" class="grid-row">
          <span class="grid-key">IP</span>
          <span class="grid-val mono">{{ detailEntry.ip }}</span>
        </div>
        <div v-if="detailEntry.userAgent" class="grid-row">
          <span class="grid-key">User-Agent</span>
          <span class="grid-val mono ua">{{ detailEntry.userAgent }}</span>
        </div>

        <div class="grid-section">附加信息 (details)</div>
        <pre class="code-block">{{ detailsJsonPretty }}</pre>
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
  flex-wrap: wrap;
  align-items: end;
  gap: 16px;
  padding: 20px 24px;
  background: var(--paper-white);
  border: 1px solid var(--stone);
  border-radius: var(--radius-2);
}
.filters .field {
  min-width: 180px;
}
.filters .field.wide {
  flex: 1 1 240px;
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
table.log th.th-right {
  text-align: right;
}
table.log td {
  padding: 14px 20px;
  border-bottom: 1px solid var(--stone);
  font-family: var(--font-han);
  font-size: 13px;
  color: var(--fg-1);
  vertical-align: middle;
}
table.log td.th-right {
  text-align: right;
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
table.log .ip {
  color: var(--fg-3);
}

/* Actor & resource cells */
.actor {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
.actor-name {
  font-family: var(--font-han);
  color: var(--ink);
}
.actor-id {
  font-family: var(--font-mono);
  font-size: 11.5px;
  color: var(--fg-3);
  background: var(--mist);
  border: 1px solid var(--stone);
  padding: 1px 6px;
  border-radius: var(--radius-1);
}
.resource {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
.resource .rt {
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--ink);
}
.resource .rid {
  font-family: var(--font-mono);
  font-size: 11.5px;
  color: var(--fg-3);
  background: var(--mist);
  border: 1px solid var(--stone);
  padding: 1px 6px;
  border-radius: var(--radius-1);
}
.empty-dash {
  color: var(--fg-3);
}

/* row action link reused from RenderLogsView */
table.log a {
  font-family: var(--font-han);
  font-size: 12.5px;
  color: var(--ink);
  text-decoration: none;
  border-bottom: 1px solid transparent;
  padding-bottom: 1px;
  cursor: pointer;
}
table.log a:hover {
  color: var(--yangli-red);
  border-bottom-color: var(--yangli-red);
}

.pagination {
  margin-top: 20px;
  display: flex;
  justify-content: center;
}

/* Detail dialog — 与 RenderLogsView 风格一致 */
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
.grid-val.ua {
  word-break: break-all;
  font-size: 11.5px;
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
.muted-text {
  color: var(--fg-3);
  font-style: italic;
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
  max-height: 240px;
  white-space: pre-wrap;
  word-break: break-all;
}

/* date input — 抹掉浏览器默认蓝色边框，用品牌色 */
.filters input[type='datetime-local'] {
  font-family: var(--font-han);
  height: 36px;
}
</style>
