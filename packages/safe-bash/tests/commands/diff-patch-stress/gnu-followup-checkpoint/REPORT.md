# Independent final GNU followup checkpoint

**Not accepted: 3,722 pass / 36 fail / 3,758 Node tests.** All 70 author and
independent test files ran, across 17 suites. Skip, cancellation and TODO counts
are each **zero**. The runner exits **1**; no failure was filtered or converted
into a pass. This verifier changed only this new checkpoint directory.

## Frozen identity

Capture began after `/tmp/safe-bash-diff-source-checkpoint.ready` authorized it.
The marker confirms source and safety-test writers closed after `695eb07`
(failed-deletion reject orientation), `6c9e5e0` (safety stripping reconciliation),
and candidate corpus `e6f2e64`. No preliminary product run is reused.

- HEAD: `695eb079c223077da2010872d59effdff15b17f3` **plus the real working tree**.
  Uncommitted shell runtime, network implementation/tests, SafeJS probes and
  other selected inputs were copied, not replaced with a Git archive. Full
  status, index entries and per-file hashes are in the external `identity.json`.
- Evidence: `/tmp/safe-bash-diff-gnu-final-3X0YYP`; snapshot: its `snapshot-1/`.
  macOS resolves `/tmp` to `/private/tmp`; these are the same snapshot, not a
  different checkout. Execution ran **2026-08-26 22:32:16.555–22:33:32.723 UTC**.
- All **833** selected files matched before copy, after copy and in the copy,
  on the first attempt. Aggregate SHA-256:
  `9642a76c15522d246a93223633d19788864f23a73684f4dcb95e384332e0b49f`.
  Every input stayed unchanged through tests/build and supplemental diagnosis.
- Included: all `src/`, `tests/`, benchmark implementation/fixtures/config,
  root package/lock/TypeScript configs, AGENTS and README. Excluded: existing
  native temporary directories, dependency directories, benchmark reports,
  live `dist/`, `.git/`, and unrelated root documentation. Exact rules and
  excluded native prefixes are in `CHECKPOINT.json.inputs` and `run.mjs`.
- Snapshot `node_modules` links only to
  `/Users/kjopek/Workspace/safe-bash/node_modules`. All **318** dependency
  entries were fingerprinted before/after and remained identical. Node
  **22.22.2**, TypeScript **5.9.3**, tsx **4.23.12**, `@types/node` **22.20.1**.
  Nothing was installed; no runtime dependency was added.
- No unexpected compiled JavaScript siblings exist in the tested source/test
  graph before or after execution. The earlier 45-artifact cleanup proof and
  verification were copied from `.git/` into external evidence and hashed.
  Build output exists only in snapshot `dist/`; all typechecks use `--noEmit`.
- Fixed-path audit: GNU binaries and explicit Apple references are external
  oracles only. Historical `gnu-target-classification/probe.ts` imports an old
  frozen snapshot, but is **not executed or imported by these tests**; its
  evidence test reads captured JSON. Root-only `validate.mjs` scripts are not
  invoked. No executed product import targets live or old-root source.
- Mandatory `gnu-target/oracle.ts` pins passed before/after: GNU diffutils 3.12
  (`f13ef516c397b0281818ffe8685aa763100b56a6549295c91849c6af937a83c9`),
  GNU patch 2.8
  (`c060444da0e547de6f17594baf0b5015a04f5b3277131ca12b1da27c621aee00`).
  Apple diff/patch pins also passed. The few Git reference flows use Apple Git
  2.50.1; its launcher/resolved-binary hashes are supplemental **after-capture**
  identity, not a claimed before/after pin.

## Complete census

| Suite | Pass | Fail | Total |
| --- | ---: | ---: | ---: |
| Author `diff-patch` | 1302 | 23 | 1325 |
| absolute-target | 30 | 0 | 30 |
| compatibility | 110 | 0 | 110 |
| editflows | 30 | 1 | 31 |
| emptyfile-delta | 83 | 6 | 89 |
| formats | 1069 | 0 | 1069 |
| fuzz | 37 | 1 | 38 |
| gnu-auxiliary | 56 | 0 | 56 |
| gnu-candidate-followup | 21 | 0 | 21 |
| gnu-editflows | 70 | 5 | 75 |
| gnu-safety-strip-followup | 6 | 0 | 6 |
| gnu-target | 27 | 0 | 27 |
| gnu-target-classification | 7 | 0 | 7 |
| gnu-target-followup | 23 | 0 | 23 |
| parser-regressions | 80 | 0 | 80 |
| path-regressions | 619 | 0 | 619 |
| safety | 152 | 0 | 152 |
| **Total** | **3722** | **36** | **3758** |

`CHECKPOINT.json.suites` gives every expanded test path and exit status;
`.failures` lists **each of the exact 36 failing names**, source files, ordinal,
classification and diagnostic. Raw TAP/structured events remain external with
SHA-256 hashes, rather than being duplicated into the repository.

## Exact remaining classifications

**34 failures: external empty-directory-removal contract blocker.**
Author: one absolute `/dev/null` reverse deletion, six normal/context/unified
remove-empty invocations, sixteen absolute epoch reverse deletions. Independent:
six `emptyfile-delta` remove-empty invocations and five `gnu-editflows` pruning
flows. The broader census therefore finds **34**, not the source author's
earlier bounded count of 28.

`pruning-probe.mjs` independently executes all five nested pruning fixtures
against the built package and pinned GNU, with exact namespaces and operation
traces. GNU exits 0 and removes only eligible empty ancestors. Product deletes
the file, sees an empty directory, then `rm({recursive:false})` throws typed
`FsError` **EISDIR** and exits 2. The direct empty-directory API probe confirms
the same error and no `rmdir` method. `failure-probe.mjs` additionally proves the
author absolute case, whose original assertion omitted the error message.
All other 33 raw failures already contain the directory-removal EISDIR evidence.
Nonempty-parent siblings and unrelated empty directories remain intact.

**Two failures are expectation conflicts, not pruning failures:**

1. `quoted-path security: quoted ancestor symlink` (`editflows/quoted-safety.test.ts`).
   Exact original quoted `"alias/target"` headers with no strip option select
   basename `target`. Native GNU and product both exit **0**, write only `first`
   and `target`, and retain the alias/referent identities and full remaining
   namespace. The old assertion expects 2. A separate `-p0` control retains the
   ancestor and proves product rejection **before any mutation**. This is the
   quoted counterpart of the stripped-prefix reconciliation, not permission to
   follow a selected symlink. The existing failing test was not edited.
2. `atomic extension malformed backward-second-hunk is not swallowed after a valid file section`
   (`fuzz/edits.test.ts`). Its complete repeated `@@ -1 +1 @@` hunk is a
   **misordered applicability conflict**, not truncated syntax. Pinned GNU
   exits **1**; ordinary product execution exactly matches GNU stdout, rejects,
   backups and namespace. Product `--atomic` also exits **1**, with no writes
   and the entire original namespace unchanged; the old assertion expects 2.
   A separate genuinely truncated hunk returns **2** in both implementations,
   with atomic product state unchanged. GNU is never passed `--atomic`.

These diagnoses do **not** alter the 36-failure acceptance result. Route the
safe nonrecursive empty-directory primitive to Curie/Poincare, then integrate
pruning without recursive deletion, swallowed EISDIR or skipped cases. Route
the two expectation reconciliations to their test owners with the captured
native and namespace proof. No source fix or existing-test edit was made here.

## Original 30 and source followups

The historical 2,909/2,939 checkpoint remains untouched. `CHECKPOINT.json.original30`
maps every original name to its current product and/or calibration assertions:

| Original category | Count | Current disposition |
| --- | ---: | --- |
| GNU selector defects | 12 | Original mandatory comparisons pass |
| GNU literal ranges/asymmetric fuzz defects | 2 | Original mandatory comparisons pass |
| GNU native-native C0 gates | 6 | Exact native exit-2 calibration; separate product correctness passes |
| Apple reverse corruption gates | 5 | Exact native wrong-byte calibration; separate product correctness passes |
| Parser-native gates | 5 | Four grammar rejections and one bounded timeout retained; product checks pass |

The calibration source hash remains
`f10b84f6000f7c68eaae12fc726c828b913c97cc5c0e49d5108bee1a49774c28`.
Sixteen native-negative calibrations are **not sixteen successful native edits**.
Independent formatter/edit checks and product parser assertions still run.
Historical calibration artifacts were included in the immutable input census.

The 27 previously identified followup gaps and two candidate reviewer causes
are covered by the fully executed auxiliary/target/safety/path/parser/candidate
cohorts; those cohorts pass, without hiding failures in the wider census.
Resumed source commits: `15159dd`, `7822b5f`, `efa56b3`, `87085fd`, `56e2c63`,
`695eb07`; regression/handoff commits: `6982d43`, `e6f2e64`, `2206a92`, `6c9e5e0`.
Earlier GNU fixes `d05c582`, `05dee32`, `3c4a1b0`, `7f7fe63`, `cccf34c`,
`bb74849` remain included. The final author census includes the 44 new
reject-orientation tests, not just the earlier moving-tree author run.

## TypeScript, build and public package

- Frozen whole-repository `npm run typecheck -- --pretty false`: **exit 0**.
- Existing `npm run build -- --pretty false --outDir SNAPSHOT/dist`: **exit 0**.
- Public-package probe: **exit 0**, using plain Node **without tsx**. It resolves
  `virtual-bash` to snapshot `dist/index.js`, executes exported
  `createDiffPatchCommands()`, and installs `diffPatchCommands()` in `Shell`.
- The fixture is extracted from the **actual existing benchmark implementation**:
  115 fixtures + 3 probes = 118 tasks. No comparator implementation was duplicated
  or run. The exact script is
  `diff -u --label old --label new old new > change; patch /fixture/old < change; cat old`.
  Stdout is exactly `patching file /fixture/old\na\nc\n`, stderr empty, status 0.
  The complete VFS is `/`, `/fixture`, and exactly `old`, `new`, `change`;
  all three file byte sequences match the benchmark expectation. No host fallback.
- Fresh **live**, non-snapshot typecheck at **22:37:07–22:37:10 UTC**, HEAD
  `6854a6b56b47f2449a4b26f5d012975b252a4c33`: **exit 0**, with stable source/test/
  config hashes during that check. This is separate from the frozen result and
  supersedes neither the snapshot identity nor earlier recorded WIP errors.
- Supplemental diagnosis rechecked every frozen input and emitted build file
  unchanged. `lsof` found **zero processes** with cwd inside the snapshot.

## Reproduce and limits

From `/Users/kjopek/Workspace/safe-bash`:

```sh
node tests/commands/diff-patch-stress/gnu-followup-checkpoint/run.mjs
```

The runner refuses to capture without the readiness marker, creates a unique
`/tmp/safe-bash-diff-gnu-final-*` snapshot, preserves nonzero logs, and never
writes live `dist/`. It discovers every author/independent `.test.ts` file,
uses strict unhandled rejections, and rejects skips, TODOs or cancellations.
Native fixtures/build output are declared outputs; source and input manifests
must remain unchanged. Set no test-filtering environment overrides.

For this capture, the supplemental `failure-probe.mjs` was independently copied
and hash-frozen in external `diagnostics/`, then run with snapshot cwd. Its exact
command/hash is in `CHECKPOINT.json.diagnosticProbe`; it imports only the frozen
built product. It is a diagnostic reproducer of these six cases, not an
additional passing-test denominator. Full before/after namespaces are external.
`summarize.mjs EVIDENCE` emits an `apply_patch` document for the compact manifest;
it fails on an unknown failure class or changed product input/build output.

This is not universal GNU/BSD compatibility, full Bash/project acceptance,
remote-adapter validation, comparator superiority, or evidence of 72 hours of
work. It does not claim an all-green checkpoint.
