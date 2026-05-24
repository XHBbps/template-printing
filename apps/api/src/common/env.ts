// eslint-disable-next-line import/no-unresolved
import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),

  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),

  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 chars'),
  JWT_TTL_SECONDS: z.coerce.number().int().positive().default(86400), // 24h
  REFRESH_TTL_SECONDS: z.coerce.number().int().positive().default(2_592_000), // 30d
  FILE_SIG_SECRET: z.string().min(32, 'FILE_SIG_SECRET must be at least 32 chars'),
  MASTER_KEY: z.string().regex(/^[0-9a-fA-F]{64}$/, 'MASTER_KEY must be 64 hex chars (32 bytes)'),

  LARK_SSO_APP_ID: z.string().min(1),
  LARK_SSO_APP_SECRET: z.string().min(1),
  LARK_SSO_REDIRECT_URI: z.string().url(),
  LARK_API_BASE: z.string().url().default('https://open.feishu.cn'),
  LARK_PASSPORT_BASE: z.string().url().default('https://passport.feishu.cn'),
  LARK_ACCOUNTS_BASE: z.string().url().default('https://accounts.feishu.cn'),
  INITIAL_ADMIN_LARK_USER_IDS: z.string().default(''),

  INITIAL_ADMIN_LOCAL_USERNAME: z.string().default('emergency_admin'),
  INITIAL_ADMIN_LOCAL_PASSWORD: z.string().min(8).optional(),

  // Cookie domain for SSO — '' means use request host (default for local dev)
  COOKIE_DOMAIN: z.string().default(''),

  RENDER_BROWSERS: z.coerce.number().int().positive().default(4),
  RENDER_PAGES_PER_BROWSER: z.coerce.number().int().positive().default(2),

  // Lark Bitable 集成
  // 在飞书自动化 webhook body 里业务人员填同一值；也用作 /lark/render-callback URL query token
  LARK_BITABLE_VERIFICATION_TOKEN: z
    .string()
    .min(16, 'LARK_BITABLE_VERIFICATION_TOKEN must be at least 16 chars')
    .optional(),
  // Render worker 回调 api 时用的 base URL（docker 内部）。生产可指向 https://print.x.com
  API_INTERNAL_BASE: z.string().url().default('http://api:3000'),
});

export type Env = z.infer<typeof EnvSchema>;

export function validateEnv(): Env {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('\n  - ');
    throw new Error(`Invalid environment configuration:\n  - ${issues}`);
  }
  return parsed.data;
}
