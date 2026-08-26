# Independent jq stress and fixes

Date: August 26, 2026. Repository: `/Users/kjopek/Workspace/safe-bash`.
The stress/fix worker is separate from source author Poincare. A second,
read-only oracle reviewer supplied additional cases; this worker independently
rechecked their native results before fixing source. No further delegation,
runtime dependencies, public API changes, staging, or commits were performed.

## Oracle provenance

- Native executable: `/usr/bin/jq`, version `jq-1.7.1-apple`.
- Each native invocation uses literal argv through `spawnSync`, no shell,
  a 2,000 ms timeout, and a 65,536-byte output cap.
- `regressions.ts`: 18 manually recorded exact stdout/status fixtures, each
  checked against native jq before the first implementation change.
- `native-corpus.json`: 203 native captures from `independentCases()` in
  `cases.ts`; seed `0x93ade117`. Inputs/queries are generated without consulting
  the virtual implementation or its output. Expectations are frozen, not
  recomputed by the virtual code.
- `reviewer-corpus.json`: 19 separately reported failures, each rerun against
  native jq by this worker. Reviewer seed `0x732ce951` and source hash are
  preserved with the fixtures.
- All 240 frozen fixtures assert exact stdout and status. Error diagnostics
  assert a bounded project diagnostic, not native wording. Successful/no-result
  exit statuses require empty stderr.
- `verify-native.ts` is an optional verification command, not a test dependency.
  It fails if jq is missing or the version differs; it never silently skips.

The original author's suite independently reports 88 native matrix comparisons
and 210 seeded comparisons. Those 298 are separate from the new 240. They are
not added to a claim of unique coverage or general jq compatibility.

## Regression-first record

1. Original author baseline: 147/147 tests pass, build passes.
2. Initial independent regressions: **0 pass / 18 fail** before source edits.
3. After initial fixes: all 18 regressions and 147 author tests pass.
4. Broader corpus: **220 pass / 2 fail** among 222 tests. The failures expose
   empty `last` and explicit `ARGS` binding behavior; frozen expectations stay
   unchanged while source is corrected.
5. Reviewer regression gate: **18 pass / 19 fail** before the range and
   assignment-order fixes. All 19 native outputs are independently reverified.
6. Final owned suite: **438/438 pass**, no skips, including **291 new tests**.

The ten reported defect categories and their source locations are:

| Category | Root cause / correction |
| --- | --- |
| Read-index order | `Interpreter.run`: indexes precede base generators. |
| Slice order and laziness | `Interpreter.run`: lazy start/end/base traversal replaces eager bound collection. |
| Missing-path deletion | `Interpreter.set`: no ancestor creation or negative-index error for an absent deletion target. |
| Root deletion | `Interpreter.assign`: `. |= empty` emits null rather than no result. |
| Entry-key fallback | `Interpreter.call`: false/null key aliases fall through; value fields still retain false/null. |
| Automatic `$ARGS` order | `argumentsFor`: positional precedes named. |
| Empty `last` | `Interpreter.call`: `last(empty)` emits null; `first(empty)` still emits nothing. |
| Explicit `ARGS` binding | `argumentsFor`: named `ARGS` does not replace the special object. The old README statement is corrected. |
| Range argument laziness | `Interpreter.call`: start/end/step generators short-circuit and preserve emitted prefixes. |
| Assignment-index order | `Interpreter.paths`: index-major traversal preserves overlapping updates and required errors. |

Concrete argv/input/expected values are in the frozen fixtures. Before-fix
actuals, severity, exact reproducers, and source locations were promptly recorded
in `/tmp/safe-bash-jq-stress-checkpoint.txt`; the three failure logs are
`/tmp/safe-bash-jq-regressions-before.log`,
`/tmp/safe-bash-jq-corpus-first.log`, and
`/tmp/safe-bash-jq-reviewer-before.log`.

## Stress coverage and limits

All virtual execution uses `MemoryFileSystem`; no real/S3/WebDAV adapter is
used. The direct harness has a two-second cancellation signal, 64 KiB runtime
stdout limit, 128 KiB capture cap, 4,096-result limit, and 100,000-step limit
unless a bounded test deliberately overrides one. Test-runner deadlines provide
an additional asynchronous timeout, not preemption of synchronous JavaScript.

Coverage includes agent queries, multi-output composition, empty/null, object
and prototype keys, Unicode/escaping/numeric edges, CLI bindings, slurp, raw
output, statuses, preflight without acquiring input, and real virtual pipelines.
The baseline tested raw-input options as unsupported. The focused capability
increment below replaces those two nonfrozen negative-policy rows with `-RZ`
and `--raw-input=lines`: unsupported flags still fail before acquiring sources.

Malformed input tests include 23 specimens at four chunk sizes (92 runs),
malformed suffix/slurp behavior, and invalid UTF-8. These use the documented
strict JSON policy, not a permissive native parser as an oracle. A separate
seeded roundtrip invariant uses 64 generated JSON values at four chunk sizes
(256 runs, seed `0x6d2b79f5`); it is explicitly a metamorphic test, not a native
comparison. Resource limits, lazy early consumption, stalled I/O, late
rejections, cooperative CPU cancellation, and three actual Shell pipelines are
also exercised. These bounded workloads are not an exhaustive security proof.

Native process argv cannot represent NUL or unpaired surrogates faithfully.
The virtual-only NUL-argument test makes no native parity claim. Two reviewer
surrogate-argv mismatches are recorded as invalid oracle transports, not bugs.

## Final gates

- 438/438 owned tests pass, no skips; 291/291 new tests also pass with
  `PATH=/nonexistent`, demonstrating no native jq requirement.
- 20/20 complete independent-suite repetitions pass with strict unhandled
  rejections: 5,820 test executions, separate from the final combined run.
- Optional native replay: 240/240 frozen stdout/status expectations match.
- Strict scoped source/test typecheck, final global typecheck, global build, and
  a built ESM MemoryFS smoke check pass.
- Earlier global typechecks encountered concurrent unowned `bytes`,
  `search-stress`, and `text-programs` test errors. Exact locations remain in
  the checkpoint; they were resolved outside this assignment. No unowned fix
  was made. `/tmp/safe-bash-jq-final-typecheck.log` records the final clean run.
- Replaying all 781 saved reviewer oracle cases gives 764 exact matches and
  17 accounted-for differences: four documented object `any`/`all` overload
  restrictions, eleven numeric rendering gaps, two invalid argv transports.
  This is a saved-expectation replay, not 781 additional native executions.

The 17 differences stay in the denominator. Other deferred grammar remains
deferred at that baseline: `join`, raw input, object `any`/`all`, fractional slices, decimal
lexeme retention, recursion, bindings, definitions, regex, and the other source
README gaps. No full jq parity, superiority to just-bash, or elapsed-work-duration
claim follows from these tests.

## Reproduce

Run exclusively from the repository directory:

```sh
node --unhandled-rejections=strict --import tsx --test 'tests/commands/structured-stress/*.test.ts'
node --unhandled-rejections=strict --import tsx --test 'tests/commands/structured/*.test.ts' 'tests/commands/structured-stress/*.test.ts'
node --import tsx tests/commands/structured-stress/verify-native.ts
node_modules/.bin/tsc --noEmit --target ES2023 --lib ES2023 --module NodeNext --moduleResolution NodeNext --strict --noUncheckedIndexedAccess --exactOptionalPropertyTypes --verbatimModuleSyntax --forceConsistentCasingInFileNames --skipLibCheck --types node src/commands/structured/*.ts tests/commands/structured/*.ts tests/commands/structured-stress/*.ts
npm run typecheck
npm run build
shasum -a 256 src/commands/structured/*.ts
```

Modified runtime SHA-256:

```text
interpreter.ts b158f478a9a5591945fb087e5aa70220fc683662829bf9b8545bbd28942542d6
jq.ts a646844c7148c796834085a77db816c8f903b722abebc49eb79b18d96a7241e5
```

The seven-file runtime manifest hash is
`d0645dd53d40e74e1d745298415bafb2f8a4c00cccf4b1f87863649d18decd55`:
SHA-256 of concatenated `basename + " " + fileSHA256 + "\n"` records for all
`src/commands/structured/*.ts` files sorted by basename. It excludes README files.

## Focused raw-input author increment (August 26, 2026)

`raw-input-native.json` contains 74 new bounded native captures: 61 exact
stdout/status parity cases and 13 explicitly recorded safety-policy differences
(12 malformed UTF-8, including two split-file codepoints; one stop-on-first
runtime error). Both native outputs/statuses and separate policy expectations
are retained. These are 74 rows, not 74 distinct semantic categories.
`capture-raw-input.mjs` is an optional, standalone capture tool using literal
argv, `shell:false`, `/usr/bin/jq` version `jq-1.7.1-apple`, a two-second timeout,
and 64 KiB maxBuffer. It is never invoked by committed tests. The 74 tests each
replay at four byte chunk sizes without native jq. All 74 failed as unsupported
before runtime changes; the fixture/test/capture paths were staged first.

The additional 24 author safety tests cover every existing budget, exact UTF-8
and escaped-value byte accounting, empty `-j` results, prompt record emission,
sink backpressure, pending stdin/file-stream/file-fallback reads, writes,
iterator cleanup and late rejections, cooperative cancellation, EPIPE, null
input/preflight, cumulative virtual file inputs, and four actual MemoryFS shell
pipelines. Raw slurp preserves CR/LF verbatim; raw records preserve CR and join
partial records across file boundaries. No contracts or API exports changed.

Author gate: 536/536 combined structured tests pass. A native-free combined run
passes 534 with two pre-existing optional native-oracle tests skipped; none of
the 98 new tests need native jq. These author checks are not the requested
separate-worker final verification. Fresh scoped typing, global typecheck, and
global build pass. The 389-test stress suite also passes with `PATH=/nonexistent`
and no skips. Earlier unowned diff-patch test type errors cleared outside this
assignment. All 240 original frozen native expectations replay exactly; no
original frozen fixture or capture is changed. Runtime SHA-256 after raw input:
`input.ts` = `c68b78e64b99690614314e33b9fcdf458ec3589de01192da9655104101d1e829`,
`jq.ts` = `b30ccbdf9ae59b41cb8deec1e5245e5c3ddcc6688e1624e2526f742fb00063b4`.
