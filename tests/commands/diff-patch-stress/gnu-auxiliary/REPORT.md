# GNU auxiliary authorization: independent checkpoint 1

Date: August 26, 2026. This is a bounded leaf-verifier checkpoint, not acceptance
of the changing source tree. No product source, backend, existing tests, or
historical evidence was edited. All new files are confined to this subtree.

## Results

- Native/VFS capture: 50 cases; 43 pass, 7 fail. GNU semantic parity is **27/34**;
  intentional VFS safety assertions are **16/16**, separately classified.
- Dedicated test command: **49/56 pass, 7 fail, 0 skipped, 0 todo**, exit 1.
  The extra six checks are five atomic-extension authorization mirrors and one
  source-stability assertion. All six passed; GNU never receives `--atomic`.
- Strict scoped TypeScript command: exit 0, no diagnostics.
- Full namespace snapshots include every native fixture entry and every VFS
  entry, file bytes, symlink text, and file hardlink counts. VFS safety/dry-run
  snapshots additionally preserve inode, device, mode, and directory link counts.
  Native inode numbers, timestamps, and directory link counts are not compared
  across backends. Native/VFS stdout and stderr are captured, not asserted equal.

Commands executed from the repository root:

```sh
node --import tsx tests/commands/diff-patch-stress/gnu-auxiliary/capture.ts checkpoint-1
node --import tsx --test tests/commands/diff-patch-stress/gnu-auxiliary/authorization.test.ts
node_modules/.bin/tsc -p tests/commands/diff-patch-stress/gnu-auxiliary/tsconfig.json --pretty false
```

The capture is diagnostic and records failures without exiting nonzero; the
dedicated test command is the acceptance gate and fails on all seven gaps.
Capture files are immutable: future diagnostics must use a fresh checkpoint
number. No missing native proof is skipped or substituted with another oracle.

## Seven actionable failures

| Fixture | GNU status | VFS status | Source cause at checkpoint |
| --- | ---: | ---: | --- |
| `dry-run-mismatch-unused-orig-symlink` | 1 | 2 | `patch.ts:211` calls `authorizeOutputs` for a backup that dry-run never writes |
| `dry-run-mismatch-unused-rej-symlink` | 1 | 2 | `patch.ts:211` authorizes an unwritten dry-run reject |
| `selected-short-name-unused-header-symlink` | 0 | 2 | `patch-gnu-paths.ts:56` inspects an unselected header path |
| `selected-short-name-unused-header-hardlink` | 0 | 2 | `patch-gnu-paths.ts:64` requires every candidate, not only the selected target, to be non-hardlinked |
| `default-strip-unused-raw-prefix-symlink` | 0 | 2 | `patch-gnu-paths.ts:56` traverses a raw prefix removed by default basename selection |
| `strip-one-unused-raw-prefix-symlink` | 0 | 2 | Same raw inspection despite explicit `-p1` stripping the prefix |
| `index-unused-symlink-unified` | 0 | 2 | Raw inspection includes an unused `Index:` header despite unified old/new names selecting `target` |

Source paths in this table are relative to `src/commands/diff-patch/`.
Exact fixtures, literal argv, output bytes, and before/after namespaces are in
`evidence-checkpoint-1.json`. Default replacement input is:

```diff
--- target
+++ target
@@ -1 +1 @@
-old
+new
```

The dry-run cases replace `-old` with `-absent` and use `--dry-run`. GNU reports
`Hunk #1 FAILED at 1.` and leaves the complete fixture unchanged. VFS instead
reports `symlink paths are unsupported: /laboratory/work/target.orig` or `.rej`.
The five successful GNU cases report `patching file target` and change only the
selected target bytes; VFS rejects the unused link instead.

Recommended source-author direction: retain lexical rejection of unsafe automatic
headers, but distinguish raw header syntax, candidate ranking, selected-target
authorization, and outputs actually written. Do not traverse stripped or unused
header paths merely to authorize them. Do not authorize dry-run auxiliary writes
that cannot occur. Keep actual selected-target and actual output checks; do not
turn these failures into unsupported inputs or waive them as security exceptions.

## Passing evidence and intentional constraints

Exact success now tolerates unused `.orig`/`.rej` symlinks, dangling symlinks,
hardlinks, reject aliases of the target or input, backup/reject paths that are
themselves input files, and unused auxiliary names also patched later. Inspection
before fixture creation saw older eager auxiliary preauthorization; the captured
source already contains the author's actual-output authorization changes.

Explicit absolute VFS positional targets pass, including when irrelevant headers
name a symlink. Default basename stripping, `-p0`, `-p1`, normal-format `Index:`
selection, and unused ordinary unified `Index:` selection pass their controls.

Actual auxiliary symlink/hardlink writes, target/input/output aliases, selected
target symlinks/hardlinks, symlink input, and symlink ancestors remain rejected
without VFS namespace or identity changes. Automatic absolute/traversal headers,
including an unused traversal header, remain rejected. These are separately
asserted intentional safety constraints, **not GNU semantic passes**. The
host-only explicit-target case returns VFS status 1 instead of reading the host
file; all product invocations also leave the complete host fixture unchanged.

## Oracle and source stability

Pinned oracle: `/tmp/safe-bash-gnu-oracle.Yg2F0W/patch-2.8/src/patch`, GNU patch 2.8,
SHA-256 `c060444da0e547de6f17594baf0b5015a04f5b3277131ca12b1da27c621aee00`.
The shared oracle helper verifies executable hash and version, with no fallback.
Native calls use literal argv, no shell/eval, a 3-second timeout, a 256-KiB output
bound, and `LC_ALL=C`, `TZ=UTC`, `PATCH_GET=0`. Temporary roots are created only in
this subtree, contain an ancestor sentinel and an isolated working directory,
and are removed only after root ownership and sentinel checks. Product execution
uses the command definition directly against memory VFS; never native exec.

Capture interval: `2026-08-26T21:36:56.653Z`–`2026-08-26T21:36:57.778Z`.
All 117 recorded source/oracle files have identical before/after hashes.
The dedicated tests' independent source-stability assertion also passed.

Important checkpoint SHA-256 values:

- `patch-gnu-paths.ts`: `3c090ca0598514976b621cfa5b0819a0ba2f873548cfe7d117bd731316fc5ad2`
- `patch.ts`: `d09ac1e3edee78dc79fa2e446bf101de90706be3a58977b10a24a93f8fabb9f4`
- Imported `gnu-target/oracle.ts`: `ad9920197aa38291dfff5d04170c5e1b87cd225bf590c8073a8ebba8c68181cc`

A subsequent source-hash check already detected changes to `patch.ts`,
`patch-gnu-reject.ts`, and the diff-patch README after the captured run. These
results belong to the recorded hashes, **not the current moving source tree**.
No final acceptance, broad compatibility, full-shell completion, or superiority
claim is made. Re-run this focused suite after the author finishes remediation.
