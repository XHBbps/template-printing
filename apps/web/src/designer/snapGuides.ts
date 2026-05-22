export interface SnapInput {
  target: { x: number; y: number; w: number; h: number };
  others: Array<{ x: number; y: number; w: number; h: number }>;
  paper: { w: number; h: number };
  threshold: number;
}

export interface SnapResult {
  snapped: { x: number; y: number };
  guides: {
    v: number[];
    h: number[];
    distLabels: Array<{ kind: 'h' | 'v'; a: number; b: number; crossAxis: number; value: number }>;
  };
}

function targetLines(t: SnapInput['target']): { v: number[]; h: number[] } {
  return {
    v: [t.x, t.x + t.w / 2, t.x + t.w],
    h: [t.y, t.y + t.h / 2, t.y + t.h],
  };
}

function candidateLines(
  others: SnapInput['others'],
  paper: SnapInput['paper'],
): { v: number[]; h: number[] } {
  const v: number[] = [0, paper.w / 2, paper.w];
  const h: number[] = [0, paper.h / 2, paper.h];
  for (const o of others) {
    v.push(o.x, o.x + o.w / 2, o.x + o.w);
    h.push(o.y, o.y + o.h / 2, o.y + o.h);
  }
  return { v, h };
}

export function computeSnap(input: SnapInput): SnapResult {
  const t = targetLines(input.target);
  const c = candidateLines(input.others, input.paper);
  const th = input.threshold;

  let snapDx = 0;
  let snapDy = 0;
  const hitV: number[] = [];
  const hitH: number[] = [];

  // Best vertical alignment (snap x)
  let bestV: { delta: number; abs: number } | null = null;
  for (const tl of t.v) {
    for (const cl of c.v) {
      const delta = cl - tl;
      const abs = Math.abs(delta);
      if (abs <= th && (bestV === null || abs < bestV.abs)) {
        bestV = { delta, abs };
      }
    }
  }
  if (bestV) {
    snapDx = bestV.delta;
    for (const tl of t.v) {
      const newPos = tl + snapDx;
      for (const cl of c.v) {
        if (Math.abs(cl - newPos) < 0.001) hitV.push(cl);
      }
    }
  }

  // Best horizontal alignment (snap y)
  let bestH: { delta: number; abs: number } | null = null;
  for (const tl of t.h) {
    for (const cl of c.h) {
      const delta = cl - tl;
      const abs = Math.abs(delta);
      if (abs <= th && (bestH === null || abs < bestH.abs)) {
        bestH = { delta, abs };
      }
    }
  }
  if (bestH) {
    snapDy = bestH.delta;
    for (const tl of t.h) {
      const newPos = tl + snapDy;
      for (const cl of c.h) {
        if (Math.abs(cl - newPos) < 0.001) hitH.push(cl);
      }
    }
  }

  // Distance labels
  const tSnapped = {
    x: input.target.x + snapDx,
    y: input.target.y + snapDy,
    w: input.target.w,
    h: input.target.h,
  };
  const distLabels: SnapResult['guides']['distLabels'] = [];
  for (const o of input.others) {
    const yOverlap = !(o.y + o.h <= tSnapped.y || o.y >= tSnapped.y + tSnapped.h);
    if (yOverlap) {
      const targetLeft = tSnapped.x;
      const targetRight = tSnapped.x + tSnapped.w;
      const otherLeft = o.x;
      const otherRight = o.x + o.w;
      if (otherRight <= targetLeft) {
        const gap = targetLeft - otherRight;
        if (gap > 0.1 && gap < 30) {
          distLabels.push({
            kind: 'h',
            a: otherRight,
            b: targetLeft,
            crossAxis: Math.max(o.y, tSnapped.y) + Math.min(o.h, tSnapped.h) / 2,
            value: gap,
          });
        }
      } else if (otherLeft >= targetRight) {
        const gap = otherLeft - targetRight;
        if (gap > 0.1 && gap < 30) {
          distLabels.push({
            kind: 'h',
            a: targetRight,
            b: otherLeft,
            crossAxis: Math.max(o.y, tSnapped.y) + Math.min(o.h, tSnapped.h) / 2,
            value: gap,
          });
        }
      }
    }
    const xOverlap = !(o.x + o.w <= tSnapped.x || o.x >= tSnapped.x + tSnapped.w);
    if (xOverlap) {
      const targetTop = tSnapped.y;
      const targetBottom = tSnapped.y + tSnapped.h;
      const otherTop = o.y;
      const otherBottom = o.y + o.h;
      if (otherBottom <= targetTop) {
        const gap = targetTop - otherBottom;
        if (gap > 0.1 && gap < 30) {
          distLabels.push({
            kind: 'v',
            a: otherBottom,
            b: targetTop,
            crossAxis: Math.max(o.x, tSnapped.x) + Math.min(o.w, tSnapped.w) / 2,
            value: gap,
          });
        }
      } else if (otherTop >= targetBottom) {
        const gap = otherTop - targetBottom;
        if (gap > 0.1 && gap < 30) {
          distLabels.push({
            kind: 'v',
            a: targetBottom,
            b: otherTop,
            crossAxis: Math.max(o.x, tSnapped.x) + Math.min(o.w, tSnapped.w) / 2,
            value: gap,
          });
        }
      }
    }
  }
  distLabels.sort((a, b) => a.value - b.value);
  const trimmedLabels = distLabels.slice(0, 2);

  return {
    snapped: { x: tSnapped.x, y: tSnapped.y },
    guides: {
      v: [...new Set(hitV)],
      h: [...new Set(hitH)],
      distLabels: trimmedLabels,
    },
  };
}
