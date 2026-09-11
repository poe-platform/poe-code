# Filesystem type-contract timing

Full isolated package run 94735 failed the Bundler + DOM case in
`src/modules/fs.type-contract.test.ts` at the existing 5,000 ms test limit.
Focused repeat 96947 passed all four cases in 3.08 seconds of test execution.
All contract assertions, compiler settings and timeouts remain unchanged.

A read-only compiler-phase probe (7134) transpiled and evaluated the existing
test in memory, preserving its assertions and compiler options. All assertions
passed. NodeNext + DOM took 6,640.78 ms wall time (3,312.84 ms process CPU),
including 4,709.81 ms in TypeScript's Check phase. The other cases took
3,358.60, 2,272.71 and 1,423.69 ms wall time. Instrumentation and scheduling
affect these measurements; they are not a controlled optimization benchmark.

Each case builds a fresh TypeScript program and requests all pre-emit
diagnostics with `skipLibCheck: false`, including Node and optional DOM library
declarations. All 25 valid/invalid option examples are already batched into one
consumer per compiler mode; there is no per-example program-creation loop to
remove. Semantic checking, not merely file reads, dominates the slow case.

Do not disable library checks, mock compiler results, drop NodeNext/Bundler or
Node-only/DOM variants, reduce the structural cases, or merely raise a timeout.
Evaluate whether these compiler-contract checks belong in an uncached maintained
type-check task rather than a wall-clock-sensitive unit case. Any routing change
must preserve every assertion and native npm lifecycle membership, run the
checks during normal verification, and report their results separately rather
than counting omitted unit cases as passes. No routing or implementation change
has been made yet; the full-suite failure remains unresolved.

## Maintained compiler-check route

The matrix now lives in `scripts/fs-type-contract.mjs`, invoked by the package
`typecheck:fs` command. Both `pretest` and `pretest:unit` run it after Intl data
generation. The four compiler modes still each evaluate all 25 cases with
`strict: true`, `skipLibCheck: false` and all pre-emit diagnostics. Every program
is fresh; no diagnostics are cached. This is a compiler-contract task, not a QA
script or a replacement for runtime unit tests.

The old unit file is removed only after an AST comparison confirms identical
case data, contract source, consumer preamble and compiler options.
Direct execution passed all four modes (57615). A memory-only mutation changing
FsModuleOptions to `any` was rejected for conflicting implementations (36788).
The first mutation probe overconstrained Node's formatted assertion message and
was corrected to check the error code and message prefix; the contract itself
was rejected in both attempts.

A normal `npm test` lifecycle smoke run executed all four compiler modes before
Vitest started (27383). That smoke run intentionally selected no unit cases and
was interrupted after hook execution was verified; it is not a passing unit
gate. `npm run pretest:unit --workspace=@poe-code/safe-js` separately verifies
the unit hook and passed all four modes (63681). Scoped ESLint passed for
the compiler script (69929). Compiler results must be reported separately from the four
removed unit-case counts. Full package validation is still required.

Full package verification now runs in the isolated prototype-origin candidate
based on `6bebedcf4`, including the compiler-route move but excluding pending
weak-reference integration. Staged tree: `ed51e45a175a84c6ae96d137ee1768e183bce682`.
All 1,331 tracked source/test/script/manifest blobs match before execution.
The maintained `npm test --workspace=@poe-code/safe-js` run is session 53012;
report its compiler prehook and unit results separately after terminal completion.

Session 53012 terminated with exit 1: all four compiler modes passed their
25 contracts, while runtime Vitest reported 25,092 passed, six failed and
37 skipped (993 files; 1,168.73 seconds). All six failures hit the unchanged
5,000 ms guard: PPR2 `co`, namespace identity object/object and object/map,
one inverse-coordinate camera batch, and two foreign RegExp/newTarget cases.
This does not establish an environmental cause or validate the whole candidate.
All 1,331 candidate blobs still matched the staged index after completion
(df68de); the removed compiler unit file was absent. Focused reproduction of
the four failing files now runs unchanged in session 9193. Do not restart the
terminal full-suite session or count its runtime result as passing.

Focused session 9193 passed all 183 tests in those four files, with unchanged
source and 5,000 ms guards (31.76 seconds elapsed, 56.06 seconds summed test
time). The full-suite failures therefore did not reproduce in this focused
run. That is evidence of timing sensitivity, not proof of an environmental
cause, a resolved performance issue, or a passing full-package gate.

## Independent route qualification

The route-only candidate is based on `99711dbea`, excluding the pending
prototype-origin and weak-reference work. No runtime implementation files
change. AST normalization against HEAD again confirms identical alias names,
contract source, structural cases, consumer preamble and compiler options
(7003d4). Both maintained pretest hooks independently passed all four modes
and 25 cases per mode (69115). The current in-memory negative control changed
only FsModuleOptions to any and was rejected at conflicting implementations
(77099); no files were written by that probe.

Focused filesystem verification passed 909 tests, with 33 explicit recorded
reference-gap skips across six files (70712). These skips are not new and are
not counted as passes; the suite checks their declared reasons against its
recordings. All 1,331 source/test/script/manifest blobs matched the private
index, and the old compiler unit file was absent (95e069). The already-built
runtime is unchanged by this script/configuration move. Isolated script lint
is running as 88980. This scope-specific qualification does not resolve the
six runtime timeouts in the prior broader gate, which remain separate open
work rather than being relabelled as passes.

Isolated script lint 88980 finished successfully. The route-only change is
qualified for its atomic local commit. The old four-case Vitest compiler file
is replaced by the maintained uncached script, preserving all 100 structural
checks in the native npm pretest routes. No runtime test or compiler diagnostic
is removed from verification, and the old file remains recoverable in Git
history. No green full-worktree gate, remote delivery or release is claimed.
