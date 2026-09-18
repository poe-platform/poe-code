# ExifTool packed-consumer QA

Executed 2026-09-18 against the current dirty worktree. This document qualifies
local packing and the admitted PNG profile, not remote delivery, publication,
complete ExifTool compatibility or a release. Unrelated edits were preserved.

## Procedure and results

1. Inspect the command manifest and package-pattern plan. The implementation is
   `packages/safe-bash-command-exiftool`, named `safe-bash-command-exiftool`,
   private, TypeScript ESM, with empty runtime dependencies. Safe-bash's command
   entry only re-exports it; registration remains opt-in. The registry pins
   ExifTool 13.59 commit `2200871d9cef988051d2a99d67df3bda6cbb30a8` and archive
   SHA256 `e1e2ad6c6fbf568afee5993ef8b2b91ab013d21698c9304e079e633ad82776f5`.
   No product source repair was necessary for the packed-export checks.
2. Run `npm run lint --workspace=safe-bash-command-exiftool` and
   `npm run test:unit --workspace=safe-bash-command-exiftool`. ESLint and both
   typechecks pass; all 117 tests pass, with zero failures/skips/cancellations.
3. Run `npm run build:workspaces -- --workspace=@poe-platform/safe-bash`.
   All 12 declared build tasks complete, including guarded safe-bash build and
   its native npm postbuild. No cached or substitute build route is used.
4. Generate libraries with `node scripts/package-safe.mjs --out-dir
   out/ship-exiftool-20260918 --version 0.0.0-ship-exiftool`. Pack generated
   safe-bash and safe-fs with `npm pack --ignore-scripts`, then install both
   tarballs into a fresh consumer with scripts disabled. Its eight installed
   packages are the two artifacts and their declared public dependency closure;
   no private command/contracts package is installed. Tarball SHA256:
   - safe-bash: `6fd416fdc0540dd9e5733bfc479efd50ed5c5f8d2cd7023a3749bdb57783196f`
   - safe-fs: `fe36204469b5b4852aabcd1a3bf04326530c6bdf688a468307b915c7aa336650`
5. Execute an ESM consumer with a loader rejecting every file import outside
   its root. Import the public root, contracts/command and commands/exiftool.
   Independently reconstruct a valid one-pixel PNG, repair its IDAT CRC using
   the development Node crc32 oracle, and perform all product I/O in memory VFS.
   Assignment succeeds, the default backup is byte-identical, shared command
   runtime identity matches, inspection retains `1e999` as text, ordinary JSON
   emits lexical `1e999`, and JSONQ emits a quoted string. Typed direct-handler
   extraction exactly equals Shell CLI output. Repeated disposal succeeds.
6. Repeat the same consumer under Node `--conditions=browser` and
   `--conditions=workerd`; all controls pass. Repeat both with global Buffer
   removed after fixture construction; they still pass. These cells qualify
   export resolution and the exercised portable path under Node 22.22.2, not
   execution in a browser or the workerd engine. No such engine was run.
7. Compile an installed-consumer `.mts` importing the factories, plugin,
   inspector and ResourceLimits with strict NodeNext, ES2022 and no
   skipLibCheck. Default, browser and workerd custom-condition cells pass.
   Inspect installed JS/d.ts for bare private command/contracts imports:
   none found. Runtime isolation also rejects repository workspace resolution.
8. Capture the installed consumer with `npm run screenshot -- --output
   out/ship-exiftool-20260918/packed.png node ...` and inspect the image.
   Aligned Title output and the numeric/quoted JSON distinction are legible.
   The generic route captures the virtual command consumer; no poe-code CLI
   change requires the `screenshot-poe-code` route or a document-rendering cell.
   No screenshot test was added.

## Limits of this evidence

This task changes documentation only. It does not close the outstanding
Shell/direct-SDK resource-error diagnostic difference, format reader/writer,
native conditional status 2, import, namespace, catalog, PDF restoration,
publication-control or replay gates in the existing reviews. Unsupported
capabilities are documented rather than invented. Full repository test/lint
routes were not run; no shared runtime/build change was made by this task.
No local commit, push, verified remote-main delivery, release or standalone
private-package publication occurred.

Filesystem `/out` rejects creation with `Read-only file system`. Task-owned
tarballs, consumer, fixtures and screenshot therefore use repository `out` and
are purged after inspection. The QA procedure is Markdown, not a product QA
script. No document renderer or poe-code CLI presentation was changed.

## Ship-exiftool independent recheck

Repeated on 2026-09-18 using a fresh `0.0.0-exiftool-review` artifact and isolated
consumer, preserving the pre-existing worktree changes. Package lint/typechecks,
all 117 package unit tests and the maintained 12-task safe-bash build closure pass.
No implementation or shared build code was changed; repository-wide routes were
not rerun and outstanding broader gates are not cleared by these focused checks.

Pack generated safe-bash and safe-fs with scripts disabled, install only those
tarballs with `--ignore-scripts --legacy-peer-deps`, and inspect `npm ls --all`.
The eight-package installed closure contains no private command/contracts
workspace. A loader rejects runtime file imports outside the consumer. Default,
browser and workerd condition cells pass runtime identity, PNG assignment,
byte-identical backup, owned inspection, lexical `1e999`, JSONQ, successful
typed-handler/Shell equivalence and repeated cleanup/disposal checks. Strict
ES2022 NodeNext declaration compilation passes all three condition cells without
`skipLibCheck`; shipped JS/declarations contain no bare private specifier.

Browser/workerd runtime cells remove global `Buffer` after fixture construction.
The default Node profile uses Node's normal globals: removing `Buffer` there
fails in Shell source-byte accounting. This is a runtime-profile boundary, not
evidence of a qualified browser engine. No browser/workerd engine was executed.

Fresh tarball SHA256 values:

- safe-bash: `c66b0536d1e663a9a63dbcd2ceee1dbf8d730aff08b2b1e975e64d45ac2d8302`
- safe-fs: `4d714688f527e695f0637fa825ac142bf928c22833dac1668452924341c0a352`

Review found the safe-bash support table's relative private-sibling README link
cannot resolve in the packed installation; it now targets the repository README.
The command README states the actual portability qualification. Source inspection
found no host executable/filesystem, implicit network, dynamic code loading,
eval/Function, native/WASM fallback or runtime download in command implementation.
No unsupported simplification, proxy layer or engine replacement was introduced.
Existing tests exercise quota failures, cancellation, pending-publication ownership,
conditional mutation, staging cleanup failures and repeated cleanup. No new
snapshot or registry-version change was made.

**Validated unresolved blocker:** with `maxInputBytes: 0`, the isolated direct
handler rejects with `ExifTool input budget exceeded`, while the same packed
Shell command returns status 1 and an `internal error` diagnostic. This reproduces
the recorded failure-parity issue in the actual artifact. It remains unresolved
and blocks task completion; successful-path parity does not qualify it. Broader
reader/writer, PDF restoration, import/catalog and native protocol gates remain
open as recorded in the compatibility reviews.

Capture the virtual CLI consumer with `npm run screenshot -- --output
out/ship-exiftool-review-20260918/packed.png node --conditions=browser .../verify.mjs`
and inspect the image: JSON numeric/quoted output and the reproduced blocker are
legible with no clipping. No poe-code CLI presentation or document rendering was
changed, so `screenshot-poe-code` and document-renderer captures do not apply to
these documentation edits. No screenshot test was added.

`/out` again refused creation as read-only. Task-owned repository `out` artifacts,
consumer and screenshot are purged after review. No local commit, remote-main
delivery, release or publication occurred; the command remains private.

## Final artifact recheck (2026-09-18)

Execute the procedure above with version `0.0.0-ship-exiftool-final` in a fresh
consumer. Only documentation was edited in this recheck; existing command,
contract and packaging edits were preserved. The README now explicitly lists
rejected flag combinations, including CSV with assignments or trailing-`#`
selectors and `-G4` outside JSON extraction.

- **Pass:** maintained command lint and both typechecks; 117 unit tests, zero
  failures, skips or cancellations; maintained safe-bash build closure completes
  all 12 declared tasks and postbuild.
- **Pass:** install only packed safe-bash/safe-fs tarballs with scripts disabled.
  `npm ls --all` shows eight installed packages and no private workspace package.
  Installed JS/declarations contain no private command/contracts specifier.
- **Pass:** default/browser/workerd runtime condition cells with a loader that
  denies file imports outside the consumer. Browser/workerd cells remove global
  Buffer after fixture construction. Strict ES2022 NodeNext declarations compile
  in all three cells without `skipLibCheck`.
- **Pass:** independent one-pixel PNG base fixture with IDAT CRC repaired by
  development-only Node `crc32`; `Title=1e999` assignment, byte-identical default
  backup, shared command runtime identity, lexical SDK inspection, numeric JSON,
  quoted JSONQ, direct-handler/Shell successful output equality and repeated
  disposal. Product I/O uses memory VFS only.
- **Pass:** isolated negative controls reject `-if 1`, `-config evil.pm`,
  `-stay_open True` and lowercase `-g4 -j`, each with status 1.
- **Fail / unresolved:** deterministic minimized quota case: write the admitted
  PNG to `/image.png`, set `maxInputBytes: 0`, and extract `-j -Title`. Direct
  handler rejects with `ExifTool input budget exceeded`; Shell returns status 1
  and an `internal error` diagnostic. Reproduced in all three runtime cells.
  Shipping requirements for CLI/SDK failure parity remain incomplete.
- **Unverified:** actual browser/workerd engines, broader upstream format and
  protocol variants, checkpoint/replay and the previously recorded compatibility
  gates. Full repository test/lint routes were not run for documentation-only
  changes; focused passes do not qualify those broad gates.
- **Inspected:** generic virtual CLI screenshot shows both JSON spellings and
  the confirmed quota blocker legibly. No poe-code CLI or document rendering
  changed, so `screenshot-poe-code` and document-renderer captures were not run.

Tarball SHA256 values:

- safe-bash: `6cd8e1ef939f2a3cb3a59152333110b06e78053330d2e7aa9e5a5c3aa9d65576`
- safe-fs: `ac10770a3009064b7de9bb23522c966ce40916229939186044dfccdcc2f10f77`

Initial ad hoc consumer execution failed on a missing closing brace in the
temporary fixture harness; corrected before all runtime cells were rerun and
passed. This was not a product syntax failure. `/out` is read-only, so temporary
evidence used task-owned repository `out/ship-exiftool-final` and was purged after
inspection. No commit, push, remote-main verification, release or private-package
publication was performed. Local export verification is complete; the overall
shipping gate remains incomplete for the validated parity failure.
