# Independent jq stress and fixes

Date: August 26, 2026. Repository: `/Users/kjopek/Workspace/safe-bash`.
The baseline stress/fix worker is separate from source author Poincare. A second,
read-only oracle reviewer supplied additional cases; this worker independently
rechecked their native results before fixing source. No further delegation,
runtime dependencies or public signature changes were introduced in that
baseline. The later focused capability author work and its commits are recorded
separately below; they are not independent acceptance by that baseline reviewer.

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

## Focused join author increment (August 26, 2026)

`join-native.json` adds 129 literal native references, captured by the standalone
`capture-join.mjs` with the same `/usr/bin/jq` version and process bounds as raw
input. Of these, 126 match native stdout/status; three explicitly preserve the
existing decimal-lexeme/exponent rendering policy, keeping the original native
expectation alongside the virtual policy expectation. No test invokes this
capture script. Before source edits, these three paths were staged and the
regression gate failed 127/129 cases; the two wrong-arity cases already passed.

The 19 additional author safety tests cover exact UTF-8/control-character value
and output accounting; every existing limit; uncatchable hidden limits; lazy
and empty separator generators; stdout backpressure before further separator
evaluation; prompt output without input EOF; cancellation during element loops,
separator expansion and pending writes; late rejections and cleanup; prototype
keys; dead-branch preflight; and four actual MemoryFS pipelines. The nonfrozen
unsupported `join(",")` preflight row becomes invalid-arity `join(",";":")`,
preserving its status-3/no-input assertions. Unsupported `split` still fails even
in a dead branch; no extra builtin or grammar is added.

Author gates: 684/684 combined structured tests pass; 537/537 stress tests pass
with `PATH=/nonexistent` and no skips; scoped typing, global typecheck and build
pass. The two increments add 246 tests: 98 raw-input (74 native-derived + 24
safety), then 148 join (129 native-derived + 19 safety). These overlap the
combined totals and must not be summed again. Fresh native replay verifies all
203 new literal expectations, including the unchanged native side of policy
rows, and all 240 original frozen references. The 203 new rows include 187
parity expectations and 16 explicit policy differences, not 203 parity passes.
The ten baseline semantics and every frozen original fixture remain intact.
Runtime SHA-256 after join:
`interpreter.ts` = `18a6ec16d29f434244c78c2f842ed1c1e716e5c03d9b65c605a38a2ea02b2b93`,
`parser.ts` = `e5778a10fc6fefb211c3c4aa39edd937fb372803a0c92e4f0c3557fc184adbfd`.
The raw-input hashes above remain unchanged. A different-worker final verifier
has not run for this increment; these are source-author gates only.

## Prior 15 documented mismatch rows remain

The saved 781-row reviewer matrix replays as 764 matches and the same 17
differences. Excluding two invalid surrogate-argv transports leaves **15 prior
documented mismatch rows**, not 15 distinct categories. This increment does not
change any of them. Their exact grouped reproducers use `jq -c -- FILTER`:

| Rows | Input | Filter(s) | Native versus virtual difference |
| --- | --- | --- | --- |
| 4 | `{}` and `{"a":null,"b":false,"c":0}` | `[any(empty)?]`, `[all(empty)?]` on each input | Native `[false]` / `[true]`; virtual `[]` because these overloads remain array-only. |
| 3 | `0.0000001` | `.`, `tojson`, `tostring` | Native `1E-7`; virtual `1e-7` (quoted for conversion filters). |
| 1 | `0.0000001` | `[length?]` | Native `[1e-07]`; virtual `[1e-7]`. |
| 1 | `100000000000000000000` | `[length?]` | Native `[1e+20]`; virtual `[100000000000000000000]`. |
| 3 | `1e2` | `.`, `tojson`, `tostring` | Native `1E+2`; virtual `100` (quoted for conversion filters). |
| 1 | `null` | `1/10000000` | Native `1e-07`; virtual `1e-7`. |
| 2 | `null` | `1e20`, `1e21` | Native `1E+20`, `1E+21`; virtual `100000000000000000000`, `1e+21`. |

Every displayed output has a trailing LF. These 4 array-only plus 11 numeric
rows are unchanged historical references, separate from the new capability
corpora. The invalid NUL/surrogate argv transport limitations are not counted as
product bugs. Fractional slices, other grammar gaps, logical rather than exact
resident-memory quotas, and cooperative rather than forced host cancellation
also remain documented limitations. No broad jq parity or superiority claim.

## Fresh independent increment verification: phase 1 (August 26, 2026)

This is a new leaf verifier's investigation of `62315bc` and `e9b30e1`, not an
author rerun presented as independence. **No product source changes, staging,
or commits were made in this phase.** Source README changes are reserved for
the fix phase. All new artifacts are in `independent-increment/` below this
directory. Existing author fixtures, expectations, and tests are unchanged.

### Frozen evidence and safe native execution

The available oracle is `/usr/bin/jq`, `jq-1.7.1-apple`, build configuration
`--with-oniguruma=builtin`. Neither `/opt/homebrew/bin/jq` nor
`/usr/local/bin/jq` was available; this is not a cross-version jq matrix.
`native-vectors.json` and `supplement-vectors.json` freeze literal hexadecimal
input/stdout/stderr, exact argv, exit status, signal, per-stream SHA-256,
executable hash, capture time, environment, platform, Node version, reviewed
commits, and six structured-source hashes. Frozen expectations are exclusively
native captures, never product-derived. Product observations are separate files.

Each invocation uses literal argv, `shell: false`, a fresh isolated temporary
directory under this test directory, a controlled locale/environment, a 2-second
watchdog, and a 65,536-byte cap on each output stream. Files are fixed trusted
basenames populated from literal byte vectors. Filters and pipeline stages are
trusted probe definitions, not input-derived host commands. Native pipeline
references run each bounded stage separately, supplying the previous stage's
captured bytes; they do not launch a host shell. Product pipeline checks use
actual virtual shell pipes with a one-byte high-water mark.

There are **155 vector cases, 126 logical probes, and 160 native fixture
invocations per complete capture/replay**, plus four version/build metadata
invocations. The original batch is 140 cases / 145 fixture invocations; the
supplement is 15 / 15. Twenty-nine bytewise transport variants are included in
155, not additional logical probes. Three pipeline cases use eight invocations,
already included in 160. Native write segmentation does not guarantee OS read
segmentation; product chunk-boundary tests control the ByteSource explicitly.
Capture and replay counts are per run, not total invocations across all reruns.

Two initial probe definitions were accidentally malformed: `fromjson` contains
unescaped inner JSON quotes; `join-mixed` contains a literal NUL in JSON input
and a literal newline in its filter string. The latter also has a bytewise row.
These **three frozen rows remain in every full denominator and in the red
tests**, but are not evidence of intended valid-input feature failures.
`fromjson-valid-precision` and `join-mixed-valid` add independently recaptured
valid replacements without rewriting the original vectors. The valid join
replacement passes; the valid fromjson replacement exposes precision loss.

SHA-256 (full file bytes):

| Artifact in `independent-increment/` | SHA-256 |
| --- | --- |
| `native-vectors.json` | `924634ea7933a6b14be1295f65cd0f68485133975961572acab41fc307595a66` |
| `supplement-vectors.json` | `3989c0678c2e87a6efff2bee562438fc0d03dfdbf167c2329cfebf296e3f4ba2` |
| `phase1-observation.json` | `b1553f455aedaf709384b5c76d7571bca18f6bcc7ecdb0b4d752d5d1be12a238` |
| `supplement-observation.json` | `8b1f9ea12ae069704dc54e9c6fc42c962e62883631c3056c2e3fae1be7ee449f` |

### Checkpoint and denominators

Fresh full comparison: **55/155 exact stdout/stderr/status matches, 92/155
stdout or status differences, and 8/155 stderr-only differences**. "Semantic"
in the observation JSON means stdout/status inequality, including rendering;
it does not imply every mismatch changes a mathematical value. Removing the
three invalid fixture-construction rows only for diagnosis gives 55 exact,
90 stdout/status differences, and seven diagnostic-only differences out of
152 valid-transport rows. The unmodified total remains 155, not 152.

| Coverage category | Vector cases | Native fixture invocations | Exact | Stdout/status difference | Stderr only |
| --- | ---: | ---: | ---: | ---: | ---: |
| Object iteration / quantifiers | 21 | 21 | 1 | 20 | 0 |
| Numeric identity | 12 | 12 | 1 | 11 | 0 |
| Numeric conversions / join | 13 | 13 | 1 | 12 | 0 |
| Numeric length | 14 | 14 | 9 | 5 | 0 |
| Numeric transforms | 15 | 15 | 1 | 13 | 1 |
| Raw input/output / join | 29 | 29 | 27 | 2 | 0 |
| Generator / input error ordering | 21 | 21 | 6 | 10 | 5 |
| Malformed UTF-8 / surrogate escapes | 18 | 18 | 0 | 16 | 2 |
| File / repeated-stdin boundaries | 3 | 3 | 2 | 1 | 0 |
| Actual virtual pipelines | 3 | 8 | 1 | 2 | 0 |
| Native safety-reference outputs | 6 | 6 | 6 | 0 | 0 |
| **Total** | **155** | **160** | **55** | **92** | **8** |

The 100 differing rows are not 100 distinct bugs. Exclusive diagnostic groups
are: object zero/one-argument iteration (16 rows), absent two-argument quantifier
overloads (4), decimal preservation (29), computed-double rendering (6), decimal
comparison/unique semantics (3), large positive exponent handling (3), Unicode
acceptance/replacement (17), per-input runtime-error continuation (10), diagnostic
formatting only (7), propagation of numeric/continuation differences through
pipelines (2), and malformed probe definitions (3). The two pipeline rows repeat
underlying categories rather than introducing two more bugs. All nonpipeline
rows require one native fixture invocation each; the two differing pipeline
cases require five invocations combined.

### Concrete diagnoses and fix handoff

1. **Object quantifiers:** `interpreter.ts` applies an array-only guard before
   zero/one-argument `any`/`all`. On `{}`, native `any(empty)` emits `false\n`
   and `all(empty)` emits `true\n`, status 0; product emits no stdout, status 5.
   `[any(empty)?,all(empty)?]` silently becomes `[]\n` instead of
   `[false,true]\n`. Nonempty objects, insertion order, and early short-circuit
   cases are frozen too. Separately, parser arity preflight rejects native
   `any(generator; condition)` and `all(generator; condition)` with status 3.
   Treat this as a remaining compatibility feature gap, not desired behavior.

2. **Decimal identity and precision:** `input.ts` parses tokens with
   `JSON.parse`; `parser.ts` converts numeric literal tokens to `Number`.
   `scalarJson` uses JavaScript serialization. Native retains `12.3400`,
   `9007199254740993`, and `0.123456789012345678901`; product emits `12.34`,
   `9007199254740992`, and `0.12345678901234568`. `tojson`, `tostring`, `join`,
   `tonumber`, `fromjson`, `--argjson`, nested copying, and unrelated updates
   expose the same loss. A formatting-only patch cannot restore lost digits.
   Preserve original numeric information through parsing and value transport,
   but do not blindly echo original spelling: native normalizes `42e+02` to
   `4.2E+3`, retains input `-0.000`, and evaluates a filter literal `-0.000` to
   `-0`. Arithmetic deliberately converts to binary64 in these native probes.

3. **Computed-double rendering is separate:** `length` of a number converts
   to an absolute binary value. Native length of `9007199254740993` is
   `9007199254740992`, while identity preserves the original integer.
   Native length of `100000000000000000000` is `1e+20`, not product's full
   decimal; `0.0000001` becomes `1e-07`, not `1e-7`. Conversely native length
   of `123456789012345678901234567890` is
   `123456789012345680000000000000`, where product uses exponent notation.
   Do not substitute one global exponent-case/threshold rule for native
   decimal-token versus computed-double rendering.

4. **Comparisons are not merely presentation:** adjacent large integer tokens
   compare unequal natively but equal in product; adjacent precise fractions
   order natively but collapse in product; `unique` incorrectly drops one of
   two distinct large integers. Preserve decimal comparison semantics as well
   as rendering. Native accepts and retains `1e400` as `1E+400`, while product
   errors before evaluation; native length clamps to the largest finite double.
   Native retains `1e-400`, while product underflows it to zero. Numeric semantics
   here are specifically pinned to this Apple 1.7.1 executable/build, not
   asserted identical across all jq versions/build configurations.

5. **Runtime-error continuation:** native processes later input records after
   an uncaught filter error. For `["ok"]\n[{}]\n["after"]\n` with `-j
   'join("|")'`, native emits `okafter`, reports the middle error, and exits 0;
   product emits `ok`, reports one error, and exits 5. With `-e`, a later false
   result yields native status 1; a later empty-result input can yield 4.
   A separator error stops the current generator, not all subsequent inputs.
   `first`, `limit`, empty separators, caught errors, and backpressure have
   passing controls. The top-level catch in `jq.ts` explains the stop-first
   behavior. Diagnose error scope and exit-status aggregation separately from
   message wording; not every native error should be made recoverable.

6. **Unicode policy:** native repairs the tested malformed raw bytes and
   malformed bytes inside JSON strings; product's fatal decoder rejects them.
   Native repairs a lone low-surrogate JSON escape but rejects an unpaired high
   surrogate. Do not replace the fatal decoder with a default TextDecoder and
   assume parity: for UTF-8 bytes `ed a0 80`, this native raw-input capture emits
   one replacement character. Native repairs incomplete UTF-8 separately at
   file boundaries: `41 f0 9f` followed by `98 80 0a 42` in a second file emits
   `"A���"\n"B"\n`, not a reconstructed emoji. Valid multibyte chunking, raw CR,
   NUL, BOM, empty records/slurp, repeated stdin, and cross-file text records
   have passing controls. Error diagnostics also differ in context/line/wording.

Strict UTF-8 and stop-first-error are existing intentional implementation
deviations, **not user-requested features and not compatibility passes**. The
recommendation is to improve standard jq compatibility, subject to root's fix
assignment: per-input recovery must still propagate cancellation and leave
quotas uncatchable; replacement decoding must preserve byte accounting, safe
streaming, native replacement grouping, and file boundaries. If strict modes
are retained, make that an explicit separately approved choice rather than
quietly labeling native behavior unsupported. No policy changes occur here.

### Reproduction and validation

Run from `/Users/kjopek/Workspace/safe-bash`:

```sh
node tests/commands/structured-stress/independent-increment/native.mjs --verify
node tests/commands/structured-stress/independent-increment/supplement.mjs --verify
node --import tsx tests/commands/structured-stress/independent-increment/diagnose.ts
node --unhandled-rejections=strict --import tsx --test tests/commands/structured-stress/independent-increment/native-regressions.test.ts
node --unhandled-rejections=strict --import tsx --test tests/commands/structured-stress/independent-increment/safety.test.ts
```

Exact single-case native/product reproducers (hex captures include all bytes):

```sh
node tests/commands/structured-stress/independent-increment/native.mjs --case 'object-vacant-any(empty)'
node --import tsx tests/commands/structured-stress/independent-increment/diagnose.ts --case 'object-vacant-any(empty)'
node tests/commands/structured-stress/independent-increment/native.mjs --case number-large-integer-identity
node --import tsx tests/commands/structured-stress/independent-increment/diagnose.ts --case decimal-unique
node tests/commands/structured-stress/independent-increment/native.mjs --case recover-following-json
node tests/commands/structured-stress/independent-increment/native.mjs --case raw-surrogate
node tests/commands/structured-stress/independent-increment/supplement.mjs --case large-length-1e20
node --import tsx tests/commands/structured-stress/independent-increment/diagnose.ts --case large-length-1e20
```

Both native replays pass against the unmodified frozen artifacts. The new
exact-byte suite intentionally **fails: 156 tests, 56 pass, 100 fail, zero
skips/TODOs/cancellations** (155 cases plus one integrity check). It also has
those exact counts with `PATH=/nonexistent`, using an absolute Node executable;
tests do not require or spawn native jq. `--freeze` refuses existing vector
files; never regenerate expectations from a fix or overwrite this baseline.

The independent safety suite passes **28/28**, including 134 explicit split
executions, four unsplit malformed-input baselines, empty chunks, internal
16,384-byte boundaries, all nine quota kinds, exact UTF-8 byte limits,
uncatchable hidden limits, generator backpressure, late rejection observation,
pending read/write cancellation, CPU cancellation, and pre-aborted no-read.
Ten additional native-free strict-unhandled-rejection repetitions pass 280/280
test executions. These repetitions are not 280 different safety cases.
The four strict-decoder chunk-invariance tests document current behavior, not
native acceptance; adapt their policy assertions if replacement is approved.

The unchanged existing author suite was independently rerun using the explicit
top-level `tests/commands/structured/*.test.ts` and
`tests/commands/structured-stress/*.test.ts` paths: **684/684 pass**. This does
not include the new nested red tests. Scoped typechecking of all new TypeScript
files and their imported code passed:

```sh
node_modules/.bin/tsc --noEmit --target ES2023 --module NodeNext --moduleResolution NodeNext --strict --noUncheckedIndexedAccess --exactOptionalPropertyTypes --verbatimModuleSyntax --skipLibCheck --types node tests/commands/structured-stress/independent-increment/*.ts
git diff --check -- tests/commands/structured-stress/README.md tests/commands/structured-stress/independent-increment
```

All six structured source hashes and both original capture-script hashes were
rechecked against frozen provenance and remain unchanged. No whole-repository
pass, full jq compatibility, or superiority is claimed. One accidentally
unscoped `node --test` launch was terminated and is excluded from all validation
counts; it may have left native-test temporary directories under other workers'
stress paths. No unowned source/test definitions were edited or cleanup attempted. Root should coordinate
any such cleanup rather than this leaf changing another worker's paths.

Next phase belongs to root: assign atomic source fixes, preserve these frozen
native vectors, update product documentation only with new evidence, then use
a separate independent rerun. Prioritize object iteration and numeric value
representation/comparison/rendering; do not convert red native expectations
into passing product-policy expectations to satisfy the gate.
## Phase 2a: quantifier regression author checkpoint

The fix author preserved and committed the phase-one artifacts without changes
to their frozen bytes. This author is not the independent final verifier.
Object iteration now passes all 21/21 original native vectors, fixing 16
zero/one-argument rows and four generator-overload rows. Six additive generator
vectors were captured before source changes; all six pass. They include scalar
input, lazy generator and condition errors, empty conditions, and object order.

```sh
node --unhandled-rejections=strict --import tsx --test tests/commands/structured-stress/independent-increment/quantifier-fixes.test.ts
node --unhandled-rejections=strict --import tsx --test tests/commands/structured/*.test.ts tests/commands/structured-stress/*.test.ts
node --import tsx tests/commands/structured-stress/independent-increment/diagnose.ts
```

Results: 30/30 focused tests; 684/684 existing owned tests; complete native
matrix 75 exact / 72 stdout-status differences / 8 diagnostic-only out of 155.
Numeric, Unicode, recovery and diagnostic gaps remain at this intermediate
checkpoint. No raw comparisons were relaxed. The additive native files also
contain numeric probes reserved for the next fix; their complete denominators
and author probe-construction mistakes will be reported separately.

## Phase 2b: numeric regression author checkpoint (August 26, 2026)

This is the **fix author**, not the independently assigned final verifier.
Ownership was limited to the structured source and two structured test trees.
No root docs/config, adapters, diff-patch files, other worker index entries,
branches, or global test/build suites were changed or used. The complete
original evidence and phase-one observations are still byte-identical.

### Delivered root-cause fixes

- Object quantifiers: zero/one-argument overloads iterate object values in
  insertion order; two-argument standard generator overloads are lazy and
  short-circuit both generator and condition. Empty conditions and generators
  preserve native identities. Existing quotas and cancellation are not caught.
- Decimal identity and conversion: retain coefficient, scale, sign and exponent
  through input/filter parsing, `--argjson`, `tonumber`, `fromjson`, copying,
  unrelated updates, type filters, `tojson`, `tostring`, and `join`. Normalize
  decimal spelling as native does rather than preserving arbitrary token case.
- Comparisons: compare decimal coefficients/exponents without lossy binary64
  conversion when both operands are literals. Sorting, grouping, uniqueness,
  containment and relational operators share that comparison. Mixed computed
  and literal operands deliberately follow the native double fallback.
- Computed numbers: apply the inspected 17-digit ties-even decimal conversion;
  use a separate shortest-double formatter with native decimal-point thresholds
  and two-digit small exponents. Numeric `length`, unary minus, arithmetic,
  overflow/underflow, signed zero and initial literal `range` values are covered.
  Computed infinity renders the signed maximum finite double; computed NaN
  renders null. Division by zero and bounded range progression still error.

There are zero new runtime dependencies, exported functions, plugin options,
host filesystem/process facilities or eval. Internal Json/AST parsing changed,
not the public command contract. Numeric output bytes and comparisons can
change intentionally, and decimal work now consumes length-proportional steps.
No Unicode or error-recovery policy change is hidden in this patch.

### Full original native denominator, before and after

Oracle: `/usr/bin/jq`, **jq-1.7.1-apple**, build
`--with-oniguruma=builtin`; executable hash is retained in the native files.
All 155 original cases / 160 fixture invocations remain in the matrix.

| Coverage category | Cases | Before exact | After exact | After stdout/status differences | After diagnostic-only |
| --- | ---: | ---: | ---: | ---: | ---: |
| Object iteration / quantifiers | 21 | 1 | 21 | 0 | 0 |
| Numeric identity | 12 | 1 | 12 | 0 | 0 |
| Numeric conversions / join | 13 | 1 | 13 | 0 | 0 |
| Numeric length | 14 | 9 | 14 | 0 | 0 |
| Numeric transforms | 15 | 1 | 14 | 0 | 1 |
| Raw input/output / join | 29 | 27 | 27 | 2 | 0 |
| Generator / input error ordering | 21 | 6 | 6 | 10 | 5 |
| Malformed UTF-8 / surrogate escapes | 18 | 0 | 0 | 16 | 2 |
| File / repeated-stdin boundaries | 3 | 2 | 2 | 1 | 0 |
| Actual virtual pipelines | 3 | 1 | 2 | 1 | 0 |
| Native safety-reference outputs | 6 | 6 | 6 | 0 | 0 |
| **Total** | **155** | **55** | **117** | **30** | **8** |

Before was 55 exact / 92 stdout-status differences / 8 diagnostic-only.
After is **117 exact / 30 stdout-status differences / 8 diagnostic-only**.
The intermediate quantifier-only commit was 75 / 72 / 8. All 53 valid numeric
rows now match exact native bytes; the remaining numeric-transform row is the
original malformed `fromjson` fixture. All 21 quantifier rows match.

Exclusive breakdown of the **100 baseline differences**, not distinct bugs:

| Bug category | Baseline differing rows | Fixed to exact | Still different |
| --- | ---: | ---: | ---: |
| Object zero/one-argument iteration | 16 | 16 | 0 |
| Missing two-argument generator overload | 4 | 4 | 0 |
| Decimal preservation | 29 | 29 | 0 |
| Computed-double formatting | 6 | 6 | 0 |
| Decimal exponent range | 3 | 3 | 0 |
| Decimal comparison / uniqueness | 3 | 3 | 0 |
| Unicode repair / file boundary | 17 | 0 | 17 |
| Per-input runtime-error recovery | 10 | 0 | 10 |
| Diagnostic-only formatting | 7 | 0 | 7 |
| Pipeline propagation of numeric/recovery differences | 2 | 1 | 1 |
| Original malformed probe rows | 3 | 0 | 3 |
| **Total** | **100** | **62** | **38** |

The three malformed original rows (`fromjson`, `join-mixed`, and its bytewise
variant) stay frozen, counted and failing. Diagnostic exclusion only, never an
acceptance denominator: the other 152 rows are 117 exact / 28 stdout-status
differences / 7 diagnostic-only. The full raw test file remains **156 tests,
118 pass, 38 fail**, including its integrity test; zero skips or TODOs.

### Additive evidence and honest probe accounting

The author captured 62 cases plus six supplemental cases **before any phase-two
source edits**. Nine exponent/conversion cases were then captured after the
quantifier commit but **before numeric source edits**. All use the phase-one
literal-argv runner, 2-second watchdog, isolated trusted files and 65,536-byte
per-stream caps. Extreme native exponent probes only run bounded identity
filters; hazardous coefficient/comparison loops run solely against product
workers under explicit limits, not against native jq.

A final inspection found that converting an overflowed decimal literal directly
to a plain double lost its decimal comparison identity: literal infinity must
sort beyond a finite `1e400`, even though both convert to binary64 infinity.
Four further bounded native vectors were frozen before that correction; two
were red before the fix and all four pass afterwards. Positive/negative literal
overflow now retains decimal identity; mixed computed comparisons still use
the native double fallback. This additional author cycle is not an independent
verification claim. The earlier product observation is retained unchanged.

The **81 additive cases** require 81 native fixture invocations. Results are
**77 exact / 0 stdout-status differences / 4 diagnostic-only**. Four author
expressions had unintended pipe grouping: `compare-mixed-double`, `scalar-types`,
`preserve-through-copy`, and `conversion-large-token`. Native correctly errors
for those supplied programs; product has the same stdout/status but different
diagnostics. They were not rewritten. Correctly parenthesized replacements and
separate conversion probes are additive. These are not four numeric bugs or
four malformed original byte transports. The additive full raw gate remains
**82 tests, 78 pass, 4 fail**, including integrity; zero skips or TODOs.

Combined original and additive accounting is **236 cases / 241 native fixture
invocations**, with **194 exact / 30 stdout-status differences / 12
diagnostic-only**. All six replay commands together add twelve metadata
invocations. Raw tests together have 238 tests including two integrity checks,
196 pass and 42 fail. These totals do not count focused/repeated tests again.

All four required immutable hashes were rechecked, not just the native bytes:

| Original artifact | Verified SHA-256 |
| --- | --- |
| `native-vectors.json` | `924634ea7933a6b14be1295f65cd0f68485133975961572acab41fc307595a66` |
| `supplement-vectors.json` | `3989c0678c2e87a6efff2bee562438fc0d03dfdbf167c2329cfebf296e3f4ba2` |
| `phase1-observation.json` | `b1553f455aedaf709384b5c76d7571bca18f6bcc7ecdb0b4d752d5d1be12a238` |
| `supplement-observation.json` | `8b1f9ea12ae069704dc54e9c6fc42c962e62883631c3056c2e3fae1be7ee449f` |

New artifacts under `independent-increment/`:

| Artifact | SHA-256 |
| --- | --- |
| `phase2-vectors.json` (62 native cases) | `afcfae94201a04a4455e7410371bfbdcfbe35823939569cc13786779dfaca101` |
| `phase2-extra-vectors.json` (6 native cases) | `230ac4fa5531e104b541b1e65f177c27c5efc9267125977a112df54dc7e743ac` |
| `exponent-vectors.json` (9 native cases) | `e90ececb9f163080873975c46063245df6200b7316edd682a401e33c07f9039d` |
| `overflow-comparison-vectors.json` (4 native cases) | `86808210a4d14d5c5e5ad86db2a0803875e6143047a3f8dbf256378635891789` |
| `phase2-observation.json` (intermediate author product report, not expectations) | `2fc7931951d7d4baef37f2cf2164b6fdc5d21d173915a4754ade8044f07faca8` |
| `phase2-final-observation.json` (final author product report, not expectations) | `3d17653b0b6a1dbc84c6928b1e65f00ed264fa6a20b584a1f785e5daf7d83d31` |

The final observation includes all seven structured implementation source
hashes, including new `numbers.ts`. Old source observations were not regenerated.
Capture-time script/source hashes remain historical, even where a capture
script subsequently gained a separate additive mode. Replay checks the pinned
binary and unchanged native outcomes; it does not claim current sources equal
the deliberately pre-fix source hashes.

### Acceptance and exact reproduction

Run from `/Users/kjopek/Workspace/safe-bash`. Existing owned tests:

```sh
node --unhandled-rejections=strict --import tsx --test tests/commands/structured/*.test.ts tests/commands/structured-stress/*.test.ts
```

**684/684 pass**, including the seven formerly failing tests with obsolete
numeric assumptions. Changes to those tests are backed by native evidence:
join's three numeric policy overrides now use its already frozen native stdout;
the stream test uses frozen `1e2` decimal normalization; `1e9999` is no longer
classified as malformed or a compile error. The preflight test still exercises
an invalid numeric literal (`1e+`). Existing non-JSON NaN/Infinity-token,
Unicode and division-by-zero rejection tests remain. Large exponent/conversion
and arithmetic overflow expectations come from the additive native captures,
not from product output. No old frozen fixture files were edited.

Focused regression/safety acceptance is separate from full raw comparisons:

```sh
node --unhandled-rejections=strict --import tsx --test tests/commands/structured-stress/independent-increment/numeric-fixes.test.ts tests/commands/structured-stress/independent-increment/numeric-safety.test.ts tests/commands/structured-stress/independent-increment/quantifier-fixes.test.ts tests/commands/structured-stress/independent-increment/safety.test.ts
```

**202/202 pass**: numeric 129 (124 valid native rows, explicit scope count,
four all-split tests), numeric safety 15, quantifier 30, and phase-one safety 28.
Ten strict-rejection repetitions of the two safety files pass **430/430**:

```sh
for round in {1..10}; do
  node --unhandled-rejections=strict --import tsx --test tests/commands/structured-stress/independent-increment/safety.test.ts tests/commands/structured-stress/independent-increment/numeric-safety.test.ts || break
done
```

Fresh **owned-scope typechecking passes**:

```sh
node_modules/.bin/tsc --noEmit --target ES2023 --lib ES2023 --module NodeNext --moduleResolution NodeNext --strict --noUncheckedIndexedAccess --exactOptionalPropertyTypes --verbatimModuleSyntax --forceConsistentCasingInFileNames --skipLibCheck --types node src/commands/structured/*.ts tests/commands/structured/*.ts tests/commands/structured-stress/*.ts tests/commands/structured-stress/independent-increment/*.ts
```

Replay every native fixture without overwriting captures:

```sh
node tests/commands/structured-stress/independent-increment/native.mjs --verify
node tests/commands/structured-stress/independent-increment/supplement.mjs --verify
node tests/commands/structured-stress/independent-increment/phase2-native.mjs --verify
node tests/commands/structured-stress/independent-increment/phase2-native.mjs --extra-verify
node tests/commands/structured-stress/independent-increment/verify-exponents.mjs
node tests/commands/structured-stress/independent-increment/verify-exponents.mjs --overflow
```

All six pass against jq-1.7.1-apple. Full reports and deliberately red gates:

```sh
node --import tsx tests/commands/structured-stress/independent-increment/phase2-report.ts
node --import tsx tests/commands/structured-stress/independent-increment/diagnose.ts
node --unhandled-rejections=strict --import tsx --test tests/commands/structured-stress/independent-increment/native-regressions.test.ts
node --unhandled-rejections=strict --import tsx --test tests/commands/structured-stress/independent-increment/additive-regressions.test.ts
```

No bare `node --test`, global suite, global build, or other worker cleanup was
run in phase two. Raw gate exit 1 is expected and is reported, not suppressed
inside the tests. `phase2-report.ts` is a diagnostic report, not a green gate.

### Numeric hazards and remaining compatibility proposal

The new coefficient representation never expands a power of ten. Exponent
normalization, coefficient parsing, comparison and serialization are bounded
by existing byte/step quotas; repeated hidden numeric rendering is charged,
not merely emitted output. Tests cover output/value boundaries, metadata not
counting as an object, result-prefix quotas, 100,000-digit rejection, long
near-equal coefficients, huge exponent text, CPU and rendering cancellation,
blocked decimal-token reads, blocked join writes and observed late rejections.
Hazard subprocesses use literal Node argv, a 128 MiB V8 heap, five-second kill
deadline and 65,536-byte output cap. Host/input allocations and individual
bounded synchronous operations are not forcibly preempted; limits are not
exact resident-memory accounting. No arbitrary-precision arithmetic claim.

Primary research and implementation details are in the source README's decimal
section: jq 1.7 manual and the official jq-1.7.1 source tag, not secondary
compatibility summaries. The 17-digit decimal-to-double step and formatting
thresholds are build-specific. Exhaustive binary64 rendering, every decimal
context rounding boundary, modulo edge behavior, nonstandard numeric tokens,
other builds and broad grammar remain unverified or outside this delivered
increment; they are not silently labeled compatible.

**Proposed, not implemented:** improve standard jq Unicode repair and per-input
filter-error recovery. Neither existing strict UTF-8 nor stop-first-error was a
user-requested feature. Unicode work must match replacement grouping (including
the frozen surrogate bytes), JSON escape asymmetry and per-file decoder resets,
while charging raw input plus repaired/escaped value sizes and yielding safely.
A plain nonfatal TextDecoder is insufficient. Recovery must continue only
ordinary filter errors after preserving already-written output; parse errors,
limits, abort, EPIPE and host failures remain fatal. Freeze a dedicated status
aggregation matrix before changing `-e`/empty/final-error behavior and introduce
an approved bounded aggregate diagnostic policy to prevent stderr amplification.
Any strict-mode option needs explicit approval, not an invented current API.

The remaining original red groups are Unicode (17), recovery (10), diagnostic
formatting (7), recovery propagated through a pipeline (1), and the three
malformed frozen fixtures. Additive diagnostics add four more red rows. This is
not full jq parity, universal shell support, scope completion, 72 hours of work,
or superiority to jq/just-bash. Root must assign a **different independent final
verifier**; this author checkpoint does not replace that gate.

## Literal split integration checkpoint (August 26, 2026)

The numeric author's completion marker was read before changing shared files.
The independent preparation helper and its 69 frozen native cases are now wired
through `split: [1]` and lazy separator evaluation. No grammar, two-argument regex
overload, plugin API, runtime dependency, numeric source or frozen numeric vector
changed. The original split `baseline.json` is also unchanged.

| Fresh scope | Pass / total | Interpretation |
| --- | ---: | --- |
| Native jq-1.7.1-apple replay | 69 / 69 | Exact native stdout, stderr and status recapture |
| Split helper | 67 / 67 | Native direct operands plus bounds/cancellation |
| Split command | 81 / 81 | 69 native stdout/status cases and 12 safety/arity cases |
| Six-backend split interop | 6 / 6 | Stdin, named files, persisted/reopened pipeline output |
| Existing author suite | 684 / 684 | One stale unsupported-split assertion updated to split/2 |
| Existing numeric/quantifier regressions | 202 / 202 | No numeric tests or expectations changed |
| Original 6a259ff matrix assertions | 71 / 79 | Split fixed; eight external diagnostic mismatches remain |
| Revised live matrix, exact README command | 79 / 79 | Other worker changed eight diagnostic expectations |
| Original/additive raw numeric gates | 196 / 238 | Existing 42 failures remain; no acceptance relabeling |

Split's full product-byte comparison is **44 exact / 25 diagnostic-only / zero
stdout-status differences**. Command assertions preserve the existing virtual
diagnostic contract rather than calling all 69 cases exact-native matches.
The eight extra command tests cover rejected zero/two-argument arities before
input acquisition, cancellation during three kinds of work, blocked output with
late rejection, and unsuppressible step/value limits. The initial four safety
cases and all native expectations remain unchanged.

Actual common-flow reproduction through the aggregate plugin:

```text
jq -R -s 'split("\n") | map(select(length > 0))'
stdin: alpha\nbeta\n
stdout: [\n  "alpha",\n  "beta"\n]\n
exit: 0
```

The six-backend tests additionally pipe `cat old.txt` through that filter into
`split-lines.json`, reopen it with jq, and persist/reopen the TODO coding flow
`find | xargs rg | sed | awk | jq` using split rather than a two-jq workaround.

```sh
node --import tsx tests/commands/structured-stress/split-increment/capture-native.ts
node --import tsx tests/commands/structured-stress/split-increment/verify.ts
node --unhandled-rejections=strict --import tsx --test --test-reporter=tap tests/integration/adapter-tools/matrix.test.ts
node --import tsx tests/commands/structured-stress/split-increment/replay-original-matrix.ts
```

The last command deliberately exits 1 for the original matrix's six missing
ENOENT and two missing EROFS tokens. Concurrent commit
`d0fed8fb1b54ae7be4dadc1332750314d9bb108d` replaced those eight assertions in the
live matrix. **79/79 is not an unchanged-6a259ff pass.** This worker edited no
matrix, adapter or shell file. Root/Poincare must own the diagnostic-contract
decision; do not attribute expectation changes to split or silently drop the
original failures. Details and exact failing shell commands are in
`split-increment/README.md` and `original-matrix.json`.

`delivery.json` records live-suite TAP, before/after hashes and stable HEAD
`9e905738e9b71a7a91a7f868a1716c618c9b7ec5`. The original-assertion replay and
final 684/684 run used HEAD `b4033fb96b353bf82025a28aafff6619066967dc` with the
uncommitted split patch. Structured-scope strict TypeScript (including all split
scripts) and the matrix README's scoped TypeScript command pass. All four
original numeric evidence hashes still match the preceding checkpoint; split
native SHA-256 remains
`cdee2e3a38d929e66d8fdf3917bed62ea46ccff86091de0816128c38176bd8d3`.
No whole-repository acceptance, remote-provider coverage, 72-hour completion or
superiority claim follows. Root still assigns a different final verifier.
