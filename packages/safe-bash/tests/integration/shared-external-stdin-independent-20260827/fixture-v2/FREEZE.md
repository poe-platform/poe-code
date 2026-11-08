# Authorized fixture v2 — author freeze

Only this new directory and `/tmp/shared-stdin-fixture-v2-*` are owned. Product
`f8819e9d6b6d535b0626e0aa004bb10a7bc36785`, author evidence
`87dced967d3a55611fa1d05d6d1df25514c83622`, and all prior fixtures, reports and
captures remain read-only. Root/user authorized this exact test-only correction
after bounded evidence `d9a58cdc1d4fee159e21c76c708267628767bbf4`.

## Exact positive delta

- Copy provisional35 `92f7626200d1509cf0efe17e4ee6c3d558f3a277` cases/probe/loader.
  Only the two `shell-primary-read-zero/error` rows replace secondary-close
  rejection with explicit fulfillment, exitCode 1 and empty buffered/sink output.
  Their exact existing primary diagnostics and one-read/one-return checks remain.
  Only their shared descriptive expectation changes in `cases.mjs`.
- Copy column supplement `79f0f91717a4e3df328981c7d4988b129c417706`; change only
  the exact diagnostic literal to `column: EFBIG: column input limit exceeded\n`.
- All inputs, identities, other checks, caller/selected/direct-primary checks,
  event gates and cleanup remain unchanged. Original column fixture is untouched.
  `DELTA.diff` records the exact changes; `FREEZE.json` binds readable inputs.

## Frozen negative assertion controls

`probe-wrong-primary.mjs` copies v2, changing only the two READ rows' diagnostic
assertion to the wrong secondary-return reason. Execute those same two rows once
each. `column-wrong-code.mjs` copies v2 column, changing only expected EFBIG to EIO;
execute once (six unchanged rows). Three executions/eight negative rows total,
separate from four historical control executions. `NEGATIVE.diff` shows these
assertion-only changes. They must fail at their exact diagnostic assertion lines
with real reports, expected resource counts and actual diagnostics, not setup.
These are not product-source mutants; historical adapter controls are not rerun.

## Replay and scope

Commit all frozen inputs before any fixture execution. `run.mjs` accepts the
explicit fixture commit and a fresh owned output directory. It authenticates the
same prior archive, source/build/tools, npm tarball and moved package, copies that
package to a fresh consumer and moves it before executing. No rebuild, repack,
baseline replay, live HEAD/dist load, performance/regex/native probe, server or
external network. If the prior artifact is missing, stop and report; do not rebuild.
Full prior inventories are referenced by immutable committed authentication,
checked before/after including added entries; the new full consumer inventory
and every actual loaded-byte receipt are captured. Node strict-unhandled mode,
unchanged fixture event gates and exact-child 60-second watchdogs apply.

This author is NOT the independent verifier. Original32 baseline18/32 →
candidate24/32, provisional35 baseline25/35 → candidate33/35, column0/6,
original author34/nine fixed observations and separate falsy5/5 remain historical
and immutable. The v2 cohorts are separate, not a rewritten historic gate.
Column uses a packed internal factory; this is not exported-family acceptance.
Public/default/independent integration acceptance remains HOLD until a root-routed
different reviewer adjudicates both this delta and actual replay. Reviewer WAITING.
