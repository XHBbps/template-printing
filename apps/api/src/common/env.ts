// eslint-disable-next-line import/no-unresolved
import { z } from 'zod';

export const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),

  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),

  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 chars'),
  JWT_TTL_SECONDS: z.coerce.number().int().positive().default(86400), // 24h
  REFRESH_TTL_SECONDS: z.coerce.number().int().positive().default(2_592_000), // 30d
  FILE_SIG_SECRET: z.string().min(32, 'FILE_SIG_SECRET must be at least 32 chars'),

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

  // 逗号分隔的允许 Origin；生产必须显式设(如 https://print.example.com)。
  // 默认放行本地 dev web,避免本地开发要求设 env。
  CORS_ORIGIN: z.string().default('http://localhost:5173'),

  RENDER_BROWSERS: z.coerce.number().int().positive().default(4),
  RENDER_PAGES_PER_BROWSER: z.coerce.number().int().positive().default(2),

  // Lark Bitable 集成
  // 在飞书自动化 webhook body 里业务人员填同一值；也用作 /lark/render-callback URL query token
  LARK_BITABLE_VERIFICATION_TOKEN: z
    .string()
    .min(16, 'LARK_BITABLE_VERIFICATION_TOKEN must be at least 16 chars')
    .optional(),
  // render worker → /lark/render-callback 内部回调专用 secret(与外部飞书 webhook token 分离)
  RENDER_CALLBACK_SECRET: z
    .string()
    .min(16, 'RENDER_CALLBACK_SECRET must be at least 16 chars')
    .optional(),
  // Render worker 回调 api 时用的 base URL（docker 内部）。生产可指向 https://print.x.com
  API_INTERNAL_BASE: z.string().url().default('http://api:3000'),

  // Lark 机器人卡片交互（iter 28）
  // 飞书后台事件订阅 + 卡片回调共享 verification token
  LARK_BOT_VERIFICATION_TOKEN: z
    .string()
    .min(16, 'LARK_BOT_VERIFICATION_TOKEN must be at least 16 chars')
    .optional(),
  // 群里识别 @ 机器人时需要它（飞书后台 应用功能 → 机器人 → 概览 拿到 open_id 填入）
  LARK_BOT_OPEN_ID: z.string().optional(),
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
  const env = parsed.data;

  // 跨字段一致性校验:多个 secret 是 .optional(),漏配时静默退化(fail-open / 卡死),
  // 在启动期显式告警/阻断,避免"线上才发现回调永久 401 卡处理中 / 群消息被吞"。

  // 启用 bitable(配了 verification token)却没配回调 secret:render worker 回调 token 为空 →
  // 回调永久 401、LarkPrintRequest 卡 pending(处理中)无告警。生产视为硬错误阻断启动;
  // 非生产(dev/test)warn 即可(不阻断本地/测试 boot)。
  if (env.LARK_BITABLE_VERIFICATION_TOKEN && !env.RENDER_CALLBACK_SECRET) {
    const msg =
      'LARK_BITABLE_VERIFICATION_TOKEN is set (bitable enabled) but RENDER_CALLBACK_SECRET is missing — render worker callbacks would 401 and records would stay stuck in 处理中. Set RENDER_CALLBACK_SECRET.';
    if (env.NODE_ENV === 'production') {
      throw new Error(`Invalid environment configuration:\n  - ${msg}`);
    }
    // eslint-disable-next-line no-console
    console.warn(`[env] ${msg}`);
  }

  // 配了 bot verification token 却没配 bot open_id:群里 @ 机器人无法识别 → 静默吞掉全部群消息
  // (fail-closed 安全但无反应)。保持 fail-closed,启动期 warn 提醒补配。
  if (env.LARK_BOT_VERIFICATION_TOKEN && !env.LARK_BOT_OPEN_ID) {
    // eslint-disable-next-line no-console
    console.warn(
      '[env] LARK_BOT_VERIFICATION_TOKEN is set but LARK_BOT_OPEN_ID is missing — group @-mentions to the bot will be silently ignored. Set LARK_BOT_OPEN_ID to enable group triggers.',
    );
  }

  return env;
}
