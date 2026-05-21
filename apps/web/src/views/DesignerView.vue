<script setup lang="ts">
import '../styles/designer.css';

import DesignerHeader from '../designer/DesignerHeader.vue';
import ElementLibrary from '../designer/ElementLibrary.vue';
import DesignerCanvas from '../designer/DesignerCanvas.vue';
import FieldManager from '../designer/FieldManager.vue';
import PropertyPanel from '../designer/PropertyPanel.vue';
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
