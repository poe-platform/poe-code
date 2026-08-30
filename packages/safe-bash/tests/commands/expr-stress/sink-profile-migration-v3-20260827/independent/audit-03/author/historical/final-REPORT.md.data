# Independent FINAL encounter verifier v2 — August 27, 2026

## Verdict and ownership

**The exact encounter-order candidate passes the unchanged 61/61 and closes all
19 original failures. This is not an all-green final gate.** The unchanged nearby
cohort is **15/16**, with one old stdout-sink expectation conflicting with the
authorized exact-identity contract. Shared regressions are **275/276**, with an
unresolved native-rg fixture-location failure. No genuine new product bug was
established; consequently no product-bug issue file was emitted in `/tmp`.

I am the independently assigned final verifier, not the root or product author.
I read the applicable instructions and frozen controls before inspecting product
implementation, worked without redelegation, and wrote only this new evidence
directory. Product, original fixtures, other owners' evidence, exports and root
configuration were not changed. All product execution used exact committed
archives, never HEAD/live-source overlays. The separately arriving author receipt
is retained as `AUTHOR-RECEIPT.txt`; it did not provide these execution results.

## Immutable inputs

- Candidate: `c3e40f8bd721da5e496f3b3abfd51aee45db5a84`.
- Verified ancestor/quota candidate: `c25e682a7baa2f2abf70cebf8c01d11d0ad5daee`.
- Preimplementation encounter freeze: `30dda5b930c6e5ea29a54348926fc02b81f9d8e6`.
- Exact JSON-serialized original 61-array SHA-256:
  `d4bb6baf0109a8f5ba2e6752a1bb5d56c492cbdde43495883f68a4a2ea124a47`.
- Frozen quota21 and original47 drivers authenticate to
  `2fc54ff376e56b8865fafdc5409f3d64501d78e7`, including `FREEZE.json`.
- Original baseline results authenticate to the freeze owner's subsequent
  `8a997c8f` evidence commit. That baseline's product source was
  `1b2ddea9e38b25cc91134a2f35a318e27f4d7c29`, not the quota candidate.

All 16 initially committed encounter freeze files were byte-authenticated.
Before/after checks detect appended files in the frozen `freeze` and `historical`
subtrees without treating the owner's continuing reports as unauthorized changes.
The exact original and nearby drivers ran unchanged, directly from their frozen
read-only locations, against independently built candidate output.

`SOURCE-AUDIT.json` records **349 individually Git-authenticated extracted
source/test/helper/root-input files**, exact blob IDs and SHA-256 hashes. Only
these three production files differ from the quota candidate:

| Production file | Candidate SHA-256 |
| --- | --- |
| `src/commands/expr/syntax.ts` | `68dc433cb081344eaa180dbe592534b669b641426e9752abdabfd5a214e8c7e4` |
| `src/commands/expr/evaluate.ts` | `c90884b0b08d422e588826df648935fba2944382d93c5d4a12f796b61390505d` |
| `src/commands/expr/index.ts` | `e7cf6a0077a291578f4c669fe41da37188be8cebcb19bdb574838fd7fae2eb8e` |

`internal.ts`, `bre-worker.ts`, shared regex client/protocol/worker, `src/index.ts`,
`package.json` and lockfile are byte-identical to the quota candidate.

## Actual results, not additive coverage

| Cohort | Observed result | Qualification |
| --- | --- | --- |
| Original exact 61 | **61/61** | Baseline 42/61 preserved; all 19 red IDs close |
| GNU semantic subset | **44/44** | Within the 61; original baseline 25/44 |
| Original project subset | **17/17** | Within the 61 |
| Independent nearby | **15/16** | Separate original inputs; baseline 12/16 |
| Actual Shell replay | **5/5** | Repeats five original inputs, not new coverage |
| Historical old-cap | **0/1** | Separate preserved old output-contract expectation |
| Original quota47 | **46/47** | Original stdout-recasting expectation remains red |
| Frozen corrected quota21 | **21/21** | Independent exact-identity/quota/cleanup controls |
| Legacy non-native source tests | **236/237** | One sink-contract conflict; six original files |
| Additional canonical source tests | **338/338** | Five other files, including author encounter/quota tests |
| Shared grep/rg/regex regressions | **275/276** | Same eleven paths; candidate source; one native fixture-location red |
| Old installed-package core | **145/146** | One original sink-recasting assertion remains red |
| Independent moved physical package smoke | **19/19** | Packaging execution, not new native parity coverage |

The source-test subdenominators below **partition**, rather than add to, 237:

| Candidate source test file | Pass/total |
| --- | --- |
| `tests/commands/expr/abort-reason-regression.test.ts` | 111/111 |
| `tests/commands/expr/contracts.test.ts` | 26/27 |
| `tests/commands/expr/grammar.test.ts` | 73/73 |
| `tests/commands/expr/regex-lifecycle.test.ts` | 11/11 |
| `tests/commands/expr/regex-limits.test.ts` | 10/10 |
| `tests/commands/expr/regex-protocol.test.ts` | 5/5 |

The old 146-core denominator partitions into **37/37 protocol**, **19/19
lifecycle**, and **89/90 runtime**. These properties overlap the canonical source
tests and frozen controls. `SUMMARY.json` records exact files and overlap rules;
`summarize.mjs` derives source-file counts from actual reporter rows, not estimated
test declarations. The 338 additional tests use diagnostics-regression,
inactive-prefix, named-profile, encounter-order and output-quota files.

The four native-dependent tests in `native.test.ts` and `regex-native.test.ts`
were **not executed**, not counted as passes/skips. The separately maintained
`repeat-history/invariants.test.ts` was also not executed in this encounter
review. All those maintained TypeScript inputs were included in the strict scoped
typecheck. No 241/241 legacy, full canonical, repeat-history or full repository
gate is claimed.

## All nineteen closures

`candidate-01/nineteen-closure.json` retains each original baseline row alongside
the actual final row: argv binding, expectations, observed bytes/status, budget
identity, encodes, submissions and cleanup events. The closed IDs are:

- `root-counterexample`, `modulo-trailing`, `noninteger-trailing`.
- `left-error-before-next-operator-missing`,
  `left-error-before-next-same-precedence`, `left-error-before-skipped-syntax`.
- `group-runtime-before-missing-close`, `group-runtime-before-wrong-close`,
  `nested-runtime-before-close`.
- `prefix-first-argument-before-missing-second`,
  `prefix-second-before-missing-third`.
- `regex-error-before-trailing`, `regex-error-before-close`,
  `regex-error-before-later-missing`, `regex-prefix-error-before-outer-arity`.
- `regex-success-before-trailing`, `regex-success-before-missing-close`,
  `regex-success-before-runtime`, `first-regex-before-second-syntax`.

These are eleven arithmetic/noninteger ordering failures and eight regex
ordering/submission failures. Matching final diagnostics alone is insufficient:
three regex closures already had matching error bytes but previously omitted
the required active job. Final submission/order assertions pass unchanged.

## Source and safety review

The parser advances one token cursor and awaits active reductions during
precedence traversal. There is no retry parse, AST replay pass, budget reset,
duplicate matcher submission or replay-driven operand allocation. Inactive
operands carry depth/structural state but no value; arity/syntax/node/depth checks
remain active without operand encoding, numeric conversion or matcher jobs.
Small structural objects/arrays still allocate, and error quoting can encode a
diagnostic token: this is not a claim of zero JavaScript allocation.

One invocation Budget is shared with worker allowances; reported worker steps
are charged back before continuing. The original argument/count, numeric,
node/parser-depth, work, string/output and regex ceilings remain. Source limits
tests pass. The original and nearby traces show sequential awaited jobs, one
budget/session, decreasing allowances, no inactive encodes, and workers gone at
execute settlement. The three-job nearby control submits `a,b,c` once in order.

Cleanup registers synchronously before session acquisition, rejects late
admission, shares an idempotent promise with finally, and awaits pending work and
retirements. Source lifecycle/reason tests include structural undefined and native
falsy reasons; quota21 and moved cases retain exact sink/caller identity. Normal,
emergency and stdout writes are awaited. No opaque-host-work preemption guarantee
is inferred.

The BRE engine retains its `isMainThread` refusal and the live unsupported guard
for a backreference to a capture inside nullable repetition. No historical repeat
worker/artifact is overlaid. Canonical protocol tests verify main-thread refusal;
old core controls guard caller-thread RegExp compilation; quota and moved probes
reject main-thread matcher imports. No worker remains after either frozen probe,
and quota probes report no unhandled rejections or safety terminations.

## Preserved conflicts and proposed versioned migrations

No original assertion or input was edited, and no corrected expectation is
silently counted as an original pass.

1. **Nearby `stdout-failure-no-regex-replay`:**
   `encounter-independent-v2-20260827/controls.mjs`, argv `['a',':','a']`.
   Original expects exit 3, empty stdout and
   `expr: execution or output failure\n`. Actual rejects the exact sink object,
   emits no bytes, and has exactly one completed job with cleanup. Proposed
   separately approved expectation version: `expected: { rejected: 'sink' }`;
   keep the exact job/order/budget/cleanup assertions. Original result stays 15/16.
   All four original nearby sequencing reds close; this quota-contract conflict
   newly differs from the pre-quota baseline.
2. **Quota `stdout-rejection-normal-quota`:** original
   `output-emergency-review-20260827/cases.mjs:36`, argv `['1']`, cap 2.
   The original recasting path expects exit 3 and the emergency quota diagnostic
   (the normal diagnostic itself exceeds that cap). Actual preserves the stdout
   sink reason with no fallback write. Frozen quota21 supplies the separately
   versioned exact-identity proof; the original remains 46/47, never green.
3. **Canonical `tests/commands/expr/contracts.test.ts:138`:** argv `['1']`,
   stdout throws `Error('sink failure')`. Original expects status 3 and stderr
   matching `/output failure/u`; actual rejects that error with no stderr. Later
   diagnostic-sink assertions in this one test are not reached. Proposed new
   version: bind the stdout reason and assert rejection by identity and zero
   diagnostic writes, then retain the separate diagnostic-rejection check.
4. **Old core `runtime-driver.mjs:99`–106:** original path
   `tests/commands/expr-stress/diagnostics-candidate-review/replay/runtime-driver.mjs`,
   argv `['41','+','1']`. Original expects the *stderr* sentinel and writes
   `['stdout','stderr']`; actual is the original *stdout* sentinel and only
   `['stdout']`. Proposed version changes those two expectations to stdout
   identity/one write, preserving cleanup. Original remains 145/146.
5. **Historical old-cap:** argv `['1','x']`, `maxOutputBytes:1`, expected exit 2
   and full syntax diagnostic. Actual is exit 3 with
   `expr: output bytes limit exceeded\n`. It remains separately 0/1, not a
   sequencing regression and not folded into the 61.

No executed canonical test required a blanket parse-all-before-jobs rule. The
old zero-job assertions are about genuinely inactive branches; they still pass.
The implementation-sensitive third-checkpoint inactive controls also pass without
assertion migration. This is limited to the selected executed files.

## Shared eleven-file blocker and audit setup correction

The exact eleven paths are in `candidate-01/candidate.json` (`sharedPaths`) and
`SOURCE-AUDIT.json` (`sharedHashes`). The same candidate tests ran with their
committed helpers and no assertion/argv changes, totaling 276.

The only failure is `tests/commands/search/rg.test.ts:63`,
`rg native differential: gitignore requires git by default`, argv `['--files','.']`.
The fixture has `.gitignore: '*.txt\n'` but no local `.git`. Virtual output is
51 bytes, including `./alpha.txt\n./beta.txt\n`; native output is 28 bytes,
`./sub/code.js\n./sub/code.ts\n`. The native temporary directory is physically
inside this Git checkout, so the native side observes an ancestor repository
that the VFS fixture does not have. The attempted `GIT_CEILING_DIRECTORIES` binding
did not prevent that discrepancy. The complete original failure is retained in
`candidate-01/shared11-process.json`; **no correction run is presented as green**.

Proposed setup-only correction, requiring ownership permission outside the
current workspace-only scope: rerun the same exact candidate eleven-file command
with a fresh owned physical `TMPDIR` outside any repository, `TSX_DISABLE_CACHE=1`,
and normal cleanup. Do not change `.git` fixtures, native argv, assertions, or
source. This is the remaining shared validation blocker. The prior qualified
review's outside-repository 276/276 result does not certify this candidate.

An additional read-only audit attempt initially asserted all eleven test files
were byte-identical to the historical qualified commit. It failed on the committed
TypeScript-only overload annotation in `continuation/glob.test.ts` (two type
imports and an `Omit<RegexExecutor,'request'>` intersection annotation). Original
`audit.mjs` and `audit-attempt-01.json` remain unchanged. Separately versioned
`audit-v2.mjs` records both hashes and the exact diff instead of asserting identity;
all 349 actual candidate input files still authenticate. Ten test files are
byte-identical, one has that disclosed type-only change. No replay setup/input
failure occurred in either the 61 or 16 frozen driver.

## Build, types and moved offline package

Both isolated candidate extractions build with TypeScript 5.9 tooling,
`tsc -p tsconfig.build.json --skipLibCheck false`. The first archive's strict
no-emit check includes all source, maintained expr/expr-author TS and the exact
shared test/helper list. It passes. This is scoped source/test checking, not a
full public-consumer or native/service acceptance gate. Development tooling is
the existing local `node_modules`, not a newly installed/global dependency.

`npm pack --offline --ignore-scripts` uses exact committed source/root inputs and
isolated build output. The primary tarball SHA-256 is
`8331e853455f295dfda24ff53d612514212067ca2075df09e8b60339bda58a5e`.
It contains 829 entries, 701,500 compressed bytes. An offline install uses a
different fresh empty cache; the consumer directory is physically renamed before
execution. Installed `dist` matches the built tree exactly, has no source tree,
and no runtime dependencies. Neither npm operation changes root package files.

The primary moved smoke passes 19/19: active encounter failures, worker matching
and capture, inactive worker suppression and retained syntax, three active jobs,
quota output, six sink identities and six caller-abort identities. Imports are
restricted to installed physical `dist` and Node builtins; the worker must be the
installed `dist/commands/regex-execution/worker.js`. No source fallback is used.
Core146 is separately executed against another offline installed, physically
moved artifact from the same source, using the old drivers unchanged except for
four explicit orchestration bindings in `core-binding-deltas.json`. It includes
the configured real-VFS artifact/pipeline workflow and synthetic protocol/lifecycle
controls; synthetic transport success is not worker-algorithm parity.

**Expr remains HOLD.** These are physical-module/worker closure checks, not a
public root or subpath export claim. The manifest has no `./commands/expr` export.
No repeat promotion, root wiring or runtime dependency was added.

## Environment, integrity and cleanup

Execution host: Node v22.22.2, Darwin 25.4.0 arm64. The 44 normative expr tuples
remain the original GNU coreutils 9.7 Darwin `LC_ALL=C` captures, pinned binary
SHA-256 `e8a4e2b58a33d2ad6bfa9eb8a4ed5f62775ab9ceac4b9421680c98973fd9109c`.
No native expr recapture, fresh native-expr availability, Linux or general parity
claim is made. Native rg was used only by its existing regression tests; its
post-run executable observation is recorded separately, not misrepresented as a
before/after frozen prerequisite guarantee.

Selected source, built output and installed package inventories compare complete
entry sets before/after, detecting additions as well as changes/removals. Only
explicit harness additions (`node_modules`, built `dist`, the scoped config) are
separately enrolled. Exact committed archives are rehashed after execution.
`SEAL.json`/`seal.mjs --verify` cover this owned evidence tree append-aware. These
are selected observation-time integrity checks, not global live-tree or
transient-mutation guarantees.

All owned child processes settled; frozen probes and moved smoke report zero
remaining workers, and old-core watchdogs await termination. Both extraction,
cache, installed-package and temporary trees were removed normally; cleanup
receipts retain status/paths. Other workers' native artifacts and staging were
not removed or committed. Captures refuse overwrite and are explicit opt-in,
outside canonical `.test.ts` discovery. No 72-hour, superiority, performance,
full-public-completion or whole-project completion claim is made.

Read-only evidence verification:

```sh
node tests/commands/expr-stress/encounter-final-review-v2-20260827/seal.mjs --verify
```
