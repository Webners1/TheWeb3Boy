import { z } from 'zod';
import { decimalString, epochMillis, hexAddress } from '@vaultbench/shared';

const historyPoint = z.tuple([epochMillis, decimalString]);

export const vaultPortfolioBucketSchema = z.object({
  accountValueHistory: z.array(historyPoint),
  pnlHistory: z.array(historyPoint),
  vlm: decimalString,
});

export const vaultPortfolioSchema = z.array(z.tuple([z.string(), vaultPortfolioBucketSchema]));

export const vaultRelationshipSchema = z.object({
  type: z.string(),
  data: z
    .object({
      childAddresses: z.array(z.string()).optional(),
    })
    .optional(),
});

export const vaultFollowerSchema = z.object({
  user: z.string().min(1),
  vaultEquity: decimalString,
  pnl: decimalString,
  allTimePnl: decimalString,
  daysFollowing: z.number().int(),
  vaultEntryTime: epochMillis,
  lockupUntil: epochMillis,
});

export const vaultDetailsSchema = z.object({
  name: z.string(),
  vaultAddress: hexAddress,
  leader: hexAddress,
  description: z.string().nullable().optional(),
  portfolio: vaultPortfolioSchema,
  apr: z.number().finite(),
  leaderFraction: z.number().finite(),
  leaderCommission: z.number().finite(),
  followers: z.array(vaultFollowerSchema).optional().default([]),
  maxDistributable: z.number().finite(),
  maxWithdrawable: z.number().finite(),
  isClosed: z.boolean().optional(),
  relationship: vaultRelationshipSchema,
  followerState: z.unknown().nullable().optional(),
  allowDeposits: z.boolean().optional(),
  alwaysCloseOnWithdraw: z.boolean().optional(),
});

export const vaultStatsSummarySchema = z.object({
  name: z.string(),
  vaultAddress: hexAddress,
  leader: hexAddress,
  tvl: decimalString,
  isClosed: z.boolean(),
  relationship: vaultRelationshipSchema,
  createTimeMillis: epochMillis,
});

export const vaultStatsEntrySchema = z.object({
  apr: z.number().finite(),
  pnls: z.array(z.tuple([z.string(), z.array(decimalString)])),
  summary: vaultStatsSummarySchema,
});

export const vaultStatsRegistrySchema = z.array(vaultStatsEntrySchema);

export const vaultSummariesSchema = z.array(
  z.object({
    name: z.string(),
    vaultAddress: hexAddress,
    leader: hexAddress,
    tvl: decimalString,
    isClosed: z.boolean().optional(),
    createTimeMillis: epochMillis.optional(),
    relationship: vaultRelationshipSchema.optional(),
  }),
);

export type VaultDetails = z.infer<typeof vaultDetailsSchema>;
export type VaultStatsEntry = z.infer<typeof vaultStatsEntrySchema>;

