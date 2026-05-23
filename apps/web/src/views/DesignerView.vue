<script setup lang="ts">
import '../styles/designer.css';

import { onMounted, watch } from 'vue';
import { useRoute } from 'vue-router';

import CanvasElementsList from '../designer/CanvasElementsList.vue';
import DesignerCanvas from '../designer/DesignerCanvas.vue';
import DesignerHeader from '../designer/DesignerHeader.vue';
import ElementLibrary from '../designer/ElementLibrary.vue';
import FieldManager from '../designer/FieldManager.vue';
import PropertyPanel from '../designer/PropertyPanel.vue';
import TemplateNameEditor from '../designer/TemplateNameEditor.vue';
import { apiFetch } from '../lib/api';
import { useDesignerStore } from '../stores/designer';
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

async function loadById(id: string): Promise<void> {
  try {
    const record = await apiFetch<{ id: string; name: string; data: unknown }>(`/templates/${id}`);
    const data = record.data as Template;
    store.loadTemplate(data);
  } catch {
    // If fetch fails, fall back to a fresh template rather than showing an error screen.
    store.reset();
  }
}

async function initialize(): Promise<void> {
  const id = getEffectiveId();
  if (id) {
    await loadById(id);
  } else {
    const restored = store.restore();
    if (!restored) store.reset();
  }
}

onMounted(() => {
  void initialize();
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

    <!-- CENTER: floating toolbar + canvas -->
    <section class="designer-center">
      <DesignerHeader />
      <DesignerCanvas />
    </section>

    <!-- RIGHT: (top) FieldManager / (bottom) PropertyPanel -->
    <aside class="designer-right tp-panel">
      <FieldManager />
      <PropertyPanel />
    </aside>
  </div>
</template>
