<script setup lang="ts">
import { computed } from 'vue';
// eslint-disable-next-line import/no-unresolved
import {
  TextElement,
  FieldElement,
  ImageElement,
  TableElement,
  BarcodeElement,
  AutonumberElement,
  SystemElement,
  RectElement,
} from '@template-printing/template-renderer';
// eslint-disable-next-line import/no-unresolved
import type { TemplateElement } from '@template-printing/schema';

import { useDesignerStore } from '../stores/designer';
import ElementGrip from './ElementGrip.vue';
import HitZones from './HitZones.vue';
import { usePointerDrag } from './usePointerDrag';

const props = defineProps<{ element: TemplateElement }>();
const store = useDesignerStore();

const isSelected = computed(() => store.selectedIds.includes(props.element.id));

const positionStyle = computed(() => ({
  left: `calc(${props.element.grid.c} * var(--cell-w))`,
  top: `calc(${props.element.grid.r} * var(--cell-h))`,
  width: `calc(${props.element.grid.cs} * var(--cell-w))`,
  height: `calc(${props.element.grid.rs} * var(--cell-h))`,
}));

const sizeBadge = computed(() => `${props.element.grid.cs}×${props.element.grid.rs} 格`);

function selectMe(e: MouseEvent): void {
  e.stopPropagation();
  store.select([props.element.id]);
}

const { onGripDown, onResizeDown } = usePointerDrag(props.element.id);

const elementMap: Record<string, unknown> = {
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
  <div
    class="tp-element"
    :class="{ 'is-selected': isSelected }"
    :style="positionStyle"
    @click="selectMe"
  >
    <component :is="elementMap[props.element.type]" :element="props.element" design-mode />
    <ElementGrip v-if="isSelected" @pointerdown="onGripDown" />
    <HitZones v-if="isSelected" @pointerdown="onResizeDown" />
    <span v-if="isSelected" class="size-badge">{{ sizeBadge }}</span>
  </div>
</template>

<style scoped>
.tp-element {
  position: absolute;
  box-sizing: border-box;
  cursor: pointer;
}
.tp-element.is-selected {
  outline: 1.5px solid #0969da;
  outline-offset: 2px;
  border-radius: 4px;
  box-shadow: 0 0 0 5px rgba(9, 105, 218, 0.1);
}
.size-badge {
  position: absolute;
  bottom: -22px;
  right: -1px;
  background: #1f2328;
  color: #fff;
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 3px;
  font-family: ui-monospace, monospace;
  pointer-events: none;
}
</style>
