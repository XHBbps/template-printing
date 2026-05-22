<script setup lang="ts">
import { computed } from 'vue';

// eslint-disable-next-line import/no-unresolved
import type { TemplateElement } from '@template-printing/schema';
import { styleToCss } from '../styleToCss';

const props = defineProps<{
  element: Extract<TemplateElement, { type: 'table' }>;
  data?: Record<string, unknown>;
  designMode?: boolean;
}>();

const rows = computed<Record<string, unknown>[]>(() => {
  if (props.designMode) {
    // Show 2 sample rows in design mode
    return [
      Object.fromEntries(props.element.columns.map((c) => [c.key, '示例'])) as Record<
        string,
        unknown
      >,
      Object.fromEntries(props.element.columns.map((c) => [c.key, '...'])) as Record<
        string,
        unknown
      >,
    ];
  }
  const v = props.data?.[props.element.binding];
  if (!Array.isArray(v)) return [];
  return v as Record<string, unknown>[];
});

const totalCs = computed(() => props.element.columns.reduce((sum, c) => sum + c.cs, 0) || 1);

const outerStyle = computed(() => ({
  ...styleToCss(props.element.style),
  width: '100%',
  height: '100%',
  display: 'flex',
  flexDirection: 'column' as const,
  fontSize: '12px',
}));
</script>

<template>
  <div :style="outerStyle">
    <div v-if="props.element.showHeader" class="tp-table-row tp-table-header">
      <div
        v-for="col in props.element.columns"
        :key="col.key"
        class="tp-table-cell"
        :style="{ flexBasis: `${(col.cs / totalCs) * 100}%`, textAlign: col.align }"
      >
        {{ col.header }}
      </div>
    </div>
    <div v-for="(row, i) in rows" :key="i" class="tp-table-row">
      <div
        v-for="col in props.element.columns"
        :key="col.key"
        class="tp-table-cell"
        :style="{ flexBasis: `${(col.cs / totalCs) * 100}%`, textAlign: col.align }"
      >
        {{ row[col.key] ?? '' }}
      </div>
    </div>
  </div>
</template>

<style scoped>
.tp-table-row {
  display: flex;
  border-bottom: 1px solid #e5e6eb;
}
.tp-table-header {
  font-weight: 600;
  background: #f7f8fa;
}
.tp-table-cell {
  padding: 4px 6px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
