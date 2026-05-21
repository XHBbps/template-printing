<script setup lang="ts">
import '../styles/designer.css';

import { onMounted } from 'vue';
import { useRoute } from 'vue-router';

import DesignerHeader from '../designer/DesignerHeader.vue';
import ElementLibrary from '../designer/ElementLibrary.vue';
import DesignerCanvas from '../designer/DesignerCanvas.vue';
import FieldManager from '../designer/FieldManager.vue';
import PropertyPanel from '../designer/PropertyPanel.vue';
import { useDesignerStore } from '../stores/designer';

const route = useRoute();
const store = useDesignerStore();

onMounted(() => {
  if (route.params.id) {
    // Plan 3 will load from backend by id. For now, start fresh.
    store.reset();
  } else {
    const restored = store.restore();
    if (!restored) store.reset();
  }
});
</script>

<template>
  <div class="designer-root">
    <DesignerHeader />
    <ElementLibrary />
    <DesignerCanvas />
    <div class="designer-right">
      <FieldManager />
      <PropertyPanel />
    </div>
  </div>
</template>
