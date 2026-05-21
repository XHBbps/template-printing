<script setup lang="ts">
// eslint-disable-next-line import/no-unresolved
import type { TemplateElement, ElementStyle } from '@template-printing/schema';

const props = defineProps<{
  element: Extract<TemplateElement, { type: 'rect' }>;
}>();

function styleToCss(s: ElementStyle): Record<string, string | number> {
  const css: Record<string, string | number> = {
    borderRadius: `${s.borderRadius}px`,
  };
  if (s.background) css.background = s.background;
  for (const side of ['top', 'right', 'bottom', 'left'] as const) {
    const b = s.border[side];
    if (b.show) {
      const cap = side.charAt(0).toUpperCase() + side.slice(1);
      css[`border${cap}`] = `${b.width}px ${b.style} ${b.color}`;
    }
  }
  return css;
}
</script>

<template>
  <div class="tp-rect" :style="styleToCss(props.element.style)" />
</template>

<style scoped>
.tp-rect {
  width: 100%;
  height: 100%;
}
</style>
