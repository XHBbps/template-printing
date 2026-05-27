<script setup lang="ts">
// eslint-disable-next-line import/no-unresolved
import { ElDialog, ElMessage } from 'element-plus';
// eslint-disable-next-line import/no-unresolved
import { Pencil, User as UserIcon } from 'lucide-vue-next';
import { nextTick, ref } from 'vue';

import { apiFetch, ApiClientError } from '../lib/api';
import { useAuthStore } from '../stores/auth';

const auth = useAuthStore();

// Computed helpers (read directly from store for reactivity)
const isInternal = (): boolean => auth.user?.isInternal ?? false;
const hasLocalPassword = ref<boolean>(Boolean(auth.user?.hasLocalPassword));

// ---- Password dialog ----
const pwdDialogOpen = ref(false);
const pwdCurrent = ref('');
const pwdNew = ref('');
const pwdConfirm = ref('');
const pwdSubmitting = ref(false);

// ---- Username inline edit (external only) ----
const nameEditing = ref(false);
const nameInput = ref('');
const nameSubmitting = ref(false);
const nameInputRef = ref<HTMLInputElement | null>(null);

function startEditName(): void {
  nameInput.value = auth.user?.name ?? '';
  nameEditing.value = true;
  void nextTick(() => nameInputRef.value?.focus());
}
function cancelEditName(): void {
  nameEditing.value = false;
}
async function saveName(): Promise<void> {
  const next = nameInput.value.trim();
  if (!next) {
    ElMessage.warning('用户名不能为空');
    return;
  }
  if (next === (auth.user?.name ?? '')) {
    nameEditing.value = false;
    return;
  }
  nameSubmitting.value = true;
  try {
    await apiFetch<{ ok: true }>('/users/me/profile', {
      method: 'PATCH',
      body: JSON.stringify({ name: next }),
    });
    ElMessage.success('已保存');
    nameEditing.value = false;
    await auth.hydrate();
  } catch (e) {
    ElMessage.error(e instanceof ApiClientError ? e.message : '保存失败');
  } finally {
    nameSubmitting.value = false;
  }
}

// ---- Email inline edit (external only) ----
const emailEditing = ref(false);
const emailInput = ref('');
const emailSubmitting = ref(false);
const emailInputRef = ref<HTMLInputElement | null>(null);

function startEditEmail(): void {
  emailInput.value = auth.user?.email ?? '';
  emailEditing.value = true;
  void nextTick(() => emailInputRef.value?.focus());
}
function cancelEditEmail(): void {
  emailEditing.value = false;
}
async function saveEmail(): Promise<void> {
  const nextEmail = emailInput.value.trim();
  if (nextEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(nextEmail)) {
    ElMessage.warning('邮箱格式不正确');
    return;
  }
  if (nextEmail === (auth.user?.email ?? '')) {
    emailEditing.value = false;
    return;
  }
  emailSubmitting.value = true;
  try {
    // 空字符串 → 后端清空邮箱(null)
    await apiFetch<{ ok: true }>('/users/me/profile', {
      method: 'PATCH',
      body: JSON.stringify({ email: nextEmail }),
    });
    ElMessage.success('已保存');
    emailEditing.value = false;
    await auth.hydrate();
  } catch (e) {
    ElMessage.error(e instanceof ApiClientError ? e.message : '保存失败');
  } finally {
    emailSubmitting.value = false;
  }
}

function openPwdDialog(): void {
  pwdCurrent.value = '';
  pwdNew.value = '';
  pwdConfirm.value = '';
  pwdDialogOpen.value = true;
}

async function submitPassword(): Promise<void> {
  if (pwdNew.value !== pwdConfirm.value) {
    ElMessage.warning('两次输入的新密码不一致');
    return;
  }
  if (pwdNew.value.length < 8) {
    ElMessage.warning('密码至少 8 位');
    return;
  }
  pwdSubmitting.value = true;
  try {
    await apiFetch<{ ok: true }>('/users/me/password', {
      method: 'PATCH',
      body: JSON.stringify({ currentPassword: pwdCurrent.value, newPassword: pwdNew.value }),
    });
    ElMessage.success('密码已修改');
    hasLocalPassword.value = true;
    pwdDialogOpen.value = false;
    await auth.hydrate();
  } catch (e) {
    ElMessage.error(e instanceof ApiClientError ? e.message : '密码修改失败');
  } finally {
    pwdSubmitting.value = false;
  }
}
</script>

<template>
  <div class="view-root">
    <!-- ============ Page bar ============ -->
    <header class="page-bar">
      <div class="page-title">
        <span class="ico"><UserIcon :size="20" :stroke-width="1.5" /></span>
        个人中心
      </div>
      <div class="page-sub">ACCOUNT · 账号 / 安全</div>
    </header>

    <!-- ============ Body ============ -->
    <div class="page-body">
      <div class="me-max">
        <div class="stacked">
          <!-- 账号信息 -->
          <section class="card">
            <div class="card-head">
              <div class="cap">账号信息</div>
              <span class="meta">PROFILE</span>
            </div>
            <div class="card-body">
              <!-- 用户名 -->
              <div class="row">
                <span class="k">用户名 · Username</span>
                <span class="v">
                  <!-- internal: 显示飞书中文名，只读 -->
                  <template v-if="isInternal()">
                    <span class="name-text">{{ auth.user?.name ?? '—' }}</span>
                  </template>
                  <!-- external: 显示 name，可编辑 -->
                  <template v-else>
                    <template v-if="!nameEditing">
                      <span class="name-text">{{ auth.user?.name ?? '—' }}</span>
                      <button
                        class="name-edit-btn"
                        type="button"
                        title="编辑用户名"
                        @click="startEditName"
                      >
                        <Pencil :size="12" :stroke-width="1.6" />
                      </button>
                    </template>
                    <template v-else>
                      <input
                        ref="nameInputRef"
                        v-model="nameInput"
                        class="name-input"
                        type="text"
                        maxlength="64"
                        @keyup.enter="saveName"
                        @keyup.esc="cancelEditName"
                      />
                      <button
                        class="btn btn-primary sm"
                        type="button"
                        :disabled="nameSubmitting"
                        @click="saveName"
                      >
                        保存
                      </button>
                      <button
                        class="btn btn-secondary sm"
                        type="button"
                        :disabled="nameSubmitting"
                        @click="cancelEditName"
                      >
                        取消
                      </button>
                    </template>
                  </template>
                </span>
              </div>

              <!-- 登录账号：仅外部用户显示（只读） -->
              <div v-if="!isInternal()" class="row">
                <span class="k">登录账号 · Login</span>
                <span class="v muted">
                  <span class="name-text">{{ auth.user?.localUsername ?? '—' }}</span>
                </span>
              </div>

              <!-- 手机号：仅内部用户显示 -->
              <div v-if="isInternal()" class="row">
                <span class="k">手机号 · Mobile</span>
                <span class="v muted">
                  <span class="name-text">{{ auth.user?.mobile ?? '—' }}</span>
                </span>
              </div>

              <!-- 邮箱 -->
              <div class="row">
                <span class="k">邮箱 · Email</span>
                <span class="v">
                  <!-- internal: 只读 -->
                  <template v-if="isInternal()">
                    <span class="name-text">{{ auth.user?.email ?? '—' }}</span>
                  </template>
                  <!-- external: 可编辑 -->
                  <template v-else>
                    <template v-if="!emailEditing">
                      <span class="name-text">{{ auth.user?.email ?? '—' }}</span>
                      <button
                        class="name-edit-btn"
                        type="button"
                        title="编辑邮箱"
                        @click="startEditEmail"
                      >
                        <Pencil :size="12" :stroke-width="1.6" />
                      </button>
                    </template>
                    <template v-else>
                      <input
                        ref="emailInputRef"
                        v-model="emailInput"
                        class="name-input"
                        type="email"
                        maxlength="254"
                        placeholder="留空可清除邮箱"
                        @keyup.enter="saveEmail"
                        @keyup.esc="cancelEditEmail"
                      />
                      <button
                        class="btn btn-primary sm"
                        type="button"
                        :disabled="emailSubmitting"
                        @click="saveEmail"
                      >
                        保存
                      </button>
                      <button
                        class="btn btn-secondary sm"
                        type="button"
                        :disabled="emailSubmitting"
                        @click="cancelEditEmail"
                      >
                        取消
                      </button>
                    </template>
                  </template>
                </span>
              </div>

              <!-- 工号/用户编号 (唯一 ID) -->
              <div class="row">
                <span class="k">工号 · ID</span>
                <span class="v muted">
                  <code class="muted-id">{{
                    isInternal()
                      ? auth.user?.larkUserId ?? auth.user?.localUsername ?? '—'
                      : auth.user?.externalCode ?? '—'
                  }}</code>
                </span>
              </div>

              <!-- 角色 -->
              <div class="row last">
                <span class="k">角色 · Role</span>
                <span class="v">
                  <span class="role-text">{{ auth.user?.role ?? '—' }}</span>
                </span>
              </div>
            </div>
          </section>

          <!-- 登录密码：仅 hasLocalPassword 为 true 时显示 -->
          <section v-if="hasLocalPassword" class="card">
            <div class="card-head">
              <div class="cap">登录密码</div>
              <span class="meta">SECURITY · LOCAL PASSWORD</span>
            </div>
            <div class="card-body status-card">
              <div class="status-row">
                <span class="key">本地密码</span>
                <span class="status">
                  <span class="status-text status-ok">已设置 · SET</span>
                </span>
                <button class="btn btn-secondary sm action" type="button" @click="openPwdDialog">
                  修改密码
                </button>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>

    <!-- ============ Password dialog ============ -->
    <ElDialog v-model="pwdDialogOpen" title="修改密码" width="460px">
      <div class="dlg-form">
        <div class="field">
          <label class="lbl">当前密码 <span class="han">· Current</span></label>
          <input v-model="pwdCurrent" type="password" autocomplete="current-password" />
        </div>
        <div class="field">
          <label class="lbl">新密码 <span class="han">· New</span> · 至少 8 位</label>
          <input v-model="pwdNew" type="password" autocomplete="new-password" />
        </div>
        <div class="field">
          <label class="lbl">再次输入 <span class="han">· Confirm</span></label>
          <input v-model="pwdConfirm" type="password" autocomplete="new-password" />
        </div>
      </div>
      <template #footer>
        <button class="btn btn-secondary sm" type="button" @click="pwdDialogOpen = false">
          取消
        </button>
        <button
          class="btn btn-primary sm"
          type="button"
          :disabled="pwdSubmitting"
          @click="submitPassword"
        >
          {{ pwdSubmitting ? '提交中…' : '确定' }}
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

.me-max {
  max-width: 1600px;
  margin: 0 auto;
}

.stacked > * + * {
  margin-top: 20px;
}

/* ============ Card rows (key/value grid) ============ */
.row {
  display: grid;
  grid-template-columns: 120px 1fr;
  gap: 16px;
  padding: 16px 0;
  border-bottom: 1px solid var(--stone);
  align-items: center;
}
.row:last-child,
.row.last {
  border-bottom: 0;
  padding-bottom: 0;
}
.row .k {
  font-family: var(--font-han);
  font-size: 12.5px;
  color: var(--fg-3);
}
.row .v {
  font-family: var(--font-han);
  font-size: 13.5px;
  color: var(--ink);
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
.row .v.muted {
  color: var(--fg-3);
}

/* 状态指示统一为纯文字（去胶囊背景/描边），保留语义色彩 */
.role-text {
  font-family: var(--font-mono);
  font-size: 13px;
  color: var(--ink);
  letter-spacing: 0.02em;
}
.status-text {
  font-family: var(--font-mono);
  font-size: 12.5px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
.status-text.status-ok {
  color: #0f8c5a;
}
.status-text.status-idle {
  color: var(--fg-3);
}

.muted-id {
  font-family: var(--font-mono);
  font-size: 11.5px;
  color: var(--fg-3);
}

/* ============ Username inline edit ============ */
.name-text {
  font-family: var(--font-han);
  color: var(--ink);
}
.name-edit-btn {
  width: 22px;
  height: 22px;
  border: 1px solid var(--stone);
  background: var(--paper-white);
  color: var(--fg-3);
  border-radius: var(--radius-1);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition:
    color var(--dur-fast) var(--ease-default),
    border-color var(--dur-fast) var(--ease-default);
}
.name-edit-btn:hover {
  color: var(--ink);
  border-color: var(--yangli-graphite);
}
.name-input {
  height: 30px;
  padding: 0 10px;
  border: 1px solid var(--stone);
  border-radius: var(--radius-1);
  font-family: var(--font-han);
  font-size: 13.5px;
  color: var(--ink);
  background: var(--paper-white);
  outline: none;
  min-width: 200px;
  flex: 0 1 240px;
}
.name-input:focus {
  border-color: var(--yangli-red);
  outline: 1px solid var(--yangli-red);
  outline-offset: -1px;
}

/* ============ 单行状态 + 操作（登录密码） ============ */
.status-card {
  padding: 20px 24px !important;
}
.status-row {
  display: grid;
  grid-template-columns: 120px 1fr auto;
  gap: 16px;
  align-items: center;
  min-height: 44px;
}
.status-row .key {
  font-family: var(--font-han);
  font-size: 12.5px;
  color: var(--fg-3);
}
.status-row .status {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
.status-row .action {
  white-space: nowrap;
}

/* ============ Dialog form ============ */
.dlg-form {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 4px 0 0;
}
.dlg-form .field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.dlg-form .lbl {
  font-family: var(--font-sans);
  font-size: 10.5px;
  font-weight: 500;
  letter-spacing: var(--tr-caption);
  text-transform: uppercase;
  color: var(--fg-3);
}
.dlg-form .lbl .han {
  font-family: var(--font-han);
  font-weight: 400;
  letter-spacing: 0.02em;
  text-transform: none;
  color: var(--fg-3);
}
</style>
