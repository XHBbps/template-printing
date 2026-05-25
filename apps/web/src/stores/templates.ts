// eslint-disable-next-line import/no-unresolved
import { defineStore } from 'pinia';

import { apiFetch } from '../lib/api';

export interface TemplateListItem {
  id: string;
  name: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TemplateSliceParams {
  offset: number;
  limit: number;
  search: string;
  sort: 'updated' | 'name';
}

interface TemplateSliceResponse {
  items: TemplateListItem[];
  total: number;
  offset: number;
  limit: number;
}

export const useTemplatesStore = defineStore('templates', {
  state: () => ({
    loading: false,
  }),
  actions: {
    /**
     * 偏移分页取一段模板。网格按页换算 offset/limit；列表无限滚动按已加载数偏移。
     * 纯取数，不持有页码状态（由视图编排）。
     */
    async fetchSlice(
      params: TemplateSliceParams,
      opts?: { silent?: boolean },
    ): Promise<{ items: TemplateListItem[]; total: number }> {
      // silent：不切全局 loading（无限滚动加载下一批 / 取最近编辑标识时用，
      // 避免视图因 loading 切换卸载并重建滚动容器导致滚动条回顶）
      if (!opts?.silent) this.loading = true;
      try {
        const qs = new URLSearchParams({
          offset: String(params.offset),
          limit: String(params.limit),
          sort: params.sort,
        });
        const search = params.search.trim();
        if (search) qs.set('search', search);
        const res = await apiFetch<TemplateSliceResponse>(`/templates?${qs.toString()}`);
        return { items: res.items, total: res.total };
      } finally {
        if (!opts?.silent) this.loading = false;
      }
    },
    async create(name: string, data: unknown): Promise<TemplateListItem> {
      return apiFetch<TemplateListItem>('/templates', {
        method: 'POST',
        body: JSON.stringify({ name, data }),
      });
    },
    async remove(id: string): Promise<void> {
      await apiFetch<{ ok: true }>(`/templates/${id}`, { method: 'DELETE' });
    },
  },
});
