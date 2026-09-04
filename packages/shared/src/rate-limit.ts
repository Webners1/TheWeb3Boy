/**
 * Token bucket. Hyperliquid info is 1200 weight/min/IP; we cap at ~10 req/s
 * regardless of runner IP rotation (docs/traps.md, operations).
 */
export class TokenBucket {
  private tokens: number;
  private lastRefill: number;

  constructor(
    private readonly ratePerSec: number,
    private readonly burst: number,
  ) {
    this.tokens = burst;
    this.lastRefill = Date.now();
  }

  async take(count = 1): Promise<void> {
    for (;;) {
      this.refill();
      if (this.tokens >= count) {
        this.tokens -= count;
        return;
      }
      const deficit = count - this.tokens;
      const waitMs = Math.ceil((deficit / this.ratePerSec) * 1000);
      await sleep(waitMs);
    }
  }

  private refill(): void {
    const now = Date.now();
    const elapsedSec = (now - this.lastRefill) / 1000;
    this.tokens = Math.min(this.burst, this.tokens + elapsedSec * this.ratePerSec);
    this.lastRefill = now;
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export async function mapPool<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (concurrency < 1) {
    throw new RangeError('concurrency must be >= 1');
  }
  const results: R[] = new Array(items.length);
  let next = 0;

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    for (;;) {
      const index = next;
      next += 1;
      const item = items[index];
      if (item === undefined) return;
      results[index] = await fn(item, index);
    }
  });

  await Promise.all(workers);
  return results;
}
