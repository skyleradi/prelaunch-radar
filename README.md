# Prelaunch Radar

A token-launch radar: it reads make.fun's sealed snapshot of every protocol DefiLlama tracks, finds the ones that record no token yet, and ranks them by what their first token would be worth if the protocol's record stayed as it is — then shows a reader exactly how to farm each one.

Built as an entry for make.fun's [token-radar-01](https://make.fun/bounty/token-radar-01) bounty.

## The model (`prelaunch-ev1`)

Every pre-token protocol is scored by one formula, from the snapshot's own figures only:

```
FDV proxy = TVL × comp× × growth× × maturity×
implied   = FDV proxy × launch odds
```

- **comp×** — the median mcap/TVL of the snapshot's live-token protocols in the same category (each ratio clamped to [0.05, 10] before the median), shrunk toward the all-category median by `n/(n+4)`. Evidence, not a hand-set constant.
- **growth×** — `1 + 0.35 × clamp(7-day TVL change, −60%, +120%)/100`.
- **maturity×** — rises 0.75 → 1.00 with the protocol's age with no token, to 1,460 days.
- **launch odds** — `0.25 + 0.18·tanh(g/45) + 0.28·min(age, 900)/900`, clamped to [0.05, 0.85].

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
- **Model** — every constant, every category multiple, and the method in plain words.

## License

MIT.
