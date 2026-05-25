// eslint-disable-next-line import/no-unresolved
import { Module } from '@nestjs/common';

// eslint-disable-next-line import/no-unresolved
import { AuthModule } from '../auth/auth.module.js';
// eslint-disable-next-line import/no-unresolved
import { ApiAuthGuard } from '../auth/guards/api-auth.guard.js';
// eslint-disable-next-line import/no-unresolved
import { UploadsModule } from '../uploads/uploads.module.js';

// eslint-disable-next-line import/no-unresolved
import { RenderCleanupService } from './render-cleanup.service.js';
// eslint-disable-next-line import/no-unresolved
import { RenderController } from './render.controller.js';
// eslint-disable-next-line import/no-unresolved
import { RenderService } from './render.service.js';

@Module({
  imports: [
    AuthModule, // 拿 ApiTokenService + JwtAuthService 给 ApiAuthGuard
    UploadsModule, // 拿 FileSigService 给 signed URL
  ],
  controllers: [RenderController],
  providers: [RenderService, ApiAuthGuard, RenderCleanupService],
  exports: [RenderService],
})
export class RenderModule {}
