# Fresh v8 DU/Overlay observer-control correction freeze

Authored on 2026-08-27 for exact candidate
`9a5a6f922beb1bc6ba84a0cd32ea7a12f8ce985d`. This is a new recoverable,
complete static freeze after the actual immutable-v7 replay exposed one
remaining positive-control fixture defect. It was authored after that rejected
replay and before any v8 replay. The author ran no candidate or native semantic
case and did not build, package, install or execute a consumer before freezing.

## Immutable lineage and chronology

The immediate base is v7 commit
`a08227b95b5ac3fc9175df6ca90a7700e5bdcbf4`, repository tree
`fbb92bc99161b52f4afdbdf2587f52f47e662d7e`, fixture tree
`cccd2d7693a10ac7609aa35db883b0530320383f`, path
`tests/integration/du-overlay-independent-20260827/approved-v7-9a5a6f92/`,
21 files, manifest Git blob `d2d09ec66ea193d7b39d2d6e0bc018f8986d8511`,
and manifest SHA-256
`ae6c2dac28f30e94a6a4d07060cad8506608b5ec5aabeed254c964fd678c3ffc`.
Its independent pre-replay audit is commit
`d6814492a9de79c4f11b16956293afa14acc6fc0`.

The rejected actual-v7 replay and raw report are commit
`94c3fcd1e2663597fc57ebf5afd2ccf708add9ea`, repository tree
`c824d899133549e2c97734c48e4d109f637f5681`, path
`tests/integration/du-overlay-independent-20260827/approved-v7-replay-9a5a6f92/`.
Its evidence manifest is Git blob
`585cd7091b210db2cdf6a52ad3f80fa0ab1d6030`, SHA-256
`ae22912f0ffbc2c198bc92ee2568603c2604365f48ca928b9a325d8a0442f87e`.
The original source suite passed 24/24 and the fresh suite passed 39/40;
the nested literal environment table passed 16/16. All four positive controls
except V5-023 passed, all seven negative controls passed, and all 19 measured
metadata/DU records passed with 17 recorded authorized directory-atime deltas
and zero unauthorized deltas. V5-024 passed with exactly one authorized
directory-atime delta and one unauthorized file-atime delta.

V5-023 alone failed. Its observer-only read returned the locked 1,500-byte
payload, but its pre-read file atime was already newer than mtime and did not
advance. The forced-old precondition was not established in the recorded
window, so this was a fixture sensitivity failure, not a product defect.
Package, moved-consumer, four scoped/128-test, and native stages were not
reached. All 109 recorded process roots/groups and the timeout grandchild were
absent; owned scratch ended at ENOENT; frozen bytes remained exact.

`CORRECTION_V8.md` links the precise raw failure and records the surgical
change. `ORIGINS.json` classifies the complete v7-to-v8 tree; the v7 freeze,
audit and raw evidence remain unchanged.

## Correct measured contract

Metadata and DU actions may issue no explicit mutation or content read, may not
copy up, and must leave backing bytes and entry sets unchanged. Byte and entry
observers stay outside lstat-only action windows. Complete normalized stat
objects and every changed field remain recorded.

Only a provider/native directory `atimeMs` delta is authorized, and only when
the action log proves a `readdir` of the exact directory on the same backing
layer. That authorized effect remains visible. File atime, unlisted-directory
atime, mode, identity, ownership, size, allocation, mtime, ctime, birthtime,
links and every other field remain exact. Stat/lstat and observer-only windows
receive no listing allowance.

V5-023 now creates a path inventory using `lstat` only, forces an old file
atime as fixture setup, records and asserts that the actual pre-read stat has
that old atime and is older than mtime, performs exactly the observer-only
real-adapter file read, and requires the complete resulting delta list to
contain exactly the real file's `atimeMs`. It also retains the payload hash and
explicit equality of every non-atime field. It does not retry until passing.

V5-024 remains unchanged: it proves forced-old root/file atimes, requires its
actual real-adapter file read to advance file atime, authorizes exactly the
same-layer listed root directory atime, and rejects exactly the file-atime
delta. Retry, pre-/mid-abort, admission, lifecycle, cleanup, mutation,
non-atime, byte, entry, content-read, upper-removal and copy-up controls remain
active.

## Preserved suite and replay scope

The original 24-case verifier, the complete 16-row literal environment fixture,
249-path candidate inventory, GNU-9.7 oracle identity, strict consumer, loader,
process manager, timeout-grandchild control and native driver are byte-identical
to v7. The fresh verifier still emits exactly 40 records in the same lineages.

Environment precedence remains
`DU_BLOCK_SIZE > BLOCK_SIZE > BLOCKSIZE`. A selected empty or invalid value
falls directly to default units and never consults a lower key. Explicit `-B`
remains strict and, when valid, overrides the environment. All 16 literal/native
rows, common flags, provider-reported allocation with unknown preserved,
incomplete-total suppression and explicit apparent-size behavior are unchanged.

Replay retains v7's complete pre-admission and hash protocol, executable
zero-write forbidden-inventory controls, offline package/installed-byte checks,
bounded detached process groups, raw outputs, actual timeout-grandchild closure,
native cwd recording, moved physical module/loader attestation, strict NodeNext,
negative copies with ENOENT cleanup, complete frozen-tree verification before
and after cases including new-entry detection, and scratch ENOENT requirement.
Only the frozen relative path changes in `replay.mjs` and
`verify-freeze.mjs`.

DU remains absent from public/default command claims while the actual installed
module path is allowed. O060 is not implemented; the three native ordering
differences and deterministic-root behavior are unchanged. This is not a
whole-gate or native-parity claim.

## Static verification and later replay

Before this freeze commit, the author performs only syntax/parse, JSON,
inventory, hash, Git-blob and immutable-origin checks. No semantic import,
candidate/native case, build, pack, install or consumer is executed.

After the freeze commit is known, verify its committed bytes with:

```sh
node tests/integration/du-overlay-independent-20260827/approved-v8-9a5a6f92/verify-freeze.mjs FREEZE_COMMIT
```

A different leaf must audit those exact committed bytes before executing the
self-materializing replay into a new result directory outside this frozen tree:

```sh
node tests/integration/du-overlay-independent-20260827/approved-v8-9a5a6f92/replay.mjs \
  FREEZE_COMMIT \
  9a5a6f922beb1bc6ba84a0cd32ea7a12f8ce985d \
  /Users/kjopek/Workspace/safe-bash/tests/integration/du-overlay-independent-20260827/RESULT_SUBDIR_CHOSEN_BY_ROOT \
  /Users/kjopek/Workspace/safe-bash/tests/commands/metadata-stress/.oracle/coreutils-9.7/src/du
```

`MANIFEST.json` lists every non-self frozen file in ASCII bytewise order with
exact size, SHA-256 and Git blob. The freeze commit binds the manifest. Replay
evidence must remain outside this tree.

## Permanent history and limits

The old refined-v2/pre-v3 bytes remain unrecoverable and their exact delta
permanently unproved. The original 22-fail/10-pass raw evidence and later
33-case policy qualification remain untouched. The prior 15 temporary
`AGENTS.md` copies incident remains preserved; guarded commit
`b1b5abe972bbfc2feffbf04b8c2c98f324391923` remains accepted. This v8 tree
contains no such file and never runs the old unsafe migration harness.

This static freeze establishes no v8 semantic acceptance, product correction,
GNU/Linux behavior, full native parity, public/default DU, deployed-provider
behavior, whole-repository acceptance, superiority or completion.
