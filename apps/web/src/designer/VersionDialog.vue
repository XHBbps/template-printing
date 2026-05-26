<script setup lang="ts">
import { ref, watch } from 'vue';
// eslint-disable-next-line import/no-unresolved
import { ElDialog, ElScrollbar, ElMessage } from 'element-plus';
import { apiFetch } from '../lib/api';
import { useDesignerStore } from '../stores/designer';

const props = defineProps<{ modelValue: boolean; templateId: string }>();
const emit = defineEmits<{ 'update:modelValue': [boolean] }>();
const store = useDesignerStore();

interface VersionItem {
  version: number;
  publishedAt: string;
  restoredFrom: number | null;
  isCurrent: boolean;
}
const items = ref<VersionItem[]>([]);
const publishedVersion = ref<number | null>(null);
const selected = ref<number | null>(null);
const loading = ref(false);
const rolling = ref(false);

async function load(): Promise<void> {
  loading.value = true;
  try {
    const r = await apiFetch<{ publishedVersion: number | null; items: VersionItem[] }>(
      `/templates/${props.templateId}/versions`,
    );
    items.value = r.items;
    publishedVersion.value = r.publishedVersion;
    selected.value = r.items[0]?.version ?? null;
  } finally {
    loading.value = false;
  }
}

watch(
  () => props.modelValue,
  (open) => {
    if (open) void load();
  },
);

function fmt(iso: string): string {
  const d = new Date(iso);
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

async function doRollback(version: number): Promise<void> {
  rolling.value = true;
  try {
    const r = await apiFetch<{ version: number; restoredFrom: number }>(
      `/templates/${props.templateId}/rollback`,
      { method: 'POST', body: JSON.stringify({ version }) },
    );
    ElMessage.success(`已回滚：V${r.restoredFrom} → 新版 V${r.version}`);
    store.setVersionState(r.version, true);
    await load();
  } catch (e) {
    ElMessage.error(`回滚失败：${(e as Error).message}`);
  } finally {
    rolling.value = false;
  }
}
</script>

<template>
  <ElDialog
    :model-value="modelValue"
    title="版本管理"
    width="720px"
    :append-to-body="true"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div class="vd-body">
      <ElScrollbar class="vd-list" max-height="420px">
        <button
          v-for="v in items"
          :key="v.version"
          class="vd-item"
          :class="{ active: selected === v.version }"
          type="button"
          @click="selected = v.version"
        >
          <span class="vd-ver">V{{ v.version }}</span>
          <span v-if="v.isCurrent" class="vd-cur">当前</span>
          <span v-if="v.restoredFrom != null" class="vd-from">← 回滚自 V{{ v.restoredFrom }}</span>
          <span class="vd-time">{{ fmt(v.publishedAt) }}</span>
        </button>
        <div v-if="!loading && items.length === 0" class="vd-empty">尚无已发布版本</div>
      </ElScrollbar>

      <div class="vd-detail">
        <template v-if="selected != null">
          <div class="vd-detail-head">版本 V{{ selected }}</div>
          <button
            v-if="publishedVersion != null && selected !== publishedVersion"
            class="vd-rollback"
            type="button"
            :disabled="rolling"
            @click="doRollback(selected)"
          >
            {{ rolling ? '回滚中…' : `回滚并发布（基于 V${selected}）` }}
          </button>
          <p v-else class="vd-note">这是当前发布版本。</p>
        </template>
      </div>
    </div>
  </ElDialog>
</template>

<style scoped>
.vd-body {
  display: grid;
  grid-template-columns: 240px 1fr;
  gap: 20px;
}
.vd-list {
  border-right: 1px solid var(--stone);
  padding-right: 8px;
}
.vd-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 10px 12px;
  border: none;
  background: none;
  cursor: pointer;
  border-left: 2px solid transparent;
  font-family: var(--font-han);
  text-align: left;
}
.vd-item:hover {
  background: var(--mist);
}
.vd-item.active {
  border-left-color: var(--yangli-red);
  background: var(--mist);
}
.vd-ver {
  font-family: var(--font-mono);
  font-weight: 600;
  color: var(--ink);
}
.vd-cur {
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--yangli-red);
}
.vd-from {
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--fg-3);
}
.vd-time {
  margin-left: auto;
  font-family: var(--font-mono);
  font-size: 10.5px;
  color: var(--fg-3);
}
.vd-empty {
  padding: 24px;
  text-align: center;
  color: var(--fg-3);
  font-family: var(--font-han);
}
.vd-detail-head {
  font-family: var(--font-han);
  font-weight: 600;
  font-size: 15px;
  color: var(--ink);
  margin-bottom: 14px;
}
.vd-rollback {
  height: 38px;
  padding: 0 18px;
  background: var(--yangli-red);
  color: var(--paper-white);
  border: 1px solid var(--yangli-red);
  border-radius: var(--radius-2);
  cursor: pointer;
  font-family: var(--font-han);
  font-size: 13px;
  font-weight: 500;
}
.vd-rollback:hover {
  background: var(--accent-hover);
  border-color: var(--accent-hover);
}
.vd-rollback:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.vd-note {
  font-family: var(--font-han);
  font-size: 13px;
  color: var(--fg-3);
}
</style>
