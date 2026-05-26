<script setup lang="ts">
// eslint-disable-next-line import/no-unresolved
import { Users } from 'lucide-vue-next';
</script>

<template>
  <div class="view-root">
    <header class="page-bar">
      <div class="page-title">
        <span class="ico"><Users :size="20" :stroke-width="1.5" /></span>
        用户管理
      </div>
      <div class="page-sub">USERS · 管理</div>
    </header>

    <div class="page-body">
      <div class="card">
        <div class="empty-state">
          <div class="eyebrow">Coming soon · 即将推出</div>
          <div class="msg">
            用户列表 / 新建本地账号 / 角色与权限 / 重置密码 / 启用禁用，将在后续迭代开发。
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.view-root {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}
.page-bar {
  position: relative;
}
.page-bar::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  height: 2px;
  width: 96px;
  background: var(--yangli-red);
}
.card {
  background: var(--paper-white);
  border: 1px solid var(--stone);
  border-radius: var(--radius-2);
  max-width: 1000px;
  margin: 0 auto;
}
.empty-state {
  padding: 48px 24px;
  text-align: center;
}
.empty-state .eyebrow {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--fg-3);
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.empty-state .msg {
  font-family: var(--font-han);
  font-size: 13px;
  color: var(--fg-2);
  margin-top: 10px;
  line-height: 1.7;
}
</style>
