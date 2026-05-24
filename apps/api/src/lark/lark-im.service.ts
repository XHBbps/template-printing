// eslint-disable-next-line import/no-unresolved
import { Injectable, Logger } from '@nestjs/common';
// eslint-disable-next-line import/no-unresolved
import { fetch } from 'undici';

export interface LarkImConfig {
  appId: string;
  appSecret: string;
  openBase: string;
}

interface TokenCacheEntry {
  token: string;
  expiresAt: number; // epoch ms
}

@Injectable()
export class LarkImService {
  private readonly logger = new Logger(LarkImService.name);
  private tokenCache: TokenCacheEntry | null = null;

  constructor(private readonly cfg: LarkImConfig) {}

  /**
   * Public so sibling services (LarkBitableService) can reuse the token + cache.
   */
  async getTenantAccessToken(): Promise<string> {
    if (this.tokenCache && this.tokenCache.expiresAt > Date.now() + 60_000) {
      return this.tokenCache.token;
    }
    const res = await fetch(`${this.cfg.openBase}/open-apis/auth/v3/tenant_access_token/internal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ app_id: this.cfg.appId, app_secret: this.cfg.appSecret }),
    });
    if (!res.ok) throw new Error(`tenant_access_token failed: ${res.status}`);
    const body = (await res.json()) as {
      code: number;
      msg: string;
      tenant_access_token: string;
      expire: number;
    };
    if (body.code !== 0) throw new Error(`tenant_access_token code=${body.code}: ${body.msg}`);
    this.tokenCache = {
      token: body.tenant_access_token,
      expiresAt: Date.now() + body.expire * 1000,
    };
    return body.tenant_access_token;
  }

  /**
   * Send a text message to a specific user by open_id.
   * Returns true on success, false on failure (errors are logged, not thrown).
   */
  async sendTextToUser(openId: string, text: string): Promise<boolean> {
    try {
      const token = await this.getTenantAccessToken();
      const res = await fetch(
        `${this.cfg.openBase}/open-apis/im/v1/messages?receive_id_type=open_id`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            receive_id: openId,
            msg_type: 'text',
            content: JSON.stringify({ text }),
          }),
        },
      );
      if (!res.ok) {
        this.logger.warn(`IM send failed http=${res.status}`);
        return false;
      }
      const body = (await res.json()) as { code: number; msg: string };
      if (body.code !== 0) {
        this.logger.warn(`IM send code=${body.code}: ${body.msg}`);
        return false;
      }
      return true;
    } catch (e) {
      this.logger.error(`IM send exception: ${(e as Error).message}`);
      return false;
    }
  }
}
