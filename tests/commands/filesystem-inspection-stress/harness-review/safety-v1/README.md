# Six presealed independent safety cases

Preparation only. **Product executions: zero. Native-oracle executions: zero.**
No current tree/file author-fix source was read. The only product source reads
used old frozen APIs at `d168d18b118592e04a6eec9b00eb50cc2b1e5058`.
Inputs and semantic expectations were sealed on August 27, 2026 before any
new-source inspection; subsequent v2 reads concern harness corrections only.
The root disclosed author progress, but no author test cases or new source
implementation informed these inputs. This is not source-safety acceptance.

## Always-runnable preparation checks

From the repository root, without installs, product imports, or product children:

```sh
node tests/commands/filesystem-inspection-stress/harness-review/safety-v1/seal.mjs --check
node tests/commands/filesystem-inspection-stress/harness-review/safety-v1/run.mjs --check
node --test tests/commands/filesystem-inspection-stress/harness-review/safety-v1/selfcheck.test.mjs
```

`PRESEAL.json` binds `cases.mjs`, `seal.mjs`, and `sealed-cases.json`; `--create`
uses exclusive writes and refuses to overwrite an existing seal. Do not rerun
creation or silently rewrite a chosen input after reading new source. Preserve
this seal if a later independently justified additive revision is authorized.
`run --check` reports canonical per-case hashes, fixture sizes, exact caps and
the runtime helper identity. `PREPARATION.json` and `selfcheck.tap` record the
final preparation checks. Ten checks exercise only fixtures/oracles/mocks/gates,
not six product passes. Helpers use Node builtins and need no dependencies.

## Fixed cohort

All cases use the actual frozen `Shell.exec`, one explicitly registered family
command, literal quoted argv, a readonly fixture VFS, and awaited byte sinks.
Streaming file cases use an actual producer supplied through `readStream`;
readFile fallback, mutation, unexpected fixture paths and extra invocations fail.
Default command aggregates and root exports are not modified or exercised.

| ID | Sealed input | Expected safety/semantic outcome |
| --- | --- | --- |
| T-empty-many | 255 pipes in `-I`; 64 unique128-byte file names | Exact complete tree output, zero exclusions; normalization proof required; maxSteps262144 permits genuinely eliminated work |
| T-DP-cumulative | Eight `*a` pairs then `z`; 64 unique128-byte names ending `q`; maxSteps4096 | Cumulative noneliminated filter-work EFBIG before output/child stat; a suffix optimization invalidates the chosen stress and must yield HOLD/unexercised |
| T-sort-many | 64 unique512-byte common-prefix names in deterministic permuted order; alternating empty dirs/files; `--dirsfirst`; maxSteps4096 | Work-limit rejection before output under explicit compared-byte accounting; static proof covers both sort passes |
| F-JSON-cumulative | Eight8190-byte operands:8189 spaces plus `[`; 1-KiB producer chunks; maxSteps16384 | First conservative ASCII classification, then cumulative step-limit failure after at least two distinct reads, not reset per operand |
| F-header-many | 32 ×512-byte PDF/tar/PE/SQLite near-miss specimens; 128-byte chunks | All32 bounded complete reads and classification records; raw labels are characterizations, not format/native/security certification |
| F-metadata-many | 32 links, each4096 U+0001 target codepoints; output4096 | First oversized escaped line fails admission; empty stdout or exact bounded prefix; no content reads; static pre-expansion/cumulative proof required |

Sealed limits are explicit, not claims about defaults. File family duration is
configured4000ms inside the5000ms outer stop cap, not a performance assertion.
Header fixtures contain29 distinct byte payloads over32 distinct paths: three
PDF variants repeat. Repetition is retained and useful for many-entry accounting;
it is not reported as32 unique format samples. Total header bytes remain16384.
The metadata case stops at the first oversized line: it dynamically exercises
pre-admission, not32 successful metadata transformations. The cumulative policy
requires source proof. The low sort cap exercises the first sort; second-pass
accounting likewise requires source proof rather than an invented runtime pass.

## Fail-closed execution gate — NOT AUTHORIZED YET

No product execution command below was run. Root must provide a separate,
hash-addressed final-source authorization and a compiled, isolated frozen `/tmp`
snapshot. No source build, dependency installation or live-tree import happens
inside this runner. Missing/incorrect authorization fails before child creation.

```sh
node tests/commands/filesystem-inspection-stress/harness-review/safety-v1/run.mjs --execute /tmp/ROOT-AUTH.json AUTH_SHA256 /tmp/FRESH-OWNED-RUN
```

Authorization is JSON with these required fields:

- `approval`: exact `ROOT_FINAL_SOURCE_FREEZE_EXECUTION_AUTHORIZED`.
- `presealSha256` and `harnessSha256`: exact identities from `run --check`.
- `sourceCommit`: final40-hex commit; `snapshot`: absolute frozen `/tmp` path.
- `cases`: all six IDs in sealed order, with no additions.
- `files`: every permitted snapshot file as `{path, sha256}`; relative paths,
  no symlink redirection. Include compiled modules and source cited by proofs.
- `entrypoints`: `shell`, `contracts`, `tree`, `file`, each a hashed compiled
  `.js` path. Their inspected APIs are `Shell`, `FsError`, `createTreeCommand`,
  `createFileCommand`; this is internal-snapshot use, not new public integration.
- `proofs`: the six keys named in `PREPARATION.json`, each with `status`,
  `sourceCommit`, nonempty `basis`, and `files` pointing at hashed frozen source.

An `approved` proof must additionally satisfy:

| Proof | Required evidence fields |
| --- | --- |
| emptyNormalization | `emptyAlternativesNormalized: true` |
| dpNonEliminated | `singleEntryMaximumWork` positive and ≤4096, `invocationMinimumWork` >4096, `perOperandReset: false`, `patternEvaluationEliminated: false`, `rejectingPhase: "filter-before-sort"` |
| sortByteCost | `comparedByteCostMetered: true`, `bothSortPassesMetered: true`, `minimumComparisonByteWork` >4096 |
| jsonCumulative | `singleEntryMaximumWork` positive and ≤16384, `twoEntryMinimumWork` >16384, `invocationMinimumWork` >16384, `perOperandReset: false` |
| headerBounds | `offsetsBoundedBySample: true` |
| textPreAdmission | `textAdmittedBeforeExpansion: true`, `cumulativeAccounting: true` |

These are trusted root review attestations, not automatic proof generation.
Their bases must substantiate byte/work costs from the actual frozen source.
Single-entry bounds include startup/argument/metadata work, not only the inner
scan. The JSON two-entry lower bound must substantiate the sealed one-line prefix.
Use `status: "invalidated"` with a concrete basis if optimization or changed
accounting invalidates a sealed premise. The runner records HOLD with zero
invocations for that row; it never recasts missing stress as success. In
particular, do not use a later sort failure to pretend T-DP exercised its matcher,
or a single-operand failure to pretend F-JSON exercised cumulative scanning.

## Containment and reporting

- At most one owned child at a time and six total starts; no retries.
- Parent hard wall stop5000ms per child and30000ms across the execution batch.
  Only the owned child PID is killed; parent waits for its close before continuing.
- `--max-heap-size=128`; child verifies the main V8 heap limit before product
  import. A builtins-only Node22.22.2 check observed134217728 bytes. Observed
  RSS above256MiB triggers stop. RSS is
  cooperatively sampled by the child every10ms, not a hard native-memory sandbox
  or proof of peak RSS during an event-loop stall. The independent parent wall
  watchdog still applies. No `ps`, native helper or monitoring service is used.
- Combined product stdout/stderr and transport capture capped64KiB; bounded
  telemetry/IPC records, exact product output retained as base64 and decoded text.
- Snapshot hashes rechecked; loader refuses unlisted file-backed modules,
  package resolution and product host-FS/process/network/worker imports. This
  guard is not a JavaScript sandbox. A legitimate snapshot dependency conflict
  requires harness/root adjudication, not an unrelated source rewrite.
- Child records actual command-start signals and exact literal argv; always
  awaits `Shell.dispose` before a completed report. No worker API is added to
  product. Existing shared runtime cleanup remains the candidate's responsibility.
- Failed/killed children retain raw logs and unknown incomplete effects; absence
  of a final report is not claimed as zero product effects. No temp cleanup,
  broad staging, commits, live-source imports, native oracle or network use.

The controller and loader are syntax/static checked but have not launched a
product child. Cap enforcement has not been advertised as empirically exercised.
No arbitrary elapsed-time success assertion or superiority/parity score exists.
Root authorization after final source freeze is the next required boundary.
