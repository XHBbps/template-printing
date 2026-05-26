<script setup lang="ts">
import ErrorStage from './ErrorStage.vue';
</script>

<template>
  <ErrorStage
    num-left="5"
    num-right="0"
    stamp="ERROR"
    eyebrow="Server error · 服务异常"
    title-cn="这一版没印出来"
    title-en="Internal server error"
    :body-lines="[
      '服务端处理请求时发生异常，这一次没有成功。问题已记录，通常稍后重试即可恢复。',
      '若反复出现，请把下方请求 ID 提供给流程IT 协助排查。',
    ]"
    status="HTTP 500"
  />
</template>
