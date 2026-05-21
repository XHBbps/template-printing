<script setup lang="ts">
import {
  ElAvatar,
  ElButton,
  ElDropdown,
  ElDropdownItem,
  ElDropdownMenu,
  ElMessage,
} from 'element-plus';
import { useRouter } from 'vue-router';

import { useAuthStore } from '../stores/auth';

const auth = useAuthStore();
const router = useRouter();

async function logout(): Promise<void> {
  await auth.logout();
  ElMessage.success('已退出');
  await router.push('/login');
}
</script>

<template>
  <header class="app-header">
    <div class="left">
      <strong>模板打印平台</strong>
    </div>
    <div class="right">
      <ElDropdown v-if="auth.user" trigger="click">
        <span class="user-trigger">
          <ElAvatar v-if="auth.user.avatarUrl" :src="auth.user.avatarUrl" :size="28" />
          <span class="user-name">{{ auth.user.name ?? auth.user.id }}</span>
        </span>
        <template #dropdown>
          <ElDropdownMenu>
            <ElDropdownItem disabled>{{ auth.user.role }}</ElDropdownItem>
            <ElDropdownItem divided @click="logout">退出登录</ElDropdownItem>
          </ElDropdownMenu>
        </template>
      </ElDropdown>
      <ElButton v-else size="small" @click="router.push('/login')">登录</ElButton>
    </div>
  </header>
</template>

<style scoped>
.app-header {
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 16px;
  background: var(--el-bg-color);
  border-bottom: 1px solid var(--el-border-color);
}
.user-trigger {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
}
.user-name {
  font-size: 13px;
  color: var(--el-text-color-primary);
}
</style>
