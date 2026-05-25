// eslint-disable-next-line import/no-unresolved
import { Module } from '@nestjs/common';

// eslint-disable-next-line import/no-unresolved
import { FileSigService } from './file-sig.service.js';
// eslint-disable-next-line import/no-unresolved
import { SignedUploadsController } from './signed-uploads.controller.js';
// eslint-disable-next-line import/no-unresolved
import { UploadsController } from './uploads.controller.js';
// eslint-disable-next-line import/no-unresolved
import { UploadsService } from './uploads.service.js';

@Module({
  controllers: [UploadsController, SignedUploadsController],
  providers: [UploadsService, FileSigService],
  exports: [FileSigService],
})
export class UploadsModule {}
