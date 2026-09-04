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
 * figure — hence `net`, and hence excluded from headline rankings by
 * `nav_quality='reported'`.
 */
const FEE_BASIS: Record<string, FeeBasis> = {
  hyperliquid: 'gross',
  okx: 'net',
  enzyme: 'net',
  chamber: 'net',
};

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
