# V7 correction rationale

Date: 2026-08-27

This is a new recoverable fixture version for exact candidate
`9a5a6f922beb1bc6ba84a0cd32ea7a12f8ce985d`. It corrects verifier defects
demonstrated by the first actual immutable-v6 replay. It does not modify v6,
reinterpret that rejected run as a pass, or establish a product defect.

## Immutable evidence and chronology

The base is v6 commit `cea13e21b26e3bf85c60e56e7a846e28b6f68720`, tree
`b61988ff4a23a6a90d5ffa15149b314af0ae6c63`, path
`tests/integration/du-overlay-independent-20260827/approved-v6-9a5a6f92/`,
20 files, and manifest SHA-256
`417a776d878fe8bf8ee363327dd603b3b34d64df09f1b3314b2da33b84df4ef7`.
A different leaf recorded the pre-replay audit at
`3b5a1b18c658826f995b830a813468879598ff0b`. The actual rejected-v6 evidence is
commit `378206a259f55f85090dca4f1828450b60509329`, path
`approved-v6-replay-9a5a6f92/`, with evidence-manifest SHA-256
`b9fb887103ba2ff15f26cb4c43075dae1179315bf1ced679603e9edf3b47310e`.
Its raw records are preserved there unchanged.

That replay passed the original suite 24/24, then passed 35/40 fresh records.
It also passed the nested 16/16 literal environment table. It stopped at the
fresh suite, so package/moved/native/scoped-regression stages were not reached.
Timeout/grandchild closure and all failure-path frozen/scratch/process checks
passed. This v7 freeze was authored after that failure and after earlier
candidate fixtures, but before any v7 candidate or native semantic replay.

## Exact verifier corrections

V6 recursively captured full backing snapshots with `lstat`, `readFile`, and
`readdir`. Four later assertions compared those observer-mutated full stats
across product windows. Their failures were entirely `atimeMs` deltas caused by
the snapshots or by an authorized same-layer directory listing:

- `V5-020` compared recursive `afterFailure` and `afterRetry`; its 13 rejected
  deltas were all atime, including observer file reads. V7 takes lstat-only
  samples immediately before and after each failure/retry action, records all
  field deltas, authorizes only directory atime backed by that action's exact
  layer/path `readdir`, and separately compares byte/entry projections.
- `V5-029` used the same full-snapshot equality around mid-abort; its 12 deltas
  were all observer atime. V7 uses the same isolated lstat-only policy while
  preserving exact caller-reason, barrier, cleanup, pending-stage, call and
  byte/entry assertions.
- `V5-030` and `V5-031` compared full snapshots around the queued metadata
  phase. V7 samples after the pre-phase content/listing observer and before the
  post-phase observer, records every full stat delta, and permits only an atime
  change for a directory actually listed on the same backing layer. Per-layer
  call suffixes isolate the action log used for that authorization. Mutation,
  content-read, queue, ordering, hidden-stage, output and publication checks
  remain explicit.

The analogous nonmetadata uses of the defective helper were corrected for
internal consistency: `V5-028` pre-abort, the active-stage pre-release no-effect
check, and the three behavior-mutant unchanged assertions now compare bytes and
entries independently from lstat-only stat windows. Positive cleanup/mutation
controls retain their intentional full-snapshot change checks because exact
removal/publication and mutation calls independently prove those effects.
No atime field is stripped from captured evidence or ignored unconditionally.

`V5-024` had a different sensitivity defect. Its preliminary recursive snapshot
read `/file.bin` before resetting atime. Raw v6 then recorded the measured file
atime as `1787860199962.114`, not the requested old
`946684800000`; the actual mutant read therefore had no remaining observable
delta. V7 inventories the two known paths with lstat only, explicitly forces and
re-reads demonstrably old root and file atimes outside the action window, and
asserts those exact preconditions. It then requires the real-adapter mutant's
actual file read to advance the file atime, requires the root directory listing
atime to appear as exactly one authorized delta, and requires the file atime to
be exactly the sole unauthorized delta. Every other stat field stays subject to
the complete delta comparison.

## Preserved scope and controls

`harness/verify-original.mjs` remains byte-identical to v6 and its authenticated
24-case origin. The 16-row environment JSON, candidate inventory, oracle
identity, strict consumer, loader, process manager and timeout control are also
unchanged. Pre-admission of package/dependency sources, zero-copy invalid
inventory rejection, bounded owned process groups, actual timeout-grandchild
closure, native-row cwd, exact full frozen bytes before/after every path,
scratch ENOENT and descendant/group closure remain in the frozen replay.

Environment precedence remains `DU_BLOCK_SIZE > BLOCK_SIZE > BLOCKSIZE`; a
selected invalid or empty value defaults immediately and never consults a lower
key. Explicit `-B` remains strict. Common flags, unknown-allocation/incomplete
suppression and explicit apparent-size semantics are unchanged. DU remains
absent from public/default commands while physical installed-module binding is
allowed. O060 is not implemented, and the three native ordering differences are
unchanged. This freeze makes no whole-gate, native-parity, default-DU, broad
superiority, GNU/Linux, or deployed-provider claim.

## Permanent historical qualifications

The old refined-v2/pre-v3 bytes remain unrecoverable and the exact v2-to-v3
delta remains permanently unproved. The original 22-fail/10-pass raw capture
and later 33-case policy qualification are not rewritten. The prior 15
temporary `AGENTS.md` copies incident remains preserved history; guarded commit
`b1b5abe972bbfc2feffbf04b8c2c98f324391923` remains the accepted pattern, and
this v7 tree contains no such copy. The old unsafe migration-audit harness is
not invoked.

Finally, v6 `ORIGINS.json` omitted the terminal `b` from the documented
candidate-selected-path SHA string. The independently recomputed complete
digest is
`9427aad46a7f184d94517a666ab02a8f1da43ccf9074c5a15186d4569233679b`.
The v6 manifest and Git file bytes already contained the correct complete
digest; v7 corrects only the origin record and documents the typo.
