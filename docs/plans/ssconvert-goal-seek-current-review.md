# Independent repeated goal-seek review

Independent reviewer: a different agent from the integration owner. Review ran
against the current shared worktree on 2026-09-21; no Git, export, README, or
native-oracle ownership was taken. These results qualify the tested bytes, not
a committed revision or a published release.

## Source and contract

The integration owner supplied released Gnumeric 1.12.61 primary source under
`out/ssconvert-lifecycle/gnumeric-1.12.61`, from the archive required by the task:
SHA-256 `2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12`.
The reviewer inspected `src/dialogs/dialog-goal-seek.c`, `src/tools/goal-seek.c`,
and `src/value.c`, without copying upstream fixtures or implementation into unit
tests. The five-cell strip is formula, changing input, target, minimum, maximum.

Source SHA-256 observed:

| Input | SHA-256 |
| --- | --- |
| `src/tools/goal-seek.c` | `9a12458c9fa52d92fa2ca2536a7d76589bc857d10407aa232cfe0f7606c2245a` |
| `src/value.c` | `b2b44427955c8d5b9ef812faf8f093c1a96fb56e76ef9b9c35371052485ce137` |

## Validated failures and fixes

1. Derivative callback order: the original finite-difference helper visited the
   right endpoint after the left callback returned an invalid result. The red
   test recorded `[0,-0.000002,0.000002]`; released `fake_df` returns immediately
   on the left callback failure, giving `[0,-0.000002]`. The shared search helper
   now short-circuits an invalid left result.
2. Nonfinite raw guesses: an old input string `inf`, upper bound string `inf`,
   constant formula `=0`, and zero target require no random search. Released
   Newton accepts the guess through its bound comparisons and writes `#NUM!`
   through `value_new_float`; the constant formula still attains the goal. The
   red test instead threw `capability-denied` after skipping the guess. Removing
   invented finite-x admission and normalizing numeric writes fixed this;
   complementary `-inf` and `nan` cases pass too. Integration owns the numeric
   write change; review owns the search-helper admission changes.
3. NaN-bound ordering: native uniform trawl rejects only `xmin > xmax`, which
   permits NaN raw bounds. A bounded two-random-draw test observed target callback
   counts `[3,3]` instead of `[3,4]`, proving normal generation occurred before
   uniform evaluation. The eligibility comparison now matches the released
   source. This test stops after two draws and does not run a slow search loop.

## Refuted hypotheses

- Raw signed zero is preserved by `go_strtod`, but `value_new_float` explicitly
  canonicalizes it to positive zero. A negative-zero final-input expectation was
  refuted by source, not treated as a compatibility failure. A complementary
  positive-zero output control passes.
- Equal bounds with an unattained target still consume the released 100 uniform
  draws. An initial expectation of zero draws was refuted by source. The retained
  independent test checks 100 injected draws and `#VALUE!` failure output; there
  was no product change for this hypothesis.

## Verification

All unit fixtures are original sparse in-memory workbooks; no file changes,
native process spawning, or LLM calls occur. Besides the fixes, the independent
14-case review covers fixed-bound attained targets, C-locale rejection of
non-ASCII leading whitespace, cross-sheet target dependencies under manual
calculation, cumulative work budgets, and exact pre-admission abort-reason identity.

Executed uncached:

```sh
npx vitest run packages/ssconvert/src/solver/goal-seek-review.test.ts packages/ssconvert/src/solver/goal-seek.test.ts packages/ssconvert/src/solver/goal-seek-stress.test.ts packages/ssconvert/src/formulas/financial-independent.test.ts
```

Result: **122 passed, zero failed**, across four files (14 independent review,
9 original goal-seek, 9 stress, 90 existing financial regressions). Individual
failed intermediate executions above remain recorded as regression evidence,
not passing gates. The successful final run took 1.15 seconds total, with
243 milliseconds reported test time; these are bounded execution observations,
not a performance qualification.

An additional direct ESLint check of the three listed product/test files exited
zero with no diagnostics. This file-scoped check is separate from the maintained
workspace lint/typecheck gate owned by integration.

Product SHA-256 at that run:

| Input | SHA-256 |
| --- | --- |
| `packages/ssconvert/src/solver/goal-seek.ts` | `65af53496b476296de670fd2d946b9d294f8d1cc1f96577a0f51e2b91487327f` |
| `packages/ssconvert/src/formulas/functions/financial-goal-seek.ts` | `eecd20e322dbee0ebf9f0856f6fe6dfaad3720ab6288fa168abd98e9e0340c04` |
| `packages/ssconvert/src/solver/goal-seek-review.test.ts` | `4687deb7481465418d6517e1e45e46efaf06e803d6f18197062d628edde8c658` |

## Remaining scope and unavailable cells

The current host's separate native Docker oracle is unavailable, as reported by
the integration owner. No fresh native differential cell is counted as a pass;
historical Linux dependency/plugin/locale captures are separate evidence. This
review does not qualify all roots, all numeric magnitudes, all locales, random
distribution parity, all formula families, or performance/resource ceilings.
No unresolved mismatch remains among the 14 selected review cases.

The integration owner retains maintained workspace build/test/lint gates, shared
CLI/SDK and safe-bash integration, realm/host boundary qualification, checkpoint
and replay admission, screenshots, and exact final candidate identity. This
focused review does not substitute for those gates or claim they completed.
