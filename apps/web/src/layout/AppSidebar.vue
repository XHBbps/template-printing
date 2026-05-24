<script setup lang="ts">
// eslint-disable-next-line import/no-unresolved
import {
  FileText,
  User,
  Key,
  KeyRound,
  History,
  Users,
  LogOut,
  ChevronLeft,
  ChevronRight,
} from 'lucide-vue-next';
// eslint-disable-next-line import/no-unresolved
import { ElMessageBox } from 'element-plus';
import { useRouter } from 'vue-router';

import { apiFetch } from '../lib/api';
import { useAuthStore } from '../stores/auth';

const props = defineProps<{ collapsed: boolean }>();
const emit = defineEmits<{ (e: 'update:collapsed', v: boolean): void }>();

const auth = useAuthStore();
const router = useRouter();

const isAdmin = (): boolean => {
  const role = auth.user?.role;
  return role === 'admin' || role === 'emergency_admin';
};

const initial = (): string => (auth.user?.name ?? '?').charAt(0).toUpperCase();

function toggle(): void {
  emit('update:collapsed', !props.collapsed);
  localStorage.setItem('tp_sidebar_collapsed', props.collapsed ? 'false' : 'true');
}

async function logout(): Promise<void> {
  try {
    await ElMessageBox.confirm('确认要退出登录吗？', '退出登录', {
      confirmButtonText: '退出',
      cancelButtonText: '取消',
      type: 'warning',
      center: true,
    });
  } catch {
    return;
  }
  try {
    await apiFetch('/auth/logout', { method: 'POST' });
  } catch {
    // ignore; hard-navigate anyway
  }
  window.location.assign('/login');
}
</script>

<template>
  <aside class="sidebar yangli-sidebar" :class="{ 'is-collapsed': collapsed }">
    <div class="sidebar-head">
      <div v-if="!collapsed" class="brand-lockup">
        <img src="/yangli-logo-master.png" alt="YANGLI" />
        <span class="pipe"></span>
        <span class="app-name">模板打印</span>
      </div>
      <button
        class="collapse-btn"
        type="button"
        :title="collapsed ? '展开' : '折叠'"
        @click="toggle"
      >
        <ChevronRight v-if="collapsed" :size="16" :stroke-width="1.5" />
        <ChevronLeft v-else :size="16" :stroke-width="1.5" />
      </button>
    </div>

    <div v-if="!collapsed" class="sidebar-section-label">Workspace · 工作区</div>
    <nav class="nav">
      <RouterLink to="/templates" active-class="active">
        <span class="ico"><FileText :size="16" :stroke-width="1.5" /></span>
        <span v-if="!collapsed">模板中心</span>
      </RouterLink>
      <RouterLink to="/logs" active-class="active">
        <span class="ico"><History :size="16" :stroke-width="1.5" /></span>
        <span v-if="!collapsed">渲染日志</span>
      </RouterLink>
    </nav>

    <div v-if="!collapsed" class="sidebar-section-label">Account · 账号</div>
    <nav class="nav">
      <RouterLink to="/me" active-class="active">
        <span class="ico"><User :size="16" :stroke-width="1.5" /></span>
        <span v-if="!collapsed">个人中心</span>
      </RouterLink>
      <RouterLink to="/me/api-tokens" active-class="active">
        <span class="ico"><KeyRound :size="16" :stroke-width="1.5" /></span>
        <span v-if="!collapsed">API 凭证</span>
      </RouterLink>
    </nav>

    <div v-if="!collapsed" class="sidebar-section-label">Integration · 集成</div>
    <nav class="nav">
      <RouterLink to="/api" active-class="active">
        <span class="ico"><Key :size="16" :stroke-width="1.5" /></span>
        <span v-if="!collapsed">API</span>
      </RouterLink>
    </nav>

    <template v-if="isAdmin()">
      <div v-if="!collapsed" class="sidebar-section-label">Admin · 管理</div>
      <nav class="nav">
        <RouterLink to="/admin/users" active-class="active">
          <span class="ico"><Users :size="16" :stroke-width="1.5" /></span>
          <span v-if="!collapsed">用户管理</span>
        </RouterLink>
      </nav>
    </template>

    <div class="sidebar-foot">
      <div class="avatar">{{ initial() }}</div>
      <div v-if="!collapsed" class="user-meta">
        <div class="name">{{ auth.user?.name ?? '未登录' }}</div>
      </div>
      <button v-if="!collapsed" class="logout-btn" type="button" title="退出登录" @click="logout">
        <LogOut :size="14" :stroke-width="1.5" />
      </button>
    </div>
  </aside>
</template>

<style scoped>
/* 复用 styles/yangli/app-shell.css 的 .sidebar / .sidebar-head / .nav / .sidebar-foot 等基础规则。
   本组件只补：固定宽度、过渡动画、折叠态布局调整。 */

.sidebar {
  width: 240px;
  height: 100vh;
  flex-shrink: 0;
  transition: width var(--dur-base) var(--ease-default);
}
.sidebar.is-collapsed {
  width: 56px;
}

/* 折叠态：去掉文字区域，仅保留 icon / 头像 */
.sidebar.is-collapsed .sidebar-head {
  padding: 20px 12px 18px;
  justify-content: center;
}
.sidebar.is-collapsed .nav {
  padding: 0;
}
.sidebar.is-collapsed .nav a {
  justify-content: center;
  padding-left: 0;
  margin-left: 0;
  border-left: none;
  padding-right: 0;
}
.sidebar.is-collapsed .nav a.active {
  /* 折叠态用底部 ribbon 替代左边条 */
  background: rgba(211, 45, 39, 0.08);
}
.sidebar.is-collapsed .sidebar-foot {
  padding: 14px 12px;
  justify-content: center;
}
</style>
