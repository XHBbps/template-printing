// eslint-disable-next-line import/no-unresolved
import { ref } from 'vue';

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
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/uploads/image', {
        method: 'POST',
        body: fd,
        credentials: 'include',
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        error.value = body.message || `上传失败 (${res.status})`;
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
