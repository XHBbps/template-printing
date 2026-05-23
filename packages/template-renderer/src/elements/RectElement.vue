<script setup lang="ts">
// eslint-disable-next-line import/no-unresolved
import type { TemplateElement } from '@template-printing/schema';
import { computed } from 'vue';
import { styleToCss } from '../styleToCss';

const props = defineProps<{
  element: Extract<TemplateElement, { type: 'rect' }>;
  designMode?: boolean;
}>();

const containerStyle = computed(() => ({
  ...styleToCss(props.element.style),
  width: '100%',
  height: '100%',
  boxSizing: 'border-box' as const,
  padding: `${props.element.style.padding.t}px ${props.element.style.padding.r}px ${props.element.style.padding.b}px ${props.element.style.padding.l}px`,
}));
</script>

<template>
  <div :style="containerStyle"></div>
</template>
