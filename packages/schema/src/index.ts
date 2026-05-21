import { USER_ROLES } from '@template-printing/types';
import { z } from 'zod';

export const UserRoleSchema = z.enum(USER_ROLES);
export type UserRole = z.infer<typeof UserRoleSchema>;

const FieldErrorSchema = z.object({
  path: z.string(),
  code: z.string(),
  message: z.string(),
});

export const ApiErrorSchema = z.object({
  ok: z.literal(false),
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.record(z.unknown()).optional(),
    fieldErrors: z.array(FieldErrorSchema).optional(),
  }),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;
