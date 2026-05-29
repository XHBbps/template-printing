// eslint-disable-next-line import/no-unresolved
import { Injectable } from '@nestjs/common';

// eslint-disable-next-line import/no-unresolved
import { PrismaService } from '../prisma/prisma.service.js';

export interface UserState {
  role: 'admin' | 'user' | 'emergency_admin';
  disabledAt: Date | null;
  mustChangePassword: boolean;
}

interface CacheEntry {
  value: UserState | null; // null = 用户不存在
  expiresAt: number;
}

const TTL_MS = 10_000; // 兜底：主动 evict 才是即时失效的依据

@Injectable()
export class UserStateService {
  private readonly cache = new Map<string, CacheEntry>();

  constructor(private readonly prisma: PrismaService) {}

  /** 命中缓存即返回；未命中查 DB；用户不存在返回 null。 */
  async get(userId: string): Promise<UserState | null> {
    const hit = this.cache.get(userId);
    if (hit && hit.expiresAt > Date.now()) return hit.value;

    const row = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { role: true, disabledAt: true, mustChangePassword: true },
    });
    const value: UserState | null = row
      ? {
          role: row.role as UserState['role'],
          disabledAt: row.disabledAt,
          mustChangePassword: row.mustChangePassword,
        }
      : null;
    this.cache.set(userId, { value, expiresAt: Date.now() + TTL_MS });
    return value;
  }

  /** 角色/禁用变更后主动失效 → 下一请求即生效。 */
  evict(userId: string): void {
    this.cache.delete(userId);
  }
}
