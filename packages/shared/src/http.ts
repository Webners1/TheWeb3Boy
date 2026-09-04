import { logger } from './logger.js';
import { TokenBucket, sleep } from './rate-limit.js';

export interface FetchJsonOptions {
  method?: 'GET' | 'POST';
  body?: unknown;
  headers?: Record<string, string>;
  timeoutMs?: number;
  retries?: number;
  bucket?: TokenBucket;
  signal?: AbortSignal;
  /**
   * Minimum wait after a 429, in ms. Raise it for a venue that enforces its
   * quota over a rolling window rather than per-instant.
   */
  rateLimitBackoffMs?: number;
}

/**
 * Default floor for a 429 retry.
 *
 * A windowed quota does not care how patient the exponential curve is: while
 * the window is hot, every retry inside it fails, so a 500ms→16s ramp just
 * burns all five attempts and fails the run. Chamber's quota is 50 requests
 * per rolling minute (docs/traps.md), so a 429 means "wait out the window",
 * and one long sleep beats six doomed short ones.
 */
const DEFAULT_RATE_LIMIT_BACKOFF_MS = 65_000;

const DEFAULT_UA = 'vaultbench/0.0.0 (ingest; +https://github.com/vaultbench)';

export class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly url: string,
    readonly body: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export async function fetchJson(url: string, options: FetchJsonOptions = {}): Promise<unknown> {
  const retries = options.retries ?? 5;
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    if (options.bucket) {
      await options.bucket.take();
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 60_000);
    const onOuterAbort = () => controller.abort();
    options.signal?.addEventListener('abort', onOuterAbort);

    try {
      const response = await fetch(url, {
        method: options.method ?? 'GET',
        headers: {
          accept: 'application/json',
          'user-agent': DEFAULT_UA,
          ...(options.body !== undefined ? { 'content-type': 'application/json' } : {}),
          ...options.headers,
        },
        body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
        signal: controller.signal,
      });

      const text = await response.text();

      if (response.status === 429 || response.status >= 500) {
        const delay =
          response.status === 429
            ? rateLimitDelay(response, options.rateLimitBackoffMs ?? DEFAULT_RATE_LIMIT_BACKOFF_MS)
            : backoffMs(attempt);
        logger.warn('http retry', { url, status: response.status, attempt, delay });
        await sleep(delay);
        lastError = new HttpError(`HTTP ${response.status}`, response.status, url, text);
        continue;
      }

      if (!response.ok) {
        throw new HttpError(`HTTP ${response.status} for ${url}`, response.status, url, text);
      }

      if (text.length === 0) {
        return null;
      }

      try {
        return JSON.parse(text) as unknown;
      } catch (error) {
        throw new Error(`invalid JSON from ${url}: ${String(error)}`);
      }
    } catch (error) {
      if (error instanceof HttpError && error.status < 500 && error.status !== 429) {
        throw error;
      }
      lastError = error;
      if (attempt < retries) {
        const delay = backoffMs(attempt);
        logger.warn('http retry', { url, attempt, delay, error: String(error) });
        await sleep(delay);
        continue;
      }
    } finally {
      clearTimeout(timeout);
      options.signal?.removeEventListener('abort', onOuterAbort);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function backoffMs(attempt: number): number {
  const base = 500 * 2 ** attempt;
  const capped = Math.min(base, 30_000);
  return capped;
}

/**
 * Honour `Retry-After` when the server sends one; otherwise wait out the
 * floor. Chamber sends no such header, which is why the floor exists.
 */
export function rateLimitDelay(response: { headers: Headers }, floorMs: number): number {
  const header = response.headers.get('retry-after');
  if (header !== null) {
    const seconds = Number.parseInt(header, 10);
    if (Number.isInteger(seconds) && seconds > 0) return Math.max(seconds * 1000, 1000);
    const date = Date.parse(header);
    if (!Number.isNaN(date)) return Math.max(date - Date.now(), 1000);
  }
  return floorMs;
}
