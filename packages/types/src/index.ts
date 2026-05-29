// Foundational ID brands — prevents accidentally passing a TemplateId where a UserId is expected.
export type Brand<K, T> = K & { __brand: T };

export type UserId = Brand<string, 'UserId'>;
export type TemplateId = Brand<string, 'TemplateId'>;
export type PrintJobId = Brand<string, 'PrintJobId'>;
export type FileId = Brand<string, 'FileId'>;
export type ApiKeyId = Brand<string, 'ApiKeyId'>;

// User role enum
export const USER_ROLES = ['admin', 'user', 'emergency_admin'] as const;
export type UserRole = (typeof USER_ROLES)[number];

// Common API response wrapper
export interface ApiSuccess<T> {
  ok: true;
  data?: T;
  [key: string]: unknown;
}

export interface ApiError {
  ok: false;
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
    fieldErrors?: { path: string; code: string; message: string }[];
  };
}

export type ApiResponse<T> = ApiSuccess<T> | ApiError;
