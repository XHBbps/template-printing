<script setup lang="ts">
// eslint-disable-next-line import/no-unresolved
import { ElButton, ElCard, ElForm, ElFormItem, ElInput, ElMessage } from 'element-plus';
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

async function goLark(): Promise<void> {
  const continueTo = (router.currentRoute.value.query.continue as string | undefined) ?? '/';
  // Clear any stale session before redirecting to Lark — otherwise canceling
  // the Lark flow and pressing back leaves the user "logged in" with an
  // unexpected account.
  try {
    await authStore.logout();
  } catch {
    // ignore — logout endpoint may 401 if already logged out
  }
  window.location.assign(buildLarkLoginUrl(continueTo));
}

async function submitLocal(): Promise<void> {
  if (!username.value || !password.value) {
    ElMessage.warning('请输入用户名和密码');
    return;
  }
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
    const continueTo = (router.currentRoute.value.query.continue as string | undefined) ?? '/';
    await router.push(continueTo);
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
      <p class="login-subtitle">登录以继续</p>

      <ElForm label-position="top" @submit.prevent="submitLocal">
        <ElFormItem label="用户名">
          <ElInput v-model="username" autocomplete="username" placeholder="账号" />
        </ElFormItem>
        <ElFormItem label="密码">
          <ElInput
            v-model="password"
            type="password"
            autocomplete="current-password"
            placeholder="密码"
            @keyup.enter="submitLocal"
          />
        </ElFormItem>
        <ElButton
          type="primary"
          size="large"
          :loading="submitting"
          style="width: 100%"
          @click="submitLocal"
        >
          登录
        </ElButton>
      </ElForm>

      <div class="login-divider">
        <span class="login-divider-line" />
        <span class="login-divider-text">或</span>
        <span class="login-divider-line" />
      </div>

      <ElButton size="large" plain style="width: 100%" @click="goLark"> 使用飞书登录 </ElButton>

      <p class="login-tip">
        首次使用飞书登录会自动创建账号，登录后可在「个人中心」设置密码以便后续用户名登录。
      </p>
    </ElCard>
  </main>
</template>

<style scoped>
.login-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #f5f5f9 0%, #ebeaf5 100%);
}
.login-card {
  width: 400px;
  padding: 8px;
  border-radius: 16px;
}
.login-title {
  margin: 0 0 4px 0;
  font-size: 22px;
  font-weight: 600;
  color: var(--tp-ink, #1f1f23);
}
.login-subtitle {
  margin: 0 0 28px 0;
  color: var(--tp-ink-soft, #5e5e66);
  font-size: 13px;
}
.login-divider {
  display: flex;
  align-items: center;
  margin: 24px 0;
  gap: 12px;
}
.login-divider-line {
  flex: 1;
  height: 1px;
  background: var(--tp-line, #ececef);
}
.login-divider-text {
  font-size: 12px;
  color: var(--tp-ink-faint, #9c9ca3);
}
.login-tip {
  margin: 16px 0 0;
  font-size: 11px;
  color: var(--tp-ink-faint, #9c9ca3);
  line-height: 1.6;
}
</style>
