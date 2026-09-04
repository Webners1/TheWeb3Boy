import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

import { parseOrThrow } from '@vaultbench/sources';

/**
 * Hand-assigned strategy categories, read from `data/strategy-tags.json`.
 *
 * `core` returns numbers; the presentation layer reads `strategy_category`
 * before choosing a headline, because a market-neutral vault "losing" to BTC
 * in a bull run is not underperforming and saying so is the same dishonesty
 * as the leaderboards this project exists to correct.
 *
 * The file is checked in so a tag is a reviewable diff with an author, not a
 * row someone typed into production.
 */
export const STRATEGY_CATEGORIES = ['directional', 'neutral', 'yield'] as const;
export type StrategyCategory = (typeof STRATEGY_CATEGORIES)[number];

const strategyTagsSchema = z.object({
  $comment: z.union([z.string(), z.array(z.string())]).optional(),
  tags: z.record(z.string().min(1), z.enum(STRATEGY_CATEGORIES)),
});

const defaultPath = fileURLToPath(new URL('../../../data/strategy-tags.json', import.meta.url));

let cache: Map<string, StrategyCategory> | null = null;

/**
 * A typo'd category is a schema failure, not a silently ignored row — the
 * same rule the adapters follow at the network boundary.
 */
export function loadStrategyTags(path = defaultPath): Map<string, StrategyCategory> {
  if (cache) return cache;

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8')) as unknown;
  } catch (error) {
    // An absent file means nothing is tagged yet, which is a valid state. A
    // malformed one is a mistake worth failing on.
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      cache = new Map();
      return cache;
    }
    throw error;
  }

  const parsed = parseOrThrow(strategyTagsSchema, raw, 'data/strategy-tags.json');
  cache = new Map(Object.entries(parsed.tags));
  return cache;
}

/** Test seam: drops the memoised file so a fixture path can be used. */
export function resetStrategyTags(): void {
  cache = null;
}

export function strategyKey(source: string, externalId: string): string {
  return `${source}:${externalId}`;
}

export function strategyCategoryFor(
  source: string,
  externalId: string,
  path?: string,
): StrategyCategory | null {
  const tags = path === undefined ? loadStrategyTags() : loadStrategyTags(path);
  return tags.get(strategyKey(source, externalId)) ?? null;
}
