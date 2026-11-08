# Independent quiet-postfix regression review

## Bounded verdict

Verification ran on August 27, 2026 UTC (August 26, America/Chicago).
This is evidence-only leaf work; no delegation or product edits.

| Cohort | Actual new execution | Historical evidence |
| --- | --- | --- |
| Current corrected scratch five | **5/5 exact** | Separate profile; does not rewrite old five |
| Original-profile five, same current source | **4/5 exact** | Original old-five **4/5** retained |
| Unchanged revised full acceptance | **3758/3758**, exit0 | Accepted revised **3758/3758** retained |
| Unchanged original full acceptance | **3750/3758**, exit1 | Original **3750/3758**, eight conflicts retained |

Each completed full run executes all **70 files / 17 suites**, with the exact
historical test-name/file/nesting census. Zero skips, cancellations or todos.
The two completed full runs contain **7516 test executions**, not one merged
acceptance denominator. An earlier incomplete-snapshot attempt is additionally
retained as **3 events: two native passes and one file-loader failure**; it is
not a 3758-case run. See the capture defect section below.

Scoped revised70 `tsc --noEmit`: **exit0**. Isolated source build: **exit0**.
No whole-repository noEmit, table corpus, comparator performance, new tools,
SGID investigation, original30 or outside-contract overlay rerun was performed.

## Exact current inputs, not committed-HEAD validation

The source capture is actual working-tree bytes at HEAD
`954f2302e4b2f42f90cb5ffd5670d1936f47390c`, not a Git archive or a later HEAD.
Two-sided capture checks match live-before, copied and live-after bytes, and
the installed development dependencies are copied rather than linked back.

- Source inventory aggregate: `d8f5651ef44b39e42df5bdc8a627197479304c60eeb3fdc7b2f317bc00a2f64a`.
- Accepted patch commit: `96564fe99fdfb36392fbbb3afd1cf070cd608201`.
- `src/commands/diff-patch/patch.ts`: `72bfb60c502ac5bcaf2efa3e0f044b0ab1d89a54293f829d62f011e7c10e82d7`.
- Accepted stat commit: `386196bc39bedd61910abf42b044cab7a2a83cdc`.
- `src/commands/metadata/stat.ts`: `fab291cc4e5668526fc1247e155f5878e1235d9d95a5096d34bcfa9f022d7f3b`.

All captured files in both command-family source directories, not only the two
files above, match their respective accepted commits. They still match at final
archive inspection. `INPUT-MANIFEST.json` records every source/helper/fixture
SHA-256, dependency entry, exact commit identity and initial dirty status.
`EVIDENCE.json` preserves actual source and fixture bytes, not just hashes.

The live tree moved while tests ran. At archive HEAD
`5f151860a937fd5d085e46a9fd384c730345271f`, differences from the frozen source
were table-text README/comm/internal and S3 COMPARISON/SDK_COMPARISON docs.
`RESULT.json` records each before/after hash. No changed live source was pulled
into a running snapshot; results do not validate those later changes. Historical
fixtures, original tests and used benchmark helpers have no observed live drift.

## Corrected five: independent recapture and exact comparison

The corrected profile is Curie's
`d1b10a375a13f031f9f604a64395cd507f21a071`. The five current helpers actually used
are byte-identical to that commit:

| Helper under `benchmarks/expanded/` | SHA-256 |
| --- | --- |
| `native.mjs` | `14d0ac24733a6f4b84965c1dbb68e4108904bb3a52768ee03281e847fb490055` |
| `common.mjs` | `c07b1f7f3eec500591cab8dda06ed247be040aeeee1e085533371fea28c3d9fe` |
| `engine.mjs` | `c6744398ee47d8ba6e975deae2b694e4e9c641d400166ac639cf797b0b623323` |
| `recipes.mjs` | `0dc4535976308a3b44da7216507ffc26d1e44f4e52c53834652e756f27c2ca94` |
| `inventory.mjs` | `2c939cd53c1688247950900f56534882435861cd40bab713bd264cca512100bd` |

Corrected golden native JSON SHA-256:
`e305e1c3f3fa15e0f53699808c1cb20ea156c80b8ceff6d98835888ea5c57bb8`.
The separate old-profile replay uses exact helpers from `0294afb`, with all full
commit and helper hashes preserved. Neither profile changes a recipe.

| Exact existing recipe | Corrected | Original-profile current replay |
| --- | --- | --- |
| `command/patch/apply` | pass | pass |
| `command/patch/dry-run` | pass | namespace mismatch only |
| `command/patch/reverse` | pass | pass |
| `command/stat/timestamp` | pass | pass |
| `composition/patch-hash/patch-hash` | pass | pass |

Both profiles independently recapture native results: **5/5 match their own
frozen golden observations**. All ten current product rows match native stdout,
stderr and status exactly. `FIVE.json` preserves every recipe, base64 stdout and
stderr, status, complete recursively captured fixture namespace, registry/kernel
events and native observation; no fields are filtered to obtain equality.

The **only captured semantic profile delta** is the old native dry-run's empty
`/fixture/tmp` directory. The corrected native helper precreates scratch outside
the asserted fixture and projects it to `/tmp`; the virtual helper precreates
`/tmp` with `TMPDIR=/tmp`. Product captured output/effects do not change between
profiles. This is a harness setup correction, not product behavior that creates
`/fixture/tmp`. External scratch is outside the defined fixture capture in the
corrected profile; this is not a claim about every host filesystem path.

Native pins verified before/after use: GNU Bash5.3.0, GNU patch2.8 and GNU
coreutils9.7 stat/sha256sum. Exact executable paths, version stdout/stderr/status
and SHA-256 are in `FIVE.json`. Full acceptance also verifies GNU diff3.12 /
patch2.8 and the unchanged Apple calibration identities before and after runs.
Apple calibration is not relabeled as GNU parity.

## Full unchanged regression gate

Read-only original and revised drivers from expectation editor
`5ddce1b0550ad7de8f2a8082f0402fae7aa001b7` and independent reviewer
`5ce557d1ce7f8ca00c95a670ce3647409953db05` were inspected before execution.
All original70 test bytes match `4d4f5ca`; all original237 fixture/helper bytes
match the original manifest. No later `patch-quiet.test.ts` is smuggled into the
3758 denominator, and no original member is removed.

The unchanged `delta-v1.mjs` has SHA-256
`dab23166e15d2bc9bbb59ba0441ef7989221ff7e302a994a56c1a5ff5cfba8dc`.
Its existing three-file/eight-named-case expectation delta is applied only to a
separate temporary revised copy. Original assertions and the accepted revised
assertions are not edited. Historical independent native preparation is passed
unchanged to its proof binding. Both original and revised files' hashes,
the exact assertions and evidence-record hashes are retained in `FULL.json`.

`full.mjs` executes the existing 17-suite ordering, unchanged guard and JSONL
reporter with strict rejection handling and `--test-concurrency=1`. Every raw
TAP total is cross-checked against reporter pass/fail events and the historical
name census. Source, fixtures and dependencies are checked before/after each
suite. Existing local backend coverage and native controls run without filters
or capability skips. The eight original failures are verified to be precisely
the accepted original conflicts, not new failures hidden by the total.

The prior wrapper executables themselves are not invoked: their hard-coded old
ownership paths and pre-quiet source equality assertions are inappropriate for
this new leaf scope. This review transcribes their execution/census orchestration
into an owned driver; test files, GNU pins, reporter, import guard and accepted
delta are unchanged. No matching-helper fallback was needed.

## Retained verifier capture defect

The first snapshot accidentally omitted the transitive top-level benchmark
helpers used by the unchanged absolute-target suite. Its exact loader error was
`ERR_MODULE_NOT_FOUND` for snapshot `benchmarks/session.js`, imported by
`absolute-target/absolute-target.test.ts`. This was **our capture defect**, not
a product regression or changed dependency API. Immediate status was published
before any capture correction; raw TAP, JSONL, stderr and commands remain under
the archive's `initial-attempt/` namespace.

The failed snapshot was left intact. `complete-capture.mjs` adds seven unchanged
current files to a fresh copy: session, plugin-fixtures, model, worker-bootstrap,
worker, engines and probes. Each added file is also byte-identical to `5ce557d`.
Source and installed dependency bytes remain identical to the original freeze.
No helper was patched, downgraded, replaced by a historical alternative or
silently substituted. Both complete cohorts then ran successfully as reported.

## Commands and validation

Executed from the repository root, in order:

```text
node tests/commands/diff-patch-stress/quiet-postfix-review/freeze.mjs
node tests/commands/diff-patch-stress/quiet-postfix-review/five.mjs
node tests/commands/diff-patch-stress/quiet-postfix-review/full.mjs
node tests/commands/diff-patch-stress/quiet-postfix-review/complete-capture.mjs
node tests/commands/diff-patch-stress/quiet-postfix-review/full.mjs
node tests/commands/diff-patch-stress/quiet-postfix-review/validate.mjs
node tests/commands/diff-patch-stress/quiet-postfix-review/archive.mjs
```

The first `full.mjs` is the retained capture failure, not a passing run.
The actual snapshot cwd, complete argv and relevant environment for every
child command are archived. The run scripts use a task-owned fixed `/tmp`
location marker and are an execution record, not overwrite-safe rerun commands.
Replay in a fresh task-owned location rather than overwriting these artifacts.

Validation uses the unchanged historical import guard and installed
TypeScript5.9.3 / tsx4.23.12 / @types/node22.20.1 on Node22.22.2. Scoped config
lists exactly the revised70 original files. Build uses existing
`tsconfig.build.json` with only `--outDir` redirected to the owned temporary
`complete-capture/build-output`; **no emission in live source, tests or root
dist**. Exact commands, empty diagnostic logs, configuration and all output
hashes are in `VALIDATION.json`. Build output aggregate:
`203189fd7f3a8fe8d27282b1f98c35eb841872c511365644432dc339819b7d14`.

## Archive, ownership and limits

`EVIDENCE.json` contains **788** individually SHA-256-verified gzip/base64 text
members: actual sources/fixtures/helpers, native evidence/manifests, raw logs,
censuses, commands and both failed/completed run records. No native executable,
large native fixture tree, node_modules binary or generated build tree is
committed. `ARCHIVE-CHECK.json` verifies every decompressed member. Inspect with:

```text
node tests/commands/diff-patch-stress/quiet-postfix-review/read-evidence.mjs
node tests/commands/diff-patch-stress/quiet-postfix-review/read-evidence.mjs complete-replay/full-native-pins.json
```

All changes are new files under this review directory and uniquely owned `/tmp`
artifacts. Production, existing tests, benchmarks/Curie files and old evidence
were read-only. Unattributed `.native-bvNFwI` and other live native artifacts were
not accessed or removed. No dependencies were added. Both owned engine child
processes close by IPC disconnect with code0/signalnull; suite/compiler processes
return with signalnull, including expected original-suite status1. No SIGSTOP
or other signals were sent by the verifier. Existing suite worker lifecycle is
unchanged.

Frozen eighteen failures remain immutable, SHA-256
`7b3e12c268508916424e6647aaa06b9d94530a096bf7d36d39052cda6b512fbf`.
This checkpoint does not claim original-green acceptance, SGID resolution,
remote adapter support, outside-contract overlay resolution, whole-product
compatibility, complete option coverage, superiority, or 72 hours of work.
S3/WebDAV unsupported observations and historical outside-contract overlay0/3
remain unchanged. No table corpus runs or table-source edits were performed.
