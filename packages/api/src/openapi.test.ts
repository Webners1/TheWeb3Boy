import { describe, expect, it } from 'vitest';

import { specOf } from './spec.js';

const spec = specOf() as {
  openapi: string;
  info: { title: string; description: string };
  paths: Record<string, Record<string, unknown>>;
  components: { schemas: Record<string, any> };
};

/**
 * The contract, checked as a contract.
 *
 * AGENTS.md says every published figure carries its coverage. Up to now that
 * was a convention held by whoever wrote the handler. These tests make the
 * generated spec the enforcement point: dropping `daysCovered` from a
 * response, or making it optional, fails the build.
 */
describe('published contract', () => {
  it('covers every route the plan calls for', () => {
    expect(Object.keys(spec.paths).sort()).toEqual(
      [
        '/compare',
        '/entities',
        '/entities/{id}',
        '/entities/{id}/followers',
        '/entities/{id}/series',
        '/metrics/definitions',
      ].sort(),
    );
  });

  it('is OpenAPI 3.1, so the schemas are real JSON Schema', () => {
    expect(spec.openapi).toBe('3.1.0');
  });
});

describe('coverage travels with every figure', () => {
  const coverage = () => spec.components.schemas.Coverage;

  it('requires the three fields a figure cannot be defended without', () => {
    // "Never publish a number you cannot defend." If these become optional a
    // client can render a 90-day return built from 4 days of data with
    // nothing on screen to say so.
    for (const field of ['windowDays', 'daysCovered', 'isFullWindow', 'sampling']) {
      expect(coverage().required).toContain(field);
    }
  });

  it('requires the two flags that decide whether a figure may be ranked', () => {
    expect(coverage().required).toContain('headlineEligible');
    expect(coverage().required).toContain('feesApplied');
  });

  it('attaches coverage to the metrics object itself, not beside it', () => {
    // Beside it means a client can pick up the number and drop the caveat.
    expect(spec.components.schemas.Metrics.required).toContain('coverage');
  });

  it('names all three NAV qualities, so `roi` is visible to a client', () => {
    const property = coverage().properties.navQuality;
    const values = JSON.stringify(property);
    for (const quality of ['reported', 'derived', 'roi']) {
      expect(values).toContain(quality);
    }
  });
});

describe('money never crosses the wire as a float', () => {
  const moneyFields = [
    ['Metrics', 'twr'],
    ['Metrics', 'alphaBtc'],
    ['Metrics', 'betaBtc'],
    ['Metrics', 'rSquaredBtc'],
    ['Metrics', 'followerGap'],
    ['NavPoint', 'valuePerUnit'],
    ['IndexPoint', 'value'],
    ['Follower', 'equity'],
    ['Entity', 'managerStakeRatio'],
    ['Entity', 'pendingRedemptionsUsd'],
  ] as const;

  it.each(moneyFields)('%s.%s is a string', (schema, field) => {
    // A JSON number is an IEEE-754 double. Publishing one would reintroduce
    // at the API boundary exactly the error the numeric columns prevent.
    const property = spec.components.schemas[schema].properties[field];
    const types = JSON.stringify(property);
    expect(types).toContain('string');
    expect(types).not.toMatch(/"type":\s*"number"/);
  });
});

describe('the spec explains itself', () => {
  it('states the string-money rule where an integrator will read it', () => {
    expect(spec.info.description).toMatch(/Money is a string/);
  });

  it('warns that excluding dead entities is what makes a leaderboard wrong', () => {
    expect(spec.info.description).toMatch(/delisted/i);
  });

  it('documents when each metric misleads', () => {
    expect(spec.components.schemas.MetricDefinition.properties.caveats.description).toMatch(
      /misleads/i,
    );
  });
});
