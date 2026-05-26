<script setup lang="ts">
import ErrorStage from './ErrorStage.vue';
</script>

<template>
  <ErrorStage
    num-left="4"
    num-right="4"
    stamp="VOID"
    eyebrow="Misprint · 寻址失败"
    title-cn="这一页不在模板库里"
    title-en="Page not found"
    :body-lines="[
      '您访问的路径在当前账号下不存在、已被移除，或地址拼写有误。',
      '请确认链接来源，或返回模板中心继续工作。',
    ]"
    status="HTTP 404"
  />
</template>
