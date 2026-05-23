<script setup lang="ts">
// eslint-disable-next-line import/no-unresolved
import { ElButton, ElEmpty, ElMessage, ElMessageBox } from 'element-plus';
// eslint-disable-next-line import/no-unresolved
import { Plus, FileText, Trash2 } from 'lucide-vue-next';
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import { useTemplatesStore } from '../stores/templates';
import DesignerView from './DesignerView.vue';

const templates = useTemplatesStore();
const route = useRoute();
const router = useRouter();

// Mode state — list vs editor.
type Mode = 'list' | 'editor';
const mode = ref<Mode>('list');
const currentId = ref<string | null>(null);

const currentTemplateName = computed(() => {
  if (!currentId.value) return '';
  const t = templates.list.find((x) => x.id === currentId.value);
  return t?.name ?? '未命名';
});

// Wrap mode transitions with View Transitions API where available.
async function transitionTo(target: 'list' | 'editor', id?: string): Promise<void> {
  const doSwitch = (): void => {
    if (target === 'editor' && id) currentId.value = id;
    mode.value = target;
    if (target === 'list') currentId.value = null;
  };
  type ViewTransitionAPI = Document & {
    startViewTransition?: (cb: () => void) => { finished: Promise<void> };
  };
  const doc = document as ViewTransitionAPI;
  if (typeof doc.startViewTransition === 'function') {
    doc.startViewTransition(doSwitch);
  } else {
    doSwitch();
  }
}

onMounted(async () => {
  await templates.fetchList();
  if (route.query.new === '1') {
    void createNew();
    void router.replace({ query: {} });
  } else if (typeof route.query.open === 'string') {
    const id = route.query.open;
    openTemplate(id);
    void router.replace({ query: {} });
  }
});

function openTemplate(id: string): void {
  void transitionTo('editor', id);
}

async function createNew(): Promise<void> {
  // Minimum default data — DesignerView will populate when mounted.
  const defaultData = { canvas: { paper: 'A4' }, elements: [] };
  try {
    const tpl = await templates.create('未命名模板', defaultData);
    void transitionTo('editor', tpl.id);
  } catch {
    ElMessage.error('创建失败');
  }
}

async function returnToList(): Promise<void> {
  await transitionTo('list');
}

async function deleteTemplate(id: string, name: string): Promise<void> {
  try {
    await ElMessageBox.confirm(`删除模板「${name}」？此操作不可恢复。`, '删除模板', {
      type: 'warning',
      confirmButtonText: '删除',
      cancelButtonText: '取消',
    });
  } catch {
    return;
  }
  try {
    await templates.remove(id);
    ElMessage.success('已删除');
  } catch {
    ElMessage.error('删除失败');
  }
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
</script>

<template>
  <div class="tv-wrap">
    <!-- List mode -->
    <div v-if="mode === 'list'" class="tv-list">
      <header class="tv-head">
        <h1 class="tv-title">模板中心</h1>
        <ElButton type="primary" size="large" @click="createNew">
          <Plus :size="14" :stroke-width="2" style="margin-right: 6px" />
          新建模板
        </ElButton>
      </header>

      <div v-if="templates.loading" class="tv-loading">加载中…</div>
      <ElEmpty
        v-else-if="templates.list.length === 0"
        description="还没有模板 — 点「新建模板」开始"
      />
      <div v-else class="tv-grid">
        <div
          v-for="t in templates.list"
          :key="t.id"
          class="tv-card"
          :style="{ viewTransitionName: `tpl-card-${t.id}` }"
          @click="openTemplate(t.id)"
        >
          <div class="tv-card-thumb">
            <FileText :size="32" :stroke-width="1.5" />
          </div>
          <div class="tv-card-body">
            <div class="tv-card-name">{{ t.name }}</div>
            <div class="tv-card-time">{{ formatTime(t.updatedAt) }}</div>
          </div>
          <button class="tv-card-del" title="删除模板" @click.stop="deleteTemplate(t.id, t.name)">
            <Trash2 :size="14" :stroke-width="2" />
          </button>
        </div>
      </div>
    </div>

    <!-- Editor mode -->
    <div v-else class="tv-editor-mode" :style="{ viewTransitionName: 'tpl-editor-host' }">
      <header class="tv-breadcrumb">
        <button class="tv-back" @click="returnToList">← 返回模板中心</button>
        <span class="tv-bc-sep">/</span>
        <span class="tv-bc-current">{{ currentTemplateName }}</span>
      </header>
      <div class="tv-editor-host">
        <DesignerView v-if="currentId" :template-id="currentId" :embedded="true" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.tv-wrap {
  padding: 32px 40px;
  max-width: 1400px;
  margin: 0 auto;
  min-height: 100%;
}
.tv-list {
  /* list mode keeps padding wrap */
}
/* Editor mode breaks out of max-width to fill */
.tv-wrap:has(.tv-editor-mode) {
  max-width: none;
  padding: 0;
}
.tv-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 24px;
}
.tv-title {
  font-size: 24px;
  font-weight: 600;
  color: var(--tp-ink, #1f1f23);
  margin: 0;
}
.tv-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 16px;
}
.tv-card {
  position: relative;
  background: #fff;
  border: 1px solid var(--tp-line, #ececef);
  border-radius: 12px;
  padding: 20px;
  cursor: pointer;
  transition: all 200ms cubic-bezier(0.4, 0, 0.2, 1);
}
.tv-card:hover {
  border-color: var(--tp-accent, #6c5ce7);
  box-shadow: 0 8px 24px rgba(108, 92, 231, 0.12);
  transform: translateY(-2px);
}
.tv-card-thumb {
  height: 80px;
  background: var(--tp-accent-bg, #f0eeff);
  border-radius: 8px;
  margin-bottom: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--tp-accent, #6c5ce7);
}
.tv-card-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--tp-ink, #1f1f23);
  margin-bottom: 4px;
}
.tv-card-time {
  font-size: 11px;
  color: var(--tp-ink-faint, #9c9ca3);
}
.tv-card-del {
  position: absolute;
  top: 8px;
  right: 8px;
  width: 26px;
  height: 26px;
  border: none;
  background: transparent;
  border-radius: 6px;
  cursor: pointer;
  color: var(--tp-ink-faint, #9c9ca3);
  opacity: 0;
  transition: all 120ms ease;
}
.tv-card:hover .tv-card-del {
  opacity: 1;
}
.tv-card-del:hover {
  background: #fee;
  color: #d94f4f;
}
.tv-loading {
  padding: 60px 0;
  text-align: center;
  color: var(--tp-ink-faint, #9c9ca3);
}
.tv-editor-mode {
  display: flex;
  flex-direction: column;
  height: 100%;
}
.tv-breadcrumb {
  padding: 12px 24px;
  background: #fff;
  border-bottom: 1px solid var(--tp-line, #ececef);
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--tp-ink-soft, #5e5e66);
}
.tv-back {
  background: transparent;
  border: none;
  cursor: pointer;
  color: var(--tp-accent, #6c5ce7);
  font-weight: 500;
  padding: 4px 8px;
  border-radius: 4px;
  transition: background 120ms ease;
}
.tv-back:hover {
  background: var(--tp-accent-bg, #f0eeff);
}
.tv-bc-sep {
  color: var(--tp-ink-faint, #9c9ca3);
}
.tv-bc-current {
  color: var(--tp-ink, #1f1f23);
  font-weight: 500;
}
.tv-editor-host {
  flex: 1;
  min-height: 0;
}
</style>
