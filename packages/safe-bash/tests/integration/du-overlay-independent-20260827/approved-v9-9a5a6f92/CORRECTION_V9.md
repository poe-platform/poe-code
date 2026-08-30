# V9 atime-control correction rationale

Date: 2026-08-27

This is a new recoverable static fixture version for exact candidate
`9a5a6f922beb1bc6ba84a0cd32ea7a12f8ce985d`. It follows a frozen, bounded
neutral-host diagnosis of the two v8 atime-control setup failures. It does not
modify v8 or its replay evidence, reinterpret either failure as a pass, or
establish a candidate product defect.

## Immutable chronology

The base is v8 commit `ae0f8b3f4f927b06718fc51e176ca7a54b517364`,
repository tree `bf0d08a7a5640a1cb8aa0d1871d0b68d89cfc170`, fixture
tree `8c845070afd27a3be5038b50d222f36dd9178838`, 22 files, manifest
Git blob `8c57cf22913c922ca11b3773f1748aaf184aa44a`, and manifest SHA-256
`e8f957bd9ea434b0af5388ab0e2ed2d936d5338fcbca5344f3793b08e5e38af7`.
The independent v8 pre-replay audit is commit
`2477d20c385adf55e3f737eb1dada4e1f9139931`.

The actual rejected-v8 evidence is commit
`04e53b45fe48e25aed4c5f000e6fb29b07b45013`, tree
`fe50fbc2d172a6fe73c5c2fb343332ad1333b642`, path
`approved-v8-replay-9a5a6f92/`. Its later manifest commit is
`d4d96b30c2a5b9ff6040f05df79f6f7973ca5b5e`; the 376-nonself-record
evidence manifest has Git blob `057f4c916a28599db797bd669d4b6d6eb3efa246`
and SHA-256
`93ae1db1caaddabb698f8eaf8a6d045a9f8021def65fff3fe52c3b41a32823cb`.
The immutable failure analysis is Git blob
`463e250fbe6b50390db68ea8695acaa7567768ba`, SHA-256
`8742b419f29cb370c8ba4a2aa29d1a869ee4aebf0158970dba0f3b41614924c0`.

V8 passed original source 24/24, fresh source 38/40, all 19 metadata/DU
records with 19 visible authorized directory-atime deltas and zero
unauthorized deltas, and the nested 16-row environment table. V5-023 and
V5-024 failed because setup observed old file atime but both pre-action samples
were already current. Package, moved consumer, scoped 128, `nextLoad`,
declaration controls, and native rows were unexecuted. All 113 roots/groups and
the timeout grandchild were absent, scratch ended at ENOENT, and raw failure
bytes remain preserved.

Diagnostic inputs were frozen before execution at
`86dfbe9a4f86e0d7c4b084ec0c7c1c865a3f7804`. Raw diagnosis and analysis were
then committed at `a852a471b65b70b8f19e2915d316e3c12847cabb`, tree
`6cab0827f80ed4af008bed9a3a2e2a3a68cc4f4c`. The raw JSON is Git blob
`628a4bb60696c63bdab74870895042402d923376`, SHA-256
`b2ee65868b1ccd15db17e945fddab7c14546840992ff8bf408b2166bbe2dd9ab`.
This v9 freeze is therefore post-candidate, post-v8-audit, post-v8-failure and
post-diagnosis, but before any v9 candidate or native semantic replay. It is not
a blind holdout.

## Root cause demonstrated before v9

The v8 setup-to-prewindow call chain was traced completely. After host
`utimes` and its successful host `stat`, `measuredStats` calls only adapter
`lstat`. The adapter performs cached-root host `realpath/stat`, file path-walk
`lstat`, and final file `lstat`; field mapping only copies values. There is no
hidden content read, relative/host path mismatch, or different file identity.

The fixed three-iteration literal-Node diagnostic reproduced file-atime
publication during the lstat-only v8 mimic in one iteration and after a
completed-read-then-successful-reset in another. Configured and canonical
device/inode identity matched in all iterations. All no-access checkpoints
were stable, all three deliberate listings advanced directory atime, and all
three deliberate locked-byte reads advanced file atime. Fractional timestamp
round trips differed by 64 ns, while v8 used a whole-second timestamp.

Therefore the exact failing assumption is causal/stability attribution: a host
atime observed after `utimes` cannot prove what a later path sample will see or
that a later change belongs to one intended read. Node cannot identify the
writer of a later host atime publication, so v9 does not name APFS, the
candidate, or an external process as that actor.

## Exact executable correction

Only V5-023 and V5-024 in `harness/verify-v5.mjs` change semantically.

V5-023 remains a real-adapter observer-only content-read calibration outside
the product phase. It still forces and records old atime, samples complete
pre/post stats, reads and hashes the exact 1,500 bytes, and requires every
non-atime field to remain exact. It now records whether setup survived and
classifies atime as advanced, stable, or regressed instead of treating any one
provider outcome as a universal requirement. Any delta must still be exactly
that real file's atime.

V5-024 retains the actual instrumented real-adapter content read and directory
listing. The content violation is proven directly by the exact call and locked
byte hash. Inside this negative control only, a direct host `utimes` sets the
same device/inode's actual file atime to fixed whole-millisecond value
`4102444800000`; the full pre/post policy must contain and reject the real file
atime delta. Any `ctime` or other companion delta remains unauthorized and
visible. Directory atime remains authorizable only from the action log's exact
same-layer/path actual listing. Post-window content hashing proves bytes remain
exact. There is no retry, outcome selection, or blanket atime waiver.

The product-window rule is byte-identical: only provider/native directory
atime backed by an actual exact same-layer/path listing is authorized. File
atime, all other stat fields, content reads, explicit mutation, copy-up, bytes
and entries remain forbidden. Existing non-atime-stat, byte, entry, content,
copy-up and mode controls remain active.

## Complete v8-to-v9 classification

`ORIGINS.json` classifies every v8 path with old size, SHA-256 and Git blob.
`MANIFEST.json` supplies every v9 non-self file's new size, SHA-256 and Git
blob. Fifteen v8 paths are byte-identical; six are modified; the self-excluded
manifest is regenerated; and this rationale is the sole new non-self path.
V9 has 22 non-self records and 23 total files.

The only non-control executable differences are path-only `approved-v8` to
`approved-v9` routing in `replay.mjs` and `verify-freeze.mjs`. Documentation
changes are `CASE_MAP.md`, `FREEZE.md`, `ORIGINS.json`, and this rationale.
`harness/verify-original.mjs`, the 16-row environment table, candidate
249-path inventory, oracle identity, captured `consumer.ts` convention, strict
consumer, loader, process manager, timeout control and native driver remain
byte-identical.

## Preserved scope and qualifications

Replay retains package/dependency prearchive and unpack admission, zero-write
invalid inventory rejection, bounded process groups/timeouts/signals,
actual-grandchild closure, native cwd, full frozen-tree checks on success and
failure including new-entry detection, exact scratch removal and no
`AGENTS.md` copy.

Environment precedence remains `DU_BLOCK_SIZE > BLOCK_SIZE > BLOCKSIZE`; a
selected invalid or empty value uses default units without lower-key lookup,
and explicit `-B` remains strict. DU remains absent from public/default
commands while a physical installed module is allowed.

The refined-v2/pre-v3 bytes remain unrecoverable and their exact delta
permanently unproved. Old 22-fail/10-pass evidence, later 33-case qualification,
the prior 15-copy incident, and guarded commit
`b1b5abe972bbfc2feffbf04b8c2c98f324391923` remain unchanged. The unsafe old
migration harness is not run. This freeze makes no O060, full-native,
GNU/Linux, default-DU, package, deployed-provider, whole-gate, superiority or
completion claim.
