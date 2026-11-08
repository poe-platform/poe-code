# Independent FOUNDATION allocatedBytes verification

## Bounded acceptance

The independently exercised allocation feature is accepted **only for the frozen
candidate and the source/API/runtime profiles below**. No new production defect
was established. This is not a whole-product gate, superiority claim, Linux run,
real-service certification, or evidence of 72 hours of work.

- Candidate: `28cfe0f2cdc9b82c940523fce7d6fc08dacaeb94`.
- Core: `a3febbee84e2c1c871376a9d5d30baddb96dae68`.
- Wrappers: `8991abc3a520a3fef0e3544adc1e2508bed66a51`.
- Verifier/tests/source-review commit: `93355f81808e8da1f0d53bccf258486e3750c13f`.
- Acceptance capture: `final-01/report.json`, executed August 27, 2026,
  16:50:32.590–16:51:07.341 UTC. Earlier attempts retain their own actual timestamps.
- Independent mapping authentication: `PRIMARY_SOURCES.md`; every feature
  source/contract hunk and compatibility qualifications: `SOURCE_REVIEW.md`.

The assignment's “Darwin22” is not used as a kernel-version claim: the observed
host is **Darwin 25.4.0, arm64, Node v22.22.2, libuv 1.51.0**, filesystem type
**26** as returned by builtin `statfs`. TypeScript is **5.9.3**. No Linux native
execution occurred. The `linux` arithmetic branch runs synthetically on Darwin.

## Exact final checks

| Population/check | Result |
| --- | --- |
| Core author allocation, 2 files | 9/9 passing |
| Legacy contracts/Real author cohort, 4 files | 42/42 passing |
| Wrapper author cohort, 21 files | 425/425 passing |
| New independent conversion tests, 1 file | 3/3 passing |
| New packed-public runtime consumer | 21/21 passing |
| Strict source/author/boundary types, 28 entry files | exit 0 |
| Isolated full source build | exit 0 |
| Strict packed-public consumer types and emit | exit 0 |
| Separate read-only capture audit | exit 0; `capture-audit.json` |

All positive test populations have zero failures, skips, cancellations, and TODOs.
The 425 wrapper population already contains its allocation tests. Do not add an
allocation subtotal to it. Repeated attempts, permutations within a test, native
observation rows, and mutant runs are not additional product passes. No combined
whole-product denominator is claimed.

The strict consumer imports `virtual-bash`, `virtual-bash/contracts`,
`virtual-bash/contracts/filesystem`, and the actual declared readonly/mount/
overlay/S3/WebDAV subpaths. Real is imported from the root: there is no invented
Real subpath or direct public import of its private conversion helper. It proves
legacy structural `FileStat` without the field and exact optional readonly typing
of the new field, including identity of the root and contract types. No source
fallback is used in the accepted packed run.

## Native and behavioral witnesses

`final-01/packed-runtime.stdout.txt` contains **12 measured rows**: stat and lstat
for six newly created owned entries, checked against builtin bigint fs metadata
before and after the virtual operation. Selected observations:

| Owned entry | Logical size | Native blocks | Reported allocated bytes |
| --- | ---: | ---: | ---: |
| Empty file | 0 | 0 | 0 |
| Dense file | 65,537 | 136 | 69,632 |
| Sparse file | 8,388,608 | 0 | 0 |
| Hardlink to dense file | 65,537 | 136 | 69,632 |
| Directory | 64 | 0 | 0 |
| Symlink, lstat | 5 | 0 | 0 |

The hardlink shares the dense file's device/inode and reports the same allocation;
these are **not unique physical bytes**. Stat of the symlink follows the dense
target. Known zero is actually observed, not inferred from absence. Dense and
sparse examples both demonstrate that logical size is not allocation.

A second owned native nested-wrapper/copy-up witness reports a 1,048,576-byte
lower file with 0 blocks, followed by a distinct upper inode with 2,048 blocks.
Metadata-only reads leave the upper empty; post-copy-up metadata uses the upper
entry. Lower identity, allocation, content length, mode, mtime, and ctime remain
unchanged. Copy-up reads can advance lower access time; this is not silently
misrepresented as a wholly side-effect-free read.

Additional tests cover 30 injected native stat/lstat reports, including zero,
unknown, fractions, negative values, NaN/infinities, unsafe counts and unsafe
products, and conflicting logical/preferred-I/O sizes. These are synthetic
host-response boundary tests, not measured physical-allocation witnesses.

Both named prototype accessors and hidden own accessors are exercised through
readonly, mount, upper/lower overlay, and nested views. Captured snapshots do not
change when the provider later changes. Dynamic backing reports, synthetic versus
real mount ancestors, identity references, comparison, and snapshot-rmdir
preservation/refusal are checked. Readonly refuses removal instead of advertising
the snapshot profile. Native missing-path/non-directory errors and errno-shaped
abort reasons preserve meaning/identity without content or namespace changes.

The pending-staging witness explicitly records **existing readFile housekeeping**:
stat/lstat do not remove pending staging, but a subsequent readFile does. Mock S3,
injected WebDAV, and Memory default to allocation unknown. No external service is
contacted. SafeJS synthetic `blocks` remain outside this feature.

## Mutation controls

Each final mutant receives its own copy of the packed package. It executes the
same emitted public consumer. Original package bytes are never changed. Every
failure below is an `ERR_ASSERTION`, not a load, syntax, timeout, or setup failure.

| Isolated mutant | Passing tests | Assertion failures |
| --- | ---: | ---: |
| Wrong unit, 4,096 instead of 512 | 18 | 3 |
| Unknown allocation falls back to size | 20 | 1 |
| Known zero omitted | 18 | 3 |
| Unsafe byte product accepted | 20 | 1 |
| Readonly forwarding removed | 10 | 11 |
| Mount forwarding removed | 12 | 9 |
| Overlay forwarding removed | 11 | 10 |

`capture-audit.json` additionally verifies that all seven traces load 175 package
modules and each trace has **exactly one changed loaded package module** matching
its recorded mutation hash. These controls demonstrate detection power for the
named faults, not exhaustive mutation coverage.

## Frozen inputs, emitted bytes, and cleanup

The driver uses a complete `git archive` of the exact candidate, not an overlay of
live source, a shared dist, or a narrowed replacement fixture tree. It copies the
already-installed development tools into that isolated tree. No dependencies,
OS images, or runtimes are installed/downloaded. Runtime dependencies remain empty.
An empty isolated `tests/fs/overlay/allocation-evidence` parent is created because
the frozen author native fixture expects it; this is disclosed harness setup,
not a product effect or an author-helper edit.

- Full archive: **28,042 tracked inputs**, **1,735,127,040 tar bytes**.
  SHA-256: `1b767862b0b9e45f95af751140ec03b12bb0e9c7c0c2a5b8c4ced6de89a2daa2`.
- **367 named author source/test/config inputs** match the archive before execution
  and remain byte-identical afterward: `author-before.json`, `candidate-inputs.json`,
  and `author-after.json`. This live named-input check is not append-proof.
- Every original archived file is hashed before/after, including historical data.
  A fresh scan checks new files/symlinks outside the declared dist/node_modules
  output trees and the one injected independent boundary file. None are unexpected.
  Empty-directory additions are not represented by that file scan; do not call it
  an append-proof directory-namespace check. Unrelated live edits neither enter
  nor veto this committed-archive run.
- Build emits **740 files: 185 JS, 185 declarations, and their 370 maps**.
  Exact hashes: `emitted-files.json`; actual compiler lists: `build.stdout.txt`.
- Npm packs **742 entries**. Tarball SHA-256:
  `1d5d708a6482d04581c846fdba0f335afb53a6159cee7021517629e887695def`.
  Every extracted package file is hashed in `report.json` and the unchanged
  baseline is rechecked after all mutants. The same tarball hash occurred in
  attempts 02–05; those attempts are still not full acceptance runs.
- Accepted runtime loads **175 package JS modules**. Actual load-source hashes:
  `packed-loads.jsonl` and `loaded-package.json`, checked against emitted and
  unpacked bytes. All file loads stay inside the isolated consumer.
- Public type dependencies include **69 package declarations**, **68 Node type
  files**, and **37 undici type files** in `packed-type-closure.json`. The full
  compiler list, including compiler libraries and the consumer entry, is retained
  in `packed-types.stdout.txt`. The `.mts.txt` input's hash is in the harness inputs;
  the actual emitted consumer's hash is in the runtime trace.
- Node executable SHA-256:
  `5c899797c4eb8f1db5563eea56538342ddb3e9276ee1b04a5a1f0f1023d2b011`.
- Every owned native fixture, child process, copied package, tool copy, npm cache,
  tarball, and full-archive task root is settled/removed. Each attempt records
  scratch removal; the final remaining-owned-work-root list is empty. Existing
  other workers' untracked artifacts, staging, sources, and evidence are untouched.

## Preserved unsuccessful attempts

These are harness development evidence, not hidden product failures or passes:

1. `attempt-01`: newline-delimited Git names failed on a quoted captured filename.
   No test ran. Fixed by NUL-delimited enumeration. Original author inputs remained
   unchanged; the full archive's post-run integrity claim was not reached.
2. `attempt-02`: missing consumer package scope exposed parent-package self-reference
   during TypeScript export resolution (TS2209). No public runtime was accepted.
   Added an explicit unrelated consumer package scope and rootDir. Its failed
   type output is not evidence of isolated public resolution.
3. `attempt-03`: the consumer incorrectly assumed Real has its own `compareEntry`
   method. It does not. The test now uses the inspected public Mount comparison
   API; no product API was invented or modified.
4. `attempt-04`: 17/21 public tests passed. Two failures came from a reporting test
   double decorating lstat but not stat. Another expected readonly to advertise a
   snapshot-rmdir profile despite its refusal contract. The fourth incorrectly
   expected Memory atime unchanged after copy-up's content read. Corrections affect
   only new verifier fixtures; current tests still check exact allocation, errors,
   stable metadata, identity, bytes and namespace effects.
5. `attempt-05`: 21/21 public tests passed and the wrong-unit mutant was detected.
   The harness then rejected restored bytes because apply_patch added a terminal
   newline to an emitted file. Final mutation runs use separate copies, avoiding
   restoration or alteration of the baseline entirely.

Attempts 03 onward include contemporaneous input copies. The first two predate
input-copy capture: `historical-input-reconstruction` preserves their driver and
fixtures by mechanically reversing the recorded patches from attempt 03. These
are explicitly **later reconstructions, not contemporaneously authenticated input
captures**. Original reports/logs are not rewritten. This limitation does not
apply to the accepted final run, whose input copies/hashes are checked unchanged.

## Reproduction and data classification

From the repository root, with the existing Node-22-compatible development tools:

```sh
node tests/fs/real/allocation-independent/verify.mjs UNIQUE-NEW-LABEL
node tests/fs/real/allocation-independent/audit-capture.mjs
```

The first command is an explicit historical-candidate replay; it never overwrites
an existing capture directory. The second audits `final-01` read-only and does not
run product code. The only new canonical test is `boundary.test.ts`, which tests
the current helper contract without pinning historical source bytes. The public
consumer and archived inputs end in `.txt` deliberately: they are opt-in consumer
fixtures/captured data, not canonical TypeScript roots or test-discovery entries.
No root configuration exclusion, test waiver, old-golden rewrite, or full gate
was added.
