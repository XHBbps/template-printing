// eslint-disable-next-line import/no-unresolved
import { ref } from 'vue';

import { useAuthStore } from '../stores/auth';

export interface UploadResult {
  url: string;
  w_px: number;
  h_px: number;
  format: 'svg' | 'png' | 'jpeg';
  dpiWarning?: string;
}

export function useImageUpload() {
  const uploading = ref(false);
  const error = ref<string | null>(null);
  const lastResult = ref<UploadResult | null>(null);

  async function upload(file: File): Promise<UploadResult | null> {
    if (file.size > 5 * 1024 * 1024) {
      error.value = '文件超过 5MB';
      return null;
    }
    uploading.value = true;
    error.value = null;
    try {
      const auth = useAuthStore();
      const fd = new FormData();
      fd.append('file', file);
      // NOTE: 必须带 CSRF token —— 后端 CsrfGuard 拒绝非 GET 请求里缺失 X-CSRF-Token
      // 的会话。不能用 apiFetch，因为它会强制 Content-Type: application/json，
      // 破坏 multipart 自动边界生成。
      const headers: Record<string, string> = {};
      if (auth.csrf) headers['X-CSRF-Token'] = auth.csrf;
      const res = await fetch('/api/uploads/image', {
        method: 'POST',
        body: fd,
        credentials: 'include',
        headers,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        if (res.status === 401 || res.status === 403) {
          error.value = '登录已过期，请刷新页面重新登录';
        } else {
          error.value = body?.error?.message ?? body?.message ?? `上传失败 (${res.status})`;
        }
        return null;
      }
      const json = (await res.json()) as UploadResult;
      lastResult.value = json;
      return json;
    } catch (e) {
      error.value = (e as Error).message;
      return null;
    } finally {
      uploading.value = false;
    }
  }

  return { upload, uploading, error, lastResult };
}
