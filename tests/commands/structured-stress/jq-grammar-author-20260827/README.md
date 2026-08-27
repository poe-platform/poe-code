# jq grammar source-author handoff

This is source-author evidence, not independent acceptance. Product changes are
limited to `src/commands/structured/**`; canonical tests and every older evidence
subtree remain read-only. The package API and dependencies are unchanged.

## Reproduce without overwriting evidence

Run from the repository root. Choose a fresh output prefix every time:

```sh
node tests/commands/structured-stress/jq-grammar-author-20260827/validate.mjs fresh-review
node tests/commands/structured-stress/jq-grammar-author-20260827/immutable.mjs fresh-immutable.json
```

`validate.mjs` replays the entire unchanged independent790 and legacy94, all
frozen neighbor cohorts, the previous author/independent safety and semantic
cohorts, the whole unchanged structured suite, and the new author tests. It also
runs scoped/global TypeScript checks and a full in-memory build/import smoke.
Every command gets its own pre/post structured/product hashes and raw output.
Inspect every status in the checkpoint: the driver completes evidence collection
even when legacy tests fail, and driver exit0 is **not** product acceptance.

`replay.mjs main fresh-main.json` uses the old read-only public pipeline/Shell
harness and manifest. `legacy` uses all94 frozen rows over direct/Shell and
whole/bytewise routes, including the original file setup. The source hash pin in
the copied runner is removed deliberately; expectations, pipeline-stage checks,
routes and original transports are not changed. Only artifact routing and
additional author modes differ. All writes use `apply_patch` and refuse existing
artifact names.

`grammar.test.ts` checks every small author-native vector over both routes,
whole/bytewise and every interior split. File streams are partitioned too.
`legacy.test.ts` additionally runs all94 with every split endpoint and the
original fixed chunk sizes 1/2/5/7/64/16384. `scan-boundaries.test.ts` checks
fifteen frozen vectors around the internal 16384-byte scan boundary.
`limits.test.ts` exercises byte/collection/depth/step ceilings, cancellation,
fatal parse stopping, nonfinite truth, and four stdout exception identities.

The `freeze*.mjs` and proposal generation scripts are one-shot historical capture
programs, not runtime test dependencies. Native fixture inputs use isolated argv
without a shell. Native is never invoked by product code. The initial996,
extra111 and equality24 vectors were frozen against the accepted structured
hash before any source edit; later context70, files72, scan15, arithmetic734 and
integer-bound32 captures are explicitly dated and retain their then-current
source hashes before any corresponding followup remediation.

A final70-vector Unicode case-folding check passes280 direct/Shell whole/bytewise
executions without source changes. It is post-source supplemental validation,
not a pre-fix failure or part of the2039 small-vector all-boundary denominator.
Use `replay.mjs casefold fresh-casefold.json` to repeat it.

## Review gates

- `PROPOSAL.md` and `planned-test-only-changes-v2.json`: original22 plus four
  newly exposed stale rejection tests, with exact assertion blocks, immutable
  snapshots and native tuples/hashes. V1 is retained, not overwritten.
- `PROPOSAL-ADDITIONAL.md` and `additional-test-only-proposal.json`: three
  multiline/compiler diagnostic replacements and one **non-native** host-sink
  contract decision. The latter must not be presented as native oracle proof.
- No proposed TEST-ONLY change is applied or approved here. Another independent
  leaf reviews this source and the proposals before root schedules that work.
- The known unsupported `split(regex; flags)` overload stays unsupported. Its
  test/effects guard is not retired, and no flag stub is introduced.
- `native-timeout-observation.json` retains a timed-out exploratory huge string
  multiplication. It is not native semantic truth or a passing vector; the
  failed batch was not turned into a green rebaseline.
- `committed-r3-*` contains the final command record; older r1/r2/r3/r4/r5/r6
  observations are separate, including author regressions and harness mistakes.

The build uses the actual root build configuration and compiler API, retaining
all ESM/declaration/maps in memory and importing emitted root ESM without tsx.
It deliberately does not run `npm run build`, which would write unowned `dist/`.
It is not a packed-install test or a clean committed-HEAD claim. Other workers'
filesystem, archive, shell and root work can change concurrently; only the
recorded hashes establish the bounded phase identity.
