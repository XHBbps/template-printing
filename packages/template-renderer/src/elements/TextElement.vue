<script setup lang="ts">
// eslint-disable-next-line import/no-unresolved
import type { TemplateElement } from '@template-printing/schema';
import { computed } from 'vue';
import { styleToCss, verticalAlignToFlex, textAlignToJustify } from '../styleToCss';

const props = defineProps<{
  element: Extract<TemplateElement, { type: 'text' }>;
  designMode?: boolean;
}>();

const containerStyle = computed(() => ({
  ...styleToCss(props.element.style),
  display: 'flex',
  alignItems: verticalAlignToFlex(props.element.style.verticalAlign),
  justifyContent: textAlignToJustify(props.element.style.textAlign),
  width: '100%',
  height: '100%',
  padding: `${props.element.style.padding.t}px ${props.element.style.padding.r}px ${props.element.style.padding.b}px ${props.element.style.padding.l}px`,
}));
</script>

<template>
  <div :style="containerStyle">{{ props.element.content.static }}</div>
</template>
