// eslint-disable-next-line import/no-unresolved
import type { ElementStyle } from '@template-printing/schema';

const FONT_STACK: Record<string, string> = {
  sans: '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", system-ui, sans-serif',
  serif: 'Georgia, "Times New Roman", "Songti SC", serif',
  mono: 'ui-monospace, SFMono-Regular, Menlo, monospace',
};

export function styleToCss(s: ElementStyle): Record<string, string> {
  const out: Record<string, string> = {};
  if (s.color) out.color = s.color;
  if (s.fontFamily) out.fontFamily = FONT_STACK[s.fontFamily];
  if (s.fontSize) out.fontSize = `${s.fontSize}px`;
  if (s.fontWeight) out.fontWeight = String(s.fontWeight);
  if (s.letterSpacing !== undefined) out.letterSpacing = `${s.letterSpacing}px`;
  if (s.lineHeight !== undefined) out.lineHeight = String(s.lineHeight);
  if (s.textDecoration && s.textDecoration !== 'none') out.textDecoration = s.textDecoration;
  if (s.backgroundColor) out.backgroundColor = s.backgroundColor;
  if (s.textAlign && s.textAlign !== 'default') out.textAlign = s.textAlign;
  if (s.zIndex !== undefined) out.zIndex = String(s.zIndex);
  if (s.rotation) out.transform = `rotate(${s.rotation}deg)`;
  if (s.opacity !== undefined) out.opacity = String(s.opacity);
  if (s.textOverflow === 'ellipsis') {
    out.whiteSpace = 'nowrap';
    out.overflow = 'hidden';
    out.textOverflow = 'ellipsis';
  } else if (s.textOverflow === 'clip') {
    out.overflow = 'hidden';
  }
  return out;
}

export function verticalAlignToFlex(va?: ElementStyle['verticalAlign']): string {
  if (va === 'top') return 'flex-start';
  if (va === 'bottom') return 'flex-end';
  return 'center';
}
