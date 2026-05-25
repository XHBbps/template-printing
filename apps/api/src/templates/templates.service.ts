// eslint-disable-next-line import/no-unresolved
import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

// eslint-disable-next-line import/no-unresolved
import { PrismaService } from '../prisma/prisma.service.js';

export interface TemplateListArgs {
  page: number;
  pageSize: number;
  search?: string | null;
  sort?: 'updated' | 'name';
}

@Injectable()
export class TemplatesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(ownerId: string, args: TemplateListArgs) {
    const pageSize = Math.min(Math.max(args.pageSize, 1), 100);
    const page = Math.max(args.page, 1);
    const skip = (page - 1) * pageSize;
    const q = args.search?.trim();

    const where: Prisma.TemplateWhereInput = {
      ownerId,
      ...(q
        ? { OR: [{ name: { contains: q, mode: 'insensitive' } }, { id: { contains: q } }] }
        : {}),
    };
    const orderBy: Prisma.TemplateOrderByWithRelationInput =
      args.sort === 'name' ? { name: 'asc' } : { updatedAt: 'desc' };

    const [items, total] = await Promise.all([
      this.prisma.template.findMany({
        where,
        orderBy,
        skip,
        take: pageSize,
        select: { id: true, name: true, description: true, createdAt: true, updatedAt: true },
      }),
      this.prisma.template.count({ where }),
    ]);

    return { items, total, page, pageSize };
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
