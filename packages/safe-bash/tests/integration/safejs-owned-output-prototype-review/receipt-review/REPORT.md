# Independent assembly-receipt review

August 27, 2026. **QUALIFIED ACCEPT — assembly identity only.** This verifier is
different from original authors and preparer `01a0438a-acfd-7dd0-8d20-a9d07a3c527c`.
No guest, product runtime, private engine, network probe or native oracle ran.
No security, capability, lifecycle, promotion, parity or full-gate verdict is made.
The actual capability audit remains pending and does not affect separately
admitted, launch-authorized frozen production gate 8670 (admission acceptance
`58130545`), which excludes this prototype and new env-S dispatch.

## What was independently established

- The ordered source route and separately extracted Q candidate agree on **all
  940 file identities** after one TEMP public rebuild: 213 source, 15 historical
  fixtures/helpers, four unchanged configuration files and 708 compiled outputs.
- Every stage was hashed using the original sorted compact
  `[{path,bytes,sha256},...]` JSON serialization, not archive or Git identities.
  Expected inventories came from original frozen receipts. Expected changed-path
  sets were independently fixed from the original patch headers/handoff: **9, 4,
  2**. Every other file was asserted unchanged at each patch stage.
- All 246 actual first-preparer frozen input files match their Git blobs and
  SHA-256s. Its retained candidate (940), rebuilt source/output (940), consumer
  package (709), baseline (227), and clean committed-base (216) were read and
  compared against the corresponding independent bytes, not its report hashes.
- Complete original V1/S/Q/F/O artifact inventories were checked (235/70/79/166/125
  entries, respectively). Including other prerequisites, the successful pass
  authenticates 856 commit/path bindings covering 731 distinct repository paths.
  All current receipt bytes still match those frozen bindings; live product edits
  are neither assembly inputs nor a reason to reject the frozen candidate.
- O's exact candidate-prefix entries in authentication-before and
  authentication-after each match all 940 files. Its 44-entry pre-run seal,
  driver, ordering fixture, config and candidate entry hash also match. Other
  `/candidate/` paths in those historical receipts were not indiscriminately
  conflated with the selected ordering candidate.

`attempts/r2/proof.json` contains every stage/file, delta, artifact/Git-blob binding,
archive metadata identity, compiler input, declaration/export result and retained
comparison. `STAGES.md` gives the exact ordered inputs and every production-path
before/after SHA-256. `verification.json` records a separate post-run assertion
pass over actual retained/new files, original dirty Git-blob bindings and tools.

## Baseline and ordered assembly

The original first-read freeze is `2026-08-27T09:13:05.261Z`, anchored at
`c9b96263d1204bdf54e89324cc0c7d1ef6bd3f79`. B0 is **not** a clean checkout.
The archive's 227 semantic files were checked independently against the original
freeze/input selection and preserved-capture precedence. Exactly three source
files differ from the clean Git bytes: tree `arguments.ts`, `io.ts`, and `tree.ts`.
Eighteen preserved source labels plus one preserved config label do not imply
nineteen dirty files. The proof records all 227 choices, clean Git blob identities,
freshly computed clean-byte SHA-256s, and selected captured-byte SHA-256s.

The only source sequence is B0 archive → whole V1 `source-r1` → three V1 fixture
copies → four-file retention patch → one S1 `source-S1-r0` → S1 author-r1 fixture.
The retention patch also equals the original four-path Git diff from c9b96263 to
3b33f9a8. S1 r0/r1 patch captures are byte-identical and only one was applied.
There are six V1-to-final production changes, not the rejected V2 branch's three.
Q's final archive is an **alternative complete route**, never another overlay.
V2, Q/current-capture and Q/original-preoperation are excluded assembly candidates;
hashing comparison artifacts as receipts does not authorize their extraction/use.

669c881b, 97909bec, 13536dd8 and e57b5aa1 have no production-source/root-config
changes in their commit diffs. Their facade, fixture ordering and declaration
evidence corrections are not production patches. Historical 32/32 results are
bindings only here, not newly rerun tests or a universal acceptance claim.

## Archive metadata and preserved verifier attempts

The baseline tar exposes 497 regular members and 43 directories: **227 semantic
files plus 270 AppleDouble metadata sidecars**. Each sidecar is 163 bytes, with
SHA-256 `5934932f7beff3c908b0c8b6af6ea8a142bb02b0c16dc2d411fbde870a31e988`,
the validated AppleDouble header and a corresponding archived file/directory.
The corrected extractor permits this classification only for the exact pinned
baseline archive, preserves every sidecar separately in regular TMP storage, and
records every identity. It does not broadly exclude `._*`, apply xattrs, or inject
metadata into compiler inputs. Q has 940 regular files, 79 directories, no such
sidecars, and no symlink/hardlink/special entries. Neither author restore ran.

Verifier attempt r0 refused the unclassified metadata as extra files. Attempt r1
then verified all four source stages but refused a comparison that incorrectly
expected byte-length fields in S's hash-only config records. The successful r2
binds those four lengths to the independent original freeze/archive instead;
all config hashes remain unchanged. These are verifier assumptions, not product
or security findings. Their exact scripts, failure outputs, child journals and
fresh private snapshots remain under `attempts/r0` and `attempts/r1`. Both failed
scratch directories were removed and absence independently verified.

The **original preparer's** two failure JSONs and prepare-r0/r1 captures were never
modified. Their hashes and exact failure messages remain in the successful proof;
their four SHA-256s are listed in `STAGES.md`. The first failure's clean
arguments.ts hash is independently reproduced from c9b96263. The second confused
preserved labels with dirty deltas. Neither establishes an assembly security bug.

## Build and actual API

One successful public-only rebuild uses separately copied, per-file authenticated
TypeScript 5.9.3, @types/node 22.20.1 and undici-types 6.21.0 (132/74/41 files).
The actual compiler implementation/package and Node binary also match original
author pins. All 708 emitted identities and all 358 ordered historical compiler
inputs match. The scoped historical typecheck and separate strict declaration
inspection complete with zero diagnostics; neither is the current whole TS gate.

The real metadata is `ByteSink.ownedOutput?: { readonly consumerClosed:
AbortSignal; write(chunk: Uint8Array): Promise<void> }`. The accounted method is
**ownedOutput.write**, not `accountedWrite`; no `OwnedOutput` named export exists.
Compiled declarations establish `createOutputOperation(context: Pick<CommandContext,
"signal" | "registerCleanup">, destination: ByteSink)` and exactly `signal`,
`output`, `child(destination)`, `registerCleanup(cleanup)`, `acquire(start, release)`
and `close()` on OutputOperation. The proof preserves exact callback signatures.
Root/contracts/contracts-output routes already expose the factory in this TEMP
candidate; types remain type-only. Internal shell/runtime and GuestInput/GuestOutput
are not promoted. Static inspection is not a guest reachability/lifecycle test.

## Private and retained-state closure

The frozen helper from provenance commit
`f666ad8c76ea4362b093ee52e3e7e3b5c3702916` was audited before use; its only writes
are adjacent before/after JSON in this verifier's new regular scratch. It was
reused byte-identically, with private Git `GIT_OPTIONAL_LOCKS=0`; fsmonitor and
untracked-cache configuration were absent. Checkpoint
`232868324ae4d4f063bd6116c87206f6a68429f7` matches each fresh before-state.

Every attempt captured after-state even on failure. Overall recorded observations
span `2026-08-27T14:39:28.636Z` through `2026-08-27T14:50:06.234Z`; successful r2 is
`14:49:39.608Z–14:50:06.234Z` UTC. This is observation timing, not a work-duration claim.
HEAD stays `bb23ec270aaaf1d394b00d330fbf1aa6ccb2952e`, tree
`ebcb4508690856b288a40e60e7682331d6fad8ff`, index SHA-256
`2dc2ac516c19864f952c493eb39374db1a2946f359d31dfb6fd02a5fccfb6bc2`.
Index bytes (431585), mode (0644), mtime/ctime, exact status/staging, six metadata
files and all 264 engine files' hashes/lengths/mode/mtime/ctime remain identical.
The known three dirty package files and four untracked status entries remain;
this is not a clean-checkout assertion. Full metadata-only snapshots are retained.
No private source bytes are committed or newly copied for this review.

All 3791 files in the complete retained preparer TMP tree have equal bytes and
mode/mtime/ctime before/after every attempt; it was never cleaned or changed.
This complete-tree scope differs from its historical 3789-file selected-root
count. Our two new 940-file candidate copies are regular, read-only trees at
`/private/tmp/safe-bash-owned-output-receipt-review-zqBitE/{source-route,packaged-route}`.
Each logged verifier child was bounded and synchronously reaped; no background
worker remains. There were no installs, private builds/worktrees/symlinks,
upstream patches, original-state repairs, or root source/config/export edits.

Foreign public `src/shell/runtime.ts` changed during r2 and is recorded with exact
before/after hashes in `verification.json`; it never entered the frozen build.
Public root inputs and foreign staging stayed equal during the measured pass.
Unrelated live work and native temporary artifacts were preserved.

Limits: the private inventory excludes `.git`, `node_modules`, `dist`, `.cache`,
and `.turbo` within the engine walk. It does not authenticate excluded content,
unrelated untracked content, directory metadata, atime or nanosecond timestamps.
Sequential before/after observations do not prove atomic, intervening or future
state. No unresolved **assembly identity** discrepancy remains within the
enumerated bytes; actual SafeJS capability/lifecycle behavior remains untested.

## Bounded reproduction

From this repository, `node tests/integration/safejs-owned-output-prototype-review/receipt-review/start.mjs attempts/r3`
uses a new output namespace and regular TMP directory, refusing existing outputs.
It never runs either author restore or product/guest/private code. It requires the
unchanged retained preparer tree and existing Node/Python/Git tools. Canonical
package tests were not run or changed. This review and its captures are confined
to the newly assigned receipt-review directory; the atomic commit includes no
foreign paths. ROOT must authorize any subsequent actual-engine phase separately.
