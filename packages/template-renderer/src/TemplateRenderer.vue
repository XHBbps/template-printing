<script setup lang="ts">
import { computed, type Component } from 'vue';
// eslint-disable-next-line import/no-unresolved
import type { Template } from '@template-printing/schema';

import TextElement from './elements/TextElement.vue';
import FieldElement from './elements/FieldElement.vue';
import ImageElement from './elements/ImageElement.vue';
import TableElement from './elements/TableElement.vue';
import BarcodeElement from './elements/BarcodeElement.vue';
import AutonumberElement from './elements/AutonumberElement.vue';
import SystemElement from './elements/SystemElement.vue';
import RectElement from './elements/RectElement.vue';

const props = defineProps<{
  template: Template;
  data?: Record<string, unknown>;
  designMode?: boolean;
}>();

const cellW = computed(() => props.template.canvas.cell.w);
const cellH = computed(() => props.template.canvas.cell.h);
const cssVars = computed(() => ({
  '--cell-w': `${cellW.value}px`,
  '--cell-h': `${cellH.value}px`,
  '--canvas-w': `${cellW.value * props.template.canvas.cols}px`,
  '--canvas-h': `${cellH.value * props.template.canvas.rows}px`,
}));

// Map element type → component. Typed as Record<string, Component> so vue-tsc
// does not attempt to cross-typecheck every component's prop union against
// every element type — the discriminated union narrowing happens at runtime via
// the `el.type` key and is correct by construction.
const elementMap: Record<string, Component> = {
  text: TextElement,
  field: FieldElement,
  image: ImageElement,
  table: TableElement,
  barcode: BarcodeElement,
  autonumber: AutonumberElement,
  system: SystemElement,
  rect: RectElement,
};
</script>

<template>
  <div class="tp-canvas" :style="cssVars">
    <div
      v-for="el in props.template.elements"
      :key="el.id"
      class="tp-element"
      :style="{
        left: `calc(${el.grid.c} * var(--cell-w))`,
        top: `calc(${el.grid.r} * var(--cell-h))`,
        width: `calc(${el.grid.cs} * var(--cell-w))`,
        height: `calc(${el.grid.rs} * var(--cell-h))`,
      }"
    >
      <component
        :is="elementMap[el.type]"
        :element="el"
        :data="props.data"
        :design-mode="props.designMode"
      />
    </div>
  </div>
</template>

<style scoped>
.tp-canvas {
  position: relative;
  width: var(--canvas-w);
  height: var(--canvas-h);
  background: #fff;
}
.tp-element {
  position: absolute;
  box-sizing: border-box;
}
</style>
