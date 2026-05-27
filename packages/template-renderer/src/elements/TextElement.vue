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
const underline = computed(() => props.element.style.textDecoration === 'underline');

// 容器只负责盒子（边框/背景/内边距）与对齐；文字排版（letter-spacing / 下划线）下沉到内层
// run，这样:① center/right 时抵消尾部字距 → 真正左右对称;② 下划线可控间距;③ justify 走
// 真·分散对齐而非无效的 flex space-between。
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

// 内层文字 run 的排版样式。
const runStyle = computed(() => {
  const s: Record<string, string> = {};
  if (underline.value) {
    s.textDecoration = 'underline';
    s.textUnderlineOffset = '0.15em'; // 下划线与字体留一点间距
  }
  if (isJustify.value) {
    // 真·分散对齐:CJK 字符在框内等距铺满、首尾贴边 → 左右完全对称,下划线随之边到边对称。
    // justify 模式下不再叠加 letter-spacing（间距由分散对齐分配）。
    s.display = 'block';
    s.width = '100%';
    s.textAlign = 'justify';
    s.textAlignLast = 'justify';
  } else if (letterSpacing.value) {
    s.letterSpacing = `${letterSpacing.value}px`;
    // 抵消最后一个字之后的尾部字距,使 center/right 居中真正左右等距。
    s.marginRight = `${-letterSpacing.value}px`;
  }
  return s;
});
</script>

<template>
  <div :style="containerStyle">
    <span :style="runStyle">{{ props.element.content.static }}</span>
  </div>
</template>
