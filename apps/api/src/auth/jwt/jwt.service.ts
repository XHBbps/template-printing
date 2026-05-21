import { randomBytes } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { JwtService as NestJwt } from '@nestjs/jwt';

export interface JwtClaims {
  sub: string;
  role: 'admin' | 'user' | 'emergency_admin';
  csrf: string;
  iat?: number;
  exp?: number;
}

@Injectable()
export class JwtAuthService {
  private readonly nest: NestJwt;
  private readonly ttlSeconds: number;

  constructor(secret: string, ttlSeconds: number) {
    this.nest = new NestJwt({ secret, signOptions: { expiresIn: ttlSeconds } });
    this.ttlSeconds = ttlSeconds;
  }

  sign(payload: { sub: string; role: JwtClaims['role'] }): { token: string; csrf: string } {
    const csrf = randomBytes(32).toString('hex');
    const token = this.nest.sign({ ...payload, csrf });
    return { token, csrf };
  }

  verify(token: string): JwtClaims {
    return this.nest.verify<JwtClaims>(token);
  }

  get ttl(): number {
    return this.ttlSeconds;
  }
}
