// eslint-disable-next-line import/no-unresolved
import { describe, it, expect } from '@jest/globals';

import { sanitiseSvg } from '../src/uploads/svg-sanitiser';

const wrap = (inner: string) =>
  Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">${inner}</svg>`);

describe('sanitiseSvg', () => {
  it('keeps a clean svg', () => {
    const input = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="#000"/></svg>`,
    );
    const out = sanitiseSvg(input);
    expect(out).not.toBeNull();
    expect(out!.toString()).toContain('<rect');
  });

  it('strips <script>', () => {
    const input = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><rect/></svg>`,
    );
    const out = sanitiseSvg(input);
    expect(out!.toString()).not.toContain('<script');
  });

  it('strips on* event attrs', () => {
    const input = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><rect onclick="x"/></svg>`,
    );
    const out = sanitiseSvg(input);
    const s = out!.toString();
    expect(s).not.toContain('onload');
    expect(s).not.toContain('onclick');
  });

  it('strips <foreignObject>', () => {
    const input = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><body/></foreignObject></svg>`,
    );
    const out = sanitiseSvg(input);
    expect(out!.toString()).not.toContain('foreignObject');
  });

  it('strips <style> blocks', () => {
    const out = sanitiseSvg(
      wrap('<style>@import url(http://evil/x.css);</style><rect x="0" y="0"/>'),
    )!.toString('utf8');
    expect(out).not.toContain('<style');
    expect(out).not.toContain('@import');
  });

  it('drops data: scheme in href/xlink:href', () => {
    const out = sanitiseSvg(wrap('<image href="data:image/svg+xml,<svg/>"/>'))!.toString('utf8');
    expect(out).not.toContain('data:');
  });

  it('keeps a plain rect', () => {
    const out = sanitiseSvg(wrap('<rect x="0" y="0" width="5" height="5" fill="red"/>'))!.toString(
      'utf8',
    );
    expect(out).toContain('<rect');
  });

  it('returns null for non-svg', () => {
    const input = Buffer.from('not an svg');
    expect(sanitiseSvg(input)).toBeNull();
  });
});
