<script setup lang="ts">
// eslint-disable-next-line import/no-unresolved
import type { TemplateElement, ElementStyle } from '@template-printing/schema';

const props = defineProps<{
  element: Extract<TemplateElement, { type: 'text' }>;
}>();

function styleToCss(s: ElementStyle): Record<string, string | number> {
  const css: Record<string, string | number> = {
    paddingTop: `${s.padding.t}px`,
    paddingRight: `${s.padding.r}px`,
    paddingBottom: `${s.padding.b}px`,
    paddingLeft: `${s.padding.l}px`,
    borderRadius: `${s.borderRadius}px`,
  };
  if (s.fontSize) css.fontSize = `${s.fontSize}px`;
  if (s.fontWeight) css.fontWeight = s.fontWeight;
  if (s.align) css.textAlign = s.align;
  if (s.color) css.color = s.color;
  if (s.fontFamily) css.fontFamily = s.fontFamily;
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
  <div class="tp-text" :style="styleToCss(props.element.style)">
    {{ props.element.content.static }}
  </div>
</template>

<style scoped>
.tp-text {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  white-space: pre-wrap;
  word-break: break-all;
}
</style>
