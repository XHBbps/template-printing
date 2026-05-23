// eslint-disable-next-line import/no-unresolved
import { Injectable, NotFoundException } from '@nestjs/common';

// eslint-disable-next-line import/no-unresolved
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class TemplatesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(ownerId: string) {
    return this.prisma.template.findMany({
      where: { ownerId },
      orderBy: { updatedAt: 'desc' },
      select: { id: true, name: true, description: true, createdAt: true, updatedAt: true },
    });
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
