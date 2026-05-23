<script setup lang="ts">
import { useRouter } from 'vue-router';
// eslint-disable-next-line import/no-unresolved
import { ElButton } from 'element-plus';
const router = useRouter();
</script>

<template>
  <div class="err-wrap">
    <div class="err-code">401</div>
    <h1 class="err-title">需要登录</h1>
    <p class="err-msg">您还未登录或会话已过期。</p>
    <ElButton type="primary" @click="router.push('/login')">前往登录</ElButton>
  </div>
</template>

<style scoped>
.err-wrap {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 32px;
  gap: 16px;
  background: #f4f4f7;
}
.err-code {
  font-size: 96px;
  font-weight: 600;
  color: var(--tp-accent, #6c5ce7);
  line-height: 1;
}
.err-title {
  font-size: 20px;
  font-weight: 600;
  margin: 0;
  color: var(--tp-ink, #1f1f23);
}
.err-msg {
  color: var(--tp-ink-soft, #5e5e66);
  font-size: 14px;
  margin: 0;
}
</style>
