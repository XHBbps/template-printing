// eslint-disable-next-line import/no-unresolved
import { describe, it, expect } from '@jest/globals';

import {
  buildSelectTemplateCard,
  buildFieldFormCard,
  buildRenderingCard,
  buildResultCard,
  // eslint-disable-next-line import/no-unresolved
} from '../src/lark/lark-bot-cards.js';

type CardV2 = {
  schema: string;
  body: { elements: Array<{ tag: string; [key: string]: unknown }> };
};

// 把 form 内的 elements 也展开到一个 flat 数组，方便测试搜索
function flattenElements(card: CardV2): Array<{ tag: string; [key: string]: unknown }> {
  const out: Array<{ tag: string; [key: string]: unknown }> = [];
  for (const el of card.body.elements) {
    const maybeForm = el as unknown as { elements?: unknown };
    if (el.tag === 'form' && Array.isArray(maybeForm.elements)) {
      out.push(el);
      const inner = maybeForm.elements as Array<{ tag: string; [key: string]: unknown }>;
      for (const x of inner) out.push(x);
    } else {
      out.push(el);
    }
  }
  return out;
}

describe('lark-bot-cards', () => {
  // -------------------- select template card --------------------

  it('buildSelectTemplateCard includes templates as options', () => {
    const card = buildSelectTemplateCard({
      sessionId: 'sess_1',
      templates: [
        { id: 'tpl-1234abcd-xxxxxxxxxxxxxxxxxxxxxxxx', name: '出门证' },
        { id: 'tpl-5678efgh-xxxxxxxxxxxxxxxxxxxxxxxx', name: '入库单' },
      ],
    });
    const c = card as CardV2;
    expect(c.schema).toBe('2.0');
    const select = flattenElements(c).find((e) => e.tag === 'select_static') as
      | { value: unknown; options: unknown[] }
      | undefined;
    expect(select).toBeDefined();
    expect(select!.options).toHaveLength(2);
    expect(select!.value).toEqual({ sessionId: 'sess_1', action: 'template_selected' });
  });

  // -------------------- field form card --------------------

  it('buildFieldFormCard renders enum as select_static with options', () => {
    const card = buildFieldFormCard({
      sessionId: 'sess_2',
      templateName: '出门证',
      fields: [
        {
          key: 'group',
          label: '事业群',
          type: 'enum',
          required: true,
          options: [
            { value: '扬机', label: 'yangji' },
            { value: '重机', label: 'zhongji' },
          ],
        },
      ],
      values: {},
    });
    const c = card as CardV2;
    const select = flattenElements(c).find((e) => e.tag === 'select_static') as
      | { options: unknown[] }
      | undefined;
    expect(select).toBeDefined();
    expect(select!.options).toHaveLength(2);
  });

  it('buildFieldFormCard renders boolean as select_static [是/否]', () => {
    const card = buildFieldFormCard({
      sessionId: 'sess_3',
      templateName: 'T',
      fields: [{ key: 'urgent', label: '紧急', type: 'boolean', required: false }],
      values: {},
    });
    const c = card as CardV2;
    const select = flattenElements(c).find((e) => e.tag === 'select_static') as
      | { options: Array<{ value: string }> }
      | undefined;
    expect(select).toBeDefined();
    expect(select!.options).toHaveLength(2);
    expect(select!.options.map((o) => o.value)).toEqual(['true', 'false']);
  });

  it('buildFieldFormCard renders string as input', () => {
    const card = buildFieldFormCard({
      sessionId: 'sess_4',
      templateName: 'T',
      fields: [{ key: 'name', label: '姓名', type: 'string', required: true, example: '张三' }],
      values: {},
    });
    const c = card as CardV2;
    expect(flattenElements(c).some((e) => e.tag === 'input')).toBe(true);
  });

  it('buildFieldFormCard renders date as date_picker', () => {
    const card = buildFieldFormCard({
      sessionId: 'sess_5',
      templateName: 'T',
      fields: [{ key: 'd', label: '日期', type: 'date', required: false }],
      values: {},
    });
    const c = card as CardV2;
    expect(flattenElements(c).some((e) => e.tag === 'date_picker')).toBe(true);
  });

  it('buildFieldFormCard image/array show "not supported" note', () => {
    const card = buildFieldFormCard({
      sessionId: 'sess_6',
      templateName: 'T',
      fields: [{ key: 'logo', label: 'Logo', type: 'image', required: false }],
      values: {},
    });
    const json = JSON.stringify(card);
    expect(json).toContain('不支持');
  });

  it('buildFieldFormCard empty fields shows fallback message', () => {
    const card = buildFieldFormCard({
      sessionId: 'sess_7',
      templateName: 'T',
      fields: [],
      values: {},
    });
    const json = JSON.stringify(card);
    expect(json).toContain('无可填字段');
  });

  it('buildFieldFormCard always has a submit button', () => {
    const card = buildFieldFormCard({
      sessionId: 'sess_submit',
      templateName: 'T',
      fields: [],
      values: {},
    });
    const c = card as CardV2;
    const btn = flattenElements(c).find((e) => e.tag === 'button');
    expect(btn).toBeDefined();
    const json = JSON.stringify(card);
    expect(json).toContain('submit_render');
    expect(json).toContain('开始渲染');
  });

  // -------------------- rendering card --------------------

  it('buildRenderingCard includes jobId', () => {
    const card = buildRenderingCard({ jobId: 'job_xyz', templateName: 'T' });
    const json = JSON.stringify(card);
    expect(json).toContain('job_xyz');
    expect(json).toContain('渲染中');
  });

  // -------------------- result card --------------------

  it('buildResultCard done variant shows success', () => {
    const card = buildResultCard({ templateName: 'T', status: 'done' });
    const json = JSON.stringify(card);
    expect(json).toContain('已完成');
    expect(json).toContain('green');
  });

  it('buildResultCard failed variant shows errorMsg', () => {
    const card = buildResultCard({
      templateName: 'T',
      status: 'failed',
      errorMsg: 'render timeout',
    });
    const json = JSON.stringify(card);
    expect(json).toContain('失败');
    expect(json).toContain('render timeout');
    expect(json).toContain('red');
  });

  // -------------------- v2 structure sanity --------------------

  it('all cards are v2 schema with body wrapper', () => {
    const cards = [
      buildSelectTemplateCard({ sessionId: 's', templates: [] }),
      buildFieldFormCard({ sessionId: 's', templateName: 'T', fields: [], values: {} }),
      buildRenderingCard({ jobId: 'j', templateName: 'T' }),
      buildResultCard({ templateName: 'T', status: 'done' }),
      buildResultCard({ templateName: 'T', status: 'failed', errorMsg: 'e' }),
    ];
    for (const c of cards) {
      const v2 = c as CardV2;
      expect(v2.schema).toBe('2.0');
      expect(Array.isArray(v2.body.elements)).toBe(true);
    }
  });
});
