<script setup lang="ts">
// eslint-disable-next-line import/no-unresolved
import { ElDialog } from 'element-plus';
import { computed, ref, watch } from 'vue';
// eslint-disable-next-line import/no-unresolved
import { TemplateRenderer } from '@template-printing/template-renderer';
import type { Template } from '@template-printing/schema';

import { apiFetch } from '../lib/api';

const props = defineProps<{
  open: boolean;
  templateId: string;
  version: number | null;
  name?: string;
}>();
const emit = defineEmits<{
  (e: 'update:open', v: boolean): void;
  (e: 'copy'): void;
}>();

const template = ref<Template | null>(null);
const sampleData = ref<Record<string, unknown>>({});
const loading = ref(false);
const previewZoom = ref(1);
const modalContainerRef = ref<HTMLElement | null>(null);
const zoomOptions = [0.5, 0.75, 1, 1.5, 2];

watch(
  () => props.open,
  async (open) => {
    if (open && props.version != null) {
      loading.value = true;
      try {
        const res = await apiFetch<{ data: Template }>(
          `/templates/${props.templateId}/versions/${props.version}`,
        );
        template.value = res.data;
        const sample: Record<string, unknown> = {};
        for (const [k, def] of Object.entries(res.data.schema ?? {})) {
          sample[k] = (def as { example?: unknown }).example ?? '';
        }
        sampleData.value = sample;
        requestAnimationFrame(() => {
          previewZoom.value = computeFit();
        });
      } catch {
        template.value = null;
      } finally {
        loading.value = false;
      }
    }
    if (!open) {
      template.value = null;
      sampleData.value = {};
    }
  },
);

const paperPx = computed(() => {
  const t = template.value;
  if (!t) return { w: 0, h: 0 };
  return { w: t.canvas.cell.w * t.canvas.cols, h: t.canvas.cell.h * t.canvas.rows };
});

function computeFit(): number {
  const el = modalContainerRef.value;
  if (!el) return 1;
  const px = paperPx.value;
  if (!px.w || !px.h) return 1;
  const padding = 60;
  const fitW = (el.clientWidth - padding) / px.w;
  const fitH = (el.clientHeight - padding) / px.h;
  return Math.max(0.1, Math.min(2, Math.min(fitW, fitH)));
}

function onFitPreview(): void {
  previewZoom.value = computeFit();
}
function choosePreviewZoom(z: number): void {
  previewZoom.value = z;
}

const paperWrapStyle = computed(() => ({
  width: `${paperPx.value.w * previewZoom.value}px`,
  height: `${paperPx.value.h * previewZoom.value}px`,
  position: 'relative' as const,
}));

const paperStyle = computed(() => ({
  width: `${paperPx.value.w}px`,
  height: `${paperPx.value.h}px`,
  transform: `scale(${previewZoom.value})`,
  transformOrigin: 'top left',
  background: 'var(--paper-white)',
}));

const boundFieldDefs = computed(() => Object.entries(template.value?.schema ?? {}));

function setSample(key: string, v: string): void {
  sampleData.value[key] = v;
}

function fieldLabel(def: unknown): string {
  return (def as { label?: string }).label ?? '';
}

const dialogTitle = computed(() => (props.name ? `预览：${props.name}` : '预览模板'));
</script>

<template>
  <ElDialog
    :model-value="open"
    :title="dialogTitle"
    width="80vw"
    :append-to-body="true"
    @close="emit('update:open', false)"
  >
    <div class="preview-layout">
      <!-- 左栏：示例数据 -->
      <aside class="data-form">
        <h4 class="data-title">示例数据</h4>
        <template v-if="loading">
          <p class="empty">加载中…</p>
        </template>
        <template v-else-if="template == null">
          <p class="empty">加载失败</p>
        </template>
        <template v-else-if="boundFieldDefs.length > 0">
          <div v-for="[key, def] in boundFieldDefs" :key="key" class="field">
            <label class="lbl">
              <code class="key">{{ key }}</code>
              <span class="han">{{ fieldLabel(def) }}</span>
            </label>
            <input
              type="text"
              :value="String(sampleData[key] ?? '')"
              @input="(e) => setSample(key, (e.target as HTMLInputElement).value)"
            />
          </div>
        </template>
        <p v-else class="empty">未声明数据字段</p>
      </aside>

      <!-- 中间预览区 -->
      <div class="pv-wrap">
        <div ref="modalContainerRef" class="pv-container">
          <div class="pv-paper-wrap" :style="paperWrapStyle">
            <div class="tp-paper" :style="paperStyle">
              <TemplateRenderer v-if="template" :template="template" :data="sampleData" />
            </div>
          </div>
        </div>

        <!-- 右下分段缩放控件 -->
        <div class="pv-zoom">
          <button type="button" class="seg" :class="{ active: false }" @click="onFitPreview">
            Fit
          </button>
          <button
            v-for="z in zoomOptions"
            :key="z"
            type="button"
            class="seg"
            :class="{ active: Math.abs(previewZoom - z) < 0.01 }"
            @click="choosePreviewZoom(z)"
          >
            {{ Math.round(z * 100) }}%
          </button>
        </div>
      </div>
    </div>

    <template #footer>
      <button class="btn btn-primary sm" type="button" @click="emit('copy')">复制到我的</button>
      <button class="btn btn-secondary sm" type="button" @click="emit('update:open', false)">
        关闭
      </button>
    </template>
  </ElDialog>
</template>

<style scoped>
.preview-layout {
  display: grid;
  grid-template-columns: 240px minmax(0, 1fr);
  gap: 0;
  max-height: 70vh;
}

/* ============ 左栏：示例数据 ============ */
.data-form {
  background: var(--paper-white);
  border-right: 1px solid var(--stone);
  padding: 4px 16px 4px 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.data-title {
  margin: 0 0 4px;
  font-family: var(--font-han);
  font-size: 12px;
  font-weight: 500;
  color: var(--ink);
}
.data-form .field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.data-form .lbl {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: var(--fg-3);
}
.data-form .key {
  font-family: var(--font-mono);
  background: var(--mist);
  border: 1px solid var(--stone);
  padding: 1px 5px;
  border-radius: var(--radius-1);
  color: var(--ink);
}
.data-form .han {
  font-family: var(--font-han);
  color: var(--fg-3);
}
.data-form input {
  width: 100%;
  height: 32px;
  padding: 0 10px;
  border: 1px solid var(--stone);
  border-radius: var(--radius-1);
  font-family: var(--font-han);
  font-size: 12.5px;
  color: var(--ink);
  background: var(--paper-white);
  outline: none;
}
.data-form input:focus {
  border-color: var(--yangli-red);
  outline: 1px solid var(--yangli-red);
  outline-offset: -1px;
}
.empty {
  font-family: var(--font-han);
  font-size: 12px;
  color: var(--fg-3);
  margin-top: 12px;
  line-height: 1.7;
}

/* ============ 中间预览区 ============ */
.pv-wrap {
  position: relative;
  width: 100%;
  min-width: 0;
  height: 70vh;
  overflow: hidden;
}
.pv-container {
  width: 100%;
  height: 100%;
  overflow: auto;
  background: var(--mist);
}
.pv-paper-wrap {
  margin: 30px;
  width: max-content;
}
.tp-paper {
  border: 1px solid var(--stone);
}

/* ============ 右下分段缩放 ============ */
.pv-zoom {
  position: absolute;
  bottom: 12px;
  right: 12px;
  z-index: 5;
  display: inline-flex;
  background: var(--paper-white);
  border: 1px solid var(--stone);
  border-radius: var(--radius-2);
  padding: 4px;
  gap: 0;
}
.pv-zoom .seg {
  height: 26px;
  padding: 0 10px;
  border: none;
  background: transparent;
  font-family: var(--font-mono);
  font-size: 11.5px;
  color: var(--fg-2);
  cursor: pointer;
  position: relative;
  display: inline-flex;
  align-items: center;
  border-radius: var(--radius-1);
  transition:
    background var(--dur-fast) var(--ease-default),
    color var(--dur-fast) var(--ease-default);
}
.pv-zoom .seg + .seg::before {
  content: '';
  position: absolute;
  left: -1px;
  top: 5px;
  bottom: 5px;
  width: 1px;
  background: var(--stone);
}
.pv-zoom .seg:hover {
  background: var(--mist);
  color: var(--ink);
}
.pv-zoom .seg.active {
  background: var(--ink);
  color: var(--paper-white);
}
.pv-zoom .seg.active + .seg::before,
.pv-zoom .seg:has(+ .seg.active)::after {
  display: none;
}
</style>
