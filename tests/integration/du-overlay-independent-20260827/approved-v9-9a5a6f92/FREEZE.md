# Fresh v9 DU/Overlay atime-control freeze

Authored on 2026-08-27 for exact candidate
`9a5a6f922beb1bc6ba84a0cd32ea7a12f8ce985d`. This complete recoverable static
freeze follows the rejected immutable v8 replay and the separately frozen
neutral-host diagnosis. It precedes every v9 candidate/native semantic replay.
It is post-failure and post-diagnosis, not a blind holdout.

## Immutable lineage

Immediate base v8 is commit
`ae0f8b3f4f927b06718fc51e176ca7a54b517364`, repository tree
`bf0d08a7a5640a1cb8aa0d1871d0b68d89cfc170`, fixture tree
`8c845070afd27a3be5038b50d222f36dd9178838`, 22 files, and manifest
SHA-256 `e8f957bd9ea434b0af5388ab0e2ed2d936d5338fcbca5344f3793b08e5e38af7`.
The v8 audit is `2477d20c385adf55e3f737eb1dada4e1f9139931`.

Actual v8 evidence is commit
`04e53b45fe48e25aed4c5f000e6fb29b07b45013`; its later manifest commit is
`d4d96b30c2a5b9ff6040f05df79f6f7973ca5b5e`, with 376 non-self records and
manifest SHA-256
`93ae1db1caaddabb698f8eaf8a6d045a9f8021def65fff3fe52c3b41a32823cb`.
The original suite passed 24/24 and fresh suite passed 38/40. All 19
metadata/DU windows passed with 19 visible authorized directory-atime deltas
and zero unauthorized deltas; the 16-row environment table passed. V5-023 and
V5-024 lost their forced-old file-atime preconditions before action. Later
package/native/moved/scoped-128/`nextLoad` phases were unexecuted, all 113
roots/groups and the grandchild were absent, and scratch was ENOENT. No product
defect was established.

Diagnostic inputs precede execution at commit
`86dfbe9a4f86e0d7c4b084ec0c7c1c865a3f7804`; raw diagnosis is commit
`a852a471b65b70b8f19e2915d316e3c12847cabb`. `CORRECTION_V9.md` binds exact
trees, blobs, hashes, call-chain facts, raw observations and correction
rationale. Old fixture and evidence bytes remain unchanged.

## Frozen measured contract

The 19 metadata/DU windows permit no explicit mutation, content read, copy-up,
byte change or entry change. Their complete normalized stat objects and every
field delta remain recorded. Byte/entry observers stay outside lstat windows.

Only provider/native directory `atimeMs` from an actual exact same-layer/path
`readdir` may be authorized and it remains visibly recorded. File atime,
unlisted-directory atime, mode, identity, ownership, size, allocation, mtime,
ctime, birthtime, links and every other field remain forbidden. Stat/lstat and
non-listing windows receive no allowance. This is not full-stat purity: the
narrow directory listing effect is explicit.

V5-023 performs and hashes the locked real content read but records provider
atime behavior as calibration. V5-024 proves the content-read violation from
the instrumented call and locked bytes and uses an intentional real-host atime
perturbation to prove actual file-atime rejection deterministically. It retains
the complete delta, including any non-atime companion field. No control retries
until passing, and no static hypothetical substitutes for the actual host
file-atime delta.

All original byte/entry/full-stat assertions and all explicit mutation,
content, copy-up, mode, identity, ownership, timestamp, cancellation, cleanup,
admission and lifecycle controls remain active. Only the two diagnosed atime
control bodies change.

## Complete scope preserved

The original 24-case verifier stays byte-identical. The fresh verifier remains
40 records: 31 historical-frozen-derived, 2 lifecycle additions and 7 observer
policy controls. Its first 19 records are the measured metadata/DU windows.
The complete environment table remains 16 literal candidate rows and 16 native
rows. Selected invalid or empty values obey
`DU_BLOCK_SIZE > BLOCK_SIZE > BLOCKSIZE` and use the default without lower-key
lookup; explicit `-B` is strict.

The selected candidate inventory remains 249 paths. GNU-9.7 oracle identity,
strict consumer files, captured `consumer.ts` convention, loader and process
controls, native cwd, original/fresh source and moved-package runs, scoped 128,
declaration controls, physical package install/move and `nextLoad` attestation
remain frozen.

Replay retains admitted pack/dependency prearchive and unpack checks,
invalid-packlist zero-write rejection, bounded detached process groups,
timeouts, descendant signals, actual-grandchild closure, raw stdout/stderr,
failure-path `finally` verification, exact frozen bytes and no-new-entry checks
before/after execution, scratch ENOENT, and forbidden `AGENTS.md` checks. The
only protocol change is the frozen v9 directory name.

DU remains absent from public/default aggregate commands. A physically
installed module is allowed and must be attested. No ambient or HEAD candidate
bytes are admitted.

## Static freeze boundary and later use

Before the v9 commit, only syntax/parse, JSON, inventory, byte/hash/Git-blob,
origin, immutable-object and forbidden-path checks may run. No v9 verifier,
candidate import/build/package/install/consumer, native `du`, or product suite
may execute.

After commit, a different leaf must audit the exact committed bytes before any
replay. The immutable static verifier command is:

```sh
node tests/integration/du-overlay-independent-20260827/approved-v9-9a5a6f92/verify-freeze.mjs FREEZE_COMMIT
```

Only after that audit may another leaf run:

```sh
node tests/integration/du-overlay-independent-20260827/approved-v9-9a5a6f92/replay.mjs \
  FREEZE_COMMIT \
  9a5a6f922beb1bc6ba84a0cd32ea7a12f8ce985d \
  /Users/kjopek/Workspace/safe-bash/tests/integration/du-overlay-independent-20260827/RESULT_SUBDIR_CHOSEN_BY_ROOT \
  /Users/kjopek/Workspace/safe-bash/tests/commands/metadata-stress/.oracle/coreutils-9.7/src/du
```

Evidence must be outside this frozen tree. `MANIFEST.json` inventories all 22
non-self files in ASCII bytewise order with size, SHA-256 and Git blob; the
freeze commit binds the self-excluded manifest.

## Permanent limits

The refined-v2/pre-v3 bytes remain unrecoverable and their exact delta remains
permanently unproved. Old 22-fail/10-pass evidence, later 33-case qualification,
the prior 15-copy incident and guarded commit
`b1b5abe972bbfc2feffbf04b8c2c98f324391923` remain untouched. No unsafe old
migration harness is run and no `AGENTS.md` is copied.

This static freeze establishes no v9 semantic pass, package/native acceptance,
O060 behavior, full native or GNU/Linux parity, public/default DU,
deployed-provider behavior, whole-gate acceptance, superiority or completion.
