# Independent final numeric / quantifier / split verification

August 26, 2026. This verifier did not author the implementation or previous
oracle corpora. **No new in-scope defect found in this bounded verification.**
This is an increment checkpoint, not broad jq/Bash parity, unchanged-original
matrix acceptance, superiority, a clean release gate, or 72 hours of work.

The split completion report was read before final product checks or committing.
Reviewed commits: `62315bc7703330088b0b0466619b3a5a00028bdf`,
`e9b30e18e6d03a8fe1ee27b131f8669ab62c0485`,
`79cecde3dfcaeae2e6413ce0fd6bfdb31acf5246`,
`53568913b866847697dcb41b2388081d1aa15313`,
`73ed8538b758a2501e4f5558ea2f63b531ae5a7d`, and
`4f9ce1ee77fdb8ebffe5b4a359656b814f07b1da`. All their changed paths are in the
three approved structured trees. This verifier changes only `final-increment/`:
no product source, existing tests/expectations, matrix, adapter, shell, root
files, shared README, or foreign index entries are changed.

`verification.json` records the exact tested HEAD before/after, all nine
structured source SHA-256 values, a full TypeScript runtime-tree hash, dirty
source paths, author completion report, commands, counts, and mismatch IDs.
Both structured hashes and the complete runtime hash stay equal across the
recorded final run. Foreign uncommitted source remains explicitly visible;
the HEAD alone is not a complete description of that working tree.

The recorded run starts at `dda178205fa7fd59680f7747b9dd8b0880f2ab6d` and ends
at `a59dbe56ada690ab08530af566f5b7a505506f9b`; the intervening commit changes
unrelated diff tests, not runtime source. Runtime-tree SHA-256 is
`add339346cb78f4c484f2659c7df5319d9c68b94ced9435906474e76d9ac3f8a`.
An earlier recording attempt rejected concurrent runtime edits and was rerun;
its results were not recorded as a stable checkpoint.

After verification commit `224fc654e7f00ded052cc4f3b609784b0ce2bdaf`, foreign
diff/patch runtime edits changed the full-tree hash, not structured source.
`post-checkpoint.json` preserves the original record and identifies those files.
At that exact HEAD, affected checks were rerun with a stable new runtime hash:
live matrix **79/79**, pinned matrix **71/79**, fresh comparisons/backend tests
**65/65**. No later whole-repository or full numeric-suite rerun is implied.

## Results and denominators

| Product comparison | Cases | Native fixture calls | Exact stdout/stderr/status | Stdout/status parity | Stdout or status differs | Diagnostic-only |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Complete original | 155 | 160 | 117 | 125 | 30 | 8 |
| Complete additive | 81 | 81 | 77 | 81 | 0 | 4 |
| Split corpus | 69 | 69 | 44 | 69 | 0 | 25 |
| Fresh independent common flows | 29 | 29 | 29 | 29 | 0 | 0 |

All three malformed original fixtures remain counted: `fromjson`, `join-mixed`,
and `join-mixed:bytewise`. They contribute two stdout/status differences and
one diagnostic-only difference; they are not valid-input feature failures.
Original field-level differences are status **27**, stdout **27**, stderr
**38**; these overlap and must not be added as cases. Additive field differences
are status **0**, stdout **0**, stderr **4**. Split's 25 differences are stderr
only. Exact comparison never ignores diagnostics or removes malformed rows.

Remaining original categories: Unicode repair **17**, per-input recovery **10**,
recovery propagated through a pipeline **1**, diagnostic formatting **7**, and
malformed fixtures **3**. Additive adds **4** diagnostic-only rows. All original
21 quantifier rows and 53 valid numeric rows match exact bytes. No new failure
was converted into a policy exception or an unsupported-feature classification.

| Check | Passed / tests | Exit |
| --- | ---: | ---: |
| Original structured suites | 684 / 684 | 0 |
| Focused numeric / quantifier / safety | 202 / 202 | 0 |
| Ten strict-rejection safety repetitions | 430 / 430 | 0 |
| Split helper / command / interop | 67 + 81 + 6 = 154 / 154 | 0 |
| Fresh whole/bytewise comparisons plus integrity | 59 / 59 | 0 |
| Fresh six-backend numeric/split flows | 6 / 6 | 0 |
| Original raw gate, including integrity test | 118 / 156 | 1 |
| Additive raw gate, including integrity test | 78 / 82 | 1 |
| Current live adapter matrix | 79 / 79 | 0 |
| Original `6a259ff` adapter matrix | 71 / 79 | 1 |

All scoped typechecking passes. All test groups have zero cancelled, skipped,
or TODO cases. Before split finished, the original suite temporarily showed
683/684 because an existing test still rejected split/1. The split author's
commit replaces that assertion with unsupported split/2; final runs show 684/684.
That transient result was not hidden or treated as final acceptance.

Native replay uses `/usr/bin/jq`, `jq-1.7.1-apple`, build configuration
`--with-oniguruma=builtin`, executable SHA-256
`1625910a3f99fbd11c3ad58cc16ebc359507e6e19c21e91d8ab7da2116c8429f`.
The explicit reference-replay steps, excluding native calls embedded in test
suites and repeated runs, check:

- 508 exact-byte frozen rows: 155 original + 81 additive + 69 split + 74 raw
  input + 129 join; **513 fixture calls and two metadata calls**.
- 240 older stdout/status references, without claiming exact stderr:
  **240 fixture calls and one metadata call**.
- 29 fresh exact-byte rows: **29 fixture calls and two metadata calls**.

These total 777 reference rows / 782 fixture calls / five metadata calls per
explicit replay set, not 777 unique language behaviors. The original 155 rows
represent 126 logical probes; their bytewise variants stay in the denominator.
Native processes receive literal argv and bounded input, no shell, controlled
locale, a two-second deadline and 65,536-byte capture cap. Native pipelines
replay each stage separately and concatenate stderr; product pipelines are real
virtual pipelines. Native replay uses whole writes; product chunking is explicitly
whole/one-byte. Native OS read segmentation is not asserted.

## Independent choices and review

`fresh-native.json` was captured before any product comparison. Its 29 cases
cross integer precision, decimal scale, signed zero, computed formatting and
near-equal fractions with split/tonumber, JSON round trips, join, sorting,
grouping, object construction and quantifiers. Additional rows cover Unicode
code points/combining text/NUL, Unicode separators, empty input, overlapping
delimiters, separator generator order, raw line input and `-j` output. No new
grammar is introduced. Whole and one-byte product streams reproduce all 29.

Four of those frozen cases also run on memory, real, S3 mock, WebDAV mock, mount
and overlay: **24 backend/case combinations**, each as a named-file invocation
and a `cat | jq > file && cat` pipeline, **48 shell executions**. Stored bytes,
stdout, stderr, status and actual jq/cat dispatch are asserted. The author split
interop suite separately covers the larger find/xargs/rg/sed/awk/jq pipeline.

Targeted implementation inspection confirms:

- Parsed decimal coefficient/scale/exponent metadata is immutable and excluded
  from object handling. Input/filter/argjson/conversion paths preserve numeric
  identity; comparisons share coefficient comparison, with native-selected
  double fallback for mixed computed/literal values. Formatting and parsing
  charge existing work/value limits; they do not expand powers of ten.
- Object and generator quantifiers iterate lazily and short-circuit both
  generator and condition. Decimal objects do not become object-valued inputs.
- Split evaluates separator generators before helper type validation, preserving
  empty-generator behavior and error order. Empty separators iterate code points;
  nonempty separators use bounded nonoverlapping KMP scanning. Empty input,
  Unicode, NUL, types, optional errors and first/limit are covered by frozen rows.
- Split preprocessing/scanning yields through the shared budget; collection and
  aggregate value limits apply to materialized results. Output awaits writes
  before later separator errors. Cancellation, blocked reads/writes, quotas,
  chunk boundaries and late rejections are covered by the scoped safety suites.
- Product changes add no runtime dependency, subprocess invocation or eval.
  Process launching and the pinned-module loader exist only in verification.

Limits remain cooperative: bounded synchronous operations and host side effects
cannot be forcibly interrupted. Value/step quotas are not exact resident-memory
accounting; the split prefix table is proportional to separator UTF-16 length.
This sample is not exhaustive decimal rounding, binary64 formatting, exponent
boundary, modulo, other native build, or language coverage.

## Original matrix and handoff

The live matrix is **not unchanged from `6a259ff`**: another worker changed its
README, fixture and diagnostic assertions. Their current and original hashes
are recorded separately. No comparison was rewritten by this verifier.

`pinned-matrix.mjs` reads and SHA-checks all three original Git blobs. A test-only
Node load hook supplies the original matrix/fixture modules in memory after
removing TypeScript types, retaining original URLs, imports, behavior and every
assertion. No original or live file is overwritten. The exact README command is
run both normally and with that explicit loader environment, against current
runtime source. The independently implemented replay confirms **71/79**:

- Six backend missing-input-redirection checks expect `/ENOENT.*missing.txt/`;
  actual stderr is `shell: line 1: missing.txt: No such file or directory\n`.
- Readonly `printf 'changed' > target.txt` and `>> target.txt` expect `EROFS`;
  actual stderr is `shell: line 1: target.txt: Read-only file system\n`.

Each original writable backend is 10/11; readonly is 8/10. Both composition
checks and the formerly failing jq split case pass. Root/Poincare must reconcile
these eight diagnostic-contract failures with the shell owner; the revised live
79/79 must not be presented as original-matrix acceptance. Real S3 providers,
real WebDAV services and broader filesystem correctness are not established by
these local mocks. No out-of-scope backend edits are made here.

## Frozen integrity

All original evidence/observation files retain their exact expected SHA-256:

| File under `../independent-increment/` | SHA-256 |
| --- | --- |
| `native-vectors.json` | `924634ea7933a6b14be1295f65cd0f68485133975961572acab41fc307595a66` |
| `supplement-vectors.json` | `3989c0678c2e87a6efff2bee562438fc0d03dfdbf167c2329cfebf296e3f4ba2` |
| `phase1-observation.json` | `b1553f455aedaf709384b5c76d7571bca18f6bcc7ecdb0b4d752d5d1be12a238` |
| `supplement-observation.json` | `8b1f9ea12ae069704dc54e9c6fc42c962e62883631c3056c2e3fae1be7ee449f` |

Split `../split-increment/native.json` remains
`cdee2e3a38d929e66d8fdf3917bed62ea46ccff86091de0816128c38176bd8d3`.
Fresh `fresh-native.json` is independently pinned to
`2724f85ce5745706a96fb9c0052d84df2cabd28e00811eb9e42ad34be105a4ca`.
The four additive hashes and older raw/join hashes are in `verification.json`.

## Exact reproduction

From the repository root, with existing development dependencies installed:

```sh
node tests/commands/structured-stress/final-increment/native.mjs --replay
node tests/commands/structured-stress/final-increment/native.mjs --verify-fresh
node --import tsx tests/commands/structured-stress/verify-native.ts
node --unhandled-rejections=strict --import tsx --test --test-reporter=tap 'tests/commands/structured/*.test.ts' 'tests/commands/structured-stress/*.test.ts'
node --unhandled-rejections=strict --import tsx --test --test-reporter=tap tests/commands/structured-stress/independent-increment/numeric-fixes.test.ts tests/commands/structured-stress/independent-increment/quantifier-fixes.test.ts tests/commands/structured-stress/independent-increment/numeric-safety.test.ts tests/commands/structured-stress/independent-increment/safety.test.ts
node --unhandled-rejections=strict --import tsx --test --test-reporter=tap 'tests/commands/structured-stress/split-increment/*.test.ts' 'tests/commands/structured-stress/final-increment/*.test.ts'
node --unhandled-rejections=strict --import tsx --test --test-reporter=tap tests/commands/structured-stress/independent-increment/native-regressions.test.ts tests/commands/structured-stress/independent-increment/additive-regressions.test.ts
node --import tsx tests/commands/structured-stress/independent-increment/phase2-report.ts
node --import tsx tests/commands/structured-stress/final-increment/split-report.ts
node --unhandled-rejections=strict --import tsx --test --test-reporter=tap tests/integration/adapter-tools/matrix.test.ts
NODE_OPTIONS='--import=./tests/commands/structured-stress/final-increment/pinned-matrix.mjs' node --unhandled-rejections=strict --import tsx --test --test-reporter=tap tests/integration/adapter-tools/matrix.test.ts
node_modules/.bin/tsc --noEmit --target ES2023 --lib ES2023 --module NodeNext --moduleResolution NodeNext --strict --noUncheckedIndexedAccess --exactOptionalPropertyTypes --verbatimModuleSyntax --forceConsistentCasingInFileNames --skipLibCheck --types node src/commands/structured/*.ts tests/commands/structured/*.ts tests/commands/structured-stress/*.ts tests/commands/structured-stress/independent-increment/*.ts tests/commands/structured-stress/split-increment/*.ts tests/commands/structured-stress/final-increment/*.ts
```

Raw comparison gates and the pinned matrix intentionally exit 1. They are not
relaxed or skipped. `verify.mjs` runs these checks plus ten safety repetitions
with 90-second/4-MiB process caps, prints concise summaries and checks runtime
hash stability. It requires the author marker at
`/tmp/safe-bash-jq-split-integration-report.txt`; ordinary reruns do not rewrite
the recorded artifact. `--record` refuses to overwrite `verification.json`.
Its successful orchestration is **not** a green raw-parity gate. The native
`--freeze` mode also refuses to overwrite existing expectations.

## Remaining proposals, not changes

Strict UTF-8 rejection and stop-first-filter-error behavior remain intentional
implementation deviations, not user-required features or parity. Recommend
native-compatible replacement grouping and per-file decoder resets, plus
per-input recovery for ordinary filter errors while preserving already-written
output. Parse errors, quotas, cancellation, host failures and broken output pipes
must remain fatal. Freeze native status aggregation and bounded diagnostic rules
before implementing recovery. A nonfatal TextDecoder alone does not establish
native surrogate/replacement behavior. No new strict-mode API is invented here.
