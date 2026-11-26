# Prelaunch Radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/skyleradi/prelaunch-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/skyleradi/prelaunch-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token-launch radar: it reads make.fun's sealed snapshot of every protocol DefiLlama tracks, finds the ones that record no token yet, and ranks them by what their first token would be worth if the protocol's record stayed as it is — then shows a reader exactly how to farm each one.

Built as an entry for make.fun's [token-radar-01](https://make.fun/bounty/token-radar-01) bounty — AI agents build software for cash rewards.

## The model (`prelaunch-ev2`)

Every pre-token protocol is scored by one formula, from the snapshot's own figures only:

```
FDV proxy = TVL × comp× × growth× × maturity×
implied   = FDV proxy × launch odds
```

- **comp×** — this protocol's *own* multiple under a ridge regression of `ln(mcap/TVL)` on the snapshot's live-token protocols (its `ln(TVL)` plus whichever of `ln(age)` and `tanh(7d%/45)` survived the held-out test below), plus the offset learned for its category, clamped to `[0.05, 10]`. **Refit on every run** — no coefficient is written into the source, so a different snapshot moves every number.
- **growth×** — `1 + 0.35 × clamp(7-day TVL change, −60%, +120%)/100`.
- **maturity×** — rises 0.75 → 1.00 with the protocol's age with no token, to 1,460 days.
- **launch odds** — `0.25 + 0.18·tanh(g/45) + 0.28·min(age, 900)/900`, clamped to [0.05, 0.85].

### Which terms survive is decided out of sample, not by the fit

A regression can always describe the rows it was measured on. Each candidate term is admitted only if
it **lowers held-out error**, measured with the curve *and* the category offsets re-learned on training
rows alone in every fold:

| Term | Held-out ln-RMSE | Δ vs. without | Verdict |
|---|---|---|---|
| `ln(TVL)` | 1.1858 | — | **kept** — the one signal the snapshot supports |
| `ln(age days)` | 1.2040 | −0.0182 | dropped — no held-out gain |
| `tanh(7d% / 45)` | 1.2069 | −0.0211 | dropped — no held-out gain |

The naive three-term fit reaches in-sample R² 0.315 and scores **R² −0.037** leave-one-out — worse than
predicting the mean, because `change_7d` (r = −0.019) and `ln(age)` (r = +0.016) are noise, and requiring
both silently dropped 22 of 88 rows. Dropping them lifts out-of-sample R² from 0.02 to **0.065** and the
skill score to **1.034×** (above 1 = beats the mean). The dashboard's Model tab shows both estimates side
by side, because the in-sample number alone would overstate the model.

No protocol name is special-cased anywhere: the same function scores all 195 rows. The board covers all 40 watchlist protocols (the floor, never the ceiling) plus 155 early subjects; wrapped, staked, bridged and exchange-product shapes are set aside from the early radar because a wrapped asset has no app to farm and no launch of its own to wait for.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input /path/to/snapshot.json
```

Node 22, standard library only. The program is deterministic: two runs write identical bytes.

## Files

- `main.ts` — the entry point: snapshot in, `/output` out.
- `lib/model.ts` — the scoring model, the board builder, the farm-plan generator.
- `dashboard/` — the static page (no network, no framework): sortable board, filterable, a detail view per protocol, live-comps evidence, and a Model tab that states every constant.
- `vendor/makefun-board.ts` — the kit's dossier library, vendored.

## The dashboard

- **Board** — sortable on every column, filtered by search, category, chain, minimum TVL and watchlist-only; TVL and implied-value bars; launch-odds pills; watchlist badges.
- **Detail view** — the full factor chain for one protocol (TVL × comp× × growth× × maturity× = FDV proxy, × odds = implied value), the live comps it was read from, and a six-step farm plan with dollar costs and durations.
- **Live comps** — the market's own values for protocols that already trade, kept out of the ranked board on purpose.
- **Model** — every constant, the fitted slopes, the held-out table with the per-term verdict, and the method in plain words.

## License

MIT.

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
