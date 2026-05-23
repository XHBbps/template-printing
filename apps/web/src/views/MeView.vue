<script setup lang="ts">
// eslint-disable-next-line import/no-unresolved
import {
  ElButton,
  ElCard,
  ElDialog,
  ElForm,
  ElFormItem,
  ElInput,
  ElMessage,
  ElMessageBox,
  ElTag,
} from 'element-plus';
import { ref } from 'vue';

import { apiFetch, ApiClientError } from '../lib/api';
import { buildLarkLoginUrl } from '../lib/auth-routes';
import { useAuthStore } from '../stores/auth';

const auth = useAuthStore();

// ---- Password dialog ----
const pwdDialogOpen = ref(false);
const pwdCurrent = ref('');
const pwdNew = ref('');
const pwdConfirm = ref('');
const pwdSubmitting = ref(false);
const hasLocalPassword = ref<boolean>(Boolean(auth.user?.hasLocalPassword));

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
    const body: { newPassword: string; currentPassword?: string } = { newPassword: pwdNew.value };
    if (hasLocalPassword.value) body.currentPassword = pwdCurrent.value;
    await apiFetch<{ ok: true }>('/users/me/password', {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
    ElMessage.success(hasLocalPassword.value ? '密码已修改' : '密码已设置');
    hasLocalPassword.value = true;
    pwdDialogOpen.value = false;
    await auth.hydrate();
  } catch (e) {
    ElMessage.error(e instanceof ApiClientError ? e.message : '密码设置失败');
  } finally {
    pwdSubmitting.value = false;
  }
}

// ---- Lark binding ----
async function unbindLark(): Promise<void> {
  if (!hasLocalPassword.value) {
    ElMessage.warning('请先设置本地密码后再解绑飞书');
    return;
  }
  try {
    await ElMessageBox.confirm('解绑后将不能再用飞书登录此账号，确认继续？', '解绑飞书', {
      type: 'warning',
      confirmButtonText: '解绑',
      cancelButtonText: '取消',
    });
  } catch {
    return;
  }
  try {
    await apiFetch<{ ok: true }>('/users/me/lark-binding', { method: 'DELETE' });
    ElMessage.success('已解绑飞书');
    await auth.hydrate();
  } catch (e) {
    ElMessage.error(e instanceof ApiClientError ? e.message : '解绑失败');
  }
}

function rebindLark(): void {
  window.location.assign(buildLarkLoginUrl('/me'));
}
</script>

<template>
  <div class="me-wrap">
    <h1 class="me-title">个人中心</h1>

    <ElCard class="me-card">
      <h2 class="me-section">账号信息</h2>
      <div class="me-row">
        <span class="me-label">用户名</span><span>{{ auth.user?.name ?? '—' }}</span>
      </div>
      <div class="me-row">
        <span class="me-label">邮箱</span><span>{{ auth.user?.email ?? '未提供' }}</span>
      </div>
      <div class="me-row">
        <span class="me-label">角色</span>
        <ElTag :type="auth.user?.role === 'admin' ? 'danger' : 'info'" size="small">
          {{ auth.user?.role ?? '—' }}
        </ElTag>
      </div>
    </ElCard>

    <ElCard class="me-card">
      <h2 class="me-section">登录密码</h2>
      <div class="me-row">
        <span class="me-label">本地密码</span>
        <span>
          <ElTag v-if="hasLocalPassword" type="success" size="small">已设置</ElTag>
          <ElTag v-else type="warning" size="small">未设置</ElTag>
        </span>
      </div>
      <ElButton type="primary" plain @click="openPwdDialog">
        {{ hasLocalPassword ? '修改密码' : '设置密码' }}
      </ElButton>
    </ElCard>

    <ElCard class="me-card">
      <h2 class="me-section">飞书绑定</h2>
      <div class="me-row">
        <span class="me-label">飞书账号</span>
        <span v-if="auth.user?.larkUserId">
          <ElTag type="success" size="small">已绑定</ElTag>
          <span class="me-muted" style="margin-left: 8px">{{ auth.user.larkUserId }}</span>
        </span>
        <span v-else>
          <ElTag type="info" size="small">未绑定</ElTag>
        </span>
      </div>
      <ElButton v-if="auth.user?.larkUserId" type="danger" plain @click="unbindLark">
        解绑飞书
      </ElButton>
      <ElButton v-else type="primary" plain @click="rebindLark">绑定飞书账号</ElButton>
    </ElCard>

    <ElDialog
      v-model="pwdDialogOpen"
      :title="hasLocalPassword ? '修改密码' : '设置密码'"
      width="420px"
    >
      <ElForm label-position="top">
        <ElFormItem v-if="hasLocalPassword" label="当前密码">
          <ElInput v-model="pwdCurrent" type="password" autocomplete="current-password" />
        </ElFormItem>
        <ElFormItem label="新密码（至少 8 位）">
          <ElInput v-model="pwdNew" type="password" autocomplete="new-password" />
        </ElFormItem>
        <ElFormItem label="再次输入新密码">
          <ElInput v-model="pwdConfirm" type="password" autocomplete="new-password" />
        </ElFormItem>
      </ElForm>
      <template #footer>
        <ElButton @click="pwdDialogOpen = false">取消</ElButton>
        <ElButton type="primary" :loading="pwdSubmitting" @click="submitPassword"> 确定 </ElButton>
      </template>
    </ElDialog>
  </div>
</template>

<style scoped>
.me-wrap {
  padding: 32px 40px;
  max-width: 800px;
  margin: 0 auto;
}
.me-title {
  font-size: 24px;
  font-weight: 600;
  margin: 0 0 24px;
  color: var(--tp-ink, #1f1f23);
}
.me-card {
  margin-bottom: 16px;
  border-radius: 12px;
}
.me-section {
  font-size: 14px;
  font-weight: 600;
  color: var(--tp-ink, #1f1f23);
  margin: 0 0 16px;
}
.me-row {
  display: flex;
  align-items: center;
  margin-bottom: 12px;
  font-size: 13px;
}
.me-label {
  width: 100px;
  color: var(--tp-ink-soft, #5e5e66);
  font-size: 12px;
}
.me-muted {
  color: var(--tp-ink-faint, #9c9ca3);
  font-family: ui-monospace, monospace;
  font-size: 11px;
}
</style>
