export interface ApiError {
  ok: false;
  error: { code: string; message: string; details?: Record<string, unknown> };
}

export class ApiClientError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

let csrfTokenGetter: () => string | null = () => null;

export function setCsrfTokenGetter(fn: () => string | null): void {
  csrfTokenGetter = fn;
}

// Refresh callback registered by the auth store at boot time.
// Returns true if refresh succeeded and the original request should be retried.
let refreshOn401: () => Promise<boolean> = async () => false;

export function setRefreshOn401(fn: () => Promise<boolean>): void {
  refreshOn401 = fn;
}

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const doFetch = async (): Promise<Response> => {
    const headers = new Headers(init.headers ?? {});
    const method = (init.method ?? 'GET').toUpperCase();
    if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
      const csrf = csrfTokenGetter();
      if (csrf) headers.set('X-CSRF-Token', csrf);
    }
    if (init.body && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }
    return fetch(path.startsWith('/api') ? path : `/api${path}`, {
      ...init,
      headers,
      credentials: 'include',
    });
  };

  let res = await doFetch();

  // Auto-refresh + retry once on 401 (except for refresh / login / logout endpoints themselves
  // to avoid recursion loops).
  if (
    res.status === 401 &&
    !path.includes('/auth/refresh') &&
    !path.includes('/auth/logout') &&
    !path.includes('/auth/local/login')
  ) {
    const refreshed = await refreshOn401();
    if (refreshed) {
      res = await doFetch();
    }
  }

  const text = await res.text();
  const json = text ? JSON.parse(text) : ({} as unknown);
  if (!res.ok) {
    const err = json as ApiError;
    throw new ApiClientError(
      res.status,
      err.error?.code ?? 'ERROR',
      err.error?.message ?? res.statusText,
      err.error?.details,
    );
  }
  return json as T;
}
