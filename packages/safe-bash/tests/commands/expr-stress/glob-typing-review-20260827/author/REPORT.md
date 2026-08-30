# Glob fixture typing review — author evidence

## Candidate and ownership

- Source commit: `ec59c917ba137126a064960995b5fc6945ea8f6d`.
- Sole source change: `tests/commands/regex-execution/continuation/glob.test.ts`, **+4 / -2 lines**, net +2.
- Changed locations: type-only import at line 5 and fixture-local executor annotation at lines 49–51. Original executable lines 54–55 are unchanged at lines 56–57.
- Source SHA-256 before: `3e128ac96388c1a6389dc62e2ed6c0c931fe750ab71ea2028c474793316b47dd`.
- Source SHA-256 after: `65a63ccce8a60e33024a6accbce10757475954a2797c26a3f65522588efaf39f`.
- No production, root, shared configuration, parser, repeat-policy, output, DU artifact, native fixture or existing evidence changes. The only additional tracked files are in this new author directory.
- Candidate receipt published immediately after the test-only commit: `/tmp/expr-glob-typing-author-20260827-candidate.txt`.

## Causal distinction and fix

Read-only inspection of `src/commands/regex-execution/protocol.ts` and `client.ts`, including additive commit `fe7083d99b8ccfdfbbb9b7209e0a6abbe7979724`, identifies the fixture typing cause:

1. Legacy `Descriptor` is the discriminated `GrepDescriptor | SearchDescriptor | GlobDescriptor` union. These descriptors have readonly `patterns`; glob also has readonly `globOptions`. They are not uniformly JavaScript RegExp objects and do not expose a common `flags` or `source` field.
2. Separate `ExprMatchDescriptor` has `kind: "expr-match"`, byte `pattern`, `profile` and `limits`. Its result is `ExprMatchResult`, not `Match[][]`.
3. Adding the expr overload to `RegexExecutor.request` contextually widens the existing assigned arrow's descriptor to `Descriptor | ExprMatchDescriptor`. Unconditional `.patterns` produces TS2339; `inputBytes`, which intentionally accepts legacy descriptors, produces TS2345; passing the unnarrowed union to the overloaded bound request produces TS2769. The third original diagnostic is on line 55, not line 54.
4. The batching fixture only sends legacy glob requests. A checked structural annotation, `Omit<RegexExecutor, "request">` plus the legacy request signature, limits this fixture's instrumentation surface without casts or suppression. The actual constructor remains checked against that view, and the unchanged callback handles every legacy descriptor's `patterns` correctly.

This is not an implementation/protocol regression requiring production changes. Normal typed calls to both original overloads still check, and runtime expr and legacy requests interoperate in the canonical protocol suite. The local view is deliberately **not** a general interceptor for expr requests: this fixture does not call `matchExpr`. A future mixed-operation interceptor would need distinct dispatch and result handling; the annotation does not promise that capability. No production API changes are proposed.

## Frozen pre-fix proof

`baseline/frozen.json` was written at **2026-08-27T20:30:43.005Z**, before the fixture patch. The original fixture, protocol, client, root compiler configuration, exact supplied `FOREIGN-TYPECHECK.txt`, compiler input inventory and hashes are retained as data. The focused CLI diagnostics byte-match the supplied glob diagnostic block: TS2339, TS2345 and TS2769, exit 2. All ten unrelated DU diagnostics remain verbatim in the copied supplied output and were not acted on.

Original runtime: **4/4 pass**. This demonstrates a pre-existing typing failure, not an observed runtime failure. After the fix, an in-memory overlay of the frozen original source reproduces the same three diagnostics against unchanged imported compiler inputs. No source file is rolled back for that control.

## Executable equivalence

Actual TypeScript **5.9.3** `Program.emit`, with the repository compiler options and no source maps, emits **byte-identical 4,812-byte JavaScript** before and after:

`b995643979e9447809a8c216768e021e00700c854b3477469a3cfaa57f32e146`

Both outputs are retained as `baseline/fixture.emitted.js.txt` and `candidate/fixture.emitted.js.txt`; `candidate/equivalence.json` records the comparison. Baseline emission is deliberately allowed despite the three recorded type errors. This proves this emitter's executable output equivalence, not source-map equivalence or every transpiler's byte layout. All original executable assertions, descriptors, ordering and negative cases remain unchanged.

## Scoped checks and controls

Environment: Node **v22.22.2**, TypeScript **5.9.3**, Darwin/arm64; exact environment, commands, arguments, start/end times, stdout, stderr, exit codes and child process-group checks are captured per execution.

| Check | Result |
| --- | --- |
| Original strict focused `tsc`, only fixture root | Exit 2, exact three supplied glob diagnostics |
| Candidate strict focused `tsc`, only fixture root | Exit 0 |
| Existing continuation `tsconfig.json` scoped `tsc` | Exit 0 |
| Canonical glob fixture | 4/4 pass within 15-test run |
| Canonical glob transport fixture | 6/6 pass within 15-test run |
| Canonical expr protocol fixture | 5/5 pass within 15-test run |
| Positive typing: regex and expr overload returns, proper `kind` discrimination | No diagnostics |
| Negative typing: remove the fixture annotation via frozen original overlay | TS2339, TS2345, TS2769 |
| Negative typing: feed expr into legacy `inputBytes` | TS2345 |
| Negative typing: access expr `.patterns` | TS2551 |
| Negative typing: assume legacy `.flags` | TS2339 |
| Negative typing: assume legacy `.source` | TS2339 |
| Negative typing: treat expr result as `Match[][]` | TS2322 |
| Negative typing: call overloaded request with an unnarrowed union | TS2769 |
| Negative typing: access expr-style `.pattern` inside the narrowed fixture callback | TS2551 |
| Runtime mutation: wrong first batch count (127 rather than 128) | Exit 1; precisely batching test fails, 3 pass / 1 fail |
| Runtime mutation: replace expected invalid-rule diagnostic with impossible text | Exit 1; precisely validation test fails, 3 pass / 1 fail |
| Runtime mutation: change 64 KiB assertion bound to one byte | Exit 1; precisely batching test fails, 3 pass / 1 fail |

Runtime mutation controls use emitted fixture JavaScript passed via `node -e`, with imports relocated to the same live source via tsx. Mutants and exact assertion errors are preserved; the checked-in fixture is never mutated for these controls. Their only intended semantic changes are the three recorded assertion mutations. These are sensitivity controls, not extra passing product cases.

`worker-inputs.json` authenticates all **four** JavaScript files in the worker's TypeScript dependency closure against an in-memory emit under `tsconfig.build.json`. Existing dist files match exactly; no build output was written. Thus the canonical runtime uses checked current worker prerequisites, not assumed historical dist. No production source changed, so a shared full rebuild was neither needed nor performed.

## Capture commands and limits

Run at capture time, in order:

```text
node tests/commands/expr-stress/glob-typing-review-20260827/author/capture.mjs baseline
[apply the fixture-only type annotation]
node tests/commands/expr-stress/glob-typing-review-20260827/author/capture.mjs candidate
node tests/commands/expr-stress/glob-typing-review-20260827/author/check-worker-inputs.mjs
git diff --check -- tests/commands/regex-execution/continuation/glob.test.ts
git add -- tests/commands/regex-execution/continuation/glob.test.ts
git commit --only tests/commands/regex-execution/continuation/glob.test.ts -m "test(regex): narrow glob batching instrumentation to regex requests"
```

The capture driver is a version-specific, explicit opt-in recording tool, not a canonical test or current full gate. Existing capture directories/files are refused rather than overwritten. Its baseline mode requires the pre-fix source; do not rerun it against the candidate and call that an original reproduction. Inspect `*.execution.json` for fully expanded subprocess commands and `capture.mjs` for compiler overlay probes. `.ts.txt` and `.js.txt` snapshots/probes are data, not canonical TypeScript inputs or test-discovery entries. No test exclusions or shared discovery settings were introduced.

This is a live, scoped author run with frozen before/after inputs, **not** a committed-archive acceptance gate, full-project typecheck, public-package/service qualification, native recapture or superiority claim. Other workers changed unrelated worktree state concurrently; the captured status files preserve that fact. Imported compiler file names and content hashes match across baseline/candidate apart from the one authorized fixture. The complete compiler graph, rather than an assertion of a clean global worktree, binds that comparison.

## Cleanup and integrity

Every captured subprocess is bounded by 90 seconds and a 4 MiB output cap. A process-group termination fallback exists but was not used: **zero timeouts, zero forced terminations, all recorded groups absent after normal close**. Workers are process-owned and the fixture awaits session/executor cleanup. No temporary directories, server processes, background jobs or native captures were created. The requested `/tmp` receipt intentionally remains for the reviewer.

`verify-evidence.mjs --seal` creates a write-once `MANIFEST.json`; `verify-evidence.mjs` verifies hashes **and exact recursive file inventory**, detecting additions as well as modifications/removals inside this author directory. Only the manifest itself is excluded from its self-referential inventory. This checks the owned evidence tree, not append-proof integrity of the whole shared repository.
