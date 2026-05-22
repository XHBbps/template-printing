<script setup lang="ts">
// eslint-disable-next-line import/no-unresolved
import type { TemplateElement } from '@template-printing/schema';
import { computed } from 'vue';
import { useDesignerStore } from '../stores/designer';

const props = defineProps<{ element: Extract<TemplateElement, { type: 'barcode' | 'qr' }> }>();
const emit = defineEmits<{ (e: 'update', patch: Partial<TemplateElement>): void }>();

const store = useDesignerStore();

const mode = computed<'static' | 'field'>(() =>
  (props.element.binding ?? '') !== '' ? 'field' : 'static',
);

function setMode(m: 'static' | 'field'): void {
  if (m === 'static') {
    emit('update', { binding: undefined, content: { static: '' } } as Partial<TemplateElement>);
  } else {
    emit('update', { binding: '', content: undefined } as Partial<TemplateElement>);
  }
}

function setStatic(v: string): void {
  emit('update', { binding: undefined, content: { static: v } } as Partial<TemplateElement>);
}
function setBinding(key: string): void {
  emit('update', { binding: key, content: undefined } as Partial<TemplateElement>);
}

const eligibleFields = computed(() =>
  store.fieldDefs.filter((f) => f.def.type === 'string' || f.def.type === 'number'),
);
</script>

<template>
  <div class="bc-src">
    <div class="bc-src-tabs seg">
      <button :class="{ on: mode === 'static' }" @click="setMode('static')">静态文本</button>
      <button :class="{ on: mode === 'field' }" @click="setMode('field')">字段绑定</button>
    </div>
    <div v-if="mode === 'static'" class="bc-static">
      <input
        type="text"
        class="bc-input"
        :value="props.element.content?.static ?? ''"
        placeholder="例：ORD-001"
        @input="(e: Event) => setStatic((e.target as HTMLInputElement).value)"
      />
    </div>
    <div v-else class="bc-bind">
      <select
        class="bc-input"
        :value="props.element.binding ?? ''"
        @change="(e: Event) => setBinding((e.target as HTMLSelectElement).value)"
      >
        <option value="">（未绑定）</option>
        <option v-for="f in eligibleFields" :key="f.key" :value="f.key">
          {{ f.key }} · {{ f.def.label }}
        </option>
      </select>
    </div>
  </div>
</template>

<style scoped>
.bc-src {
  padding: 10px 0;
}
.bc-src-tabs {
  display: flex;
  gap: 4px;
  margin-bottom: 8px;
}
.seg button {
  border: 1px solid var(--tp-line-strong);
  background: var(--tp-panel);
  padding: 3px 10px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 12px;
  color: var(--tp-ink-soft);
}
.seg button.on {
  background: var(--tp-accent);
  color: #fff;
  border-color: var(--tp-accent);
}
.bc-input {
  width: 100%;
  padding: 4px 8px;
  border: 1px solid var(--tp-line-strong);
  border-radius: 4px;
  font-size: 12px;
  outline: none;
  background: var(--tp-panel);
}
.bc-input:focus {
  border-color: var(--tp-accent);
}
</style>
