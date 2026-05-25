// eslint-disable-next-line import/no-unresolved
import { Injectable } from '@nestjs/common';
// eslint-disable-next-line import/no-unresolved
import { Counter, Histogram, Registry, collectDefaultMetrics } from 'prom-client';

/**
 * iter 32 T3：Prometheus 指标注册中心。
 *
 * 自定义指标（业务）：
 *   tp_render_jobs_total{status,source}      渲染任务总数（enqueued/done/failed × api/bot/bitable）
 *   tp_render_quota_exceeded_total           日配额超限次数
 *   tp_http_requests_total{method,route,status_code}
 *   tp_http_request_duration_seconds{method,route}
 *
 * 默认指标（Node.js 运行时）：
 *   process_cpu / heap / event_loop_lag / GC 等（prom-client defaultMetrics）
 *
 * 端点 GET /metrics 返 text/plain Prometheus exposition format。
 */
@Injectable()
export class MetricsService {
  readonly registry: Registry;

  readonly renderJobs: Counter<'status' | 'source'>;
  readonly renderQuotaExceeded: Counter<string>;
  readonly httpRequests: Counter<'method' | 'route' | 'status_code'>;
  readonly httpDuration: Histogram<'method' | 'route'>;

  constructor() {
    this.registry = new Registry();
    this.registry.setDefaultLabels({ app: 'tp-api' });
    collectDefaultMetrics({ register: this.registry });

    this.renderJobs = new Counter({
      name: 'tp_render_jobs_total',
      help: 'Render jobs total by status × source',
      labelNames: ['status', 'source'],
      registers: [this.registry],
    });

    this.renderQuotaExceeded = new Counter({
      name: 'tp_render_quota_exceeded_total',
      help: 'Render quota exceeded count',
      registers: [this.registry],
    });

    this.httpRequests = new Counter({
      name: 'tp_http_requests_total',
      help: 'HTTP requests total',
      labelNames: ['method', 'route', 'status_code'],
      registers: [this.registry],
    });

    this.httpDuration = new Histogram({
      name: 'tp_http_request_duration_seconds',
      help: 'HTTP request duration (seconds)',
      labelNames: ['method', 'route'],
      buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
      registers: [this.registry],
    });
  }

  async expose(): Promise<string> {
    return this.registry.metrics();
  }
}
