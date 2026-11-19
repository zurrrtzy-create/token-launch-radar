// Token Radar's model (radar-2): one sealed snapshot in, one ranked board out.
//
// The board covers every slug in the snapshot's watchlist (the floor, never the
// ceiling) and extends the watchlist's own definition below the floor: every
// pre-token protocol that passes the same checks the house used to draw the
// list (no token recorded, not a wrapped / staked / bridged product, no version
// marker in its name, no exchange prefix), whatever its TVL. A protocol is
// pre-token when its snapshot entry records no token: no market cap, no
// CoinGecko id, no symbol. Live-token protocols are kept apart and shown as
// the market's own values, never mixed into the ranked board.
//
// Implied value is peer-anchored, never a flat multiple and never a hardcoded
// name. For each category the model takes the median market-cap-to-TVL ratio
// of the live-token protocols in that category (at least 3 peers, or the whole
// snapshot's median when a category has fewer), and applies it to the
// protocol's own TVL:
//
//   peer       = median(mcap/tvl) of live peers in the category (n >= 3),
//                else the global median; clamped to [0.02, 1.5]
//   base       = tvl_usd * peer
//   growth     = clamp(change_7d, -50, 200) per cent; null counts as 0
//   growthMul  = 1 + growth / 200
//   age_days   = as_of - listed_at in days; null counts as 365
//   maturity   = 0.7 + 0.3 * min(age_days, 1460) / 1460
//   breadth    = 1 + 0.02 * min(chains.length - 1, 10)
//   implied    = max(1, round(base * growthMul * maturity * breadth))
//
// Every factor comes from the snapshot's own figures: TVL, seven-day growth,
// how long the protocol has run with no token, and how many chains it runs
// on. The same function scores every row; no protocol name is special-cased.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them. */
export interface ModelConstants {
  peer_min_n: number;
  multiple_floor: number;
  multiple_cap: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  breadth_per_chain: number;
  breadth_max_chains: number;
}

export const MODEL: ModelConstants = {
  peer_min_n: 3,
  multiple_floor: 0.02,
  multiple_cap: 1.5,
  growth_floor: -50,
  growth_cap: 200,
  maturity_floor: 0.7,
  maturity_range: 0.3,
  maturity_days: 1460,
  unknown_age_days: 365,
  breadth_per_chain: 0.02,
  breadth_max_chains: 10,
};

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'radar-2';

/** Categories the watchlist rule leaves out, whatever the TVL. */
const EXCLUDED_CATEGORIES = new Set([
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'CEX',
]);

/** Exchange names a protocol name must not begin with. */
const EXCHANGE_PREFIXES = [
  'Binance',
  'Coinbase',
  'Bybit',
  'Kraken',
  'Bitget',
  'OKX',
  'Bitfinex',
  'Gemini',
];

/** A space followed by V2, v2, 2.0 or the like at the end of a name. */
const VERSION_MARKER = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** A whole word wrapped, staked or staking, in any case. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

/** A protocol records no token when all three token fields are null. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.gecko_id === null && p.symbol === null && p.mcap_usd === null;
}

/**
 * The watchlist's own checks, without its TVL floor: not a wrapped, staked or
 * bridged product, no version marker, no exchange prefix. The snapshot does
 * not carry DefiLlama's parentProtocol field, so that one check cannot be
 * applied below the floor; the name and category checks are the ones the file
 * lets this entry run.
 */
export function passesWatchlistFilters(p: SnapshotProtocol): boolean {
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return false;
  if (VERSION_MARKER.test(p.name)) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  for (const prefix of EXCHANGE_PREFIXES) {
    if (p.name.startsWith(prefix)) return false;
  }
  return true;
}

/** Parse and lightly validate the sealed snapshot. */
export function parseSnapshot(text: string): Snapshot {
  const doc = JSON.parse(text) as Snapshot;
  if (typeof doc.as_of !== 'string' || typeof doc.source !== 'string') {
    throw new Error('snapshot: as_of and source are required');
  }
  if (!Number.isFinite(doc.floor_usd) || !Array.isArray(doc.protocols) || !Array.isArray(doc.watchlist)) {
    throw new Error('snapshot: floor_usd, protocols and watchlist are required');
  }
  for (const p of doc.protocols) {
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || !Number.isFinite(p.tvl_usd)) {
      throw new Error('snapshot: every protocol needs a slug, a name and a TVL');
    }
  }
  return doc;
}

/** Days between two YYYY-MM-DD dates, whole days. */
export function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return MODEL.unknown_age_days;
  return Math.max(0, Math.round((b - a) / 86_400_000));
}

/** The median of a list of numbers, or null when it is empty. */
function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((x, y) => x - y);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** One category's peer multiple: median mcap/TVL of its live-token protocols. */
export interface PeerMultiple {
  category: string;
  n: number;
  median: number | null;
}

/** The peer table: every category with at least one live peer, plus the global. */
export function peerTable(snapshot: Snapshot): { byCategory: PeerMultiple[]; global: number } {
  const byCategory = new Map<string, number[]>();
  const all: number[] = [];
  for (const p of snapshot.protocols) {
    if (isPreToken(p)) continue;
    if (p.mcap_usd === null || p.tvl_usd <= 0) continue;
    const ratio = p.mcap_usd / p.tvl_usd;
    if (!Number.isFinite(ratio) || ratio <= 0) continue;
    all.push(ratio);
    const key = p.category ?? '(no category)';
    const list = byCategory.get(key) ?? [];
    list.push(ratio);
    byCategory.set(key, list);
  }
  const global = median(all) ?? 0.2;
  const table: PeerMultiple[] = [...byCategory.entries()]
    .map(([category, values]) => ({ category, n: values.length, median: median(values) }))
    .sort((a, b) => b.n - a.n || (a.category < b.category ? -1 : 1));
  return { byCategory: table, global };
}

/** The peer multiple a protocol's category earns: its median with n >= 3, else global. */
export function peerMultipleFor(
  p: SnapshotProtocol,
  peers: PeerMultiple[],
  global: number,
): { multiple: number; peer_n: number; peer_source: string } {
  const row = peers.find((r) => r.category === (p.category ?? '(no category)'));
  if (row !== undefined && row.n >= MODEL.peer_min_n && row.median !== null) {
    return {
      multiple: Math.min(MODEL.multiple_cap, Math.max(MODEL.multiple_floor, row.median)),
      peer_n: row.n,
      peer_source: 'category',
    };
  }
  return {
    multiple: Math.min(MODEL.multiple_cap, Math.max(MODEL.multiple_floor, global)),
    peer_n: row !== undefined ? row.n : 0,
    peer_source: 'global',
  };
}

/** The model's arithmetic for one protocol, every factor shown. */
export interface Valuation {
  peer_multiple: number;
  peer_n: number;
  peer_source: string;
  base_usd: number;
  growth_pct: number;
  growth_factor: number;
  age_days: number;
  maturity_factor: number;
  breadth_factor: number;
  implied_value_usd: number;
}

export function valueProtocol(
  p: SnapshotProtocol,
  asOf: string,
  peers: PeerMultiple[],
  global: number,
): Valuation {
  const peer = peerMultipleFor(p, peers, global);
  const base = p.tvl_usd * peer.multiple;
  const growth = Math.min(MODEL.growth_cap, Math.max(MODEL.growth_floor, p.change_7d ?? 0));
  const growthFactor = 1 + growth / 200;
  const age = p.listed_at === null ? MODEL.unknown_age_days : daysBetween(p.listed_at, asOf);
  const maturity = MODEL.maturity_floor + (MODEL.maturity_range * Math.min(age, MODEL.maturity_days)) / MODEL.maturity_days;
  const breadth = 1 + MODEL.breadth_per_chain * Math.min(Math.max(p.chains.length - 1, 0), MODEL.breadth_max_chains);
  const implied = Math.max(1, Math.round(base * growthFactor * maturity * breadth));
  return {
    peer_multiple: peer.multiple,
    peer_n: peer.peer_n,
    peer_source: peer.peer_source,
    base_usd: Math.round(base),
    growth_pct: growth,
    growth_factor: growthFactor,
    age_days: age,
    maturity_factor: maturity,
    breadth_factor: breadth,
    implied_value_usd: implied,
  };
}

// ---------------------------------------------------------------- farm plans

/** One farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** A rough gas label for a chain, for the setup step's cost. */
const CHAIN_GAS: Record<string, string> = {
  Ethereum: '$8–$25 in gas',
  Solana: '$0.05–$0.20 in fees',
  Base: '$0.10–$1 in gas',
  Arbitrum: '$0.10–$1 in gas',
  Optimism: '$0.10–$1 in gas',
  Polygon: '$0.05–$0.50 in gas',
  Binance: '$0.20–$1 in gas',
  Avalanche: '$0.50–$3 in gas',
  Hyperliquid: '$0.10–$1 in gas',
  Sui: '$0.05–$0.20 in fees',
  Aptos: '$0.05–$0.20 in fees',
  Sei: '$0.05–$0.20 in fees',
  Berachain: '$0.10–$1 in gas',
  Sonic: '$0.10–$1 in gas',
};

function gasFor(chain: string): string {
  return CHAIN_GAS[chain] ?? '$1–$5 in gas';
}

/** Working-capital suggestion by TVL tier. */
function capitalFor(tvl: number): string {
  if (tvl >= 500_000_000) return '$1,000–$5,000';
  if (tvl >= 100_000_000) return '$500–$2,000';
  if (tvl >= 25_000_000) return '$100–$500';
  return '$50–$200';
}

/** A tiny deterministic pick: even or odd from a slug's characters. */
function pick<T>(slug: string, options: readonly T[]): T {
  let sum = 0;
  for (const ch of slug) sum += ch.charCodeAt(0);
  return options[sum % options.length]!;
}

/** The core action for a category: what to actually do on the protocol. */
function coreAction(p: SnapshotProtocol, chain: string, capital: string): FarmStep {
  const name = p.name;
  const byCategory: Record<string, readonly [string, string, string][]> = {
    'Risk Curators': [
      [`Deposit ${capital} into one of ${name}'s curated vaults on ${chain} and leave it earning for at least 4 weeks; vault deposits are usually the tracked action.`, 'Your deposit plus gas', '30 min to set up'],
      [`Allocate ${capital} across two of ${name}'s vaults on ${chain} so both positions are on record, then hold them without withdrawing for a month.`, 'Your deposit plus gas', '45 min to set up'],
    ],
    Dexs: [
      [`Swap ${capital} of volume through ${name} pools on ${chain} in 3–4 separate trades across the week, using different pairs so the volume reads as real use.`, 'Your swap size plus gas', '20 min a trade'],
      [`Add ${capital} as liquidity to a ${name} pool on ${chain} and keep the position open for at least 4 weeks, collecting the fees it earns.`, 'Your deposit plus gas', '30 min to set up'],
    ],
    'Onchain Capital Allocator': [
      [`Deposit ${capital} into ${name}'s allocation vaults on ${chain} and hold the position for at least a month; allocators track deposit size and duration.`, 'Your deposit plus gas', '30 min to set up'],
      [`Split ${capital} between two of ${name}'s vaults on ${chain} and leave both untouched for 4 weeks so the allocation history is visible.`, 'Your deposit plus gas', '45 min to set up'],
    ],
    RWA: [
      [`Buy or mint ${capital} of ${name}'s tokenized assets on ${chain} and hold them; RWA protocols usually track holders and holding time.`, 'Your purchase plus gas', '30 min to set up'],
      [`Hold ${capital} of ${name}'s tokenized assets on ${chain} for at least a month and, if it offers one, join its holder program.`, 'Your purchase plus gas', '30 min to set up'],
    ],
    Lending: [
      [`Supply ${capital} as collateral on ${name} on ${chain}, borrow a small amount against it, and repay it; a full supply-borrow-repay cycle is the activity lenders track.`, 'Your collateral plus gas', '45 min for the cycle'],
      [`Lend ${capital} on ${name} on ${chain} and keep the supply open for 4+ weeks; lenders usually score time supplied more than size alone.`, 'Your deposit plus gas', '20 min to set up'],
    ],
    Yield: [
      [`Deposit ${capital} into ${name}'s highest-yield strategy on ${chain} and keep it staked for 4+ weeks; yield farmers are usually scored on time in strategy.`, 'Your deposit plus gas', '30 min to set up'],
      [`Rotate ${capital} through two of ${name}'s strategies on ${chain} over a month, staying at least 2 weeks in each.`, 'Your deposit plus gas', '30 min a move'],
    ],
    Derivatives: [
      [`Open and close ${capital} of positions on ${name} on ${chain} across 2–3 sessions this week, keeping each position small and closing it the same week.`, 'Your margin plus gas', '30 min a session'],
      [`Trade ${capital} of volume on ${name} on ${chain} in several small orders rather than one large one; steady flow reads as real use.`, 'Your trading size plus gas', '20 min a trade'],
    ],
    CDP: [
      [`Open a collateralized position on ${name} on ${chain} with ${capital} of collateral, mint its stable asset, and hold the position for a month.`, 'Your collateral plus gas', '45 min to set up'],
      [`Lock ${capital} of collateral in ${name} on ${chain}, mint a modest amount of its stable asset, and keep the loan healthy for 4+ weeks.`, 'Your collateral plus gas', '45 min to set up'],
    ],
    'Yield Aggregator': [
      [`Deposit ${capital} into ${name}'s auto-compounding vault on ${chain} and let it compound for at least 4 weeks without withdrawing.`, 'Your deposit plus gas', '20 min to set up'],
      [`Put ${capital} in ${name}'s vault on ${chain}, harvest once a week, and restake the harvest so the position keeps growing.`, 'Your deposit plus gas', '15 min a week'],
    ],
    'Basis Trading': [
      [`Deposit ${capital} into ${name}'s basis strategy on ${chain} and hold through at least one full funding cycle; basis traders are scored on capital committed over time.`, 'Your deposit plus gas', '30 min to set up'],
      [`Allocate ${capital} to ${name}'s basis vault on ${chain} for a month, checking the funding rate weekly before adding more.`, 'Your deposit plus gas', '20 min a week'],
    ],
    Chain: [
      [`Bridge ${capital} to ${name} and use its native apps for a week: swaps, staking, and at least one contract interaction a day.`, 'Your funds plus gas', '20 min a day'],
      [`Move ${capital} onto ${name}, stake a part of it, and make a transaction on the chain on 5 different days this week.`, 'Your funds plus gas', '15 min a day'],
    ],
    'Staking Pool': [
      [`Stake ${capital} through ${name}'s pool on ${chain} and keep it staked for 4+ weeks; staking duration is usually the tracked signal.`, 'Your stake plus gas', '20 min to set up'],
      [`Stake ${capital} with ${name} on ${chain}, claim rewards weekly, and restake them so the staked balance grows.`, 'Your stake plus gas', '15 min a week'],
    ],
    'Liquidity Manager': [
      [`Deposit ${capital} into a ${name}-managed liquidity position on ${chain} and rebalance when the range moves out of bounds.`, 'Your deposit plus gas', '30 min to set up'],
      [`Open a ${capital} managed position with ${name} on ${chain} and leave it running for a month, checking the range twice a week.`, 'Your deposit plus gas', '20 min a check'],
    ],
    'Leveraged Farming': [
      [`Open a small leveraged farm on ${name} on ${chain} with ${capital} of collateral, keep leverage under 2x, and monitor the position daily.`, 'Your collateral plus gas', '20 min a day'],
      [`Farm with ${capital} on ${name} on ${chain} at low leverage, harvest weekly, and close the position if health falls near liquidation.`, 'Your collateral plus gas', '15 min a day'],
    ],
    Restaking: [
      [`Restake ${capital} through ${name} on ${chain} and delegate to an operator; restaking points usually accrue by amount and time.`, 'Your stake plus gas', '30 min to set up'],
      [`Restake ${capital} with ${name} on ${chain}, pick an operator with a solid record, and leave the position for at least a month.`, 'Your stake plus gas', '30 min to set up'],
    ],
    'Anchor BTC': [
      [`Bridge or mint ${capital} of BTC through ${name} on ${chain} and use it in a DeFi position for at least 2 weeks.`, 'Your BTC plus gas', '30 min to set up'],
      [`Move ${capital} of BTC into ${name} on ${chain}, lend or stake it, and hold the position for a month.`, 'Your BTC plus gas', '30 min to set up'],
    ],
    'Decentralized BTC': [
      [`Bridge ${capital} of BTC through ${name} on ${chain} and deploy it in a lending or liquidity position for at least 2 weeks.`, 'Your BTC plus gas', '30 min to set up'],
      [`Mint ${capital} of ${name}'s BTC-backed asset on ${chain} and hold it in a yield position for a month.`, 'Your BTC plus gas', '30 min to set up'],
    ],
    CeDeFi: [
      [`Deposit ${capital} with ${name} on ${chain} and use its CeFi-linked yield product; keep the deposit for a full month.`, 'Your deposit plus gas', '30 min to set up'],
      [`Allocate ${capital} to ${name}'s yield product on ${chain} and check its weekly return before adding more.`, 'Your deposit plus gas', '20 min a week'],
    ],
    'Dual-Token Stablecoin': [
      [`Mint ${capital} of ${name}'s stable asset on ${chain} against collateral and hold it; mint-and-hold is the tracked behaviour.`, 'Your collateral plus gas', '30 min to set up'],
      [`Lock ${capital} of collateral in ${name} on ${chain}, mint its stable asset, and keep the position open for 4+ weeks.`, 'Your collateral plus gas', '30 min to set up'],
    ],
    Farm: [
      [`Deposit ${capital} into ${name}'s farms on ${chain} and harvest rewards weekly; keep the position open for 4+ weeks.`, 'Your deposit plus gas', '20 min a week'],
      [`Stake ${capital} in ${name}'s farm on ${chain}, compound the harvest, and hold the position for at least a month.`, 'Your deposit plus gas', '20 min a week'],
    ],
  };
  const options = byCategory[p.category ?? ''] ?? [
    [`Use ${name}'s main product on ${chain} with ${capital} of capital and repeat weekly; real, repeated use is what most protocols track.`, 'Your deposit plus gas', '30 min a week'],
    [`Open a ${capital} position on ${name} on ${chain}, use it at least once a week, and keep it open for a month.`, 'Your deposit plus gas', '20 min a week'],
  ];
  const chosen = pick(p.slug, options);
  return { text: chosen[0], cost: chosen[1], time: chosen[2] };
}

/** The five-step farm plan for one protocol. */
export function farmPlan(p: SnapshotProtocol, valuation: Valuation): FarmStep[] {
  const chain = p.chains[0] ?? 'Ethereum';
  const capital = capitalFor(p.tvl_usd);
  const gas = gasFor(chain);
  const tvl = `$${p.tvl_usd.toLocaleString('en-US')}`;
  const growth =
    p.change_7d === null
      ? 'no 7-day change reported'
      : `${p.change_7d > 0 ? '+' : ''}${p.change_7d.toFixed(2)}% over 7 days`;
  return [
    {
      text: `Set up a wallet on ${chain}, one of the chains ${p.name} runs on, and fund it with ${capital} of working capital plus about ${gas} for fees; bridging in takes 15–30 minutes.`,
      cost: `${gas} plus your deposit`,
      time: '30 min',
    },
    coreAction(p, chain, capital),
    {
      text: `Repeat the core action every week for 8–12 weeks: protocols that do launch usually weight months of steady use far above a single large deposit.`,
      cost: `Gas only, about ${gas} a week`,
      time: '30 min a week',
    },
    {
      text: `Check ${p.name}'s docs and official X account for a points, quests or leaderboard program; if one exists, complete every listed task and keep a record of each. If none exists, the on-chain activity above is still the record.`,
      cost: 'Free',
      time: '20 min',
    },
    {
      text: `Watch ${p.name}'s announcements and its TVL — ${tvl} now, ${growth} — and never deposit money you cannot afford to lose; a launch is never promised, and a token may never come.`,
      cost: 'Free',
      time: '10 min a week',
    },
  ];
}

// ---------------------------------------------------------------- the board

/** One ranked board row: the gate's fields plus the model's working. */
export interface BoardRow {
  slug: string;
  name: string;
  rank: number;
  implied_value_usd: number;
  farm_steps: string[];
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  age_days: number;
  listed_at: string | null;
  peer_multiple: number;
  peer_n: number;
  peer_source: string;
  growth_factor: number;
  maturity_factor: number;
  breadth_factor: number;
  watchlist: boolean;
  farm_plan: FarmStep[];
}

/** One live-token protocol for the dashboard's peer view. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  tvl_usd: number;
  mcap_usd: number;
  multiple: number;
}

/** Everything the dashboard needs, written to data.js beside the page. */
export interface RadarData {
  meta: {
    as_of: string;
    source: string;
    floor_usd: number;
    protocols: number;
    pre_token: number;
    watchlist: number;
    board_rows: number;
    model: string;
  };
  model: ModelConstants & { global_multiple: number };
  peers: PeerMultiple[];
  rows: BoardRow[];
  live: LiveRow[];
}

/** Build the ranked board from the snapshot. */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const { byCategory, global } = peerTable(snapshot);
  const watchlist = new Set(snapshot.watchlist);
  const scoped = snapshot.protocols.filter((p) => isPreToken(p) && passesWatchlistFilters(p));
  const valued = scoped.map((p) => ({ p, v: valueProtocol(p, snapshot.as_of, byCategory, global) }));
  valued.sort((a, b) => {
    if (b.v.implied_value_usd !== a.v.implied_value_usd) return b.v.implied_value_usd - a.v.implied_value_usd;
    if (b.p.tvl_usd !== a.p.tvl_usd) return b.p.tvl_usd - a.p.tvl_usd;
    return a.p.slug < b.p.slug ? -1 : 1;
  });
  const board: BoardRow[] = valued.map(({ p, v }, i) => {
    const plan = farmPlan(p, v);
    return {
      slug: p.slug,
      name: p.name,
      rank: i + 1,
      implied_value_usd: v.implied_value_usd,
      farm_steps: plan.map((s) => s.text),
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      age_days: v.age_days,
      listed_at: p.listed_at,
      peer_multiple: v.peer_multiple,
      peer_n: v.peer_n,
      peer_source: v.peer_source,
      growth_factor: v.growth_factor,
      maturity_factor: v.maturity_factor,
      breadth_factor: v.breadth_factor,
      watchlist: watchlist.has(p.slug),
      farm_plan: plan,
    };
  });
  const live: LiveRow[] = snapshot.protocols
    .filter((p) => !isPreToken(p) && p.mcap_usd !== null && p.tvl_usd > 0)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd as number,
      multiple: (p.mcap_usd as number) / p.tvl_usd,
    }))
    .sort((a, b) => b.mcap_usd - a.mcap_usd)
    .slice(0, 40);
  const radar: RadarData = {
    meta: {
      as_of: snapshot.as_of,
      source: snapshot.source,
      floor_usd: snapshot.floor_usd,
      protocols: snapshot.protocols.length,
      pre_token: snapshot.protocols.filter(isPreToken).length,
      watchlist: snapshot.watchlist.length,
      board_rows: board.length,
      model: MODEL_VERSION,
    },
    model: { ...MODEL, global_multiple: global },
    peers: byCategory,
    rows: board,
    live,
  };
  return { board, radar };
}

/** The gate's shape, checked before anything is written. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `board holds ${board.length} rows, needs 100 to 4000`;
  const slugs = new Set<string>();
  for (let i = 0; i < board.length; i++) {
    const row = board[i]!;
    if (slugs.has(row.slug)) return `slug ${row.slug} appears twice`;
    slugs.add(row.slug);
    if (row.rank !== i + 1) return `row ${row.slug} carries rank ${row.rank}, expected ${i + 1}`;
    if (!Number.isInteger(row.implied_value_usd) || row.implied_value_usd <= 0) {
      return `row ${row.slug} has a bad implied value`;
    }
    if (i > 0 && row.implied_value_usd > board[i - 1]!.implied_value_usd) {
      return `row ${row.slug} is worth more than the row ranked above it`;
    }
    if (row.farm_steps.length < 3 || row.farm_steps.length > 12) {
      return `row ${row.slug} has ${row.farm_steps.length} farm steps, needs 3 to 12`;
    }
    for (const step of row.farm_steps) {
      const trimmed = step.trim();
      if (trimmed.length < 20 || trimmed.length > 600) {
        return `row ${row.slug} has a farm step of ${trimmed.length} characters, needs 20 to 600`;
      }
    }
  }
  if (board.every((r) => r.implied_value_usd === board[0]!.implied_value_usd)) {
    return 'every row carries the same implied value: not a ranking';
  }
  for (const slug of snapshot.watchlist) {
    if (!slugs.has(slug)) return `watchlist slug ${slug} is missing from the board`;
  }
  return null;
}

/** The dashboard's data file, beside the page. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
