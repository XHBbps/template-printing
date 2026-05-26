<script setup lang="ts">
// eslint-disable-next-line import/no-unresolved
import { ElDialog, ElMessage, ElScrollbar } from 'element-plus';
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
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import BrandPagination from '../components/BrandPagination.vue';
import ConfirmDialog from '../components/ConfirmDialog.vue';
import DesignerHeader from '../designer/DesignerHeader.vue';
import VersionDialog from '../designer/VersionDialog.vue';
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
  const t =
    gridItems.value.find((x) => x.id === currentId.value) ??
    listItems.value.find((x) => x.id === currentId.value);
  return t?.name ?? '未命名';
});

// Filter / sort / 视图状态
const searchQuery = ref('');
const categoryFilter = ref<string>('');
// 默认按创建时间倒序（稳定顺序）：保存模板不会改变其位置，避免每次保存后列表重排。
// 「最近编辑」(updated) 仍保留为可选项；红框「最近编辑」标识独立计算，不依赖列表排序。
const sortBy = ref<'updated' | 'name' | 'created'>('created');
const viewMode = ref<'grid' | 'list'>('grid');
const total = ref(0);

// —— 网格：分页。第 1 页 = 新建卡 + 9 个模板；第 2 页起每页 10 个、无新建卡 ——
const GRID_FIRST = 9;
const GRID_REST = 10;
const gridItems = ref<TemplateListItem[]>([]);
const gridPage = ref(1);
const gridPageCount = computed(() =>
  total.value <= GRID_FIRST ? 1 : 1 + Math.ceil((total.value - GRID_FIRST) / GRID_REST),
);

async function loadGridPage(p: number): Promise<void> {
  const offset = p === 1 ? 0 : GRID_FIRST + (p - 2) * GRID_REST;
  const limit = p === 1 ? GRID_FIRST : GRID_REST;
  const res = await templates.fetchSlice({
    offset,
    limit,
    search: searchQuery.value,
    sort: sortBy.value,
  });
  gridItems.value = res.items;
  total.value = res.total;
}

function onGridPageChange(p: number): void {
  gridPage.value = p;
  void loadGridPage(p);
}

// —— 列表：无限滚动。首批 = 新建卡 + 14 个模板（共 15 格）；之后每批 15 个模板 ——
const LIST_FIRST = 14;
const LIST_BATCH = 15;
const listItems = ref<TemplateListItem[]>([]);
const listLoadingMore = ref(false);
const listScrollRef = ref<InstanceType<typeof ElScrollbar> | null>(null);
const listHasMore = computed(() => listItems.value.length < total.value);

async function loadListInitial(): Promise<void> {
  const res = await templates.fetchSlice({
    offset: 0,
    limit: LIST_FIRST,
    search: searchQuery.value,
    sort: sortBy.value,
  });
  listItems.value = res.items;
  total.value = res.total;
}

async function loadListMore(): Promise<void> {
  if (listLoadingMore.value || !listHasMore.value) return;
  listLoadingMore.value = true;
  try {
    // silent：不切全局 loading，避免滚动容器被卸载重建导致滚动条回顶
    const res = await templates.fetchSlice(
      {
        offset: listItems.value.length,
        limit: LIST_BATCH,
        search: searchQuery.value,
        sort: sortBy.value,
      },
      { silent: true },
    );
    listItems.value = [...listItems.value, ...res.items];
    total.value = res.total;
  } finally {
    listLoadingMore.value = false;
  }
}

// 滚动到接近底部（96px 内）就拉下一批
function onListScroll(e: { scrollTop: number }): void {
  const wrap = listScrollRef.value?.wrapRef;
  if (!wrap) return;
  if (e.scrollTop + wrap.clientHeight >= wrap.scrollHeight - 96) void loadListMore();
}

// 「最近编辑」红框标识 —— 全局（当前筛选下）updatedAt 最大的那一个 id，
// 不按当前页计算，确保整个列表只有一张被标识、且就是最近保存的那张。
const recentId = ref<string | null>(null);
async function refreshRecentId(): Promise<void> {
  const res = await templates.fetchSlice(
    { offset: 0, limit: 1, search: searchQuery.value, sort: 'updated' },
    { silent: true },
  );
  recentId.value = res.items[0]?.id ?? null;
}

/** 刷新当前激活视图（首次进入 / 搜索 / 排序变化时回到起点）。 */
async function reloadActive(): Promise<void> {
  if (viewMode.value === 'grid') {
    gridPage.value = 1;
    await loadGridPage(1);
  } else {
    await loadListInitial();
  }
  await refreshRecentId();
}

/** 增删改后刷新：网格保持当前页（删空则回退一页），列表回到首批。 */
async function refreshAfterMutation(): Promise<void> {
  if (viewMode.value === 'grid') {
    await loadGridPage(gridPage.value);
    if (gridItems.value.length === 0 && gridPage.value > 1) {
      gridPage.value -= 1;
      await loadGridPage(gridPage.value);
    }
  } else {
    await loadListInitial();
  }
  await refreshRecentId();
}

// 搜索防抖 → 重拉当前视图
let searchTimer: number | null = null;
watch(searchQuery, () => {
  if (searchTimer) window.clearTimeout(searchTimer);
  searchTimer = window.setTimeout(() => void reloadActive(), 350);
});
watch(sortBy, () => void reloadActive());
watch(viewMode, () => void reloadActive());

// Wrap mode transitions with View Transitions API.
async function transitionTo(target: 'list' | 'editor', id?: string): Promise<void> {
  if (target === 'list') {
    await reloadActive();
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
  await reloadActive();
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

function versionLabel(t: TemplateListItem): string {
  if (t.publishedVersion == null) return '未发布';
  return t.hasUnpublishedChanges ? `V${t.publishedVersion} · 有改动` : `V${t.publishedVersion}`;
}

const versionDialogOpen = ref(false);

// ---- Delete confirm dialog ----
const deleteDialogOpen = ref(false);
const deleteTarget = ref<{ id: string; name: string } | null>(null);
const deleting = ref(false);

function deleteTemplate(id: string, name: string): void {
  deleteTarget.value = { id, name };
  deleteDialogOpen.value = true;
}

async function confirmDelete(): Promise<void> {
  const t = deleteTarget.value;
  if (!t) return;
  deleting.value = true;
  try {
    await templates.remove(t.id);
    await refreshAfterMutation();
    ElMessage.success('已删除');
    deleteDialogOpen.value = false;
  } catch {
    ElMessage.error('删除失败');
  } finally {
    deleting.value = false;
  }
}

// ---- Rename dialog state ----
const renameDialogOpen = ref(false);
const renameTarget = ref<TemplateListItem | null>(null);
const renameInput = ref('');
const renameSubmitting = ref(false);

function renameTemplate(t: TemplateListItem): void {
  renameTarget.value = t;
  renameInput.value = t.name;
  renameDialogOpen.value = true;
}

async function confirmRename(): Promise<void> {
  const t = renameTarget.value;
  if (!t) return;
  const next = renameInput.value.trim();
  if (!next) {
    ElMessage.warning('名字不能为空');
    return;
  }
  if (next === t.name) {
    renameDialogOpen.value = false;
    return;
  }
  renameSubmitting.value = true;
  try {
    await apiFetch(`/templates/${t.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ name: next }),
    });
    await refreshAfterMutation();
    ElMessage.success('已重命名');
    renameDialogOpen.value = false;
  } catch (e) {
    ElMessage.error(`重命名失败：${(e as Error).message}`);
  } finally {
    renameSubmitting.value = false;
  }
}

async function duplicateTemplate(t: TemplateListItem): Promise<void> {
  try {
    const full = await apiFetch<{ id: string; name: string; data: unknown }>(`/templates/${t.id}`);
    const copy = await templates.create(`${t.name} 副本`, full.data);
    await refreshAfterMutation();
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
  if (total.value === 0) return '0 OF 0';
  // 列表（无限滚动）：已加载 / 总数
  if (viewMode.value === 'list') return `${listItems.value.length} OF ${total.value}`;
  // 网格：当前页区间
  const from = gridPage.value === 1 ? 1 : GRID_FIRST + (gridPage.value - 2) * GRID_REST + 1;
  const span = gridPage.value === 1 ? GRID_FIRST : GRID_REST;
  const to = Math.min(from + span - 1, total.value);
  return `${from}–${to} OF ${total.value}`;
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
              <option value="created">创建时间</option>
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

          <!-- 网格视图：新建卡在第一排第一个（仅第 1 页），其余为当前页模板 -->
          <div v-else-if="viewMode === 'grid'" class="tpl-grid">
            <div v-if="gridPage === 1" class="tpl new" @click="createNew">
              <span class="plus">
                <Plus :size="16" :stroke-width="1.8" />
              </span>
              <span class="label">新建模板</span>
              <span class="hint">A4 · A5 · 标签纸</span>
            </div>

            <div
              v-for="t in gridItems"
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
                  <span>{{ versionLabel(t) }}</span>
                </span>
              </div>
            </div>
          </div>

          <!-- 列表视图：无限滚动，新建卡固定第一个，滚到底自动加载下一批 -->
          <div v-else class="tpl-list">
            <ElScrollbar ref="listScrollRef" max-height="660px" @scroll="onListScroll">
              <div class="tpl-row tpl-row--new" @click="createNew">
                <span class="plus">
                  <Plus :size="14" :stroke-width="1.8" />
                </span>
                <span class="label">新建模板</span>
                <span class="hint">A4 · A5 · 标签纸</span>
              </div>

              <div
                v-for="t in listItems"
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
                    <span>{{ versionLabel(t) }}</span>
                    <template v-if="t.id === recentId">
                      <span class="sep">·</span>
                      <span class="recent-text">最近编辑</span>
                    </template>
                  </div>
                </div>
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

              <div v-if="listLoadingMore" class="list-more-line">加载中…</div>
              <div v-else-if="!listHasMore && listItems.length > 0" class="list-more-line">
                已到底 · 共 {{ total }} 个
              </div>
            </ElScrollbar>
          </div>

          <!-- 分页：仅网格视图（列表为无限滚动） -->
          <div v-if="viewMode === 'grid' && !templates.loading" class="tv-pagination">
            <BrandPagination
              :current-page="gridPage"
              :total="total"
              :page-count="gridPageCount"
              @update:current-page="onGridPageChange"
            />
          </div>
        </div>
      </div>
    </template>

    <!-- ============ Editor mode ============ -->
    <div v-else class="tv-editor-mode" :style="{ viewTransitionName: 'tpl-editor-host' }">
      <header class="tv-breadcrumb">
        <button class="tv-back" type="button" @click="returnToList">← 返回模板中心</button>
        <span class="tv-bc-sep">/</span>
        <button
          class="tv-bc-current tv-bc-current--btn"
          type="button"
          @click="versionDialogOpen = true"
        >
          {{ currentTemplateName }}
        </button>
        <div class="tv-bc-spacer"></div>
        <DesignerHeader v-if="currentId" />
      </header>
      <div class="tv-editor-host">
        <DesignerView v-if="currentId" :template-id="currentId" :embedded="true" />
      </div>
      <VersionDialog v-if="currentId" v-model="versionDialogOpen" :template-id="currentId" />
    </div>

    <!-- ============ 删除模板 confirm ============ -->
    <ConfirmDialog
      v-model="deleteDialogOpen"
      variant="destructive"
      title="删除模板"
      cap="DELETE TEMPLATE"
      :body="
        deleteTarget
          ? `删除模板「${deleteTarget.name}」？此操作不可恢复，模板及其所有渲染历史将一并失去关联。`
          : ''
      "
      confirm-text="删除"
      :loading="deleting"
      @confirm="confirmDelete"
    />

    <!-- ============ 重命名 dialog ============ -->
    <ElDialog v-model="renameDialogOpen" title="重命名模板" width="420px" :append-to-body="true">
      <div class="rn-form">
        <label class="rn-lbl">请输入新名字 <span class="han">· New Name</span></label>
        <input
          v-model="renameInput"
          type="text"
          maxlength="80"
          autofocus
          @keyup.enter="confirmRename"
        />
      </div>
      <template #footer>
        <button class="btn btn-secondary sm" type="button" @click="renameDialogOpen = false">
          取消
        </button>
        <button
          class="btn btn-primary sm"
          type="button"
          :disabled="renameSubmitting"
          @click="confirmRename"
        >
          {{ renameSubmitting ? '保存中…' : '保存' }}
        </button>
      </template>
    </ElDialog>
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

/* 列表视图行内「最近编辑」文字标识（与 grid view 的 2px 红顶边互补） */
.row-meta .recent-text {
  font-family: var(--font-han);
  font-size: 11px;
  color: var(--yangli-red);
  letter-spacing: 0;
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

/* ============ 分页 ============ */
.tv-pagination {
  margin-top: 20px;
  display: flex;
  justify-content: center;
}

/* 列表无限滚动的底部状态行 */
.list-more-line {
  padding: 14px 16px;
  text-align: center;
  font-family: var(--font-mono);
  font-size: 11px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--fg-3);
}

/* ============ Rename dialog form ============ */
.rn-form {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.rn-lbl {
  font-family: var(--font-sans);
  font-size: 10.5px;
  font-weight: 500;
  letter-spacing: var(--tr-caption);
  text-transform: uppercase;
  color: var(--fg-3);
}
.rn-lbl .han {
  font-family: var(--font-han);
  font-weight: 400;
  letter-spacing: 0.02em;
  text-transform: none;
}
.rn-form input {
  width: 100%;
  height: 38px;
  padding: 0 12px;
  font-family: var(--font-han);
  font-size: 13px;
}

/* ============ Editor mode ============ */
.tv-editor-mode {
  display: flex;
  flex-direction: column;
  height: 100%;
}
.tv-breadcrumb {
  height: 64px;
  flex-shrink: 0;
  padding: 0 32px;
  background: var(--paper-white);
  border-bottom: 1px solid var(--stone);
  display: flex;
  align-items: center;
  gap: 8px;
  font-family: var(--font-han);
  font-size: 13px;
  color: var(--fg-2);
}
.tv-bc-spacer {
  flex: 1;
  min-width: 24px;
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
.tv-bc-current--btn {
  background: none;
  border: none;
  padding: 0;
  cursor: pointer;
  font: inherit;
  font-weight: 500;
  color: var(--ink);
  border-bottom: 1px solid transparent;
}
.tv-bc-current--btn:hover {
  color: var(--yangli-red);
  border-bottom-color: var(--yangli-red);
}
.tv-editor-host {
  flex: 1;
  min-height: 0;
}
</style>
