// eslint-disable-next-line import/no-unresolved
import { Injectable, NotFoundException } from '@nestjs/common';
// eslint-disable-next-line import/no-unresolved
import { Prisma } from '@prisma/client';

// eslint-disable-next-line import/no-unresolved
import { PrismaService } from '../prisma/prisma.service.js';

export interface TemplateListArgs {
  offset: number;
  limit: number;
  search?: string | null;
  sort?: 'updated' | 'name' | 'created';
}

@Injectable()
export class TemplatesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 偏移分页：offset/limit 直接映射 skip/take，支持网格非均匀分页（首页 9 其余 10）
   * 与列表无限滚动（按已加载数偏移）两种前端取数策略。
   */
  async list(ownerId: string, args: TemplateListArgs) {
    const limit = Math.min(Math.max(args.limit, 1), 100);
    const offset = Math.max(args.offset, 0);
    const q = args.search?.trim();

    const where: Prisma.TemplateWhereInput = {
      ownerId,
      ...(q
        ? { OR: [{ name: { contains: q, mode: 'insensitive' } }, { id: { contains: q } }] }
        : {}),
    };
    // 稳定排序加 id 二级键，避免同毫秒/同名记录顺序漂移导致保存后列表重排
    const orderBy: Prisma.TemplateOrderByWithRelationInput[] =
      args.sort === 'name'
        ? [{ name: 'asc' }, { id: 'asc' }]
        : args.sort === 'created'
          ? [{ createdAt: 'desc' }, { id: 'asc' }]
          : [{ updatedAt: 'desc' }, { id: 'asc' }];

    const [items, total] = await Promise.all([
      this.prisma.template.findMany({
        where,
        orderBy,
        skip: offset,
        take: limit,
        select: { id: true, name: true, description: true, createdAt: true, updatedAt: true },
      }),
      this.prisma.template.count({ where }),
    ]);

    return { items, total, offset, limit };
  }

  async get(ownerId: string, id: string) {
    const tpl = await this.prisma.template.findFirst({ where: { id, ownerId } });
    if (!tpl) throw new NotFoundException('template_not_found');
    return tpl;
  }

  async create(ownerId: string, payload: { name: string; description?: string; data?: unknown }) {
    return this.prisma.template.create({
      data: {
        name: payload.name,
        description: payload.description ?? null,
        data: payload.data as object,
        ownerId,
      },
    });
  }

  /** 把当前草稿(data)发布成新版本：version = max+1，事务内完成。 */
  async publish(ownerId: string, id: string): Promise<{ version: number; publishedAt: Date }> {
    const tpl = await this.prisma.template.findFirst({ where: { id, ownerId } });
    if (!tpl) throw new NotFoundException('template_not_found');

    return this.prisma.$transaction(async (tx) => {
      const max = await tx.templateVersion.aggregate({
        where: { templateId: id },
        _max: { version: true },
      });
      const nextVersion = (max._max.version ?? 0) + 1;
      const created = await tx.templateVersion.create({
        data: {
          templateId: id,
          version: nextVersion,
          data: tpl.data as object,
          publishedBy: ownerId,
        },
      });
      await tx.template.update({
        where: { id },
        data: { publishedVersion: nextVersion, hasUnpublishedChanges: false },
      });
      return { version: created.version, publishedAt: created.publishedAt };
    });
  }

  async update(
    ownerId: string,
    id: string,
    payload: { name?: string; description?: string; data?: unknown },
  ) {
    await this.get(ownerId, id); // ownership check
    return this.prisma.template.update({
      where: { id },
      data: {
        ...(payload.name !== undefined && { name: payload.name }),
        ...(payload.description !== undefined && { description: payload.description }),
        ...(payload.data !== undefined && { data: payload.data as object }),
      },
    });
  }

  async remove(ownerId: string, id: string): Promise<void> {
    await this.get(ownerId, id); // ownership check
    await this.prisma.template.delete({ where: { id } });
  }
}
