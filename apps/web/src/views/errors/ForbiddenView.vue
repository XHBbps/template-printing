<script setup lang="ts">
import ErrorStage from './ErrorStage.vue';
</script>

<template>
  <ErrorStage
    num-left="4"
    num-right="3"
    stamp="DENIED"
    eyebrow="Forbidden · 权限不足"
    title-cn="你没有这台机器的权限"
    title-en="Access forbidden"
    :body-lines="[
      '当前账号没有访问该页面的权限。可能是角色不匹配，或资源属于其他账号。',
      '如确需访问，请联系管理员开通，或返回模板中心继续工作。',
    ]"
    status="HTTP 403"
  />
</template>
