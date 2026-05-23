// eslint-disable-next-line import/no-unresolved
import { Module } from '@nestjs/common';

// eslint-disable-next-line import/no-unresolved
import { TemplatesController } from './templates.controller.js';
// eslint-disable-next-line import/no-unresolved
import { TemplatesService } from './templates.service.js';

@Module({
  controllers: [TemplatesController],
  providers: [TemplatesService],
})
export class TemplatesModule {}
