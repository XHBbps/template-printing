<script setup lang="ts">
import { computed } from 'vue';

// eslint-disable-next-line import/no-unresolved
import type { TemplateElement, ElementStyle } from '@template-printing/schema';

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

function styleToCss(s: ElementStyle): Record<string, string | number> {
  // Same conversion logic as TextElement — duplicated intentionally so each
  // element file is self-contained for review. Will share later if it grows.
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
  <div
    class="tp-field"
    :class="{ 'tp-field-design': props.designMode }"
    :style="styleToCss(props.element.style)"
  >
    {{ displayValue }}
  </div>
</template>

<style scoped>
.tp-field {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.tp-field-design {
  color: #0969da;
}
</style>
