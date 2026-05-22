<script setup lang="ts">
import { computed } from 'vue';

// eslint-disable-next-line import/no-unresolved
import type { TemplateElement } from '@template-printing/schema';
import { styleToCss, verticalAlignToFlex } from '../styleToCss';

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
