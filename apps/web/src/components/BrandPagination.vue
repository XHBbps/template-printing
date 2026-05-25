<script setup lang="ts">
/* eslint-disable import/no-unresolved */
import { ElPagination } from 'element-plus';
import { ChevronsLeft, ChevronsRight } from 'lucide-vue-next';
/* eslint-enable import/no-unresolved */
import { computed } from 'vue';

/**
 * 全站统一翻页组件：包装 element-plus ElPagination，
 * 补「首页 / 末页」直达按钮，主色覆盖为扬力红（禁默认蓝），单页时自动隐藏。
 *
 * 用法：
 *   <BrandPagination v-model:current-page="page" :total="total" :page-size="20" />
 *   <BrandPagination v-model:current-page="page" :total="total" :page-count="customCount" />
 */
const props = withDefaults(
  defineProps<{
    currentPage: number;
    total?: number;
    pageSize?: number;
    /** 显式总页数（非均匀分页场景）；给定时优先于 total/pageSize 推导 */
    pageCount?: number;
  }>(),
  { total: 0, pageSize: 10, pageCount: undefined },
);
const emit = defineEmits<{ 'update:current-page': [value: number] }>();

const effectivePageCount = computed(() =>
  props.pageCount != null
    ? Math.max(1, props.pageCount)
    : Math.max(1, Math.ceil((props.total ?? 0) / Math.max(props.pageSize ?? 10, 1))),
);

function go(p: number): void {
  const next = Math.min(Math.max(p, 1), effectivePageCount.value);
  if (next !== props.currentPage) emit('update:current-page', next);
}
</script>

<template>
  <div v-if="effectivePageCount > 1" class="brand-pager">
    <button class="bp-edge" type="button" title="首页" :disabled="currentPage <= 1" @click="go(1)">
      <ChevronsLeft :size="15" :stroke-width="1.7" />
    </button>
    <ElPagination
      :current-page="currentPage"
      :page-count="effectivePageCount"
      :total="total"
      background
      layout="prev, pager, next, total"
      @current-change="go"
    />
    <button
      class="bp-edge"
      type="button"
      title="末页"
      :disabled="currentPage >= effectivePageCount"
      @click="go(effectivePageCount)"
    >
      <ChevronsRight :size="15" :stroke-width="1.7" />
    </button>
  </div>
</template>

<style scoped>
.brand-pager {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  /* element-plus 默认蓝主色 → 扬力红（激活页码 / hover），符合品牌禁蓝 */
  --el-color-primary: var(--yangli-red);
}

/* 首页 / 末页 直达按钮 —— 与 el-pagination 的 background 按钮等高同风格 */
.bp-edge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 28px;
  padding: 0;
  border: none;
  border-radius: var(--radius-1);
  background: var(--mist);
  color: var(--fg-2);
  cursor: pointer;
  transition:
    color var(--dur-fast) var(--ease-default),
    background var(--dur-fast) var(--ease-default);
}
.bp-edge:hover:not(:disabled) {
  color: var(--yangli-red);
}
.bp-edge:disabled {
  color: var(--fg-3);
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
