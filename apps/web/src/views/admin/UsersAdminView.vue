<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
// eslint-disable-next-line import/no-unresolved
import { ElDialog, ElMessage } from 'element-plus';
// eslint-disable-next-line import/no-unresolved
import { Users, AlertTriangle, Copy, Plus } from 'lucide-vue-next';

import BrandPagination from '../../components/BrandPagination.vue';
import ConfirmDialog from '../../components/ConfirmDialog.vue';
import { apiFetch, ApiClientError } from '../../lib/api';

/* ========== Types ========== */
interface UserCan {
  disable: boolean;
  changeRole: boolean;
  resetPassword: boolean;
}

interface UserItem {
  id: string;
  name: string;
  email: string | null;
  role: 'user' | 'admin' | 'emergency_admin';
  localUsername: string | null;
  larkUserId: string | null;
  hasLocalPassword: boolean;
  hasLarkBinding: boolean;
  accountType: 'internal' | 'external';
  accountLabel: string;
  externalCode: string | null;
  disabled: boolean;
  can: UserCan;
  disabledReason: string | null;
  lastLoginAt: string | null;
  createdAt: string;
}

interface UsersPage {
  items: UserItem[];
  total: number;
  page: number;
  pageSize: number;
}

/* ========== List state ========== */
const items = ref<UserItem[]>([]);
const total = ref(0);
const page = ref(1);
const pageSize = ref(20);
const loading = ref(false);

const searchInput = ref('');
const roleFilter = ref('');
const statusFilter = ref('');
const typeFilter = ref('');

const ROLE_OPTIONS = [
  { value: '', label: '全部' },
  { value: 'user', label: '普通用户' },
  { value: 'admin', label: '管理员' },
  { value: 'emergency_admin', label: '超级管理员' },
];
const STATUS_OPTIONS = [
  { value: '', label: '全部' },
  { value: 'active', label: '活跃' },
  { value: 'disabled', label: '已禁用' },
];
const TYPE_OPTIONS = [
  { value: '', label: '全部' },
  { value: 'internal', label: '内部' },
  { value: 'external', label: '外部' },
];

async function refresh(): Promise<void> {
  loading.value = true;
  try {
    const qs = new URLSearchParams({
      page: String(page.value),
      pageSize: String(pageSize.value),
    });
    if (searchInput.value.trim()) qs.set('search', searchInput.value.trim());
    if (roleFilter.value) qs.set('role', roleFilter.value);
    if (statusFilter.value) qs.set('status', statusFilter.value);
    if (typeFilter.value) qs.set('type', typeFilter.value);
    const r = await apiFetch<UsersPage>(`/admin/users?${qs.toString()}`);
    items.value = r.items;
    total.value = r.total;
  } catch (e) {
    ElMessage.error(`加载失败：${(e as Error).message}`);
  } finally {
    loading.value = false;
  }
}

function resetFilters(): void {
  searchInput.value = '';
  roleFilter.value = '';
  statusFilter.value = '';
  typeFilter.value = '';
  page.value = 1;
  void refresh();
}

let searchTimer: number | null = null;
watch(searchInput, () => {
  if (searchTimer) window.clearTimeout(searchTimer);
  searchTimer = window.setTimeout(() => {
    page.value = 1;
    void refresh();
  }, 350);
});
watch([roleFilter, statusFilter, typeFilter], () => {
  page.value = 1;
  void refresh();
});
watch([page, pageSize], () => void refresh());

const countLabel = computed(() => {
  if (loading.value && items.value.length === 0) return 'LOADING';
  if (total.value === 0) return '0 OF 0';
  const from = (page.value - 1) * pageSize.value + 1;
  const to = Math.min(page.value * pageSize.value, total.value);
  return `${from}–${to} OF ${total.value}`;
});

onMounted(refresh);

/* ========== Helpers ========== */
function formatAbs(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function friendlyMessage(code: string): string | null {
  const map: Record<string, string> = {
    last_admin_protected: '不能禁用/降级最后一个管理员',
    cannot_modify_self: '不能操作自己',
    emergency_admin_protected: '超级管理员受保护',
    external_cannot_be_admin: '仅内部账号可授权管理员',
    username_taken: '用户名已被占用',
    not_a_local_account: '该账号无本地密码，无法重置',
  };
  return map[code] ?? null;
}

function handleApiError(e: unknown, fallback = '操作失败'): void {
  if (e instanceof ApiClientError) {
    ElMessage.error(friendlyMessage(e.code) ?? e.message);
  } else {
    ElMessage.error(fallback);
  }
}

function accountId(item: UserItem): string {
  if (item.accountType === 'internal') return item.larkUserId ?? item.localUsername ?? '—';
  return item.externalCode ?? item.localUsername ?? '—';
}

function disabledTooltip(item: UserItem): string | undefined {
  if (!item.disabledReason) return undefined;
  return friendlyMessage(item.disabledReason) ?? item.disabledReason;
}

async function copyText(text: string, label = '已复制'): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    ElMessage.success(label);
  } catch {
    ElMessage.error('复制失败');
  }
}

/* ========== Change role ========== */
const roleChanging = ref<string | null>(null);

async function doChangeRole(item: UserItem, newRole: 'user' | 'admin'): Promise<void> {
  if (newRole === item.role) return;
  roleChanging.value = item.id;
  try {
    await apiFetch(`/admin/users/${item.id}/role`, {
      method: 'PATCH',
      body: JSON.stringify({ role: newRole }),
    });
    ElMessage.success('角色已更新');
    await refresh();
  } catch (e) {
    handleApiError(e, '更新角色失败');
  } finally {
    roleChanging.value = null;
  }
}

/* ========== Reset password ========== */
const resetConfirmOpen = ref(false);
const resetTarget = ref<UserItem | null>(null);
const resetLoading = ref(false);

function openResetConfirm(item: UserItem): void {
  resetTarget.value = item;
  resetConfirmOpen.value = true;
}

const otpDialogOpen = ref(false);
const otpPlaintext = ref('');
const otpTitle = ref('');

async function confirmReset(): Promise<void> {
  const target = resetTarget.value;
  if (!target) return;
  resetLoading.value = true;
  try {
    const r = await apiFetch<{ plaintext: string }>(`/admin/users/${target.id}/reset-password`, {
      method: 'POST',
    });
    resetConfirmOpen.value = false;
    ElMessage.success('密码已重置');
    otpTitle.value = `已重置密码 — ${target.name}`;
    otpPlaintext.value = r.plaintext;
    otpDialogOpen.value = true;
    await refresh();
  } catch (e) {
    handleApiError(e, '重置密码失败');
  } finally {
    resetLoading.value = false;
  }
}

/* ========== Disable / Enable ========== */
const disableConfirmOpen = ref(false);
const disableTarget = ref<UserItem | null>(null);
const disableLoading = ref(false);

function openDisableConfirm(item: UserItem): void {
  disableTarget.value = item;
  disableConfirmOpen.value = true;
}

async function confirmDisable(): Promise<void> {
  const target = disableTarget.value;
  if (!target) return;
  disableLoading.value = true;
  try {
    await apiFetch(`/admin/users/${target.id}/disable`, { method: 'POST' });
    disableConfirmOpen.value = false;
    ElMessage.success('账号已禁用');
    await refresh();
  } catch (e) {
    handleApiError(e, '禁用失败');
  } finally {
    disableLoading.value = false;
  }
}

async function doEnable(item: UserItem): Promise<void> {
  try {
    await apiFetch(`/admin/users/${item.id}/enable`, { method: 'POST' });
    ElMessage.success('账号已启用');
    await refresh();
  } catch (e) {
    handleApiError(e, '启用失败');
  }
}

/* ========== Create local account ========== */
const createOpen = ref(false);
const createForm = ref({
  localUsername: '',
  name: '',
  role: 'user' as 'user' | 'admin',
  email: '',
});
const creating = ref(false);

function openCreate(): void {
  createForm.value = { localUsername: '', name: '', role: 'user', email: '' };
  createOpen.value = true;
}

async function doCreate(): Promise<void> {
  if (!createForm.value.localUsername.trim() || !createForm.value.name.trim()) {
    ElMessage.warning('用户名和姓名为必填项');
    return;
  }
  creating.value = true;
  try {
    const body: Record<string, string> = {
      localUsername: createForm.value.localUsername.trim(),
      name: createForm.value.name.trim(),
      role: createForm.value.role,
    };
    if (createForm.value.email.trim()) body.email = createForm.value.email.trim();
    const r = await apiFetch<{ plaintext: string; user: UserItem }>('/admin/users', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    createOpen.value = false;
    ElMessage.success('账号已创建');
    otpTitle.value = `账号已创建 — ${r.user.name}`;
    otpPlaintext.value = r.plaintext;
    otpDialogOpen.value = true;
    await refresh();
  } catch (e) {
    handleApiError(e, '创建账号失败');
  } finally {
    creating.value = false;
  }
}
</script>

<template>
  <div class="view-root">
    <!-- ============ Page bar ============ -->
    <header class="page-bar">
      <div class="page-title">
        <span class="ico"><Users :size="20" :stroke-width="1.5" /></span>
        用户管理
      </div>
      <div class="page-sub">USERS · 管理</div>
      <div class="page-bar-spacer"></div>
      <button class="btn btn-primary sm" type="button" @click="openCreate">
        <span class="ico"><Plus :size="14" :stroke-width="1.5" /></span>
        新建本地账号
      </button>
    </header>

    <!-- ============ Body ============ -->
    <div class="page-body">
      <div class="max">
        <!-- 过滤区 -->
        <div class="filters">
          <label class="field wide">
            <span class="lbl">搜索 <span class="han">· Search</span></span>
            <input v-model="searchInput" type="text" placeholder="按姓名 / 用户名 / 邮箱搜索…" />
          </label>
          <label class="field">
            <span class="lbl">角色 <span class="han">· Role</span></span>
            <select v-model="roleFilter">
              <option v-for="o in ROLE_OPTIONS" :key="o.value" :value="o.value">
                {{ o.label }}
              </option>
            </select>
          </label>
          <label class="field">
            <span class="lbl">状态 <span class="han">· Status</span></span>
            <select v-model="statusFilter">
              <option v-for="o in STATUS_OPTIONS" :key="o.value" :value="o.value">
                {{ o.label }}
              </option>
            </select>
          </label>
          <label class="field">
            <span class="lbl">类型 <span class="han">· Type</span></span>
            <select v-model="typeFilter">
              <option v-for="o in TYPE_OPTIONS" :key="o.value" :value="o.value">
                {{ o.label }}
              </option>
            </select>
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
            <span class="label">用户列表</span>
            <span class="meta">{{ countLabel }} · USERS</span>
            <span class="rule"></span>
          </div>

          <!-- 空态 -->
          <div v-if="!loading && items.length === 0" class="card">
            <div class="empty-state">
              <div class="eyebrow">No matching users · 暂无用户</div>
              <div class="hint">LOCAL · LARK · ADMIN · USER</div>
            </div>
          </div>

          <!-- 列表 -->
          <div v-else class="card">
            <div class="card-body flush">
              <table class="log">
                <thead>
                  <tr>
                    <th>名称</th>
                    <th>账号</th>
                    <th>角色</th>
                    <th>类型</th>
                    <th>状态</th>
                    <th>最近登录</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="item in items" :key="item.id">
                    <!-- 名称 -->
                    <td>
                      <div class="name-cell">
                        <span class="name">{{ item.name }}</span>
                        <span v-if="item.email" class="email">{{ item.email }}</span>
                      </div>
                    </td>
                    <!-- 账号 -->
                    <td class="mono">{{ accountId(item) }}</td>
                    <!-- 角色 -->
                    <td>
                      <span
                        class="pill"
                        :class="{
                          'role-emergency': item.role === 'emergency_admin',
                          'role-admin': item.role === 'admin',
                          'role-user': item.role === 'user',
                        }"
                      >
                        {{
                          item.role === 'emergency_admin'
                            ? '超级管理员'
                            : item.role === 'admin'
                              ? '管理员'
                              : '普通用户'
                        }}
                      </span>
                    </td>
                    <!-- 类型 -->
                    <td>{{ item.accountLabel }}</td>
                    <!-- 状态 -->
                    <td>
                      <span class="pill" :class="item.disabled ? 'danger' : 'ok'">
                        {{ item.disabled ? '已禁用' : '活跃' }}
                      </span>
                    </td>
                    <!-- 最近登录 -->
                    <td class="mono">{{ formatAbs(item.lastLoginAt) }}</td>
                    <!-- 操作 -->
                    <td>
                      <div class="row-actions">
                        <!-- 改角色 -->
                        <span
                          class="action-wrap"
                          :title="
                            item.role === 'emergency_admin'
                              ? '超级管理员不可更改角色'
                              : !item.can.changeRole
                                ? disabledTooltip(item)
                                : undefined
                          "
                        >
                          <!-- 超级管理员：只读文本，不渲染 select -->
                          <span
                            v-if="item.role === 'emergency_admin'"
                            class="role-select role-select-readonly"
                            >超级管理员</span
                          >
                          <!-- 普通/管理员行：渲染可操作 select -->
                          <select
                            v-else
                            class="role-select"
                            :value="item.role"
                            :disabled="!item.can.changeRole || roleChanging === item.id"
                            @change="
                              (e) =>
                                doChangeRole(
                                  item,
                                  (e.target as HTMLSelectElement).value as 'user' | 'admin',
                                )
                            "
                          >
                            <option value="user">普通用户</option>
                            <option
                              value="admin"
                              :disabled="item.accountType === 'external'"
                              :title="
                                item.accountType === 'external'
                                  ? '仅内部账号可授权管理员'
                                  : undefined
                              "
                            >
                              管理员
                            </option>
                          </select>
                        </span>
                        <!-- 重置密码 -->
                        <button
                          class="act-btn"
                          type="button"
                          :disabled="!item.can.resetPassword"
                          :title="
                            !item.can.resetPassword
                              ? disabledTooltip(item) ?? '无法重置密码'
                              : '重置密码'
                          "
                          @click="openResetConfirm(item)"
                        >
                          重置密码
                        </button>
                        <!-- 禁用/启用 -->
                        <button
                          v-if="item.disabled"
                          class="act-btn enable"
                          type="button"
                          @click="doEnable(item)"
                        >
                          启用
                        </button>
                        <button
                          v-else
                          class="act-btn danger"
                          type="button"
                          :disabled="!item.can.disable"
                          :title="
                            !item.can.disable ? disabledTooltip(item) ?? '无法禁用' : '禁用账号'
                          "
                          @click="openDisableConfirm(item)"
                        >
                          禁用
                        </button>
                      </div>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <!-- 分页 -->
          <div class="pagination">
            <BrandPagination v-model:current-page="page" :total="total" :page-size="pageSize" />
          </div>
        </div>
      </div>
    </div>

    <!-- ============ 新建本地账号 dialog ============ -->
    <ElDialog v-model="createOpen" title="新建本地账号" width="480px">
      <div class="dlg-body">
        <div class="field">
          <label class="lbl"
            >用户名 <span class="han">· Username</span> <span class="req-mark">*</span></label
          >
          <input
            v-model="createForm.localUsername"
            type="text"
            placeholder="仅限字母、数字、下划线"
            maxlength="64"
            autofocus
          />
        </div>
        <div class="field">
          <label class="lbl"
            >姓名 <span class="han">· Name</span> <span class="req-mark">*</span></label
          >
          <input v-model="createForm.name" type="text" placeholder="显示名称" maxlength="64" />
        </div>
        <div class="field">
          <label class="lbl">角色 <span class="han">· Role</span></label>
          <select v-model="createForm.role">
            <option value="user">普通用户</option>
            <option value="admin">管理员</option>
          </select>
        </div>
        <div class="field">
          <label class="lbl"
            >邮箱 <span class="han">· Email</span> <span class="opt-mark">可选</span></label
          >
          <input
            v-model="createForm.email"
            type="email"
            placeholder="user@example.com"
            maxlength="128"
          />
        </div>
        <p class="dlg-hint">
          创建后将显示一次性初始密码，请立即复制并交给用户。用户首次登录后需修改密码。
        </p>
      </div>
      <template #footer>
        <button class="btn btn-secondary sm" type="button" @click="createOpen = false">取消</button>
        <button class="btn btn-primary sm" type="button" :disabled="creating" @click="doCreate">
          {{ creating ? '创建中…' : '创建账号' }}
        </button>
      </template>
    </ElDialog>

    <!-- ============ 重置密码确认 ============ -->
    <ConfirmDialog
      v-model="resetConfirmOpen"
      variant="destructive"
      title="重置密码"
      cap="RESET PASSWORD"
      :body="resetTarget ? `确认重置「${resetTarget.name}」的登录密码？将生成一次性新密码。` : ''"
      confirm-text="重置"
      :loading="resetLoading"
      @confirm="confirmReset"
    />

    <!-- ============ 禁用账号确认 ============ -->
    <ConfirmDialog
      v-model="disableConfirmOpen"
      variant="destructive"
      title="禁用账号"
      cap="DISABLE ACCOUNT"
      :body="
        disableTarget
          ? `确认禁用账号「${disableTarget.name}」？该用户将无法登录，直到重新启用。`
          : ''
      "
      confirm-text="禁用"
      :loading="disableLoading"
      @confirm="confirmDisable"
    />

    <!-- ============ 一次性密码 dialog ============ -->
    <ElDialog
      v-model="otpDialogOpen"
      :title="otpTitle"
      width="580px"
      :close-on-click-modal="false"
      :close-on-press-escape="false"
      :show-close="false"
    >
      <div class="warn-box">
        <span class="ico"><AlertTriangle :size="18" :stroke-width="1.5" /></span>
        <div>
          <strong>请立即复制并交给用户。</strong>
          此密码仅显示一次，关闭后无法再查看。用户首次登录需修改密码。
        </div>
      </div>
      <div class="plaintext-row">
        <code class="plaintext">{{ otpPlaintext }}</code>
        <button
          class="btn btn-secondary sm"
          type="button"
          @click="copyText(otpPlaintext, '已复制到剪贴板')"
        >
          <span class="ico"><Copy :size="14" :stroke-width="1.5" /></span>
          复制
        </button>
      </div>
      <p class="dlg-hint">此密码仅显示一次，请立即复制并交给用户；用户首次登录需修改密码。</p>
      <template #footer>
        <button
          class="btn btn-primary sm"
          type="button"
          @click="
            () => {
              otpDialogOpen = false;
              otpPlaintext = '';
            }
          "
        >
          我已复制
        </button>
      </template>
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

/* 过滤区 */
.filters {
  display: flex;
  align-items: end;
  gap: 16px;
  padding: 20px 24px;
  background: var(--paper-white);
  border: 1px solid var(--stone);
  border-radius: var(--radius-2);
  flex-wrap: wrap;
}
.filters .field {
  min-width: 160px;
}
.filters .field.wide {
  flex: 1;
  min-width: 220px;
}
.filters .actions {
  display: flex;
  gap: 10px;
  align-self: end;
}

/* 结果区 */
.results {
  margin-top: 24px;
}

/* Section 头 */
.sec-head {
  display: flex;
  align-items: baseline;
  gap: 14px;
  margin-bottom: 14px;
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

/* 用户表格 */
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
  padding: 12px 16px;
  border-bottom: 1px solid var(--stone);
  background: var(--mist);
}
table.log td {
  padding: 12px 16px;
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

/* 名称列 */
.name-cell {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.name-cell .name {
  font-weight: 500;
  color: var(--ink);
}
.name-cell .email {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--fg-3);
}

/* 角色 pill */
.pill.role-emergency {
  background: rgba(211, 45, 39, 0.12);
  color: var(--yangli-red);
  border-color: rgba(211, 45, 39, 0.35);
}
.pill.role-admin {
  background: var(--ink);
  color: var(--paper-white);
  border-color: var(--ink);
}
.pill.role-user {
  background: var(--mist);
  color: var(--fg-2);
  border-color: var(--stone);
}

/* 操作列 */
.row-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.action-wrap {
  display: inline-flex;
}

.role-select {
  font-family: var(--font-han);
  font-size: 12px;
  color: var(--ink);
  background: var(--paper-white);
  border: 1px solid var(--stone);
  border-radius: var(--radius-1);
  padding: 3px 10px;
  cursor: pointer;
  height: 28px;
  /* A2:去原生下拉外观,补自定义箭头。文字左对齐(原生 select 按最宽选项「普通用户」
     定宽,短值「管理员」若居中 + 右箭头会左侧空洞);标准下拉=文字左、箭头右,紧凑不空。 */
  appearance: none;
  -webkit-appearance: none;
  -moz-appearance: none;
  text-align: left;
}
/* 仅真正的 <select> 补自定义下拉箭头 + 右留箭头位(只读 span 不加) */
select.role-select {
  padding-right: 24px;
  background-image: url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='none' stroke='%23999' stroke-width='1.5' d='M2.5 4.5l3.5 3.5 3.5-3.5'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 6px center;
  background-size: 9px;
}
.role-select:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.role-select:focus {
  outline: none;
  border-color: var(--yangli-graphite);
}
.role-select-readonly {
  display: inline-flex;
  align-items: center;
  opacity: 0.55;
  cursor: default;
}

.act-btn {
  font-family: var(--font-han);
  font-size: 12px;
  color: var(--ink);
  background: transparent;
  border: 1px solid var(--stone);
  border-radius: var(--radius-1);
  padding: 3px 10px;
  height: 28px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  line-height: 1;
  transition:
    background var(--dur-fast) var(--ease-default),
    color var(--dur-fast) var(--ease-default);
}
.act-btn:hover:not(:disabled) {
  background: var(--mist);
}
.act-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.act-btn.danger {
  color: var(--yangli-red);
  border-color: rgba(211, 45, 39, 0.4);
}
.act-btn.danger:hover:not(:disabled) {
  background: rgba(211, 45, 39, 0.08);
}
.act-btn.enable {
  color: #0f8c5a;
  border-color: rgba(15, 140, 90, 0.4);
}
.act-btn.enable:hover:not(:disabled) {
  background: rgba(15, 140, 90, 0.08);
}

/* 分页 */
.pagination {
  margin-top: 20px;
  display: flex;
  justify-content: center;
}

/* Dialog 共用 */
.dlg-body {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 4px 0 0;
}
.dlg-body .field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.dlg-body .lbl {
  font-family: var(--font-sans);
  font-size: 10.5px;
  font-weight: 500;
  letter-spacing: var(--tr-caption);
  text-transform: uppercase;
  color: var(--fg-3);
}
.dlg-body .lbl .han {
  font-family: var(--font-han);
  font-weight: 400;
  letter-spacing: 0.02em;
  text-transform: none;
}
.req-mark {
  color: var(--yangli-red);
  font-weight: 600;
}
.opt-mark {
  font-family: var(--font-han);
  font-size: 10px;
  color: var(--fg-3);
  text-transform: none;
  letter-spacing: 0;
  font-weight: 400;
}
.dlg-hint {
  font-family: var(--font-han);
  font-size: 12.5px;
  color: var(--fg-3);
  line-height: 1.7;
  margin: 4px 0 0;
}

/* 一次性密码 dialog */
.warn-box {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  background: rgba(198, 138, 0, 0.1);
  border-left: 3px solid #c68a00;
  padding: 12px 14px;
  border-radius: var(--radius-1);
  font-family: var(--font-han);
  font-size: 13px;
  color: #6e5300;
  line-height: 1.65;
  margin-bottom: 14px;
}
.warn-box .ico {
  color: #c68a00;
  flex-shrink: 0;
  margin-top: 1px;
}
.warn-box strong {
  color: #5a4200;
}
.plaintext-row {
  display: flex;
  align-items: center;
  gap: 8px;
  background: var(--ink);
  color: var(--paper-white);
  padding: 10px 12px;
  border-radius: var(--radius-2);
  margin-bottom: 10px;
}
.plaintext {
  flex: 1;
  font-family: var(--font-mono);
  font-size: 13px;
  background: transparent;
  color: var(--paper-white);
  word-break: break-all;
  border: 0;
  padding: 0;
}

/* empty state */
.empty-state {
  padding: 48px 24px;
  text-align: center;
}
.empty-state .eyebrow {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--fg-3);
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.empty-state .hint {
  font-family: var(--font-han);
  font-size: 12.5px;
  color: var(--fg-3);
  margin-top: 8px;
}
</style>
