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
import { LarkBotDispatchService } from './lark-bot-dispatch.service.js';
// eslint-disable-next-line import/no-unresolved
import { LarkBotWsService } from './lark-bot-ws.service.js';
// eslint-disable-next-line import/no-unresolved
import { LarkBotController } from './lark-bot.controller.js';
// eslint-disable-next-line import/no-unresolved
import { LarkBotService } from './lark-bot.service.js';
// eslint-disable-next-line import/no-unresolved
import { LarkImService } from './lark-im.service.js';

const env = validateEnv();

@Global()
@Module({
  imports: [RenderModule],
  controllers: [LarkBitableController, LarkBotController],
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
    {
      provide: LarkBotService,
      useFactory: (im: LarkImService): LarkBotService =>
        new LarkBotService(im, { openBase: env.LARK_API_BASE }),
      inject: [LarkImService],
    },
    // bot 长连接(WS)接管事件+卡片回调:dispatch 纯业务 + ws 胶水(env 门控)。
    LarkBotDispatchService,
    LarkBotWsService,
  ],
  exports: [LarkImService, LarkBitableService, LarkBotService],
})
export class LarkModule {}
