# Bounded env-split finite-case batches

## Decision and scope

Retain the corrected candidate: the refreshed September 2, 2026 ABBA comparison
saves **2592.614083 ms net per full file**, including the new permanent isolation
control. Baseline mean is 8225.460500 ms; candidate mean is 5632.846417 ms
(approximately 31.5% lower). This exceeds the requested one-second acceptance
threshold. It is a local controlled observation, not a universal CI prediction.
The `NODE_OPTIONS` selection correction is both correctness-qualified and included
in the refreshed ABBA. The earlier ABBA remains unchanged historical evidence.

Work is isolated at detached base
`6205999dd`. Root owns integration, commits, pushes, and full-gate qualification.
Only these existing maintained test files and this plan change:

- `packages/safe-bash/tests/shell/env-split-host.test.ts`
- `packages/safe-bash/tests/shell-stress/env-split-author/resume-host.ts`
- `docs/plans/env-split-finite-batches.md`

No env-shebang, production, shared-runner, concurrency, source-census, input
registration, historical driver, manifest, seal, or evidence file changes.
The additional fast control is inside the already-discovered caller; no new
test file or registration is needed.

## Execution and observation boundaries

The twelve finite scenarios form three serial groups of four:

1. `real-nested-pipeline`, `export-local-cwd-parent`,
   `prefix-assignment-before-clear`, `binary-cursor-origin`.
2. `supplied-empty-origin`, `bom-stderr-stdout`,
   `parse-before-chdir-effects`, `unsupported-before-chdir`.
3. `literal-single-optional-argument`, `literal-injection-host-boundary`,
   `fallback-keeps-context`, `same-stream-split-does-not-consume`.

The thirteen other scenarios keep their original singleton argument vectors:
the five shared-budget cases, three split-cap cases,
`typed-cancel-cleanup-late-reject`, `cleanup-failure-identity`,
`preabort-no-dispatch`, `blocked-input-cancel`, and `sink-cancel-precedence`.
Their scenario setup, assertions, work, and disposal body remain intact.

The helper's new `--batch` protocol admits only these twelve finite scenario
names, with one through four ordered entries. Duplicate finite entries are
allowed for the repeat control. Empty, oversized, protected, and unknown batches
are rejected before scenario setup. The original single-scenario CLI remains
available for all twenty-five scenarios.

Each invocation of the scenario function constructs a fresh memory filesystem,
Shell, registry, command counters, and rejection-listener closure. It awaits
disposal and removes its listener before starting the next scenario. The complete
original setup/assertion/disposal body is preserved apart from indentation.
The module graph is reused within a batch, not Shell state or test results.

Common host supervision retains detached process groups, strict unhandled
rejections, the **4-second / 256-KiB child caps**, the 6-second enclosing test
timeout, signal/error/status checks, group cleanup, and PID-death assertion.
No timeout is increased. The caps and process-exit observations apply once to
each batch, rather than independently to its four rows. This is an explicit
change in process isolation and observation boundaries, not equivalent per-row
process-death coverage. The thirteen protected cases stay isolated.

The parent accepts row receipts only after successful child exit. Each original
named observation then checks its own complete `{ scenario, passed: true }`
receipt. A child failure invalidates the batch before those observations are
reported as passes; it is not retried. Synchronous batch errors identify the
current scenario. No full batch payload is attached repeatedly to row assertions.
Individual finite observation durations now measure receipt assertions; the
batch parent owns the actual combined execution duration.

Explicit Node name/skip filters, including separate/equal forms inherited through
`NODE_OPTIONS`, select the original singleton route up front,
so selecting an original observation cannot execute its otherwise batched
neighbors. There is no runtime-error-triggered fallback. Direct child invocation
also retains the singleton protocol.

## Denominators

| Quantity | Original | Candidate |
| --- | ---: | ---: |
| Original named observations | 25 | 25 |
| Batch parent tests | 0 | 3 |
| New permanent isolation control | 0 | 1 |
| Total Node tests | 25 | 29 |
| Real helper children | 25 | 17 |

Candidate children are thirteen protected singletons, three finite batches, and
one additional four-row repeat/control batch. Thus all original scenarios execute
once, plus four extra finite executions in the new control. The control mixes a
file-creating row, a row requiring an empty filesystem, and two identical
counter-sensitive rows. It is included in both measured candidate runs.

## TDD and correctness

Correctness work used Node `v22.23.2`, the installed tsx route, unchanged serial
test concurrency, and real children. These checks could co-load root hooks and
are not performance evidence:

- Baseline `--batch` invocation fails with `Unknown host scenario --batch`.
  The implemented protocol then passes the same requested rows.
- Full candidate: 29 pass, zero failures/skips/cancellations; all twenty-five
  original observation names are present exactly once.
- Filtered finite/protected observations launch exactly their two original
  singleton commands, not neighboring rows. A launch observer forwards the real
  spawn calls unchanged and records argument vectors and options.
- All twelve finite rows pass with both group order and row order reversed.
- Repeat/state control passes. A test-only observer forwarding actual FS and
  Shell methods sees four distinct filesystems, Shells, and registries, and four
  completed disposals before subsequent row setup. Removing the disposal await
  in an owned temporary negative fails with
  `next row started before prior disposal completed`.
- Listener observation records four additions, four removals, maximum one
  active row listener, and zero remaining listeners.
- Empty, five-row, protected, and unknown batches each exit nonzero with the
  expected admission assertion and no success records.
- A real late `setImmediate` failure, injected after the first row's disposal,
  causes the owning batch to fail despite its previously emitted receipt. The
  originating scenario is visible. The thirteen protected singleton launches
  retain their original arguments and options during that run.
- A wrong scenario in an otherwise successful row receipt fails that original
  named observation and its batch parent. Other rows are not substituted.
- All temporary negatives are removed. The helper still matches the ABBA version;
  the caller's later filter correction has separate current-source qualification.
- Focused strict TypeScript and zero-warning ESLint both pass. No tests, caps,
  assertions, or lint policies are waived.

The disposal observer delegates real methods and adds an asynchronous completion
boundary solely to prove the caller awaits disposal. It is temporary external
qualification tooling, not a production/helper change or a performance fixture.

Final cleanup-flow review finds no explicit `throw` or `return` inside either
helper `finally` block, and the caller has no `finally` block. The original
scenario cleanup body is preserved, including its existing cleanup-error
semantics; this change introduces no primary-versus-cleanup error arbitration.
The new outer catch unconditionally rethrows the caught value, without a
truthiness test, substitution, or sentinel that could discard a falsey failure.
It is outside `finally`. The later filter correction changes no cleanup code.
Current source passes focused types and lint and matches the refreshed ABBA.

## NODE_OPTIONS selection correction

Integration review reproduced a real selection defect with Node22.23.2. Node
accepts both name/skip options through `NODE_OPTIONS`, in separate and equal
forms, but does not include those inherited options in `process.execArgv`.
Before the correction, selecting `export-local-cwd-parent` by its exact original
name ran zero observations and zero children because its batch parent did not
match. Skipping that name reported 24 original observations but still executed
the excluded row inside its batch. Both forms reproduced each defect with exit0.

The only additional code change checks `NODE_OPTIONS` for either filter option
alongside the existing `process.execArgv` check. It selects the original singleton
route before registration. The substring check is conservative: an unrelated
occurrence can disable batching, but cannot silently omit selected observations.
There is no new parser, retry, helper change, or permanent test-count increase.

Real-child red/green controls record original names and actual spawn arguments:

| Inherited selection | Before, both forms | After, both forms |
| --- | --- | --- |
| Exact name | 0 observations / 0 children | 1 observation / 1 singleton |
| Skip that name | Excluded row executes once | 24 original observations / excluded row never executes |

The skip route has 25 children: 24 selected original singletons plus the
independently named repeat-control batch. The default run passes all29 Node tests
with exactly25 original names; explicit CLI name filters also pass in both forms.
Focused strict TypeScript and zero-warning ESLint pass. These are co-load-eligible
correctness checks, not speed measurements. The last lint finished at
10:16:10.721 UTC on September 2, 2026; no further runtime qualification is planned
without coordination.

Evidence is `node-options/red-summary.json`, `node-options/green-summary.json`,
the matching real-event/spawn records, `node-options-default.*`,
`node-options-cli-separate.*`, `node-options-cli-equal.*`, and
`node-options/types.*` / `node-options/lint.*` in the evidence directory below.
Original ABBA logs and `candidate-caller.ts` remain unchanged. Updated exports
identify the current caller separately and include its refreshed performance run.

## Refreshed ABBA (corrected filter detection)

Root granted a new uncontended CPU window with no other agents, gates, or tests
running. All four commands passed sequentially from **10:22:54.071 through
10:23:22.022 UTC on September 2, 2026**, with the original Node22.23.2 command,
tsx loader, concise reporter, serial concurrency and default selection unchanged.
No `NODE_OPTIONS` were inherited. The candidate was restored and CPU release
announced immediately after completion, before this plan update.

| Run | Variant | Tests/pass | Elapsed ms |
| --- | --- | ---: | ---: |
| A1 | Original | 25/25 | 8542.365375 |
| B1 | Corrected candidate, including control | 29/29 | 5508.406959 |
| B2 | Corrected candidate, including control | 29/29 | 5757.285875 |
| A2 | Original | 25/25 | 7908.555625 |

Every run has equal before/after caller, helper, seal and env-shebang hashes;
each source selection is checked against the preserved original or corrected
candidate before execution. The corrected caller SHA256 is
`f92b1c39e1e04da2a8371852d62255e9acfe1a13ca227b9f00a59b597079e4fb`;
the unchanged candidate helper SHA256 is
`fe7bf29086a145bbdf603442fdd1531e643c025a3b33a1590206e276fbe56927`.
The thirteen protected scenario bodies and singleton launch path remain unchanged.

As with the earlier comparison, timed runs retain the actual concise reporter,
not spawn instrumentation. Exact25 original names are reconciled against the
separate current-source native-event capture. The thirteen protected singleton
arguments are checked against saved real-spawn captures, and the original scenario
body remains identical after removing its new function indentation. Thus timed
test counts are directly observed; per-child identities come from correctness
captures plus unchanged-source reconciliation, not a new timed child trace.

Fresh evidence uses `abba-node-options-A1/B1/B2/A2.*` and
`abba-node-options-summary.json`. Original evidence is not overwritten. The
refreshed mean reduction is 2592.614083 ms, including the extra repeat control;
this does not establish universal CI savings or restore per-row process isolation.

## Reserved ABBA (before filter correction)

Root explicitly granted the window after its hook finished, with other workers
not running tests/builds/lint. The four full-file commands ran sequentially from
**09:51:49.958 through 09:52:18.307 UTC on September 2, 2026**. CPU release was
announced immediately, before this document was written.

Each command uses Node22.23.2 with:

```text
--import tsx --test --test-concurrency=1
--test-reporter=./scripts/test-reporting.mjs
tests/shell/env-split-host.test.ts
```

| Run | Variant | Tests/pass | Elapsed ms |
| --- | --- | ---: | ---: |
| A1 | Original | 25/25 | 8567.316375 |
| B1 | Pre-correction candidate, including control | 29/29 | 5787.753083 |
| B2 | Pre-correction candidate, including control | 29/29 | 5640.343000 |
| A2 | Original | 25/25 | 8144.501500 |

Original bytes are preserved outside the checkout. `apply_patch` selects the
two owned source versions only between completed runs. No source changes occur
during a run; no Git reset, result cache, retry, build, or alternate test route
is involved. The harness verifies expected variant bytes and before/after hashes
of the caller, helper, original seal, and untouched env-shebang owner. It restores
the exact candidate after the final original run. The timed reporter remains the
maintained concise reporter; observation-name and child-argument evidence comes
from the separately recorded correctness runs and static source reconciliation.

## Historical identity and residual limits

`resume-seal.json` still pins the original split caller and helper. Before this
work, the maintained caller matches its seal, while the helper already differs:
the historical helper hash begins `c22482b0`, the maintained baseline begins
`f3c490e8`. The historical `core-verify.mjs` explicitly checks those old hashes;
it is not new-source qualification. Neither seal nor driver is rewritten or run.
New maintained bytes do not claim authentication by that old manifest.

Primary caller/helper/env-shebang bytes remain unchanged. The measured checkout
stays at its detached base with only the owned test changes and this plan.
This is focused local qualification, not a full workspace run, historical
reproduction, release qualification, or proof of identical per-case process
isolation. Host variability and the small ABBA sample limit extrapolation to CI.

Evidence: `/tmp/poe-env-split-batches-evidence-20260902`.
`abba-summary.json` and `abba-*.json/stdout/stderr` contain exact commands,
timestamps, durations, counts, and watched hashes. `candidate-full.events.jsonl`,
filtered/spawn records, reverse/admission records, disposal/listener controls,
and late-failure/wrong-row records retain correctness evidence. Original and
candidate caller/helper copies support exact-byte reconstruction.
