import { describe, it, expect } from 'vitest';

// eslint-disable-next-line import/no-unresolved
import { isValidTemplate } from '../src/schema-precheck.js';

// 最小合法 template.data（按 TemplateSchema）：id + meta.name + canvas
// （cols/rows/cell/paper）。schema/elements 有默认值，可省略。
const minimalValid = {
  id: 'tpl_1',
  meta: { name: '测试模板' },
  canvas: {
    cols: 12,
    rows: 16,
    cell: { w: 10, h: 10 },
    paper: 'A4',
  },
};

describe('isValidTemplate', () => {
  it('合法模板通过', () => {
    const ok = isValidTemplate(minimalValid);
    expect(ok.ok).toBe(true);
  });

  it('畸形结构拒绝', () => {
    expect(isValidTemplate({}).ok).toBe(false);
    expect(isValidTemplate({ canvas: {}, elements: 'x' }).ok).toBe(false);
    expect(isValidTemplate(null).ok).toBe(false);
  });
});
