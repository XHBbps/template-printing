<script setup lang="ts">
import { computed } from 'vue';

// eslint-disable-next-line import/no-unresolved
import type { TemplateElement } from '@template-printing/schema';
import { styleToCss, verticalAlignToFlex } from '../styleToCss';

const props = defineProps<{
  element: Extract<TemplateElement, { type: 'field' }>;
  data?: Record<string, unknown>;
  designMode?: boolean;
}>();

const displayValue = computed(() => {
  if (props.designMode) return `{{ ${props.element.binding} }}`;
  const v = props.data?.[props.element.binding];
  if (v == null || v === '') return props.element.fallback;
  return String(v);
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
  <div :class="{ 'tp-field-design': props.designMode }" :style="containerStyle">
    {{ displayValue }}
  </div>
</template>

<style scoped>
.tp-field-design {
  color: #0969da;
}
</style>
