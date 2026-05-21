<script setup lang="ts">
import { ElButton, ElCard, ElForm, ElFormItem, ElInput, ElMessage, ElDivider } from 'element-plus';
import { ref } from 'vue';
import { useRouter } from 'vue-router';

import { buildLarkLoginUrl } from '../lib/auth-routes';
import { apiFetch, ApiClientError } from '../lib/api';
import { useAuthStore } from '../stores/auth';

const router = useRouter();
const authStore = useAuthStore();

const username = ref('');
const password = ref('');
const submitting = ref(false);
const showEmergency = ref(false);

function goLark(): void {
  const continueTo = (router.currentRoute.value.query.continue as string | undefined) ?? '/';
  window.location.assign(buildLarkLoginUrl(continueTo));
}

async function submitLocal(): Promise<void> {
  if (!username.value || !password.value) return;
  submitting.value = true;
  try {
    const result = await apiFetch<{ ok: true; csrf: string; mustChangePassword: boolean }>(
      '/auth/local/login',
      {
        method: 'POST',
        body: JSON.stringify({ username: username.value, password: password.value }),
      },
    );
    await authStore.setLocalLoginResult(result);
    ElMessage.success('登录成功');
    await router.push('/');
  } catch (e) {
    if (e instanceof ApiClientError) {
      ElMessage.error(e.message);
    } else {
      ElMessage.error('登录失败，请重试');
    }
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <main class="login-page">
    <ElCard class="login-card">
      <h1 class="login-title">模板打印平台</h1>
      <p class="login-subtitle">请使用飞书账号登录</p>

      <ElButton type="primary" size="large" style="width: 100%" @click="goLark">
        飞书登录
      </ElButton>

      <ElDivider>
        <span class="login-divider-text">或</span>
      </ElDivider>

      <ElButton link size="small" @click="showEmergency = !showEmergency">
        应急管理员登录 {{ showEmergency ? '▲' : '▼' }}
      </ElButton>

      <ElForm v-if="showEmergency" label-position="top" style="margin-top: 12px">
        <ElFormItem label="用户名">
          <ElInput v-model="username" autocomplete="username" />
        </ElFormItem>
        <ElFormItem label="密码">
          <ElInput v-model="password" type="password" autocomplete="current-password" />
        </ElFormItem>
        <ElButton type="default" :loading="submitting" style="width: 100%" @click="submitLocal">
          应急登录
        </ElButton>
      </ElForm>
    </ElCard>
  </main>
</template>

<style scoped>
.login-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--el-bg-color-page);
}
.login-card {
  width: 380px;
  padding: 24px;
}
.login-title {
  margin: 0 0 4px 0;
  font-size: 20px;
  font-weight: 600;
}
.login-subtitle {
  margin: 0 0 24px 0;
  color: var(--el-text-color-regular);
  font-size: 13px;
}
.login-divider-text {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
</style>
