// eslint-disable-next-line import/no-unresolved
import type { BorderSide, ElementStyle } from '@template-printing/schema';

const FONT_STACK: Record<'sans' | 'serif' | 'mono', string> = {
  sans: '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", system-ui, sans-serif',
  serif: 'Georgia, "Times New Roman", "Songti SC", serif',
  mono: 'ui-monospace, SFMono-Regular, Menlo, monospace',
};

function borderSideCss(side: BorderSide): string {
  if (!side.show) return 'none';
  return `${side.width}px ${side.style} ${side.color}`;
}

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
  if (s.rotation) out.transform = `rotate(${s.rotation}deg)`;
  if (s.opacity !== undefined) out.opacity = String(s.opacity);
  if (s.textOverflow === 'ellipsis') {
    out.whiteSpace = 'nowrap';
    out.overflow = 'hidden';
    out.textOverflow = 'ellipsis';
  } else if (s.textOverflow === 'clip') {
    out.overflow = 'hidden';
  }
  if (s.border) {
    out.borderTop = borderSideCss(s.border.top);
    out.borderRight = borderSideCss(s.border.right);
    out.borderBottom = borderSideCss(s.border.bottom);
    out.borderLeft = borderSideCss(s.border.left);
  }
  if (s.borderRadius) out.borderRadius = `${s.borderRadius}px`;
  return out;
}

export function verticalAlignToFlex(va?: ElementStyle['verticalAlign']): string {
  if (va === 'top') return 'flex-start';
  if (va === 'bottom') return 'flex-end';
  return 'center';
}

export function textAlignToJustify(ta?: ElementStyle['textAlign']): string {
  if (ta === 'left') return 'flex-start';
  if (ta === 'right') return 'flex-end';
  if (ta === 'center') return 'center';
  if (ta === 'justify') return 'space-between';
  return 'flex-start';
}
