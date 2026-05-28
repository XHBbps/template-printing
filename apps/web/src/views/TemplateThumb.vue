<script setup lang="ts">
/**
 * 模板卡片封面：渲染指定已发布版本的只读缩略图（填充父容器，居中等比缩放）。
 * 仅在模板已发布时挂载（父级 v-if 守卫）；加载失败则保持透明，露出占位封面。
 */
import { ref, shallowRef, onMounted, onBeforeUnmount, nextTick } from 'vue';
// eslint-disable-next-line import/no-unresolved
import { TemplateRenderer } from '@template-printing/template-renderer';
import type { Template } from '@template-printing/schema';

import { apiFetch } from '../lib/api';

const props = defineProps<{ templateId: string; version: number | null }>();

const tpl = shallowRef<Template | null>(null);
const sample = ref<Record<string, unknown>>({});
const scale = ref(0);
const rootRef = ref<HTMLElement | null>(null);
let ro: ResizeObserver | null = null;
let io: IntersectionObserver | null = null;
let loaded = false;

function canvasPx(t: Template): { w: number; h: number } {
  return { w: t.canvas.cell.w * t.canvas.cols, h: t.canvas.cell.h * t.canvas.rows };
}

function recompute(): void {
  const el = rootRef.value;
  const t = tpl.value;
  if (!el || !t) return;
  const { w, h } = canvasPx(t);
  if (!w || !h || !el.clientWidth || !el.clientHeight) return;
  scale.value = Math.min(el.clientWidth / w, el.clientHeight / h);
}

async function load(): Promise<void> {
  if (loaded || props.version == null) return;
  loaded = true;
  try {
    const r = await apiFetch<{ data: Template }>(
      `/templates/${props.templateId}/versions/${props.version}`,
    );
    tpl.value = r.data;
    const s: Record<string, unknown> = {};
    for (const [k, def] of Object.entries(r.data.schema ?? {})) {
      s[k] = (def as { example?: unknown }).example ?? '';
    }
    sample.value = s;
    await nextTick();
    recompute();
    if (rootRef.value) {
      ro = new ResizeObserver(recompute);
      ro.observe(rootRef.value);
    }
  } catch {
    // 拿不到快照就保持透明，露出占位封面
  }
}

onMounted(() => {
  if (props.version == null || !rootRef.value) return;
  io = new IntersectionObserver(
    (entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        io?.disconnect();
        io = null;
        void load();
      }
    },
    { rootMargin: '200px' },
  );
  io.observe(rootRef.value);
});
onBeforeUnmount(() => {
  io?.disconnect();
  ro?.disconnect();
});
</script>

<template>
  <div ref="rootRef" class="tt-thumb">
    <div
      v-if="tpl && scale > 0"
      class="tt-scale"
      :style="{
        transform: `scale(${scale})`,
        width: `${canvasPx(tpl).w}px`,
        height: `${canvasPx(tpl).h}px`,
      }"
    >
      <TemplateRenderer :template="tpl" :data="sample" />
    </div>
  </div>
</template>

<style scoped>
.tt-thumb {
  position: absolute;
  inset: 0;
  overflow: hidden;
  background: var(--paper-white);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1;
}
.tt-scale {
  transform-origin: center center;
  flex: none;
  pointer-events: none;
}
</style>
