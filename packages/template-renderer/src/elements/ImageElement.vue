<script setup lang="ts">
import { computed } from 'vue';

// eslint-disable-next-line import/no-unresolved
import type { TemplateElement } from '@template-printing/schema';
import { styleToCss } from '../styleToCss';

const props = defineProps<{
  element: Extract<TemplateElement, { type: 'image' }>;
  data?: Record<string, unknown>;
  designMode?: boolean;
}>();

const containerStyle = computed(() => ({
  ...styleToCss(props.element.style),
  width: '100%',
  height: '100%',
  boxSizing: 'border-box' as const,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  overflow: 'hidden',
  padding: `${props.element.style.padding.t}px ${props.element.style.padding.r}px ${props.element.style.padding.b}px ${props.element.style.padding.l}px`,
}));

const src = computed<string | null>(() => {
  const s = props.element.source;
  if (s.kind === 'static') return s.url;
  const v = props.data?.[s.binding];
  return typeof v === 'string' ? v : null;
});

const objectFit = computed(() => props.element.fit ?? 'contain');
</script>

<template>
  <div :style="containerStyle" :class="{ 'tp-image-design': props.designMode && !src }">
    <img v-if="src" :src="src" :style="{ width: '100%', height: '100%', objectFit }" />
    <span v-else-if="props.designMode" class="tp-image-placeholder">▤ 图片</span>
  </div>
</template>

<style scoped>
.tp-image-design {
  border: 1px dashed #c0c7ff;
  background: linear-gradient(135deg, #fafafa, #eef1f4);
}
.tp-image-placeholder {
  color: #86909c;
  font-size: 11px;
}
</style>
