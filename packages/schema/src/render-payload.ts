// eslint-disable-next-line import/no-unresolved
import type { FieldDef } from './template.js'; // 仅类型,编译期擦除,不拖 runtime(zod 不进 web bundle)

export type RenderPayloadTarget = 'render' | 'bitable';

/** 单字段默认值:有 example(非空字符串)优先(按类型强转),否则类型占位。 */
function fieldValue(def: FieldDef): unknown {
  const ex = typeof def.example === 'string' ? def.example.trim() : '';
  const hasEx = ex !== '';
  switch (def.type) {
    case 'number': {
      if (hasEx) {
        const n = Number(ex);
        return Number.isFinite(n) ? n : 0;
      }
      return 0;
    }
    case 'boolean':
      return hasEx ? ex === 'true' : false;
    case 'date':
      return hasEx ? ex : '2026-01-01';
    case 'datetime':
      return hasEx ? ex : '2026-01-01 12:00';
    case 'enum':
      return hasEx ? ex : def.options[0]?.value ?? '';
    case 'image':
      return hasEx ? ex : 'https://example.com/sample.png';
    case 'array':
      return [];
    case 'string':
    default:
      return hasEx ? ex : '';
  }
}

/**
 * 按 target 生成默认请求体 JSON 文本(2-space)。data 键=字段 key,值由 def 推导。
 * 安全:占位均为字面字符串,永不含真 secret。
 */
export function buildRenderPayload(
  templateId: string | null | undefined,
  fields: Array<{ key: string; def: FieldDef }>,
  target: RenderPayloadTarget,
): string {
  const tid = (templateId ?? '').trim() || '<保存模板后获得>';
  const data: Record<string, unknown> = {};
  for (const f of fields) data[f.key] = fieldValue(f.def);
  const payload =
    target === 'bitable'
      ? {
          verificationToken: '<verificationToken>',
          templateId: tid,
          data,
          lark: {
            appToken: '<appToken>',
            tableId: '<tableId>',
            recordId: '<recordId>',
            statusField: '状态',
            attachmentField: '附件',
          },
        }
      : { templateId: tid, data, formats: ['pdf'] };
  return JSON.stringify(payload, null, 2);
}
