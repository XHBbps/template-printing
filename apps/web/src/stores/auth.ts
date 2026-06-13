// eslint-disable-next-line import/no-unresolved
import { defineStore } from 'pinia';

import { apiFetch, ApiClientError, setCsrfTokenGetter, setRefreshOn401 } from '../lib/api';
import { clearLarkAutoLoginMarkers, markLarkLogout } from '../lib/lark-auto-login';

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
  // F-#14:/auth/refresh 现同时返回 user,tryRefresh 不再二次 /users/me。
  user: AuthUser & { csrf: string };
}

export const useAuthStore = defineStore('auth', {
  state: () => ({
    user: null as AuthUser | null,
    csrf: null as string | null,
    loading: true,
    // True once the first boot hydrate() has settled (success or failure).
    // Used by AppShell to know the optimistic boot phase is over.
    hydrated: false,
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
        clearLarkAutoLoginMarkers(); // 登录成功:清退出抑制 / 防循环标记,恢复自动登入
      } catch (e) {
        if (e instanceof ApiClientError && e.status === 401) {
          await this.tryRefresh();
        } else {
          this.user = null;
          this.csrf = null;
        }
      } finally {
        this.loading = false;
        this.hydrated = true;
      }
    },
    async tryRefresh(): Promise<void> {
      try {
        // F-#14:/auth/refresh 直接带回 user(同 /users/me 的 shape),省一次往返。
        const { user } = await apiFetch<RefreshResponse>('/auth/refresh', { method: 'POST' });
        const { csrf, ...rest } = user;
        this.user = rest;
        this.csrf = csrf;
        clearLarkAutoLoginMarkers(); // 静默续期成功亦视为有会话:清标记
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
        markLarkLogout(); // user 置空前同步设退出标记:本会话内抑制飞书自动登入,免被秒登回
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
