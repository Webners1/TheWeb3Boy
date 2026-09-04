import type { FeeBasis, FeeProfile } from '@vaultbench/core';
import { Decimal, parseDecimal } from '@vaultbench/shared';

/**
 * Whether each venue's published figures are already net of its own fees.
 *
 * `gross` — the venue reports trading PnL before the manager's cut, so we
 *           apply the recorded profit share and management fee ourselves.
 * `net`   — the venue reports what an investor actually received; applying
 *           the haircut again would slander the manager.
 *
 * Hyperliquid is treated as gross: `pnlHistory` is the vault account's
 * trading PnL, and `leaderCommission` is distributed out of it. If that turns
 * out to be backwards we will have understated returns, which for a benchmark
 * product is the safe direction to be wrong in. Listed as an open
 * verification item in docs/traps.md.
 *
 * OKX publishes money-weighted ROI, which is already an investor-experienced
 * figure — hence `net`. Its exclusion from headline rankings is a separate
 * judgement, made by `RANKABLE` below, not by the fee basis.
 */
const FEE_BASIS: Record<string, FeeBasis> = {
  hyperliquid: 'gross',
  okx: 'net',
  // Enzyme's time series field is `net_share_value` — the vendor's own
  // protobuf names it as net, and fees accrue against the share price on
  // chain. Applying a haircut on top would double-count.
  enzyme: 'net',
  // dHEDGE takes its performance fee by minting manager shares, which
  // dilutes the token price. The published price is therefore already net.
  chamber: 'net',
  // Drift takes management and performance fees as shares minted to the
  // manager, same dilution mechanism as Chamber. The share price is net.
  drift: 'net',
};

/**
 * Whether a venue's inputs are verified well enough to rank its entities
 * against others.
 *
 * This is deliberately separate from `nav_quality`. Quality describes what
 * kind of number we have; this describes how much we trust the venue's
 * semantics. OKX is excluded because `public-lead-traders.pnl` is a *ranked
 * period* figure, not cumulative since inception — differencing it as if it
 * were cumulative would silently produce nonsense. The rows are still
 * ingested and still get metrics; they just do not appear in headline
 * rankings until someone verifies the field. See docs/traps.md.
 */
const RANKABLE: Record<string, boolean> = {
  hyperliquid: true,
  chamber: true,
  enzyme: true,
  drift: true,
  okx: false,
};

export function isSourceRankable(source: string): boolean {
  return RANKABLE[source] ?? false;
}

/**
 * Headline ranking is four independent nos, any one of which is enough:
 * the number's quality, the venue's verified semantics, how we obtained
 * the row, and whether the instrument is even the same kind of thing.
 *
 * Wallets and scrapes are stored. They are never ranked beside a vault
 * that came from a documented API.
 */
export function isHeadlineRankable(input: {
  source: string;
  provenance: string;
  kind: string;
  navEligible: boolean;
}): boolean {
  return (
    input.navEligible &&
    isSourceRankable(input.source) &&
    input.provenance !== 'scraped' &&
    input.kind !== 'wallet'
  );
}

export interface RecordedFees {
  feeProfitShare: string | null;
  feeManagement: string | null;
  leaderCommission: string | null;
}

export function feeProfileFor(source: string, recorded: RecordedFees | undefined): FeeProfile {
  const basis = FEE_BASIS[source] ?? 'gross';

  // Hyperliquid expresses the manager's cut as `leaderCommission`; other
  // venues use an explicit profit share. Whichever is present wins; if both
  // are, the larger is the honest choice.
  const profitShare = maxOf(
    optionalDecimal(recorded?.feeProfitShare),
    optionalDecimal(recorded?.leaderCommission),
  );

  const profile: FeeProfile = { basis };
  if (profitShare !== undefined) profile.profitShare = profitShare;
  const management = optionalDecimal(recorded?.feeManagement);
  if (management !== undefined) profile.managementFee = management;
  return profile;
}

function maxOf(left: Decimal | undefined, right: Decimal | undefined): Decimal | undefined {
  if (left === undefined) return right;
  if (right === undefined) return left;
  return left.gte(right) ? left : right;
}

function optionalDecimal(value: string | null | undefined): Decimal | undefined {
  if (value === null || value === undefined) return undefined;
  const parsed = parseDecimal(value);
  return parsed.isZero() ? undefined : parsed;
}
