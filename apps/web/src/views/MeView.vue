<script setup lang="ts">
import { useAuthStore } from '../stores/auth';
const auth = useAuthStore();
</script>

<template>
  <div class="page-wrap">
    <h1 class="page-title">个人中心</h1>
    <div class="page-card">
      <p><strong>账号：</strong>{{ auth.user?.name ?? '—' }}</p>
      <p><strong>角色：</strong>{{ auth.user?.role ?? '—' }}</p>
      <p class="page-muted">该页面功能（密码修改、飞书绑定等）将在后续迭代开发。</p>
    </div>
  </div>
</template>

<style scoped>
.page-wrap {
  padding: 32px 40px;
  max-width: 1000px;
  margin: 0 auto;
}
.page-title {
  font-size: 24px;
  font-weight: 600;
  margin: 0 0 24px;
  color: var(--tp-ink, #1f1f23);
}
.page-card {
  background: #fff;
  border: 1px solid var(--tp-line, #ececef);
  border-radius: 12px;
  padding: 24px;
}
.page-card p {
  margin: 0 0 12px;
  font-size: 14px;
  color: var(--tp-ink, #1f1f23);
}
.page-muted {
  color: var(--tp-ink-faint, #9c9ca3);
  font-size: 12px;
  margin-top: 16px !important;
}
</style>
