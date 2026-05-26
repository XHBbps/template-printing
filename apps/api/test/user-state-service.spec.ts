import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { PrismaClient } from '@prisma/client';

// eslint-disable-next-line import/no-unresolved
import { UserStateService } from '../src/auth/user-state.service.js';

describe('UserStateService', () => {
  const prisma = new PrismaClient();
  const svc = new UserStateService(prisma as never);
  let id: string;

  beforeAll(async () => {
    const u = await prisma.user.create({ data: { name: 'us-test', role: 'user' } });
    id = u.id;
  });
  afterAll(async () => {
    await prisma.user.delete({ where: { id } }).catch(() => {});
    await prisma.$disconnect();
  });

  it('returns {role,disabledAt} for existing user', async () => {
    const s = await svc.get(id);
    expect(s).not.toBeNull();
    expect(s!.role).toBe('user');
    expect(s!.disabledAt).toBeNull();
  });

  it('returns null for non-existent user', async () => {
    expect(await svc.get('00000000-0000-0000-0000-000000000000')).toBeNull();
  });

  it('evict() forces a re-read (sees role change)', async () => {
    await svc.get(id); // prime cache
    await prisma.user.update({ where: { id }, data: { role: 'admin' } });
    expect((await svc.get(id))!.role).toBe('user'); // still cached
    svc.evict(id);
    expect((await svc.get(id))!.role).toBe('admin'); // fresh
  });
});
