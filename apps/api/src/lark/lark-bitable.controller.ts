import { timingSafeEqual } from 'crypto';
import { promises as fs } from 'fs';
import * as path from 'path';

import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  Query,
  UnauthorizedException,
  // eslint-disable-next-line import/no-unresolved
} from '@nestjs/common';
// eslint-disable-next-line import/no-unresolved
import type { LarkPrintRequest } from '@prisma/client';
import { z } from 'zod';

// eslint-disable-next-line import/no-unresolved
import { Public } from '../auth/decorators/public.decorator.js';
// eslint-disable-next-line import/no-unresolved
import { PrismaService } from '../prisma/prisma.service.js';
// eslint-disable-next-line import/no-unresolved
import { RenderService } from '../render/render.service.js';

// eslint-disable-next-line import/no-unresolved
import { LarkBitableService } from './lark-bitable.service.js';

const PrintTriggerDto = z.object({
  verificationToken: z.string(),
  templateId: z.string(),
  data: z.record(z.unknown()).default({}),
  version: z.coerce.number().int().min(1).optional(),
  lark: z.object({
    appToken: z.string(),
    tableId: z.string(),
    recordId: z.string(),
    statusField: z.string(),
    attachmentField: z.string(),
  }),
});

const RenderCallbackDto = z.object({
  jobId: z.string(),
  status: z.enum(['done', 'failed']),
  pdfUrl: z.string().nullable().optional(),
  pngUrl: z.string().nullable().optional(),
  errorMsg: z.string().nullable().optional(),
});

const STORAGE_ROOT = process.env.STORAGE_ROOT ?? '/storage';

// 常量时间比较 token，避免 timing 侧信道泄露
function safeEqual(a: string | undefined | null, b: string | undefined | null): boolean {
  if (!a || !b) return false;
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

@Controller('lark')
export class LarkBitableController {
  private readonly logger = new Logger(LarkBitableController.name);

  constructor(
    private readonly render: RenderService,
    private readonly bitable: LarkBitableService,
    private readonly prisma: PrismaService,
  ) {}

  // -------------------------------------------------------------------
  // POST /lark/print-trigger
  //   外部 webhook（飞书自动化里业务人员配的"调用 HTTP 请求"）
  //   通过 body.verificationToken 双重校验防伪造
  // -------------------------------------------------------------------
  @Public()
  @Post('print-trigger')
  @HttpCode(HttpStatus.OK)
  async printTrigger(@Body() raw: unknown): Promise<{ jobId: string; status: string }> {
    const parsed = PrintTriggerDto.safeParse(raw);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    const dto = parsed.data;

    if (!safeEqual(dto.verificationToken, process.env.LARK_BITABLE_VERIFICATION_TOKEN)) {
      throw new UnauthorizedException('verification_token_mismatch');
    }

    // 1. 入队渲染（system 调用，跳过 ownership 检查；callbackUrl 指向自己）
    // callbackUrl 用内部专用 secret，与外部飞书 webhook token 分离
    const apiBase = process.env.API_INTERNAL_BASE ?? 'http://api:3000';
    const cbSecret = process.env.RENDER_CALLBACK_SECRET;
    const callbackUrl = `${apiBase}/lark/render-callback?token=${encodeURIComponent(cbSecret ?? '')}`;
    const { jobId, status } = await this.render.enqueue(null, {
      templateId: dto.templateId,
      data: dto.data,
      formats: ['pdf'],
      callbackUrl,
      version: dto.version,
    });

    // 2. 落 LarkPrintRequest
    await this.prisma.larkPrintRequest.create({
      data: {
        renderJobId: jobId,
        appToken: dto.lark.appToken,
        tableId: dto.lark.tableId,
        recordId: dto.lark.recordId,
        statusField: dto.lark.statusField,
        attachmentField: dto.lark.attachmentField,
        callbackStatus: 'pending',
      },
    });

    // 3. 立即把多维表格状态更新成「处理中」（容错 — 不阻塞 webhook 返回）
    this.bitable
      .updateRecord({
        appToken: dto.lark.appToken,
        tableId: dto.lark.tableId,
        recordId: dto.lark.recordId,
        fields: { [dto.lark.statusField]: '处理中' },
      })
      .catch((e) => {
        this.logger.warn(
          `bitable updateRecord 'processing' failed for job ${jobId}: ${(e as Error).message}`,
        );
      });

    return { jobId, status };
  }

  // -------------------------------------------------------------------
  // POST /lark/render-callback?token=...
  //   render worker 渲染完成后回调；用 URL query token 校验
  //   非 lark 触发的 job 静默忽略（兼容其他调用方走同一端点）
  // -------------------------------------------------------------------
  @Public()
  @Post('render-callback')
  @HttpCode(HttpStatus.OK)
  async renderCallback(@Query('token') token: string, @Body() raw: unknown): Promise<{ ok: true }> {
    if (!safeEqual(token, process.env.RENDER_CALLBACK_SECRET)) {
      throw new UnauthorizedException('verification_token_mismatch');
    }

    const parsed = RenderCallbackDto.safeParse(raw);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    const dto = parsed.data;

    const req = await this.prisma.larkPrintRequest.findUnique({
      where: { renderJobId: dto.jobId },
    });
    if (!req) {
      // 不是 lark 触发的 job — 直接 ack（其他调用方走同一回调通道时不该被处理）
      return { ok: true };
    }

    // P0：已成功回写过 → 幂等，杜绝 stalled 重投/补发导致重复上传 PDF + 重复写回
    if (req.callbackStatus === 'done') return { ok: true };

    if (dto.status === 'done' && dto.pdfUrl) {
      try {
        // pdfUrl 形如 /uploads/render/<jobId>.pdf — 拼到 STORAGE_ROOT 下找文件
        const relative = dto.pdfUrl.startsWith('/') ? dto.pdfUrl.slice(1) : dto.pdfUrl;
        const filePath = path.join(STORAGE_ROOT, relative);
        // 防 path traversal: 解析后路径必须在 STORAGE_ROOT 内（+ sep 防 /storageEVIL 同前缀绕过）
        if (!path.resolve(filePath).startsWith(path.resolve(STORAGE_ROOT) + path.sep)) {
          throw new BadRequestException('invalid_pdf_path');
        }
        const pdfBuf = await fs.readFile(filePath);

        // 飞书 drive medias upload_all 对 bitable_file 的 parent_node 要求是
        // **多维表格 base 的 app_token**（不是 tableId）。spec 早期写错了。
        const fileToken = await this.bitable.uploadMaterial({
          parentNode: req.appToken,
          fileName: `${req.recordId}.pdf`,
          fileBuffer: pdfBuf,
        });

        await this.bitable.updateRecord({
          appToken: req.appToken,
          tableId: req.tableId,
          recordId: req.recordId,
          fields: {
            [req.statusField]: '已完成',
            [req.attachmentField]: [{ file_token: fileToken }],
          },
        });

        await this.prisma.larkPrintRequest.update({
          where: { id: req.id },
          data: { callbackStatus: 'done', errorMsg: null },
        });
      } catch (e) {
        await this.markFailed(req, (e as Error).message);
      }
    } else {
      await this.markFailed(req, dto.errorMsg ?? 'render_failed');
    }

    return { ok: true };
  }

  // P9：复用调用方（renderCallback）已取的记录，免重复 findUnique。
  // appToken/tableId/recordId/statusField 创建后不可变，调用方的副本与重查等价。
  private async markFailed(req: LarkPrintRequest, errorMsg: string): Promise<void> {
    // best-effort 写入多维表格状态字段 = 失败
    this.bitable
      .updateRecord({
        appToken: req.appToken,
        tableId: req.tableId,
        recordId: req.recordId,
        fields: { [req.statusField]: '失败' },
      })
      .catch((e) => {
        this.logger.warn(
          `bitable updateRecord 'failed' failed for req ${req.id}: ${(e as Error).message}`,
        );
      });
    await this.prisma.larkPrintRequest.update({
      where: { id: req.id },
      data: { callbackStatus: 'failed', errorMsg },
    });
  }
}
