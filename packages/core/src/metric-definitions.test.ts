import { describe, expect, it } from 'vitest';

import { METRIC_DEFINITIONS, type MetricDefinition } from './metric-definitions.js';

const byKey = new Map(METRIC_DEFINITIONS.map((definition) => [definition.key, definition]));

/**
 * Every `alpha_*` row must point the reader at its `beta_*`, and that beta and
 * its r-squared must exist.
 *
 * Written as a function over an arbitrary definition list, not as inline
 * assertions, so the guard can be pointed at a deliberately broken list and
 * shown to reject it — see the test below. A rule whose check has never failed
 * is a rule nobody has verified.
 */
export function alphaBetaViolations(definitions: readonly MetricDefinition[]): string[] {
  const keys = new Set(definitions.map((definition) => definition.key));
  const violations: string[] = [];

  for (const definition of definitions) {
    if (!definition.key.startsWith('alpha_')) continue;
    const suffix = definition.key.slice('alpha_'.length);

    if (!/beta/i.test(definition.caveats)) {
      violations.push(`${definition.key} caveats do not mention beta`);
    }
    if (!keys.has(`beta_${suffix}`)) violations.push(`beta_${suffix} is not defined`);
    if (!keys.has(`r_squared_${suffix}`)) violations.push(`r_squared_${suffix} is not defined`);
  }

  return violations;
}

describe('metric definitions', () => {
  it('has no duplicate keys', () => {
    expect(byKey.size).toBe(METRIC_DEFINITIONS.length);
  });

  it('says something real in every field', () => {
    for (const definition of METRIC_DEFINITIONS) {
      expect(definition.label.length, definition.key).toBeGreaterThan(0);
      // A definition exists so a model that has never seen our code can read
      // the number. A one-line restatement of the column name does not do
      // that, so require enough text to actually explain something.
      expect(definition.description.length, definition.key).toBeGreaterThan(40);
      expect(definition.caveats.length, definition.key).toBeGreaterThan(20);
    }
  });

  it('never lets alpha be described without pointing at beta', () => {
    /**
     * Trap 21. Alpha is the metric that most invites a ranking, and read
     * alone it credits leverage as skill — "Ethereum Bull 3X tops the table
     * with 174 points of alpha over ETH" is arithmetically true and
     * analytically worthless.
     *
     * This is the check behind the "alpha never travels without beta" row in
     * AGENTS.md. Adding a fourth benchmark without a matching beta, or
     * trimming these caveats, fails here rather than in production.
     */
    expect([...byKey.keys()].filter((key) => key.startsWith('alpha_')).length).toBe(3);
    expect(alphaBetaViolations(METRIC_DEFINITIONS)).toEqual([]);
  });

  it('catches an alpha row that stops pointing at beta', () => {
    // Proving the guard above has teeth. Without this, "alpha never travels
    // without beta" is a sentence in AGENTS.md that nothing has tested.
    const silentAlpha: MetricDefinition[] = [
      {
        key: 'alpha_btc',
        label: 'Alpha vs BTC',
        description: 'Return of the entity minus the return of holding BTC over the window.',
        unit: 'fraction',
        direction: 'higher_is_better',
        caveats: 'Read strategy_category before treating this as a verdict.',
      },
    ];

    expect(alphaBetaViolations(silentAlpha)).toEqual([
      'alpha_btc caveats do not mention beta',
      'beta_btc is not defined',
      'r_squared_btc is not defined',
    ]);
  });

  it('catches a new benchmark added without a beta', () => {
    // The likely future mistake: a fourth benchmark wired through alpha, with
    // beta forgotten.
    const withNewBenchmark: MetricDefinition[] = [
      ...METRIC_DEFINITIONS,
      {
        key: 'alpha_avax',
        label: 'Alpha vs AVAX',
        description: 'Return of the entity minus the return of holding AVAX over the window.',
        unit: 'fraction',
        direction: 'higher_is_better',
        caveats: 'Read beta_avax alongside this before treating it as a verdict.',
      },
    ];

    expect(alphaBetaViolations(withNewBenchmark)).toEqual([
      'beta_avax is not defined',
      'r_squared_avax is not defined',
    ]);
  });

  it('never lets beta be described without pointing at r-squared', () => {
    // A beta of 3 explaining 98% of variance is a leveraged tracker; the same
    // beta explaining 5% is two noisy series coinciding.
    for (const [key, definition] of byKey) {
      if (!key.startsWith('beta_')) continue;
      expect(definition.caveats, `${key} must point at r_squared`).toMatch(/r_squared/);
    }
  });

  it('warns about sampling on every figure sampling can distort', () => {
    // Drawdown, volatility and beta are all computed across steps, so a
    // downsampled series changes the answer rather than just thinning it.
    for (const key of ['max_drawdown', 'volatility', 'beta_btc', 'beta_eth', 'beta_sol']) {
      expect(byKey.get(key)?.caveats, key).toMatch(/downsampled/);
    }
  });
});
