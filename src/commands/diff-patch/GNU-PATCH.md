# GNU patch target and publication contract

The project utility target is GNU Diffutils 3.12 and GNU patch 2.8. This patch
implementation runs entirely against the supplied virtual filesystem, with no
runtime dependencies, subprocess oracle, host-shell fallback, or filesystem
adapter changes. The native executables are development-test oracles only.

## Noninteractive default

The virtual command cannot prompt on a controlling terminal. Its default
explicitly chooses GNU `--batch` decisions, including automatic reversal when
the first hunk matches in the opposite direction, or a creation/deletion's
existence contradicts the patch. This is not GNU's interactive prompting mode.
`-t` / `--batch` selects that same behavior; `-f` / `--force` suppresses automatic
reversal and remains in force if `--batch` also occurs. Default fuzz is two;
`-F0` requests exact context. Last format selector wins.

Matching hunks publish even when other hunks fail. A conflict returns status 1,
writes rejects, and does not prevent later file sections from being attempted.
Repeated targets read earlier published bytes. A later malformed section returns
status 2 while retaining completed earlier sections; a malformed hunk does not
publish its incomplete file section. Input/resource/safety failures can still
stop processing before publication. Transport/envelope validation remains
bounded and requires complete physical patch lines.

Default `-R` reverses each section without reversing section order. Default
`--dry-run` checks each section against the unmodified filesystem, not an
imagined earlier result, and creates no targets, parents, backups or rejects.
It does not authorize unwritten backup/reject destinations. Creating a short
target and then editing it can therefore succeed while default dry-run selects
and refuses a different pre-existing symlink; dry-run still leaves the namespace
unchanged. Atomic dry-run deliberately uses the staged chain instead.
Diagnostics identify failures, offsets and reversals, but are not claimed to be
byte-for-byte GNU terminal diagnostics.

## Paths and auxiliary files

Without `-p`, automatic selection uses the basename; explicit `-p0` retains the
relative path. Existing candidates are ranked by fewest path components, then
shortest basename, then shortest complete name, retaining the first on a tie.
For a missing creation target, fewer new parent directories takes precedence.
Normal patches recognize `Index:`. GNU discards Index when usable old/new header
names are present; Index is not an extra override of unified/context names.
An explicit positional VFS target always wins and is not stripped, including an
authorized absolute target. Bare unlocated normal text is not autodetected as a
patch; explicit `-n` recognizes it but cannot choose a target and skips it.

Default mismatch backups contain the original target bytes on its first touch
in an invocation. Fuzz, offsets, rejected hunks, and first-hunk reversal can
trigger a backup. A clean first section does not acquire a backup merely because
a later section mismatches. Existing `.orig` is replaced. If numbered backups
already exist, the next `.~N~` name is used. `--no-backup-if-mismatch` disables
these backups; `--backup-if-mismatch` re-enables them. Environment-driven backup
naming/version-control modes and optional GNU backup flags are not implemented.

Default rejects use `TARGET.rej`; `-r NAME` / `--reject-file=NAME` changes that
destination and `-r -` discards rejects without disabling mismatch backups.
Existing regular reject contents are replaced on the first reject write and
appended to for subsequent sections of the same invocation. Unified rejects
preserve timestamps and section labels with adjusted coordinates; normal rejects
use GNU's context representation. Incomplete-line rejection bytes deliberately
retain the native oracle's lack of an added newline marker.

Automatic absolute headers, traversal, drive-like components and control bytes
remain prohibited. Symlinks and hardlinks in selected targets or actual outputs
are rejected, but unused candidates and stripped raw prefixes are not authorized.
Candidate `stat` failures for missing paths, non-directory traversal and looping
symlinks count as unresolved candidates; other I/O failures still propagate.
Any selected path subsequently undergoes the strict no-symlink inspection.

Whole-input target authorization accounts for earlier creation, deletion,
reversal, failed hunks and newly created parents. When a later section has a
choice of candidates, preceding results are previewed with the same application
logic and invocation budgets used by execution. Default execution still reselects
against the current filesystem; atomic execution uses staged state. This does
not turn default hunk conflicts into all-or-nothing publication. Only auxiliary destinations actually
needed by a section are authorized. Backups/rejects cannot alias a target,
input, or one another. Each operation rechecks its path; portable contracts do
not provide race-proof descriptor-relative mutation or a transaction.

Creation authorizes and creates missing parent directories. Deletion and `-E`
request nonrecursive empty-ancestor removal: relative targets stop at cwd,
explicit absolute targets may remove cwd, and virtual `/` is never removed.
Nonempty ancestors and unrelated empty directories are retained. Reject parent
directories are not implicitly created, matching the native failure behavior.

**Empty-directory consumer follow-up:** contract commit `1dc0652` supplies
optional `FileSystem.rmdir(path, options?: FsOptions)`. The consumer uses this
empty-only operation with the command signal and original receiver, never
`rm` or recursive deletion. Missing support is typed `ENOTSUP`. An ancestor
that disappears (`ENOENT`) or becomes nonempty at removal (`ENOTEMPTY`) is an
expected native-compatible outcome; neither implies a directory was removed.
Authorization, ancestor bounds and symlink/type inspection remain in place.

Pinned GNU patch 2.8 ignores *all* pruning errors. Ten separately captured
native probes, including actual permission denial and explicitly instrumented
race/IO errors, confirm status 0 and empty stderr even when ancestors remain.
This consumer deliberately reports unsupported, permission and transport
failures instead: an explicit safety divergence, not exact GNU error parity.
File publication can already have completed; pruning does not add rollback.
See `tests/commands/diff-patch/pruning-consumer/README.md` for complete namespaces,
binary/source hashes, reproduction commands and 61 separately counted consumer
checks. Backend support is path-specific; S3/WebDAV and live merged overlays
can remain unsupported. No filesystem source is changed by this consumer leaf.

Historical pruning failures below, including the frozen `4d4f5ca`
3722/3758-pass checkpoint (34 pruning failures and two expectation conflicts),
are not retroactively reclassified. The original3758 rerun belongs to a separate
independent checkpoint; original70 test hashes and discovery remain unchanged.

## Explicit atomic extension

`--atomic` parses and validates all sections and plans final target contents
before creating any target, reject, backup or directory. Hunk, parse, alias and
preflight conflicts have no early filesystem writes. Successful same-target
chains stage their final contents. Atomic dry-run checks that hypothetical
chain; atomic `-R` intentionally processes the chain in inverse section order
as a documented extension. GNU coordinates, path ranking, default strip rules,
format selection, fuzz and reversal decisions otherwise remain the same.
The atomic extension also rejects orphan deletion payload after a complete hunk;
default GNU scanning accepts that trailing text. Bare interstitial metadata still
does not conceal later selected targets from authorization or acquire Git rename,
mode-change or binary semantics.

This is a preflight/staging guarantee, **not a filesystem transaction**. A backend
failure or cancellation during publication can leave completed prefix effects,
including backup/target writes preceding a failed reject or prune. No rollback
is promised. Supplied cancellation signals reach host work and bounded I/O;
late rejection is observed, but an uncooperative backend may still mutate after
the caller stops waiting.

## Failed-deletion reject-orientation followup

Confirmed and repaired on **2026-08-26**, following source checkpoint `2206a92`.
The exact exploratory fixture starts with `a = "wrong\n"` and
`unused-long-name = "old\n"`, deletes `old` from `a` using a `/dev/null` new
header, then replaces `old` with `new` using old/new headers `a` and
`unused-long-name`. With identical `--batch -p0` arguments, the pinned GNU patch
2.8 binary (SHA-256
`c060444da0e547de6f17594baf0b5015a04f5b3277131ca12b1da27c621aee00`)
reverses the failed deletion into a creation, rejects that creation over the
nonempty target, and appends the second section's forward reject to `a.rej`.
Both targets remain unchanged and `a.orig` contains `wrong\n`. This was a genuine
application-orientation defect, not mismatched force/batch flags or a serializer
defect. The product now retains the successful reverse-probe orientation and
applies the existing creation-conflict guard again before publishing anything.

The new `patch-reject-orientation-followup.test.ts` records complete namespaces,
exact `.orig`/`.rej` bytes, statuses, and both output streams. It covers unified
and context creation/deletion, default/batch, reverse, force, force before batch,
sequential selection, replaced/redirected/discarded auxiliaries, backup
suppression, dry-run and atomic conflicts. Virtual default is deliberately paired
with native `--batch`; force is never inserted implicitly. Native execution uses
the hash/version-validating oracle helper and isolated boundary-sentinel roots.
Native and virtual diagnostics have separate exact expectations: the existing
generalized virtual reversal message and refusal/summary ordering are not
claimed byte-identical to GNU's terminal output.

Fresh strict-rejection results (all skips, cancellations and TODOs zero):

| Gate | Pass | Fail | Total |
| --- | ---: | ---: | ---: |
| New regression suite before the source fix | 28 | 16 | 44 |
| New regression suite after the source fix | 44 | 0 | 44 |
| All author tests, including those 44 regressions | 1302 | 23 | 1325 |
| Unchanged GNU editflows | 70 | 5 | 75 |
| Unchanged GNU auxiliary | 56 | 0 | 56 |
| Unchanged GNU target followup | 23 | 0 | 23 |
| Post-fix aggregate, counting author regressions once | **1451** | **28** | **1479** |

The 23 author and five editflow failures are the known missing-empty-directory-
removal primitive (`EISDIR`) failures. No filesystem change, recursive removal
fallback, swallowed error or failure reclassification is part of this fix.
The independently reconciled author safety test is included as observed, not
edited here. Strict author/source and all three requested independent-suite
`tsc --noEmit` checks pass. The fresh global
`npm run typecheck -- --pretty false` fails at the concurrently added, unowned
`tests/shell/remote-close-probe.ts:80` (TS2722); it does not reproduce the previously
reported six network errors and is not a global pass.

Raw TAPs and compiler logs use the prefix
`/tmp/safe-bash-reject-orientation-`: `before.tap`, `after.tap`, `author.tap`,
`gnu-editflows.tap`, `gnu-auxiliary.tap`, `gnu-target-followup.tap`,
`global-types.log` and `scoped-types.log`. Source SHA-256 values:

- `patch.ts`: `b344c6f7b0f6afaccdab75778a12c11c868d7f8bccd5d453c56e552039e619fe`.
- All diff/patch TypeScript source, hashing JSON of sorted path-to-hash mappings:
  `efc37d647d9860846b9d6fc4baed2e84a4a5f50ad5f6172cbc4628c510c212f0`.
- New regression file:
  `b3d367e3c0eb0b92eaea338b948d0bf541fee6934c557cacf42a57c7cb5f213e`.

No source-tree JavaScript siblings were emitted. This closes the specific reject
orientation gap, not full GNU compatibility, the external pruning blocker, the
full project scope or the superiority requirement.

## Historical clean-source followup evidence

The root cleanup marker was observed before any resumed edit, test or Git write.
The cleanup evidence is `.git/diff-emission-cleanup-proof.json` and
`.git/diff-emission-cleanup-verification.json`. Earlier emitted-JavaScript runtime
results are not reused as acceptance evidence. Every compiler invocation below
includes `--noEmit`, directly or through `npm run typecheck`.

Fresh validation ran from **2026-08-26T22:16:09.161Z to
2026-08-26T22:16:47.972Z**. Exact argv, status, TAP hashes, every failed test name,
and per-file source/test hashes are recorded in
`/tmp/safe-bash-diff-final-2026-08-26T22-16-09.154Z-validation.json`.
Its sibling `-SUITE.tap` files retain all raw failures.

| Gate | Pass | Fail | Total |
| --- | ---: | ---: | ---: |
| Unchanged GNU auxiliary | 56 | 0 | 56 |
| Unchanged GNU target followup | 23 | 0 | 23 |
| Unchanged safety | 150 | 2 | 152 |
| Unchanged path regressions | 619 | 0 | 619 |
| Unchanged parser regressions | 80 | 0 | 80 |
| Requested five-suite aggregate | **928** | **2** | **930** |
| Independent GNU candidate followup | 21 | 0 | 21 |
| Unchanged GNU editflows | 70 | 5 | 75 |
| GNU target/calibration/policy mirrors | 27 | 0 | 27 |
| All author tests | 1257 | 24 | 1281 |
| All executed suites, aggregate counted once | **2303** | **31** | **2334** |

All skips, cancellations and TODOs are zero. The separate author-followup-only
rerun passes **83/83**, already included in the author denominator. The two
reviewed candidate defects have normal, atomic, dry-run and selected-link safety
coverage; the 21-case independent suite also checks pinned live GNU behavior.
The author additions cover pending-read cancellation, shared input budgets,
inverse-order atomic selection, repeated create/delete/recreate, parent ranking,
unused input headers and actual auxiliary aliases.

The **31 raw failures remain failures**:

- Five GNU editflows require pruning empty ancestors; MemoryFS returns `EISDIR`.
- Twenty-three author checks hit the same missing primitive: one absolute
  `/dev/null` flow, six normal/context/unified `-E` flows and sixteen absolute
  epoch reverse-deletions. The old native reference driver also stops at its
  first absolute epoch reverse-delete with `EISDIR`; it is not a 156-case pass.
- Two independent safety checks (`pre-existing ancestor` and `pre-existing
  file-parent`) and one author combined symlink check expect rejection of raw
  prefixes discarded by default basename selection. The current selected-path
  policy and GNU auxiliary/candidate controls accept those stripped-prefix
  cases. Their owners must independently reconcile the contradictory assertions;
  this worker did not edit, skip or reclassify them into passes.

At this historical checkpoint, an exploratory namespace test observed different reject orientation
for a failed deletion followed by another section. The original failure remains
in `/tmp/safe-bash-diff-resume-namespace-clean-1.tap`; reject orientation was not
yet repaired. The committed candidate-selection control explicitly uses
`-r -` for that failed-deletion case so it tests selection without that separate
reject-format behavior. No independent expectation was changed. The later
44-case followup above closes this specific gap without changing that control.

Fresh global `npm run typecheck -- --pretty false` and strict author/suite
typechecks passed. One attempted safety `-p` check failed with TS5058 because that
suite has no tsconfig; the corrected explicit-file strict `--noEmit` command
passed, recorded in the sibling `-safety-types-corrected.log`. The initial error
log is retained. Source and selected test hashes matched at the validation
endpoints; none of their TypeScript inputs had emitted `.js` siblings.
This records a bounded stability window, not a lock on other workers' source.

Aggregate SHA-256 values hash JSON objects of sorted path-to-SHA-256 mappings:

- Diff/patch TypeScript source:
  `d12aa98d997b16e67554c51a1ba674395c621c7d51f73181704837a2971429ac`.
- Executed suites' TypeScript, JSON and MJS fixture/helper inputs:
  `10ca185caa88564ef3a9639a1bf38e65a285bae65056af06e9caa9e76bdca89d`.

Resumed commits are `15159dd` (committed-prefix diagnostics), `7822b5f`
(misordered-hunk diagnostics), `efa56b3` (unused loops), `87085fd` (sequential
namespace authorization), `56e2c63` (atomic orphan-deletion guard), and `6982d43`
(reverse/budget regressions). They preserve earlier `7f7fe63`, `cccf34c` and
`bb74849`. No filesystem/contract changes, runtime dependencies, host product
execution, full-GNU compatibility or project-superiority claim is included.

## Historical publication evidence

Oracle: `/tmp/safe-bash-gnu-oracle.Yg2F0W/patch-2.8/src/patch`, reporting
`GNU patch 2.8`, binary SHA-256
`c060444da0e547de6f17594baf0b5015a04f5b3277131ca12b1da27c621aee00`.
Author `patch-gnu-publication.test.ts` validates the binary, calls it with literal
argv in unique boundary-sentinel fixtures, and compares status plus complete
file/directory namespaces. Calls have a three-second timeout and bounded output.
Product/oracle flags match; backup suppression and force are used only when the
fixture explicitly requests them. The separate default-policy control compares
the documented virtual default with native `--batch`.

Strict-rejection checkpoint on 2026-08-26, before independent root verification:

| Gate | Pass | Fail | Total |
| --- | ---: | ---: | ---: |
| New publication controls plus pinned coordinate tests | 93 | 0 | 93 |
| Owned patch, safety, hunk and cancellation tests | 442 | 23 | 465 |
| Unchanged independent GNU editflow parity and controls | 70 | 5 | 75 |

All gates have zero skips, cancellations and TODOs. The 23 owned failures and
five independent failures are empty-directory pruning failures described above.
They are neither omitted from the denominator nor relabeled successes. The
historical 156-case reference driver now stops at its first absolute-target
reverse deletion with the same `EISDIR` blocker; no full-driver pass is claimed.
Strict scoped TypeScript passes with the root compiler options and owned source
and tests as entry points. A fresh whole-repository typecheck reports an
out-of-scope TS2722 at
`tests/commands/diff-patch-stress/gnu-target-followup/helpers.ts:37`; it is not a
product-wide typecheck pass. `git diff --check` passes. Diagnostic TAP/type logs
are `.git/patch-gnu-{native-final,owned-final,independent-final}.tap`,
`.git/patch-gnu-scoped-types.log` and `.git/patch-gnu-typecheck-final.log`.

Independent evidence is read-only, not regenerated from this implementation:

- `tests/commands/diff-patch-stress/gnu-editflows/native-evidence.json` SHA-256
  `1eddde21e2cb87ca8041fba9bb354b58aaa4d33d79c8ea18b908e7849de7d9fd`.
- `tests/commands/diff-patch-stress/gnu-target-classification/evidence.json`
  SHA-256 `2fc042df35c04c46d6883c7bd3f213c80a439969ad1e422da791311baf7ab955`.

Commands from the repository root:

```sh
node --unhandled-rejections=strict --import tsx --test tests/commands/diff-patch/patch-gnu-publication.test.ts tests/commands/diff-patch/patch-gnu-coordinates.test.ts
node --unhandled-rejections=strict --import tsx --test tests/commands/diff-patch-stress/gnu-editflows/parity.test.ts tests/commands/diff-patch-stress/gnu-editflows/controls.test.ts
npm run typecheck
```

The historical all-input preflight assertions are explicitly bound to
`--atomic`, not deleted to pretend they describe GNU default behavior. Former
overlap-as-parse-error assertions are replaced by independently native-backed
default/atomic coordinate controls. Frozen older native captures are unchanged.
The old reference driver still checks target bytes/existence rather than a full
namespace; use the new publication and independent editflow suites for backups,
rejects and pruning. Historical counts in `PARSER.md` are not current results.

Primary references consulted on 2026-08-26: GNU Diffutils 3.12 manual sections
“Multiple Patches in a File”, “Backup Files”, and “patch Options”; GNU patch 2.8
source `pch.c` (`best_name`, `maybe_reverse`, Index handling), `patch.c`
(`locate_hunk`, mismatch backups and reject serialization), and `util.c`
(`removedirs`). Manual entry point:
`https://www.gnu.org/software/diffutils/manual/diffutils.html`.
Source SHA-256: `pch.c`
`8783613c48836e634cb7457396b8b81b0a57aaec53053034e2dd18d8299e5bf9`,
`patch.c` `ca20b87c33247159560d896283c7ac506f71304bdc3249d9826c8bfb92417106`,
`util.c` `67ba718ceec6cf3004d2619cd0303f9cea5c2c962603bf7ebd7978519f10bfb2`.

Neither these repairs nor these focused tests establish complete GNU utility
support, full shell completion, superiority over just-bash, or 72 hours of work.
