// eslint-disable-next-line import/no-unresolved
import { TemplateSchema } from '@template-printing/schema/template';

export function isValidTemplate(data: unknown): { ok: true } | { ok: false; reason: string } {
  const r = TemplateSchema.safeParse(data);
  if (r.success) return { ok: true };
  const first = r.error.issues[0];
  return {
    ok: false,
    reason: first ? `${first.path.join('.')}: ${first.message}` : 'schema_invalid',
  };
}
