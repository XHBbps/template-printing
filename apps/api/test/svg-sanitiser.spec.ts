import { sanitiseSvg } from '../src/uploads/svg-sanitiser';

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

  it('returns null for non-svg', () => {
    const input = Buffer.from('not an svg');
    expect(sanitiseSvg(input)).toBeNull();
  });
});
