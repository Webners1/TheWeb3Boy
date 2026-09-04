/**
 * The semantics of every published number, in the database rather than in a
 * React component.
 *
 * `alpha_btc` means nothing to a model on its own. A row explaining that it is
 * the entity's return minus the return of holding BTC over the same window,
 * net of entity fees, positive-is-better, unreliable when
 * `sampling='downsampled'` means everything. This table is what makes the
 * dataset readable by an agent that has never seen our code.
 */
export interface MetricDefinition {
  key: string;
  label: string;
  description: string;
  unit: 'fraction' | 'days' | 'boolean' | 'enum';
  direction: 'higher_is_better' | 'lower_is_better' | 'neutral';
  caveats: string;
}

const DOWNSAMPLED_CAVEAT =
  "Unreliable when sampling='downsampled': backfilled Hyperliquid history is ~93 points " +
  'across a vault lifetime, so intermediate moves are absent.';

export const METRIC_DEFINITIONS: readonly MetricDefinition[] = [
  {
    key: 'twr',
    label: 'Time-weighted return',
    description:
      'Return of the entity over the window, computed from its per-unit value series as ' +
      'v[end]/v[start] - 1 and therefore unaffected by deposits and withdrawals. Net of ' +
      'the venue fees recorded for the entity.',
    unit: 'fraction',
    direction: 'higher_is_better',
    caveats:
      "Comparable across entities when nav_quality is 'reported' or 'derived'. Rows with " +
      "nav_quality='roi' are venue-published money-weighted returns, are not time-weighted, " +
      'and are excluded from headline rankings. ' +
      DOWNSAMPLED_CAVEAT,
  },
  {
    key: 'bench_twr_btc',
    label: 'BTC buy-and-hold return',
    description:
      'Return of buying BTC on the window start date and holding to the window end date, ' +
      'less one entry swap cost of 10 basis points.',
    unit: 'fraction',
    direction: 'neutral',
    caveats: 'Same start and end dates as the entity window, so the two are directly comparable.',
  },
  {
    key: 'bench_twr_eth',
    label: 'ETH buy-and-hold return',
    description:
      'Return of buying ETH on the window start date and holding to the window end date, ' +
      'less one entry swap cost of 10 basis points.',
    unit: 'fraction',
    direction: 'neutral',
    caveats: 'Same start and end dates as the entity window, so the two are directly comparable.',
  },
  {
    key: 'bench_twr_sol',
    label: 'SOL buy-and-hold return',
    description:
      'Return of buying SOL on the window start date and holding to the window end date, ' +
      'less one entry swap cost of 10 basis points.',
    unit: 'fraction',
    direction: 'neutral',
    caveats: 'Same start and end dates as the entity window, so the two are directly comparable.',
  },
  {
    key: 'alpha_btc',
    label: 'Alpha vs BTC',
    description:
      'Return of the entity minus the return of holding BTC over the same window, net of ' +
      'entity fees. Positive means the entity beat the benchmark.',
    unit: 'fraction',
    direction: 'higher_is_better',
    caveats:
      'A market-neutral strategy losing to BTC in a bull run is not underperforming; read ' +
      'strategy_category before treating this as a verdict. ' +
      DOWNSAMPLED_CAVEAT,
  },
  {
    key: 'alpha_eth',
    label: 'Alpha vs ETH',
    description:
      'Return of the entity minus the return of holding ETH over the same window, net of ' +
      'entity fees. Positive means the entity beat the benchmark.',
    unit: 'fraction',
    direction: 'higher_is_better',
    caveats: 'Read strategy_category before treating this as a verdict. ' + DOWNSAMPLED_CAVEAT,
  },
  {
    key: 'alpha_sol',
    label: 'Alpha vs SOL',
    description:
      'Return of the entity minus the return of holding SOL over the same window, net of ' +
      'entity fees. Positive means the entity beat the benchmark.',
    unit: 'fraction',
    direction: 'higher_is_better',
    caveats: 'Read strategy_category before treating this as a verdict. ' + DOWNSAMPLED_CAVEAT,
  },
  {
    key: 'max_drawdown',
    label: 'Maximum drawdown',
    description:
      'Largest peak-to-trough decline of the per-unit value series within the window, as a ' +
      'non-negative fraction of the peak.',
    unit: 'fraction',
    direction: 'lower_is_better',
    caveats:
      'A drawdown computed from a downsampled series understates the true figure, possibly ' +
      'badly, because the troughs between observations are not in the data. ' +
      DOWNSAMPLED_CAVEAT,
  },
  {
    key: 'volatility',
    label: 'Annualised volatility',
    description:
      'Sample standard deviation of per-step returns within the window, scaled to a year ' +
      'using the observed mean spacing between observations rather than an assumed daily ' +
      'cadence.',
    unit: 'fraction',
    direction: 'lower_is_better',
    caveats:
      'Scaling an irregular ~biweekly series is approximate. ' + DOWNSAMPLED_CAVEAT,
  },
  {
    key: 'follower_median_return',
    label: 'Median depositor return',
    description:
      'Median of all_time_pnl / (equity - all_time_pnl) across the depositor cross-section ' +
      'observed on the window end date. What the typical investor actually realised.',
    unit: 'fraction',
    direction: 'higher_is_better',
    caveats:
      'Only depositors with a positive implied cost basis are counted; fully withdrawn ' +
      'depositors cannot be computed and are excluded. The cross-section decays as ' +
      'depositors exit, so it is only ever as complete as the day it was captured.',
  },
  {
    key: 'follower_gap',
    label: 'Lead-versus-follower gap',
    description:
      'Headline entity return minus the median realised depositor return. Positive means ' +
      "the advertised number flattered the vault relative to its own investors' outcomes.",
    unit: 'fraction',
    direction: 'lower_is_better',
    caveats:
      'Requires a depositor cross-section, so it exists only for venues that publish one ' +
      '(Hyperliquid followers, OKX copy traders). Depositor returns are since their own ' +
      'entry, not over this window, so treat the gap as directional rather than exact.',
  },
  {
    key: 'days_covered',
    label: 'Days covered',
    description:
      'Observed span of the window in days, from the first to the last available ' +
      'observation inclusive.',
    unit: 'days',
    direction: 'neutral',
    caveats: 'Lower than window_days means the entity has less history than the window asked for.',
  },
  {
    key: 'is_full_window',
    label: 'Full window',
    description:
      'True when the entity has history covering the whole requested window. False means ' +
      'the figures are since inception and must be labelled as such.',
    unit: 'boolean',
    direction: 'neutral',
    caveats: 'Never compare a false row against a true row of the same window_days.',
  },
  {
    key: 'sampling',
    label: 'Sampling resolution',
    description:
      "'daily' when every observation in the window came from a same-day read; " +
      "'downsampled' when any observation came from Hyperliquid's coarse allTime series.",
    unit: 'enum',
    direction: 'neutral',
    caveats: 'A mixed window degrades to downsampled — it is only as good as its coarsest point.',
  },
  {
    key: 'nav_quality',
    label: 'NAV quality',
    description:
      "'reported' when the venue published a true per-unit NAV or share price; 'derived' " +
      'when the per-unit series was reconstructed from account value net of flows; ' +
      "'roi' when the venue published only a money-weighted return.",
    unit: 'enum',
    direction: 'neutral',
    caveats:
      "'roi' rows are excluded from headline rankings. Mixing money-weighted ROI with " +
      'time-weighted return is the error this column exists to prevent. A venue-published ' +
      'share price is more trustworthy than our reconstruction, not less.',
  },
];
