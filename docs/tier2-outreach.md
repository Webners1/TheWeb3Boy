# Tier 2 outreach drafts

These are drafts. They have not been sent. Phase 2c says do not build
against a venue that has not answered.

Pitch, in every case: independent, benchmark-relative performance
measurement. Venues that are confident in their leads have an interest in
verified numbers. A refusal is itself signal.

## Blofin

Subject: Read access to copy-trading leaderboard history

Hello,

I am building VaultBench, an independent benchmark of crypto vault and
copy-trading performance against BTC/ETH/SOL buy-and-hold. Blofin already
publishes Sharpe, Sortino and Calmar next to ROI — that is rarer than it
should be, and it is why I am writing you first.

I am asking for read access to leaderboard history: lead identity, reported
returns, fee terms, and enough of a timestamped series that a time-weighted
figure can be checked against a buy-and-hold benchmark. I do not need
trading authority, and I will not scrape.

If the numbers hold up, they will sit on a public board beside venues that
already publish a documented API. If they do not, I will say so.

Happy to sign whatever read-only terms you need.

## Copin

Subject: API key for independent copy-trading benchmarks

Hello,

VaultBench compares published copy-trading and vault performance to
BTC/ETH/SOL buy-and-hold. Copin already issues keys against
`api-docs.copin.io` (`X-API-KEY`, e.g. leaderboards-v2). I would like a
key for that documented surface — not a scrape, not a special feed.

The use is read-only: lead identity, protocol, windowed statistics, and
whatever series the endpoint already returns. I will not trade through it.

You already run a key programme. This should be a form, not a negotiation.

## Bybit

Subject: Read-only copy-trading API access for independent benchmarks

Hello,

I am building an independent benchmark of copy-trading performance against
buy-and-hold. Bybit has a documented copy-trading API. Before I request a
key I want to be precise about scope.

I need read access to master-trader identity, published ROI / equity
series, fee terms, and copy mode (Classic / Pro / TradFi). I do not need
order placement, and I do not need Pro-mode position payloads if those are
intentionally opaque — I will record `positions_visible=false` and say so.

Please confirm the permission set a read-only key actually grants, and
what happens to that key if a master portfolio closes. I will not build
against the API until that is in writing.

## Bitget

Subject: Read-only data access for copy-trading measurement

Hello,

Bitget has the largest copy-trading roster I can see. The documented
`/api/v2/copy/mix-trader/create-copy-api` path is trader-side and
contract-focused. That is not what I need.

I am asking for a read-only view of the public leaderboard history: lead
identity, published returns, fee terms, and timestamps. VaultBench will
compare those figures to BTC/ETH/SOL buy-and-hold. I will not scrape, and
I will not place copy orders.

A trader-side key is the wrong instrument for this. If you have a data
grant, or a partner programme that covers historical leaderboard reads, I
would rather use that.
