<script setup lang="ts">
// eslint-disable-next-line import/no-unresolved
import { ElDialog, ElForm, ElFormItem, ElInput, ElButton, ElMessage } from 'element-plus';
import { ref, computed } from 'vue';

import { apiFetch, ApiClientError } from '../lib/api';
import { useAuthStore } from '../stores/auth';

const auth = useAuthStore();

const open = computed(() => Boolean(auth.user?.mustChangePassword));

const current = ref('');
const next = ref('');
const confirm = ref('');
const submitting = ref(false);

async function submit(): Promise<void> {
  if (next.value !== confirm.value) {
    ElMessage.warning('两次输入的新密码不一致');
    return;
  }
  if (next.value.length < 8) {
    ElMessage.warning('密码至少 8 位');
    return;
  }
  submitting.value = true;
  try {
    await apiFetch<{ ok: true }>('/users/me/password', {
      method: 'PATCH',
      body: JSON.stringify({ currentPassword: current.value, newPassword: next.value }),
    });
    ElMessage.success('密码已修改');
    await auth.hydrate();
  } catch (e) {
    ElMessage.error(e instanceof ApiClientError ? e.message : '密码修改失败');
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <ElDialog
    :model-value="open"
    title="首次登录请修改初始密码"
    width="420px"
    :close-on-click-modal="false"
    :show-close="false"
  >
    <p style="font-size: 12px; color: #888; margin: 0 0 16px">
      系统检测到您正在使用初始密码，请修改后继续。
    </p>
    <ElForm label-position="top">
      <ElFormItem label="当前密码">
        <ElInput v-model="current" type="password" />
      </ElFormItem>
      <ElFormItem label="新密码（至少 8 位）">
        <ElInput v-model="next" type="password" />
      </ElFormItem>
      <ElFormItem label="再次输入新密码">
        <ElInput v-model="confirm" type="password" />
      </ElFormItem>
    </ElForm>
    <template #footer>
      <ElButton type="primary" :loading="submitting" @click="submit">确认修改</ElButton>
    </template>
  </ElDialog>
</template>
