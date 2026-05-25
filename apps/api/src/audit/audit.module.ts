// eslint-disable-next-line import/no-unresolved
import { Global, Module } from '@nestjs/common';

// eslint-disable-next-line import/no-unresolved
import { AuditLogController } from './audit-log.controller.js';
// eslint-disable-next-line import/no-unresolved
import { AuditLogService } from './audit-log.service.js';

/**
 * iter 32 T1：审计日志全局模块。
 * @Global 让所有 module 可直接 @Inject AuditLogService，无需逐个 imports。
 * iter 32 T1+：暴露 GET /audit-logs 给 admin 后台。
 */
@Global()
@Module({
  controllers: [AuditLogController],
  providers: [AuditLogService],
  exports: [AuditLogService],
})
export class AuditModule {}
