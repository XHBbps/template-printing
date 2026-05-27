// eslint-disable-next-line import/no-unresolved
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
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
        select: {
          id: true,
          name: true,
          description: true,
          createdAt: true,
          updatedAt: true,
          publishedVersion: true,
          hasUnpublishedChanges: true,
          visibility: true,
        },
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

  /** 把当前草稿(data)发布成新版本：version = max+1，整段在事务内（含草稿读取，避免并发 autosave 抢插旧草稿）。 */
  async publish(ownerId: string, id: string): Promise<{ version: number; publishedAt: Date }> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        // 在事务内读草稿，确保快照就是发布那一刻的 data
        const tpl = await tx.template.findFirst({ where: { id, ownerId } });
        if (!tpl) throw new NotFoundException('template_not_found');
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
    } catch (e) {
      // 并发发布同一模板可能撞 @@unique([templateId,version])；转成 409 让调用方重试
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('version_conflict_retry');
      }
      throw e;
    }
  }

  async listVersions(ownerId: string, id: string) {
    const tpl = await this.prisma.template.findFirst({
      where: { id, ownerId },
      select: { publishedVersion: true, hasUnpublishedChanges: true },
    });
    if (!tpl) throw new NotFoundException('template_not_found');
    const versions = await this.prisma.templateVersion.findMany({
      where: { templateId: id },
      orderBy: { version: 'desc' },
      select: { version: true, publishedAt: true, publishedBy: true, restoredFrom: true },
    });
    return {
      publishedVersion: tpl.publishedVersion,
      hasUnpublishedChanges: tpl.hasUnpublishedChanges,
      items: versions.map((v) => ({ ...v, isCurrent: v.version === tpl.publishedVersion })),
    };
  }

  async getVersion(ownerId: string, id: string, version: number) {
    // 允许读取:本人模板的任意版本;或「公共模板的已发布版本」(供公共模板库缩略图/预览跨 owner 读取)。
    // 私有模板 / 公共模板的非发布版本对他人仍不可见(返回 404)。
    const tpl = await this.prisma.template.findUnique({
      where: { id },
      select: { ownerId: true, visibility: true, publishedVersion: true },
    });
    if (!tpl) throw new NotFoundException('template_not_found');
    const allowed =
      tpl.ownerId === ownerId || (tpl.visibility === 'public' && tpl.publishedVersion === version);
    if (!allowed) throw new NotFoundException('template_not_found');
    const row = await this.prisma.templateVersion.findUnique({
      where: { templateId_version: { templateId: id, version } },
    });
    if (!row) throw new NotFoundException('template_version_not_found');
    return { version: row.version, publishedAt: row.publishedAt, data: row.data };
  }

  /** 一键回滚并发布：把 Vk 内容追加为新版 V(n+1)，restoredFrom=k；不改草稿。 */
  async rollback(
    ownerId: string,
    id: string,
    fromVersion: number,
  ): Promise<{ version: number; restoredFrom: number }> {
    const tpl = await this.prisma.template.findFirst({
      where: { id, ownerId },
      select: { id: true },
    });
    if (!tpl) throw new NotFoundException('template_not_found');
    try {
      return await this.prisma.$transaction(async (tx) => {
        const src = await tx.templateVersion.findUnique({
          where: { templateId_version: { templateId: id, version: fromVersion } },
        });
        if (!src) throw new NotFoundException('template_version_not_found');
        const max = await tx.templateVersion.aggregate({
          where: { templateId: id },
          _max: { version: true },
        });
        const nextVersion = (max._max.version ?? 0) + 1;
        const created = await tx.templateVersion.create({
          data: {
            templateId: id,
            version: nextVersion,
            data: src.data as object,
            publishedBy: ownerId,
            restoredFrom: fromVersion,
          },
        });
        await tx.template.update({
          where: { id },
          data: { publishedVersion: nextVersion, hasUnpublishedChanges: true },
        });
        return { version: created.version, restoredFrom: fromVersion };
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('version_conflict_retry');
      }
      throw e;
    }
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
        ...(payload.data !== undefined && {
          data: payload.data as object,
          hasUnpublishedChanges: true,
        }),
      },
    });
  }

  async remove(ownerId: string, id: string): Promise<void> {
    await this.get(ownerId, id); // ownership check
    await this.prisma.template.delete({ where: { id } });
  }

  /** 公共库:列 public + 已发布模板(跨 owner,无 ownerId 过滤)。搜索只按 name。 */
  async listPublic(args: TemplateListArgs) {
    const limit = Math.min(Math.max(args.limit, 1), 100);
    const offset = Math.max(args.offset, 0);
    const q = args.search?.trim();
    const where: Prisma.TemplateWhereInput = {
      visibility: 'public',
      publishedVersion: { not: null },
      ...(q ? { name: { contains: q, mode: 'insensitive' } } : {}),
    };
    const orderBy: Prisma.TemplateOrderByWithRelationInput[] =
      args.sort === 'name'
        ? [{ name: 'asc' }, { id: 'asc' }]
        : args.sort === 'created'
          ? [{ createdAt: 'desc' }, { id: 'asc' }]
          : [{ updatedAt: 'desc' }, { id: 'asc' }];
    const [rows, total] = await Promise.all([
      this.prisma.template.findMany({
        where,
        orderBy,
        skip: offset,
        take: limit,
        select: {
          id: true,
          name: true,
          description: true,
          publishedVersion: true,
          updatedAt: true,
          owner: { select: { name: true } },
        },
      }),
      this.prisma.template.count({ where }),
    ]);
    const items = rows.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      ownerName: r.owner?.name ?? '—',
      publishedVersion: r.publishedVersion,
      updatedAt: r.updatedAt,
    }));
    return { items, total, offset, limit };
  }

  /** 设可见性(admin 用;不按 ownerId 限定 → 可操作任意模板)。public 要求已发布。 */
  async setVisibility(id: string, visibility: 'private' | 'public') {
    const tpl = await this.prisma.template.findUnique({
      where: { id },
      select: { id: true, publishedVersion: true },
    });
    if (!tpl) throw new NotFoundException('template_not_found');
    if (visibility === 'public' && tpl.publishedVersion == null) {
      throw new BadRequestException('publish_before_public');
    }
    await this.prisma.template.update({ where: { id }, data: { visibility } });
    return { id, visibility };
  }

  /** 复制公共模板到 meId 名下:取源最新发布版 data(按 publishedVersion 列),成私有新草稿。 */
  async copyFromPublic(meId: string, sourceId: string) {
    const src = await this.prisma.template.findFirst({
      where: { id: sourceId, visibility: 'public', publishedVersion: { not: null } },
      select: { id: true, name: true, description: true, publishedVersion: true },
    });
    if (!src) throw new NotFoundException('public_template_not_found');
    const ver = await this.prisma.templateVersion.findUnique({
      where: { templateId_version: { templateId: src.id, version: src.publishedVersion! } },
      select: { data: true },
    });
    if (!ver) throw new NotFoundException('public_template_not_found');
    return this.prisma.template.create({
      data: {
        name: `${src.name} 副本`,
        description: src.description,
        data: ver.data as object,
        ownerId: meId,
        visibility: 'private',
        publishedVersion: null,
        hasUnpublishedChanges: true,
      },
      select: { id: true, name: true },
    });
  }
}
