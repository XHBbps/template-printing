// eslint-disable-next-line import/no-unresolved
import { Module } from '@nestjs/common';

// eslint-disable-next-line import/no-unresolved
import { validateEnv } from '../common/env.js';

// eslint-disable-next-line import/no-unresolved
import { LarkImService } from './lark-im.service.js';

const env = validateEnv();

@Module({
  providers: [
    {
      provide: LarkImService,
      useFactory: (): LarkImService =>
        new LarkImService({
          appId: env.LARK_SSO_APP_ID,
          appSecret: env.LARK_SSO_APP_SECRET,
          openBase: env.LARK_API_BASE,
        }),
    },
  ],
  exports: [LarkImService],
})
export class LarkImModule {}
