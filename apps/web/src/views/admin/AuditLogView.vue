<script setup lang="ts">
/* eslint-disable import/no-unresolved */
import { ElDialog, ElMessage, ElPagination } from 'element-plus';
import { ShieldAlert, RefreshCw, Copy } from 'lucide-vue-next';
/* eslint-enable import/no-unresolved */
import { ref, onMounted, watch, computed } from 'vue';

import BrandDatePicker from '../../components/BrandDatePicker.vue';
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
// 动作徽章三档配色：
//   ok    绿 — 登录 / 创建 / 入队（成功类）
//   warn  琥珀 — 登出 / 撤销 / 删除 / 解绑（注销 · 移除类）
//   tpl   灰 — 模板修改 / 改密 / 一般操作
function actionPill(a: string): 'ok' | 'warn' | 'tpl' {
  if (a.endsWith('.create') || a.endsWith('.enqueue') || a === 'user.login.local') return 'ok';
  if (
    a.endsWith('.delete') ||
    a.endsWith('.revoke') ||
    a.endsWith('.unbind') ||
    a === 'user.logout'
  )
    return 'warn';
  return 'tpl';
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
            <BrandDatePicker v-model="fromFilter" />
          </label>
          <label class="field">
            <span class="lbl">止 <span class="han">· To</span></span>
            <BrandDatePicker v-model="toFilter" />
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
          <div class="sec-head">
            <span class="num">01</span>
            <span class="red-square"></span>
            <span class="label">事件列表</span>
            <span class="meta">{{ countLabel }} · EVENTS</span>
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
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="e in items" :key="e.id">
                    <td class="mono">{{ formatAbs(e.createdAt) }}</td>
                    <td>
                      <span class="action-pill" :class="actionPill(e.action)">
                        <span class="dot"></span>{{ actionLabel(e.action) }}
                      </span>
                    </td>
                    <td>
                      <span v-if="e.actorName" class="name-cell">{{ e.actorName }}</span>
                      <span v-else class="name-cell sys">— · 系统</span>
                    </td>
                    <td>
                      <span v-if="e.resourceType" class="name-cell">{{ e.resourceType }}</span>
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
            <span class="action-pill" :class="actionPill(detailEntry.action)">
              <span class="dot"></span>{{ actionLabel(detailEntry.action) }}
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

/* Page-bar 签名：左对齐 2px × 96px 红实线（与模板中心 v2 一致） */
.page-bar {
  position: relative;
}
.page-bar::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  height: 2px;
  width: 96px;
  background: var(--yangli-red);
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
  margin-top: 4px;
}
/* Section 头：[mono 01] [红方块] [han 标题] [mono meta] [延展线] */
.sec-head {
  display: flex;
  align-items: baseline;
  gap: 14px;
  padding: 22px 0 14px;
}
.sec-head .num {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--yangli-red);
  letter-spacing: 0.1em;
}
.sec-head .red-square {
  display: inline-block;
  width: 8px;
  height: 8px;
  background: var(--yangli-red);
  align-self: center;
}
.sec-head .label {
  font-family: var(--font-han);
  font-size: 14px;
  font-weight: 600;
  color: var(--ink);
}
.sec-head .meta {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--fg-3);
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.sec-head .rule {
  flex: 1;
  height: 1px;
  background: var(--stone);
  align-self: center;
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

/* 操作者 / 资源 — 仅显示名称（UUID 仅在详情 dialog 展开） */
table.log .name-cell {
  color: var(--ink);
}
table.log .name-cell.sys {
  color: var(--fg-3);
}
.empty-dash {
  color: var(--fg-3);
}

/* 动作徽章三档：默认绿(ok) / warn 琥珀 / tpl 灰，前置 5px 同色圆点 */
.action-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 10px;
  border-radius: 999px;
  background: rgba(15, 140, 90, 0.1);
  color: #0f8c5a;
  font-family: var(--font-han);
  font-size: 11.5px;
  font-weight: 500;
}
.action-pill .dot {
  width: 5px;
  height: 5px;
  border-radius: 999px;
  background: currentColor;
}
.action-pill.warn {
  background: rgba(198, 138, 0, 0.12);
  color: #8b6500;
}
.action-pill.tpl {
  background: rgba(28, 28, 28, 0.06);
  color: var(--ink);
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
</style>
