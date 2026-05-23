// eslint-disable-next-line import/no-unresolved
import { Module } from '@nestjs/common';

// eslint-disable-next-line import/no-unresolved
import { RenderController } from './render.controller.js';
// eslint-disable-next-line import/no-unresolved
import { RenderService } from './render.service.js';

@Module({
  controllers: [RenderController],
  providers: [RenderService],
})
export class RenderModule {}
