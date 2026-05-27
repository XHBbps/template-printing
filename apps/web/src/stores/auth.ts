// eslint-disable-next-line import/no-unresolved
import { defineStore } from 'pinia';

import { apiFetch, ApiClientError, setCsrfTokenGetter, setRefreshOn401 } from '../lib/api';

export interface AuthUser {
  id: string;
  name: string | null;
  email: string | null;
  avatarUrl: string | null;
  role: 'admin' | 'user' | 'emergency_admin';
  mustChangePassword: boolean;
  larkUserId?: string | null;
  hasLocalPassword?: boolean;
  localUsername?: string | null;
  mobile?: string | null;
  externalCode?: string | null;
  isInternal?: boolean;
}

interface MeResponse {
  ok: true;
  user: AuthUser & { csrf: string };
}

interface LocalLoginResponse {
  ok: true;
  csrf: string;
  mustChangePassword: boolean;
}

interface RefreshResponse {
  ok: true;
  csrf: string;
}

export const useAuthStore = defineStore('auth', {
  state: () => ({
    user: null as AuthUser | null,
    csrf: null as string | null,
    loading: true,
  }),
  getters: {
    isAuthenticated: (s): boolean => s.user !== null,
  },
  actions: {
    async hydrate(): Promise<void> {
      this.loading = true;
      try {
        const { user } = await apiFetch<MeResponse>('/users/me');
        const { csrf, ...rest } = user;
        this.user = rest;
        this.csrf = csrf;
      } catch (e) {
        if (e instanceof ApiClientError && e.status === 401) {
          await this.tryRefresh();
        } else {
          this.user = null;
          this.csrf = null;
        }
      } finally {
        this.loading = false;
      }
    },
    async tryRefresh(): Promise<void> {
      try {
        const { csrf } = await apiFetch<RefreshResponse>('/auth/refresh', { method: 'POST' });
        this.csrf = csrf;
        const { user } = await apiFetch<MeResponse>('/users/me');
        const { csrf: csrf2, ...rest } = user;
        this.user = rest;
        this.csrf = csrf2;
      } catch {
        this.user = null;
        this.csrf = null;
      }
    },
    setLocalLoginResult(r: LocalLoginResponse, fetchUserAfter = true): Promise<void> {
      this.csrf = r.csrf;
      if (fetchUserAfter) return this.hydrate();
      return Promise.resolve();
    },
    async logout(): Promise<void> {
      try {
        await apiFetch('/auth/logout', { method: 'POST' });
      } finally {
        this.user = null;
        this.csrf = null;
      }
    },
  },
});

export function installCsrfHook(): void {
  setCsrfTokenGetter(() => useAuthStore().csrf);
  setRefreshOn401(async () => {
    const auth = useAuthStore();
    // Don't recurse if not previously authenticated (no point refreshing when never logged in)
    if (!auth.user) return false;
    try {
      await auth.tryRefresh();
      return auth.user !== null;
    } catch {
      return false;
    }
  });
}
