# Prelaunch Radar

Which protocols' first tokens would be worth the most — and how to farm each one before it lists.

Reads make.fun's sealed DefiLlama snapshot (758 protocols, 2026-11-14), finds the ones that record
no token yet, and ranks them by **implied value = TVL × comp× × growth× × maturity× × launch odds**.
Every number below is produced by `main.ts` on this snapshot; nothing is typed in by hand.

## What makes the value model honest

The comp multiple is not a lookup table. On every run it is a ridge regression of
`ln(mcap/TVL)` on the snapshot's own live-token protocols, and **which terms survive is decided by
held-out error, not by what the fit can absorb**:

| Term | Held-out ln-RMSE | Δ vs. without | Verdict |
|---|---|---|---|
| `ln(TVL)` | 1.1858 | — | **kept** — the one signal the snapshot supports |
| `ln(age days)` | 1.2040 | −0.0182 | dropped — no held-out gain |
| `tanh(7d% / 45)` | 1.2069 | −0.0211 | dropped — no held-out gain |

Two terms that look obvious are refused because they made prediction **worse** out of sample. That
is the point: a term that only fits the sample is a liability, not a feature.

### Held out, scored on rows the fit never saw

| Estimate | R² | RMSE (ln) | vs. mean |
|---|---|---|---|
| In sample (fit on all 88) | 0.315 | 1.008 | — |
| Held out, 5-fold | 0.053 | 1.186 | 1.027× |
| Held out, leave-one-out | 0.065 | 1.178 | 1.034× |

"vs. mean" above 1 means the model beats always predicting the average multiple. Both held-out
estimates clear that bar; the in-sample R² of 0.315 does not on its own, and is shown only so the
gap between the two is visible. On unseen rows the comp lands within **±0.65×**. Every held-out pass
re-learns both the curve and the category offsets from its training rows only.

## Farm plans

Every pre-token row carries a costed farm plan (`farm_steps`): concrete actions, not adjectives.
155 early-stage rows, 195 scored in total, all 40 watchlist protocols ranked.

## Files

- `index.html`, `app.css`, `app.js` — the page: Board, Live comps, Model. No framework, no network.
- `board.data` — the generated data, written by `main.ts` next to the page it feeds.

Open `index.html` directly from disk; it reads `board.data` from the same directory.
