import { z } from 'zod';
import { optionalEpochMillisWire, epochMillisWire, wireDecimal } from '@vaultbench/shared';

export const okxEnvelope = <T extends z.ZodType>(data: T) =>
  z.object({
    code: z.string(),
    msg: z.string().optional(),
    data: data,
  });

export const okxPnlRatioPointSchema = z.object({
  beginTs: epochMillisWire,
  pnlRatio: wireDecimal,
});

export const okxLeadRankSchema = z.object({
  uniqueCode: z.string().min(1),
  nickName: z.string(),
  aum: wireDecimal,
  ccy: z.string(),
  pnl: wireDecimal,
  pnlRatio: wireDecimal,
  copyState: z.string().optional(),
  copyTraderNum: z.string().optional(),
  maxCopyTraderNum: z.string().optional(),
  accCopyTraderNum: z.string().optional(),
  leadDays: z.string().optional(),
  winRatio: wireDecimal.optional(),
  portLink: z.string().optional(),
  traderInsts: z.array(z.string()).optional(),
  pnlRatios: z.array(okxPnlRatioPointSchema).optional(),
});

export const okxLeadTradersPageSchema = okxEnvelope(
  z.array(
    z.object({
      dataVer: z.string(),
      totalPage: z.string(),
      ranks: z.array(okxLeadRankSchema),
    }),
  ),
);

export const okxDailyPnlSchema = okxEnvelope(
  z.array(
    z.object({
      beginTs: epochMillisWire,
      pnl: wireDecimal,
      pnlRatio: wireDecimal,
    }),
  ),
);

export const okxStatsSchema = okxEnvelope(
  z.array(
    z.object({
      avgSubPosNotional: wireDecimal.optional(),
      ccy: z.string().optional(),
      curCopyTraderPnl: wireDecimal.optional(),
      investAmt: wireDecimal.optional(),
      lossDays: z.string().optional(),
      profitDays: z.string().optional(),
      winRatio: wireDecimal.optional(),
    }),
  ),
);

export const okxCopyTraderSchema = z.object({
  beginCopyTime: epochMillisWire,
  nickName: z.string().min(1),
  pnl: wireDecimal,
  portLink: z.string().optional(),
});

export const okxCopyTradersSchema = okxEnvelope(
  z.array(
    z.object({
      ccy: z.string().optional(),
      copyTotalPnl: wireDecimal.optional(),
      copyTraderNumChg: z.string().optional(),
      copyTraderNumChgRatio: wireDecimal.optional(),
      copyTraders: z.array(okxCopyTraderSchema),
    }),
  ),
);

export const okxSubpositionHistorySchema = okxEnvelope(
  z.array(
    z
      .object({
        instId: z.string().optional(),
        instType: z.string().optional(),
        subPos: wireDecimal.optional(),
        openTime: optionalEpochMillisWire,
        closeTime: optionalEpochMillisWire,
        pnl: wireDecimal.optional(),
        uniqueCode: z.string().optional(),
      })
      .catchall(z.unknown()),
  ),
);

export type OkxLeadRank = z.infer<typeof okxLeadRankSchema>;
export type OkxInstType = 'SPOT' | 'SWAP';
