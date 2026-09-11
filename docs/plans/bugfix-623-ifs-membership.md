# #623: scoped IFS membership preparation

## Verified scope

Issue #623 is authored by `kamilio`. Current code repeatedly searches the IFS
string for each value character/ASCII byte and again to classify string pieces.
Byte-valued input also materializes `Array.from(IFS)` to choose its scan mode.
The bounded evidence establishes those operations, not the issue's CPU severity,
timings, memory consumption, or large-input claims.

Integration write-set:

- `packages/safe-bash/src/shell/runtime.ts`
- `packages/safe-bash/tests/shell/ifs-membership.test.ts` (new canonical test)
- `docs/plans/bugfix-623-ifs-membership.md`

Root owns literal test registration, live integration, Git and full delivery
gates. There are no README, defaults, global-cache or other source changes.

## Root integration evidence

Root verified the patch and source/test hashes, reviewed the UTF-16 membership
and ownership rules, and confirmed that empty IFS bypasses this matcher at the
existing call sites. The existing yield callback runs the CPU checkpoint.

Before production changes, the actual checkout produced the same 11 behavioral
failures and 42 passes. After applying the reviewed implementation, all 164
focused tests pass, and all 98 maintained input-registration tests pass. The
new canonical test is registered by exact literal path. Root RED/GREEN and
registration logs remain separate from the immutable private-candidate evidence.

Full maintained build, all-workspace unit, lint and type gates are still required
before push. No root full-gate, delivery, publication, CPU-severity or heap-safety
claim is made by these focused results. Close issue 623 immediately after verified
delivery to main, then verify the release separately.

The first full workspace run caught an existing security-audit test calling the
private splitter with its old string-based signature. The Bash task reported
19,962 passes, one failure and 63 skips; this is not a passing full gate. Root
updated only that test's private signature and invocation to supply numeric
membership and the ASCII flag, retaining its original byte reconstruction,
checkpoint and command-count assertions. The original failing log is preserved;
focused and complete qualification must run again before delivery.

After that correction, the complete maintained workspace unit route passes;
the Bash task reports 19,963 passes and 63 skips. The subsequent complete root
lint finds one boxed `String` type annotation in the new observer test. Root
replaces it with primitive `string`, without changing the observer or assertions.
The failed lint is retained, and fresh lint/type checks remain required. Runtime
equivalence of this type-only correction is checked separately from those gates.

## Implementation and compatibility

Prepare a numeric membership set once per nonempty split value and share it with
the scanner and field classifier. Store every UTF-16 code unit plus each complete
supplementary code point encountered in IFS. This preserves `String.includes`
membership for a single scanned character, including an isolated high/low
surrogate matching inside an IFS pair. A code-point-only Set would not preserve
that behavior. Classification also checks that the piece is exactly one scanned
character, rather than treating the first character of a longer run as a match.

Derive ASCII-only status in the same pass. Preserve raw-byte scanning when all
IFS units are ASCII; retain the existing decoded-text path for non-ASCII IFS.
Leave space/TAB/LF handling, nonwhitespace empty fields, duplicate neutrality,
empty-IFS bypass, Unicode normalization behavior and locale behavior unchanged.
Empty values do not need a lookup. Read current IFS for each split, including
after assignment within a word; no retained cross-word cache is introduced.

Use a dedicated scope in the existing execution ValueArena for both scalar and
array-owned words. Reserve 64 logical metadata bytes before creating the set and
32 before inserting each distinct numeric key. Duplicates do not reserve again.
These are logical accounting charges, not a heap/RSS model. Release the scope in
`finally`, including preparation failure, cancellation and field-limit failure.
Existing array-owner and output/value accounting remain unchanged.

Check the existing CPU/cancellation budget before preparation. Charge each
scanned IFS unit to the existing split-work checkpoint cadence, yielding every
4096 accumulated units. Value scanning keeps its existing checkpoints too.
No CPU or wall-clock defaults are changed.

## Bounded TDD evidence (2026-09-05)

Candidate baseline: `7520ad1cccd84c8d78e81d086d7c1a466a1fe349`.
Baseline runtime SHA-256:
`9968eac9f7314fb137931934fd27d06cebfb64899c40fb8c4461458f2ac089f5`.

All development occurred in private scratch while root's repository freeze was
active. Exact owned inputs were copied; unchanged dependencies are read-only
links. `--preserve-symlinks` keeps imports within the scratch module graph.

Scratch root:
`/home/kjopek/kamilio-validation-569-575.RoFXyZ/tmp/623-candidate.mSZvFy`

- Initial RED before production edits: 53 tests, 42 passed, 11 failed (ten
  repeated-search controls and one missing lookup-storage admission).
- The final test version adds visible work diagnostics and accurately labels
  asynchronous cancellation without claiming its exact interruption point.
  Rechecking that version against an independent exact baseline copy produces
  the same 42 passes and 11 failures. Original tests/logs are preserved.
- GREEN: 164/164 tests across the new file and unchanged adjacent
  `byte-values.test.ts` and `value-state.test.ts`.
- Work controls use 8/16 value characters, duplicate/distinct 16-unit IFS,
  genuine raw-byte values and separator-only fields. Baseline submitted
  128–512 IFS haystack units per control; candidate submits zero to repeated
  native substring searches. The assertions allow bounded preparation and do
  not require a particular set/table representation or count native comparisons.
- New controls include 36 small UTF-16 substring membership combinations,
  whitespace/nonwhitespace, raw bytes, three locale settings, IFS mutation,
  storage admission, duplicate storage, repeated scalar/array-owned words,
  empty values, and falsey pre/asynchronous cancellation. New value/IFS inputs
  are at most 1 KiB; no stress, heap or timing probe was used.
- A separate bounded public-flow checkpoint probe schedules falsey cancellation
  only when the first value splitter begins. With four one-byte values and a
  1-KiB duplicate IFS, baseline starts all four value scans before cancellation;
  candidate starts three and cancels during subsequent IFS preparation. This
  is a scheduling-seam observation, not an abort-latency measurement.
- Strict scoped TypeScript check exits 0 with `--noEmit` and the actual package
  options: ES2023 target/lib, NodeNext module/resolution, strict,
  noUncheckedIndexedAccess, exactOptionalPropertyTypes, verbatimModuleSyntax,
  forceConsistentCasingInFileNames, skipLibCheck and node types. Scratch adds
  preserveSymlinks only. Roots are runtime plus the three focused test files.

Focused commands use Node 22, private home `TMPDIR`, `TSX_DISABLE_CACHE=1`,
`NO_COLOR` unset, and cleared child Git-local environment variables:

```sh
node --preserve-symlinks --preserve-symlinks-main --import tsx --test --test-concurrency=1 --test-timeout=10000 baseline/packages/safe-bash/tests/shell/ifs-membership.test.ts
node --preserve-symlinks --import tsx --test --test-concurrency=1 --test-timeout=10000 packages/safe-bash/tests/shell/ifs-membership.test.ts packages/safe-bash/tests/shell/byte-values.test.ts packages/safe-bash/tests/shell/value-state.test.ts
node --preserve-symlinks node_modules/typescript/bin/tsc --noEmit --target ES2023 --lib ES2023 --module NodeNext --moduleResolution NodeNext --strict --noUncheckedIndexedAccess --exactOptionalPropertyTypes --verbatimModuleSyntax --forceConsistentCasingInFileNames --skipLibCheck --types node --preserveSymlinks packages/safe-bash/src/shell/runtime.ts packages/safe-bash/tests/shell/ifs-membership.test.ts packages/safe-bash/tests/shell/byte-values.test.ts packages/safe-bash/tests/shell/value-state.test.ts
node --preserve-symlinks --import tsx evidence/checkpoint-probe.mjs baseline
node --preserve-symlinks --import tsx evidence/checkpoint-probe.mjs
```

Evidence: `evidence/red.log`, `green.log`, `types.log`, `types.exit`,
`checkpoint-baseline.log`, `checkpoint-candidate.log`, preserved `initial-*`,
and `candidate.sha256`. `candidate.patch` uses apply_patch format and is verified
against a fresh baseline copy. These focused checks are not full-gate clearance.

Earlier read-only investigation and its original ASCII/raw harness correction
remain untouched at
`/home/kjopek/kamilio-validation-569-575.RoFXyZ/tmp/623-readonly.bSB4Hh`.
Its evidence manifest SHA-256 is
`2221c68ef59d252f27f9c08bd2529b19ccfd7c90bff7689df289945b6d943086`.
