# Current committed cause map — August 27, 2026

**All ten remaining failures need authoritative existing-entry comparison or
another approved guard. No independent, contract-unblocked filesystem defect
was reproduced in this bounded cohort.** This classifies the next work; filesystem
integration remains open.

## Pin and exact counts

The actual HEAD at assignment start was **`9982b9c8810f13d4a2d8dc6c4a70fca9154e4bc1`**,
not the earlier observed `6f04859`. It includes committed `7b04783` cross-device
move and `a0a32a7` forced-copy identity fixes. The newer metadata commit is not
represented as a filesystem change. Relevant filesystem/contract/core paths and
this leaf's owned paths were clean at capture; unrelated untracked work remains
outside this scope.

The unchanged fixture ran **once**, from a fresh archive of that committed pin:
**43 cases, 33 pass / 10 fail; 0 skipped, todo, cancelled; scoped types exit 0.**
The test process correctly exits 1. No additional core units, new regression
tests, moving-worktree run, or broad filesystem suite ran in this assignment.

| Distinct observation | Positive requirements | Rejection controls | Whole cohort |
| --- | --- | --- | --- |
| Earlier frozen `59b1269` | 23/38 pass | 5/5 pass | 28/43 pass |
| Earlier moving snapshot, historical only | 28/38 pass | 5/5 pass | 33/43 pass |
| New committed `9982b9c` pin | 28/38 pass | 5/5 pass | 33/43 pass |

Five failures at frozen `59b1269` now pass. Zero previously passing cases
regress. The new pin's case outcomes equal the earlier moving observation,
but that historical run is **not relabeled as committed evidence**.

## Map of all fifteen former failures

Codes refer to the exact phase/owner definitions following the table. Case
names are the original fixture names, not newly selected or renamed tests.

| Original case name | Current status | Phase / route |
| --- | --- | --- |
| REQUIRED webdav one-mount copy, target existing | ENOTSUP | F |
| REQUIRED webdav separate-clients copy, target existing | ENOTSUP | F |
| REQUIRED webdav separate-clients cross-mount mv, target missing | PASS | R |
| REQUIRED webdav separate-clients cross-mount mv, target existing | exit 1, unknown distinctness | C |
| REQUIRED memory to-remote webdav copy, target existing | ENOTSUP | F |
| REQUIRED memory from-remote webdav copy, target existing | ENOTSUP | F |
| REQUIRED s3 one-mount copy, target existing | ENOTSUP | F |
| REQUIRED s3 separate-clients copy, target existing | ENOTSUP | F |
| REQUIRED memory to-remote s3 copy, target existing | ENOTSUP | F |
| REQUIRED memory from-remote s3 copy, target existing | ENOTSUP | F |
| REQUIRED shared memory backend mounted twice: distinct-file mv overwrite | PASS | R |
| REQUIRED cross-mount memory mv, target missing | PASS | R |
| REQUIRED cross-mount memory mv, target existing | PASS | R |
| REQUIRED s3 separate-clients cross-mount mv, target missing | PASS | R |
| REQUIRED s3 separate-clients cross-mount mv, target existing | exit 1, unknown distinctness | C |

**F — eight FS unknown-existing guards.** At frozen
`src/fs/mount/index.ts:422`, complete observed identities are unavailable for
the existing destination pair, so copy rejects before native delegation or
stream acquisition. API observations preserve typed ENOTSUP, syscall `copyFile`,
exact global operands, and cause `ENOTSUP: operation not supported`.
Route: **Curie decides the authority contract; the filesystem owner implements
backend/wrapper proof and mount consumption.** This is not a new traversal,
permission, or transfer failure.

**C — two core move planning guards, not EXDEV terminal failures anymore.**
`src/commands/filesystem.ts:169` now catches EXDEV and invokes the cross-device
fallback. `src/commands/move.ts:68` then rejects unknown identity of the existing
destination before planning any copy/publication or removal. Exact stderr is:

```text
mv: ENOTSUP: existing move destination lacks authoritative distinctness '/left/source' -> '/right/target'
```

Both return status 1. Stderr is retained as human-readable evidence; phase
attribution also uses the matching frozen source guard, not a serialized errno
protocol. Route: **Curie authority decision plus core proof consumption**, with
the filesystem owner supplying the proof. Changing mount copy alone cannot
clear these cases because core rejects before calling it. No independent core
bug is demonstrated or routed for another unit-test cycle.

**R — five former core EXDEV failures are recovered.** Three local moves and
two remote missing-target moves now complete copy and source cleanup with the
unchanged exact payload/namespace assertions. These are committed-core results,
not a request to weaken the filesystem's rename boundary. No failure reaches
source acquisition or deletion guards in this map. Successful bounded moves
are not proof of leases, transactionality, ABA protection, or universal races.
The `cp -f` retry branch from `a0a32a7` is present but not exercised by these
direct-copy cases; its independent unit evidence is not recounted.

## Trace and byte evidence

All ten failed operations have **only metadata requests** in the recorded
operation window: PROPFIND for WebDAV, HeadObject/ListObjectsV2 for S3. There
are **zero recorded GET/PUT/COPY/MOVE/DELETE or S3 get/put/copy/delete operations**.
Their exact before/after source, target, unrelated-file bytes and directory
entry snapshots are identical. Frozen source control flow places both guards
before data acquisition or removal. Local data calls are not separately
instrumented by this immutable fixture; do not turn absent local tracing into
a claimed instrumented result.

WebDAV copy traces have 6 PROPFINDs for same-mount/separate-client copies and 3
for each memory/remote direction; the blocked move has 15. S3 copies have
4 HEAD + 8 LIST for same-mount/separate-client pairs, 2 HEAD + 4 LIST for each
mixed direction; the blocked move has 10 HEAD + 20 LIST. Full ordered key/path
traces and exact snapshots for all fifteen cases are in `cause-map.json` and
the complete 43-case `observations.json`.

Meaningful defaults remain: **all ten missing-target remote copy controls pass**
(direct, same mount, separate clients, and both memory/remote directions for
each provider). Both remote missing-target moves now pass too. The S3 move
trace includes get/put/copy/delete operations; WebDAV includes GET/PUT,
PROPPATCH and DELETE. Their final source entries disappear and target bytes
match exactly. This is not an all-errors-accepted or blanket-rejection result.

## Current contract and smallest questions for Curie

The **current committed types and worktree were read**, not inferred from an
old report. Shared contract revision is still `fa539de`; `FileSystem` has no
`compareEntry` method and production `src` contains no implementation.
`29fe1bf` explicitly labels its pairwise method as a **proposal**, not an
approved contract. Existing Markdown already permits another authoritative
guard, such as a genuinely guarded native copy; arbitrary method presence,
client inequality, incomplete tuples, or URI/ETag equality is not that guard.

1. **Approve the pairwise authority seam or select an alternative, and specify
   whether both mount copy and core move preflight may consume the same proof.**
   A mount-only consumer repair leaves the two move failures. A native-copy-only
   exception does not cover all separate-client and mixed-backend requirements.
2. **Which host/provider-owned registrations establish shared or genuinely
   disjoint authority for the tested same-endpoint clients and memory/remote
   pairs?** Unrecognized peers must stay unknown; per-instance tokens cannot
   manufacture disjointness. A method that always returns unknown satisfies no
   additional positive requirement. Preserve wrapper-selected backing meaning,
   signal/error propagation, and existing source-deletion checks.

These are decision questions, not a new normative contract authored by this
leaf. All ten current failures depend on the authority decision/implementation;
this does **not** assert that every repair must add a new public method if an
already-permitted authoritative guard can meet the same scope and ordering.

The `d0948bb` S3 permission-profile decision is **separate**: explicit creation
modes/advisory bits and regular-file versus directory X_OK remain unresolved in
that evidence. No policy row was rerun here. None of these ten failures reaches
those mode/permission issues, and resolving that policy alone does not unblock
the identity guards. Do not count it as an eleventh failure in this cohort or
claim that this successful missing-target subset closes the separate row.

## Reproduction, seals, and leaf process scope

- Fixed pin: `9982b9c8810f13d4a2d8dc6c4a70fca9154e4bc1`.
- Fixture SHA-256: `9d11741fd9b37757046c1278fdaa00c734633bfd9a1fc58ae479415c2f5a6734`.
- Archive SHA-256: `1528fef774f4898eec06e1b25f297e3ed63cddbdcc0b6dae9346e3354aaec9c7`.
- Source-set SHA-256: `5bc3592cd62431d355bc68f064a5e7827bf16cc8d464610dd23ad6b72091f285`.
- Mount source SHA-256: `6d260317b76b60f05596c00c8f80ff5da82cdca511a2e8bab38489d6befa64a4`.
- Move source SHA-256: `39eeb1ba28087bdf8f46ba511966181d4dbdee53104c9978e8967b384ddd9a03`.

Every source-file hash, command, runtime, timestamp and exit code is in
`manifest.json`. `cause-map.json` compares frozen `59b1269`, the earlier moving
snapshot, and this new committed pin without rewriting either older cohort.
`build-cause-map.mjs` regenerates classification from the saved results and
committed source; it does **not** execute tests. All **70** previously committed
owned files were checked byte-identical against `6f04859`, including the runner,
fixture, reports and raw evidence. Only this new evidence label is changed.

Replay, using a fresh label if needed (not rerun in this assignment):

```sh
node tests/fs/mount/identity-compatibility-review/run.mjs revision another-cause-map 9982b9c8810f13d4a2d8dc6c4a70fca9154e4bc1
```

`leaf-context.json` records this leaf's initially clean owned status and only
its capture/runner descendants. The single runner, its one test invocation and
scoped typecheck have completed; there are no persistent/background sessions
owned by this leaf. No other worker's process inventory was inspected. No
source, contracts, core tests, sibling review or prior artifact was edited.
Raw TAP preserves assertion whitespace. The goal is still open FS integration;
this handoff supplies a cause map for the next approved source patch.
