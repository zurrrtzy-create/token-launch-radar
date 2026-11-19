# Token Radar — method (radar-2)

## The question

From a sealed DefiLlama snapshot (758 protocols, fetched 2026-11-14), which
protocols still record no token and are not a wrapped or staked product of one
that trades, and what would a launch be worth if the protocol's record stayed
as it is? This entry does not predict whether or when a token is issued.

## Scope: the watchlist's definition, without its floor

The board holds 198 rows:

- All 40 protocols on the snapshot's watchlist (TVL ≥ $50M, no token recorded,
  not a wrapped/staked/bridged product).
- Plus 158 pre-token protocols below the floor that pass the same checks the
  house used to draw the list: category not in Bridge, Canonical Bridge,
  Liquid Staking, Liquid Restaking, Restaked BTC or CEX; name carries no whole
  word wrapped/staked/staking; name does not end in a version marker
  (V2, v2, 2.0…); name does not begin with an exchange's name.

Left out on purpose: 144 pre-token protocols — centralised exchanges
(Bybit, Bitfinex, Robinhood…), liquid-staking and bridge products, and
wrapped/staked products of tokens that already trade (WBTC is Bitcoin on
Ethereum, not a protocol waiting on a launch). The snapshot does not carry
DefiLlama's `parentProtocol` field, so that one check could not be run below
the floor; the name and category checks are the ones the file lets this entry
run. A protocol is called pre-token because its snapshot entry records no
token — that is not proof it has none.

## Implied value: peer-anchored, not a flat multiple

```
peer       = median(mcap / TVL) of live peers in the category (n >= 3),
             else the global median 0.214x; clamped to [0.02, 1.5]
base       = TVL x peer
growth     = clamp(7-day TVL change, -50%, +200%); null counts as 0
growthMul  = 1 + growth / 200
age_days   = snapshot date - listed_at; null counts as 365 days
maturity   = 0.7 + 0.3 x min(age_days, 1460) / 1460
breadth    = 1 + 0.02 x min(chains - 1, 10)
implied    = max(1, round(base x growthMul x maturity x breadth))
```

Why peers: a token is worth what the market already pays for the same kind
of business. In this snapshot, live DEXes trade near 0.34x TVL, lending
near 0.13x, RWA near 0.28x, basis trading near 0.65x. A flat multiple would
erase those differences. Categories with fewer than 3 live peers use the
global median (0.214x), so a single outlier — one live protocol at 400x TVL — cannot set a price. The multiple is clamped to [0.02, 1.5].

Why age: a protocol that has run for years with no token has more pent-up
launch value than one listed last month (median age on the board is about
14 months). Why growth: a protocol gaining TVL is worth more than one
shrinking. Why breadth: each extra chain is another market the token would
reach. Ranking is by implied value descending, ties broken by TVL then slug,
so the run is deterministic.

Worked example (rank 1, Steakhouse Financial): TVL $2.75B, Risk Curators
has 1 live peer, so the global median 0.214x applies → base $589M;
7-day change −2.19% → growth factor 0.989; listed 2025-05-20, 543 days old
→ maturity 0.812; 11 chains → breadth 1.20; implied ≈ $567M.

## Farm plans

Each row carries five steps, generated from the protocol's own category,
chains, TVL tier and age: set up on its chain (with a gas estimate for that
chain), the core action for its category (e.g. supply-borrow-repay for
lending, vault deposits for risk curators, swaps or liquidity for DEXes),
a weekly cadence for 8–12 weeks, checking for a points/quests program, and
watching announcements, TVL and the risks. Every step names what it costs
and how long it takes. Steps are suggestions for a reader, not promises:
a launch is never guaranteed, and a token may never come.

## What the program does

`main.ts` (Node 22, standard library only) reads the sealed snapshot,
builds the board with `lib/model.ts`, writes `board.json` and the
dashboard's data (`data.js`), copies `dashboard/` and `screenshots/`,
and writes `dossier.json` with the vendored `vendor/makefun-board.ts`.
The dashboard is a static page with no network: it recomputes each row's
implied value from the snapshot figures in the browser and shows whether
it matches `board.json`. The run is deterministic — the same snapshot
always writes the same bytes.

## Limits

- Market-cap-to-TVL is a crude yardstick: it ignores revenue, fees, token
  supply, vesting and team. It is the best the snapshot supports.
- `change_7d` is a single week; a protocol can spike or crash on noise.
  Growth is clamped and worth at most a 2x / 0.75x swing.
- `listed_at` is when DefiLlama began tracking, not when the protocol
  launched; age is approximate, and 24 pre-token protocols report no date.
- Points programs, airdrop criteria and token plans are not in the
  snapshot; farm plans are category-level guidance, not inside knowledge.
