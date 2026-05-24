// eslint-disable-next-line import/no-unresolved
import { describe, it, expect } from '@jest/globals';

import {
  buildSelectTemplateCard,
  buildFieldFormCard,
  buildRenderingCard,
  buildResultCard,
  // eslint-disable-next-line import/no-unresolved
} from '../src/lark/lark-bot-cards.js';

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
    const c = card as { elements: Array<{ tag: string; actions?: unknown[] }> };
    const action = c.elements.find((e) => e.tag === 'action');
    expect(action).toBeDefined();
    const select = (
      action as { actions: Array<{ tag: string; value: unknown; options: unknown[] }> }
    ).actions[0]!;
    expect(select.tag).toBe('select_static');
    expect(select.options).toHaveLength(2);
    expect(select.value).toEqual({ sessionId: 'sess_1', action: 'template_selected' });
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
    const c = card as { elements: Array<{ tag: string; actions?: unknown[] }> };
    const actions = c.elements.filter((e) => e.tag === 'action');
    // 1 action for the field, 1 action for the submit button
    expect(actions.length).toBeGreaterThanOrEqual(2);
    const enumAction = (actions[0] as { actions: Array<{ tag: string; options: unknown[] }> })
      .actions[0]!;
    expect(enumAction.tag).toBe('select_static');
    expect(enumAction.options).toHaveLength(2);
  });

  it('buildFieldFormCard renders boolean as select_static [是/否]', () => {
    const card = buildFieldFormCard({
      sessionId: 'sess_3',
      templateName: 'T',
      fields: [{ key: 'urgent', label: '紧急', type: 'boolean', required: false }],
      values: {},
    });
    const c = card as { elements: Array<{ tag: string; actions?: unknown[] }> };
    const action = c.elements.find((e) => e.tag === 'action');
    const sel = (action as { actions: Array<{ options: Array<{ value: string }> }> }).actions[0]!;
    expect(sel.options).toHaveLength(2);
    expect(sel.options.map((o) => o.value)).toEqual(['true', 'false']);
  });

  it('buildFieldFormCard renders string as input', () => {
    const card = buildFieldFormCard({
      sessionId: 'sess_4',
      templateName: 'T',
      fields: [{ key: 'name', label: '姓名', type: 'string', required: true, example: '张三' }],
      values: {},
    });
    const c = card as { elements: Array<{ tag: string }> };
    expect(c.elements.some((e) => e.tag === 'input')).toBe(true);
  });

  it('buildFieldFormCard renders date as date_picker', () => {
    const card = buildFieldFormCard({
      sessionId: 'sess_5',
      templateName: 'T',
      fields: [{ key: 'd', label: '日期', type: 'date', required: false }],
      values: {},
    });
    const c = card as { elements: Array<{ tag: string; actions?: unknown[] }> };
    const action = c.elements.find((e) => e.tag === 'action');
    const sel = (action as { actions: Array<{ tag: string }> }).actions[0]!;
    expect(sel.tag).toBe('date_picker');
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
});
