<script setup lang="ts">
import '../styles/designer.css';

import { onMounted } from 'vue';
import { useRoute } from 'vue-router';

import CanvasElementsList from '../designer/CanvasElementsList.vue';
import DesignerCanvas from '../designer/DesignerCanvas.vue';
import DesignerHeader from '../designer/DesignerHeader.vue';
import ElementLibrary from '../designer/ElementLibrary.vue';
import FieldManager from '../designer/FieldManager.vue';
import PropertyPanel from '../designer/PropertyPanel.vue';
import TemplateNameEditor from '../designer/TemplateNameEditor.vue';
import { useDesignerStore } from '../stores/designer';

const route = useRoute();
const store = useDesignerStore();

onMounted(() => {
  if (route.params.id) {
    store.reset();
  } else {
    const restored = store.restore();
    if (!restored) store.reset();
  }
});
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
