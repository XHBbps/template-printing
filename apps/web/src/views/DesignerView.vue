<script setup lang="ts">
import '../styles/designer.css';

import { onBeforeUnmount, onMounted, watch } from 'vue';
import { useRoute } from 'vue-router';

import CanvasElementsList from '../designer/CanvasElementsList.vue';
import DesignerCanvas from '../designer/DesignerCanvas.vue';
import ElementLibrary from '../designer/ElementLibrary.vue';
import FieldManager from '../designer/FieldManager.vue';
import PropertyPanel from '../designer/PropertyPanel.vue';
import TemplateNameEditor from '../designer/TemplateNameEditor.vue';
import { apiFetch } from '../lib/api';
import { defaultTemplate, useDesignerStore } from '../stores/designer';
import type { Template } from '@template-printing/schema';

const props = defineProps<{
  templateId?: string; // undefined → "new" / restore from localStorage
  embedded?: boolean; // true when rendered inline within TemplatesView
}>();

const route = useRoute();
const store = useDesignerStore();

// Resolve the effective template ID: prop takes precedence; fall back to route param.
function getEffectiveId(): string | undefined {
  if (props.templateId) return props.templateId;
  const param = route.params.id;
  return Array.isArray(param) ? param[0] : param || undefined;
}

function isCompleteTemplate(data: unknown): data is Template {
  if (!data || typeof data !== 'object') return false;
  const t = data as Partial<Template>;
  return (
    typeof t.meta?.version === 'number' &&
    typeof t.canvas?.cell?.w === 'number' &&
    typeof t.canvas?.cell?.h === 'number' &&
    Array.isArray(t.elements) &&
    typeof t.schema === 'object'
  );
}

async function loadById(id: string): Promise<void> {
  try {
    const record = await apiFetch<{ id: string; name: string; data: unknown }>(`/templates/${id}`);
    let data: Template;
    if (isCompleteTemplate(record.data)) {
      data = record.data;
    } else {
      // Self-heal: old template was created with incomplete defaultData.
      // Rebuild a fresh complete structure but preserve the saved name.
      // eslint-disable-next-line no-console
      console.warn(`[Template ${id}] 数据残缺，自动重建结构`);
      const fresh = defaultTemplate();
      fresh.meta.name = record.name;
      data = fresh;
      // Write the repaired template back so next load is clean. Fire-and-forget.
      void apiFetch(`/templates/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ data }),
      });
    }
    store.loadTemplate(data);
    store.setTemplateId(id);
  } catch {
    // If fetch fails (network / 401 / 404), fall back to a fresh template.
    store.reset();
    store.setTemplateId(null);
  }
}

async function initialize(): Promise<void> {
  const id = getEffectiveId();
  if (id) {
    await loadById(id);
  } else {
    const restored = store.restore();
    if (!restored) store.reset();
    store.setTemplateId(null);
  }
}

const SAVE_DEBOUNCE_MS = 1500;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

watch(
  () => store.template,
  () => {
    if (!store.templateId) return;
    // Skip while drag/resize is active — every pointermove mutates anchor and
    // the deep watch traversal accumulates cost. We catch up via the isResizing
    // watcher below when the gesture ends.
    if (store.isResizing) return;
    store.markPendingSave();
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      void store.saveToBackend();
      saveTimer = null;
    }, SAVE_DEBOUNCE_MS);
  },
  { deep: true },
);

// When a drag/resize gesture completes (isResizing becomes false), schedule
// one pending save to capture the final anchor state.
watch(
  () => store.isResizing,
  (now, prev) => {
    if (prev && !now && store.templateId) {
      store.markPendingSave();
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        void store.saveToBackend();
        saveTimer = null;
      }, SAVE_DEBOUNCE_MS);
    }
  },
);

function onBeforeUnload(e: BeforeUnloadEvent): void {
  if (store.saveStatus === 'pending' || store.saveStatus === 'saving' || store.dirty) {
    e.preventDefault();
    e.returnValue = '';
  }
}

onMounted(() => {
  void initialize();
  window.addEventListener('beforeunload', onBeforeUnload);
});

onBeforeUnmount(() => {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
    // Fire one last save before unmounting to flush pending changes
    void store.saveToBackend();
  }
  window.removeEventListener('beforeunload', onBeforeUnload);
});

// When templateId prop changes (e.g. navigating between templates inline), reload.
watch(
  () => props.templateId,
  (newId, oldId) => {
    if (newId && newId !== oldId) {
      void loadById(newId);
    }
  },
);
</script>

<template>
  <div class="designer-root">
    <!-- LEFT: project head + (top) ElementLibrary / (bottom) CanvasElementsList -->
    <aside class="designer-left tp-panel">
      <div class="tp-panel-head">
        <div class="tp-head-text">
          <TemplateNameEditor />
          <div class="tp-head-sub">v{{ store.template.meta.version }} · 草稿已保存</div>
        </div>
      </div>
      <ElementLibrary />
      <CanvasElementsList />
    </aside>

    <!-- CENTER: canvas（toolbar 已上提到 TemplatesView 顶部 breadcrumb） -->
    <section class="designer-center">
      <DesignerCanvas />
    </section>

    <!-- RIGHT: (top) FieldManager / (bottom) PropertyPanel -->
    <aside class="designer-right tp-panel">
      <FieldManager />
      <PropertyPanel />
    </aside>
  </div>
</template>
