// eslint-disable-next-line import/no-unresolved
import type { InjectionKey } from 'vue';

export interface RenderSettleCtx {
  /** 异步元件挂载/发起异步操作时 +1 */
  begin(): void;
  /** 异步元件结算(成功/失败)时 -1 */
  end(): void;
  /** 永久错误上报(非 designMode);reason 如 'barcode_invalid' / 'qr_invalid' / 'image_404' / 'render_error' */
  reportError(reason: string, detail?: string): void;
}

export const renderSettleKey: InjectionKey<RenderSettleCtx | null> = Symbol('tp-render-settle');
