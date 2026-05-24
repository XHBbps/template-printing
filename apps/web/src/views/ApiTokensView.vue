<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
// eslint-disable-next-line import/no-unresolved
import { ElDialog, ElMessage, ElMessageBox } from 'element-plus';
// eslint-disable-next-line import/no-unresolved
import { Copy, KeyRound, Plus, AlertTriangle } from 'lucide-vue-next';
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

const createDialogOpen = ref(false);
const newName = ref('');
const creating = ref(false);

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

function formatAbs(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatRelative(iso: string | null): string {
  if (!iso) return '未使用';
  const t = new Date(iso).getTime();
  const diff = Date.now() - t;
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec} 秒前`;
  if (sec < 3600) return `${Math.floor(sec / 60)} 分钟前`;
  if (sec < 86400) return `${Math.floor(sec / 3600)} 小时前`;
  return `${Math.floor(sec / 86400)} 天前`;
}

onMounted(refresh);

const activeCount = computed(() => items.value.filter((i) => !i.revokedAt).length);
</script>

<template>
  <div class="view-root">
    <!-- ============ Page bar ============ -->
    <header class="page-bar">
      <div class="page-title">
        <span class="ico"><KeyRound :size="20" :stroke-width="1.5" /></span>
        API 凭证
      </div>
      <div class="page-sub">BEARER · TOKEN MANAGEMENT</div>
      <div class="page-bar-spacer"></div>
      <button class="btn btn-primary" type="button" @click="createDialogOpen = true">
        <span class="ico"><Plus :size="14" :stroke-width="1.5" /></span>
        创建 Token
      </button>
    </header>

    <!-- ============ Body ============ -->
    <div class="page-body">
      <div class="max">
        <p class="intro">
          用于在脚本 / 集成 / 自动化中调用 <code>POST /api/render</code>
          系列接口。管理端点本身只接受登录 cookie 鉴权（防 token 自管理 token 的环）。Token
          仅创建时显示一次，DB 中以 SHA-256 哈希形式存储。
        </p>

        <!-- 空态 -->
        <div v-if="!loading && items.length === 0" class="card">
          <div class="empty-state">
            <div class="eyebrow">No tokens · 暂无凭证</div>
            <div class="msg">当前无 API token。<br />点击右上「创建 Token」开始接入。</div>
            <div class="hint">FORMAT · tpkn_•••••• (32 hex)</div>
          </div>
        </div>

        <!-- 列表 -->
        <div v-else-if="!loading" class="card">
          <div class="card-body flush">
            <table class="tokens">
              <thead>
                <tr>
                  <th>名称</th>
                  <th>前缀</th>
                  <th>状态</th>
                  <th>最近使用</th>
                  <th>创建时间</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="t in items" :key="t.id" :class="{ revoked: !!t.revokedAt }">
                  <td class="name">{{ t.name }}</td>
                  <td class="prefix">{{ t.prefix }}…</td>
                  <td>
                    <span v-if="t.revokedAt" class="pill idle">已吊销</span>
                    <span v-else class="pill ok">活跃</span>
                  </td>
                  <td class="prefix" :title="t.lastUsedAt ?? '未使用'">
                    {{ formatRelative(t.lastUsedAt) }}
                  </td>
                  <td class="prefix">{{ formatAbs(t.createdAt) }}</td>
                  <td>
                    <a v-if="!t.revokedAt" href="#" class="revoke-link" @click.prevent="doRevoke(t)"
                      >立即吊销</a
                    >
                    <span v-else class="muted">—</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <div class="footer-meta">共 {{ items.length }} 个 token，{{ activeCount }} 个活跃。</div>
        </div>
      </div>
    </div>

    <!-- ============ 创建 dialog ============ -->
    <ElDialog v-model="createDialogOpen" title="创建新 Token" width="460px">
      <div class="dlg-body">
        <div class="field">
          <label class="lbl">名称 <span class="han">· Name</span></label>
          <input
            v-model="newName"
            type="text"
            placeholder="如：demo-bot / ci-script"
            maxlength="64"
            autofocus
          />
        </div>
        <p class="dlg-hint">
          建议起一个能识别用途的名字（哪个服务 / 哪个环境）。token
          一旦生成只会显示一次，请创建后立即复制保存。
        </p>
      </div>
      <template #footer>
        <button class="btn btn-secondary sm" type="button" @click="createDialogOpen = false">
          取消
        </button>
        <button class="btn btn-primary sm" type="button" :disabled="creating" @click="doCreate">
          {{ creating ? '生成中…' : '生成' }}
        </button>
      </template>
    </ElDialog>

    <!-- ============ 一次性明文 dialog ============ -->
    <ElDialog
      v-model="plaintextDialogOpen"
      title="Token 已创建"
      width="580px"
      :close-on-click-modal="false"
      :close-on-press-escape="false"
      :show-close="false"
    >
      <div class="warn-box">
        <span class="ico"><AlertTriangle :size="18" :stroke-width="1.5" /></span>
        <div>
          <strong>请立即复制保存。</strong>
          关闭本对话框后，本平台再也不会以明文显示这个 token。忘记了只能创建新的。
        </div>
      </div>
      <div class="plaintext-row">
        <code class="plaintext">{{ newPlaintext }}</code>
        <button
          class="btn btn-secondary sm"
          type="button"
          @click="copyText(newPlaintext, '已复制到剪贴板')"
        >
          <span class="ico"><Copy :size="14" :stroke-width="1.5" /></span>
          复制
        </button>
      </div>
      <p class="dlg-hint">在请求里加请求头：<code>Authorization: Bearer &lt;此 token&gt;</code></p>
      <template #footer>
        <button
          class="btn btn-primary sm"
          type="button"
          @click="
            () => {
              plaintextDialogOpen = false;
              newPlaintext = '';
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

.intro {
  font-family: var(--font-han);
  font-size: 13.5px;
  color: var(--fg-2);
  line-height: 1.8;
  max-width: 760px;
  margin: 0 0 24px;
}
.intro code {
  font-size: 12.5px;
}

/* Tokens table */
table.tokens {
  width: 100%;
  border-collapse: collapse;
}
table.tokens th {
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
table.tokens td {
  padding: 14px 20px;
  border-bottom: 1px solid var(--stone);
  font-family: var(--font-han);
  font-size: 13px;
  color: var(--fg-1);
  vertical-align: middle;
}
table.tokens tr:last-child td {
  border-bottom: 0;
}
table.tokens tr.revoked td {
  color: var(--fg-3);
}
table.tokens .name {
  color: var(--ink);
  font-weight: 500;
}
table.tokens .prefix {
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--fg-2);
}

.revoke-link {
  font-family: var(--font-han);
  font-size: 12.5px;
  color: var(--yangli-red);
  text-decoration: none;
  border-bottom: 1px solid var(--yangli-red);
  padding-bottom: 1px;
  cursor: pointer;
}
.revoke-link:hover {
  color: var(--accent-hover);
  border-bottom-color: var(--accent-hover);
}
.muted {
  color: var(--fg-3);
}

.footer-meta {
  text-align: right;
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--fg-3);
  padding: 10px 20px;
  border-top: 1px solid var(--stone);
  letter-spacing: 0.04em;
}

/* Dialog bodies */
.dlg-body {
  padding: 4px 0 0;
}
.dlg-hint {
  font-family: var(--font-han);
  font-size: 12.5px;
  color: var(--fg-3);
  line-height: 1.7;
  margin: 12px 0 0;
}
.dlg-hint code {
  font-family: var(--font-mono);
  font-size: 12px;
}

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
</style>
