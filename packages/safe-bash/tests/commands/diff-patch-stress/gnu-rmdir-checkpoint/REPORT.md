# Independent optional-rmdir checkpoint

**NOT ACCEPTED: original3758 = 3750 pass / 8 fail. Raw driver exit: 1.**
All **70 unchanged original files**, **17 suites**, **3758 tests** ran once.
Skipped, cancelled and TODO counts are each **zero**. No failure was filtered,
replaced, weakened, removed or converted into a pass.

| Separate cohort | Pass | Fail | Total | Exit |
| --- | ---: | ---: | ---: | ---: |
| Original acceptance, unchanged70 files | 3750 | 8 | 3758 | 1 |
| Revised acceptance, explicit .acceptance.ts | 96 | 0 | 96 | 0 |
| Consumer acceptance, explicit .acceptance.ts | 61 | 0 | 61 | 0 |
| Independent corrected safety probe | 22 | 0 | 22 | 0 |
| Independent unexpected-failure diagnosis | 6 | 0 | 6 | 0 |

The last row confirms the diagnosis, **not that the six original tests pass**.
Original30 was **NOT rerun**: historical literal **14 pass / 16 fail** remains
unchanged. Revised calibration is not original30 acceptance. Historical
original3758 was **3722/36** at `4d4f5ca`; this run gains **28**, not 34, passes.

## Readiness and frozen identity

Preparation ran no acceptance. Capture started only after ROOT's exact
`/tmp/safe-bash-diff-rmdir-consumer.closed` identified closed consumer source
`4009efeef1ab909b4a5c8ffa7dbebc335dd9325c`, contract `1dc0652`, local/wrapper
checkpoint `3a9177a`, and remote refusal checkpoint `e13c2d4`. Marker bytes/hash
are retained; consumer self-status was never substituted for authorization.

- Evidence: `/tmp/safe-bash-diff-rmdir-final-PRIFIp`.
- Snapshot: `/private/tmp/safe-bash-diff-rmdir-final-PRIFIp/snapshot-1`.
  macOS `/tmp` and `/private/tmp` name the same location.
- Capture/tests/build: **2026-08-26 23:13:59.487–23:15:08.493 UTC**.
  Supplemental diagnosis ends **23:20:33.122 UTC**, on the same frozen inputs.
- HEAD: `64b55e4e313a221dc9a460f4d4b8dd6654d6f2cc` **plus actual working-tree
  bytes**, not a Git archive. Full status/index/provenance is retained.
- **1079 inputs** match before/copy/after on attempt1; aggregate SHA-256:
  `c30e3a4d8625aea0be6ed5897c1f1e90d82f3d3a517adf2d3dbb1b7198be17db`.
- Entire source-tree aggregate:
  `6878bf4927ff01c74b8d9f5f4d59a4942b9a8d98d29316999ba4f9bfa52c45a8`.
  Consumer file SHA-256:
  `3a06d5b33d3c0df12ff83b0bbf4396d90906d6fd61e3ca1bd5537f508c4282af`.
- **318 dependency entries** copied, not linked to live node_modules, match
  before/copy/after; aggregate:
  `2ae2d5c2f258eee84f94640fd96662fe98365c4d6e99f6952884afc0bf3f8eee`.
  Node **22.22.2**, TypeScript **5.9.3**, tsx **4.23.12**, @types/node **22.20.1**.
  No installation or runtime dependency was added.
- All **237 original test/evidence files** match `c623665`'s original manifest;
  all **70 original test files** also match Git `4d4f5ca` directly. All **9 revised
  author files** match `c623665`. Before/after checks pass.
- Source/dependency/runtime/oracle hashes bracket every command. No compiled JS
  siblings, changed inputs or unexpected snapshot outputs appeared. Node load
  hooks reject files outside the canonical snapshot; the initial runtime import
  audit covers **349 distinct modules**. Every command has explicit snapshot cwd.

Roots include all src/tests, benchmark implementation/fixtures/config, package and
lockfile, TypeScript configs, AGENTS and README. Exact exclusions/per-file hashes
are retained. Historical native temporary directories, benchmark reports, live
dist, .git and unrelated root docs are excluded; no test/source cohort was hidden.
Concurrent adversarial/metadata/network/shell files present at capture were
included in whole-repository typing. Historical fixed-path probe scripts were
not imported or executed by this checkpoint.

## Every original failure remains visible

**Two original expectation conflicts remain:**

1. `editflows/quoted-safety.test.ts`, `quoted-path security: quoted ancestor
   symlink`: actual **0**, expected **2**. Default basename stripping does not
   select that ancestor; selected/retained symlinks are independently checked.
2. `fuzz/edits.test.ts`, `atomic extension malformed backward-second-hunk is not
   swallowed after a valid file section`: actual **1**, expected **2**. Separate
   revised96 verifies atomic conflict precedence without replacing this gate.

**Six additional failures are newly exposed assertions, not waived exceptions:**
`emptyfile-delta/emptyfile.test.ts:18`, for normal/context/unified crossed with
`-E` and `--remove-empty-files`, all apply profiles.

The former EISDIR blocker is gone: each command returns **0**, deletes the file
and prunes `/authorized`. The frozen assertion removes that directory from its
expected namespace but leaves root **nlink=4**. Actual nlink is **3** after removing
one child directory. Independent replay of **each exact vector**, plus fresh
**pinned GNU patch** replay, gives **4→3** in both systems and identical complete
file bytes/directory namespace. No other observed metadata/namespace difference
accounts for the six assertions.

A second, later assertion at line20 also contradicts the new required API: it
expects directory `rm`, while actual calls are `rm(file)` then `rmdir(parent)`.
The frozen observer records only writeFile/rm, so sees just file rm. Both
discrepancies are proved without changing observer, expectations, product or FS.
The six remain **FAIL** in 3758. ROOT/test-owner review is required; FS source
remains Poincare's. Findings were routed through the requested status file before
any source change; this verifier made none.

Raw TAP/events, exact names, assertion values, ordinals, paths and hashes remain
in external evidence and `CHECKPOINT.json`. Historical classification labels are
kept separately from the new diagnosis. No added passing dialect exception exists.

## Independent safety and tool corrections

The corrected plain-Node built-package probe passes **22/22**, separately from
Node-test cohorts. Ordinary/atomic cases verify empty-chain pruning, cwd and
sentinels, a child inserted after empty listing, missing rmdir, EACCES/EIO/raw
transport errors, selected final/ancestor symlinks, reject-output safety, a final
parent replaced by a symlink, and cancellation with an ENOENT reason. Complete
namespaces, typed ENOTEMPTY/ENOTDIR, signals and no directory-rm/recursive fallback
are asserted. Atomic reject conflict returns1 before publication; that is not
claimed as attempted output-symlink authorization.

Two verifier-tool mistakes are retained: initially an async proxy changed
readStream into a Promise; the next attempt used unsupported `-o`. Only the new
verifier changed: stream forwarding is now transparent, and output checking uses
supported reject output. Original3758/revised96/consumer61 were **not rerun**.
Neither failed probe is claimed as a product failure or passing acceptance.

Supplement tools are independently captured/hashed and evaluated with snapshot
cwd/load guard. No frozen input is overwritten; no live source is imported.
Final passes additionally compare all build outputs against the original
manifest before/after; output aggregate:
`5c479e7b3c9a87e993b64a2bb7432827287384fa32ba5974e4c6849936d96471`.
Final safety is `supplement-lnAyeo`; diagnosis is `supplement-NB64zq`. Earlier
successful supplements and both failed tool attempts remain retained.

## Global checks and native pins

Whole-repository snapshot **tsc --noEmit passes0**, snapshot **build passes0**.
All non-build compilers use --noEmit; only snapshot dist is emitted. The public
package resolves to snapshot dist under **plain Node**, exercises factory and
Shell plugin, and verifies the actual absolute-VFS benchmark fixture:

`diff -u --label old --label new old new > change; patch /fixture/old < change; cat old`

Result: **0**, exact stdout `patching file /fixture/old\na\nc\n`, empty stderr,
exact final file/directory bytes. Discovery is **115 fixtures + 3 probes = 118
tasks**; only the specified fixture is executed, not the full comparator. No host
file fallback or TypeScript loader is used by this public-package probe. Earlier
live --noEmit preflight also passed; later concurrent live edits are not validated
by these frozen results.

| Separately pinned tool | SHA-256 |
| --- | --- |
| GNU diffutils 3.12 | f13ef516c397b0281818ffe8685aa763100b56a6549295c91849c6af937a83c9 |
| GNU patch 2.8 | c060444da0e547de6f17594baf0b5015a04f5b3277131ca12b1da27c621aee00 |
| Apple diff (FreeBSD-based) | 214a0d91e39424b15e1e3540edf6b33ee3dd2bbccb0c6dd3a9571dae754edede |
| Apple patch 2.0-12u11 | ca8aaa5fa4bd9dfaf4b3be251b18372f25f07483946e7d06b505e5a5fb0a6a84 |

GNU ignores **all** native pruning errors. Consumer unsupported/permission/
transport failures are intentionally error-preserving divergence, not universal
GNU parity. The consumer's ten-case native policy capture was inspected, **not
rerun** here; the six fresh native diagnosis replays are a different cohort.

## Backend warning and limits

The actual snapshot includes uncommitted overlay SHA-256
`e77e44db220023f55b70ad936f19f9bd150d2872f3e3758837929994b2762f28`, not merely
committed `3a9177a`. A separate adversarial worker later reported lower-child
visibility loss for that **same source hash** in its own exploratory
`tests/commands/diff-patch-stress/pruning-adversarial/overlay-observation.json`
(SHA-256 `ff543d7701ddaedc1b412f82fb0b07c54c114dd5f66c13fcefa73ce7679b6d35`
when inspected). That peer finding is **not independently replayed or counted
here**; ROOT/Poincare were alerted. Memory success does not accept this overlay
implementation or hide peer failures. No complete adapter matrix was rerun.

Remote S3/WebDAV honest unsupported behavior and overlay limits remain visible.
No global remote atomicity, general symlink-race immunity, universal GNU/BSD or
shell support, full-product completion, just-bash superiority, or 72-hour claim.
No acceptance/native/build process owned by this verifier remains active.

### Later-evidence addendum (documentation reconciliation)

The same overlay SHA-256 `e77e44db220023f55b70ad936f19f9bd150d2872f3e3758837929994b2762f28` is now committed in `50f517d`.
The companion `../pruning-adversarial/README.md` at `bf60e8f` records a later
independent **200/200** matrix, including static overlay under **preexisting
immutable-lower/exclusive-upper prerequisites**. The initial in-contract bug
classification was **retracted**. Actual raw lower-child visibility loss remains:
**0/3 child-preservation outcomes**, outside contract and **not successful child preservation**.
That matrix is separate from original3758 and is **not remote-support proof**.
The user separately reports adapter **77/79** due to S3/WebDAV `ENOTSUP`; it is not rerun here or combined with either matrix.
Frozen snapshot/raw results and all checkpoint counts remain unchanged; no all-green checkpoint is claimed.

## Reproduction and ownership

From `/Users/kjopek/Workspace/safe-bash`, preparation only:

`node tests/commands/diff-patch-stress/gnu-rmdir-checkpoint/run.mjs --prepare`

With a valid ROOT marker, fresh full capture (retained failures give nonzero):

`node tests/commands/diff-patch-stress/gnu-rmdir-checkpoint/run.mjs tests/commands/diff-patch/pruning-consumer/consumer.acceptance.ts`

Reproduce supplements on the existing snapshot with this directory's
`supplement.mjs EVIDENCE_DIRECTORY TOOL_PATH`, selecting `safety-probe.mjs` or
`diagnose-emptyfile.mjs`. It captures exact tool bytes, args, cwd, hashes and raw
status; it does not rerun original cohorts.

Exactly **eight new files** are delivered here: `REPORT.md`, `CHECKPOINT.json`,
`run.mjs`, `guard.mjs`, `safety-probe.mjs`, `diagnose-emptyfile.mjs`,
`supplement.mjs`, `summarize.mjs`. No product/FS/contracts, existing test/runner,
root manifest or peer artifact is edited. No .test.ts file is added. Status and
owner routing are in `/tmp/safe-bash-diff-rmdir-verifier-status.txt` as requested.
