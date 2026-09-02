# Package-lint rule test cohort

## Scope

Combine the eighteen package-lint rule test entrypoints into one serial cohort.
Keep each rule's test bodies in its own adjacent `.test.cases.ts` file and import
them from the existing `rules/index.test.ts` entrypoint. Preserve every assertion,
fixture, name, and production implementation. Each test still creates its own
memfs workspace; the cohort shares only module initialization and the worker.

The seventeen case files remain included by the root development TypeScript
configuration and ESLint. Root `lint:types` checks production entries, not these
tests; qualify the aggregate and its imported cases with the explicit strict
NodeNext check recorded below. Exclude their test-only classification from the
package's production
TypeScript emit, just like existing `.test.ts` files. Do not change Vitest worker
counts, isolation settings, task ownership, coverage thresholds, or caching.

## Qualification

- Capture original rule names and outcomes before edits. No test may disappear
  or execute twice when native workspace selection discovers the cohort.
- Verify the unchanged case-file bytes against their former entrypoints.
- Run the candidate, reversed import order, and repeated executions; compare
  complete named observations rather than only totals.
- Deliberately omit one import and introduce an assertion failure to confirm the
  inventory and failure checks reject incomplete or failing runs.
- Compare original and candidate serial ABBA runs with the same Node, Vitest,
  source revision, selectors, and configuration, without competing agent gates.
- Run the complete package tests, normal type checking, build, and commit/push
  hooks. Report local timing separately from actual release timing.

## Results

Qualified in `/tmp/poe-vitest4-probe-20260902` on September 2, 2026. All seventeen
renamed case-file bodies are byte-identical to their former entrypoints. There
are no lifecycle hooks, mocks, or global mutations in these rule files. The
existing `runRules` entrypoint fixture also receives five missing required model
fields; the original strict check rejected that incomplete fixture, and the
corrected strict check passes without type assertions or weaker options.

Native selection preserves all 130 unique named rule observations, with no
failures or skips, while reducing eighteen entrypoints to one. Reversing import
order preserves the same complete observations. Removing the license-rule
import deliberately produces only 127 observations and fails the inventory
check. A wrong license assertion produces exactly one named failure and 129
passes, confirming imported leaf failures remain visible. Both temporary
mutations were restored.

All 431 package tests pass in twelve entrypoints. The maintained selected build
closure (`npm run build:workspaces -- --workspace=@poe-code/package-lint`) passes
for its three packages; emitted rule artifacts contain no tests or case files.
The aggregate and all imported tests pass a strict NodeNext TypeScript check.

```sh
npm exec -- tsc --noEmit --strict --skipLibCheck --target ES2022 \
  --module NodeNext --moduleResolution NodeNext --esModuleInterop \
  --resolveJsonModule packages/package-lint/src/rules/index.test.ts
```

### Controlled local timings

Same worktree, Node22.23.2, Vitest4.1.11, native rule selector, existing worker
configuration, and uncached test execution. The probe is based on `9a729b201`
with the already-qualified Vitest4 changes and other owned candidates present;
it is not a clean committed checkout. The root's build, test, and lint gates were
stopped during the confirmation window; the remaining worker was idle and the
other workers were closed. This is not an exhaustive host-process isolation
guarantee. Both layouts include the corrected model
fixture. Each run starts a fresh npm/Vitest process and checks all 130 named
outcomes plus exact case-file bytes.

| Run | Entry layout | Wall time |
| --- | --- | ---: |
| A1 | Original eighteen files | 3.438017s |
| B1 | One cohort | 0.988652s |
| B2 | One cohort | 1.060496s |
| A2 | Original eighteen files | 2.978420s |

Mean wall time decreases from 3.208219s to 1.024574s: 2.183645s, approximately
68.1%, for this rule-only selection. This is not a whole-suite or CI timing
claim. Per-file process/module isolation becomes cohort isolation only for
these rules; fixtures, compiler work, observations, and assertions remain.

Evidence lives under `/tmp/poe-package-lint-rules-*`: baseline/candidate/reversed
JSON, omitted-import and failing-assertion controls, strict-check red/green logs,
and ABBA JSON/log pairs. Initial ABBA records remain under the `abba` prefix:
an 86.478083ms emitter check from another worker overlapped the end of A2 at
08:49:41 UTC. Those co-loaded results are not the table above. The separately
named `abba-isolated` confirmation records preserve all 130 observations in
every run and reproduce the improvement without overlapping owned test gates.
The entire-package report is
`/tmp/poe-package-lint-all-candidate.json`; selected build output is
`/tmp/poe-package-lint-cohort-build.log`. The temporary benchmark driver restores
the candidate layout in its finally block. Historical reports remain unchanged.

Normal commit/push gates and the resulting release remain delivery requirements.
