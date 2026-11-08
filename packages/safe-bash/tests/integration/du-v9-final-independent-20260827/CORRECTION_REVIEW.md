# Independent V9 timestamp-control review

Reviewer: V9-Final-Independent-20260827 (not Heisenberg). Date: 2026-08-27.
Ownership: only this directory. No delegation, commits, branch changes, AGENTS
creation/copy, product edits or root configuration edits. The current explicit
no-commit direction supersedes the general atomic-commit convention; evidence is
scoped and exclusive-create, not committed.

## Two corrections accepted for the bounded replay

V8 predecessor: `ae0f8b3f4f927b06718fc51e176ca7a54b517364`.
V9 freeze: `1b2ddea9e38b25cc91134a2f35a318e27f4d7c29`.
Product: `9a5a6f922beb1bc6ba84a0cd32ea7a12f8ce985d`.

1. V5-023 still establishes and records old atime at setup, reads/hashes the
   locked 1,500 bytes, and compares complete pre/post stats. It now records setup
   survival and advanced/stable/regressed atime instead of assuming every read
   advances it. Every possible delta remains confined to this file's atime;
   every non-atime field must remain exact. This is observer calibration, not
   authorization for a product read or product file-atime change.
2. V5-024 retains the instrumented real content read and actual directory
   listing. Its negative-control-only host utimes sets actual file atime to
   4102444800000 ms. The control binds the observed timestamp to the pre-window
   device/inode, requires an actual file-atime delta in the unauthorized set,
   records the complete partition (including unauthorized companion fields),
   and independently proves the forbidden read by call and locked-byte hash.
   Post-window content hashing remains outside the metadata window. There is
   no control retry, universal atime waiver, or substituted hypothetical delta.

The verifier prefix before these two controls and suffix after them must be
byte-identical to V8. The only other executable changes must be V8-to-V9 path
routing. The PRE audit enforces this and the exact complete frozen inventory.
Product-window authorization remains only actual same-layer/path directory
listing atime. Explicit mutation, content reads, copy-up, bytes, entries, file
atime, other fields and unlisted-directory atime remain forbidden. This is not
full-stat purity. No weakened product requirement was found in these changes.

## Execution boundary

Use the unchanged frozen replay once, with all generated work under this owned
directory. Immutable candidate/frozen `.ts` inputs may exist only in the
declared temporary archive/build/consumer stages; no new maintained TypeScript
fixture is authored. Temporary roots and caches are redirected here. Any retained
scratch is inventoried and archived as data before removal after settlement.
No source fallback or hidden overlay is supplied. Stop downstream stages at the
first prerequisite or actual-case failure; do not rerun to pass.

## Inherited history, not fresh observations

The V8 report states source-original 24/24, fresh 38/40, environment 16/16,
metadata 19/19, 19 allowed directory-atime deltas and zero unauthorized deltas.
The two timestamp setup preconditions failed before package/native/regression
stages. Neutral diagnosis commit
`a852a471b65b70b8f19e2915d316e3c12847cabb` reproduced file-atime publication
without the candidate; its host actor is unknown, not an established product
bug. These are inherited facts, not a replay of V8 or the diagnosis.

Original first-red controls, twelve fix closures and V1-V8 failures remain
untouched. Unrecoverable V2-V3 deltas remain permanently unproved. O060 duplicate
operands remain deferred/profile-gap/deterministic-ordering, not native parity.
Selected invalid/empty DU_BLOCK_SIZE, BLOCK_SIZE or BLOCKSIZE defaults without
lower-priority fallback; explicit CLI -B stays strict. DU intentionally has no
root/default registration. This review supplies no whole-gate, public-DU,
full-native, GNU/Linux, deployed-provider, superiority or completion claim.
