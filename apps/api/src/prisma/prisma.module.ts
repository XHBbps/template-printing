import { Global, Module } from '@nestjs/common';

// eslint-disable-next-line import/no-unresolved
import { PrismaService } from './prisma.service.js';

@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
