import type { Params as PinoModuleParams } from 'nestjs-pino';

export function pinoConfig(nodeEnv: string): PinoModuleParams {
  return {
    pinoHttp: {
      level: nodeEnv === 'production' ? 'info' : 'debug',
      transport:
        nodeEnv === 'production'
          ? undefined
          : { target: 'pino-pretty', options: { singleLine: true, colorize: true } },
      autoLogging: true,
      customProps: () => ({ env: nodeEnv }),
      serializers: {
        req: (req) => ({
          method: req.method,
          url: req.url,
          remoteAddress: req.remoteAddress,
        }),
        res: (res) => ({ statusCode: res.statusCode }),
      },
    },
  };
}
