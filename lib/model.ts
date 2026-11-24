// Prelaunch Radar — the model: one sealed snapshot in, one ranked expected-value board out.
//
// Every protocol that records no token (no market cap, no CoinGecko id, no symbol) and is not a
// versioned pool or an exchange is scored by one function, from the snapshot's own figures only:
//
//   comp_mult  = shrunk median of mcap/tvl over the snapshot's LIVE-token protocols of the same
//                category, weighted toward the all-categories median by n/(n+K)   [evidence, not a
//                hand-set constant: the market's own ratios, read from the snapshot]
//   growth_mult= 1 + GROWTH_WEIGHT * clamp(change_7d, -60, +120) / 100              [7-day growth]
//   mature_mult= MATURITY_FLOOR + MATURITY_RANGE * min(age_days, MATURITY_DAYS) / MATURITY_DAYS
//                                                                  [how long it has run with no token]
//   fdv_proxy  = tvl_usd * comp_mult * growth_mult * mature_mult    [what the token may price at]
//   odds       = clamp(ODDS_MIN, ODDS_MAX, ODDS_BASE + ODDS_GROWTH*tanh(growth/ODDS_TANH_SCALE)
//                        + ODDS_AGE * min(age_days, ODDS_AGE_DAYS)/ODDS_AGE_DAYS)  [launch odds]
//   implied    = round(fdv_proxy * odds)                            [expected value of the launch]
//
// No protocol name is ever special-cased: the same function scores every row, and the board's data
// carries each row's factors so a reader can recompute every number on the page.

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

/** The model's weights, stated on the dashboard's Model tab. */
export interface ModelConstants {
  shrink_k: number;
  fallback_multiple: number;
  comp_floor: number;
  comp_cap: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  odds_base: number;
  odds_growth: number;
  odds_tanh_scale: number;
  odds_age: number;
  odds_age_days: number;
  odds_age_unknown: number;
  odds_min: number;
  odds_max: number;
}

export const MODEL: ModelConstants = {
  shrink_k: 4,
  fallback_multiple: 0.25,
  comp_floor: 0.05,
  comp_cap: 10,
  growth_weight: 0.35,
  growth_floor: -60,
  growth_cap: 120,
  maturity_floor: 0.75,
  maturity_range: 0.25,
  maturity_days: 1460,
  odds_base: 0.25,
  odds_growth: 0.18,
  odds_tanh_scale: 45,
  odds_age: 0.28,
  odds_age_days: 900,
  odds_age_unknown: 0.14,
  odds_min: 0.05,
  odds_max: 0.85,
};

export const MODEL_VERSION = 'prelaunch-ev1';

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: null;
  listed_at: string | null;
  gecko_id: null;
  symbol: null;
  token_status: 'pre-token';
  on_watchlist: boolean;
  age_days: number | null;
  implied_value_usd: number;
  model: {
    fdv_proxy_usd: number;
    comp_multiple: number;
    comp_n: number;
    comp_median: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    odds: number;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  on_watchlist: boolean;
  implied_value_usd: number;
  fdv_proxy_usd: number;
  comp_multiple: number;
  comp_n: number;
  growth_pct: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  odds: number;
  farm_steps: string[];
}

/** A live-token protocol: it already trades, so the board shows the market's own value. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number;
  ratio: number;
  change_7d: number | null;
}

/** A category's comp evidence: live sample, median ratio, the multiple the model uses. */
export interface CategoryComp {
  category: string;
  n: number;
  median: number;
  shrunk: number;
}

/** Everything the dashboard renders, from the snapshot. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  watchlist_ranked: number;
  rows: RadarRow[];
  live: LiveRow[];
  categories: CategoryComp[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Whether a protocol is one the board may rank: pre-token, not an exchange, not a versioned pool. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name);
}

/**
 * The watchlist is the floor and is always ranked. Beyond it, the early radar carries only
 * protocols that look like original farming targets: the same wrapped, staked, bridged and
 * exchange-product shapes the house's watchlist rule removes are removed here too, because a
 * wrapped asset has no app to farm and no launch of its own to wait for.
 */
const NOT_A_PRODUCT = /\b(wrapped|staked|staking)\b/i;
const EXCHANGE_PREFIX = /^(binance|coinbase|bybit|kraken|bitget|okx|bitfinex|gemini)\b/i;
const PRODUCT_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX', 'Staking Pool', 'Stablecoin Wrapper']);

export function isFarmableSubject(p: SnapshotProtocol): boolean {
  if (!isRankable(p)) return false;
  if (p.category !== null && PRODUCT_CATEGORIES.has(p.category)) return false;
  if (NOT_A_PRODUCT.test(p.name) || EXCHANGE_PREFIX.test(p.name) || VERSIONED.test(p.name)) return false;
  return true;
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** The median of a finite list of positive numbers. */
function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/**
 * The comp evidence per category: the snapshot's live-token protocols' own mcap/tvl ratios, shrunk
 * toward the all-categories median by n/(n+K) so a category with one listing cannot dominate.
 */
export function categoryComps(snapshot: Snapshot, model: ModelConstants): { perCategory: CategoryComp[]; globalMedian: number } {
  const ratios = new Map<string, number[]>();
  const all: number[] = [];
  for (const p of snapshot.protocols) {
    if (p.mcap_usd === null || p.tvl_usd < 1_000_000 || !Number.isFinite(p.mcap_usd)) continue;
    // A market cap past 10× TVL prices far more than capital locked; it is noise as a comp
    // signal, not evidence. Every ratio is clamped to the model's band before any median.
    const r = clamp(p.mcap_usd / p.tvl_usd, model.comp_floor, model.comp_cap);
    if (!(r > 0) || !Number.isFinite(r)) continue;
    all.push(r);
    if (p.category !== null) {
      const bucket = ratios.get(p.category);
      if (bucket === undefined) ratios.set(p.category, [r]);
      else bucket.push(r);
    }
  }
  const globalMedian = all.length > 0 ? clamp(median(all), model.comp_floor, model.comp_cap) : model.fallback_multiple;
  const perCategory: CategoryComp[] = [...ratios.entries()]
    .map(([category, rs]) => ({
      category,
      n: rs.length,
      median: median(rs),
      shrunk: clamp((rs.length * median(rs) + model.shrink_k * globalMedian) / (rs.length + model.shrink_k), model.comp_floor, model.comp_cap),
    }))
    .sort((a, b) => a.category < b.category ? -1 : a.category > b.category ? 1 : 0);
  return { perCategory, globalMedian };
}

/** The three multipliers, the odds and the implied value one protocol gets under `model`. */
export function scoreProtocol(
  p: SnapshotProtocol,
  asOf: string,
  model: ModelConstants,
  compMultiple: number,
): { implied: number; fdvProxy: number; odds: number; growthPct: number; growthMult: number; maturityMult: number; age: number | null } {
  const age = ageDays(asOf, p.listed_at);
  const growthPct = clamp(finite(p.change_7d, 0), model.growth_floor, model.growth_cap);
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? null;
  const maturityMult =
    ageForModel === null
      ? model.maturity_floor + model.maturity_range * 0.5
      : model.maturity_floor + model.maturity_range * (Math.min(ageForModel, model.maturity_days) / model.maturity_days);
  const fdvProxy = Math.max(1, p.tvl_usd * compMultiple * growthMult * maturityMult);
  const ageTerm =
    ageForModel === null
      ? model.odds_age_unknown
      : model.odds_age * (Math.min(ageForModel, model.odds_age_days) / model.odds_age_days);
  const odds = clamp(model.odds_base + model.odds_growth * Math.tanh(growthPct / model.odds_tanh_scale) + ageTerm, model.odds_min, model.odds_max);
  const implied = Math.max(1, Math.round(fdvProxy * odds));
  return { implied, fdvProxy: Math.round(fdvProxy), odds, growthPct, growthMult, maturityMult, age };
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** Rough one-transaction gas on a chain, in dollars, from a fixed reference table. */
const CHAIN_GAS: Array<[RegExp, number]> = [
  [/solana/i, 0.02],
  [/tron/i, 0.3],
  [/arbitrum|optimism|base|zk ?sync|linea|scroll|mantle|blast|mode/i, 0.15],
  [/bsc|bnb/i, 0.25],
  [/polygon|matic/i, 0.05],
  [/avalanche|avax/i, 0.35],
  [/ton/i, 0.1],
  [/sui|aptos/i, 0.03],
  [/celo|gnosis|fantom|kava|moonbeam/i, 0.2],
  [/ethereum/i, 7],
];

export function gasFor(chains: string[]): number {
  for (const [re, gas] of CHAIN_GAS) {
    if (chains.some((c) => re.test(c))) return gas;
  }
  return 1.5;
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 500;
  if (p.tvl_usd >= 1_000_000_000) return 300;
  if (p.tvl_usd >= 100_000_000) return 150;
  if (p.tvl_usd >= 10_000_000) return 75;
  return 40;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's one core action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) {
    return `Supply $${capital} of USDC into ${p.name} on ${chain}, then open one small borrow (under 25% LTV) so the wallet shows both sides of the market.`;
  }
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged')) {
    return `Provide $${capital} of liquidity to ${p.name}'s deepest pool on ${chain}, weighted the way its largest existing pool is weighted.`;
  }
  if (c.includes('bridge')) {
    return `Bridge $${capital} of USDC to ${chain} through ${p.name}, then use the bridged funds inside ${chain}'s apps so the route is exercised end to end.`;
  }
  if (c.includes('restak') || c.includes('staking')) {
    return `Stake $${capital} of the chain's native asset through ${p.name} and keep the liquid receipt token in the same wallet.`;
  }
  if (c.includes('perp') || c.includes('derivative')) {
    return `Deposit $${capital} of USDC as margin on ${p.name} and open one small position, then close and reopen it weekly.`;
  }
  if (c.includes('basis')) {
    return `Deposit $${capital} into ${p.name}'s basis vault on ${chain} and let the delta-neutral trade run.`;
  }
  if (c.includes('curator') || c.includes('allocator')) {
    return `Deposit $${capital} into a ${p.name} vault on ${chain} and keep the vault shares untouched for the full hold.`;
  }
  if (c.includes('stable')) {
    return `Mint or deposit $${capital} of the stable asset through ${p.name} on ${chain} and hold the receipt.`;
  }
  if (c.includes('rwa')) {
    return `Mint $${capital} of ${p.name}'s yield-bearing asset on ${chain} and hold it across at least two monthly cycles.`;
  }
  if (c.includes('insurance')) {
    return `Buy $${capital} of cover from ${p.name} on ${chain}, keep the policy active, and renew it once.`;
  }
  if (c.includes('payment')) {
    return `Route $${capital} of a payment through ${p.name} on ${chain} in two separate weeks.`;
  }
  if (c.includes('launchpad') || c.includes('governance')) {
    return `Deposit $${capital} and participate in ${p.name}'s governance or launch queue on ${chain} at least twice.`;
  }
  return `Deposit $${capital} of USDC into ${p.name} on ${chain} and keep the position open.`;
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Check the protocol's own docs before acting.`;
  return s;
}

/**
 * A protocol's farm plan: six concrete steps, each an action with a dollar cost and a duration.
 * The plan is derived from the protocol's own record (category, chains, TVL, age), never from a
 * hand-written list of names.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const gas = gasFor(p.chains);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const gasWord = gas < 0.5 ? `$${gas.toFixed(2)}` : `$${gas.toFixed(2)}`;
  const multi = p.chains.length > 1 ? ` It runs on ${p.chains.length} chains; farm on ${chain} first, the deepest one.` : '';
  return [
    {
      text: `Open a fresh wallet that will touch only ${p.name}${multi} and keep its seed phrase offline.`,
      cost: `under $${(gas * 2).toFixed(2)} of gas for the first transfer`,
      time: '10 minutes',
    },
    {
      text: actionFor(p, capital, chain),
      cost: `$${capital} of capital plus about $${gas.toFixed(2)} of gas per transaction`,
      time: '20 minutes to set up',
    },
    {
      text: `Return weekly and make one qualifying action: a top-up, a swap through the app, a vote, or a claim-and-restake.`,
      cost: `about $${gas.toFixed(2)} of gas a week`,
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the wallet is active in several monthly snapshots, not just one.`,
      cost: `the $${capital} stays deployed the whole time`,
      time: `${hold} days`,
    },
    {
      text: `Watch ${p.name}'s own announcements channel for a points program or token news, and never connect the farm wallet to a site you reached from a DM or a comment.`,
      cost: 'no fee, and never pay anyone to "claim" anything',
      time: '5 minutes a week',
    },
    {
      text: `Keep a farm log: wallet address, dates, every transaction hash and the reason, so the position can be repeated after a token event or unwound cleanly.`,
      cost: 'nothing but five minutes',
      time: '5 minutes after each action',
    },
  ];
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL, comps?: CategoryComp[], globalMedian?: number): BoardRow[] {
  const evidence = comps ?? categoryComps(snapshot, model).perCategory;
  const gm = globalMedian ?? categoryComps(snapshot, model).globalMedian;
  const compOf = new Map(evidence.map((c) => [c.category, c.shrunk]));
  const index = bySlug(snapshot.protocols);
  const chosen: SnapshotProtocol[] = [];
  const seen = new Set<string>();
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined && !seen.has(slug)) {
      chosen.push(p);
      seen.add(slug);
    }
  }
  for (const p of snapshot.protocols) {
    if (!seen.has(p.slug) && isFarmableSubject(p)) {
      chosen.push(p);
      seen.add(p.slug);
    }
  }
  const scored = chosen.map((p) => {
    const comp = compOf.get(p.category ?? '') ?? gm;
    const s = scoreProtocol(p, snapshot.as_of, model, comp);
    return { p, comp, ...s };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: null,
    listed_at: s.p.listed_at,
    gecko_id: null,
    symbol: null,
    token_status: 'pre-token' as const,
    on_watchlist: snapshot.watchlist.includes(s.p.slug),
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      fdv_proxy_usd: s.fdvProxy,
      comp_multiple: round4(s.comp),
      comp_n: evidence.find((c) => c.category === (s.p.category ?? ''))?.n ?? 0,
      comp_median: round4(evidence.find((c) => c.category === (s.p.category ?? ''))?.median ?? 0),
      growth_pct: s.growthPct,
      growth_multiplier: round4(s.growthMult),
      maturity_multiplier: round4(s.maturityMult),
      odds: round4(s.odds),
    },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
  }));
}

/** The live-token protocols, by market cap, for the dashboard's Live comps view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.mcap_usd !== null && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd!,
      ratio: round4(p.mcap_usd! / p.tvl_usd),
      change_7d: p.change_7d,
    }));
}

/** A board row's compact form for data.js. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    listed_at: row.listed_at,
    age_days: row.age_days,
    on_watchlist: row.on_watchlist,
    implied_value_usd: row.implied_value_usd,
    fdv_proxy_usd: row.model.fdv_proxy_usd,
    comp_multiple: row.model.comp_multiple,
    comp_n: row.model.comp_n,
    growth_pct: row.model.growth_pct,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    odds: row.model.odds,
    farm_steps: row.farm_steps,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const { perCategory, globalMedian } = categoryComps(snapshot, model);
  const board = buildBoard(snapshot, model, perCategory, globalMedian);
  const live = liveRows(snapshot);
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    watchlist_ranked: board.filter((r) => r.on_watchlist).length,
    rows: board.map(radarRow),
    live: live.slice(0, 120),
    categories: perCategory,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || typeof o.floor_usd !== 'number') throw new SnapshotError('snapshot.json lacks as_of or floor_usd');
  if (!Array.isArray(o.protocols) || !Array.isArray(o.watchlist)) throw new SnapshotError('snapshot.json lacks protocols or watchlist');
  const protocols: SnapshotProtocol[] = (o.protocols as Record<string, unknown>[]).map((p) => ({
    slug: String(p.slug ?? ''),
    name: String(p.name ?? ''),
    category: p.category === null ? null : p.category === undefined ? null : String(p.category),
    chains: Array.isArray(p.chains) ? (p.chains as unknown[]).map(String) : [],
    tvl_usd: finite(p.tvl_usd, 0),
    change_7d: p.change_7d === null || p.change_7d === undefined ? null : finite(p.change_7d, 0),
    mcap_usd: p.mcap_usd === null || p.mcap_usd === undefined ? null : finite(p.mcap_usd, 0),
    listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
    gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
    symbol: typeof p.symbol === 'string' ? p.symbol : null,
  }));
  if (protocols.length === 0) throw new SnapshotError('snapshot.json holds no protocols');
  return {
    as_of: o.as_of,
    source: typeof o.source === 'string' ? o.source : 'sealed snapshot',
    floor_usd: o.floor_usd,
    protocols,
    watchlist: (o.watchlist as unknown[]).map(String),
  };
}

/** Why a finished board would be refused by the gate, or null when it passes. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100) return `only ${board.length} rows: the gate wants 100 to 4,000`;
  if (board.length > 4000) return `${board.length} rows: the gate wants at most 4,000`;
  const slugs = new Set<string>();
  let lastValue = Number.POSITIVE_INFINITY;
  for (let i = 0; i < board.length; i++) {
    const row = board[i]!;
    if (row.rank !== i + 1) return `row ${i}: rank ${row.rank} is out of order`;
    if (slugs.has(row.slug)) return `row ${i}: slug ${row.slug} appears twice`;
    if (!/^\S{1,128}$/.test(row.slug)) return `row ${i}: slug ${row.slug} is not 1..128 characters without whitespace`;
    if (row.implied_value_usd > lastValue) return `row ${i}: implied value rises from the previous row`;
    if (!Number.isInteger(row.implied_value_usd) || row.implied_value_usd <= 0 || row.implied_value_usd > 100_000_000_000_000) {
      return `row ${i}: implied value ${row.implied_value_usd} is out of range`;
    }
    if (!Array.isArray(row.farm_steps) || row.farm_steps.length < 3 || row.farm_steps.length > 12) {
      return `row ${i}: farm_steps holds ${row.farm_steps?.length}`;
    }
    for (const step of row.farm_steps) {
      const t = step.trim();
      if (t.length < 20 || t.length > 600) return `row ${i}: a farm step is ${t.length} characters`;
    }
    slugs.add(row.slug);
    lastValue = row.implied_value_usd;
  }
  const missing = snapshot.watchlist.filter((slug) => !slugs.has(slug));
  if (missing.length > 0) return `the watchlist's first missing slug is ${missing[0]}`;
  return null;
}

/** The dashboard's data as one script: window.RADAR = {...} for the page to read. */
export function dataScript(radar: RadarData): string {
  return `// Generated by main.ts from the sealed snapshot — do not edit.\nwindow.RADAR = ${JSON.stringify(radar)};\n`;
}
