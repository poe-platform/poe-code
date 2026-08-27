# Allocation forwarding: bounded author evidence

## Candidate and scope

Product/tests commit: `8991abc3a520a3fef0e3544adc1e2508bed66a51`.
Core allocation contract and Real projection prerequisite, authored separately:
`a3febbee84e2c1c871376a9d5d30baddb96dae68`.

The only product changes in this assignment are the named `allocatedBytes`
reads and optional-value projections in the existing `snapshotStat` helpers of
`src/fs/readonly/index.ts`, `src/fs/mount/index.ts`, and
`src/fs/overlay/index.ts`. No routing, read-only policy, identity scope, device,
inode, comparison authority, snapshot-rmdir semantics, or provider implementation
is changed. There is no logical-size fallback, block synthesis, layer sum, or
untrusted metadata spread. A reported zero is retained; undefined is omitted.

The exact required fixtures remain strongly typed as `Required<FileStat>` /
mapped `Required<FileStat>`, with an explicit numeric allocation value. Read-only
optional-numeric-field permutations increase from 64 to 128 per method/shape;
existing assertions remain and allocation participates in snapshot isolation.

These are **author checks**, not independent review or a full repository gate.
They establish neither superiority to another shell nor deployed remote-provider
acceptance. No dependency installation or shared build was run. The strict
TypeScript invocation uses `--noEmit` against the selected source-import tests
and their resolved dependencies, not built declarations or public consumers.

## Captures and denominators

| Capture | Allocation tests | Existing focused tests | Scoped strict types |
| --- | --- | --- | --- |
| `captures/baseline-original-8ViFVl` | 3 pass, 87 fail / 90 | Not run | Not run |
| `captures/candidate-4ril2N` | 91 pass / 91 | 334 pass / 334 | Exit 0 |
| `captures/committed-aDfP8Q` | 91 pass / 91 | 334 pass / 334 | Exit 0 |

There are no skips, TODOs, cancellations, or hidden failed tests in either green
capture. The 91 allocation tests comprise 35 read-only, 15 mount, and 41 overlay
tests. The committed replay is 425 passing tests in total; it is not an additional
425 distinct cases. Explicit-path `git diff --check` also passed before commit.
The evidence-wide whitespace check reports trailing spaces emitted by Node in
the original failing TAP diagnostics, solely in
`captures/baseline-original-8ViFVl/allocation.stdout.log`. That raw output is kept
byte-for-byte rather than reformatted. The evidence README and capture script
pass their own explicit-path whitespace check.

The original baseline is retained, including its original three new test inputs
and capture-driver bytes under `inputs/*.txt`. Those files are historical source
data, not canonical TypeScript inputs, test-discovery entries, or active scripts.
Baseline product inputs are identified by the recorded Git HEAD and SHA-256
manifest. The later candidate strengthens the two staging-cleanup tests with
explicit upper mutation-call recording and adds one Real integration test. Thus
the 90-test baseline and 91-test candidate are **not identical-input cohorts**.
No original failure or fixture input was replaced by the later capture.

Each capture records exact commands, exit status, TAP totals, stdout/stderr,
timestamps, Git HEAD/status, Node/platform/libuv/TypeScript versions, and
before/after SHA-256 manifests. All three report unchanged inventoried inputs
during execution. These are shared-worktree captures, not sealed archive gates:
unrelated concurrent commits and dirty/untracked work are visible in provenance.
The inventory is the selected tests' TypeScript-resolved local import closure
plus listed configuration, contract documentation, and driver inputs. It is
re-resolved after execution, detecting new reachable modules, but is **not an
append-proof inventory of the repository or all TypeScript fixtures**. Tooling
versions and the lockfile are recorded; installed dependency trees are not hashed.

## Coverage and read-side limits

- Controlled provider-reporting fixtures exercise enumerable properties,
  nonenumerable own accessors, inherited accessors with the original receiver,
  zero, one, 4096, the maximum safe integer, and unknown allocation. The fixtures
  intentionally attach reported metadata to test storage; they do not claim that
  MemoryFileSystem itself reports physical allocation. Poisoned extra getters
  and unrelated `blocks` fields must not be copied or interpreted.
- Snapshot isolation, optional absence, allocation-accessor error propagation,
  root/mounted paths, synthetic mount ancestors, directories, followed targets,
  final symlinks, and nested read-only/mount/overlay views are covered. Ordinary
  memory-backed views continue to omit allocation, even for nonempty files and
  after copy-up.
- Overlay copy-up through both chmod and append checks the selected upper's
  allocation, including upper zero and unknown replacing a known lower report.
  Lower bytes/metadata and its mutation prohibition remain checked. Allocation
  never supplies identity or authority; existing focused suites exercise those
  policies independently.
- With pending staging garbage, successful and missing-path `stat`/`lstat` calls
  invoke no upper mutation, do not retry cleanup, do not copy lower content up,
  and leave the observed namespaces unchanged. This is the existing metadata
  routing, not a new no-write policy. In contrast, the existing `readFile` and
  `readdir` paths retry garbage cleanup, and the tests explicitly observe that
  removal. Other read paths are not certified as write-free; provider read-side
  effects such as access-time updates are not denied.

The 18 existing focused files, enumerated in `capture.mjs` and every all-selection
provenance record, cover read-only metadata/mutations/streams/rmdir/snapshot-rmdir;
mount review regressions, comparison, scoped identity, copy identity/guards,
snapshot-rmdir, and provider authority; overlay review regressions, copy identity,
scoped links, rmdir/snapshot-rmdir, and streaming. The larger unrelated suites were
not run or altered.

## Actual Real integration

The new integration uses Node filesystem APIs only, in a unique owned temporary
directory beneath this evidence directory, removed by test cleanup. It compares
native before/after `stat`/`lstat` observations with read-only, mount, overlay, and
composed views over explicitly rooted Real adapters. It checks dense and sparse
files, a directory, a symlink and its target, followed by actual upper copy-up.
Native block/inode observations are checked for stability around the reads;
metadata and reported allocation must match the selected backing entry.

Recorded host: Node v22.22.2, Darwin arm64, libuv 1.51.0, native filesystem type
26. The captured dense file reports 16 blocks / 8192 allocated bytes. The sparse
lower reports zero blocks / zero bytes; chmod copy-up reports 2048 upper blocks /
1048576 bytes while the lower stays unchanged. Directory/final-link allocation
was zero on this host. These are observations, not universal sparse, directory,
symlink, compression, or provider guarantees. Native observations are logged in
the allocation TAP diagnostics; no external native-process oracle was invoked.
Temporary fixture cleanup completed, and no owned `.native-*` directory remains.

## Source SHA-256

```text
2d5057de23f90cfef1f98c45f41063545bcd6c5a4439aa57d9aa0a058645b7b2  src/fs/readonly/index.ts
5b7c81d0bf6e7bcd491c401fd3d0fc185f4767f15c81faaa4fddded14e53aaf6  src/fs/mount/index.ts
e5ac4a650662656f4256455ecabb965cb6fb6eb7ab8f01315115aa70a3aa3640  src/fs/overlay/index.ts
```

The full tested import/configuration inventory and test hashes are in each
capture's `manifest-before.json` and `manifest-after.json`. The committed replay
binds these source/test bytes to the product/tests commit above. This document
and captured evidence are committed separately from that product change.

## Explicit reproduction

Run from the repository root:

```sh
node tests/fs/overlay/allocation-evidence/capture.mjs new-author-check all
```

This runs the three allocation files, the 18 focused files, then scoped strict
typechecking. Use `allocation` instead of `all` to run only the three new files.
The driver creates a unique capture directory and uses exclusive file creation;
it never rewrites committed captures. Canonical tests do not invoke the driver or
write evidence. New runs test current inputs, not a pinned historical candidate.
