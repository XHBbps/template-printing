<script setup lang="ts">
// eslint-disable-next-line import/no-unresolved
import { ElButton, ElEmpty } from 'element-plus';
// eslint-disable-next-line import/no-unresolved
import { Plus, FileText } from 'lucide-vue-next';
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';

const router = useRouter();

interface TemplateItem {
  id: string;
  name: string;
  updatedAt: string;
}
const templates = ref<TemplateItem[]>([]);
const loading = ref(true);

onMounted(async () => {
  // TODO: 后端 templates 列表 API 还没实现 — 暂时返回空数组
  // 后续 iter 接入 GET /api/templates
  loading.value = false;
});

function newTemplate(): void {
  void router.push('/designer/new');
}

function openTemplate(id: string): void {
  void router.push(`/designer/${id}`);
}
</script>

<template>
  <div class="tv-wrap">
    <header class="tv-head">
      <h1 class="tv-title">模板中心</h1>
      <ElButton type="primary" size="large" @click="newTemplate">
        <Plus :size="14" :stroke-width="2" style="margin-right: 6px" />
        新建模板
      </ElButton>
    </header>

    <div v-if="loading" class="tv-loading">加载中…</div>
    <ElEmpty v-else-if="templates.length === 0" description="还没有模板 — 点「新建模板」开始" />
    <div v-else class="tv-grid">
      <div v-for="t in templates" :key="t.id" class="tv-card" @click="openTemplate(t.id)">
        <div class="tv-card-icon">
          <FileText :size="32" :stroke-width="1.5" />
        </div>
        <div class="tv-card-name">{{ t.name }}</div>
        <div class="tv-card-time">{{ t.updatedAt }}</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.tv-wrap {
  padding: 32px 40px;
  max-width: 1400px;
  margin: 0 auto;
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
  background: #fff;
  border: 1px solid var(--tp-line, #ececef);
  border-radius: 12px;
  padding: 20px;
  cursor: pointer;
  transition: all 160ms ease;
}
.tv-card:hover {
  border-color: var(--tp-accent, #6c5ce7);
  box-shadow: 0 8px 24px rgba(108, 92, 231, 0.1);
}
.tv-card-icon {
  color: var(--tp-accent, #6c5ce7);
  margin-bottom: 12px;
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
.tv-loading {
  padding: 60px 0;
  text-align: center;
  color: var(--tp-ink-faint, #9c9ca3);
}
</style>
