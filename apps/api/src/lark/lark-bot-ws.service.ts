// eslint-disable-next-line import/no-unresolved
import * as lark from '@larksuiteoapi/node-sdk';
import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
  // eslint-disable-next-line import/no-unresolved
} from '@nestjs/common';

// eslint-disable-next-line import/no-unresolved
import { LarkBotDispatchService } from './lark-bot-dispatch.service.js';
// eslint-disable-next-line import/no-unresolved
import { fromWsCardAction, fromWsMessage } from './lark-bot-payload.js';

type RegisterHandles = Parameters<lark.EventDispatcher['register']>[0];

/**
 * 飞书 bot 长连接(WSClient)。受 LARK_BOT_LONG_CONN_ENABLED 门控:仅生产单副本设 true 时启动。
 * 收到的 im.message.receive_v1 / card.action.trigger 归一化后交给 LarkBotDispatchService;
 * 卡片回调的返回值(handler return)由 SDK 经 WS 回传飞书。HTTP 端点仍保留作 fallback。
 */
@Injectable()
export class LarkBotWsService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(LarkBotWsService.name);
  private wsClient?: lark.WSClient;

  constructor(private readonly dispatch: LarkBotDispatchService) {}

  onApplicationBootstrap(): void {
    if (process.env.LARK_BOT_LONG_CONN_ENABLED !== 'true') {
      this.logger.log('LARK_BOT_LONG_CONN_ENABLED!=true → 跳过 WS 长连接');
      return;
    }
    const appId = process.env.LARK_SSO_APP_ID;
    const appSecret = process.env.LARK_SSO_APP_SECRET;
    if (!appId || !appSecret) {
      this.logger.warn('缺 LARK_SSO_APP_ID/SECRET → 跳过 WS 长连接');
      return;
    }
    try {
      this.wsClient = new lark.WSClient({
        appId,
        appSecret,
        domain: lark.Domain.Feishu,
        autoReconnect: true,
      });
      const handles = {
        'im.message.receive_v1': async (data: Record<string, unknown>): Promise<void> => {
          await this.dispatch.handleMessageReceive(fromWsMessage(data));
        },
        'card.action.trigger': async (data: Record<string, unknown>): Promise<unknown> =>
          this.dispatch.handleCardAction(fromWsCardAction(data)),
      } as unknown as RegisterHandles;
      const dispatcher = new lark.EventDispatcher({}).register(handles);
      // start 异常只 warn,不阻塞 api;断线由 SDK autoReconnect 兜底
      void this.wsClient.start({ eventDispatcher: dispatcher });
      this.logger.log('飞书 bot 长连接已启动(Domain.Feishu)');
    } catch (e) {
      this.logger.warn(`WS 启动失败(不阻塞 api):${(e as Error).message}`);
    }
  }

  onApplicationShutdown(): void {
    // WSClient(SDK 1.40.0)无公开 stop() —— 连接随进程退出释放。保留 hook 以便未来 SDK
    // 提供关闭 API 时显式关闭(滚动部署防新旧实例短暂双收)。需 app.enableShutdownHooks() 才触发。
    this.logger.log('app 关闭中:WS 连接随进程退出释放');
  }
}
