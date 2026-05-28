<script setup lang="ts">
import { computed, ref, watch, onMounted, inject } from 'vue';

// eslint-disable-next-line import/no-unresolved
import type { TemplateElement } from '@template-printing/schema';
import { styleToCss } from '../styleToCss';
import { renderSettleKey } from '../render-context';

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

// 渲染-settle ctx:仅非 designMode(打印渲染期)参与;设计器不 provide → null。
const settle = inject(renderSettleKey, null);
const active = () => (!props.designMode && settle ? settle : null);

// 图片加载是异步事件(@load / @error)。pendingLoad 保证每个真正发起的加载恰好一对 begin/end。
let pendingLoad = false;
function beginLoad(): void {
  // 仅非 designMode + 有 src + 未失败 + 当前无未结算加载 时才计一次。
  if (active() && !pendingLoad && src.value && !loadFailed.value) {
    pendingLoad = true;
    settle?.begin();
  }
}
function settleLoad(): void {
  if (pendingLoad) {
    pendingLoad = false;
    settle?.end();
  }
}

function onLoadError(): void {
  loadFailed.value = true;
  if (active()) settle?.reportError('image_404', src.value ?? '');
  settleLoad();
}
function onLoadSuccess(): void {
  loadFailed.value = false;
  settleLoad();
}

watch(src, () => {
  loadFailed.value = false;
  // src 变化:先结算旧的(若有未结算),再为新 src 开始计(有 src 才计)。
  settleLoad();
  beginLoad();
});

onMounted(() => {
  // 初次:若有 src 则开始计一次加载。
  beginLoad();
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
