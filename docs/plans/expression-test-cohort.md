# Expression test cohort

## Expansion review

The expansion is complete: nine byte-identical modules, 369 family cases and
589 full-expression cases. Final equal-coverage medians are 11.187s isolated,
10.215s pilot-plus-standalones and 8.408s final. All temporary probes are removed.
The final decision and evidence at the end supersede only the pilot membership
and conservative exclusions, while retaining the original pilot measurements.

The accepted four-file pilot evidence below remains intact and is not the final
cohort decision. The September 1 follow-up authorizes evaluating
diagnostics-regression, encounter-order, inactive-prefix, output-quota, and
regex-native within the same scope. Per-test mocks are not automatically unsafe:
admission requires their normal cleanup to restore descriptors and resources
before subsequent cases and after the family, without reset wrappers.

The expansion plan is to inspect cleanup and vector ownership; establish
isolated candidate counts; run forward, repeated, reversed, and negative
descriptor/resource controls; include only passing candidates; then measure the
expanded isolated/family layouts separately from the pilot and preserve all
589 expression cases. The three top-level Worker-replacement entries and the
nested shared-session entry remain standalone. Final findings follow the pilot
evidence at the end of this document.

## Accepted pilot evidence

## Scope and acceptance

September 1, 2026: this delegation owns only
`packages/safe-bash/tests/commands/expr/**` and this document in
`/tmp/poe-test-speed-push-20260901`. The frozen integration checkout, production,
other families, historical evidence, concurrency settings, Git, and release
operations remain untouched.

Consolidate only `contracts`, `grammar`, `regex-limits`, and `regex-protocol`
through byte-identical same-directory `.cases.ts` files and one static-import
`.test.ts` entry. This deliberately changes four per-file isolated processes to
one per-family isolated process; it does not disable process isolation globally.
Keep all other expression entries standalone, without lifecycle wrappers.

## Validation plan

1. Audit all twelve direct expression entries, helpers, the nested shared-session
   entry, active literal consumers, and authenticated discovery boundaries.
2. Establish three serial old-layout baselines and an intentional assertion
   failure before consolidation, then restore the exact source bytes.
3. Rename only the four safe modules and add their static-import family entry.
4. Compare counterbalanced serial old/new layouts using the same renamed bytes
   and paths; require exact case names/counts and a measured gain.
5. Run repeated and reversed family imports, per-module failure attribution,
   process/prototype/resource state controls, and complete expression discovery.
6. Remove temporary probes, verify source preservation, and record exact paths,
   measurements, controls, and limitations here. Stop if safety or gain fails.

## Initial audit and baseline

Authenticated discovery selects twelve direct tests and
`repeat-history/invariants.test.ts`. No boundary names the expression directory.
A bounded literal scan of 620 active test, script, and configuration paths finds
no references to the four selected old entry paths. This is not a claim of
exhaustive historical consumer clearance; historical evidence stays unchanged.

Three serial pre-change runs pass the identical ordered 115 names, with no
failures, cancellations, skips, TODOs, or stderr. Wall times are 2178.563,
2504.810, and 2160.202 ms. The ordered-name JSON SHA-256 is
`b91b6e63b230d0dbaa90728856e1e8c08b0188500999c1ce880b2412e8864867`.

## Decision and measured gain

Keep the four-file cohort. Six counterbalanced observations per layout have
median wall times of **2.084 s old** and **1.013 s new**:
**51.37% less wall time**, **2.06x faster**, and
1.071 s saved per selected-family run. This is a local selected-family
result, not a full-workspace or release performance claim.

Environment: September 1, 2026; live concurrently used worktree; Darwin arm64
25.4.0; Node v22.22.2; package-local tsx 4.23.12.
The parent measured child startup through exit using performance.now(); Node
TAP duration_ms is recorded separately, not summed from test durations.
There was no cache clearing or host-load control. Initial warm-up observations
remain separate from the counterbalanced comparison.

Old initial runs use the original four .test.ts paths. Crucially, all
counterbalanced old runs explicitly pass the four renamed .cases.ts paths as
independent Node test entries, while new runs pass expression.test.ts, which
imports those exact same paths and bytes. All runs use the maintained serial
setting --test-concurrency=1. No concurrency flag, runner, or discovery change
was made, and --test-isolation=none was never used.

All eighteen measured sweeps have exit 0, 115 passes, zero failures,
cancellations, skips, TODOs, and stderr. Their ordered name arrays are identical,
including repeated names. Counterbalanced execution order is new, old, old,
new, repeated three times; runs are serial rather than simultaneously timed.

| Sweep | Wall ms | Node duration ms |
| --- | ---: | ---: |
| old-initial-1 | 2178.563 | 2125.665 |
| old-initial-2 | 2504.810 | 2463.505 |
| old-initial-3 | 2160.202 | 2119.581 |
| new-initial-1 | 1109.031 | 1060.624 |
| new-initial-2 | 999.052 | 952.883 |
| new-initial-3 | 997.140 | 954.839 |
| balanced-1-new | 1028.554 | 978.048 |
| balanced-2-old | 2040.778 | 1989.357 |
| balanced-3-old | 2119.689 | 2079.936 |
| balanced-4-new | 998.194 | 953.899 |
| balanced-5-new | 1085.731 | 1039.515 |
| balanced-6-old | 2148.692 | 2100.896 |
| balanced-7-old | 1982.843 | 1931.972 |
| balanced-8-new | 900.676 | 859.126 |
| balanced-9-new | 960.558 | 918.214 |
| balanced-10-old | 2048.265 | 2005.180 |
| balanced-11-old | 2207.229 | 2166.558 |
| balanced-12-new | 1125.864 | 1083.421 |

## Exact path changes and byte preservation

All paths in the next table are relative to
`packages/safe-bash/tests/commands/expr/`. Each old file becomes the named new
file with byte-identical contents. The SHA-256 applies to both old and new;
imports, helpers, assertions, data tables, names, timeouts, and source line
numbers are not rewritten. There is no shared case-state pool or new wrapper.

| Old path | New path | Cases | SHA-256 |
| --- | --- | ---: | --- |
| `contracts.test.ts` | `contracts.cases.ts` | 27 | `ce900757c3d61c85e76960260f54e90fa4ae1edb0d71b070b8bf639b9a2326b7` |
| `grammar.test.ts` | `grammar.cases.ts` | 73 | `0de1d7042f5f0a1a7ad75a540096bdb07cdf28a2137b6927b2e8177091d64919` |
| `regex-limits.test.ts` | `regex-limits.cases.ts` | 10 | `4b938f201b7ffffcb317734f7784d7b88cf5a95aacbad53a5e4df957d3f9c2a8` |
| `regex-protocol.test.ts` | `regex-protocol.cases.ts` | 5 | `465fb777d2d35df56c736d4accfbb502f63b690ec9f3b98a4a32d45410f34bc5` |

New entry: `packages/safe-bash/tests/commands/expr/expression.test.ts` contains
only four static imports, in the table order. The only other permanent write is
`docs/plans/expression-test-cohort.md`.

`helpers.ts` is unchanged (SHA-256
`51448c59444bb12337860c53c6fc2a9b2e4a193e172630f425a096fadee1b390`).
All eight unselected direct test files match their pre-work source buffers.
Other support files and the nested repeat-history suite were not edited.

## Safety audit and exclusions

The twelve direct expression tests were inspected for imports, hooks, prototype
writes, mocks, shared mutable state, timers, and native launchers. No selected
file has a global hook, mock, environment mutation, or module-level Worker
replacement. The selected cases do use the real regex worker via the existing
executor; those invocation/session lifetimes remain unchanged.

| Original entry | Disposition and relevant state |
| --- | --- |
| contracts.test.ts | Include: invocation-local memory FS, command, sinks and cancellation; private timers cleared in finally; Shell instances disposed. |
| grammar.test.ts | Include: read-only-in-use table; each row calls run with fresh state; no hooks/mocks. |
| regex-limits.test.ts | Include: invocation-local limits, output/backpressure state and Shell disposal; no hooks/mocks. |
| regex-protocol.test.ts | Include: read-only-in-use descriptors/buffers; per-test executor/session closed in finally; no hooks/mocks. |
| abort-reason-regression.test.ts | Keep standalone: top-level threads.Worker replacement, syncBuiltinESMExports, shared worker list/hold flags/retirement gate and after cleanup. |
| named-profile.test.ts | Keep standalone: top-level Worker replacement, shared worker census and after cleanup, plus prototype mocks. |
| regex-lifecycle.test.ts | Keep standalone: top-level builtin Worker replacement, shared interception/readiness flags, worker census, after cleanup, manual prototype replacement. |
| diagnostics-regression.test.ts | Keep standalone conservatively: manually replaces RegexSession.prototype.matchExpr and restores in finally. |
| encounter-order.test.ts | Keep standalone conservatively: TestContext prototype mocks on Budget and RegexSession; do not broaden their process sharing. |
| inactive-prefix.test.ts | Keep standalone conservatively: TestContext prototype mocks and a module-level rejecting filesystem proxy. |
| output-quota.test.ts | Keep standalone conservatively: TestContext prototype mocks on budgets/executors/sessions and held cleanup promises. |
| regex-native.test.ts | Keep the separate unsupported/native-audit corpus: imports external author vectors; despite its name, the entry itself does not spawn a native expr process. No claim that this file is inherently unsafe. |

The additional nested `repeat-history/invariants.test.ts` remains standalone:
it opens a module-level executor/session and closes them with after. It is not
one of the twelve direct entries and was not moved.

The helper creates new buffers, memory filesystems, abort signals, environments,
and command instances per invocation. Protocol fixture objects are module-local
and not mutated by their tests. Sharing the imported helper/production modules
is deliberate; grouping does not share command contexts or regex sessions.

The authenticated discovery/boundary check finds no selected path seal or
fixture-boundary membership requiring an edit. The initial 620-path literal
consumer scan includes active test entries, immediate package scripts and the
package/boundary/tsconfig declarations. A post-rename scan also checks bare old
filenames and .test.js spellings in the still-existing members; no references
are found. These are bounded checks, not an exhaustive dynamic-import or
historical-selector proof. No historical evidence, sealed capture, inventory,
or outside-scope consumer was rewritten.

## Isolation, state and failure controls

This changes **per-file process isolation to per-family process isolation** for
four files only: four Node test child processes become one. Eight direct
standalone files plus the nested shared-session file retain individual process
isolation. Authenticated expression discovery changes from 13 entries to 10
(12 to 9 directly in expr/). No exclusion hides cases: total expression coverage
is still exactly 589 tests.

Before moving files, an intentional first grammar expected-value mutation
produced exactly one failure, 114 passes, exit 1, and the original
`grammar.test.ts:42:10` stack location. It preserved all 115 names. Restoring
that line restored the original buffer before the full 589-case baseline.

After moving files, four independent negative runs each mutate one selected
case, execute the complete family, and restore the source immediately. Every
run preserves all 115 ordered names and reports exactly 114 passes, one failure,
exit 1, and no skipped/cancelled/TODO cases:

| Mutated source | Case number | Mapped assertion stack | Mutation |
| --- | ---: | --- | --- |
| contracts.cases.ts | 1 | contracts.cases.ts:11:10 | Factory expected-name mismatch. |
| grammar.cases.ts | 28 | grammar.cases.ts:42:10 | First arithmetic expected-output mismatch. |
| regex-limits.cases.ts | 101 | regex-limits.cases.ts:19:10 | First pattern-byte cap changed from 1 to 2. |
| regex-protocol.cases.ts | 111 | regex-protocol.cases.ts:14:10 | First reply expected value changed to null. |

The failing names are, respectively, factories register exactly expr with
explicit replacement; expr grammar ["2","+","3","*","4"]; expr regex cap:
input bytes; and expr replies validate exact shape, original byte bounds and
scalar boundaries. TAP registration locations may use tsx's generated line 1,
but mapped assertion stacks still point to the original assertion lines in the
renamed modules, not merely to expression.test.ts.

Temporary owned-scope probes use static imports, not test-body wrappers:

1. Import every .cases.js module twice with distinct ?repeat=1 and ?repeat=2
   module specifiers in one test entry. This re-registers the identical cases
   twice in one process while sharing unchanged production/helper imports.
   Two independent runs each pass exactly 230 tests, with the original
   ordered 115-name array concatenated with itself.
2. Import all four case modules in reverse module order. Two independent runs
   each pass exactly 115 tests, with the exact reversed module blocks and
   unchanged internal case order, not just matching totals.
3. In both probe layouts, snapshot and compare process.env, cwd, the builtin
   Worker constructor, and own property descriptors of Budget.prototype,
   RegexExecutor.prototype and RegexSession.prototype in an after hook.
   Verify distinct FS, signal, env and sink identities between helper calls;
   a private file written in the first memory FS is ENOENT in the second.
   MessagePort/Timeout resource lists are [] before and after all four runs.
   Bounded child completion also succeeds; this is not a proof of every
   possible native resource or arbitrary-concurrency safety.
4. A separate intentional environment-poison probe proves the state assertion
   is live: all 115 cases pass, then the state hook fails for
   EXPRESSION_COHORT_POISON (116 reported nodes, 115 pass, one hook failure,
   exit 1). The poison exists only in that child process.
5. Remove cohort-state.probe.ts, cohort-repeat.probe.ts,
   cohort-reverse.probe.ts and cohort-poison.probe.ts with apply_patch, verify
   restored source bytes, then rerun the discovered expression inventory twice.

| Control sweep | Cases | Wall ms | Node duration ms |
| --- | ---: | ---: | ---: |
| full-expression-original | 589 | 21550.436 | 21498.151 |
| same-process-repeat-1 | 230 | 2694.546 | 2250.098 |
| reverse-order-1 | 115 | 1334.334 | 1278.547 |
| same-process-repeat-2 | 230 | 2318.379 | 2244.079 |
| reverse-order-2 | 115 | 1224.548 | 1173.725 |
| full-expression-final-1 | 589 | 15147.513 | 15107.915 |
| full-expression-final-2 | 589 | 14540.280 | 14501.184 |

Every positive control has zero failures, cancellations, skips, TODOs and stderr.
Complete-suite timings are incidental validation measurements, not a controlled
claim about the full expression suite's speedup. Its position in the live
worktree and worker-heavy cases can change host-load/warm-up effects.

Case-name fingerprints use SHA-256 of JSON.stringify(names), with duplicates
retained; sorted coverage comparisons use JavaScript's default string sort:

- Selected family, original and new ordered 115 names:
  `b91b6e63b230d0dbaa90728856e1e8c08b0188500999c1ce880b2412e8864867`.
- Same-process repeated 230-name array:
  `5d26e06af6cdaa877423fe5c86762b4ac9250ae4612aa9d803d6d63b39355021`.
- Reversed module-order 115-name array:
  `1db02d596a5e8bf3fc2efe0720d8987ac2e4f07e2cfa3c102df84650f3bdcf46`.
- Complete expression sorted 589-name array before and after:
  `e284178de5c7173d69b596042a17d7bd3b9c78c2c9a96ae45c454e06251dde66`.

The complete expression ordered hash changes because the consolidated entry
moves module blocks in discovery order. Its sorted name multiset is identical;
we do not claim that the full-suite order stayed unchanged.

## Reproduction and handoff

From `packages/safe-bash`, the serial renamed-old comparison command is:

```sh
node --import tsx --test --test-concurrency=1 --test-reporter=tap \
  tests/commands/expr/contracts.cases.ts \
  tests/commands/expr/grammar.cases.ts \
  tests/commands/expr/regex-limits.cases.ts \
  tests/commands/expr/regex-protocol.cases.ts
```

The new-layout command is:

```sh
node --import tsx --test --test-concurrency=1 --test-reporter=tap \
  tests/commands/expr/expression.test.ts
```

For full expression validation, use discoverTests with loadBoundaries from
scripts/integration-inputs.mjs, filter its returned literal paths to
`tests/commands/expr/`, and pass that list to the same Node command. Do not use a
blanket isolation override or launch the old .cases.ts entries together with
the family entry, which would duplicate registration across processes.

All temporary mutations and probe files are removed. No production or visual
CLI behavior changes; no screenshot or broad lint/build run is claimed.
Final verification confirms all twelve original direct source buffers are
preserved at their intended paths, helpers are unchanged, no probe files remain,
and the new entry contains only four static imports. The five delivered
TypeScript files have zero parser diagnostics (not a full typecheck). A final
clean family run passes all 115 unchanged names with exit 0 and no stderr:
966.254 ms wall, 926.470 ms Node duration.
The root owner retains commits, hooks, typechecking/build integration, push,
and release qualification. No Git or raw ESLint command was run. The frozen
`/tmp/poe-speed-integration-20260901` checkout was not modified.

## Preserved case names

These are the actual TAP names in static-import order, including duplicates.

### contracts.test.ts (27)

```text
factories register exactly expr with explicit replacement
evaluated BRE uses matching and rejects invalid patterns on empty subjects
UTF-8 argv uses bytes in C and scalars in C.UTF-8, never UTF-16 units
unsupported locales and unrepresentable argv are explicit errors
bounded aggregate argument bytes {"maxArgumentBytes":3}
bounded numeric digits {"maxNumericDigits":3}
bounded arithmetic result digits {"maxNumericDigits":3}
bounded arithmetic result digits {"maxNumericDigits":3}
bounded numeric result digits {"maxNumericDigits":1}
bounded AST node {"maxNodes":2}
bounded depth {"maxDepth":3}
bounded depth {"maxDepth":3}
bounded depth {"maxDepth":3}
bounded evaluation work {"maxSteps":3}
bounded string allocation {"maxStringBytes":3}
bounded output bytes {"maxOutputBytes":3}
bounded evaluation work {"maxSteps":1000}
factory limit validation and long input preflight
direct success and errors do not even access stdin
awaits sink backpressure and preserves complete byte output
byte pipe backpressure, C partial bytes, and exact abort reason
abort during pending output observes late rejection
work yields for timer cancellation without consuming stdin
sink failure preserves its reason without a diagnostic and diagnostic failure is not swallowed
actual Shell registry, piping and VFS redirection preserve byte output
Shell input ownership is compared to its baseline, not direct-command ownership
literal argv dispatch uses the actual Shell invoker and middleware
```

### grammar.test.ts (73)

```text
expr grammar ["2","+","3","*","4"]
expr grammar ["(","2","+","3",")","*","4"]
expr grammar ["20","-","5","-","3"]
expr grammar ["-7","/","3"]
expr grammar ["7","/","-3"]
expr grammar ["-7","%","3"]
expr grammar ["7","%","-3"]
expr grammar ["9007199254740993","+","2"]
expr grammar ["999999999999999999999999","*","999999999999999999999999"]
expr grammar ["0003","+","-02"]
expr grammar ["0003"]
expr grammar ["1","<","2","=","1"]
expr grammar ["02","==","2"]
expr grammar ["-0","=","000"]
expr grammar ["10","<","2"]
expr grammar ["10","<","2x"]
expr grammar ["a","!=","b"]
expr grammar ["x","|","y"]
expr grammar ["","|","02"]
expr grammar ["-00","|","000"]
expr grammar ["02","&","x"]
expr grammar ["x","&","-00"]
expr grammar ["-000"]
expr grammar ["+0"]
expr grammar ["-"]
expr grammar [""]
expr grammar ["1","|","2","&","0"]
expr grammar ["length","hello"]
expr grammar ["length","length","abcd"]
expr grammar ["length","abc","+","2"]
expr grammar ["substr","abcdef","2","3"]
expr grammar ["substr","abcdef","-1","3"]
expr grammar ["substr","abcdef","2","-3"]
expr grammar ["substr","abcdef","0","3"]
expr grammar ["substr","abcdef","no","3"]
expr grammar ["substr","abcdef","2","999999999999999999999999"]
expr grammar ["substr","abcdef","999999999999999999999999","2"]
expr grammar ["index","abcdef","fd"]
expr grammar ["index","abc","z"]
expr grammar ["index","abc",""]
expr grammar ["length","(","2","+","3",")"]
expr grammar ["+","length"]
expr grammar ["+",")"]
expr grammar ["+","+"]
expr grammar ["length","+","match"]
expr grammar ["*"]
expr grammar ["|"]
expr grammar ["--unknown"]
expr grammar ["-x"]
expr grammar ["--","--help"]
expr grammar ["1","|","1","/","0"]
expr grammar ["0","&","x","+","y"]
expr grammar ["1","|","match","x","["]
expr grammar ["0","&","x",":","["]
expr invalid []
expr invalid ["--"]
expr invalid ["+"]
expr invalid ["length"]
expr invalid ["("]
expr invalid [")"]
expr invalid ["(","1"]
expr invalid ["1","2"]
expr invalid ["1","+"]
expr invalid ["1","|","(","1","+"]
expr invalid ["1","|","match","x"]
expr invalid ["1","|","+"]
expr invalid ["1","&","2",")"]
expr invalid ["1","/","0"]
expr invalid ["1","%","0"]
expr invalid ["+5","+","1"]
expr invalid [" 5","*","1"]
expr invalid ["--help","x"]
help and version identify virtual-bash, not a fabricated GNU build
```

### regex-limits.test.ts (10)

```text
expr regex cap: input bytes
expr regex cap: nodes
expr regex cap: depth
expr regex cap: states
expr regex cap: allocation
expr regex cap: work
expr regex cap: output bytes
regex policy ceilings are validated at factory creation
regex capture output preserves partial C bytes and waits for backpressure
actual Shell expr plugin evaluates regex in pipelines and redirections
```

### regex-protocol.test.ts (5)

```text
expr replies validate exact shape, original byte bounds and scalar boundaries
expr request shape, limits and admission validation are bounded
worker returns distinct absent, unmatched, empty and failed capture states
the BRE compiler refuses main-thread execution
expr longest matching does not change legacy ordered alternatives in the same worker
```

## Final expanded decision — September 1, 2026

This section supersedes the pilot's conservative exclusions and four-file
membership, not its recorded evidence. **Keep all five reviewed additions**:
diagnostics-regression, encounter-order, inactive-prefix, output-quota and
regex-native. Nine unchanged case modules now feed expression.test.ts through
nine static imports. No wrapper, framework, hook, reset, or shared case context
is added to the delivered tests.

The final cohort has **369 named tests**. Its three top-level Worker-replacement
siblings remain standalone: abort-reason-regression.test.ts,
named-profile.test.ts and regex-lifecycle.test.ts. The nested
repeat-history/invariants.test.ts retains its separate process and module-owned
session. Authenticated expression discovery therefore selects **five entries**:
one family, three Worker-replacement files and one nested shared-session file.
All **589 full-expression case names/counts are preserved**.

This deliberately changes nine **per-file processes to one per-family process**.
Compared with the accepted pilot plus the five then-standalone candidates, six
processes become one for the same 369 cases. No concurrency flag or global
isolation setting changes; --test-isolation=none is never used. The scope,
production code, frozen checkout and Git remain untouched.

### Final cleanup assessment

| Added original file | Cases | Why normal cleanup is sufficient in the unchanged serial layout |
| --- | ---: | --- |
| diagnostics-regression.test.ts | 71 | The manual matchExpr replacement is enclosed in try/finally. Its complete descriptor and identity restore even when an assertion fails inside that try. Diagnostic data tables remain unchanged. |
| encounter-order.test.ts | 28 | Budget.encode/charge and RegexSession.matchExpr are TestContext-owned mocks. Captured original methods, counters and event arrays are created per test. Normal TestContext cleanup restores their descriptors before the next test and after the family. |
| inactive-prefix.test.ts | 68 | TestContext owns Budget/RegexSession mocks, including yield checkpoint cases. Signals, counters and captures are case-local. The module-level memory-FS proxy rejects every property access and is not mutable shared filesystem work. |
| output-quota.test.ts | 85 | TestContext restores Budget, executor/session and TextEncoder.prototype.encode mocks. Held output/retirement gates resolve in finally; invocation settlement and late rejection observation complete without dangling resources. No explicit mock-reset addition is needed. |
| regex-native.test.ts | 2 | Both vector factories allocate fresh tables, rows and argv arrays on each call; there is no mutable shared factory state or native-process launcher. Each run retains its own command/session lifecycle. An audit label is not an exclusion reason. |

The regex-native entry still executes six unsupported-BRE vectors and all
231 nullable vectors (21 patterns by 11 subjects). It retains all exact
semantic diagnostics and the assertion that eleven nullable-backreference
cases are unsupported, not native passes. The other 220 nullable executions
are not promoted to independent semantic-oracle assertions or counted as
231 additional passing node:test cases. These remain **two named tests**,
byte-identical to their originals, with their original assertion strength.

A current bounded scan of 593 active test/script/configuration paths finds no
literal old .test.ts or .test.js references for the five additions. The original
authenticated boundary audit has no expr-directory seal requiring a change.
This is not exhaustive dynamic-consumer or historical-selector clearance;
no sealed or historical bytes are rewritten.

### Final exact path inventory

The following paths are relative to
`packages/safe-bash/tests/commands/expr/`. Hashes apply to both old and new
bytes. The original assertions, helpers, names, per-test state, timeouts,
imports and source line numbers are preserved.

| Original path | Final path | Cases | Original and final SHA-256 |
| --- | --- | ---: | --- |
| `contracts.test.ts` | `contracts.cases.ts` | 27 | `ce900757c3d61c85e76960260f54e90fa4ae1edb0d71b070b8bf639b9a2326b7` |
| `diagnostics-regression.test.ts` | `diagnostics-regression.cases.ts` | 71 | `f01f5f88b4d2bd4c43f7359f548ce64002fcf2c0bf24b7fc7300a8cb8d9795e4` |
| `encounter-order.test.ts` | `encounter-order.cases.ts` | 28 | `717833e284ba7de577a063b52b53a85ae5b0f19af38f5dce7a93fb761da9cb66` |
| `grammar.test.ts` | `grammar.cases.ts` | 73 | `0de1d7042f5f0a1a7ad75a540096bdb07cdf28a2137b6927b2e8177091d64919` |
| `inactive-prefix.test.ts` | `inactive-prefix.cases.ts` | 68 | `52e079b8bc89f1b8e4f2b256baab11f8388a5f54d23c174d64d8a4de9c194c3e` |
| `output-quota.test.ts` | `output-quota.cases.ts` | 85 | `c6b6b96789ecbfe9aeee81b7d0b5bd4eea1cd4d059f81ec5cf839bd23eed0796` |
| `regex-limits.test.ts` | `regex-limits.cases.ts` | 10 | `4b938f201b7ffffcb317734f7784d7b88cf5a95aacbad53a5e4df957d3f9c2a8` |
| `regex-native.test.ts` | `regex-native.cases.ts` | 2 | `c00304ce749f1099a148ef67cc25c0b5b8b6910300a6def5631eac1d7e6c852f` |
| `regex-protocol.test.ts` | `regex-protocol.cases.ts` | 5 | `465fb777d2d35df56c736d4accfbb502f63b690ec9f3b98a4a32d45410f34bc5` |

`packages/safe-bash/tests/commands/expr/expression.test.ts` contains only nine
static imports in the table's order. No additional permanent source file is
created. `docs/plans/expression-test-cohort.md` remains the only other edited
path outside this expression directory. The three Worker-replacement files and
helpers.ts match their original source buffers.

### Per-test and after-family state controls

Temporary validation-only imports snapshot full own property descriptors of
Budget.prototype, RegexExecutor.prototype, RegexSession.prototype and
TextEncoder.prototype, plus the builtin Worker identity, environment, cwd,
MessagePort/Timeout resources and diagnostic/native vector values.

A beforeEach check runs after the preceding test's normal TestContext cleanup;
after-family checks cover the last case. This measures every inter-test boundary
without forcing mock.restoreAll/reset or waiting inside an afterEach hook that
would precede normal mock teardown. Each boundary is checked synchronously and
again after one setImmediate turn. Both observations agree: all descriptors,
environment and vectors restore, and all measured resource lists are empty.
No probe repairs candidate state.

- Two pre-rename repeat runs each register and pass 738 names: the exact full
  369-name family twice, using distinct query-qualified static module imports.
  Production/helper imports remain shared within that process.
- Two pre-rename reverse runs each pass 369 names in reverse module-block
  order, retaining internal case order.
- After the five byte-identical renames, repeat and reverse controls run again:
  738 and 369 passes, with identical corresponding name arrays and clean
  per-test/after-family state. Every beforeEach checked name matches the
  decoded TAP name, not just the count.
- Five candidate-specific assertion failures leave all 369 boundary checks
  clean and execute the rest of the family: exactly 368 passes, one intended
  failure, no cancellation/skips/TODOs, exit 1. The diagnostics failure occurs
  while its manual replacement is active; encounter/inactive failures occur
  with TestContext mocks active; the output failure exercises both TextEncoder
  and RegexSession mocks. The regex-native control changes only its expected
  eleven-case count. Each source is restored byte-for-byte afterward.
- Deliberately leaking an added TextEncoder descriptor and, separately, a
  referenced 500ms timer causes both the next-test boundary and after-family
  checks to fail: three reported nodes, one pass, two expected failures,
  exit 1. The timer expires naturally; neither control changes the parent.

Successful negative-attribution locations before the final rename:

| Source | Intended failing case | Assertion location |
| --- | --- | --- |
| diagnostics-regression.test.ts | skipped grammar errors submit no BRE requests or acquire stdin | diagnostics-regression.test.ts:50:12 |
| encounter-order.test.ts | encounter-order v2 sequential jobs cross logical and arithmetic boundaries once | encounter-order.test.ts:80:10 |
| inactive-prefix.test.ts | frozen sequencing control: inactive length does not evaluate locale or encode operand | inactive-prefix.test.ts:43:10, called from :51:3 |
| output-quota.test.ts | oversized host diagnostic is not encoded before quota admission | output-quota.test.ts:79:3 |
| regex-native.test.ts | nullable author audit preserves all controls and explicitly classifies the known gap | regex-native.test.ts:29:10 |

A probe implementation error is retained here rather than erased from the
record: the first encounter negative-control restoration used a repeated
assertion as an ambiguous patch anchor. It restored the wrong occurrence,
causing seven unintended encounter failures plus the intended inactive failure
in the next run (361 pass, eight fail). Boundary-state checks still passed.
Those two accidental assertion edits were identified against the original
buffers and repaired with unique surrounding context. Subsequent mutation
restorations used contextual hunks and immediate byte checks; the inactive,
output and native controls then each failed only their intended case, followed
by a fully green 369-case boundary run. That contaminated probe is not accepted
candidate, cleanup, timing or failure-attribution evidence.

Initial metadata extraction also needed to respect TAP's backslash escaping
and variable hook-error formatting. Boundary name arrays were subsequently
base64-encoded for lossless comparison; the test-result counts themselves were
not changed or counted as failures because of those reporting checks.

| Positive control | Cases | Wall ms | Node duration ms |
| --- | ---: | ---: | ---: |
| expansion-pre-move-forward-boundaries | 369 | 9311.890 | 9269.504 |
| expansion-pre-move-repeat-1 | 738 | 15106.547 | 15068.982 |
| expansion-pre-move-reverse-1 | 369 | 8237.804 | 8193.853 |
| expansion-pre-move-repeat-2 | 738 | 13472.396 | 13430.202 |
| expansion-pre-move-reverse-2 | 369 | 7792.144 | 7752.295 |
| expansion-pre-move-clean-boundaries | 369 | 6092.793 | 6057.223 |
| expansion-renamed-repeat | 738 | 16194.263 | 16149.329 |
| expansion-renamed-reverse | 369 | 7863.017 | 7818.359 |
| expanded-full-final-1 | 589 | 21364.031 | 21283.258 |
| expanded-full-final-2 | 589 | 24561.246 | 24493.038 |

All positive rows have exit 0, all cases passing, zero failures, cancellations,
skips, TODOs and stderr. Full-suite/control wall times are incidental, not
counterbalanced claims of whole-suite speedup. The resource census covers
referenced MessagePort/Timeout entries, not every possible host resource or
arbitrary concurrent test execution.

### Pilot versus final measurements

Do not compare the original **115-case pilot** (2.084s to 1.013s) directly with
the final **369-case family**: the denominator and worker-heavy corpus differ.
The original pilot measurements above remain unchanged.

The final benchmark measures three layouts with the **same 369 case bytes and
renamed .cases.ts paths**, six samples per layout. Every run retains
--test-concurrency=1 and default Node per-entry process isolation:

| Layout | Processes | Cases | Median wall seconds |
| --- | ---: | ---: | ---: |
| Original isolation: all nine .cases.ts files as explicit Node entries | 9 | 369 | 11.187 |
| Accepted-pilot layout: four-module static entry plus five separate .cases.ts entries | 6 | 369 | 10.215 |
| Final nine-module expression.test.ts entry | 1 | 369 | 8.408 |

The final cohort saves **2.779s / 24.84%** against nine isolated
entries and **1.807s / 17.69%** beyond the accepted pilot layout.
These are local cohort medians, not whole-workspace/build/release speed claims.

Counterbalanced serial order is old, pilot, final, final, pilot, old, repeated
three times. The pilot-layout shim contains only the original four static
imports and was removed afterward. No state/negative probe is imported by any
timing layout. All eighteen samples pass the same 369-name multiset with zero
failures/skips/cancellations/TODOs and empty stderr. Old and final ordered names
also agree; the pilot layout groups the same names differently.

| Final sweep | Wall ms | Node duration ms |
| --- | ---: | ---: |
| final-balanced-1-old | 10101.637 | 10060.147 |
| final-balanced-2-pilot | 9095.637 | 9053.584 |
| final-balanced-3-final | 8366.990 | 8324.003 |
| final-balanced-4-final | 8449.834 | 8399.439 |
| final-balanced-5-pilot | 12092.897 | 12036.883 |
| final-balanced-6-old | 11550.975 | 11496.679 |
| final-balanced-7-old | 9120.602 | 9050.942 |
| final-balanced-8-pilot | 7766.142 | 7726.384 |
| final-balanced-9-final | 6878.855 | 6833.780 |
| final-balanced-10-final | 7090.177 | 7046.960 |
| final-balanced-11-pilot | 9350.424 | 9311.442 |
| final-balanced-12-old | 10908.113 | 10865.699 |
| final-balanced-13-old | 11465.834 | 11425.765 |
| final-balanced-14-pilot | 11628.224 | 11578.650 |
| final-balanced-15-final | 8839.033 | 8790.669 |
| final-balanced-16-final | 9221.382 | 9178.239 |
| final-balanced-17-pilot | 11079.924 | 11032.765 |
| final-balanced-18-old | 13914.778 | 13854.431 |

These final measurements run on September 1, 2026, Darwin arm64 25.4.0,
Node v22.22.2 and package-local tsx 4.23.12 in the same live worktree.
No cache clearing or cohost-load control is imposed. The sample spread is
retained, including late slower runs; none is discarded.

Name hashes use SHA-256 over JSON.stringify of the TAP-name array, including
TAP escaping and duplicate names, except where explicitly marked decoded:

- Final ordered 369 names and nine-isolated ordered names:
  `e3a90a7dbe197157a504f27ddfb3c540c31649e47880969c27ee8e6f0b9ec1d0`.
- Repeat 738 names:
  `783f8665b066ca130917e1ab5ad6461c2cabde29696abac0b7863132f66e09f5`.
- Reverse-block 369 names:
  `1f992c4cbeb51ec713169ff69f4101315405454a6c9c6e150925a3849b160956`.
- Decoded beforeEach names for the forward 369-case family:
  `03439a302831b3f3d8eacc3293d3584502fa92a65cf7f5afa568a619486bd0ef`.
- Complete sorted 589-name multiset, unchanged from the original full baseline:
  `e284178de5c7173d69b596042a17d7bd3b9c78c2c9a96ae45c454e06251dde66`.

### Final cleanup and handoff

All seven expansion probe files are deleted with apply_patch:
expansion-state.probe.ts, expansion-forward.probe.ts,
expansion-repeat.probe.ts, expansion-reverse.probe.ts,
expansion-descriptor-leak.probe.ts, expansion-resource-leak.probe.ts and
expansion-pilot-layout.probe.ts. Final directory inspection finds no .probe.
files. Original pilot probes also remain absent.

After removal, authenticated discovery returns only expression.test.ts, the
three original Worker-replacement entries and repeat-history/invariants.test.ts.
Two final complete expression runs each pass **589/589**, preserving the exact
original sorted names (including duplicates), with no skips or cancellations.
The nine case modules and all three unchanged direct entries match their
original source bytes. No production, helper, external vector, frozen checkout,
Git, raw ESLint or concurrency changes were made. Root owns staging/commit,
hooks, broader integration/typecheck/build, push and release decisions.

To repeat final timing from packages/safe-bash, pass all nine .cases.ts paths
in the final inventory as explicit arguments to the existing serial Node test
command for old isolation, or only tests/commands/expr/expression.test.ts for
the new layout. Never pass both at once. For full expression coverage, filter
the authenticated discoverTests/loadBoundaries result to tests/commands/expr/.

### Additional preserved case names

Together with the 115 pilot names above, these are all 369 final case names.
Final module order is the nine-row inventory order, not pilot-then-additions.

### diagnostics-regression.test.ts (71)

```text
C diagnostic original: ambiguous-index-keyword
C diagnostic original: missing-operands
C diagnostic original: missing-rhs
C diagnostic original: missing-close
C diagnostic original: trailing-token
C diagnostic original: skip-still-requires-rhs
C diagnostic original: skip-still-requires-close
C diagnostic original: skip-still-requires-keyword-args
C diagnostic extension: class-parenthesis-not-capture
C diagnostic control: empty-after-end-options
C diagnostic control: forced-token-missing
C diagnostic control: length-missing
C diagnostic control: index-missing
C diagnostic control: match-missing
C diagnostic control: substr-missing
C diagnostic control: open-only
C diagnostic control: unexpected-close
C diagnostic control: empty-group
C diagnostic control: wrong-close
C diagnostic control: nested-missing-close
C diagnostic control: trailing-close
C diagnostic control: rhs-close
C diagnostic control: help-is-not-an-option-with-operands
C diagnostic control: version-is-not-an-option-with-operands
C diagnostic control: skip-or-forced-token
C diagnostic control: skip-and-prefix
C diagnostic control: skip-or-wrong-close
C diagnostic control: skip-and-trailing
C diagnostic control: skip-invalid-regex-then-trailing
C diagnostic control: quoted-apostrophe
C diagnostic control: quoted-backslash
C diagnostic control: quoted-newline
C diagnostic control: quoted-tab
C diagnostic control: quoted-control-bytes
C diagnostic control: quoted-utf8-bytes
C diagnostic control: quoted-double-quote
C diagnostic control: quoted-empty
C diagnostic control: missing-after-empty
C diagnostic control: missing-after-newline
C diagnostic control: close-after-apostrophe
C diagnostic control: close-instead-of-backslash
C diagnostic control: missing-operator-rhs-|
C diagnostic control: missing-operator-rhs-&
C diagnostic control: missing-operator-rhs-<
C diagnostic control: missing-operator-rhs-<=
C diagnostic control: missing-operator-rhs-=
C diagnostic control: missing-operator-rhs-==
C diagnostic control: missing-operator-rhs-!=
C diagnostic control: missing-operator-rhs->=
C diagnostic control: missing-operator-rhs->
C diagnostic control: missing-operator-rhs--
C diagnostic control: missing-operator-rhs-*
C diagnostic control: missing-operator-rhs-/
C diagnostic control: missing-operator-rhs-%
C diagnostic control: missing-operator-rhs-:
diagnostic grammar control: forced-index
diagnostic grammar control: forced-close
diagnostic grammar control: help-after-end-options
diagnostic grammar control: version-after-end-options
diagnostic grammar control: skip-division
diagnostic grammar control: skip-noninteger
diagnostic grammar control: skip-regex
diagnostic grammar control: skip-regex-and
diagnostic grammar control: nested-closed
diagnostic grammar control: quoted-correction1
empty invocation guidance uses the registered virtual name and help remains virtual
skipped grammar errors submit no BRE requests or acquire stdin
diagnostic expansion stays within string, work, and output budgets
argument, numeric, node and depth refusals retain precedence and status
diagnostic writes preserve backpressure and exact sink exception identity
aborted diagnostics preserve the caller reason, including pending sink rejection
```

### encounter-order.test.ts (28)

```text
encounter-order v2 ["7","/","0","late"]
encounter-order v2 ["7","%","0","+"]
encounter-order v2 ["bad","*","2","+","length"]
encounter-order v2 ["(","7","/","0"]
encounter-order v2 ["length","(","7","/","0",")","late"]
encounter-order v2 ["substr","abc","(","7","/","0",")"]
encounter-order v2 ["7","/","(","0","late",")"]
encounter-order v2 ["7","/","0",":"]
encounter-order v2 ["bad","+","length"]
encounter-order v2 ["bad","+","7","/","0"]
encounter-order v2 ["a",":","[","late"]
encounter-order v2 ["(","a",":","["]
encounter-order v2 ["index","match","a","["]
encounter-order v2 ["a",":","a","late"]
encounter-order v2 ["(","a",":","a"]
encounter-order v2 ["match","(","a",":","a",")","("]
encounter-order v2 ["a",":","(","[","late",")"]
encounter-order v2 inactive values absent ["HIDDEN","+","999"]
encounter-order v2 inactive values absent ["HIDDEN",":","["]
encounter-order v2 inactive values absent ["length","HIDDEN"]
encounter-order v2 inactive values absent ["index","HIDDEN","Z"]
encounter-order v2 inactive values absent ["substr","HIDDEN","999","888"]
encounter-order v2 inactive values absent ["match","HIDDEN","["]
encounter-order v2 sequential jobs cross logical and arithmetic boundaries once
encounter-order v2 global argv admission precedes active evaluation
encounter-order v2 skipped structural nodes remain bounded without encoding
encounter-order v2 forced tokens and left associativity retain grammar
encounter-order v2 actual Shell invocation retains earlier error and completed job
```

### inactive-prefix.test.ts (68)

```text
frozen sequencing control: inactive length does not evaluate locale or encode operand
frozen sequencing control: inactive substr does not convert numbers or encode operands
inactive length under OR performs no reduction
inactive length under AND performs no reduction
inactive length under OR containing AND/OR performs no reduction
inactive length under AND containing OR/AND performs no reduction
inactive index under OR performs no reduction
inactive index under AND performs no reduction
inactive index under OR containing AND/OR performs no reduction
inactive index under AND containing OR/AND performs no reduction
inactive substr under OR performs no reduction
inactive substr under AND performs no reduction
inactive substr under OR containing AND/OR performs no reduction
inactive substr under AND containing OR/AND performs no reduction
inactive match under OR performs no reduction
inactive match under AND performs no reduction
inactive match under OR containing AND/OR performs no reduction
inactive match under AND containing OR/AND performs no reduction
inactive nested length never evaluates arguments
inactive nested index never evaluates arguments
inactive nested substr never evaluates arguments
inactive nested match never evaluates arguments
literal quoting retains grammar ["1","|","+","length"]
literal quoting retains grammar ["0","&","+",")"]
literal quoting retains grammar ["+","length"]
inactive malformed grammar ["1","|","length"]
inactive malformed grammar ["0","&","index","abc"]
inactive malformed grammar ["1","|","substr","abc","1"]
inactive malformed grammar ["0","&","match","abc"]
inactive malformed grammar ["1","|","+"]
inactive malformed grammar ["1","|","length","(","1","/","0"]
inactive malformed grammar ["0","&","(","1","|","index","abc",")"]
inactive malformed grammar ["1","|","match","abc","[","x"]
inactive malformed grammar ["1","|","substr","match","abc","[","1"]
active length unchanged in C
active index unchanged in C
active substr unchanged in C
active length unchanged in C.UTF-8
active index unchanged in C.UTF-8
active substr unchanged in C.UTF-8
active length still rejects unsupported character locale
active index still rejects unsupported character locale
active substr still rejects unsupported character locale
active match still rejects unsupported character locale
active and skipped calls execute once ["match","abc","a.*"]
active and skipped calls execute once ["0","|","length","abc"]
active and skipped calls execute once ["1","&","substr","abc","2","1"]
active and skipped calls execute once ["match","a","a","|","match","hidden","["]
active and skipped calls execute once ["(","match","a","b","|","length","",")","|","match","b","b"]
active and skipped calls execute once ["(","match","a","a","+","match","b","b",")","|","substr","hidden","999","1"]
retained aggregate argument bytes limit {"maxArgumentBytes":5}
retained argument count limit {"maxNodes":1}
retained AST node limit {"maxNodes":3}
retained parser depth limit {"maxDepth":2}
retained AST depth limit {"maxDepth":3}
retained evaluation work limit {"maxSteps":1}
retained numeric digits limit {"maxNumericDigits":1}
retained numeric result digits limit {"maxNumericDigits":1}
retained string allocation limit {"maxStringBytes":2}
retained output bytes limit {"maxOutputBytes":1}
inactive call retains its evaluator work checkpoint
inactive call checkpoint preserves abort identity: undefined
inactive call checkpoint preserves abort identity: null
inactive call checkpoint preserves abort identity: false
inactive call checkpoint preserves abort identity: 0
inactive call checkpoint preserves abort identity: 
inactive call checkpoint preserves abort identity: Error: cancelled
actual Shell/registry preserves nested inactive calls and literal invoke dispatch
```

### output-quota.test.ts (85)

```text
normal diagnostic admission: syntax, cap 1
normal diagnostic admission: syntax, cap 43
normal diagnostic admission: syntax, cap 44
normal diagnostic admission: division, cap 1
normal diagnostic admission: division, cap 22
normal diagnostic admission: division, cap 23
normal diagnostic admission: modulo, cap 1
normal diagnostic admission: modulo, cap 22
normal diagnostic admission: modulo, cap 23
normal diagnostic admission: noninteger, cap 1
normal diagnostic admission: noninteger, cap 26
normal diagnostic admission: noninteger, cap 27
normal diagnostic admission: NUL, cap 1
normal diagnostic admission: NUL, cap 34
normal diagnostic admission: NUL, cap 35
normal diagnostic admission: Unicode, cap 1
normal diagnostic admission: Unicode, cap 43
normal diagnostic admission: Unicode, cap 44
normal diagnostic admission: argument resource, cap 1
normal diagnostic admission: argument resource, cap 45
normal diagnostic admission: argument resource, cap 46
normal diagnostic admission: work resource, cap 1
normal diagnostic admission: work resource, cap 36
normal diagnostic admission: work resource, cap 37
normal diagnostic admission: string resource, cap 1
normal diagnostic admission: string resource, cap 38
normal diagnostic admission: string resource, cap 39
normal diagnostic admission: worker syntax, cap 1
normal diagnostic admission: worker syntax, cap 32
normal diagnostic admission: worker syntax, cap 33
normal diagnostic admission: worker resource, cap 1
normal diagnostic admission: worker resource, cap 37
normal diagnostic admission: worker resource, cap 38
stdout remains bounded at cap 1
stdout remains bounded at cap 2
unknown internal error admission at cap 1
unknown internal error admission at cap 33
unknown internal error admission at cap 34
worker transport diagnostic uses UTF-8 bytes at cap 1
worker transport diagnostic uses UTF-8 bytes at cap 30
worker transport diagnostic uses UTF-8 bytes at cap 31
oversized host diagnostic is not encoded before quota admission
emergency is fixed, not user-controlled: "ATTACKER_MARKER"
emergency is fixed, not user-controlled: "'\\\\\\n\\t"
emergency is fixed, not user-controlled: "💣"
emergency is fixed, not user-controlled: "xxxxxxxxxxxxxxxx"
stdout rejection 0 keeps identity without fallback
stdout rejection 1 keeps identity without fallback
stdout rejection 2 keeps identity without fallback
stdout rejection 3 keeps identity without fallback
stdout rejection 4 keeps identity without fallback
stdout rejection 5 keeps identity without fallback
stdout rejection 6 keeps identity without fallback
normal-stderr rejection 0 keeps identity without fallback
normal-stderr rejection 1 keeps identity without fallback
normal-stderr rejection 2 keeps identity without fallback
normal-stderr rejection 3 keeps identity without fallback
normal-stderr rejection 4 keeps identity without fallback
normal-stderr rejection 5 keeps identity without fallback
normal-stderr rejection 6 keeps identity without fallback
emergency-stderr rejection 0 keeps identity without fallback
emergency-stderr rejection 1 keeps identity without fallback
emergency-stderr rejection 2 keeps identity without fallback
emergency-stderr rejection 3 keeps identity without fallback
emergency-stderr rejection 4 keeps identity without fallback
emergency-stderr rejection 5 keeps identity without fallback
emergency-stderr rejection 6 keeps identity without fallback
stdout awaits sink and overlapping registered cleanup
normal-stderr awaits sink and overlapping registered cleanup
emergency-stderr awaits sink and overlapping registered cleanup
stdout caller abort null keeps exact reason
normal-stderr caller abort null keeps exact reason
emergency-stderr caller abort null keeps exact reason
stdout caller abort false keeps exact reason
normal-stderr caller abort false keeps exact reason
emergency-stderr caller abort false keeps exact reason
stdout caller abort 0 keeps exact reason
normal-stderr caller abort 0 keeps exact reason
emergency-stderr caller abort 0 keeps exact reason
stdout caller abort  keeps exact reason
normal-stderr caller abort  keeps exact reason
emergency-stderr caller abort  keeps exact reason
stdout caller abort Error: caller keeps exact reason
normal-stderr caller abort Error: caller keeps exact reason
emergency-stderr caller abort Error: caller keeps exact reason
```

### regex-native.test.ts (2)

```text
documented unsupported native workflows are errors, not native passes
nullable author audit preserves all controls and explicitly classifies the known gap
```
