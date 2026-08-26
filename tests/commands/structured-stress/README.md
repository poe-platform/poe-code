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
