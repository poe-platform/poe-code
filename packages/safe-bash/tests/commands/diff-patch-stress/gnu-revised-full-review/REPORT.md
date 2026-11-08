# Independent revised-full review

## Paired checkpoint (broader validation not green)

This reviewer is distinct from expectation editor93986. Only this NEW directory
is owned. No source, filesystem, contracts, existing tests/helpers, root files or
editor artifacts are changed. No `.test.ts` file is added.

ROOT's `/tmp/safe-bash-diff-revised-full-editor.closed` authorized review of
editor commit `5ddce1b0550ad7de8f2a8082f0402fae7aa001b7`. No final delta audit or
full cohort ran before that marker. All eleven editor artifacts match that
commit before and after this review; no editor output was altered.

| Separate cohort | Pass | Fail | Tests | Raw aggregate exit |
| --- | ---: | ---: | ---: | ---: |
| Literal original full, freshly rerun once | 3750 | 8 | 3758 | 1 |
| Revised full, freshly rerun once | 3758 | 0 | 3758 | 0 |
| Original30, historical only; NOT rerun | 14 | 16 | 30 | Historical failure |

Both full cohorts execute all **70 files in 17 groups**, with **zero skipped,
cancelled or TODO cases**. Raw TAP counts independently equal JSON reporter
pass/fail events. Every per-name/file/nesting census equals both the archived
original census and its paired counterpart. The original failing suite processes
really return 1; their failures are never suppressed or relabeled as passes.

One frozen actual-source tree runs original first, then receives only the audited
three-file expectation delta before revised runs. Original test bytes are restored
afterward. All237 original files and all70 test identities remain intact in the
live repository and restored snapshot. This is not a replacement subset, a new
original30 result, or full-product acceptance.

## Exact delta audit

`audit.mjs` uses TypeScript 5.9.3 AST locations to isolate **six** permitted
expected-value/expected-namespace sites in the exact three original files. All
remaining tokens are identical, including inputs, options, fixtures, helpers,
actual-value expressions, control flow outside expected construction, and test
registration. New expressions are independently evaluated across both quoted
cases, all17 original malformed inputs, and both pruning predicate outcomes.
`delta-reviewed.diff` retains the full before/after diff; `delta-audit.json`
retains every changed expression and original/revised/residual-token hashes.

- `editflows/quoted-safety.test.ts`: only the quoted-ancestor case expects status0,
  exact first/target output, and first/target bytes `new\n`; alias and referent
  remain unchanged. Quoted-final sibling retains status2 and unchanged bytes.
- `fuzz/edits.test.ts`: only complete backward-second-hunk expects atomic status1;
  both original no-write byte assertions remain unchanged. Other16 malformed
  expectations remain2. The independent true-truncation control remains status2.
- `emptyfile-delta/emptyfile.test.ts`: six normal/context/unified apply vectors,
  crossed with `-E` and `--remove-empty-files`, decrement expected root nlink4→3
  after parent removal. The original observer records only rm(file), not rmdir;
  its expected trace now reflects that limitation, not a directory-rm fallback.

## Freeze and boundaries

- Evidence: `/tmp/safe-bash-diff-revised-full-WB04o4`; canonical snapshot:
  `/private/tmp/safe-bash-diff-revised-full-WB04o4/snapshot-1`.
- Actual working-tree capture at HEAD `6df52ef13b40d0f51f0a610063b33cb3fcd7eef0`,
  not a Git archive. **1530 inputs**, **318 dependency entries**, stable copy on
  attempt1; Node22.22.2, TypeScript5.9.3, tsx4.23.12, @types/node22.20.1.
- Paired execution: **2026-08-27 00:04:02.019–00:06:46.065 UTC**, which is
  **August 26 in America/Chicago**.
- Source before/after SHA-256:
  `a1c82c6caac9b8703757d6448dd77da6e23667c99eef01661ed781677662e5f5`.
- Dependencies before/after SHA-256:
  `2ae2d5c2f258eee84f94640fd96662fe98365c4d6e99f6952884afc0bf3f8eee`.
- Original frozen-input aggregate:
  `3d6ddf2afbba4174a79f4048881f888596e1ed061d0179bdb0ea39df35f24c8e`.

The unchanged editor runner is executed independently in `--proof-only` mode to
copy actual sources/dependencies and verify its proof. Its capture is not this
reviewer's oracle. `run-review.mjs` then uses unchanged historical guard,
reporter and public-fixture tools for the paired full run. Every test/compiler/
probe command has explicit snapshot cwd, strict unhandled-rejection handling,
canonical snapshot-only module loading, and bracketing input/source/dependency/
binary hashes. Dependencies are copied, never linked back to live node_modules.
There are no JS siblings and only snapshot `dist` receives compiler emission.
The independent import audit observes357 modules, including source and dist.

All declared src/tests/benchmarks/config inputs are copied; historical native
scratch, benchmark reports, dependencies (separately copied), and this review's
generated `.work` are explicit exclusions. No original test is excluded. Later
concurrent live source has aggregate
`ece9446d969974de4c006efb107cca2857fdea8408bb2841ef93a5360345b48d`, different from
this checkpoint; frozen results do not validate those later edits.

## Types, build and consumer

- Original70/revised-expectation scoped `tsc --noEmit`: **exit0**.
- Whole frozen-repository `tsc --noEmit`: **exit2**, ten unrelated diagnostics.
  `src/commands/table-text/comm.ts:20` has an ArrayBufferLike/ArrayBuffer mismatch;
  archive test mismatches occur at `options.test.ts:84`, `options.test.ts:86`,
  `safety.test.ts:31`, `safety.test.ts:32`, `safety.test.ts:33`,
  `safety.test.ts:34`, `safety.test.ts:35`, `safety.test.ts:153`; the additional
  `safety.test.ts:168` diagnostic is possibly undefined access.
- Whole snapshot build: **exit2**, the same `table-text/comm.ts:20` error.
  These are the actual later frozen failures, not the editor's earlier archive
  build diagnostics. No unrelated source or tests are changed.
- Plain Node public-package absolute-VFS fixture: **exit0**, resolves snapshot
  `dist/index.js`, with exact stdout `patching file /fixture/old\na\nc\n`, empty
  stderr and exact full namespace. It uses the actual benchmark fixture and no
  TypeScript loader or host fallback. Passing against emitted output is **not**
  a successful build. Snapshot build-output aggregate:
  `0a7c0c331e2509b71aa95eccc29d8b575a32f7d503d39e2a5c2f00f11cdc27ac`.

## Independent supplemental proof

The first independent product supplement returns **1** because this reviewer's
new probe assumed native mode0644 for MemoryFS-created backup/reject files.
MemoryFS uses default0666, matching the original product target; bytes/nlink
matched. This is an owned probe expectation error, not an editor or product bug.
The raw failed log and initial tool bytes are retained. ROOT approved the exact
own-tool correction in a separate marker, SHA-256
`fdd92af6a03c08c4e54a96ffae706f534e9d2182732cd1aedfff4d4f32de20f0`.
New backup/reject modes are explicitly asserted as0644 for native fixtures and
0666 for MemoryFS fixtures, including an independent initial-target mode check;
no mode field is omitted or normalized away.

The supplemental command **passes0** on the **same** source/dependencies/dist,
at **2026-08-27 00:12:08.167–00:12:08.689 UTC**. It adds one separately hashed
reviewer script under the snapshot review directory, never overwrites an existing
frozen input, and retains the old failed script. No full cohort, typecheck or
build is rerun. `SUPPLEMENT.json` retains source/dependency/build-output hashes
before and after, approval, exact argv/cwd and both tool hashes:

- Original failed tool:
  `1b58877bc7f34e83ed11754c1f6e4e6a2ece778c846fdfafdc920131653b3720`.
- Corrected tool:
  `11b71a6ea97607b373b81e9dee0f75d41f757078f19a4c9c0c4cb378d1da02a4`.

The final `native-product.json` separately records **eight GNU conflict proofs**,
**one true-malformed GNU control**, **nine Apple controls**, **two GNU diff
regenerations**, and **eleven product checks** (eight ordinary counterparts,
one atomic complete-conflict check, and ordinary/atomic true-malformed checks).
These are not additions to full3758. GNU never receives `--atomic`.
All six product deletion counterparts assert the exact primitive sequence
**rm(file), rmdir(parent)**, never directory rm or recursive fallback; their
original-root nlink changes4→3. The atomic conflict returns1 with zero mutations
and exact unchanged namespace; truly malformed input returns2.

## Independent native preparation

`probe.mjs native-preparation.json` ran eight disputed inputs under hash/version
pinned GNU diffutils 3.12 and patch 2.8. Complete namespace assertions pass for all
eight. A ninth true-truncation control separately returns GNU status2. Nine fresh
Apple controls retain their own raw outcomes; they are not GNU acceptance.
GNU receives no `--atomic` option. Atomic no-publication is a separate product
extension checked only after closure on frozen product bytes.

The probe retains every entry, bytes, directory, symlink target, device/inode,
link count, all hardlink equivalence classes, status and both output streams.
The original fixture root is mapped to `/fixture` inside a bounded private native
root. Its sibling `/outside` contains a sentinel, hardlink and symlink; that entire
namespace is asserted unchanged. All six deletion cases show original-root
directory nlink **4 to 3**. No outside path is filtered out of assertions.
Native APFS directory link counts count all children; Memory directory counts
count child directories. Raw values are retained and checked against explicit
per-backend changes, not normalized into fake cross-platform equality.

`originals.mjs` verifies all **237** original test/evidence files against both
Git `4d4f5ca` and the manifest at `c623665`, plus exact discovery of **70** original
test files. TypeScript AST extraction of original pure functions and vectors
independently reconstructs all eight literal inputs and the malformed control.
No editor capture supplies a native expected outcome.

## Limits retained

- Separate revised96, consumer61 and independent200 are not full3758 counts.
- S3/WebDAV `ENOTSUP` is explicit lack of capability; external adapter77/79 is
  not all-success or evidence that remote empty-only removal works.
- Overlay raw-lower mutation retains 0/3 child-preservation outcomes outside the
  preexisting immutable-lower/exclusive-upper contract. This is neither a new
  in-contract bug claim nor general race safety.
- Mount alias data loss is outside this review and is not investigated.
- Native execution is test-only. No host fallback or runtime dependency is added.
- No universal GNU/Apple parity, full-shell/product completion, 72-hour work, or
  superiority over just-bash is claimed.

## Evidence and reproduction

`RESULT.json` preserves the paired run and its initial failed reviewer probe.
`SUPPLEMENT.json` records the separate corrected probe; it does not overwrite
that result or turn the whole build green. `ARTIFACT-CHECK.json` verifies all
original237/70 and editor11 identities after completion, and all **533** lossless
archive members (**15,035,934 raw bytes**), including TAP/events, original files,
actual frozen product source, capture manifests, diagnostics and both probe tools.

- Final native/product proof SHA-256:
  `ee818cf2f320567cc30e417315407cc5730abd9cd91a90b5ec70116aeb952475`.
- Independent delta-audit SHA-256:
  `a7d2646550db6f4cfc4bbe08a97cca8fa822067936775dce579f8a546fb7b9d5`.
- Lossless evidence archive SHA-256:
  `84e89605125bbc5893a80ed1bb0047cae5ac0376f59c9135f325b87c1008e279`.

From the repository root, verify delivered evidence without rerunning a cohort:

```sh
node tests/commands/diff-patch-stress/gnu-revised-full-review/verify-artifacts.mjs
node tests/commands/diff-patch-stress/gnu-revised-full-review/read-evidence.mjs review/original.json
node tests/commands/diff-patch-stress/gnu-revised-full-review/read-evidence.mjs review/revised.json
node tests/commands/diff-patch-stress/gnu-revised-full-review/read-evidence.mjs supplement/summary.json
```

For a new authorized actual-working-tree experiment, first regenerate independent
native preparation (`probe.mjs` with the `native-preparation.json` output path),
then run `originals.mjs`, `audit.mjs`, and `run-review.mjs` from this directory's
paths. The latter uses ROOT's marker, performs a fresh capture, and runs both
full cohorts exactly once; it is not a command for reproducing a historical
snapshot after live sources change. Unknown failures remain nonzero. The
supplement driver is single-use per corrected tool hash and refuses overwriting
an existing frozen tool. Only this review directory is committed; no `.test.ts`
file or another worker's staged change belongs to this commit.

Formatting note: the losslessly retained raw Git diff has one conventional blank
context line at `delta-reviewed.diff:57` (a single leading space). Git's generic
trailing-whitespace check flags that evidence line; it is intentionally not
rewritten. The remaining owned artifacts pass the whitespace check, and all
reviewer JavaScript tools pass `node --check`.
