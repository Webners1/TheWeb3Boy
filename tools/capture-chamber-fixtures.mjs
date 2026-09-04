#!/usr/bin/env node
// One-shot fixture capture for the Chamber (dHEDGE) adapter.
//
// Read-only. Two POSTs to the public, no-auth Data API documented at
// https://docs.chamberfi.com/build/data-api — the same endpoint the adapter
// calls. Writes the responses verbatim into packages/sources/fixtures/chamber
// so the adapter's tests run against real payload shapes rather than shapes we
// imagined.
//
// Run with:  node tools/capture-chamber-fixtures.mjs

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ENDPOINT = 'https://api-v2.dhedge.org/graphql';
const outDir = fileURLToPath(new URL('../packages/sources/fixtures/chamber/', import.meta.url));

async function graphql(query) {
  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': 'vaultbench-fixture-capture' },
    body: JSON.stringify({ query }),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

const FUND_FIELDS = `
  address name symbol managerName managerAddress managerLogicAddress
  blockchainCode poolType category isActive isPrivate
  totalValue totalSupply tokenPrice blockTime
  performanceFeeNumerator managerFeeNumerator streamingFeeNumerator
  entryFeeNumerator exitFeeNumerator
`;

function write(name, payload) {
  const full = path.join(outDir, name);
  writeFileSync(full, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  console.log(`wrote ${path.basename(full)}`);
}

mkdirSync(outDir, { recursive: true });

const funds = await graphql(`{allFundsByBlockchainCode(blockchainCode:"POLYGON"){${FUND_FIELDS}}}`);
const all = funds.data?.allFundsByBlockchainCode ?? [];
console.log(`polygon funds returned: ${all.length}`);

// Keep the fixture small but representative: the largest few by TVL plus any
// inactive vault we can find, because dead vaults are the whole point of the
// on-chain sources.
const byTvl = [...all].sort((left, right) => (BigInt(right.totalValue ?? 0) > BigInt(left.totalValue ?? 0) ? 1 : -1));
const inactive = all.filter((fund) => fund.isActive === false).slice(0, 2);
const sample = [...byTvl.slice(0, 6), ...inactive];
const seen = new Set();
const deduped = sample.filter((fund) => !seen.has(fund.address) && seen.add(fund.address));

write('all-funds-polygon.json', { data: { allFundsByBlockchainCode: deduped } });
write('all-funds-empty.json', { data: { allFundsByBlockchainCode: [] } });

const target = deduped.find((fund) => fund.tokenPrice && fund.tokenPrice !== '0');
if (!target) throw new Error('no fund with a non-zero token price');

// `all` is what the adapter requests. Allowed periods, per the API's own
// error message: 1d, 1w, 1m, 3m, 6m, 1y, all.
const history = await graphql(
  `{tokenPriceHistory(address:"${target.address}",period:"all"){history{timestamp tokenPrice adjustedTokenPrice performance adjustedPerformance}}}`,
);
const points = history.data?.tokenPriceHistory?.history ?? [];
console.log(`history points for ${target.address}: ${points.length}`);
// Trimmed to keep the fixture reviewable; the shape is what matters.
write('token-price-history.json', {
  data: { tokenPriceHistory: { history: points.slice(0, 12) } },
});
write('token-price-history-null.json', {
  data: { tokenPriceHistory: null },
});
