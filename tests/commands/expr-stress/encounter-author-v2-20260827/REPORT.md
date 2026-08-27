# Encounter-order author v2 candidate

Source commit: `c3e40f8bd721da5e496f3b3abfd51aee45db5a84`.
Required quota ancestor: `c25e682a7baa2f2abf70cebf8c01d11d0ad5daee`.
Independent preimplementation freeze: `30dda5b930c6e5ea29a54348926fc02b81f9d8e6`.
This is an author handoff, not independent final-review acceptance.

## Ownership and implementation

The atomic source commit contains exactly `src/commands/expr/syntax.ts`,
`evaluate.ts`, `index.ts`, and the new `tests/commands/expr/encounter-order.test.ts`.
The independent freeze receipt was read before implementation. The focused file
was written and hashed before production changes. Syntax/evaluate were changed
only after freeze; index was changed only after the quota receipt released it.
No delegated workers were created. No other source, public, root, shared or old
test files were edited by this author. The source ownership is released for the
separately assigned final reviewer; this author will not edit it again without
root coordination.

`evaluateExpression(args, budget, match, start?)` now combines grammar traversal
and awaited reductions. It retains precedence climbing, prefix arity, parentheses,
forced literals and `--`. Each active operand/reducer runs once; each required RHS
finishes before its enclosing reduction. Group closure/trailing checks occur at
their actual encounter point. No AST/replay, extra Budget/session, speculative
jobs, resets or product native processes are introduced.

Inactive frames have no Value. They still count/check structural nodes, parser
and structural depth, and checkpoints, but do not encode operands, convert values,
call reducers or submit jobs. Diagnostic quoting and global argv admission remain
bounded; malformed skipped syntax still fails. Arithmetic/string/locale/BRE bounds
and the shared worker allowance are preserved. The reducers consume evaluated
values rather than traversing nodes.

`ORDERING-DELTA.json` authenticates source hashes and proves the quota index is
byte-identical outside the exact import/entry-call replacement. `internal.ts`,
`bre-worker.ts`, regex client and protocol are unchanged from the quota commit.
The live nullable-backreference refusal is not replaced with any prototype worker.
Cleanup registration/acquisition/close code is unchanged; observed jobs retain
awaited closure and caller cancellation identity.

## Pinned results

Both runs build an isolated committed import closure: 219 files including selected
source, tests/helpers and four package/build inputs, about 383 KB compressed.
Tests bind the candidate test commit on both runs; product source binds either the
quota commit or candidate. This explicitly includes the new frozen test on the
quota baseline, not a claim that it existed historically. Unrelated live edits
neither enter nor veto these archives. Shared dist is not rebuilt.

| Cohort | Quota-only baseline | Candidate | Qualification |
| --- | ---: | ---: | --- |
| Unchanged original controls | 42/61 | 61/61 | Exact original input/driver bytes |
| Frozen GNU semantic subset | 25/44 | 44/44 | Historical GNU 9.7 Darwin expectations, not fresh native execution |
| Original project subset | 17/17 | 17/17 | No extra native claim |
| Actual Shell replay | 3/5 | 5/5 | Overlapping original inputs |
| Independent nearby controls | 11/16 | 15/16 | Separate project denominator; quota conflict remains |
| New focused canonical tests | 9/28 | 28/28 | Frozen before production implementation |
| Unchanged selected canonical tests | 558/559 | 558/559 | Existing quota sink conflict remains |
| Combined selected expr tests | 567/587 | 586/587 | Neither run is all green |
| Shared grep/rg/expr protocol tests | 61/61 | 61/61 | Five protocol tests overlap expr cohort |
| Historical old-cap control | 0/1 | 0/1 | Separate unchanged red expectation |
| Strict source/declaration build | Pass | Pass | `skipLibCheck:false` |
| Strict selected source/test types | Pass | Pass | Explicit selected closure, not full consumer gate |

The two native-oracle test files `native.test.ts` and `regex-native.test.ts` were
not executed in these archives. Their maintained TypeScript inputs and imported
helpers are still included in strict checking. No old tests were edited, waived,
renamed, hidden by configuration, or counted as passing. Prototype
`repeat-history/candidate.checks.ts` is typechecked as a maintained source, not
executed or promoted to current runtime behavior.

Original 40/61 accepted-source and later 42/61 qualified evidence remain separate
and unchanged. No historical mixed-source capture is rescored. A preliminary
live, unpinned development run observed 550/551 while the quota author was changing
index; it is not used as an acceptance baseline. The separately captured focused
development run passed 28/28 and its strict typecheck passed before source commit.

## All 19 repaired original failures

Exact argv, C environment, old/new status/stdout/stderr, ordered jobs and event
traces for every row are preserved in `ORDERING-DELTA.json`. All return status 2
with empty stdout on both versions; diagnostics and/or required jobs change.

Eleven arithmetic/noninteger ordering failures, with no regex jobs:

- `root-counterexample`
- `modulo-trailing`
- `noninteger-trailing`
- `left-error-before-next-operator-missing`
- `left-error-before-next-same-precedence`
- `left-error-before-skipped-syntax`
- `group-runtime-before-missing-close`
- `group-runtime-before-wrong-close`
- `nested-runtime-before-close`
- `prefix-first-argument-before-missing-second`
- `prefix-second-before-missing-third`

Eight regex ordering/submission failures, each changing zero to one awaited job:

- `regex-error-before-trailing`
- `regex-error-before-close`
- `regex-error-before-later-missing`
- `regex-prefix-error-before-outer-arity`
- `regex-success-before-trailing`
- `regex-success-before-missing-close`
- `regex-success-before-runtime`
- `first-regex-before-second-syntax`

The fifth, sixth and eighth regex rows already had the same final diagnostic;
their previously missing job is the defect. There are zero remaining failures
in the original 61, not zero remaining failures in every selected cohort.

## Conflicts and proposed versioned migration

No newly failing parse-all-before-jobs expectation was observed in the 559
unchanged selected non-native canonical tests. This is not a whole-repository
claim. The old implementation's 19 parse-first event traces remain immutable;
they are old observations, not current green assertions. Encounter-order v2 is
covered by the new regression file without rewriting any old test.

The exact remaining canonical conflict is
`tests/commands/expr/contracts.test.ts:138`, test
`sink failure is status 3 and diagnostic failure is not swallowed`, input `["1"]`
with a stdout sink throwing `Error("sink failure")`, environment `LC_ALL=C`.
It expects a result with status 3 and the generic execution/output diagnostic.
Both quota baseline and candidate instead reject that same sink Error, return no
status, emit no stderr, and submit zero matcher jobs. Its first await rejects;
later diagnostic-sink assertions inside that test are not reached. This is the
quota-approved identity rule, not an encounter-order regression.

The frozen independent case
`tests/commands/expr-stress/encounter-independent-v2-20260827/freeze/controls.json`,
id `stdout-failure-no-regex-replay`, input `["a",":","a"]`, expects status 3 and
`expr: execution or output failure\n`. Both versions instead reject the original
`Error("independent sink failure")`, with no status, stdout or stderr. Exactly
one matcher job completes before stdout starts; then close starts, the worker
exits, close ends, execute settles with zero workers, and overlapping cleanups
are awaited. The complete candidate trace is in `candidate-01/nearby-results.json`.

Proposed separately approved migration: preserve the old canonical test and
frozen 16-case source/expectations as version-1 reproduction data, and introduce
an explicitly named `expr-output-sink-identity-v2` canonical assertion plus a
separately denominated nearby-v3 identity case. Assert exact rejection identity,
no diagnostic rewrite, one completed job/no replay and awaited cleanup; retain
independent stderr sink checks. Do not relabel 15/16 as 16/16 or silently rewrite
the frozen control. No such migration is implemented in this assignment.

The separate historical old-cap input `["1","x"]`, `maxOutputBytes:1`, still
expects status 2/full syntax text but returns status 3 and
`expr: output bytes limit exceeded\n`, with zero jobs. It remains 0/1, not a
sequencing fix or a newly green quota control.

## Integrity, cleanup and limits

Each archive is generated from exact Git inputs and hashed. Complete extracted
source/tests and compiled inventories agree before/after, including added-entry
detection; generated dist and the explicit development-tooling symlink are
excluded only from the source inventory. The compiled inventory is checked
separately. Frozen selected input paths are authenticated before/after; this
does not claim append-proof protection for the entire independent evidence tree.
Selected historical cases/drivers/native observation/product capture hashes are
also checked against their original commits by `summarize.mjs`.

Both runs report zero original/nearby workers remaining. Canonical lifecycle
safety hooks report no active workers before safety cleanup. All owned synchronous
children settled normally; no SIGSTOP was used; both extraction directories and
their temporary parent are absent. Installed development tooling is reused, not
independently rebuilt. Node is v22.22.2 on Darwin 25.4.0 arm64; no Linux, broad
GNU/POSIX parity, performance, superiority, public completion or 72-hour claim.

Reproduce only into a new output name:
`node tests/commands/expr-stress/encounter-author-v2-20260827/capture.mjs --capture c3e40f8bd721da5e496f3b3abfd51aee45db5a84 UNIQUE-NAME`.
This intentionally changes the evidence-directory inventory; do not overwrite
existing runs or reinterpret a subsequently invalidated seal as valid.
