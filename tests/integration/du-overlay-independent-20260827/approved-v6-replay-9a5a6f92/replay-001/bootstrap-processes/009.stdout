# Fresh v6 DU/Overlay protocol freeze

Authored on 2026-08-27 for exact candidate
`9a5a6f922beb1bc6ba84a0cd32ea7a12f8ce985d`. This v6 tree derives only from
recoverable v5 commit `ea02d6b79beeac36d263743c77e15bda7931dc67`, tree
`c35c1a0ff3ae1f93ebdf3e166739cff6b56cffd3`, authenticated current-fixture
commit `66975ea8ffeedd7c1df510bac2b13e1767bef610`, and the root-approved atime
diagnostic `75b39b40396e68a27121eea9ca2d31c67dee4e9e`. The v5 and v6 authors ran
no candidate or native semantic cases before either freeze.

## Lineage and rejection history

The immutable v5 path is `approved-v5-9a5a6f92`, with 18 files and manifest
SHA-256 `bb3d41beff906a712f4d87de987e6447c897e5704e072b04a75c6926cb482833`.
All v5 bytes, blobs, 249 candidate inputs, origins and static checks passed;
`harness/verify-original.mjs` is byte-identical to its authenticated 24-case
origin, the environment table retains 16 literal rows, and GNU 9.7 remains the
pinned native identity. A different leaf statically rejected v5 before any
semantic execution because of four protocol defects. That rejection created no
result directory, audit-pass commit, or semantic output.

This is a fresh recoverable protocol version, not a repair of unavailable old
history. The old 22-fail/10-pass capture and corrected 33-case report remain
unchanged and qualified. Blob `f127f231fe53392ed3635af1c255b66526b5c485`
and the prior refined-v2 bytes are unrecoverable; the exact v2-to-v3 delta is
permanently unproved and is not guessed or reconstructed. The prior 15-file
temporary `AGENTS.md` copy violation remains permanent history. The guarded
positive pattern at `b1b5abe972bbfc2feffbf04b8c2c98f324391923` remains accepted;
v6 creates or copies no such file and never invokes the old unsafe audit.

## Root-approved measured contract

The product action must issue no explicit mutation or content-read operation,
must not copy up, and must leave backing bytes and entry sets unchanged. Frozen
verification enumerates bytes and entries outside the measured lstat window,
records complete normalized `FileStat` objects and every changed field, and
requires mode, identity, ownership, size, allocation, mtime, ctime, birthtime,
link and every other non-atime field to remain exact.

Only a directory `atimeMs` delta for the same backing layer and path actually
listed by the action is authorized and visibly retained. This is not full-stat
purity. `stat`/`lstat` must preserve atime; file-atime and unlisted-directory
atime changes are rejected. The real-clock listing, lstat and observer-only read
controls and the real mode/byte/entry/file-atime mutants remain byte-identical
to v5, as do the upper-removal, content-read and copy-up mutants.

The frozen 1,500-byte payload and all 16 literal expectations remain unchanged.
For `DU_BLOCK_SIZE > BLOCK_SIZE > BLOCKSIZE`, a selected invalid or empty value
falls directly to default units and does not consult a lower key. Explicit `-B`
is strict and overrides the environment only when valid. `BLOCKSIZE` has no
invented lower-priority key. Native observations remain narrowly classified as
GNU-9.7 single-file apparent-size environment precedence, never broad parity.

## Four v6 protocol deltas

1. Before actual `npm pack`, replay executes `npm pack --dry-run
   --ignore-scripts --json`, proves that dry-run created no archive, rejects
   unsafe, forbidden or source-unmatched planned paths, and freezes that admitted
   list. Actual pack metadata and tar inventory must equal it before extraction;
   extracted bytes must match admitted source bytes. Offline install admits and
   pins its sole local archive and rejects production, optional, peer and bundled
   dependency archives. The executable invalid-packlist control uses only an
   in-memory forbidden path and proves zero archive creations, writes and
   extractions.
2. Every replay/native command has a finite timeout and an authenticated detached
   POSIX process group. Raw stdout/stderr and status survive ordinary, error and
   timeout paths. Normal completion, errors, timeouts, SIGINT and SIGTERM close
   only owned groups, probe root PIDs/groups gone, and preserve closure evidence.
   The frozen timeout control launches a real grandchild, forces escalation, and
   requires both owned group and reported grandchild PID gone.
3. Each of the 16 native rows records the actual cwd supplied to its bounded GNU
   spawn beside literal argv/environment, payload hash, pinned oracle identity,
   raw stdout/stderr/status and narrow classification.
4. Materialized v6 bytes are verified by exact full inventory, size, SHA-256 and
   Git blob before cases, on every success/failure path before cleanup, and again
   after successful cleanup. New/deleted entries fail. Mutants stay in separate
   owned copies; each copy is removed and probed absent before the frozen-tree
   postcheck. Evidence is prohibited inside the frozen tree, and scratch removal
   is followed by an actual ENOENT check.

The pre-archive freeze and exact 249-path candidate guards remain. Candidate
source suites, moved physical-module suites, complete file/loader byte hashes,
strict NodeNext (`skipLibCheck: false`), wrong-root/missing-DU/source-fallback
guards, cleanup mutants, exact lifecycle checks and four named 128-regression
files remain scoped as in v5. DU remains an intentionally manual physical-module
plugin with no public/default export claim. O060 and the three native ordering
differences remain outside scope.

## Static verification and later replay

This author performed static-only checks. After the freeze commit is known, verify
the committed bytes with:

```sh
node tests/integration/du-overlay-independent-20260827/approved-v6-9a5a6f92/verify-freeze.mjs FREEZE_COMMIT
```

A different leaf must audit these same committed bytes before replay. It must
choose a new result subdirectory outside this frozen tree:

```sh
node tests/integration/du-overlay-independent-20260827/approved-v6-9a5a6f92/replay.mjs \
  FREEZE_COMMIT \
  9a5a6f922beb1bc6ba84a0cd32ea7a12f8ce985d \
  /Users/kjopek/Workspace/safe-bash/tests/integration/du-overlay-independent-20260827/RESULT_SUBDIR_CHOSEN_BY_ROOT \
  /Users/kjopek/Workspace/safe-bash/tests/commands/metadata-stress/.oracle/coreutils-9.7/src/du
```

`MANIFEST.json` lists every non-self frozen byte in canonical ASCII path order
with size, SHA-256 and Git blob; the freeze commit binds the manifest itself.
No result from historical or future replay is part of this freeze.

## Permanent limits

This freeze does not establish GNU/Linux behavior, O060, three-operand native
ordering, public/default DU availability, whole-repository acceptance, deployed
provider behavior, superiority, or full native parity. Root wiring and product
source remain unchanged. Semantic acceptance belongs only to the different
leaf's later audit and replay.
