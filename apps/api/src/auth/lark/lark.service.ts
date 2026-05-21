import { Injectable } from '@nestjs/common';
import { fetch } from 'undici';

export interface LarkServiceConfig {
  appId: string;
  appSecret: string;
  passportBase: string;
  openBase: string;
  accountsBase?: string;
}

export interface LarkTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token: string;
  scope: string;
}

export interface LarkUserInfo {
  open_id: string;
  union_id: string;
  user_id: string;
  name: string;
  en_name?: string;
  email?: string;
  mobile?: string;
  avatar_url: string;
  avatar_thumb?: string;
  avatar_middle?: string;
  avatar_big?: string;
}

@Injectable()
export class LarkService {
  private readonly accountsBase: string;

  constructor(private readonly cfg: LarkServiceConfig) {
    this.accountsBase = cfg.accountsBase ?? 'https://accounts.feishu.cn';
  }

  buildAuthorizeUrl(args: { redirectUri: string; state: string; scope?: string }): string {
    const params = new URLSearchParams({
      app_id: this.cfg.appId,
      redirect_uri: args.redirectUri,
      state: args.state,
    });
    if (args.scope) params.set('scope', args.scope);
    return `${this.accountsBase}/open-apis/authen/v1/index?${params.toString()}`;
  }

  async exchangeCode(args: { code: string; redirectUri: string }): Promise<LarkTokenResponse> {
    const res = await fetch(`${this.cfg.passportBase}/suite/passport/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        client_id: this.cfg.appId,
        client_secret: this.cfg.appSecret,
        code: args.code,
        redirect_uri: args.redirectUri,
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Lark token exchange failed: ${res.status} ${text}`);
    }
    const json = (await res.json()) as LarkTokenResponse;
    return json;
  }

  async fetchUserInfo(userAccessToken: string): Promise<LarkUserInfo> {
    const res = await fetch(`${this.cfg.openBase}/open-apis/authen/v1/user_info`, {
      headers: { Authorization: `Bearer ${userAccessToken}` },
    });
    if (!res.ok) {
      throw new Error(`Lark user_info failed: ${res.status}`);
    }
    const body = (await res.json()) as { code: number; msg: string; data: LarkUserInfo };
    if (body.code !== 0) {
      throw new Error(`Lark user_info code=${body.code}: ${body.msg}`);
    }
    return body.data;
  }
}
