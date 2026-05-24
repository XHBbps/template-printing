// eslint-disable-next-line import/no-unresolved
import { Global, Module } from '@nestjs/common';

// eslint-disable-next-line import/no-unresolved
import { validateEnv } from '../common/env.js';
// eslint-disable-next-line import/no-unresolved
import { RenderModule } from '../render/render.module.js';

// eslint-disable-next-line import/no-unresolved
import { LarkBitableController } from './lark-bitable.controller.js';
// eslint-disable-next-line import/no-unresolved
import { LarkBitableService } from './lark-bitable.service.js';
// eslint-disable-next-line import/no-unresolved
import { LarkImService } from './lark-im.service.js';

const env = validateEnv();

@Global()
@Module({
  imports: [RenderModule],
  controllers: [LarkBitableController],
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
    {
      provide: LarkBitableService,
      useFactory: (im: LarkImService): LarkBitableService =>
        new LarkBitableService(im, { openBase: env.LARK_API_BASE }),
      inject: [LarkImService],
    },
  ],
  exports: [LarkImService, LarkBitableService],
})
export class LarkModule {}
