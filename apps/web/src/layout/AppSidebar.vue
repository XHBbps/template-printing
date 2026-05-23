<script setup lang="ts">
// eslint-disable-next-line import/no-unresolved
import { FileText, User, Key, Users, LogOut, PanelLeftClose, PanelLeftOpen } from 'lucide-vue-next';
import { useRouter } from 'vue-router';

import { useAuthStore } from '../stores/auth';

const props = defineProps<{ collapsed: boolean }>();
const emit = defineEmits<{ (e: 'update:collapsed', v: boolean): void }>();

const auth = useAuthStore();
const router = useRouter();

const isAdmin = (): boolean => {
  const role = auth.user?.role;
  return role === 'admin' || role === 'emergency_admin';
};

function toggle(): void {
  emit('update:collapsed', !props.collapsed);
  localStorage.setItem('tp_sidebar_collapsed', props.collapsed ? 'false' : 'true');
}

async function logout(): Promise<void> {
  await auth.logout();
  void router.push('/login');
}
</script>

<template>
  <aside class="app-sidebar" :class="{ 'app-sidebar--collapsed': collapsed }">
    <div class="sb-head">
      <span v-if="!collapsed" class="sb-logo">模板打印</span>
      <button class="sb-toggle" type="button" :title="collapsed ? '展开' : '折叠'" @click="toggle">
        <PanelLeftOpen v-if="collapsed" :size="16" :stroke-width="2" />
        <PanelLeftClose v-else :size="16" :stroke-width="2" />
      </button>
    </div>

    <nav class="sb-nav">
      <RouterLink to="/templates" class="sb-item" active-class="sb-item--active">
        <FileText :size="16" :stroke-width="2" />
        <span v-if="!collapsed">模板中心</span>
      </RouterLink>
      <RouterLink to="/me" class="sb-item" active-class="sb-item--active">
        <User :size="16" :stroke-width="2" />
        <span v-if="!collapsed">个人中心</span>
      </RouterLink>
      <RouterLink to="/api-docs" class="sb-item" active-class="sb-item--active">
        <Key :size="16" :stroke-width="2" />
        <span v-if="!collapsed">API 说明</span>
      </RouterLink>
      <RouterLink v-if="isAdmin()" to="/admin/users" class="sb-item" active-class="sb-item--active">
        <Users :size="16" :stroke-width="2" />
        <span v-if="!collapsed">用户管理</span>
      </RouterLink>
    </nav>

    <div class="sb-foot">
      <div class="sb-user">
        <div class="sb-avatar">{{ (auth.user?.name ?? '?').charAt(0).toUpperCase() }}</div>
        <div v-if="!collapsed" class="sb-user-meta">
          <div class="sb-user-name">{{ auth.user?.name ?? '未登录' }}</div>
          <button class="sb-logout" @click="logout">
            <LogOut :size="11" :stroke-width="2" /> 退出
          </button>
        </div>
      </div>
    </div>
  </aside>
</template>

<style scoped>
.app-sidebar {
  display: flex;
  flex-direction: column;
  width: 220px;
  height: 100vh;
  background: #fff;
  border-right: 1px solid var(--tp-line, #ececef);
  box-shadow: 0 4px 16px rgba(20, 20, 30, 0.04);
  transition: width 200ms ease;
  flex-shrink: 0;
}
.app-sidebar--collapsed {
  width: 56px;
}
.sb-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 12px;
  border-bottom: 1px solid var(--tp-line, #ececef);
}
.sb-logo {
  font-size: 14px;
  font-weight: 600;
  color: var(--tp-accent-ink, #4f3fcc);
}
.sb-toggle {
  border: none;
  background: transparent;
  color: var(--tp-ink-soft, #5e5e66);
  cursor: pointer;
  padding: 4px;
  border-radius: 4px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.sb-toggle:hover {
  background: var(--tp-field-bg, rgba(108, 92, 231, 0.06));
  color: var(--tp-accent, #6c5ce7);
}
.sb-nav {
  flex: 1;
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  overflow-y: auto;
}
.sb-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border-radius: 8px;
  font-size: 13px;
  color: var(--tp-ink, #1f1f23);
  text-decoration: none;
  transition: all 120ms ease;
}
.sb-item:hover {
  background: var(--tp-field-bg, rgba(108, 92, 231, 0.06));
}
.sb-item--active {
  background: var(--tp-accent-bg, #f0eeff);
  color: var(--tp-accent-ink, #4f3fcc);
  font-weight: 500;
}
.app-sidebar--collapsed .sb-item {
  justify-content: center;
  padding: 8px;
}
.sb-foot {
  padding: 10px 8px;
  border-top: 1px solid var(--tp-line, #ececef);
}
.sb-user {
  display: flex;
  align-items: center;
  gap: 10px;
}
.sb-avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: var(--tp-accent, #6c5ce7);
  color: #fff;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  font-weight: 600;
  flex-shrink: 0;
}
.sb-user-meta {
  flex: 1;
  min-width: 0;
}
.sb-user-name {
  font-size: 12px;
  color: var(--tp-ink, #1f1f23);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sb-logout {
  background: transparent;
  border: none;
  color: var(--tp-ink-faint, #9c9ca3);
  font-size: 11px;
  cursor: pointer;
  padding: 0;
  margin-top: 2px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.sb-logout:hover {
  color: #d94f4f;
}
</style>
