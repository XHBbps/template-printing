<script setup lang="ts">
// eslint-disable-next-line import/no-unresolved
import type { TemplateElement } from '@template-printing/schema';
import { computed } from 'vue';

import { styleToCss, verticalAlignToFlex, textAlignToJustify } from '../styleToCss';

const props = defineProps<{
  element: Extract<TemplateElement, { type: 'text' }>;
  designMode?: boolean;
}>();

const align = computed(() => props.element.style.textAlign ?? props.element.style.align ?? 'left');
const isJustify = computed(() => align.value === 'justify');
const letterSpacing = computed(() => props.element.style.letterSpacing ?? 0);
const decoration = computed(() => props.element.style.textDecoration);
const text = computed(() => props.element.content.static);

// 有字间距且非分散对齐时拆分:把"除最后一字外"的部分加字间距,最后一字不带尾部字距。
// 这样整段文字盒宽 = 真实字形范围(无尾部多余间距),居中/右对齐时字形与下划线一起左右对称。
const useSplit = computed(
  () => letterSpacing.value > 0 && !isJustify.value && text.value.length > 1,
);
const head = computed(() => (useSplit.value ? text.value.slice(0, -1) : ''));
const tail = computed(() => (useSplit.value ? text.value.slice(-1) : text.value));
const headStyle = computed(() => ({ letterSpacing: `${letterSpacing.value}px` }));

// 容器只负责盒子与对齐;文字排版(字间距/下划线)下沉到内层 run。
const containerStyle = computed(() => {
  const css = styleToCss(props.element.style);
  delete css.letterSpacing;
  delete css.textDecoration;
  delete css.textAlign;
  return {
    ...css,
    display: 'flex',
    alignItems: verticalAlignToFlex(props.element.style.verticalAlign),
    justifyContent: isJustify.value ? 'stretch' : textAlignToJustify(align.value),
    width: '100%',
    height: '100%',
    padding: `${props.element.style.padding.t}px ${props.element.style.padding.r}px ${props.element.style.padding.b}px ${props.element.style.padding.l}px`,
  };
});

// 文字 run:下划线 + 间距;justify 走真·分散对齐。
const runStyle = computed(() => {
  const s: Record<string, string> = {};
  if (decoration.value === 'underline') {
    // 下划线用 border-bottom 渲染(text-decoration 无法超出文字范围):
    // 左右各 0.5em padding = 等量延长;底部 0.15em padding = 与文字的间距。
    // run 被容器居中 → 下划线左右对称延长。
    s.borderBottom = '1px solid currentColor';
    s.padding = '0 0.5em 0.15em';
  } else if (decoration.value === 'overline' || decoration.value === 'line-through') {
    // 上划线/删除线不需超出文字范围,沿用原生 text-decoration
    //(containerStyle 已统一删除 textDecoration,故在此 run 上重新应用)。
    s.textDecoration = decoration.value;
  }
  if (isJustify.value) {
    // 真·分散对齐:CJK 字符在框内等距铺满、首尾贴边 → 左右完全对称。
    s.display = 'block';
    s.width = '100%';
    s.textAlign = 'justify';
    s.textAlignLast = 'justify';
  }
  return s;
});
</script>

<template>
  <div :style="containerStyle">
    <span :style="runStyle"
      ><span v-if="useSplit" :style="headStyle">{{ head }}</span
      ><span>{{ tail }}</span></span
    >
  </div>
</template>
