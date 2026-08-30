# W05 continuation passes — composed 11 retained + 1 new per layout

## Exact scope and seals

- Pre-execution recipe commit: `91e404ba`.
- Recipe manifest SHA256:
  `2db772ff1fb357199833850fd9738b513e82a19926286ea76b183c6c9cea680f`.
- Product: `67eab12e315054907ef4ef435c6bbca2f59e0c36`.
- Whole package: `6608d255828d1a4f3b2810ef6c32a2b0b57a9aaf0dd685597ce6725d381d6e06`.
- Actual engine: `bb23ec270aaaf1d394b00d330fbf1aa6ccb2952e`.
- Root-authorized versioned literal correction, sealed after the original failure
  but before this invocation. `AMENDMENT.json` binds original and patched hashes,
  the single semantic literal change and all selection/runner-adapter deltas.

One invocation ran **2026-08-28 06:34:25.276–06:34:36.424 UTC**, parent exit0.
Only W05 executed, once installed and once after a physical move. Original child,
loader and runtime predicates were reused byte-identically. Full build/pack
reproduction and types remain bound prior proof, not rerun here.

## Actual result

| Component | Outcome |
|---|---|
| W05 installed / moved | **1/1 + 1/1** |
| Assertions, including all trailing checks | **10/10** |
| Narrow controls | **4/4** across three classes: wrong status/code, missing prefix, extra request |
| Measured / separate admission execs | 2 / 2; persistent counters not reset |
| Actual product / engine / compiler module observations | 420 / 126 / 2 |
| New guest evaluations | **0**, as required for the W05-only route |
| Execution Node / read-only Git children | 2 / 311, all natural status0 and reaped |
| Integrity guards | 8, all passed |
| Unexecuted authorized W05 instances | 0 |

Both runs return status7, empty stdout and exact LF-terminated stderr:

```
curl: (7) Network access denied by host policy
```

Both record two authorizations (original URL then denied redirect), one transport,
attempt0 for both authorizations, no extra request/retry, one disposal and one
registered cleanup completed before outer settlement. The controlled 10ms timer
is armed once, not fired, and retired once. All final resource counters are zero:
pending engine/bridge/body work, timers, unhandled rejections and outstanding
disposal/cleanup. HTTP is deterministic injected mock behavior, not live service.

All 269 pinned committed inputs and 858 package members were authenticated.
All 264 private regular copies match the original manifest; actual 63-file engine
load closure is observed in each layout. Private pre/post checks remain clean.
No private build/install/worktree/write/symlink or AGENTS copy occurred. Verified
raw receipts are retained in the compact archive before removal of only this
continuation's temporary copies/raw tree; see `CLOSURE.json`.

## Composition and preserved history

`REVIEW.json` identifies each retained original result hash and new W05 result
hash. The qualification is **11 retained + 1 new per layout**, not a single
rescored12/12 invocation. Original `144e0fca` remains exactly **11/12 each and
116/118 assertions**, including both verifier failures and the preparation
failure. No product bug was established by that wrong literal.

No full12 replay, old controls, other engine workflow, native timeout, provider,
service, hard-preemption or full-gate claim. Previous S1/dialect/zero-retry
qualifications remain unchanged. No remaining blocker within the authorized
W05-only continuation; root retains authority to ratify the scoped composition.
