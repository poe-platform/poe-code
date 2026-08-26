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

Automatic absolute headers, traversal, drive-like components, control bytes,
symlinks and hard-linked target/output aliases remain prohibited. The complete
recognized target namespace is inspected for aliases, without an all-input
applicability preflight in the default. Only auxiliary destinations actually
needed by a section are authorized. Backups/rejects cannot alias a target,
input, or one another. Each operation rechecks its path; portable contracts do
not provide race-proof descriptor-relative mutation or a transaction.

Creation authorizes and creates missing parent directories. Deletion and `-E`
request nonrecursive empty-ancestor removal: relative targets stop at cwd,
explicit absolute targets may remove cwd, and virtual `/` is never removed.
Nonempty ancestors and unrelated empty directories are retained. Reject parent
directories are not implicitly created, matching the native failure behavior.

**Current blocker:** the inspected `FileSystem` contract has no `rmdir` or
empty-directory removal option; MemoryFS rejects `rm(directory, {recursive:
false})` with `EISDIR`. The implementation uses that nonrecursive call and
reports its failure after already-completed publication. It never substitutes
recursive removal. Root/Poincare must supply a safe cross-adapter contract;
no filesystem source or backend tests are owned or changed here. The resulting
native namespace failures remain failures, not capability skips.

## Explicit atomic extension

`--atomic` parses and validates all sections and plans final target contents
before creating any target, reject, backup or directory. Hunk, parse, alias and
preflight conflicts have no early filesystem writes. Successful same-target
chains stage their final contents. Atomic dry-run checks that hypothetical
chain; atomic `-R` intentionally processes the chain in inverse section order
as a documented extension. GNU coordinates, path ranking, default strip rules,
format selection, fuzz and reversal decisions otherwise remain the same.

This is a preflight/staging guarantee, **not a filesystem transaction**. A backend
failure or cancellation during publication can leave completed prefix effects,
including backup/target writes preceding a failed reject or prune. No rollback
is promised. Supplied cancellation signals reach host work and bounded I/O;
late rejection is observed, but an uncooperative backend may still mutate after
the caller stops waiting.

## Reproducible evidence

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
