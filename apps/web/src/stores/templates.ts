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

export const useTemplatesStore = defineStore('templates', {
  state: () => ({
    list: [] as TemplateListItem[],
    loading: false,
  }),
  actions: {
    async fetchList(): Promise<void> {
      this.loading = true;
      try {
        const items = await apiFetch<TemplateListItem[]>('/templates');
        this.list = items;
      } finally {
        this.loading = false;
      }
    },
    async create(name: string, data: unknown): Promise<TemplateListItem> {
      const created = await apiFetch<TemplateListItem>('/templates', {
        method: 'POST',
        body: JSON.stringify({ name, data }),
      });
      this.list.unshift(created);
      return created;
    },
    async remove(id: string): Promise<void> {
      await apiFetch<{ ok: true }>(`/templates/${id}`, { method: 'DELETE' });
      this.list = this.list.filter((t) => t.id !== id);
    },
  },
});
