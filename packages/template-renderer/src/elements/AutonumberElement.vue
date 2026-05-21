<script setup lang="ts">
import { computed } from 'vue';

// eslint-disable-next-line import/no-unresolved
import type { TemplateElement } from '@template-printing/schema';

const props = defineProps<{
  element: Extract<TemplateElement, { type: 'autonumber' }>;
  data?: Record<string, unknown>;
  designMode?: boolean;
}>();

const displayValue = computed<string>(() => {
  // Design mode: synthesize a sample based on format string
  if (props.designMode) {
    const digits = (props.element.format.match(/0/g) ?? []).length;
    return props.element.prefix + '1'.padStart(digits, '0');
  }
  // Print mode: backend supplies the resolved number via data.__autonumber.<sequence>
  const v = (props.data?.__autonumber as Record<string, string> | undefined)?.[
    props.element.sequence
  ];
  return v ?? `[${props.element.sequence}]`;
});
</script>

<template>
  <div class="tp-autonumber">{{ displayValue }}</div>
</template>

<style scoped>
.tp-autonumber {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  font-family: ui-monospace, monospace;
}
</style>
