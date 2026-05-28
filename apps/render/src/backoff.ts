const BASE_MS = Number(process.env.RENDER_BACKOFF_BASE_MS ?? 2000);

/**
 * 批次4 P1a:指数退避 + ±50% jitter,防并发同步齐步重试惊群。
 * attemptsMade 1-indexed(bullmq 传第 N 次重试)。base*2^(n-1) 再乘 [0.5,1.5)。
 */
export function jitterBackoff(attemptsMade: number): number {
  const exp = BASE_MS * Math.pow(2, attemptsMade - 1);
  return Math.round(exp * (0.5 + Math.random()));
}
