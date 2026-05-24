<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
// eslint-disable-next-line import/no-unresolved
import {
  ElDialog,
  ElForm,
  ElFormItem,
  ElInput,
  ElButton,
  ElMessage,
  ElMessageBox,
} from 'element-plus';
// eslint-disable-next-line import/no-unresolved
import { Copy, KeyRound, Trash2, AlertTriangle } from 'lucide-vue-next';
// eslint-disable-next-line import/no-unresolved
import { apiFetch } from '../lib/api';

interface TokenSummary {
  id: string;
  name: string;
  prefix: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

const items = ref<TokenSummary[]>([]);
const loading = ref(true);

// 创建 dialog
const createDialogOpen = ref(false);
const newName = ref('');
const creating = ref(false);

// 一次性明文 dialog
const plaintextDialogOpen = ref(false);
const newPlaintext = ref('');

async function refresh(): Promise<void> {
  loading.value = true;
  try {
    const r = await apiFetch<{ items: TokenSummary[] }>('/users/me/api-tokens');
    items.value = r.items;
  } finally {
    loading.value = false;
  }
}

async function doCreate(): Promise<void> {
  if (!newName.value.trim()) {
    ElMessage.warning('请输入 token 名称');
    return;
  }
  creating.value = true;
  try {
    const r = await apiFetch<{ plaintext: string; record: TokenSummary }>('/users/me/api-tokens', {
      method: 'POST',
      body: JSON.stringify({ name: newName.value.trim() }),
    });
    createDialogOpen.value = false;
    newName.value = '';
    newPlaintext.value = r.plaintext;
    plaintextDialogOpen.value = true;
    await refresh();
  } catch (e) {
    ElMessage.error(`创建失败：${(e as Error).message}`);
  } finally {
    creating.value = false;
  }
}

async function doRevoke(t: TokenSummary): Promise<void> {
  try {
    await ElMessageBox.confirm(
      `吊销 token「${t.name}」？此操作不可恢复 — 任何使用此 token 的脚本将立即 401。`,
      '吊销 Token',
      { type: 'warning', confirmButtonText: '吊销', cancelButtonText: '取消' },
    );
  } catch {
    return;
  }
  try {
    await apiFetch(`/users/me/api-tokens/${t.id}`, { method: 'DELETE' });
    ElMessage.success('已吊销');
    await refresh();
  } catch (e) {
    ElMessage.error(`吊销失败：${(e as Error).message}`);
  }
}

async function copyText(text: string, label = '已复制'): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    ElMessage.success(label);
  } catch {
    ElMessage.error('复制失败');
  }
}

function formatRelative(iso: string | null): string {
  if (!iso) return '未使用';
  const t = new Date(iso).getTime();
  const now = Date.now();
  const diff = now - t;
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec} 秒前`;
  if (sec < 3600) return `${Math.floor(sec / 60)} 分钟前`;
  if (sec < 86400) return `${Math.floor(sec / 3600)} 小时前`;
  return `${Math.floor(sec / 86400)} 天前`;
}

function formatAbs(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

onMounted(refresh);

const activeCount = computed(() => items.value.filter((i) => !i.revokedAt).length);
</script>

<template>
  <div class="page-wrap">
    <header class="page-header">
      <div>
        <h1 class="page-title">
          <KeyRound :size="22" :stroke-width="2" />
          <span>API 凭证</span>
        </h1>
        <p class="page-sub">
          用于在脚本 / 集成 / 自动化中调用 <code>POST /api/render</code> 系列接口。
          管理端点本身只接受登录 cookie 鉴权（防 token 自管理 token 的环）。
        </p>
      </div>
      <ElButton type="primary" @click="createDialogOpen = true">
        <KeyRound :size="14" :stroke-width="2" style="margin-right: 4px" />
        创建 Token
      </ElButton>
    </header>

    <section class="section">
      <div v-if="loading" class="empty">加载中…</div>
      <div v-else-if="items.length === 0" class="empty">
        当前无 API token。点击右上角「创建 Token」开始接入。
      </div>
      <table v-else class="tokens-table">
        <thead>
          <tr>
            <th>名称</th>
            <th>前缀</th>
            <th>创建时间</th>
            <th>最近使用</th>
            <th>状态</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="t in items" :key="t.id" :class="{ revoked: !!t.revokedAt }">
            <td>{{ t.name }}</td>
            <td>
              <code class="prefix">{{ t.prefix }}…</code>
            </td>
            <td>{{ formatAbs(t.createdAt) }}</td>
            <td :title="t.lastUsedAt ?? '未使用'">{{ formatRelative(t.lastUsedAt) }}</td>
            <td>
              <span v-if="t.revokedAt" class="badge badge-revoked">已吊销</span>
              <span v-else class="badge badge-active">活跃</span>
            </td>
            <td>
              <ElButton v-if="!t.revokedAt" type="danger" link size="small" @click="doRevoke(t)">
                <Trash2 :size="14" :stroke-width="2" />
                吊销
              </ElButton>
              <span v-else class="muted">—</span>
            </td>
          </tr>
        </tbody>
      </table>
      <div v-if="!loading && items.length > 0" class="footer-meta">
        共 {{ items.length }} 个 token，{{ activeCount }} 个活跃。
      </div>
    </section>

    <!-- 创建 dialog -->
    <ElDialog v-model="createDialogOpen" title="创建新 Token" width="420px">
      <ElForm @submit.prevent>
        <ElFormItem label="名称" required>
          <ElInput
            v-model="newName"
            placeholder="如：demo-bot / ci-script"
            maxlength="64"
            show-word-limit
            autofocus
          />
        </ElFormItem>
        <p class="hint">
          建议起一个能识别用途的名字（哪个服务 / 哪个环境）。 token
          一旦生成只会显示一次，请创建后立即复制保存。
        </p>
      </ElForm>
      <template #footer>
        <ElButton @click="createDialogOpen = false">取消</ElButton>
        <ElButton type="primary" :loading="creating" @click="doCreate">生成</ElButton>
      </template>
    </ElDialog>

    <!-- 一次性明文 dialog（创建成功后弹）-->
    <ElDialog
      v-model="plaintextDialogOpen"
      title="Token 已创建"
      width="560px"
      :close-on-click-modal="false"
      :close-on-press-escape="false"
      :show-close="false"
    >
      <div class="warn-box">
        <AlertTriangle :size="18" :stroke-width="2" />
        <div>
          <strong>请立即复制保存。</strong>
          关闭本对话框后，本平台再也不会以明文显示这个 token。 忘记了只能创建新的。
        </div>
      </div>
      <div class="plaintext-row">
        <code class="plaintext">{{ newPlaintext }}</code>
        <ElButton type="primary" size="small" @click="copyText(newPlaintext, '已复制到剪贴板')">
          <Copy :size="14" :stroke-width="2" style="margin-right: 4px" />
          复制
        </ElButton>
      </div>
      <p class="hint">在请求里加请求头：<code>Authorization: Bearer &lt;此 token&gt;</code></p>
      <template #footer>
        <ElButton
          type="primary"
          @click="
            () => {
              plaintextDialogOpen = false;
              newPlaintext = '';
            }
          "
        >
          我已复制
        </ElButton>
      </template>
    </ElDialog>
  </div>
</template>

<style scoped>
.page-wrap {
  padding: 24px 40px 60px;
  max-width: 1100px;
  margin: 0 auto;
  font-family: -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Noto Sans SC', 'Microsoft YaHei',
    system-ui, sans-serif;
}
.page-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 24px;
  margin-bottom: 20px;
}
.page-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 22px;
  font-weight: 600;
  margin: 0 0 6px;
  color: var(--tp-ink, #1f1f23);
}
.page-sub {
  margin: 0;
  font-size: 13px;
  color: var(--tp-ink-soft, #5e5e66);
  line-height: 1.7;
  max-width: 700px;
}
.page-sub code {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 12px;
  background: var(--tp-accent-bg, #f0eeff);
  color: var(--tp-accent-ink, #4f3fcc);
  padding: 1px 5px;
  border-radius: 3px;
}

.section {
  background: #fff;
  border: 1px solid var(--tp-line, #ececef);
  border-radius: 12px;
  padding: 4px;
}
.empty {
  padding: 40px;
  text-align: center;
  color: var(--tp-ink-faint, #9c9ca3);
}
.tokens-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13.5px;
}
.tokens-table thead {
  background: #f6f6fa;
}
.tokens-table th {
  text-align: left;
  padding: 10px 14px;
  font-weight: 600;
  font-size: 12px;
  color: var(--tp-ink-soft, #5e5e66);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.tokens-table td {
  padding: 12px 14px;
  border-top: 1px solid var(--tp-line, #ececef);
}
.tokens-table tr.revoked td {
  color: var(--tp-ink-faint, #9c9ca3);
  background: #fafafa;
}
.prefix {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 12px;
  background: var(--tp-accent-bg, #f0eeff);
  color: var(--tp-accent-ink, #4f3fcc);
  padding: 2px 8px;
  border-radius: 4px;
}
.badge {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 10px;
  font-size: 11px;
  font-weight: 500;
}
.badge-active {
  background: #e7f7ed;
  color: #26a45c;
}
.badge-revoked {
  background: #f3f3f5;
  color: #9c9ca3;
}
.muted {
  color: var(--tp-ink-faint, #9c9ca3);
}
.footer-meta {
  text-align: right;
  font-size: 11.5px;
  color: var(--tp-ink-faint, #9c9ca3);
  padding: 10px 14px;
}

.warn-box {
  display: flex;
  gap: 10px;
  background: #fff8e7;
  border-left: 3px solid #f0c14b;
  padding: 12px 14px;
  border-radius: 4px;
  font-size: 13px;
  color: #8a6500;
  margin-bottom: 14px;
}

.plaintext-row {
  display: flex;
  align-items: center;
  gap: 8px;
  background: #1f1f23;
  color: #e0e0e6;
  padding: 10px 12px;
  border-radius: 6px;
  margin-bottom: 10px;
}
.plaintext {
  flex: 1;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 13px;
  background: transparent;
  word-break: break-all;
}

.hint {
  margin: 8px 0 0;
  font-size: 12px;
  color: var(--tp-ink-faint, #9c9ca3);
  line-height: 1.7;
}
.hint code {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  background: var(--tp-accent-bg, #f0eeff);
  color: var(--tp-accent-ink, #4f3fcc);
  padding: 1px 5px;
  border-radius: 3px;
}
</style>
