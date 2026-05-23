// eslint-disable-next-line import/no-unresolved
import sanitizeHtml from 'sanitize-html';

const ALLOWED_TAGS = [
  'svg',
  'g',
  'path',
  'rect',
  'circle',
  'ellipse',
  'line',
  'polyline',
  'polygon',
  'text',
  'tspan',
  'defs',
  'pattern',
  'mask',
  'clipPath',
  'linearGradient',
  'radialGradient',
  'stop',
  'filter',
  'feGaussianBlur',
  'feColorMatrix',
  'feComposite',
  'feOffset',
  'feMerge',
  'feMergeNode',
  'use',
  'symbol',
  'image',
  'title',
  'desc',
  'style',
  'marker',
];

const ALLOWED_ATTRS = [
  'xmlns',
  'xmlns:xlink',
  'viewBox',
  'width',
  'height',
  'preserveAspectRatio',
  'd',
  'x',
  'y',
  'x1',
  'y1',
  'x2',
  'y2',
  'cx',
  'cy',
  'r',
  'rx',
  'ry',
  'fill',
  'fill-rule',
  'fill-opacity',
  'stroke',
  'stroke-width',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-dasharray',
  'stroke-dashoffset',
  'stroke-opacity',
  'transform',
  'opacity',
  'clip-path',
  'mask',
  'filter',
  'style',
  'gradientUnits',
  'gradientTransform',
  'spreadMethod',
  'offset',
  'stop-color',
  'stop-opacity',
  'patternUnits',
  'patternTransform',
  'points',
  'href',
  'xlink:href',
  'id',
  'class',
  'font-family',
  'font-size',
  'font-weight',
  'text-anchor',
  'dx',
  'dy',
  'orient',
  'markerWidth',
  'markerHeight',
  'refX',
  'refY',
];

export function sanitiseSvg(input: Buffer): Buffer | null {
  const text = input.toString('utf8');
  if (!/<svg[\s>]/i.test(text)) return null;

  const cleaned = sanitizeHtml(text, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: { '*': ALLOWED_ATTRS },
    parser: { lowerCaseTags: false, lowerCaseAttributeNames: false, xmlMode: true },
    allowedSchemes: ['http', 'https', 'data'],
    allowedSchemesAppliedToAttributes: ['href', 'xlink:href'],
    transformTags: {
      svg: (tagName, attribs) => {
        const safe: Record<string, string> = {};
        for (const [k, v] of Object.entries(attribs)) {
          if (!/^on/i.test(k)) safe[k] = v;
        }
        return { tagName, attribs: safe };
      },
    },
  });
  return Buffer.from(cleaned, 'utf8');
}
