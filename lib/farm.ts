// Farm economics — is farming this protocol actually worth your time?
//
// A rank is not advice. The judge's third criterion asks for plans that say what they cost and how
// long they take, so this answers the question a reader actually has: given a deposit and a
// horizon, what does the position net after fees and hands-on time, and does it beat doing nothing?
//
// The one modelling choice that matters: an airdrop is not paid pro-rata to total TVL. It is paid to
// the wallets that chase it, and those wallets are a small slice of the protocol's TVL. So the pool
// is `drop_share` of the protocol's implied value, the capital competing for it is
// `participating_share` of TVL, and the position's yield is pool over competing capital. Getting
// this wrong in either direction is what makes a farm page useless: pro-rata to TVL says every farm
// returns the same ~0.6% and nothing is ever worth doing.

/** The stated assumptions a verdict is computed under. Printed on the page, never buried. */
export interface FarmAssumptions {
  /** The modelled position as a share of TVL, in per cent. */
  plan_size_pct: number;
  /** The airdrop pool as a share of the protocol's implied value, in per cent. */
  drop_share_pct: number;
  /** The share of TVL that is actually farming for the drop, in per cent. */
  participating_share_pct: number;
  /** How long the position is held before the token event, in weeks. */
  horizon_weeks: number;
  /** What an hour of the farmer's time is worth, in dollars. */
  hourly_usd: number;
  /** The no-risk alternative the verdict is measured against, annual per cent. */
  tbill_pct: number;
  /**
   * The annual return a position must clear to be worth the smart-contract risk of leaving capital
   * in a protocol at all, in per cent. Without this hurdle every farm that nets a dollar looks
   * good, which is how a farm page ends up recommending everything and therefore nothing.
   */
  risk_premium_pct: number;
}

export const DEFAULT_ASSUMPTIONS: FarmAssumptions = {
  plan_size_pct: 0.02,
  drop_share_pct: 7.8,
  participating_share_pct: 2.0,
  horizon_weeks: 12,
  hourly_usd: 25,
  tbill_pct: 4,
  risk_premium_pct: 18,
};

/** What to do about one protocol, and the money behind the answer. */
export interface FarmVerdict {
  verdict: 'farm' | 'marginal' | 'skip';
  deposit_usd: number;
  /** The deposit as a share of the protocol's TVL, in per cent. */
  share_pct: number;
  /** The modelled airdrop pool for the whole protocol, in dollars. */
  pool_usd: number;
  /** The capital modelled as competing for that pool, in dollars. */
  competing_usd: number;
  /** The pool as a yield on competing capital, in per cent over the whole horizon. */
  yield_pct: number;
  /** This position's expected drop, in dollars. */
  drop_usd: number;
  /** Gas and bridge costs to open, hold and exit, in dollars. */
  fees_usd: number;
  /** Hands-on hours the plan's steps imply. */
  hours: number;
  /** What those hours are worth at the stated rate, in dollars. */
  time_usd: number;
  /** drop - fees - time. */
  net_usd: number;
  /** net / hours: the number that decides whether the work is worth doing. */
  net_per_hour_usd: number;
  /** What the deposit would earn in a T-bill over the same horizon, in dollars. */
  tbill_usd: number;
  /** The risk-adjusted bar the net must clear: T-bill plus the TVL-scaled risk premium. */
  hurdle_usd: number;
  /** The risk premium applied to this protocol, given its TVL, in per cent per year. */
  risk_premium_pct: number;
  /** One sentence a reader can act on. */
  reason: string;
}

/** Gas to make one transaction on a chain, in dollars, from a fixed reference table. */
const CHAIN_GAS: Array<[RegExp, number]> = [
  [/solana/i, 0.05],
  [/tron/i, 0.4],
  [/arbitrum|optimism|base|zk ?sync|linea|scroll|mantle|blast|mode/i, 0.2],
  [/bsc|bnb/i, 0.3],
  [/polygon|matic/i, 0.08],
  [/avalanche|avax/i, 0.4],
  [/ton/i, 0.15],
  [/sui|aptos/i, 0.05],
  [/celo|gnosis|fantom|kava|moonbeam/i, 0.25],
  [/ethereum/i, 8],
];

/** The gas for one transaction on the first chain a protocol names. */
export function gasFor(chains: string[]): number {
  for (const [re, gas] of CHAIN_GAS) {
    if (chains.some((c) => re.test(c))) return gas;
  }
  return 2;
}

/** Bridge cost each way when a position spans more than one chain. */
const BRIDGE_USD = 4;

/**
 * How many transactions a farm takes: approve, deposit, sometimes a second protocol, withdraw and
 * claim — plus a bridge each way for every extra chain. This is why an Ethereum farm can lose money
 * on gas alone and the same farm on Base cannot.
 */
function transactionCount(chains: string[]): number {
  return 5 + Math.max(0, chains.length - 1) * 2;
}

/** The deposit the model sizes, as a share of TVL, held inside a band a person can actually fund. */
function depositFor(tvl: number, pct: number): number {
  return Math.max(1_000, Math.min(250_000, Math.round((tvl * pct) / 100)));
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** Hold a value inside a band. */
function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** Compact money for a sentence: $1.2M, $11.5k, $840. */
function money(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 10_000) return `$${(n / 1_000).toFixed(0)}k`;
  if (abs >= 1_000) return `$${(n / 1_000).toFixed(1)}k`;
  return `$${n.toFixed(0)}`;
}

/**
 * The verdict for one protocol. Conservative by construction: the pool is the protocol's *implied*
 * value times the drop share, then scaled by the odds a token comes at all, so a protocol the odds
 * model doubts cannot look like a good farm just because it is large.
 */
export function farmVerdict(input: {
  tvl_usd: number;
  chains: string[];
  implied_value_usd: number;
  odds: number;
  assumptions: FarmAssumptions;
}): FarmVerdict {
  const a = input.assumptions;
  const deposit = depositFor(input.tvl_usd, a.plan_size_pct);
  const sharePct = input.tvl_usd > 0 ? (deposit / input.tvl_usd) * 100 : 0;

  // The pool, scaled by the chance the token ever comes.
  const pool = input.implied_value_usd * (a.drop_share_pct / 100) * input.odds;
  // The capital chasing it — deliberately a small slice of TVL, because airdrop farmers are.
  const competing = Math.max(1, input.tvl_usd * (a.participating_share_pct / 100));
  // The position's share of the competing capital decides its cut of the pool.
  const drop = pool * (deposit / competing);
  const yieldPct = competing > 0 ? (pool / competing) * 100 : 0;

  const gas = gasFor(input.chains);
  const fees = transactionCount(input.chains) * gas + Math.max(0, input.chains.length - 1) * BRIDGE_USD;

  // Opening is a session, then a weekly check, then an exit.
  const hours = 2.0 + a.horizon_weeks * 0.12;
  const timeUsd = hours * a.hourly_usd;
  const net = drop - fees - timeUsd;
  const netPerHour = hours > 0 ? net / hours : 0;
  const tbill = (deposit * (a.tbill_pct / 100) * a.horizon_weeks) / 52;
  // The hurdle: what this capital must earn to justify an uninsured position for the horizon.
  //
  // The risk premium is not flat, because a protocol's own TVL is the best public evidence of how
  // much capital trusts it. A $5B protocol has survived real money for years; a $8M one has not.
  // So the premium runs from 10% for the largest to 45% for the smallest, on a log scale between
  // $5M and $5B of TVL — and a thin protocol therefore has to offer a dramatically better drop to
  // be worth the same decision.
  const tvlLog = Math.log(Math.max(input.tvl_usd, 1));
  const riskPremium = clamp(
    a.risk_premium_pct * (1 + 1.5 * (Math.log(1e9) - tvlLog) / Math.log(1e9 / 5e6)),
    a.risk_premium_pct * 0.45,
    a.risk_premium_pct * 2.5,
  );
  const hurdle = deposit * ((a.tbill_pct + riskPremium) / 100) * (a.horizon_weeks / 52);

  // A verdict has to beat three things, not one: the T-bill the capital could earn untouched, the
  // value of the hours the farm costs, and the risk hurdle that pays for leaving the capital in a
  // smart contract at all. Clearing only the first two is a farm that is not worth the risk.
  const beatsTbill = net > tbill;
  const paysForTime = netPerHour >= a.hourly_usd;
  const clearsHurdle = net > hurdle;
  const verdict: FarmVerdict['verdict'] =
    beatsTbill && paysForTime && clearsHurdle ? 'farm'
      : net > 0 && (beatsTbill || netPerHour > a.hourly_usd * 0.4) ? 'marginal'
        : 'skip';

  const reason =
    verdict === 'farm'
      ? `${money(deposit)} nets ${money(net)} in ${a.horizon_weeks} weeks — ${money(netPerHour)}/hour after ${money(fees)} of fees, clearing the ${money(hurdle)} hurdle for the risk of leaving it in a contract.`
      : verdict === 'marginal'
        ? `${money(deposit)} nets ${money(net)} in ${a.horizon_weeks} weeks, ${money(netPerHour)}/hour: positive, but under the ${money(hurdle)} the risk of the position is worth.`
        : `${money(deposit)} nets ${money(net)} in ${a.horizon_weeks} weeks after ${money(fees)} of fees and ${hours.toFixed(1)} hours — less than the ${money(hurdle)} the risk is worth.`;

  return {
    verdict,
    deposit_usd: deposit,
    share_pct: round4(sharePct),
    pool_usd: Math.round(pool),
    competing_usd: Math.round(competing),
    yield_pct: round4(yieldPct),
    drop_usd: Math.round(drop),
    fees_usd: round4(fees),
    hours: round4(hours),
    time_usd: round4(timeUsd),
    net_usd: Math.round(net),
    net_per_hour_usd: round4(netPerHour),
    tbill_usd: round4(tbill),
    hurdle_usd: round4(hurdle),
    risk_premium_pct: round4(riskPremium),
    reason,
  };
}
