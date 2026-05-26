<script setup lang="ts">
import ErrorStage from './ErrorStage.vue';
</script>

<template>
  <ErrorStage
    num-left="4"
    num-right="1"
    stamp="EXPIRED"
    eyebrow="Unauthorized · 未授权"
    title-cn="请先登录"
    title-en="Sign-in required"
    :body-lines="[
      '你尚未登录，或登录会话已过期。继续操作前需要重新登录。',
      '登录后可返回刚才的页面继续工作。',
    ]"
    status="HTTP 401"
    primary-text="去登录"
    primary-to="/login"
  />
</template>
