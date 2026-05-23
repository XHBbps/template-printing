<script setup lang="ts">
import { computed, ref, watch } from 'vue';

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

const loadFailed = ref(false);

function onLoadError(): void {
  loadFailed.value = true;
}
function onLoadSuccess(): void {
  loadFailed.value = false;
}

watch(src, () => {
  loadFailed.value = false;
});
</script>

<template>
  <div
    :style="containerStyle"
    :class="{
      'tp-image-design': props.designMode && !src,
      'tp-image-failed': loadFailed,
    }"
  >
    <img
      v-if="src && !loadFailed"
      :src="src"
      referrerpolicy="no-referrer"
      :style="{ width: '100%', height: '100%', objectFit }"
      @load="onLoadSuccess"
      @error="onLoadError"
    />
    <span v-else-if="props.designMode && loadFailed" class="tp-image-placeholder"
      >⚠ 图片加载失败</span
    >
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
.tp-image-failed {
  border: 1px dashed #d94f4f;
  background: #fff5f5;
}
.tp-image-failed .tp-image-placeholder {
  color: #d94f4f;
}
</style>
