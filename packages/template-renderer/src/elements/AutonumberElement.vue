<script setup lang="ts">
import { computed } from 'vue';

// eslint-disable-next-line import/no-unresolved
import type { TemplateElement } from '@template-printing/schema';
import { styleToCss, verticalAlignToFlex } from '../styleToCss';

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

const containerStyle = computed(() => ({
  ...styleToCss(props.element.style),
  display: 'flex',
  alignItems: verticalAlignToFlex(props.element.style.verticalAlign),
  width: '100%',
  height: '100%',
  padding: `${props.element.style.padding.t}px ${props.element.style.padding.r}px ${props.element.style.padding.b}px ${props.element.style.padding.l}px`,
}));
</script>

<template>
  <div :style="containerStyle">{{ displayValue }}</div>
</template>
