/**
 * 飞书 Interactive Card v2 JSON 构造函数（纯函数，无副作用）。
 * 卡片 schema 参考：https://open.feishu.cn/document/uAjLw4CM/ukzMukzMukzM/feishu-cards/card-json-v2-structure
 */

export interface TemplateFieldMeta {
  key: string;
  label: string;
  type: 'string' | 'number' | 'boolean' | 'enum' | 'date' | 'datetime' | 'image' | 'array';
  required: boolean;
  example?: unknown;
  options?: Array<{ value: string; label: string }>;
}

interface BaseCardArgs {
  sessionId: string;
}

interface CardAction {
  sessionId: string;
  action: string;
  [key: string]: unknown;
}

function actionValue(v: CardAction): CardAction {
  return v;
}

// ----------------------------------------------------------------------------
// v1 — 选模板下拉
// ----------------------------------------------------------------------------
export function buildSelectTemplateCard(args: {
  sessionId: string;
  templates: Array<{ id: string; name: string }>;
}): object {
  const options = args.templates.map((t) => ({
    text: { tag: 'plain_text', content: `${t.name} (${t.id.slice(0, 8)}…)` },
    value: t.id,
  }));
  return {
    config: { wide_screen_mode: true },
    header: {
      title: { tag: 'plain_text', content: '🖨️ 模板渲染' },
      template: 'blue',
    },
    elements: [
      {
        tag: 'div',
        text: { tag: 'lark_md', content: '请选择要渲染的模板：' },
      },
      {
        tag: 'action',
        actions: [
          {
            tag: 'select_static',
            placeholder: { tag: 'plain_text', content: '点这里选模板…' },
            value: actionValue({ sessionId: args.sessionId, action: 'template_selected' }),
            options,
          },
        ],
      },
    ],
  };
}

// ----------------------------------------------------------------------------
// v2 — 字段表单 + 渲染按钮
// ----------------------------------------------------------------------------
export function buildFieldFormCard(args: {
  sessionId: string;
  templateName: string;
  fields: TemplateFieldMeta[];
  values: Record<string, unknown>;
}): object {
  const fieldElements = args.fields.flatMap((f) =>
    fieldToCardElement(args.sessionId, f, args.values[f.key]),
  );
  return {
    config: { wide_screen_mode: true },
    header: {
      title: { tag: 'plain_text', content: `📝 「${args.templateName}」填写字段` },
      template: 'blue',
    },
    elements: [
      ...(fieldElements.length > 0
        ? fieldElements
        : [{ tag: 'div', text: { tag: 'lark_md', content: '_该模板无可填字段，直接渲染即可_' } }]),
      { tag: 'hr' },
      {
        tag: 'action',
        actions: [
          {
            tag: 'button',
            text: { tag: 'plain_text', content: '🚀 开始渲染' },
            type: 'primary',
            value: actionValue({ sessionId: args.sessionId, action: 'submit_render' }),
          },
        ],
      },
    ],
  };
}

function fieldToCardElement(
  sessionId: string,
  field: TemplateFieldMeta,
  currentValue: unknown,
): object[] {
  const label = `**${field.label}**${field.required ? ' <font color="red">*</font>' : ''} \`${field.key}\``;
  const labelEl = { tag: 'div', text: { tag: 'lark_md', content: label } };

  const baseValue: CardAction = {
    sessionId,
    action: 'field_change',
    fieldKey: field.key,
  };

  // enum → select_static
  if (field.type === 'enum' && field.options) {
    return [
      labelEl,
      {
        tag: 'action',
        actions: [
          {
            tag: 'select_static',
            placeholder: { tag: 'plain_text', content: `选择 ${field.label}` },
            value: actionValue(baseValue),
            initial_option: typeof currentValue === 'string' ? currentValue : undefined,
            options: field.options.map((o) => ({
              text: { tag: 'plain_text', content: o.label },
              value: o.value,
            })),
          },
        ],
      },
    ];
  }

  // boolean → select_static [是/否]
  if (field.type === 'boolean') {
    return [
      labelEl,
      {
        tag: 'action',
        actions: [
          {
            tag: 'select_static',
            placeholder: { tag: 'plain_text', content: '是 / 否' },
            value: actionValue(baseValue),
            initial_option:
              currentValue === true ? 'true' : currentValue === false ? 'false' : undefined,
            options: [
              { text: { tag: 'plain_text', content: '是' }, value: 'true' },
              { text: { tag: 'plain_text', content: '否' }, value: 'false' },
            ],
          },
        ],
      },
    ];
  }

  // date / datetime → date_picker
  if (field.type === 'date' || field.type === 'datetime') {
    return [
      labelEl,
      {
        tag: 'action',
        actions: [
          {
            tag: 'date_picker',
            placeholder: { tag: 'plain_text', content: '选择日期' },
            value: actionValue(baseValue),
            initial_date: typeof currentValue === 'string' ? currentValue : undefined,
          },
        ],
      },
    ];
  }

  // image → not supported, show note
  if (field.type === 'image') {
    return [
      labelEl,
      {
        tag: 'div',
        text: {
          tag: 'lark_md',
          content: '_⚠️ 图片字段卡片暂不支持，渲染时该字段为空_',
        },
      },
    ];
  }

  // array → not supported, show note (rarely used)
  if (field.type === 'array') {
    return [
      labelEl,
      {
        tag: 'div',
        text: {
          tag: 'lark_md',
          content: '_⚠️ 数组字段卡片暂不支持，渲染时该字段为空_',
        },
      },
    ];
  }

  // string / number → input
  return [
    labelEl,
    {
      tag: 'input',
      placeholder: {
        tag: 'plain_text',
        content: field.example ? `如：${String(field.example)}` : `请填写 ${field.label}`,
      },
      value: actionValue(baseValue),
      default_value:
        typeof currentValue === 'string' || typeof currentValue === 'number'
          ? String(currentValue)
          : undefined,
    },
  ];
}

// ----------------------------------------------------------------------------
// v3 — 渲染中
// ----------------------------------------------------------------------------
export function buildRenderingCard(args: { jobId: string; templateName: string }): object {
  return {
    config: { wide_screen_mode: true },
    header: {
      title: { tag: 'plain_text', content: `⏳ 「${args.templateName}」渲染中` },
      template: 'yellow',
    },
    elements: [
      {
        tag: 'div',
        text: {
          tag: 'lark_md',
          content: `任务已入队，渲染完成后会 @ 你并发送 PDF。\n\n\`jobId: ${args.jobId}\``,
        },
      },
    ],
  };
}

// ----------------------------------------------------------------------------
// v4 — 完成 / 失败
// ----------------------------------------------------------------------------
export function buildResultCard(args: {
  templateName: string;
  status: 'done' | 'failed';
  errorMsg?: string;
}): object {
  if (args.status === 'done') {
    return {
      config: { wide_screen_mode: true },
      header: {
        title: { tag: 'plain_text', content: `✅ 「${args.templateName}」已完成` },
        template: 'green',
      },
      elements: [
        {
          tag: 'div',
          text: {
            tag: 'lark_md',
            content: 'PDF 已在本会话中发送，请查收。',
          },
        },
      ],
    };
  }
  return {
    config: { wide_screen_mode: true },
    header: {
      title: { tag: 'plain_text', content: `❌ 「${args.templateName}」渲染失败` },
      template: 'red',
    },
    elements: [
      {
        tag: 'div',
        text: {
          tag: 'lark_md',
          content: `失败原因：\`${args.errorMsg ?? '未知错误'}\``,
        },
      },
    ],
  };
}

// ----------------------------------------------------------------------------
// helpers (export for testing)
// ----------------------------------------------------------------------------
export const _internal = { fieldToCardElement };

// Mark unused to satisfy eslint when BaseCardArgs not directly referenced
void ({} as BaseCardArgs);
