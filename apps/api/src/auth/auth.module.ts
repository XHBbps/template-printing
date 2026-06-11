// eslint-disable-next-line import/no-unresolved
import { Module, type Provider } from '@nestjs/common';
// eslint-disable-next-line import/no-unresolved
import { APP_GUARD } from '@nestjs/core';
// eslint-disable-next-line import/no-unresolved
import { PrismaClient } from '@prisma/client';

// eslint-disable-next-line import/no-unresolved
import { validateEnv } from '../common/env.js';
// eslint-disable-next-line import/no-unresolved
import { PrismaService } from '../prisma/prisma.service.js';

// eslint-disable-next-line import/no-unresolved
import { ApiTokenController } from './api-token/api-token.controller.js';
// eslint-disable-next-line import/no-unresolved
import { ApiTokenService } from './api-token/api-token.service.js';
// eslint-disable-next-line import/no-unresolved
import { EmergencyAdminBootstrap } from './bootstrap/emergency-admin.bootstrap.js';
// eslint-disable-next-line import/no-unresolved
import { AuthController } from './controllers/auth.controller.js';
// eslint-disable-next-line import/no-unresolved
import { MeController } from './controllers/me.controller.js';
// eslint-disable-next-line import/no-unresolved
import { CsrfGuard } from './guards/csrf.guard.js';
// eslint-disable-next-line import/no-unresolved
import { JwtAuthGuard } from './guards/jwt-auth.guard.js';
// eslint-disable-next-line import/no-unresolved
import { RolesGuard } from './guards/roles.guard.js';
// eslint-disable-next-line import/no-unresolved
import type { CookieEnv } from './jwt/jwt-cookie.helper.js';
// eslint-disable-next-line import/no-unresolved
import { JwtAuthService } from './jwt/jwt.service.js';
// eslint-disable-next-line import/no-unresolved
import { RefreshTokenService } from './jwt/refresh-token.service.js';
// eslint-disable-next-line import/no-unresolved
import { LarkController } from './lark/lark.controller.js';
// eslint-disable-next-line import/no-unresolved
import { LarkService } from './lark/lark.service.js';
// eslint-disable-next-line import/no-unresolved
import { LocalController } from './local/local.controller.js';
// eslint-disable-next-line import/no-unresolved
import { UserStateService } from './user-state.service.js';

const env = validateEnv();

const cookieEnv: CookieEnv = {
  // 按部署形态(对外 URL 协议)而非 NODE_ENV 决定 cookie 安全属性:
  // http 部署(内网 ip,无证书)下 Secure / SameSite=None 会被浏览器拒存 → 登录态存不住;
  // 将来切 https(证书就位)redirect URI 改 https 即自动回到 None+Secure。
  secure: env.LARK_SSO_REDIRECT_URI.startsWith('https:'),
  cookieDomain: env.COOKIE_DOMAIN,
  accessTtlSeconds: env.JWT_TTL_SECONDS,
  refreshTtlSeconds: env.REFRESH_TTL_SECONDS,
};

const providers: Provider[] = [
  {
    provide: JwtAuthService,
    useFactory: (): JwtAuthService => new JwtAuthService(env.JWT_SECRET, env.JWT_TTL_SECONDS),
  },
  {
    provide: RefreshTokenService,
    useFactory: (prisma: PrismaService): RefreshTokenService =>
      new RefreshTokenService(prisma, env.REFRESH_TTL_SECONDS),
    inject: [PrismaService],
  },
  {
    provide: LarkService,
    useFactory: (): LarkService =>
      new LarkService({
        appId: env.LARK_SSO_APP_ID,
        appSecret: env.LARK_SSO_APP_SECRET,
        passportBase: env.LARK_PASSPORT_BASE,
        openBase: env.LARK_API_BASE,
        accountsBase: env.LARK_ACCOUNTS_BASE,
      }),
  },
  {
    provide: 'LARK_CONFIG',
    useValue: {
      redirectUri: env.LARK_SSO_REDIRECT_URI,
      initialAdminLarkUserIds: env.INITIAL_ADMIN_LARK_USER_IDS
        ? env.INITIAL_ADMIN_LARK_USER_IDS.split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        : [],
      cookieEnv,
    },
  },
  { provide: 'COOKIE_ENV', useValue: cookieEnv },
  // Provide PrismaClient as a class token too (since some constructors use PrismaClient typing directly)
  { provide: PrismaClient, useExisting: PrismaService },
  ApiTokenService,
  {
    provide: EmergencyAdminBootstrap,
    useFactory: (prisma: PrismaService): EmergencyAdminBootstrap =>
      new EmergencyAdminBootstrap(prisma, {
        username: env.INITIAL_ADMIN_LOCAL_USERNAME,
        password: env.INITIAL_ADMIN_LOCAL_PASSWORD,
      }),
    inject: [PrismaService],
  },
  // Global guards: JWT first, then CSRF, then Roles
  { provide: APP_GUARD, useClass: JwtAuthGuard },
  { provide: APP_GUARD, useClass: CsrfGuard },
  { provide: APP_GUARD, useClass: RolesGuard },
  UserStateService,
];

@Module({
  providers,
  controllers: [LarkController, LocalController, AuthController, MeController, ApiTokenController],
  exports: [JwtAuthService, RefreshTokenService, ApiTokenService, UserStateService],
})
export class AuthModule {}
