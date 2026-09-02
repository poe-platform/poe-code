# Shell streams/I/O test cohort

## Current disposition: prior 12-file readiness withdrawn

Socrates identified active filename consumers missed by the discovery-rooted
audit. The earlier zero-consumer statements apply only to that incomplete audit
and do not establish safety of the 12-file rename. Earlier timing/test evidence
is retained as experiment history, not approval to ship the 12-file aggregate.

Restore these seven source-bound owners, byte-identically, as standalone tests:
descriptor-inheritance, descriptor-moves, file-shortcut, fs-error-diagnostics,
output-accounting, stdin-origin, streaming. Do not rewrite any verifier, recorder,
tsconfig, sealed manifest or historical evidence. The reduced candidate contains
only bom-capture, here-string, pipeline-effects, read-fields and read-options
(89 registrations); the seven standalone owners retain 130 registrations.
The revised five-file candidate is qualified for parent/reference review: 89
aggregate cases plus 130 standalone cases, with a measured 25.69% full-scope
reduction. See the reduced qualification immediately below. Earlier 12-file
readiness claims remain withdrawn. Language and Russell ownership are untouched.

## Reduced five-file qualification: current review candidate

This section supersedes every readiness, path-layout and timing claim for the
12-file aggregate retained below. Socrates' review was correct: the previous
consumer audit started from discovered tests and scripts and only followed a
limited set of relative references. It missed standalone verification entrypoints
and non-discovered project configurations. Passing tests and unchanged body hashes
did not establish preservation of those active routes. The 12-file candidate was
not safe to ship. No verifier is declared retired to justify a rename.

### Resolution without evidence edits

Seven original .test.ts owners are restored byte-identically. Their .cases.ts
copies are absent, and the aggregate does not import them. Thus their original
per-file process isolation and source-bound paths remain intact. No compatibility
wrappers, duplicate registrations, runner exclusions or consumer-path rewrites
were introduced. No narrow approval to edit consumers was needed or exercised.

The final net patch is **five unchanged-body renames + one five-import aggregate +
this plan**. The seven restorations undo only this worker's pending renames; they
do not revert another engineer's changes. Language frozen files, Russell's scope,
cleanup cohort 3, production, helpers and the frozen benchmark checkout remain
untouched by this revision.

| Original path | Final path | Disposition | Cases | Original/final SHA-256 |
| --- | --- | --- | ---: | --- |
| `packages/safe-bash/tests/shell/bom-capture.test.ts` | `packages/safe-bash/tests/shell/bom-capture.cases.ts` | renamed into five-file aggregate | 64 | `d5433e05d3bf3b13399aac376c64471c2338f9fc5c87e6bbc6743cb571e5dcfb` |
| `packages/safe-bash/tests/shell/descriptor-inheritance.test.ts` | `packages/safe-bash/tests/shell/descriptor-inheritance.test.ts` | restored standalone; no net body/path change | 1 | `7ba6eb5cb1701b4d284b45ca4fdee81b31403042fca23ec55dcd95703f29f57e` |
| `packages/safe-bash/tests/shell/descriptor-moves.test.ts` | `packages/safe-bash/tests/shell/descriptor-moves.test.ts` | restored standalone; no net body/path change | 5 | `b229c92117b6271a3e6d0b6cb26b3ec616c353c88c328c7ebe4709c557a69318` |
| `packages/safe-bash/tests/shell/file-shortcut.test.ts` | `packages/safe-bash/tests/shell/file-shortcut.test.ts` | restored standalone; no net body/path change | 6 | `b868f39555ea38cb6912bd91cbdf7d9ef625cb8810dc6893f1642aa96aa6262e` |
| `packages/safe-bash/tests/shell/fs-error-diagnostics.test.ts` | `packages/safe-bash/tests/shell/fs-error-diagnostics.test.ts` | restored standalone; no net body/path change | 20 | `5ac1508bc8416b6de0824577dab5ae518fad28bbf05f7c2e9fd5bc01c05befea` |
| `packages/safe-bash/tests/shell/here-string.test.ts` | `packages/safe-bash/tests/shell/here-string.cases.ts` | renamed into five-file aggregate | 14 | `32b9180a7d0ec6b898c62bfec4afa4f38cfc41a70d07ff3038b3e1cb72efe818` |
| `packages/safe-bash/tests/shell/output-accounting.test.ts` | `packages/safe-bash/tests/shell/output-accounting.test.ts` | restored standalone; no net body/path change | 28 | `6705878fb8b7c1394e0d31b18ba200c90de341d2c7d9b11f7aae1ff882972778` |
| `packages/safe-bash/tests/shell/pipeline-effects.test.ts` | `packages/safe-bash/tests/shell/pipeline-effects.cases.ts` | renamed into five-file aggregate | 2 | `90c9303b602ab190e0216c33a07744632c6d7d9176639f4b90375d7a5907e66e` |
| `packages/safe-bash/tests/shell/read-fields.test.ts` | `packages/safe-bash/tests/shell/read-fields.cases.ts` | renamed into five-file aggregate | 1 | `326e0863985e82ab214dbcf332d4974f13a356ff856b17b9c0e2d45adcb8cc4b` |
| `packages/safe-bash/tests/shell/read-options.test.ts` | `packages/safe-bash/tests/shell/read-options.cases.ts` | renamed into five-file aggregate | 8 | `e2c43a78caef38be8bd88197ebb12293609ffe4ea368d350eeafd25ab09709df` |
| `packages/safe-bash/tests/shell/stdin-origin.test.ts` | `packages/safe-bash/tests/shell/stdin-origin.test.ts` | restored standalone; no net body/path change | 62 | `02c14713e81afb384913aeb84703a7551aabab3f941570d5a9ae36cc47b3a585` |
| `packages/safe-bash/tests/shell/streaming.test.ts` | `packages/safe-bash/tests/shell/streaming.test.ts` | restored standalone; no net body/path change | 8 | `cfd61d72b7b7a33081e43c5f96dbe7c1161e27e72d6057489394283608ffe585` |

Aggregate: packages/safe-bash/tests/shell/shell-io.test.ts, SHA-256
`d4af85bd93dba920ada15565f594ab40b3622f027406b6218ca062ca622f9e6d`. Its only imports, in order, are
bom-capture.cases.js, here-string.cases.js, pipeline-effects.cases.js,
read-fields.cases.js and read-options.cases.js.

Coverage: **89 registrations / 89 unique names in the aggregate**;
**130 registrations / 128 unique names in seven standalone files**;
**219 registrations / 217 unique names across the original I/O scope**.
The existing three-way stdin-origin duplicate remains untouched. Full discovery
has eight I/O entrypoints instead of twelve, saving four startup processes. Only
the five grouped modules change from per-file to per-family process isolation.

### Active consumers preserved

The following eight reported source/config files were inspected, not executed or
modified. Every listed I/O reference now resolves to its original byte-identical
standalone owner. The TypeScript parser independently confirmed that the
byte-ownership fix project includes the restored streaming.test.ts with no
configuration parse diagnostics.

| Consumer (package-relative) | I/O path references and lines | Untouched SHA-256 |
| --- | --- | --- |
| `tests/shell/output-accounting-verify.mjs` | `output-accounting.test.ts` at 24 | `02e7f533abccfac430fd9f565fc138e0d8b51a9b34f7001faa7ec3a6100cb0b9` |
| `tests/shell/substring-verify.mjs` | `file-shortcut.test.ts` at 13 | `3119d228e0ca9848dd4c913fbdacff2bb66c9854761dab482d49cf874da643f3` |
| `tests/shell/diagnostic-context-verify.mjs` | `descriptor-inheritance.test.ts` at 13; `descriptor-moves.test.ts` at 13; `fs-error-diagnostics.test.ts` at 13 | `af50bff437b88ef73cebcd730e092a3024b9535f78c94840beb16fd3279eefa5` |
| `tests/shell/errexit-verify.mjs` | `descriptor-inheritance.test.ts` at 13; `stdin-origin.test.ts` at 13 | `1309653feab95729b7db62716a7b4bb7bc82f418f425f2777b6f485e3524d060` |
| `tests/shell-stress/invocation-modes/verify.ts` | `descriptor-inheritance.test.ts` at 18; `stdin-origin.test.ts` at 18 | `2b1d34e30ab41e683a5fc25094cb03863ecd0461f3ad7c8b5f65cedf8bcce73b` |
| `tests/stress/byte-ownership-20260827/fix/tsconfig.json` | `streaming.test.ts` at 8 | `b53d456465de05a9c99ed0c84fba20de7eac18d7f7c4e1ec66415e5b441f2ff4` |
| `tests/stress/byte-ownership-20260827/fix/record.mjs` | `streaming.test.ts` at 43 | `5aebd4280d993250727422ea97f186c2846886fa4db721c3f81f7ef6bedef1c6` |
| `tests/shell-stress/env-split-author/core-verify.mjs` | `stdin-origin.test.ts` at 18; `descriptor-inheritance.test.ts` at 19; `output-accounting.test.ts` at 19 | `424c2096be853c0761f38aa098eb1a09ad6094e8fe3e65667dcf17503aadc570` |

These are active source-bound routes: verifiers build explicit test argument
lists and/or snapshot/hash current inputs; the recorder binds source and author
inputs, and the tsconfig has an explicit include. Rewriting them would alter the
protocol rather than merely improve current test discovery. Restoring their
owners avoids that change entirely. Their before/after hashes match.

The broader corrective search does not depend on maintained test discovery. It
searched the working workspace, including hidden paths, for the remaining five
original basenames in .ts/.mts/.cts/.mjs/.js/.cjs/.sh, package.json,
tsconfig*.json and YAML sources. It excludes node_modules, dist, Git metadata and
the explicitly excluded Russell/process-helper paths. It found two executable
pipeline-effects references, both revision-extraction protocols rather than
reads/runs of that file directly from the moving working tree:

- tests/shell/cancellation-stage2-independent-20260827/review-fd1/regressions.mjs:
  line 13 loads focused-01.json.gz.base64; line 35 obtains every test from
  reference.baseline via Git object extraction, then runs a separate reconstructed
  tree. SHA-256 `ffe1d3203b0c83c30a842dcf61d157cc4c856721c0d7fbd039daa7756fedca97`.
- tests/integration/owned-output-production-independent-20260827/candidate-v1/legacy-review.mjs:
  line 8 loads its supplied state; line 30 extracts each test from state.candidate
  into state.product. SHA-256 `a26fde01f7307c718067a092bb1c66dfde2c27f8efc6ba599e1c79e9470a99b1`.
  A future different candidate/state is not qualified here; this is not a claim
  that the protocol accepts arbitrary later revisions.

Both protocol files remain unchanged and unexecuted. Their explicit-revision
extraction preserves access to recorded test paths without live duplicate wrappers.
No retirement claim is used for either. A separate package JSON search (2 MiB/file
cap) found 143 matching report/inventory/evidence files; these were not rewritten,
resealed or assumed to validate moving HEAD. The executable/config search had no
file-size cap. No current tsconfig/package/script/YAML route to the remaining
five old paths was found within this literal search. Dynamic path synthesis,
excluded owner contents and general data-driven replay remain outside this claim;
independent parent/reference review is still appropriate.

Important scope limit: several unchanged verifiers also name language-cohort
paths. Those committed/frozen paths are outside this I/O assignment. Their presence
was not silently fixed, and restoring the seven I/O paths does not establish a
full current-HEAD verifier pass. Full verifiers would also perform Git operations,
write evidence and/or execute out-of-scope tests, so they were not run here.

### Revised counterbalanced timings

Node v22.22.2, package-local tsx 4.23.12, Darwin arm64; live shared-worktree timing,
no cache purge or interference with other workers. The admitted 248-file runtime
fingerprint remained unchanged before/after all revised qualification:
`469e8e37e2caaa0d021a16251b93ab3608adc2ada7547973baf8319eb69de1ec`. Shared helper SHA-256 remains
`ea3bfd82b48886c5da020ef3983243d5139b9da23821a6a36336cb58eb804cb4`.

Two timing series were measured in the same counterbalanced layout order. At each
row the five-case-module series ran first, then the full original I/O-scope series.
Reduced old explicitly names the five .cases.ts files separately; reduced new
names the aggregate. Full old names all twelve original bodies separately (five
.cases.ts plus seven restored .test.ts); full new names the aggregate plus the
seven restored .test.ts files. Both layouts use the unchanged serial setting
--test-concurrency=1 and default process isolation. No concurrency/isolation flags
or test-discovery exclusions were modified.

| Run | Layout | Five-module wall ms | Five-module TAP ms | Full-scope wall ms | Full-scope TAP ms |
| ---: | --- | ---: | ---: | ---: | ---: |
| 1 | new | 448.805 | 418.1745 | 3270.619 | 3233.862292 |
| 2 | old | 1734.797 | 1699.712334 | 4218.280 | 4186.89275 |
| 3 | old | 1559.479 | 1526.138 | 4282.662 | 4245.598084 |
| 4 | new | 442.351 | 408.989375 | 3191.457 | 3161.666375 |
| 5 | new | 458.389 | 425.303583 | 3786.080 | 3752.76075 |
| 6 | old | 1997.055 | 1945.700875 | 5797.827 | 5754.77925 |
| 7 | old | 2217.576 | 2180.298334 | 6655.984 | 6613.532458 |
| 8 | new | 790.128 | 748.431542 | 4736.883 | 4693.289125 |
| 9 | new | 599.550 | 558.966208 | 4349.996 | 4310.636833 |
| 10 | old | 2035.268 | 1993.939167 | 5263.665 | 5225.8065 |
| 11 | old | 2051.391 | 2014.786667 | 5511.898 | 5472.422792 |
| 12 | new | 586.927 | 545.411292 | 4221.205 | 4184.839375 |

Every reduced row passed 89/89 with exact ordered names; every full-scope row
passed 219/219 with exactly the original name multiset/multiplicity. Full new
registration order changes only because the five modules now register together
at the aggregate's position; that new sequence is identical across all new runs.
No failures/cancellations/skips/todos and empty stderr throughout.

Six-sample external-wall medians:

- Five-module subset: **2.016 s -> 0.523 s**,
  **74.08% lower**, saving
  1.494 s per subset sweep.
- **Full original I/O scope: 5.388 s -> 4.004 s**,
  **25.69% lower**, saving
  **1.384 s per complete 219-case sweep**.

Use the full-scope 25.69% figure for this revised patch, not the withdrawn
12-file aggregate's 72.75%/74.75%. The 74.08% subset figure applies only to the
five grouped modules. Neither predicts whole-CI wall time. All timings are retained,
including the observed shared-host variation.

### Repeated/reversed state and failure attribution

The temporary file-based probe now imports only the five grouped modules forward,
reverse-module, then forward with distinct query suffixes, sharing the underlying
runtime/helpers. Three serial probes each passed **267/267** with the expected
89-name sequence repeated in the specified module order:

| Probe | Wall ms | TAP ms | Checked cases | Maximum descriptors |
| ---: | ---: | ---: | ---: | ---: |
| 1 | 1201.806 | 1167.136542 | 267 | 15 |
| 2 | 1117.943 | 1081.30975 | 267 | 15 |
| 3 | 1119.310 | 1081.3975 | 267 | 15 |

The same immutable explicit-root census checked descriptors, active resource
counts, process listeners, cwd and environment digest at settled before/after-case
boundaries. Every probe rejected and cleaned the descriptor, interval-timer and
process-listener negative controls. No leakage was observed within those stated
own-process limits; no heap/whole-host/opaque-resource guarantee is implied. The
seven restored files remain independent test processes, not imported by this probe.

Temporary first-callback assertions in all five grouped modules expanded to
**19 intentional failures / 70 passes out of 89**. Old/new TAP and maintained
concise output preserve every failed name and all five correct source assertion
locations. Raw-event old/new outputs match all **108 start/failure events**,
including actual multiline names, paths, lines and columns. Two further full-scope
runs produce the same 19 failures and **200 passes out of 219**; all seven restored
standalone files continue to run. All intentional runs exit 1 as expected with no
skips/cancellations/todos. All injections were removed in finally, and all twelve
original body hashes were restored. Both temporary probe/reporter files are absent.

### Final clean validation and handoff

- Five-module aggregate: **89/89**, TAP duration 500.797833 ms.
- Seven restored standalone owners: **130/130**, initial restored-path TAP duration
  2718.324167 ms; also included in every full timing/control run.
- Full eight-entrypoint I/O layout: **219/219**, final TAP duration
  4207.223167 ms; full maintained reporter **219/219**,
  duration 3982.042416 ms.
- Maintained integration-inputs + test-reporting regressions: **106/106**,
  duration 22552.615917 ms. One full I/O run plus these regressions is **325 tests**.
- All clean runs have zero fail/cancel/skip/todo and empty stderr.
- Final discovery is 536 package test entrypoints, unchanged since this restoration
  checkpoint. Prior global counts are historical checkpoints with other root work
  in between; this patch's own reduction is exactly four entrypoints, twelve to eight.
- All original bodies and helper unchanged; seven restored .test.ts paths present
  with no .cases.ts duplicates; five old .test.ts paths absent; five-import
  aggregate exact. All ten inspected consumer/protocol file hashes unchanged.

The reduced five-file patch is ready for parent/Socrates review, with owned files
settled. No consumer/evidence changes need staging. No further cohort work starts
without assignment. Full protocols, historical gates and language-path issues are
not claimed resolved by this bounded I/O fix.

### Current reproduction commands

Run from packages/safe-bash; do not use the superseded 12-case-file command below.
For the reduced aggregate:

~~~sh
node --import tsx --test --test-concurrency=1 --test-reporter=tap tests/shell/shell-io.test.ts
~~~

For the complete revised I/O scope:

~~~sh
node --import tsx --test --test-concurrency=1 --test-reporter=tap \
  tests/shell/descriptor-inheritance.test.ts \
  tests/shell/descriptor-moves.test.ts \
  tests/shell/file-shortcut.test.ts \
  tests/shell/fs-error-diagnostics.test.ts \
  tests/shell/output-accounting.test.ts \
  tests/shell/shell-io.test.ts \
  tests/shell/stdin-origin.test.ts \
  tests/shell/streaming.test.ts
~~~

For the twelve-process control, use the exact same command options followed by:

~~~text
tests/shell/bom-capture.cases.ts
tests/shell/descriptor-inheritance.test.ts
tests/shell/descriptor-moves.test.ts
tests/shell/file-shortcut.test.ts
tests/shell/fs-error-diagnostics.test.ts
tests/shell/here-string.cases.ts
tests/shell/output-accounting.test.ts
tests/shell/pipeline-effects.cases.ts
tests/shell/read-fields.cases.ts
tests/shell/read-options.cases.ts
tests/shell/stdin-origin.test.ts
tests/shell/streaming.test.ts
~~~

Every original emitted name remains recorded in the historical per-file arrays
below; the current disposition table determines whether its owner is standalone
or imported. No name/assertion list was rewritten to fit the reduced candidate.

## Historical 12-file experiment (superseded)

All sections below retain the original experiment and its findings. Their former
ready labels, renamed-path lists and reproduction commands are superseded by the
current reduced disposition above. They are not instructions to ship twelve
renames or to change any consumer/evidence source.

## Authorization and scope

The parent approved exactly 12 direct shell files: bom-capture.test.ts, descriptor-inheritance.test.ts, descriptor-moves.test.ts, file-shortcut.test.ts, fs-error-diagnostics.test.ts, here-string.test.ts, output-accounting.test.ts, pipeline-effects.test.ts, read-fields.test.ts, read-options.test.ts, stdin-origin.test.ts, streaming.test.ts.
Rename each to a byte-identical .cases.ts body and add only the static
shell-io.test.ts entrypoint. Preserve all registrations, names, assertions,
per-case state and runtime semantics. No helper, runner, concurrency or discovery
exclusion changes; no duplicate wrappers.

Per-file process isolation intentionally becomes per-family process isolation.
Language cohort files are frozen; Russell remote-close/probes/process-helper
ownership, cleanup cohort 3, shell subdirectories, historical evidence and the
frozen benchmark checkout are outside this implementation. Parent owns commits,
hooks, integrated gates and releases.

## Inspection and qualification plan

Current syntax inspection found no global hooks, mocks or ambient process/global
access in these 12 files. Setup constructs fresh Shell/MemoryFS/registry objects;
local sink/iterator/middleware changes remain scoped to their case. Static BOM
fixture tables and error-description tables are not mutated. The stdin-origin
registration tables include explicit empty byte/stream inputs; repeated/reversed
qualification must retain those exact bodies and validate observed independence.
Timed cancellation and existing within-case parallelism are not changed.

The pre-rename permitted-input consumer audit visited 1,350 paths and found no
old-path references. It omitted 21 reachable ownership-excluded paths before
content reads: 19 shell-subdirectory tests, remote-close.test.ts and
tests/shell-stress/process.ts. This is not proof about excluded files or arbitrary
dynamic consumers. Historical protocols/manifest/evidence bytes will not be
resealed or represented as validation of the moving checkout.

1. Capture original-path serial baselines and every emitted registration name.
2. Rename unchanged bodies and verify single-entrypoint discovery.
3. Counterbalance repeated serial isolated-file versus aggregate timings.
4. Repeat forward/reverse/forward with per-case resource/state snapshots and
   descriptor/timer/listener negative controls.
5. Compare intentional failure names/source attribution across old/new layouts
   and maintained reporting; restore exact bytes in finally.
6. Run final scoped checks, record paths/hashes/names/results and hand off.

## Qualified result and handoff

Ready for parent review/commit. The 12 approved bodies are byte-identical under
.cases.ts filenames and have one static shell-io.test.ts entrypoint. All **219
registrations / 217 unique names** remain; no assertion, registration, case or
runtime semantic change is included. The existing name
"stdin origin: rg integration rg match supplied=true" occurs three times for the
empty-string, empty-byte and empty-stream input variants; these are three retained
cases, not deduplicated or skipped tests.

Direct shell entrypoints change **62 -> 51** and package discovery **544 -> 533**.
Both rename-time and final discovery checks retain every other discovered path.
The single-entrypoint discovery assertion failed before implementation and passed
afterwards. No concurrency flag, isolation override, runner exclusion, helper or
production change is introduced. Original per-file process isolation deliberately
becomes per-family isolation for this cohort only. Case-owned setup remains
independent; existing within-case parallel execution is unchanged.

### Exact old/new paths and unchanged body hashes

All paths are workspace-relative. Each SHA-256 matches both the captured original
body and the final renamed body. Source line numbers are unchanged after probes
are removed.

| Old path | New path | Registrations | Identical body SHA-256 |
| --- | --- | ---: | --- |
| `packages/safe-bash/tests/shell/bom-capture.test.ts` | `packages/safe-bash/tests/shell/bom-capture.cases.ts` | 64 | `d5433e05d3bf3b13399aac376c64471c2338f9fc5c87e6bbc6743cb571e5dcfb` |
| `packages/safe-bash/tests/shell/descriptor-inheritance.test.ts` | `packages/safe-bash/tests/shell/descriptor-inheritance.cases.ts` | 1 | `7ba6eb5cb1701b4d284b45ca4fdee81b31403042fca23ec55dcd95703f29f57e` |
| `packages/safe-bash/tests/shell/descriptor-moves.test.ts` | `packages/safe-bash/tests/shell/descriptor-moves.cases.ts` | 5 | `b229c92117b6271a3e6d0b6cb26b3ec616c353c88c328c7ebe4709c557a69318` |
| `packages/safe-bash/tests/shell/file-shortcut.test.ts` | `packages/safe-bash/tests/shell/file-shortcut.cases.ts` | 6 | `b868f39555ea38cb6912bd91cbdf7d9ef625cb8810dc6893f1642aa96aa6262e` |
| `packages/safe-bash/tests/shell/fs-error-diagnostics.test.ts` | `packages/safe-bash/tests/shell/fs-error-diagnostics.cases.ts` | 20 | `5ac1508bc8416b6de0824577dab5ae518fad28bbf05f7c2e9fd5bc01c05befea` |
| `packages/safe-bash/tests/shell/here-string.test.ts` | `packages/safe-bash/tests/shell/here-string.cases.ts` | 14 | `32b9180a7d0ec6b898c62bfec4afa4f38cfc41a70d07ff3038b3e1cb72efe818` |
| `packages/safe-bash/tests/shell/output-accounting.test.ts` | `packages/safe-bash/tests/shell/output-accounting.cases.ts` | 28 | `6705878fb8b7c1394e0d31b18ba200c90de341d2c7d9b11f7aae1ff882972778` |
| `packages/safe-bash/tests/shell/pipeline-effects.test.ts` | `packages/safe-bash/tests/shell/pipeline-effects.cases.ts` | 2 | `90c9303b602ab190e0216c33a07744632c6d7d9176639f4b90375d7a5907e66e` |
| `packages/safe-bash/tests/shell/read-fields.test.ts` | `packages/safe-bash/tests/shell/read-fields.cases.ts` | 1 | `326e0863985e82ab214dbcf332d4974f13a356ff856b17b9c0e2d45adcb8cc4b` |
| `packages/safe-bash/tests/shell/read-options.test.ts` | `packages/safe-bash/tests/shell/read-options.cases.ts` | 8 | `e2c43a78caef38be8bd88197ebb12293609ffe4ea368d350eeafd25ab09709df` |
| `packages/safe-bash/tests/shell/stdin-origin.test.ts` | `packages/safe-bash/tests/shell/stdin-origin.cases.ts` | 62 | `02c14713e81afb384913aeb84703a7551aabab3f941570d5a9ae36cc47b3a585` |
| `packages/safe-bash/tests/shell/streaming.test.ts` | `packages/safe-bash/tests/shell/streaming.cases.ts` | 8 | `cfd61d72b7b7a33081e43c5f96dbe7c1161e27e72d6057489394283608ffe585` |

Added aggregate: `packages/safe-bash/tests/shell/shell-io.test.ts`; SHA-256 `787c3f953f53a164247a161c5c67daaf2bbe8c1e58bd291e29cb0c73b35f90a6`.
Its only statements are the 12 static .cases.js side-effect imports in table order.
Added plan: docs/plans/shell-io-test-cohort.md (this document).

The unmodified shared helper packages/safe-bash/tests/shell/helpers.ts retains
SHA-256 `ea3bfd82b48886c5da020ef3983243d5139b9da23821a6a36336cb58eb804cb4`. The 248 admitted production TypeScript inputs retain the
same before/after/final fingerprint `23c44178009dddc3c7e2741b4b331004fab44379b25b68abfa3477899abcd2a1`. This fingerprint is scoped
to admitted runtime inputs, not the whole repository or excluded historical
sources. Historical manifests, seals, verifiers and evidence were not rewritten;
no historical gate is claimed to pass against the moving checkout.

### Complete serial timing evidence

Environment: Node v22.22.2, package-local tsx 4.23.12,
darwin arm64. Measurements used the live shared worktree;
other parent/worker activity was not stopped and caches were not purged. These
are local observations, not an isolated-host or CI wall-time guarantee.

Three full original-path serial sweeps before renaming:

| Baseline | External wall ms | TAP duration ms |
| ---: | ---: | ---: |
| 1 | 6131.581 | 6087.277333 |
| 2 | 7182.549 | 7135.888917 |
| 3 | 5786.627 | 5743.87375 |

Every baseline passed 219/219 with identical ordered names and empty stderr.
Twelve additional individual-file runs passed and their concatenated emitted
names exactly match each full baseline. The initial aggregate passed 219/219 in
1614.568 ms external wall time
(TAP duration 1575.05525 ms).

Counterbalanced old/new series: old explicitly names all 12 renamed .cases.ts
files, preserving one isolated Node test process per file; new names only the
aggregate. This compares the same current body paths throughout, avoiding rename
or transform-cache asymmetry within the paired series. Both use the same existing
serial option --test-concurrency=1 and default file isolation. There is no blanket
--isolation=none or production/runner modification.

| Run | Layout | External wall ms | TAP duration ms |
| ---: | --- | ---: | ---: |
| 1 | new | 2007.599 | 1955.158209 |
| 2 | old | 7133.201 | 7083.980292 |
| 3 | old | 7266.376 | 7214.144791 |
| 4 | new | 1789.916 | 1736.659125 |
| 5 | new | 1722.087 | 1674.633 |
| 6 | old | 6800.984 | 6735.055708 |
| 7 | old | 6982.607 | 6929.783667 |
| 8 | new | 1759.407 | 1712.3985 |
| 9 | new | 1772.255 | 1731.531042 |
| 10 | old | 7031.923 | 6986.4515 |
| 11 | old | 7077.285 | 7028.648833 |
| 12 | new | 1884.918 | 1837.676334 |

All 12 runs passed 219/219 with exact original name order/multiplicity, zero
failure/cancel/skip/todo and empty stderr. Six-sample medians:
**7.055 s old -> 1.781 s new**,
**74.75% lower**,
**5.274 s saved per family sweep**,
3.96x speedup. The aggregate removes 11 startup
processes, not tests. All observations are retained, not just a favorable pair.

### Repeated/reversed state and resources

A temporary owned file statically imported all 12 modules forward, then in reverse
module order, then forward again using three distinct query suffixes. This
re-registers the original cases without changing their bodies while sharing the
underlying runtime/helpers. The reverse pass reverses modules, not statements
within a module. Exact expected names/multiplicities were the original per-file
lists concatenated forward/reverse/forward: **657 registrations per process**.

Three complete serial probes passed:

| Probe | External wall ms | TAP duration ms | Pass/total | Maximum descriptors |
| ---: | ---: | ---: | --- | ---: |
| 1 | 4740.623 | 4700.658667 | 657/657 | 15 |
| 2 | 4573.826 | 4528.509583 | 657/657 | 15 |
| 3 | 4760.801 | 4715.094541 | 657/657 | 15 |

Each probe has zero failure/cancel/skip/todo and empty stderr. Before/after every
case, after two setImmediate settling turns, temporary hooks compared immutable
invocation-local snapshots of:

- /dev/fd identities (fd, device, inode, full mode): no new/replaced descriptor;
- active resource type/count inventory: no count growth;
- process listener names/counts: exact equality;
- cwd: exact equality;
- SHA-256 of sorted environment entries: exact equality, without printing values.

The census was file-based, took the explicit /dev/fd root, allocated fresh local
counters per invocation, and ignored only transient EBADF entries from its own
directory census. Stdio was initialized before baseline capture. Each process
checked all 657 case boundaries and ended with no pending baseline snapshots.
Maximum descriptors observed was 15 in each process.

Each probe also rejected three intentional negative controls: an open /dev/null
descriptor, an active interval timer, and an added process listener. Each control
was cleaned in finally and the settled baseline was checked again. These control
assertions are not counted as additional original cases. All temporary hooks and
probe files were removed before final runs.

No state/resource leakage was observed at these settled own-process boundaries.
This does not prove whole-host isolation, heap retention bounds, arbitrary opaque
resource ownership or safety of future global mutations. In particular, shared
startup is not permission to add global-hook/process-state files to this cohort.

### Failure attribution and observer control

A temporary assertion was inserted at the first test callback in each of the
12 owned modules. Parameterized callbacks expand these 12 sites to **45 failures
and 174 passes out of 219 registrations**. Old-layout TAP, aggregate TAP and the
maintained concise reporter all exited 1 with those exact counts, zero cancelled,
skipped or todo, and empty stderr. Old/new TAP preserved the complete registration
sequence and identical failed-name sequence. All three outputs attribute failures
to all 12 correct case files and injected assertion lines, not just the aggregate.

Temporary insertion lines (absent from final bodies):
- tests/shell/bom-capture.cases.ts:46
- tests/shell/descriptor-inheritance.cases.ts:6
- tests/shell/descriptor-moves.cases.ts:6
- tests/shell/file-shortcut.cases.ts:6
- tests/shell/fs-error-diagnostics.cases.ts:29
- tests/shell/here-string.cases.ts:14
- tests/shell/output-accounting.cases.ts:18
- tests/shell/pipeline-effects.cases.ts:7
- tests/shell/read-fields.cases.ts:6
- tests/shell/read-options.cases.ts:6
- tests/shell/stdin-origin.cases.ts:30
- tests/shell/streaming.cases.ts:8

The first observer comparison exposed a TAP-versus-concise escaping difference
for a multiline here-string name: TAP encoded the newline while the concise
reporter rendered the actual newline. This was a qualification-observer mismatch,
not a product test failure or lost name. Rather than guess an unescape rule, a
temporary event reporter collected raw test:start/test:fail names, source paths,
lines and columns in two further injected old/new runs. The **264 events (219
starts + 45 failures) match exactly** between layouts; all 45 raw failed names,
including the multiline name, appear in maintained concise output. No reporter
implementation was modified.

All injections were removed in finally, both temporary reporters/probes were
removed, and all original body hashes were rechecked. No intentional failure or
extra test infrastructure is present in the final cohort.

### Final scoped checks

- Clean aggregate TAP: 219/219, zero fail/cancel/skip/todo,
  duration 1752.13875 ms; exact original names/multiplicity.
- Clean maintained concise reporter: 219/219, zero fail/cancel/skip/todo,
  duration 1786.637209 ms. Both clean runs have empty stderr.
- Maintained integration-inputs + test-reporting regressions: 106/106,
  zero fail/cancel/skip/todo; duration 29897.3455 ms.
- Final permitted-input consumer audit: 1351 visited, no old-path
  references, the same 21 ownership omissions. Excluded contents were not read
  by this audit; arbitrary dynamic/excluded consumers remain outside its claim.
- Final discovery: 533 entries, exactly matching rename-time discovery; 51 direct
  shell .test.ts entries. Only these 12 originals were replaced by one aggregate.
- All 12 old paths absent, final case body hashes identical, static aggregate
  bytes exact, helper/source fingerprints unchanged, temporary probes absent.

No full-shell, Russell, whole-workspace, release or historical gate is claimed by
this bounded qualification. Language frozen files, cleanup cohort 3, process
helpers and frozen benchmark checkout were not edited. Parent retains normal-hook
commit, integration and release ownership. Cohort 2 is settled; no further cohort
work starts without the next assignment.

### Manual reproduction

Run from packages/safe-bash. For the isolated-file control, use:

```bash
node --import tsx --test --test-concurrency=1 --test-reporter=tap \
  tests/shell/bom-capture.cases.ts \
  tests/shell/descriptor-inheritance.cases.ts \
  tests/shell/descriptor-moves.cases.ts \
  tests/shell/file-shortcut.cases.ts \
  tests/shell/fs-error-diagnostics.cases.ts \
  tests/shell/here-string.cases.ts \
  tests/shell/output-accounting.cases.ts \
  tests/shell/pipeline-effects.cases.ts \
  tests/shell/read-fields.cases.ts \
  tests/shell/read-options.cases.ts \
  tests/shell/stdin-origin.cases.ts \
  tests/shell/streaming.cases.ts
```

For the aggregate:

```bash
node --import tsx --test --test-concurrency=1 --test-reporter=tap tests/shell/shell-io.test.ts
node --import tsx --test --test-concurrency=1 --test-reporter=./scripts/test-reporting.mjs tests/shell/shell-io.test.ts
node --test --test-concurrency=1 --test-reporter=tap scripts/integration-inputs.test.mjs scripts/test-reporting.test.mjs
```

Do not use a whole-shell wildcard. Repeat old/new in the recorded counterbalanced
order and compare every emitted registration, including duplicate multiplicity.
For a new manual state audit, create an owned temporary file with the three static
import sequences/distinct query suffixes described above. Instrument the settled
case boundaries with the explicit-root immutable census, exercise/restore each
negative control, and require all 657 registrations and snapshot comparisons.
For failure controls, use the listed first-callback sites and raw event
names/locations rather than an assumed TAP decoding rule. Restore original hashes
in finally, remove temporary files and finish with the clean aggregate. These are
manual qualification steps, not permanent QA or runner infrastructure.

## Post-rebase checkpoint: parent-reported 615d11c96

After the parent resumed this assignment following the 421d878e0 integration,
all 12 renamed body hashes, the static aggregate and shared helper still match
the qualification inventory. The admitted runtime fingerprint is now
`469e8e37e2caaa0d021a16251b93ab3608adc2ada7547973baf8319eb69de1ec`; comparison with the earlier runtime snapshot
identifies only src/shell/input.ts as changed, with SHA-256
`c54706db169d156974dc9346c1bdc8ee9efa09d8d4bbe104e95b2ecd1a32c6e9`. The engineer change was not edited or reverted.

Both serial layouts were rerun against the restored current worktree: isolated
case files passed 219/219 (TAP duration 4307.682542 ms), and the
aggregate passed 219/219 (TAP duration 1042.786292 ms). Both retain
the exact original ordered names/multiplicities, zero fail/cancel/skip/todo and
empty stderr. These two checks are not a new counterbalanced benchmark or repeat
of the earlier resource/failure probes. The recorded 74.75% measured gain and
full resource/failure qualification remain evidence for the earlier runtime
fingerprint, not a claim that those measurements were repeated after rebase.

Language frozen files and all excluded ownership scopes remain untouched.
The I/O cohort remains ready for the parent commit queue; no further cohort work
was started.

## Refreshed current-runtime qualification: ready for commit

This subsequent qualification closes the limited post-rebase checkpoint above.
It preserves all earlier evidence rather than replacing its runtime identity or
measurements. The 248 admitted runtime TypeScript inputs remained unchanged
through this entire refreshed run at SHA-256
`469e8e37e2caaa0d021a16251b93ab3608adc2ada7547973baf8319eb69de1ec`, including the engineer's input.ts change.
All 12 case body hashes, aggregate bytes and the shared helper still match the
inventory. Language frozen files and excluded ownership scopes were not edited.

### Current serial timing series

Same local Node v22.22.2 / package-local tsx 4.23.12 / Darwin arm64 environment;
live shared-worktree and cache caveats still apply. Old names the 12 .cases.ts
files separately; new names only shell-io.test.ts. Both retain default process
isolation and the same existing --test-concurrency=1 setting. All 12 runs pass
219/219 with the exact original ordered names/multiplicities, zero fail/cancel/
skip/todo and empty stderr.

| Run | Layout | External wall ms | TAP duration ms |
| ---: | --- | ---: | ---: |
| 1 | new | 1373.427 | 1342.154542 |
| 2 | old | 4829.169 | 4789.514292 |
| 3 | old | 4564.318 | 4532.198041 |
| 4 | new | 1120.665 | 1085.805416 |
| 5 | new | 1111.492 | 1076.261 |
| 6 | old | 4810.962 | 4772.123375 |
| 7 | old | 5366.581 | 5329.8235 |
| 8 | new | 1562.332 | 1526.020459 |
| 9 | new | 1418.266 | 1370.676084 |
| 10 | old | 5247.753 | 5210.565 |
| 11 | old | 5813.000 | 5760.478958 |
| 12 | new | 1372.059 | 1339.114333 |

Six-sample median **5.038 s old -> 1.373 s aggregate**:
**72.75% lower**, saving
**3.666 s per family sweep**
(3.67x speedup). Use this refreshed figure
for the current runtime; 74.75% remains the earlier snapshot's result. Neither
measurement predicts full CI wall time or publication outcome.

### Repeated/reversed resource and state checks

The same temporary file-based forward/reverse/forward static-import probe was
rerun three times against the current runtime, sharing underlying helper/runtime
modules while re-registering all original cases with distinct module query suffixes.
Every name and its multiplicity matched the expected 657-registration sequence.

| Probe | External wall ms | TAP duration ms | Pass/total | Maximum descriptors |
| ---: | ---: | ---: | --- | ---: |
| 1 | 4243.502 | 4199.988958 | 657/657 | 15 |
| 2 | 5396.089 | 5328.912042 | 657/657 | 15 |
| 3 | 4630.280 | 4586.1985 | 657/657 | 15 |

Each probe checked all 657 settled case boundaries for descriptor identity,
active-resource counts, process listener counts, cwd and environment digest using
the immutable explicit-root census described earlier. All three rejected the
open-descriptor, active-timer and added-listener negative controls, cleaned them,
and restored baseline. Zero failures/cancellations/skips/todos; stderr empty.
No leakage was observed within the stated own-process census limits.

### Failure attribution and final clean controls

All 12 first-callback assertion injections were repeated on the current runtime.
Old TAP, aggregate TAP, maintained concise reporter, raw-event old and raw-event
aggregate each exited 1 as intended. The outcomes remain **219 registrations,
174 pass, 45 fail**, no cancelled/skipped/todo, empty stderr. Old/new full TAP
registration and failed-name sequences match the original evidence. The **264 raw
start/failure events match exactly**, including actual multiline names and source
paths/lines/columns; every failed raw name appears in maintained concise output.
All 12 case-file assertion sites retain meaningful stack attribution.

All injections were restored in finally; both temporary probe/reporting files
were removed. Final clean checks after restoration:

- Aggregate TAP: **219/219**, duration 1320.054917 ms;
  exact original ordered names/multiplicities.
- Maintained concise reporter: **219/219**, duration 1360.74275 ms.
- Integration-inputs + test-reporting regressions: **106/106**, duration
  23594.017 ms.
- All three have zero fail/cancel/skip/todo and empty stderr.
- Final consumer audit: 1,351 visited, zero old-path references, same 21 ownership
  omissions; excluded-content/dynamic-consumer caveats remain unchanged.
- Discovery: 533 paths, unchanged since rename; 12 original paths absent and
  aggregate present. All 12 renamed hashes, helper and aggregate bytes exact.
- Before/after admitted runtime fingerprints match; temporary probes absent.

Coverage remains **219 registrations / 217 unique names** with the existing
three-way stdin-origin duplicate preserved. This is **325 passing scoped tests**
when counting one clean family run plus the 106 runner regressions, not counting
repetitions or intentionally failing controls. No product, helper, runner,
concurrency or exclusion change is included. Per-file isolation intentionally
becomes per-family isolation only for these 12 modules.

**Ready and settled for the parent commit queue.** No further writes or cohort
work are planned without another assignment. Parent owns review, normal hooks,
integration and release; no full-workspace or historical-gate pass is claimed.

## Full ordered registration evidence

The following arrays preserve all emitted TAP names exactly, including TAP escape
sequences and existing duplicate multiplicity. There are 219 entries, 217 unique.
Each array is in original registration order; array order is aggregate import order.
Raw event verification independently preserves actual multiline names and locations.

### bom-capture.test.ts (64)

```json
[
  "decoder baseline: empty",
  "stdout byte fields and external sink: empty",
  "stdout preserves decoded text: empty",
  "stderr byte fields and external sink: empty",
  "stderr preserves decoded text: empty",
  "decoder baseline: BOM alone",
  "stdout byte fields and external sink: BOM alone",
  "stdout preserves decoded text: BOM alone",
  "stderr byte fields and external sink: BOM alone",
  "stderr preserves decoded text: BOM alone",
  "decoder baseline: BOM plus ASCII",
  "stdout byte fields and external sink: BOM plus ASCII",
  "stdout preserves decoded text: BOM plus ASCII",
  "stderr byte fields and external sink: BOM plus ASCII",
  "stderr preserves decoded text: BOM plus ASCII",
  "decoder baseline: BOM plus UTF8",
  "stdout byte fields and external sink: BOM plus UTF8",
  "stdout preserves decoded text: BOM plus UTF8",
  "stderr byte fields and external sink: BOM plus UTF8",
  "stderr preserves decoded text: BOM plus UTF8",
  "decoder baseline: interior BOM",
  "stdout byte fields and external sink: interior BOM",
  "stdout preserves decoded text: interior BOM",
  "stderr byte fields and external sink: interior BOM",
  "stderr preserves decoded text: interior BOM",
  "decoder baseline: split BOM and UTF8",
  "stdout byte fields and external sink: split BOM and UTF8",
  "stdout preserves decoded text: split BOM and UTF8",
  "stderr byte fields and external sink: split BOM and UTF8",
  "stderr preserves decoded text: split BOM and UTF8",
  "decoder baseline: repeated BOM chunks",
  "stdout byte fields and external sink: repeated BOM chunks",
  "stdout preserves decoded text: repeated BOM chunks",
  "stderr byte fields and external sink: repeated BOM chunks",
  "stderr preserves decoded text: repeated BOM chunks",
  "decoder baseline: invalid UTF8 replacement",
  "stdout byte fields and external sink: invalid UTF8 replacement",
  "stdout preserves decoded text: invalid UTF8 replacement",
  "stderr byte fields and external sink: invalid UTF8 replacement",
  "stderr preserves decoded text: invalid UTF8 replacement",
  "decoder baseline: BOM then invalid UTF8",
  "stdout byte fields and external sink: BOM then invalid UTF8",
  "stdout preserves decoded text: BOM then invalid UTF8",
  "stderr byte fields and external sink: BOM then invalid UTF8",
  "stderr preserves decoded text: BOM then invalid UTF8",
  "decoder baseline: literal non-BOM binary",
  "stdout byte fields and external sink: literal non-BOM binary",
  "stdout preserves decoded text: literal non-BOM binary",
  "stderr byte fields and external sink: literal non-BOM binary",
  "stderr preserves decoded text: literal non-BOM binary",
  "decoder baseline: incomplete BOM prefix",
  "stdout byte fields and external sink: incomplete BOM prefix",
  "stdout preserves decoded text: incomplete BOM prefix",
  "stderr byte fields and external sink: incomplete BOM prefix",
  "stderr preserves decoded text: incomplete BOM prefix",
  "stdout repeated execs preserve independent BOMs",
  "stdout string and byte stdin retain the same decoded BOM",
  "stderr repeated execs preserve independent BOMs",
  "stderr string and byte stdin retain the same decoded BOM",
  "combined output cap counts all six BOM bytes: cap=5",
  "combined output cap counts all six BOM bytes: cap=6",
  "pre-aborted capture does not enter the command or external sinks",
  "JSON.parse control distinguishes parser input from decoder BOM policy",
  "existing jq plugin retains its own JSON input decoding"
]
```

### descriptor-inheritance.test.ts (1)

```json
[
  "literal command invocation preserves inherited descriptors"
]
```

### descriptor-moves.test.ts (5)

```json
[
  "moves close their source and reject closed descriptors",
  "expanded moves reject before running their body and preserve source",
  "moved input closes only the source slot, not duplicate offsets",
  "moving standard input closes the parent slot and updates origin",
  "moved stdin preserves provenance and cancellation"
]
```

### file-shortcut.test.ts (6)

```json
[
  "file shortcut needs no cat command and trims NUL before trailing newlines",
  "file shortcut read failures stay inside substitution",
  "file shortcut respects capture limits and cancellation",
  "file shortcut fatal target expansion stops only the substitution",
  "GNU 5.3 directory-only substitution returns empty success",
  "GNU 5.3 NUL substitution warning is once per capture with its source line"
]
```

### fs-error-diagnostics.test.ts (20)

```json
[
  "FsError ENOENT: typed API and plugin boundaries retain identity; cd display is native CLI",
  "FsError ENOENT: redirection display does not rewrite API errors or filesystem effects",
  "FsError EACCES: typed API and plugin boundaries retain identity; cd display is native CLI",
  "FsError EACCES: redirection display does not rewrite API errors or filesystem effects",
  "FsError EPERM: typed API and plugin boundaries retain identity; cd display is native CLI",
  "FsError EPERM: redirection display does not rewrite API errors or filesystem effects",
  "FsError ENOTDIR: typed API and plugin boundaries retain identity; cd display is native CLI",
  "FsError ENOTDIR: redirection display does not rewrite API errors or filesystem effects",
  "FsError EISDIR: typed API and plugin boundaries retain identity; cd display is native CLI",
  "FsError EISDIR: redirection display does not rewrite API errors or filesystem effects",
  "FsError ELOOP: typed API and plugin boundaries retain identity; cd display is native CLI",
  "FsError ELOOP: redirection display does not rewrite API errors or filesystem effects",
  "FsError ENOSPC: typed API and plugin boundaries retain identity; cd display is native CLI",
  "FsError ENOSPC: redirection display does not rewrite API errors or filesystem effects",
  "FsError EROFS: typed API and plugin boundaries retain identity; cd display is native CLI",
  "FsError EROFS: redirection display does not rewrite API errors or filesystem effects",
  "plugin-provided CLI bytes and arbitrary code-like errors are not rewritten",
  "middleware replacement of a cd error retains the replacement diagnostic",
  "filesystem factory and plugin setup failures retain public FsError identity",
  "cancellation reason remains a typed FsError, not a formatted CLI result"
]
```

### here-string.test.ts (14)

```json
[
  "modern here-string scalar does not split or glob: VALUE='  a  b *\\\\n'; pass <<<$VALUE",
  "modern here-string scalar does not split or glob: IFS=:; VALUE='a::b'; pass <<<$VALUE",
  "modern here-string scalar does not split or glob: pass <<<$(say ' a  b * ')",
  "modern here-string scalar does not split or glob: pass <<<${MISSING:- a  b * }",
  "modern here-string scalar does not split or glob: set -- a '' b; IFS=; pass <<<$@; pass <<<$*",
  "malformed here-string rejects before effects: say ran >marker; pass <<<",
  "malformed here-string rejects before effects: say ran >marker; pass <<< >out",
  "malformed here-string rejects before effects: say ran >marker; false && pass <<<$(true |)",
  "malformed here-string rejects before effects: say ran >marker; pass <<<${bad",
  "malformed here-string rejects before effects: say ran >marker; pass 256<<<word",
  "here-string budgets include its appended newline and nested work",
  "here-string substitutions retain the UTF-8 and NUL string boundary",
  "here-string cancellation observes late host rejection",
  "here-string redirection expansion errors preserve ordinary fatal-expansion scope"
]
```

### output-accounting.test.ts (28)

```json
[
  "actual command printf 1234 limit 4",
  "actual command printf 1234 limit 3",
  "actual command env -i printf 1234 limit 4",
  "actual command env -i printf 1234 limit 3",
  "actual command bridge limit 4",
  "actual command bridge limit 3",
  "actual command outer limit 4",
  "actual command outer limit 3",
  "actual command env -i printf 1234 | cat limit 8",
  "actual command env -i printf 1234 | cat limit 7",
  "nested forwarding flag=undefined explicit=false",
  "nested forwarding flag=undefined explicit=true",
  "nested forwarding flag=false explicit=false",
  "nested forwarding flag=false explicit=true",
  "nested forwarding flag=true explicit=false",
  "nested forwarding flag=true explicit=true",
  "same buffer remains distinct writes stdout,stdout",
  "same buffer remains distinct writes stderr,stderr",
  "same buffer remains distinct writes stdout,stderr",
  "known contextual alias stdout-to-stderr",
  "known contextual alias stderr-to-stdout",
  "known contextual alias both-to-stdout",
  "new external sink limit 3",
  "new external sink limit 4",
  "middleware replacement of contextual sink cannot bypass accounting",
  "unknown host proxy is not blindly unwrapped",
  "mutating an owned sink write cannot retain its accounting exemption",
  "concurrent same-buffer writes reserve budget before effects"
]
```

### pipeline-effects.test.ts (2)

```json
[
  "downstream exit does not interrupt an upstream asynchronous effect",
  "a producer that writes a broken pipe cannot continue later effects"
]
```

### read-fields.test.ts (1)

```json
[
  "escaped separators survive byte-chunk boundaries"
]
```

### read-options.test.ts (8)

```json
[
  "read count uses Unicode characters across input chunks",
  "read rejects unsupported and invalid options without consuming input",
  "read count zero avoids pulling input and preserves nondefault origin",
  "read count and delimiter enforce buffered input limits",
  "read delimiter waits are cancellable",
  "GNU 5.3 zero-count closed-input failure assigns empty without consuming outer input",
  "explicit C locale counts bytes while UTF-8 counts characters",
  "C byte counts explicitly reject an incomplete UTF-8 text value"
]
```

### stdin-origin.test.ts (62)

```json
[
  "stdin origin: exec omitted",
  "stdin origin: exec empty string",
  "stdin origin: exec empty bytes",
  "stdin origin: exec empty stream",
  "stdin origin: origin | pass",
  "stdin origin: : | origin",
  "stdin origin: : | pass | origin",
  "stdin origin: origin <empty",
  "stdin origin: origin <<END\\\\nEND",
  "stdin origin: origin <<'END'\\\\nEND",
  "stdin origin: origin <<< ''",
  "stdin origin: origin 3<empty 0<&3",
  "stdin origin: origin 3<&0 <empty 0<&3",
  "stdin origin: origin <empty 3<&0 0<&3",
  "stdin origin: origin 3<&0 0<&- 0<&3",
  "stdin origin: origin 3<empty 0<&3 3<&-",
  "stdin origin: origin 0<&-",
  "stdin origin: origin 0>out",
  "stdin origin: origin 2>out 3>other",
  "stdin origin: { origin; }; (origin)",
  "stdin origin: { origin; } <empty; origin",
  "stdin origin: (origin) <empty",
  "stdin origin: func() { origin; }; func; func <empty; origin",
  "stdin origin: func() { origin; }; : | func",
  "stdin origin: say \"$(origin)\"",
  "stdin origin: { say \"$(origin)\"; } <empty",
  "stdin origin: say \"$(origin <empty)\"; origin",
  "stdin origin: { : | origin 0<&3; } 3<&0",
  "stdin origin: { : | origin 0<&3; } 3<empty",
  "stdin origin: { origin <&3; } 3<<END\\\\nEND",
  "stdin origin: { origin <&3; } 3<<< ''",
  "stdin origin: { origin 0<&3; } 3<&0 <empty",
  "stdin origin: { origin 0<&3; } <empty 3<&0",
  "stdin origin: { drain <&3; origin <&3; origin; } 3<empty",
  "stdin origin: { origin; } 0<&-",
  "stdin origin: detection never reads supplied input",
  "stdin origin: zero chunks and EOF never change explicit origin",
  "stdin origin: externally exhausted stream remains explicit",
  "stdin origin: duplicated descriptors share cursor without changing origin",
  "stdin origin: closed input retains bad-descriptor failures",
  "stdin origin: nested invocation from default=true",
  "stdin origin: nested invocation from default=false",
  "stdin origin: nested functions preserve saved descriptors and replacement origin",
  "stdin origin: middleware and transparent clones retain provenance",
  "stdin origin: forwarding changed clones requires explicit invocation options",
  "stdin origin: rg integration rg match supplied=false",
  "stdin origin: rg integration rg match supplied=true",
  "stdin origin: rg integration rg match supplied=true",
  "stdin origin: rg integration rg match supplied=true",
  "stdin origin: rg integration printf '' | rg match supplied=false",
  "stdin origin: rg integration printf '' | rg -e match supplied=false",
  "stdin origin: rg integration printf '' | rg -f .patterns/patterns supplied=false",
  "stdin origin: rg integration printf '' | rg match - supplied=false",
  "stdin origin: rg integration rg match <empty supplied=false",
  "stdin origin: rg integration rg match <<END\\\\nEND supplied=false",
  "stdin origin: rg integration rg match <<< '' supplied=false",
  "stdin origin: rg integration rg match 3<empty 0<&3 supplied=false",
  "stdin origin: rg integration rg match 3<&0 <empty 0<&3 supplied=false",
  "stdin origin: rg integration rg match <empty 3<&0 0<&3 supplied=false",
  "stdin origin: rg integration env rg match supplied=false",
  "stdin origin: rg integration printf '' | env rg match supplied=false",
  "stdin origin: rg integration printf '' | rg match matched supplied=false"
]
```

### streaming.test.ts (8)

```json
[
  "pipes preserve bytes and launch downstream before upstream completes",
  "early downstream exit and unused pipeline input do not deadlock",
  "pipeline redirects replace endpoints without leaving blocked writers",
  "streaming external sinks receive exact bytes and results retain captures",
  "AbortSignal reaches commands and releases blocked pipelines",
  "output, command, loop, source and expansion budgets reject deterministically",
  "middleware, asynchronous plugins and filesystem factories compose",
  "parallel exec calls cannot leak environment, cwd or status"
]
```
