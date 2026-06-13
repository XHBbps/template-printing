// 飞书客户端内「免登」(收窄版):仅在飞书 / Lark 客户端内打开且无会话时,自动走
// 现有 Lark OAuth 直进工作区;外网浏览器维持「手动登录页」现状。纯前端,OAuth 回调
// 后端不动。两个 sessionStorage 标记保证安全:
//   - 退出抑制(LOGOUT_MARKER):用户主动登出后,本会话内不再自动登入,否则一登出就被秒登回。
//   - 防循环(ATTEMPT_MARKER):自动跳转前置位;若回跳后仍无会话(走到这里又见标记),
//     说明这轮 OAuth 失败,放弃自动跳、落登录页(账密 / emergency_admin 入口天然可用)。
// 两标记均在「登录成功」时清除,恢复后续自动登入能力。
import { buildLarkLoginUrl } from './auth-routes';

const LOGOUT_MARKER = 'tp_lark_logout';
const ATTEMPT_MARKER = 'tp_lark_auto_tried';

/** 是否在飞书 / Lark 客户端 webview 内打开(UA 含 Lark 或 Feishu)。 */
export function isFeishuClient(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /Lark|Feishu/i.test(navigator.userAgent || '');
}

// sessionStorage 在隐私模式 / 部分 webview 下读写会抛异常 —— 统一兜底为 null,
// 让整套免登优雅降级为「不自动登入」(用户落登录页手动登,不影响外网与账密入口)。
function getSession(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/**
 * 登出时同步调用(在 user 置空之前):置退出抑制标记,本会话内不再自动登入。
 * 必须先于清空用户态,避免「清空 → AppShell 监听到 user 变 null → 跳登录页 →
 * 自动登入」抢在标记之前发生而被秒登回。
 */
export function markLarkLogout(): void {
  getSession()?.setItem(LOGOUT_MARKER, '1');
}

/** 登录成功后调用:清掉退出抑制 + 防循环标记,恢复后续自动登入能力。 */
export function clearLarkAutoLoginMarkers(): void {
  const s = getSession();
  if (!s) return;
  s.removeItem(LOGOUT_MARKER);
  s.removeItem(ATTEMPT_MARKER);
}

/**
 * 飞书客户端内、无会话时尝试自动登入。
 *
 * 命中 → 发起到 Lark OAuth 的整页跳转并返回 true(调用方应停止后续「落 /login」逻辑);
 * 未命中 → 返回 false(调用方维持现状)。命中条件:在飞书客户端内 + 存储可用 +
 * 无退出抑制标记 + 本会话未自动尝试过(防循环)。
 *
 * @param continueTo OAuth 成功后回跳的站内路径(须以 '/' 开头,与后端 sanitizeContinue 对齐)。
 */
export function maybeStartLarkAutoLogin(continueTo: string): boolean {
  if (!isFeishuClient()) return false;
  const s = getSession();
  if (!s) return false;
  if (s.getItem(LOGOUT_MARKER)) return false; // 退出抑制:本会话内不自动登入
  if (s.getItem(ATTEMPT_MARKER)) return false; // 防循环:已试过且仍无会话 = 上轮 OAuth 失败
  s.setItem(ATTEMPT_MARKER, '1');
  window.location.assign(buildLarkLoginUrl(continueTo));
  return true;
}
