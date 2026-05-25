<script setup lang="ts">
// eslint-disable-next-line import/no-unresolved
import { ElMessage, ElMessageBox } from 'element-plus';
// eslint-disable-next-line import/no-unresolved
import {
  Plus,
  FileText,
  Copy,
  Pencil,
  Trash2,
  LayoutGrid,
  List as ListIcon,
} from 'lucide-vue-next';
import { computed, nextTick, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import { apiFetch } from '../lib/api';
import { defaultTemplate } from '../stores/designer';
import { useTemplatesStore, type TemplateListItem } from '../stores/templates';
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

// Filter / sort state
const searchQuery = ref('');
const categoryFilter = ref<string>('');
const sortBy = ref<'updated' | 'name'>('updated');
const viewMode = ref<'grid' | 'list'>('grid');

const filteredList = computed<TemplateListItem[]>(() => {
  const q = searchQuery.value.trim().toLowerCase();
  let arr = q
    ? templates.list.filter(
        (t) => t.name.toLowerCase().includes(q) || t.id.toLowerCase().includes(q),
      )
    : [...templates.list];
  if (sortBy.value === 'name') {
    arr.sort((a, b) => a.name.localeCompare(b.name, 'zh'));
  } else {
    // updated DESC（最近编辑）
    arr.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }
  return arr;
});

// 列表中第一张（最近编辑）显示红色 featured rule
const recentId = computed(() => {
  if (sortBy.value !== 'updated') return null;
  return filteredList.value[0]?.id ?? null;
});

// Wrap mode transitions with View Transitions API.
async function transitionTo(target: 'list' | 'editor', id?: string): Promise<void> {
  if (target === 'list') {
    await templates.fetchList();
  }
  const doSwitch = async (): Promise<void> => {
    if (target === 'editor' && id) currentId.value = id;
    mode.value = target;
    if (target === 'list') currentId.value = null;
    await nextTick();
  };
  type ViewTransitionAPI = Document & {
    startViewTransition?: (cb: () => Promise<void> | void) => { finished: Promise<void> };
  };
  const doc = document as ViewTransitionAPI;
  if (typeof doc.startViewTransition === 'function') {
    await doc.startViewTransition(doSwitch).finished;
  } else {
    await doSwitch();
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
  const data = defaultTemplate();
  data.meta.name = '未命名模板';
  try {
    const tpl = await templates.create(data.meta.name, data);
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

async function renameTemplate(t: TemplateListItem): Promise<void> {
  let next: string;
  try {
    const result = await ElMessageBox.prompt('请输入新名字', '重命名模板', {
      inputValue: t.name,
      confirmButtonText: '保存',
      cancelButtonText: '取消',
      inputValidator: (v) => {
        if (!v || !v.trim()) return '名字不能为空';
        return true;
      },
    });
    next = result.value.trim();
  } catch {
    return;
  }
  if (next === t.name) return;
  try {
    await apiFetch(`/templates/${t.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ name: next }),
    });
    await templates.fetchList();
    ElMessage.success('已重命名');
  } catch (e) {
    ElMessage.error(`重命名失败：${(e as Error).message}`);
  }
}

async function duplicateTemplate(t: TemplateListItem): Promise<void> {
  try {
    const full = await apiFetch<{ id: string; name: string; data: unknown }>(`/templates/${t.id}`);
    const copy = await templates.create(`${t.name} 副本`, full.data);
    await templates.fetchList();
    ElMessage.success(`已复制为「${copy.name}」`);
  } catch (e) {
    ElMessage.error(`复制失败：${(e as Error).message}`);
  }
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function paperLabel(): string {
  // 暂时简化：所有模板缩略图标 A4 横（实际可从 template.data.canvas.paper 拿，但列表 API 不返完整 data）
  return 'A4 · 横';
}

const countLabel = computed(() => {
  const n = filteredList.value.length;
  const total = templates.list.length;
  if (n === total) return `${total} OF ${total}`;
  return `${n} OF ${total}`;
});
</script>

<template>
  <div class="tv-wrap" :class="{ 'in-editor': mode === 'editor' }">
    <!-- ============ List mode ============ -->
    <template v-if="mode === 'list'">
      <header class="page-bar">
        <div class="page-title">
          <span class="ico"><FileText :size="20" :stroke-width="1.5" /></span>
          模板中心
        </div>
        <div class="page-sub">TEMPLATES · 模板库</div>
      </header>

      <div class="page-body">
        <div class="tv-inner">
          <!-- 工具栏 -->
          <div class="toolbar">
            <div class="search">
              <input v-model="searchQuery" type="text" placeholder="搜索模板名 / ID..." />
            </div>

            <select v-model="categoryFilter">
              <option value="">全部分类</option>
              <option value="出货单">出货单</option>
              <option value="验收凭证">验收凭证</option>
              <option value="合格证">合格证</option>
              <option value="工艺卡">工艺卡</option>
            </select>

            <select v-model="sortBy">
              <option value="updated">最近编辑</option>
              <option value="name">名称 A → Z</option>
            </select>

            <div class="spacer"></div>

            <div class="view-switch">
              <button
                type="button"
                title="网格视图"
                :class="{ active: viewMode === 'grid' }"
                @click="viewMode = 'grid'"
              >
                <LayoutGrid :size="14" :stroke-width="1.6" />
              </button>
              <button
                type="button"
                title="列表视图"
                :class="{ active: viewMode === 'list' }"
                @click="viewMode = 'list'"
              >
                <ListIcon :size="14" :stroke-width="1.6" />
              </button>
            </div>
          </div>

          <!-- 计数行 -->
          <div class="count-row">
            <span class="han">{{ searchQuery ? '搜索结果' : '全部模板' }}</span>
            <span class="num">{{ countLabel }}</span>
            <span class="rule"></span>
          </div>

          <!-- 加载态 -->
          <div v-if="templates.loading" class="empty-line">加载中…</div>

          <!-- 网格视图 -->
          <div v-else-if="viewMode === 'grid'" class="tpl-grid">
            <div
              v-for="t in filteredList"
              :key="t.id"
              class="tpl"
              :class="{ recent: t.id === recentId }"
              :style="{ viewTransitionName: `tpl-card-${t.id}` }"
              @click="openTemplate(t.id)"
            >
              <div class="tpl-thumb">
                <span class="stamp">{{ paperLabel() }}</span>
              </div>
              <div class="tpl-actions">
                <button type="button" title="复制" @click.stop="duplicateTemplate(t)">
                  <Copy :size="12" :stroke-width="1.8" />
                </button>
                <button type="button" title="重命名" @click.stop="renameTemplate(t)">
                  <Pencil :size="12" :stroke-width="1.8" />
                </button>
                <button
                  type="button"
                  class="danger"
                  title="删除"
                  @click.stop="deleteTemplate(t.id, t.name)"
                >
                  <Trash2 :size="12" :stroke-width="1.8" />
                </button>
              </div>
              <div class="tpl-body">
                <span class="name">{{ t.name }}</span>
                <span class="meta">
                  <span>{{ formatDate(t.updatedAt) }}</span>
                  <span class="sep">·</span>
                  <span>V1 DRAFT</span>
                </span>
              </div>
            </div>

            <div class="tpl new" @click="createNew">
              <span class="plus">
                <Plus :size="16" :stroke-width="1.8" />
              </span>
              <span class="label">新建模板</span>
              <span class="hint">A4 · A5 · 标签纸</span>
            </div>
          </div>

          <!-- 列表视图 -->
          <div v-else class="tpl-list">
            <div
              v-for="t in filteredList"
              :key="t.id"
              class="tpl-row"
              :class="{ recent: t.id === recentId }"
              @click="openTemplate(t.id)"
            >
              <div class="row-thumb">
                <span class="stamp">{{ paperLabel() }}</span>
              </div>
              <div class="row-meta">
                <div class="name">{{ t.name }}</div>
                <div class="meta">
                  <span>{{ formatDate(t.updatedAt) }}</span>
                  <span class="sep">·</span>
                  <span>V1 DRAFT</span>
                </div>
              </div>
              <span v-if="t.id === recentId" class="row-tag">最近编辑</span>
              <div class="row-actions">
                <button type="button" title="复制" @click.stop="duplicateTemplate(t)">
                  <Copy :size="12" :stroke-width="1.8" />
                </button>
                <button type="button" title="重命名" @click.stop="renameTemplate(t)">
                  <Pencil :size="12" :stroke-width="1.8" />
                </button>
                <button
                  type="button"
                  class="danger"
                  title="删除"
                  @click.stop="deleteTemplate(t.id, t.name)"
                >
                  <Trash2 :size="12" :stroke-width="1.8" />
                </button>
              </div>
            </div>

            <div class="tpl-row tpl-row--new" @click="createNew">
              <span class="plus">
                <Plus :size="14" :stroke-width="1.8" />
              </span>
              <span class="label">新建模板</span>
              <span class="hint">A4 · A5 · 标签纸</span>
            </div>
          </div>
        </div>
      </div>
    </template>

    <!-- ============ Editor mode ============ -->
    <div v-else class="tv-editor-mode" :style="{ viewTransitionName: 'tpl-editor-host' }">
      <header class="tv-breadcrumb">
        <button class="tv-back" type="button" @click="returnToList">← 返回模板中心</button>
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
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}
.tv-wrap.in-editor {
  overflow: visible;
}

/* 替代 app-shell.css 的 .max — 让网格用更宽的最大宽度（vs 默认 1120） */
.tv-inner {
  max-width: 1600px;
  margin: 0 auto;
}

/* ============ Toolbar ============ */
.toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 18px 0 20px;
  margin-bottom: 4px;
  border-bottom: 1px solid var(--stone);
}
.toolbar .search {
  position: relative;
  width: 280px;
}
.toolbar .search input {
  width: 100%;
  padding: 8px 10px 8px 32px;
  border: 1px solid var(--stone);
  border-radius: var(--radius-1);
  font-family: var(--font-han);
  font-size: 13px;
  color: var(--ink);
  background: var(--paper-white)
    url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%238A8A8C' stroke-width='1.6'><circle cx='11' cy='11' r='7'/><path d='m21 21-4.3-4.3'/></svg>")
    no-repeat 9px center / 14px;
  outline: none;
}
.toolbar .search input:focus {
  border-color: var(--yangli-red);
  outline: 1px solid var(--yangli-red);
  outline-offset: -1px;
}
.toolbar select {
  height: 34px;
  padding: 0 32px 0 12px;
  border: 1px solid var(--stone);
  border-radius: var(--radius-1);
  font-family: var(--font-han);
  font-size: 13px;
  color: var(--ink);
  background-color: var(--paper-white);
  background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%238A8A8C' stroke-width='1.6'><path d='m6 9 6 6 6-6'/></svg>");
  background-repeat: no-repeat;
  background-position: right 10px center;
  background-size: 14px;
  appearance: none;
  outline: none;
}
.toolbar .spacer {
  flex: 1;
}

.view-switch {
  display: inline-flex;
  border: 1px solid var(--stone);
  border-radius: var(--radius-2);
  overflow: hidden;
}
.view-switch button {
  width: 34px;
  height: 34px;
  border: none;
  background: var(--paper-white);
  color: var(--fg-2);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-right: 1px solid var(--stone);
  transition: all var(--dur-fast) var(--ease-default);
}
.view-switch button:last-child {
  border-right: 0;
}
.view-switch button:hover {
  color: var(--ink);
}
.view-switch button.active {
  background: var(--ink);
  color: var(--paper-white);
}

/* ============ Count row ============ */
.count-row {
  display: flex;
  align-items: baseline;
  gap: 12px;
  padding: 18px 0 14px;
}
.count-row .han {
  font-family: var(--font-han);
  font-size: 14px;
  font-weight: 600;
  color: var(--ink);
}
.count-row .num {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--fg-3);
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
.count-row .rule {
  flex: 1;
  height: 1px;
  background: var(--stone);
}

.empty-line {
  padding: 60px 0;
  text-align: center;
  font-family: var(--font-han);
  color: var(--fg-3);
}

/* ============ Grid ============ */
.tpl-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 16px;
}

/* ============ Template card ============ */
.tpl {
  background: var(--paper-white);
  border: 1px solid var(--stone);
  border-radius: var(--radius-2);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  cursor: pointer;
  position: relative;
  transition: border-color var(--dur-base) var(--ease-default);
}
.tpl:hover {
  border-color: var(--yangli-graphite);
}
.tpl:hover .tpl-actions {
  opacity: 1;
}
.tpl.recent {
  border-top: 2px solid var(--yangli-red);
}

/* 缩略图 — A4 比例 + 内嵌 20px 网格的 paper 区域 */
.tpl-thumb {
  aspect-ratio: 4 / 3;
  background: var(--mist);
  border-bottom: 1px solid var(--stone);
  position: relative;
  overflow: hidden;
}
.tpl-thumb::before {
  content: '';
  position: absolute;
  inset: 16px;
  background:
    linear-gradient(to right, rgba(89, 87, 89, 0.1) 1px, transparent 1px) 0 0 / 20px 20px,
    linear-gradient(to bottom, rgba(89, 87, 89, 0.1) 1px, transparent 1px) 0 0 / 20px 20px,
    var(--paper-white);
  border: 1px solid var(--stone);
}
.tpl-thumb .stamp {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--fg-3);
  letter-spacing: 0.14em;
  text-transform: uppercase;
  z-index: 1;
}

/* hover 浮出的右上角动作按钮 */
.tpl-actions {
  position: absolute;
  top: 10px;
  right: 10px;
  display: flex;
  gap: 4px;
  opacity: 0;
  transition: opacity var(--dur-base) var(--ease-default);
  z-index: 2;
}
.tpl-actions button {
  width: 26px;
  height: 26px;
  border: 1px solid var(--stone);
  background: var(--paper-white);
  color: var(--fg-2);
  border-radius: var(--radius-1);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition:
    color var(--dur-fast) var(--ease-default),
    border-color var(--dur-fast) var(--ease-default);
}
.tpl-actions button:hover {
  color: var(--ink);
  border-color: var(--yangli-graphite);
}
.tpl-actions button.danger:hover {
  color: var(--yangli-red);
  border-color: var(--yangli-red);
}

.tpl-body {
  padding: 14px 16px 16px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.tpl-body .name {
  font-family: var(--font-han);
  font-size: 14px;
  font-weight: 600;
  color: var(--ink);
  letter-spacing: -0.005em;
}
.tpl-body .meta {
  display: flex;
  align-items: center;
  gap: 6px;
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--fg-3);
  letter-spacing: 0.02em;
}
.tpl-body .meta .sep {
  color: var(--stone);
}

/* ============ New template tile ============ */
.tpl.new {
  background: var(--paper-white);
  border: 1px dashed var(--stone);
  align-items: center;
  justify-content: center;
  padding: 24px;
  cursor: pointer;
  transition:
    border-color var(--dur-base) var(--ease-default),
    background var(--dur-base) var(--ease-default);
  min-height: 220px;
}
.tpl.new:hover {
  border-color: var(--yangli-red);
  background: var(--paper-white);
}
.tpl.new .plus {
  width: 36px;
  height: 36px;
  border: 1px solid var(--yangli-graphite);
  color: var(--ink);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 12px;
  border-radius: var(--radius-2);
  transition:
    background var(--dur-base) var(--ease-default),
    border-color var(--dur-base) var(--ease-default),
    color var(--dur-base) var(--ease-default);
}
.tpl.new:hover .plus {
  background: var(--yangli-red);
  border-color: var(--yangli-red);
  color: var(--paper-white);
}
.tpl.new .label {
  font-family: var(--font-han);
  font-size: 13.5px;
  font-weight: 500;
  color: var(--ink);
}
.tpl.new .hint {
  font-family: var(--font-mono);
  font-size: 10.5px;
  color: var(--fg-3);
  letter-spacing: 0.06em;
  text-transform: uppercase;
  margin-top: 4px;
}

/* ============ List view ============ */
.tpl-list {
  display: flex;
  flex-direction: column;
  background: var(--paper-white);
  border: 1px solid var(--stone);
  border-radius: var(--radius-2);
  overflow: hidden;
}
.tpl-row {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--stone);
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease-default);
  position: relative;
}
.tpl-row:last-child {
  border-bottom: 0;
}
.tpl-row:hover {
  background: var(--mist);
}
.tpl-row.recent::before {
  content: '';
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 2px;
  background: var(--yangli-red);
}

.row-thumb {
  width: 56px;
  height: 42px;
  background: var(--mist);
  border: 1px solid var(--stone);
  border-radius: var(--radius-1);
  position: relative;
  flex-shrink: 0;
  overflow: hidden;
}
.row-thumb::before {
  content: '';
  position: absolute;
  inset: 4px;
  background:
    linear-gradient(to right, rgba(89, 87, 89, 0.1) 1px, transparent 1px) 0 0 / 8px 8px,
    linear-gradient(to bottom, rgba(89, 87, 89, 0.1) 1px, transparent 1px) 0 0 / 8px 8px,
    var(--paper-white);
  border: 1px solid var(--stone);
}
.row-thumb .stamp {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  font-family: var(--font-mono);
  font-size: 8px;
  color: var(--fg-3);
  letter-spacing: 0.1em;
  text-transform: uppercase;
  z-index: 1;
}

.row-meta {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}
.row-meta .name {
  font-family: var(--font-han);
  font-size: 14px;
  font-weight: 600;
  color: var(--ink);
  letter-spacing: -0.005em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.row-meta .meta {
  display: flex;
  align-items: center;
  gap: 6px;
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--fg-3);
  letter-spacing: 0.02em;
}
.row-meta .meta .sep {
  color: var(--stone);
}

.row-tag {
  display: inline-flex;
  align-items: center;
  height: 22px;
  padding: 0 8px;
  font-family: var(--font-sans);
  font-size: 10.5px;
  font-weight: 500;
  letter-spacing: var(--tr-caption);
  text-transform: uppercase;
  color: var(--yangli-red);
  border: 1px solid var(--yangli-red);
  border-radius: 999px;
}

.row-actions {
  display: flex;
  gap: 4px;
}
.row-actions button {
  width: 28px;
  height: 28px;
  border: 1px solid var(--stone);
  background: var(--paper-white);
  color: var(--fg-2);
  border-radius: var(--radius-1);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition:
    color var(--dur-fast) var(--ease-default),
    border-color var(--dur-fast) var(--ease-default);
}
.row-actions button:hover {
  color: var(--ink);
  border-color: var(--yangli-graphite);
}
.row-actions button.danger:hover {
  color: var(--yangli-red);
  border-color: var(--yangli-red);
}

.tpl-row--new {
  justify-content: center;
  border-style: dashed;
  border-top: 1px dashed var(--stone);
  cursor: pointer;
  background: var(--paper-white);
  color: var(--fg-2);
}
.tpl-row--new:hover {
  background: var(--paper-white);
  color: var(--ink);
  border-top-color: var(--yangli-red);
}
.tpl-row--new .plus {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border: 1px solid var(--yangli-graphite);
  border-radius: var(--radius-2);
  color: var(--ink);
  transition: all var(--dur-fast) var(--ease-default);
}
.tpl-row--new:hover .plus {
  background: var(--yangli-red);
  border-color: var(--yangli-red);
  color: var(--paper-white);
}
.tpl-row--new .label {
  font-family: var(--font-han);
  font-size: 13.5px;
  font-weight: 500;
  color: var(--ink);
}
.tpl-row--new .hint {
  font-family: var(--font-mono);
  font-size: 10.5px;
  color: var(--fg-3);
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

/* ============ Editor mode ============ */
.tv-editor-mode {
  display: flex;
  flex-direction: column;
  height: 100%;
}
.tv-breadcrumb {
  padding: 12px 24px;
  background: var(--paper-white);
  border-bottom: 1px solid var(--stone);
  display: flex;
  align-items: center;
  gap: 8px;
  font-family: var(--font-han);
  font-size: 13px;
  color: var(--fg-2);
}
.tv-back {
  background: transparent;
  border: none;
  cursor: pointer;
  color: var(--fg-2);
  font-family: var(--font-han);
  font-size: 13px;
  padding: 4px 8px;
  border-radius: var(--radius-2);
  transition: color var(--dur-fast) var(--ease-default);
}
.tv-back:hover {
  color: var(--yangli-red);
}
.tv-bc-sep {
  color: var(--stone);
}
.tv-bc-current {
  color: var(--ink);
  font-weight: 500;
}
.tv-editor-host {
  flex: 1;
  min-height: 0;
}
</style>
