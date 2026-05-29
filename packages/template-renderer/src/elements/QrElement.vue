<script setup lang="ts">
// eslint-disable-next-line import/no-unresolved
import type { TemplateElement } from '@template-printing/schema';
import { computed, ref, watch, onMounted, nextTick, inject } from 'vue';
import { renderSettleKey } from '../render-context';

const props = defineProps<{
  element: Extract<TemplateElement, { type: 'qr' }>;
  data?: Record<string, unknown>;
  designMode?: boolean;
  isResizing?: boolean;
}>();

const qrSvg = ref('');

// 渲染-settle ctx:仅非 designMode(打印渲染期)参与;设计器不 provide → null。
const settle = inject(renderSettleKey, null);
const active = () => (!props.designMode && settle ? settle : null);

const contentText = computed(() => {
  if (props.element.binding) {
    const v = props.data?.[props.element.binding];
    return v == null ? '' : String(v);
  }
  return props.element.content?.static ?? '';
});

const hasContent = computed(() => contentText.value !== '');

const wrapStyle = computed(() => ({
  width: '100%',
  height: '100%',
  position: 'relative' as const,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
}));

async function render(): Promise<void> {
  if (!hasContent.value) {
    qrSvg.value = '';
    return;
  }
  // 早 return(无内容)在 begin 之前 → 不算异步操作,不计。
  const ctx = active();
  // 🔴 begin() 同步先行:pending>0 必须早于 await import,settle barrier 才会
  // 等到 qrcode-generator 懒 chunk 加载 + 生成 SVG 完成,worker 不会提前截图。
  ctx?.begin();
  try {
    // 动态 import 把 qrcode-generator 拆成懒 chunk,无二维码页面不加载。
    const mod = await import('qrcode-generator');
    const qrcode = ((mod as { default?: unknown }).default ?? mod) as (
      typeNumber: number,
      errorCorrectionLevel: 'L' | 'M' | 'Q' | 'H',
    ) => {
      addData: (data: string) => void;
      make: () => void;
      createSvgTag: (opts: { cellSize: number; margin: number }) => string;
    };
    // await 后组件可能已卸载 / 内容已清空。
    if (!hasContent.value) {
      qrSvg.value = '';
      return;
    }
    const eccMap = { L: 'L', M: 'M', Q: 'Q', H: 'H' } as const;
    const ecc = (props.element.eccLevel ?? 'M') as 'L' | 'M' | 'Q' | 'H';
    const qr = qrcode(0, eccMap[ecc]);
    qr.addData(contentText.value);
    qr.make();
    const cellSize = 4;
    const margin = props.element.quietZone ?? 2;
    qrSvg.value = qr.createSvgTag({ cellSize, margin });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[QrElement] qrcode render failed:', err);
    qrSvg.value = '';
    ctx?.reportError('qr_invalid', String((err as Error)?.message ?? err));
  } finally {
    ctx?.end();
  }
}

watch(
  () => ({
    grid: props.element.grid,
    content: props.element.content,
    binding: props.element.binding,
    ecc: props.element.eccLevel,
    fg: props.element.foregroundColor,
    bg: props.element.backgroundColor,
    qz: props.element.quietZone,
    isResizing: props.isResizing,
  }),
  async (next) => {
    if (next.isResizing) return;
    await nextTick();
    void render();
  },
  { deep: true, immediate: true },
);

onMounted(() => {
  void render();
});
</script>

<template>
  <div v-if="props.isResizing" class="qr-placeholder">
    <div class="qr-icon">▦</div>
    <span class="qr-label">二维码</span>
  </div>
  <div v-else class="qr-wrap" :style="wrapStyle">
    <div
      v-if="hasContent"
      class="qr-svg"
      :style="{ color: props.element.foregroundColor, background: props.element.backgroundColor }"
      v-html="qrSvg"
    />
    <div v-else class="qr-empty">未配置内容</div>
  </div>
</template>

<style scoped>
.qr-svg {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}
.qr-svg :deep(svg) {
  width: 100%;
  height: 100%;
}
.qr-empty {
  width: 100%;
  height: 100%;
  border: 1px dashed var(--tp-line-strong, #e0e0e4);
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--tp-ink-faint, #9c9ca3);
  font-size: 11px;
}
.qr-placeholder {
  width: 100%;
  height: 100%;
  background: var(--tp-field-bg, #f5f5f5);
  border-radius: 4px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
}
.qr-icon {
  font-size: 28px;
  color: var(--tp-ink, #333);
  line-height: 1;
}
.qr-label {
  font-size: 10px;
  color: var(--tp-ink-soft, #555);
}
</style>
