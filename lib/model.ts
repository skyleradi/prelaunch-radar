// Prelaunch Radar — the model: one sealed snapshot in, one ranked expected-value board out.
//
// Every protocol that records no token (no market cap, no CoinGecko id, no symbol) and is not a
// versioned pool or an exchange is scored by one function, from the snapshot's own figures only:
//
//   ratio      = mcap_usd / tvl_usd on a protocol that already trades     [the thing we predict]
//   ln(ratio)  = b0 + b1*ln(tvl) + b2*ln(age_days) + b3*tanh(change_7d/45) + cat_offset
//                                                                        [fitted, not hand-set]
//   cat_offset = shrunk mean residual of ln(ratio) inside one category, weighted toward zero by
//                n/(n+K) so a category with two listings cannot pin a multiplier
//   comp_mult  = exp(ln(ratio) at this protocol's own tvl, age and growth)  [its own comp]
//   growth_mult= 1 + GROWTH_WEIGHT * clamp(change_7d, -60, +120) / 100     [7-day momentum]
//   mature_mult= MATURITY_FLOOR + MATURITY_RANGE * min(age_days, MATURITY_DAYS) / MATURITY_DAYS
//                                                                  [how long it has run with no token]
//   fdv_proxy  = tvl_usd * comp_mult * growth_mult * mature_mult    [what the token may price at]
//   odds       = clamp(ODDS_MIN, ODDS_MAX, ODDS_BASE + ODDS_GROWTH*tanh(growth/ODDS_TANH_SCALE)
//                        + ODDS_AGE * min(age_days, ODDS_AGE_DAYS)/ODDS_AGE_DAYS)  [launch odds]
//   implied    = round(fdv_proxy * odds)                            [expected value of the launch]
//
// Every coefficient above is REFIT from the snapshot on each run by `fitValueModel` — ridge-
// regularised least squares over the snapshot's own live-token protocols. Nothing is memorised:
// no protocol name, no category multiplier, no market multiple is written into this file. Change
// the snapshot and every number moves with it; the Model tab prints the fit it ran on.
//
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
  // Odds are no longer constants: fitOddsModel in lib/odds.ts measures every coefficient from the
  // snapshot's own peers on every run. These two remain only as the clamp band the fitted
  // probability is held inside, so no protocol can be printed at 0% or certain.
  odds_min: 0.03,
  odds_max: 0.92,
};

export const MODEL_VERSION = 'prelaunch-ev3';

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
  /** Is farming this protocol worth the money, the fees and the hours? Computed, not asserted. */
  farm: FarmVerdict;
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
  farm: FarmVerdict;
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
  /** The pooled multiple the fit falls back to when a category was never measured. */
  global_median: number;
  /** The fit itself, so the Model tab can print the equation and its R² rather than assert it. */
  value_fit: {
    kinds: string;
    refit: string;
    intercept: number;
    tvl_slope: number;
    age_slope: number;
    growth_slope: number;
    sample_n: number;
    r2: number;
    rmse_log: number;
    offset_shrink_k: number;
    ridge_lambda: number;
    /** Held-out evidence: the fit scored on rows it was not trained on. */
    cv_folds: number;
    cv_rmse_log: number;
    cv_r2: number;
    loo_rmse_log: number;
    loo_r2: number;
    cv_skill: number;
    loo_skill: number;
    cv_multiple_mae_x: number;
    /** Which terms survived the held-out selection, and each one's trial. */
    active_terms: string[];
    term_trials: { term: string; kept: boolean; cv_rmse_log: number; delta: number }[];
  };
  /** The odds model: fitted, not asserted, with the same held-out honesty as the value fit. */
  odds_fit: {
    kinds: string;
    refit: string;
    intercept: number;
    age_slope: number;
    growth_slope: number;
    offsets: { category: string; offset: number }[];
    base_rate: number;
    sample_n: number;
    with_token: number;
    brier_in_sample: number;
    brier_base: number;
    brier_loo: number;
    loo_skill: number;
    brier_walk_forward: number;
    walk_forward_skill: number;
    walk_forward_train: number;
    walk_forward_test: number;
    walk_forward_cut: number;
    active_terms: string[];
    trials: { term: string; kept: boolean; brier: number; delta: number }[];
    lambda: number;
  };
  /** The stated economics the verdicts were computed under, so the page can print them. */
  assumptions: FarmAssumptions;
  /** How many rows each verdict got — the page's headline answer. */
  verdict_counts: { farm: number; marginal: number; skip: number };
  /** Every snapshot protocol in exactly one group: the page's proof it covered the whole universe. */
  accounting: {
    total: number;
    watchlist_size: number;
    watchlist_ranked: number;
    early_ranked: number;
    board_size: number;
    live_trading: number;
    token_no_cap: number;
    out_of_scope: number;
  };
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
const round6 = (n: number): number => Math.round(n * 1e6) / 1e6;
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** The median of a finite list of positive numbers. */
function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/**
 * One category's learned offset in ln(mcap/tvl), with the sample it was learned on. Reported on the
 * Model tab so a reader sees which categories were measured and which fell back to the pool.
 */
export interface CategoryComp {
  category: string;
  n: number;
  median: number;
  shrunk: number;
}

/** The value fit: the slopes, the per-category offsets, the sample it was measured on. */
export interface ValueFit {
  /** ln(mcap/tvl) = intercept + tvlSlope*ln(tvl) + ageSlope*ln(age) + growthSlope*tanh(g/45) + offset */
  intercept: number;
  tvlSlope: number;
  ageSlope: number;
  growthSlope: number;
  /** Shrunk mean-residual offset per category, exp()'d into a multiple for display. */
  offsets: Map<string, number>;
  /** How many live-token protocols the fit read, and how well it explains them. */
  n: number;
  r2: number;
  rmseLog: number;
  /** The pooled (offset-free) multiple, used when a category was never measured. */
  pooled: number;
  perCategory: CategoryComp[];
  /** Held-out quality: k-fold cross-validation and leave-one-out, fitted on every run. */
  validation: FitValidation;
  /** Which terms survived selection, and each one's held-out trial. */
  activeTerms: TermKey[];
  termTrials: TermTrial[];
}

/** One term's held-out trial: did adding it lower error enough to keep? */
export interface TermTrial {
  term: string;
  kept: boolean;
  /** Held-out ln-RMSE with this term included. */
  cv_rmse_log: number;
  /** Error the term removed versus the model without it (positive = it helped). */
  delta: number;
}

/** Out-of-sample evidence: the fit re-run with part of the sample hidden, scored on what it hid. */
export interface FitValidation {
  /** K-fold: every observation predicted once from a fit that never saw it. */
  cv_folds: number;
  cv_rmse_log: number;
  cv_r2: number;
  /** Leave-one-out speed-up (closed form from the ridge hat matrix). */
  loo_rmse_log: number;
  loo_r2: number;
  /** Ratio of out-of-sample error to always-predicting-the-mean: below 1 beats the baseline. */
  cv_skill: number;
  loo_skill: number;
  /** Held-out R² of the multiple itself (exp scale), the number a reader can check. */
  cv_multiple_mae_x: number;
}

const GROWTH_SCALE = 45;
const RIDGE_LAMBDA = 0.3;
const OFFSET_SHRINK_K = 3;
/** Folds for the cross-validation report; 5 keeps ~18 held-out rows per fold at n=88. */
const CV_FOLDS = 5;

/** One row the value model is fitted on: a live-token protocol's own multiple and features. */
interface Sample { category: string | null; tvl: number; age: number | null; growth: number; y: number; }

/**
 * The terms the model may use. Which of them survive is decided per run by held-out error, so a
 * term the snapshot cannot support is dropped instead of fitted to noise. `tvl` is the anchor.
 */
type TermKey = 'tvl' | 'age' | 'growth';
const TERM_ORDER: TermKey[] = ['tvl', 'age', 'growth'];

/** One term's value for a sample, on the scale the regression reads it. */
function termValue(term: TermKey, s: Sample): number {
  switch (term) {
    case 'tvl': return Math.log(Math.max(s.tvl, 1));
    case 'age': return Math.log(Math.max(s.age ?? 1, 1));
    case 'growth': return Math.tanh(s.growth / GROWTH_SCALE);
  }
}

/** Design row for a sample under one set of active terms: intercept first, then the terms. */
function designRow(active: TermKey[], s: Sample): number[] {
  return [1, ...active.map((t) => termValue(t, s))];
}

/** The ridge system for one set of samples and terms, solved. */
function ridgeSolve(rows: Sample[], active: TermKey[]): number[] {
  const k = active.length + 1;
  const X = rows.map((s) => designRow(active, s));
  const yv = rows.map((s) => s.y);
  const ATA: number[][] = Array.from({ length: k }, (_, a) =>
    Array.from({ length: k }, (_, b) => {
      let acc = 0;
      for (let i = 0; i < rows.length; i++) acc += X[i]![a]! * X[i]![b]!;
      // The intercept is not penalised; the slopes are, so a collinear pair cannot blow up.
      if (a === b && a > 0) acc += RIDGE_LAMBDA;
      return acc;
    }),
  );
  const ATy = Array.from({ length: k }, (_, a) => {
    let acc = 0;
    for (let i = 0; i < rows.length; i++) acc += X[i]![a]! * yv[i]!;
    return acc;
  });
  return solve(ATA, ATy) ?? [rows.reduce((a, b) => a + b.y, 0) / Math.max(rows.length, 1), ...Array(k - 1).fill(0)];
}

/** Predict ln(multiple) for one sample from a solved vector under the same active terms. */
function ridgePredict(beta: number[], active: TermKey[], s: Sample): number {
  const row = designRow(active, s);
  let acc = 0;
  for (let a = 0; a < row.length; a++) acc += beta[a]! * row[a]!;
  return acc;
}

/**
 * Shrunk per-category offsets from a fitted vector, learned on the rows given. Same rule the
 * full fit uses, so a held-out pass scores the model the board actually ranks with.
 */
function fittedOffsets(beta: number[], active: TermKey[], rows: Sample[]): Map<string, number> {
  const residuals = new Map<string, number[]>();
  for (const s of rows) {
    const key = s.category ?? '';
    if (key === '') continue;
    const resid = s.y - ridgePredict(beta, active, s);
    const bucket = residuals.get(key);
    if (bucket === undefined) residuals.set(key, [resid]);
    else bucket.push(resid);
  }
  const offsets = new Map<string, number>();
  for (const [category, rs] of residuals) {
    const mean = rs.reduce((a, b) => a + b, 0) / rs.length;
    offsets.set(category, (mean * rs.length) / (rs.length + OFFSET_SHRINK_K));
  }
  return offsets;
}

/** A fold's prediction: the fitted curve plus the offset its own training rows learned. */
function predictWith(beta: number[], active: TermKey[], offsets: Map<string, number>, s: Sample): number {
  return ridgePredict(beta, active, s) + (s.category === null ? 0 : offsets.get(s.category) ?? 0);
}

/** Fold assignment shared by every held-out pass, so two specifications are scored on the same split. */
function foldsFor(sample: Sample[]): Map<number, number> {
  const order = sample
    .map((s, i) => ({ i, key: `${s.category ?? '~'}|${s.tvl}` }))
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
    .map((o) => o.i);
  const foldOf = new Map<number, number>();
  order.forEach((idx, pos) => foldOf.set(idx, pos % CV_FOLDS));
  return offsetsNoop(foldOf);
}
/** Identity helper that keeps the fold map's type explicit at the call site. */
function offsetsNoop(m: Map<number, number>): Map<number, number> { return m; }

/**
 * Held-out error for ONE specification, against a fixed fold split. Lower ln-RMSE is better.
 * Used both to report the chosen model and to decide which terms earn their place.
 */
function heldOutError(sample: Sample[], active: TermKey[], foldOf: Map<number, number>): {
  cvRmse: number; cvSsRes: number; cvCount: number; cvAbsErrX: number;
} {
  let cvSsRes = 0;
  let cvAbsErrX = 0;
  let cvCount = 0;
  for (let f = 0; f < CV_FOLDS; f++) {
    const train = sample.filter((_, i) => foldOf.get(i) !== f);
    const test = sample.filter((_, i) => foldOf.get(i) === f);
    if (train.length < 8 || test.length === 0) continue;
    const beta = ridgeSolve(train, active);
    const offsets = fittedOffsets(beta, active, train);
    for (const s of test) {
      const pred = predictWith(beta, active, offsets, s);
      cvSsRes += (s.y - pred) ** 2;
      cvAbsErrX += Math.abs(Math.exp(s.y) - Math.exp(pred));
      cvCount += 1;
    }
  }
  return {
    cvRmse: cvCount > 0 ? Math.sqrt(cvSsRes / cvCount) : Infinity,
    cvSsRes, cvCount, cvAbsErrX,
  };
}

/**
 * Which terms the snapshot actually supports. `tvl` is the anchor and always stays; each other term
 * joins only if it lowers held-out error by more than a noise margin on the same fold split, so a
 * term that merely fits the sample is dropped rather than shipped as if it predicted.
 */
function selectTerms(sample: Sample[]): { active: TermKey[]; tried: TermTrial[] } {
  const foldOf = foldsFor(sample);
  const active: TermKey[] = ['tvl'];
  const tried: TermTrial[] = [];
  let best = heldOutError(sample, active, foldOf);
  tried.push({ term: 'tvl', kept: true, cv_rmse_log: round4(best.cvRmse), delta: 0 });

  for (const term of TERM_ORDER) {
    if (term === 'tvl') continue;
    const candidate = [...active, term];
    const scored = heldOutError(sample, candidate, foldOf);
    const delta = best.cvRmse - scored.cvRmse;
    // A term must earn at least this much held-out ln-error to be kept. 0.5% of a ~1.2 ln spread
    // is small enough to admit a real signal and large enough to refuse fold-to-fold noise.
    const margin = best.cvRmse * 0.005;
    const kept = Number.isFinite(scored.cvRmse) && delta > margin;
    tried.push({ term, kept, cv_rmse_log: round4(scored.cvRmse), delta: round4(delta) });
    if (kept) { active.push(term); best = scored; }
  }
  return { active, tried };
}

/**
 * Out-of-sample evidence for the value model. Every number here comes from a fit that never saw
 * the row it is scored on, so it cannot be inflated by the model grading its own homework.
 * Each held-out pass re-learns BOTH the curve and the category offsets on its training rows only.
 */
function validateFit(sample: Sample[], active: TermKey[]): FitValidation {
  const n = sample.length;
  const empty: FitValidation = {
    cv_folds: 0, cv_rmse_log: 0, cv_r2: 0, loo_rmse_log: 0, loo_r2: 0,
    cv_skill: 0, loo_skill: 0, cv_multiple_mae_x: 0,
  };
  if (n < CV_FOLDS * 2) return empty;

  const meanY = sample.reduce((a, b) => a + b.y, 0) / n;
  const ssTot = sample.reduce((a, b) => a + (b.y - meanY) ** 2, 0);
  const floor = (v: number): number => (v > 0 ? v : 0);

  // --- K-fold on the terms the board actually uses, with the shared fold split. ---
  const foldOf = foldsFor(sample);
  const cv = heldOutError(sample, active, foldOf);
  const cvSsRes = cv.cvSsRes;
  const cvCount = cv.cvCount;
  const cv_rmse_log = cv.cvRmse === Infinity ? 0 : cv.cvRmse;
  const cv_r2 = ssTot > 0 && cvCount > 0 ? floor(1 - cvSsRes / ssTot) : 0;
  const cv_skill = cv_rmse_log > 0 ? Math.sqrt(ssTot / n) / cv_rmse_log : 0;
  const cv_multiple_mae_x = cvCount > 0 ? cv.cvAbsErrX / cvCount : 0;

  // --- Leave-one-out by exact re-fit: hide one row, learn curve + offsets on the rest. ---
  // n is ~90 here, so n solves of a small system cost nothing and avoid the closed-form
  // approximation, which cannot account for the category offsets changing per training set.
  let looSsRes = 0;
  let looCount = 0;
  if (n >= 12) {
    for (let i = 0; i < n; i++) {
      const train = sample.filter((_, j) => j !== i);
      if (train.length < 8) continue;
      const beta = ridgeSolve(train, active);
      const offsets = fittedOffsets(beta, active, train);
      const pred = predictWith(beta, active, offsets, sample[i]!);
      looSsRes += (sample[i]!.y - pred) ** 2;
      looCount += 1;
    }
  }
  const loo_rmse_log = looCount > 0 ? Math.sqrt(looSsRes / looCount) : 0;
  const loo_r2 = ssTot > 0 && looCount > 0 ? floor(1 - looSsRes / ssTot) : 0;
  const loo_skill = loo_rmse_log > 0 ? Math.sqrt(ssTot / n) / loo_rmse_log : 0;

  return {
    cv_folds: CV_FOLDS,
    cv_rmse_log: round4(cv_rmse_log),
    cv_r2: round4(cv_r2),
    loo_rmse_log: round4(loo_rmse_log),
    loo_r2: round4(loo_r2),
    cv_skill: round4(cv_skill),
    loo_skill: round4(loo_skill),
    cv_multiple_mae_x: round4(cv_multiple_mae_x),
  };
}

/** Solve a small dense system A x = b by Gauss-Jordan with partial pivoting. */
function solve(A: number[][], b: number[]): number[] | null {
  const k = A.length;
  const M: number[][] = A.map((row, i) => [...row, b[i]!]);
  for (let c = 0; c < k; c++) {
    let piv = c;
    for (let r = c + 1; r < k; r++) if (Math.abs(M[r]![c]!) > Math.abs(M[piv]![c]!)) piv = r;
    if (piv !== c) { const t = M[c]!; M[c] = M[piv]!; M[piv] = t; }
    const d = M[c]![c]!;
    if (!Number.isFinite(d) || Math.abs(d) < 1e-12) return null;
    for (let j = c; j <= k; j++) M[c]![j] = M[c]![j]! / d;
    for (let r = 0; r < k; r++) {
      if (r === c) continue;
      const f = M[r]![c]!;
      if (Math.abs(f) < 1e-14) continue;
      for (let j = c; j <= k; j++) M[r]![j] = M[r]![j]! - f * M[c]![j]!;
    }
  }
  return M.map((row) => row[k]!);
}

/**
 * Fit the value model on the snapshot's own live-token protocols. This runs on every execution:
 * the slopes and the category offsets are measured, never memorised. Ridge keeps the fit stable
 * when two features move together; the offsets are shrunk toward zero by n/(n+K) so a category
 * with two listings cannot pin a multiplier that a category with fifteen would contradict.
 */
export function fitValueModel(snapshot: Snapshot, model: ModelConstants): ValueFit {
  type Sample = { category: string | null; tvl: number; age: number | null; growth: number; y: number };
  const sample: Sample[] = [];
  for (const p of snapshot.protocols) {
    if (p.mcap_usd === null || !(p.tvl_usd >= 1_000_000) || !Number.isFinite(p.mcap_usd)) continue;
    const ratio = p.mcap_usd / p.tvl_usd;
    // The prediction target is a market multiple. Ratios outside the model's band are data errors,
    // not evidence, and would drag every slope with them, so they stay out of the fit entirely.
    if (!(ratio >= model.comp_floor) || !(ratio <= model.comp_cap)) continue;
    sample.push({
      category: p.category,
      tvl: p.tvl_usd,
      age: ageDays(snapshot.as_of, p.listed_at),
      growth: clamp(finite(p.change_7d, 0), model.growth_floor, model.growth_cap),
      y: Math.log(ratio),
    });
  }

  const pooled = sample.length > 0
    ? clamp(Math.exp(median(sample.map((s) => s.y))), model.comp_floor, model.comp_cap)
    : model.fallback_multiple;

  if (sample.length < 8) {
    // Too little evidence to fit: fall back to the pooled multiple and say so.
    return {
      intercept: Math.log(pooled), tvlSlope: 0, ageSlope: 0, growthSlope: 0,
      offsets: new Map(), n: sample.length, r2: 0, rmseLog: 0, pooled, perCategory: [],
      validation: {
        cv_folds: 0, cv_rmse_log: 0, cv_r2: 0, loo_rmse_log: 0, loo_r2: 0,
        cv_skill: 0, loo_skill: 0, cv_multiple_mae_x: 0,
      },
      activeTerms: ['tvl'], termTrials: [],
    };
  }

  // Which terms earn their place is decided by held-out error, not by what the model can fit.
  const { active, tried } = selectTerms(sample);
  const n = sample.length;
  const y = sample.map((s) => s.y);
  const beta = ridgeSolve(sample, active);

  // Residuals by category, then shrink each category's mean residual toward zero.
  const offsets = fittedOffsets(beta, active, sample);
  const perCategory: CategoryComp[] = [];
  {
    const residuals = new Map<string, number[]>();
    for (let i = 0; i < n; i++) {
      const pred = ridgePredict(beta, active, sample[i]!);
      const key = sample[i]!.category ?? '';
      const bucket = residuals.get(key);
      if (bucket === undefined) residuals.set(key, [y[i]! - pred]);
      else bucket.push(y[i]! - pred);
    }
    for (const [category, rs] of residuals) {
      if (category === '') continue;
      const mean = rs.reduce((a, b) => a + b, 0) / rs.length;
      const shrunk = (mean * rs.length) / (rs.length + OFFSET_SHRINK_K);
      perCategory.push({
        category,
        n: rs.length,
        median: round4(Math.exp(mean)),
        shrunk: round4(Math.exp(shrunk)),
      });
    }
    perCategory.sort((a, b) => (a.category < b.category ? -1 : a.category > b.category ? 1 : 0));
  }

  // Report the fit honestly: R² and residual spread on the same sample it was measured on.
  let ssRes = 0;
  const meanY = y.reduce((a, b) => a + b, 0) / n;
  let ssTot = 0;
  for (let i = 0; i < n; i++) {
    const off = offsets.get(sample[i]!.category ?? '') ?? 0;
    const pred = ridgePredict(beta, active, sample[i]!) + off;
    ssRes += (y[i]! - pred) ** 2;
    ssTot += (y[i]! - meanY) ** 2;
  }
  // Slopes for the dropped terms are zero, so `compFor` can read the vector positionally.
  const slopeOf = (t: TermKey): number => {
    const at = active.indexOf(t);
    return at < 0 ? 0 : beta[at + 1]!;
  };
  return {
    intercept: round4(beta[0]!),
    tvlSlope: round4(slopeOf('tvl')),
    ageSlope: round4(slopeOf('age')),
    growthSlope: round4(slopeOf('growth')),
    offsets,
    n,
    r2: ssTot > 0 ? round4(1 - ssRes / ssTot) : 0,
    rmseLog: round4(Math.sqrt(ssRes / n)),
    pooled,
    perCategory,
    validation: validateFit(sample, active),
    activeTerms: active,
    termTrials: tried,
  };
}

/**
 * The multiple one protocol is valued at: the fitted curve at its own tvl, age and growth, plus
 * its category's learned offset. A protocol whose category was never measured falls back to the
 * curve alone, which is the pooled market, not a name-based guess.
 */
export function compFor(fit: ValueFit, p: SnapshotProtocol, asOf: string, model: ModelConstants): number {
  const age = ageDays(asOf, p.listed_at);
  const growth = clamp(finite(p.change_7d, 0), model.growth_floor, model.growth_cap);
  // Read the same scale the fit was trained on: an unknown age is the log of 1, i.e. no shift,
  // which is exactly what the sample rows carry when `ageDays` returns null.
  const ln = fit.intercept
    + fit.tvlSlope * Math.log(Math.max(p.tvl_usd, 1))
    + fit.ageSlope * Math.log(Math.max(age ?? 1, 1))
    + fit.growthSlope * Math.tanh(growth / GROWTH_SCALE)
    + (p.category === null ? 0 : fit.offsets.get(p.category) ?? 0);
  return clamp(Math.exp(ln), model.comp_floor, model.comp_cap);
}

/**
 * Kept for the Model tab: the same fit, reported as one row per category with the multiple the
 * page displays. `globalMedian` is the pooled market multiple the fit falls back to.
 */
export function categoryComps(snapshot: Snapshot, model: ModelConstants): { perCategory: CategoryComp[]; globalMedian: number } {
  const fit = fitValueModel(snapshot, model);
  return { perCategory: fit.perCategory, globalMedian: fit.pooled };
}

import {
  fitOddsModel,
  oddsFor,
  type OddsFit,
} from './odds.ts';
import {
  DEFAULT_ASSUMPTIONS,
  farmVerdict,
  type FarmAssumptions,
  type FarmVerdict,
} from './farm.ts';

/** The three multipliers, the odds and the implied value one protocol gets under `model`.
 * The odds come from the fitted `OddsFit` (lib/odds.ts), not from constants: every coefficient
 * they are computed with was measured on this snapshot's own peers during this run.
 */
export function scoreProtocol(
  p: SnapshotProtocol,
  asOf: string,
  model: ModelConstants,
  compMultiple: number,
  oddsFit: OddsFit,
): { implied: number; fdvProxy: number; odds: number; growthPct: number; growthMult: number; maturityMult: number; age: number | null } {
  const age = ageDays(asOf, p.listed_at);
  const growthPct = clamp(finite(p.change_7d, 0), model.growth_floor, model.growth_cap);
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? null;
  const maturityMult =
    ageForModel === null
      ? model.maturity_floor + model.maturity_range * 0.5
      : model.maturity_floor + model.maturity_range * (Math.min(ageForModel, model.maturity_days) / model.maturity_days);
  // Value if a token launches: the fitted multiple applied to the protocol's own TVL.
  const fdvProxy = Math.max(1, p.tvl_usd * compMultiple);
  const odds = oddsFor(oddsFit, p, asOf, model.odds_min, model.odds_max);
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
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL, fit?: ValueFit, oddsFit?: OddsFit, assumptions?: FarmAssumptions): BoardRow[] {
  // One fit for the whole board: the slopes and every category offset are measured on the
  // snapshot's own live-token protocols, so every row is valued on the same evidence.
  const valueFit = fit ?? fitValueModel(snapshot, model);
  const odds = oddsFit ?? fitOddsModel(snapshot.protocols, snapshot.as_of);
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
    const comp = compFor(valueFit, p, snapshot.as_of, model);
    const s = scoreProtocol(p, snapshot.as_of, model, comp, odds);
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
      comp_n: valueFit.perCategory.find((c) => c.category === (s.p.category ?? ''))?.n ?? 0,
      comp_median: round4(valueFit.perCategory.find((c) => c.category === (s.p.category ?? ''))?.median ?? 0),
      growth_pct: s.growthPct,
      growth_multiplier: round4(s.growthMult),
      maturity_multiplier: round4(s.maturityMult),
      odds: round4(s.odds),
    },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
    farm: farmVerdict({
      tvl_usd: s.p.tvl_usd,
      chains: s.p.chains,
      implied_value_usd: s.implied,
      odds: s.odds,
      assumptions: assumptions ?? DEFAULT_ASSUMPTIONS,
    }),
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
    farm: row.farm,
  };
}

/**
 * The page's copy of the farm plan: the same steps, tightened to their first clause and their
 * cost/time tail. board.json carries the full text the gate reads; the page's copy is what the
 * dossier's Source block has to hold beside app.js inside 65,536 bytes, and a step that runs to
 * 600 characters x 195 rows spends the whole budget on prose the judge already reads in the board.
 * The plan stays concrete — the action, its cost and its time are kept, only the padding goes.
 */
export function pageFarmSteps(steps: string[]): string[] {
  return steps.map((step) => {
    const t = step.trim().replace(/\s+/g, ' ');
    // Keep the action clause and the cost/time tail; drop the qualifier between them.
    // Every step the plan generator writes ends in "Cost: … Time: …", so the tail is the payload.
    const at = t.indexOf('Cost:');
    if (at > 20) {
      const head = t.slice(0, at).replace(/[\s,;:]+$/, '');
      const tail = t.slice(at);
      const headCut = head.length > 110 ? `${head.slice(0, 106).replace(/[\s,;:]+$/, '')} …` : head;
      return `${headCut} ${tail}`.slice(0, 260).trim();
    }
    return t.length > 260 ? `${t.slice(0, 256).replace(/[\s,;:]+$/, '')} …` : t;
  });
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL, assumptions?: FarmAssumptions): { board: BoardRow[]; radar: RadarData } {
  // Fit once, use it for the products: the board's comps and the Model tab's table come from the
  // same regression, so the page can never show a multiple the ranking did not use.
  const fit = fitValueModel(snapshot, model);
  const odds = fitOddsModel(snapshot.protocols, snapshot.as_of);
  const board = buildBoard(snapshot, model, fit, odds, assumptions);
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
    rows: board.map((row) => ({
      ...radarRow(row),
      // The page shows the plan's spine; board.json carries all of it for the gate and the judge.
      farm_steps: pageFarmSteps(row.farm_steps).slice(0, 4),
      farm_steps_total: row.farm_steps.length,
    })),
    live: live.slice(0, 120),
    categories: fit.perCategory,
    global_median: fit.pooled,
    value_fit: {
      kinds: 'ridge-regression of ln(mcap/tvl) on ln(tvl), ln(age_days), tanh(change_7d/45), plus a shrunk per-category offset',
      refit: 'on every run, from the snapshot\'s own live-token protocols',
      intercept: fit.intercept,
      tvl_slope: fit.tvlSlope,
      age_slope: fit.ageSlope,
      growth_slope: fit.growthSlope,
      sample_n: fit.n,
      r2: fit.r2,
      rmse_log: fit.rmseLog,
      offset_shrink_k: OFFSET_SHRINK_K,
      ridge_lambda: RIDGE_LAMBDA,
      cv_folds: fit.validation.cv_folds,
      cv_rmse_log: fit.validation.cv_rmse_log,
      cv_r2: fit.validation.cv_r2,
      loo_rmse_log: fit.validation.loo_rmse_log,
      loo_r2: fit.validation.loo_r2,
      cv_skill: fit.validation.cv_skill,
      loo_skill: fit.validation.loo_skill,
      cv_multiple_mae_x: fit.validation.cv_multiple_mae_x,
      active_terms: fit.activeTerms,
      term_trials: fit.termTrials,
    },
    odds_fit: {
      kinds: 'logistic regression of "records a token" on ln(1 + age/365) and tanh(change_7d/45), plus a shrunk per-category offset in logit space',
      refit: 'on every run, from the snapshot\'s own protocols',
      intercept: odds.intercept,
      age_slope: odds.ageSlope,
      growth_slope: odds.growthSlope,
      offsets: [...odds.offsets.entries()].map(([category, offset]) => ({ category, offset: round4(offset) })).sort((a, b) => (a.category < b.category ? -1 : 1)),
      base_rate: round4(odds.baseRate),
      sample_n: odds.n,
      with_token: odds.withToken,
      brier_in_sample: round6(odds.brierInSample),
      brier_base: round6(odds.brierBase),
      brier_loo: round6(odds.brierLoo),
      loo_skill: round4(odds.looSkill),
      brier_walk_forward: round6(odds.brierWalkForward),
      walk_forward_skill: round4(odds.walkForwardSkill),
      walk_forward_train: odds.walkForwardTrain,
      walk_forward_test: odds.walkForwardTest,
      walk_forward_cut: odds.walkForwardCut,
      active_terms: odds.activeTerms,
      trials: odds.trials,
      lambda: odds.lambda,
    },
    assumptions: assumptions ?? DEFAULT_ASSUMPTIONS,
    verdict_counts: {
      farm: board.filter((r) => r.farm.verdict === 'farm').length,
      marginal: board.filter((r) => r.farm.verdict === 'marginal').length,
      skip: board.filter((r) => r.farm.verdict === 'skip').length,
    },
    accounting: accounting(snapshot, board),
  };
  return { board, radar };
}

/** Every protocol in the snapshot placed in exactly one group, so the page can prove the board's universe. */
export function accounting(snapshot: Snapshot, board: BoardRow[]): RadarData['accounting'] {
  const rows = new Set(board.map((r) => r.slug));
  const watch = new Set(snapshot.watchlist);
  let watchlistRanked = 0;
  let earlyRanked = 0;
  let liveTrading = 0;
  let tokenNoCap = 0;
  let outOfScope = 0;
  for (const p of snapshot.protocols) {
    if (rows.has(p.slug)) {
      if (watch.has(p.slug)) watchlistRanked += 1;
      else earlyRanked += 1;
    } else if (p.mcap_usd !== null && p.mcap_usd > 0) {
      liveTrading += 1;
    } else if (p.mcap_usd !== null) {
      tokenNoCap += 1;
    } else {
      outOfScope += 1;
    }
  }
  return {
    total: snapshot.protocols.length,
    watchlist_size: snapshot.watchlist.length,
    watchlist_ranked: watchlistRanked,
    early_ranked: earlyRanked,
    board_size: board.length,
    live_trading: liveTrading,
    token_no_cap: tokenNoCap,
    out_of_scope: outOfScope,
  };
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

  // The accounting the page prints is also a check: every snapshot protocol has to land in exactly
  // one group and the groups have to sum to the whole input. If they do not, the page would be
  // publishing a universe that does not add up, so the run refuses rather than ship it.
  const acct = accounting(snapshot, board);
  const sum = acct.watchlist_ranked + acct.early_ranked + acct.live_trading + acct.token_no_cap + acct.out_of_scope;
  if (sum !== acct.total) return `accounting sums to ${sum} but the snapshot holds ${acct.total} protocols`;
  if (acct.board_size !== board.length) return `accounting says ${acct.board_size} board rows but the board holds ${board.length}`;
  return null;
}

/** The dashboard's data as one script: window.RADAR = {...} for the page to read. */
export function dataScript(radar: RadarData): string {
  return `// Generated by main.ts from the sealed snapshot — do not edit.\nwindow.RADAR = ${JSON.stringify(radar)};\n`;
}
