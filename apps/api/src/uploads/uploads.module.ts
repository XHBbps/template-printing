// eslint-disable-next-line import/no-unresolved
import { Module } from '@nestjs/common';

// eslint-disable-next-line import/no-unresolved
import { UploadsController } from './uploads.controller.js';
// eslint-disable-next-line import/no-unresolved
import { UploadsService } from './uploads.service.js';

@Module({
  controllers: [UploadsController],
  providers: [UploadsService],
})
export class UploadsModule {}
