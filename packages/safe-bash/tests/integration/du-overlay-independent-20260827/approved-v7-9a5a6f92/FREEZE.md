# Fresh v7 DU/Overlay verifier-correction freeze

Authored on 2026-08-27 for exact candidate
`9a5a6f922beb1bc6ba84a0cd32ea7a12f8ce985d`. This is a new recoverable
complete freeze after the first actual immutable-v6 replay exposed five fixture
defects. It precedes its own semantic replay. The author ran no v7 candidate or
native semantic case and did not build or package the product before freezing.

## Immutable lineage and chronology

The immediate base is v6 commit
`cea13e21b26e3bf85c60e56e7a846e28b6f68720`, tree
`b61988ff4a23a6a90d5ffa15149b314af0ae6c63`, path
`approved-v6-9a5a6f92/`, 20 files, manifest Git blob
`0fb0850e8a9db3962523d32b1ad088b9847670a6`, and manifest SHA-256
`417a776d878fe8bf8ee363327dd603b3b34d64df09f1b3314b2da33b84df4ef7`.
A different leaf's pre-replay audit is commit
`3b5a1b18c658826f995b830a813468879598ff0b`. The rejected actual replay and
raw evidence are commit `378206a259f55f85090dca4f1828450b60509329`, path
`approved-v6-replay-9a5a6f92/`, with evidence-manifest Git blob
`b5de7476c0c27f02fe92fa5eacbb56a338681d22` and SHA-256
`b9fb887103ba2ff15f26cb4c43075dae1179315bf1ced679603e9edf3b47310e`.

V6 passed original 24/24 and fresh 35/40. The nested 16-row literal environment
table passed 16/16. Five failures were frozen-verifier defects: V5-020,
V5-029, V5-030 and V5-031 used observer-contaminated full-stat comparisons;
V5-024 failed to establish an observable file-atime mutant precondition.
Nineteen correctly isolated metadata/DU rows passed with zero unauthorized
deltas. The replay did not reach package, moved-consumer, native, or scoped
regression stages. Timeout/grandchild closure passed, every process and scratch
path closed, v6 stayed byte-exact, and no forbidden file appeared. No product
bug was established by that fixture failure.

V7 is a surgical v6-to-v7 correction. Exact changes and raw IDs are in
`CORRECTION_V7.md`; `ORIGINS.json` enumerates every identical, modified and
new file. All v6 files and evidence remain untouched.

## Correct measured contract

Metadata and DU actions may issue no explicit mutation or content read, may not
copy up, and must leave backing bytes and entry sets unchanged. V7 enumerates
bytes and entries outside each action's measured window. Inside the window it
uses only lstat samples, retains complete normalized `FileStat` objects, and
records every changed field.

Only a provider/native directory `atimeMs` delta is authorized, and only when
the action log proves a `readdir` of the exact directory on the same backing
layer. That authorized effect remains visible. File atime, unlisted-directory
atime, mode, identity, ownership, size, allocation, mtime, ctime, birthtime,
links and every other field remain exact. Stat/lstat and observer-only windows
do not receive a listing allowance. Snapshot content/listing observers never
sit inside the measured lstat window.

The retry, pre-/mid-abort and active-stage rows preserve their exact error,
output, caller-reason, cleanup, admission, queue, ordering, hidden-stage,
whiteout, pending-path, identity and publication checks. Positive
mutation/cleanup controls remain explicit. The real V5-024 negative control
uses no preliminary file content read, proves the forced-old root/file atime
precondition, requires the actual real-adapter file read to advance file atime,
requires the exact root-directory listing atime to be authorized, and requires
file atime to be the sole unauthorized delta. Byte, entry, non-atime metadata,
content-read, mutation, upper-removal and copy-up controls remain active.

## Preserved semantic and protocol scope

`harness/verify-original.mjs` is byte-identical to v6 and its authenticated
24-case origin. The 16 literal environment rows, candidate inventory, GNU-9.7
oracle identity, strict consumer, loader controls, process manager and actual
timeout-grandchild control are byte-identical to v6.

The environment policy remains
`DU_BLOCK_SIZE > BLOCK_SIZE > BLOCKSIZE`. A selected empty or invalid value on
any of those three keys falls directly to default units and never consults a
lower key. Explicit `-B` is strict and, when valid, overrides the environment.
Common flags, provider-reported allocation with unknown preserved, incomplete
total suppression, and explicit apparent-size behavior remain unchanged.

Replay preserves the strong v6 protocol:

1. Every candidate and dependency source is admitted before archive creation or
   extraction. The executable invalid-inventory control rejects before any
   copy/write/archive/extraction. Npm dry-run and actual archive inventories,
   source bytes, the sole offline archive and installed bytes must agree.
2. Every command is finite and belongs to an authenticated detached POSIX
   process group. Ordinary/error/timeout/signal paths retain raw output and
   closure evidence. The actual timeout control requires both root/group and
   reported grandchild absent.
3. Every native row records its actual cwd with literal argv/environment,
   payload hash, pinned identity, raw output/status and narrow classification.
4. The complete materialized frozen inventory is checked by path, size,
   SHA-256 and Git blob before cases, on every success/failure path before
   cleanup, and after successful cleanup. New and deleted entries fail. Mutant
   copies are removed and probed absent; scratch removal requires ENOENT.

Candidate suites, physical installed/moved package suites, complete
file/loader hashes, strict NodeNext with `skipLibCheck: false`,
wrong-root/missing-DU/source-fallback guards, cleanup mutants, exact lifecycle
checks and the four named scoped regressions remain as frozen in v6. DU remains
an explicitly installed physical-module plugin, absent from public/default
commands. No private package is loaded.

## Static verification and later replay

The author performed static-only syntax, TypeScript parsing, JSON, hash,
inventory and immutable-origin checks. No candidate/native semantic replay,
product build, package, consumer execution or semantic import occurred.

After the freeze commit is known, verify its committed bytes with:

```sh
node tests/integration/du-overlay-independent-20260827/approved-v7-9a5a6f92/verify-freeze.mjs FREEZE_COMMIT
```

A different leaf must audit those exact committed bytes before executing the
self-materializing replay into a new result directory outside the frozen tree:

```sh
node tests/integration/du-overlay-independent-20260827/approved-v7-9a5a6f92/replay.mjs \
  FREEZE_COMMIT \
  9a5a6f922beb1bc6ba84a0cd32ea7a12f8ce985d \
  /Users/kjopek/Workspace/safe-bash/tests/integration/du-overlay-independent-20260827/RESULT_SUBDIR_CHOSEN_BY_ROOT \
  /Users/kjopek/Workspace/safe-bash/tests/commands/metadata-stress/.oracle/coreutils-9.7/src/du
```

`MANIFEST.json` lists every non-self frozen file in ASCII bytewise path order
with exact size, SHA-256 and Git blob. The freeze commit binds the manifest.
Evidence must remain outside this tree.

## Permanent history and limits

The old refined-v2/pre-v3 bytes remain unrecoverable; their exact delta remains
permanently unproved. The original 22-fail/10-pass raw evidence and later
33-case qualification remain unchanged. The prior 15 temporary `AGENTS.md`
copies incident is preserved; guarded commit
`b1b5abe972bbfc2feffbf04b8c2c98f324391923` remains accepted. V7 contains no
such file and never runs the old unsafe migration-audit harness.

V6 `ORIGINS.json` alone omitted the last `b` from the documented
candidate-path-list SHA-256. The actual file, v6 manifest and Git object were
correct. V7 records the independently recomputed full digest
`9427aad46a7f184d94517a666ab02a8f1da43ccf9074c5a15186d4569233679b`.

This freeze does not establish v7 semantic acceptance, GNU/Linux behavior,
O060, the three known native ordering differences, public/default DU
availability, whole-repository acceptance, deployed-provider behavior,
superiority, or full native parity.
