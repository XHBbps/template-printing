<script setup lang="ts">
defineProps<{
  templateJson: unknown;
  data?: Record<string, unknown>;
}>();
</script>

<template>
  <div class="template-renderer">
    <p>TemplateRenderer placeholder — real implementation lands in Plan 2 + Plan 4.</p>
  </div>
</template>

<style scoped>
.template-renderer {
  padding: 12px;
  border: 1px dashed #ccc;
  color: #888;
  font-family: ui-monospace, monospace;
}
</style>
