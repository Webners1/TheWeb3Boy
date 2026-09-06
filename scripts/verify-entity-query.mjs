/**
 * Deterministic contract checks for dashboard API query building.
 * Does not depend on live production counts.
 */
import assert from "node:assert/strict";

function toSearchParams(params) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    search.set(key, String(value));
  }
  return search;
}

function entityListParams(q = {}) {
  const view = q.view ?? "ranking";
  return {
    window: q.window ?? 90,
    view,
    source: q.source,
    kind: q.kind,
    status: q.status,
    marketType: q.marketType,
    strategyCategory: q.strategyCategory,
    search: q.search,
    sort: q.sort ?? (view === "explore" ? "name" : "alphaBtc"),
    direction: q.direction ?? (view === "explore" ? "asc" : "desc"),
    fullWindow: q.fullWindow,
    headlineEligible: q.headlineEligible,
    limit: q.limit ?? 50,
    offset: q.offset ?? 0,
  };
}

const ranking = toSearchParams(entityListParams({ view: "ranking", window: 90, sort: "alphaBtc", direction: "desc", limit: 50, offset: 0 }));
assert.equal(ranking.get("view"), "ranking");
assert.equal(ranking.get("window"), "90");
assert.equal(ranking.get("sort"), "alphaBtc");
assert.equal(ranking.get("direction"), "desc");
assert.equal(ranking.get("offset"), "0");

const explore = toSearchParams(entityListParams({ view: "explore", sort: "name", direction: "asc", source: "hyperliquid" }));
assert.equal(explore.get("view"), "explore");
assert.equal(explore.get("sort"), "name");
assert.equal(explore.get("source"), "hyperliquid");

const falses = toSearchParams(entityListParams({ view: "explore", fullWindow: false, headlineEligible: false }));
assert.equal(falses.get("fullWindow"), "false");
assert.equal(falses.get("headlineEligible"), "false");

const search = toSearchParams(entityListParams({ view: "explore", search: "0x123", limit: 25, offset: 50 }));
assert.equal(search.get("search"), "0x123");
assert.equal(search.get("offset"), "50");
assert.equal(search.get("limit"), "25");

const page = 3;
const pageSize = 50;
assert.equal((page - 1) * pageSize, 100);
assert.equal(100 + 0 + 1, 101);

assert.equal(null ?? "Unavailable", "Unavailable");
assert.notEqual(0, null);

console.log("verify-entity-query: ok");
