<script setup lang="ts">
import { computed } from 'vue';

// eslint-disable-next-line import/no-unresolved
import type { TemplateElement } from '@template-printing/schema';

const props = defineProps<{
  element: Extract<TemplateElement, { type: 'image' }>;
  data?: Record<string, unknown>;
  designMode?: boolean;
}>();

const src = computed<string | null>(() => {
  const s = props.element.source;
  if (s.kind === 'static') return s.url;
  const v = props.data?.[s.binding];
  return typeof v === 'string' ? v : null;
});

const objectFit = computed(() => props.element.fit ?? 'contain');
</script>

<template>
  <div class="tp-image" :class="{ 'tp-image-design': props.designMode && !src }">
    <img v-if="src" :src="src" :style="{ objectFit }" />
    <span v-else-if="props.designMode" class="tp-image-placeholder">▤ 图片</span>
  </div>
</template>

<style scoped>
.tp-image {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}
.tp-image img {
  width: 100%;
  height: 100%;
}
.tp-image-design {
  border: 1px dashed #c0c7ff;
  background: linear-gradient(135deg, #fafafa, #eef1f4);
}
.tp-image-placeholder {
  color: #86909c;
  font-size: 11px;
}
</style>
