<script setup lang="ts">
import { computed } from 'vue';

// eslint-disable-next-line import/no-unresolved
import type { TemplateElement } from '@template-printing/schema';

const props = defineProps<{
  element: Extract<TemplateElement, { type: 'system' }>;
  data?: Record<string, unknown>;
  designMode?: boolean;
  pageNo?: number;
  totalPages?: number;
}>();

const displayValue = computed<string>(() => {
  const v = props.element.variable;
  switch (v) {
    case 'pageNo':
      return String(props.pageNo ?? (props.designMode ? 1 : ''));
    case 'totalPages':
      return String(props.totalPages ?? (props.designMode ? 1 : ''));
    case 'now':
      return new Date().toLocaleString('zh-CN');
    case 'printedBy':
      return (
        (props.data?.__printedBy as string | undefined) ??
        (props.designMode ? '{{ 当前用户 }}' : '')
      );
    default:
      return '';
  }
});
</script>

<template>
  <div class="tp-system">{{ displayValue }}</div>
</template>

<style scoped>
.tp-system {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
}
</style>
