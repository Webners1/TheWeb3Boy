import { z } from 'zod';
import { wireDecimal } from '@vaultbench/shared';

export const LLAMA_COINS = {
  BTC: 'coingecko:bitcoin',
  ETH: 'coingecko:ethereum',
  SOL: 'coingecko:solana',
} as const;

export type BenchmarkSymbol = keyof typeof LLAMA_COINS;

export const llamaCoinPriceSchema = z.object({
  symbol: z.string(),
  price: wireDecimal,
  timestamp: z.number().int(),
  confidence: z.number().finite().optional(),
});

export const llamaHistoricalSchema = z.object({
  coins: z.record(z.string(), llamaCoinPriceSchema),
});

export const llamaChartSchema = z.object({
  coins: z.record(
    z.string(),
    z.object({
      symbol: z.string().optional(),
      confidence: z.number().finite().optional(),
      prices: z.array(
        z.object({
          timestamp: z.number().int(),
          price: wireDecimal,
        }),
      ),
    }),
  ),
});

export const llamaCurrentSchema = llamaHistoricalSchema;
