import { describe, it, expect } from 'vitest';

// eslint-disable-next-line import/no-unresolved
import { buildRenderPayload } from '../src/render-payload.js';
import type { FieldDef } from '../src/template.js';
// eslint-disable-next-line import/no-unresolved

function fd(o: Record<string, unknown>): FieldDef {
  return o as unknown as FieldDef;
}
const f = (key: string, def: Record<string, unknown>): { key: string; def: FieldDef } => ({
  key,
  def: fd(def),
});

describe('buildRenderPayload', () => {
  it('render target:结构为 {templateId, data, formats:["pdf"]}', () => {
    const json = buildRenderPayload(
      'tpl-1',
      [f('name', { type: 'string', example: '孔鸣' })],
      'render',
    );
    expect(JSON.parse(json)).toEqual({
      templateId: 'tpl-1',
      data: { name: '孔鸣' },
      formats: ['pdf'],
    });
  });

  it('bitable target:含 verificationToken 占位 + lark 块', () => {
    const o = JSON.parse(buildRenderPayload('tpl-1', [], 'bitable'));
    expect(o.verificationToken).toBe('<verificationToken>');
    expect(o.templateId).toBe('tpl-1');
    expect(o.data).toEqual({});
    expect(o.lark).toEqual({
      appToken: '<appToken>',
      tableId: '<tableId>',
      recordId: '<recordId>',
      statusField: '状态',
      attachmentField: '附件',
    });
  });

  it('各类型占位(无 example)', () => {
    const fields = [
      f('s', { type: 'string' }),
      f('n', { type: 'number' }),
      f('b', { type: 'boolean' }),
      f('d', { type: 'date' }),
      f('dt', { type: 'datetime' }),
      f('e', {
        type: 'enum',
        options: [
          { value: 'A', label: '甲' },
          { value: 'B', label: '乙' },
        ],
      }),
      f('img', { type: 'image' }),
      f('arr', { type: 'array' }),
    ];
    const o = JSON.parse(buildRenderPayload('t', fields, 'render'));
    expect(o.data).toEqual({
      s: '',
      n: 0,
      b: false,
      d: '2026-01-01',
      dt: '2026-01-01 12:00',
      e: 'A',
      img: 'https://example.com/sample.png',
      arr: [],
    });
  });

  it('example 优先 + number NaN guard', () => {
    const fields = [
      f('n1', { type: 'number', example: '50' }),
      f('n2', { type: 'number', example: 'abc' }),
      f('n3', { type: 'number', example: '' }),
      f('bt', { type: 'boolean', example: 'true' }),
      f('dd', { type: 'date', example: '2026-05-29' }),
    ];
    const o = JSON.parse(buildRenderPayload('t', fields, 'render'));
    expect(o.data).toEqual({ n1: 50, n2: 0, n3: 0, bt: true, dd: '2026-05-29' });
  });

  it('未保存模板(templateId 空)→ 占位字符串', () => {
    expect(JSON.parse(buildRenderPayload(null, [], 'render')).templateId).toBe('<保存模板后获得>');
  });
});
