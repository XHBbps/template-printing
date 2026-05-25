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

export interface TemplateListQuery {
  page: number;
  pageSize: number;
  search: string;
  sort: 'updated' | 'name';
}

interface TemplateListResponse {
  items: TemplateListItem[];
  total: number;
  page: number;
  pageSize: number;
}

export const useTemplatesStore = defineStore('templates', {
  state: () => ({
    list: [] as TemplateListItem[],
    total: 0,
    loading: false,
    query: { page: 1, pageSize: 10, search: '', sort: 'updated' } as TemplateListQuery,
  }),
  actions: {
    /**
     * 服务端分页拉取当前页。传入的 params 会并入 query 状态，
     * 之后的增删改可直接 fetchList() 复用同一查询条件刷新当前页。
     */
    async fetchList(params?: Partial<TemplateListQuery>): Promise<void> {
      if (params) this.query = { ...this.query, ...params };
      this.loading = true;
      try {
        const qs = new URLSearchParams({
          page: String(this.query.page),
          pageSize: String(this.query.pageSize),
          sort: this.query.sort,
        });
        const search = this.query.search.trim();
        if (search) qs.set('search', search);
        const res = await apiFetch<TemplateListResponse>(`/templates?${qs.toString()}`);
        this.list = res.items;
        this.total = res.total;
      } finally {
        this.loading = false;
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
