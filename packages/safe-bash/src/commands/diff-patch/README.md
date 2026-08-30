# Diff and patch commands

Dependency-free author implementation for virtual-bash. Product code performs
all filesystem operations through `CommandContext.fs`; it does not import host
filesystem or process APIs, launch commands, or evaluate source strings.
There are zero runtime dependencies and no host-process or host-filesystem
fallback. An adapter may provide host storage, but commands use only the VFS.

The selected compatibility targets are **GNU Diffutils 3.12 (`diff`) and GNU
patch 2.8**, not an interchangeable GNU/BSD profile. This is a bounded
implementation in progress, not full GNU coverage. The default patch policy is
noninteractive, with GNU `--batch`-style reversal decisions; `--atomic` is a
separate library extension. Local source defines the implemented behavior.
See [GNU-DIFF.md](GNU-DIFF.md) for pinned GNU option evidence and retained BSD
observations. GNU's primary manual describes the reference policies:

```text
https://www.gnu.org/software/diffutils/manual/diffutils.html
https://www.gnu.org/software/diffutils/manual/html_node/Backups.html
```

## Integration contract

The subtree entry point is `src/commands/diff-patch/index.ts`:

```ts
createDiffPatchCommands(options?: DiffPatchOptions): readonly CommandDefinition[]
diffPatchCommands(options?: DiffPatchOptions): VirtualShellPlugin
```

The definitions are named `diff` and `patch`. The plugin is named
`diff-patch-commands`, checks both registrations before registering either, and
supports `replace?: boolean`. All options are optional. Each command invocation
gets an independent budget. The agent bundle includes `diff` and `patch`;
`diffPatchCommands(options?)` installs just that family. Existing package exports
and plugin signatures are unchanged. Existing shared contracts were inspected
and the source entry point was exercised directly through `Shell.use`.

## Supported diff subset

- Two file/directory operands, with `-` for stdin; two `-` operands share one
  captured input. A file versus directory compares the file's basename inside
  the directory. `--` terminates options.
- Normal output is the default (`--normal`); unified output is selected by
  `-u` / `--unified`.
  `-U N`, `-UN`, and `--unified=N` set context, including zero context.
- Context output uses `-c`, `-C N`, or `--context[=N]`.
- Bare unified/context selectors contribute three lines; repeated explicit
  widths select the greatest width, rather than the last one. Legacy numeric
  options such as `-0` are also parsed; their interaction with bare short versus
  long selectors is documented in [GNU-DIFF.md](GNU-DIFF.md). Conflicting output
  styles are rejected, including when brief output is requested.
- `-b` / `--ignore-space-change` and `-w` / `--ignore-all-space` affect
  comparison rather than rewriting emitted file content.
- `-q` / `--brief`, `-r` / `--recursive`, and `-N` / `--new-file`;
  short flags may be grouped. Directory entries are sorted by JavaScript's
  deterministic string ordering, not locale collation. Without recursion,
  common subdirectories are reported but not visited.
- Up to two `--label NAME`, `--label=NAME`, or `-L NAME` labels.
  Headers omit timestamps. Missing sides under `-N` use `/dev/null` unless
  overridden by a label, allowing explicit creation/deletion patches.
- Exit 0 means equal, 1 means different, and 2 means invalid input, unsupported
  features, filesystem failures, or a resource limit. All comparisons finish
  before the buffered stdout is written, so preprocessing failures emit no
  partial diff. A sink can still fail after accepting bytes.

The deterministic algorithm trims common prefixes/suffixes and computes a
longest-common-subsequence table for the remaining rectangle. Equal-length
choices prefer deletion. It produces a minimal line edit script within its
limits, but repeated-line alignment need not match a native implementation.
The rectangular table is quadratic in the unmatched line counts, explicitly
bounded, and rejected when too large; there is no unbounded fallback. Matching
also charges compared text lengths to the work budget. Computation yields
periodically to observe cancellation.

## Supported patch subset

- `-s`, `--quiet`, and `--silent` suppress routine file progress and per-hunk
  status (including successful offset/fuzz details), following the pinned GNU
  quiet controls. Failed-hunk counts, reject destinations, automatic-reversal
  warnings, deletion conflicts, and error diagnostics remain visible. Quiet
  does not change application, dry-run, reverse, atomic, safety or limit policy;
  without a quiet flag, existing output is unchanged. Focused author controls
  are in `tests/commands/diff-patch/patch-quiet.test.ts`. This is not closure of
  the archived routed-five benchmark: native-only dry-run scratch directories
  remain a separate benchmark-profile issue.
  One explicit diagnostic difference remains: GNU quiet suppresses the
  deletion-conflict warning while exiting 1; this implementation retains
  `Not deleting file ... as content differs from patch` to preserve failure
  diagnostics. Native status and file effects agree in the bounded control;
  its quiet stdout is not an exact GNU match.

- Unified, normal, and context patches are autodetected from stdin,
  `-i FILE` / `--input=FILE`, or `--input FILE`; `-i -` means stdin.
  Autodetection supports mixed-format sections in one input.
  `-u` / `--unified`, `-n` / `--normal`, and `-c` / `--context` assert the
  format of every section; the last format selector wins. A later format
  mismatch can leave earlier sections published in default mode. Normal input
  needs a positional target or a usable `Index:` filename. At most one positional
  target is accepted; a second positional patch-input operand is not supported.
  The target overrides each section's selection without bypassing header safety
  validation. `--` terminates options, and short flags may be grouped.
- With **no `-p`**, automatic header selection uses basenames. Explicit `-p0`
  retains relative directories; `-p N`, `-pN`, `--strip=N`, and `--strip N`
  strip components. These options never strip an explicit positional target.
  Selection prefers existing candidates, then ranks candidates by missing
  parents, component count, basename length, and total length as applicable;
  it is not an unconditional old-header-first rule and never renames files.
  Selection accounts for earlier target creation, deletion and parent creation.
  Only selected effective paths are authorized, not discarded header prefixes
  or unused alternatives. An unused looping symlink does not abort selection;
  selecting that link still fails the no-symlink check.
- `-R` / `--reverse` swaps headers, hunk coordinates, and additions/deletions.
  Default mode keeps section order. Without `-f` / `--force`, apparent reversed
  or already-applied input can be automatically reversed. `-t` / `--batch` is
  accepted; the default already asks no questions. `--force` disables automatic
  reversal, not path checks or resource limits. Reapplying a patch can therefore
  undo it rather than act as an idempotent no-op.
- `--dry-run` checks without publishing targets, rejects, backups, or directory
  changes or authorizing auxiliary destinations that cannot be written.
  Default dry-run selects against the unchanged filesystem; atomic dry-run
  selects against hypothetical preceding results. Thus a create-then-edit
  sequence can succeed normally but refuse a different selected path in default
  dry-run, without changing the namespace. `--atomic` requests staged preflight,
  described below; neither flag
  changes the default fuzz or reversal policy.
- `-F N`, `-FN`, `--fuzz=N`, and `--fuzz N` set bounded context fuzz. The
  default is **two**; use `-F0` to require all context to match.
  Exact matching tries the expected position, then increasing offsets with
  positive offsets first. Fuzz ignores up to N outer context lines at each end,
  never removal lines; actual target context is retained. When nothing remains
  to match, only the expected position is considered. This is a deterministic
  subset, not every native patch placement heuristic.
- `-l`, `--ignore-whitespace`, and GNU's `--ignore-white-space` compare each
  nonempty horizontal space/tab run loosely. Missing runs, other characters,
  and final newline presence must still match; actual context and literal
  additions are preserved, including their original whitespace.
- `/dev/null` headers create/delete files. Creation accepts a missing target or
  an existing empty regular file; a nonempty target can trigger reversal or
  rejected hunks. Creation hunks contain no old content. Missing target parents
  are created on publication. Deletion removes only an empty resulting file;
  unmatched remaining content is retained and reported as a conflict.
  Multiple distinct targets are supported.
- `-E` / `--remove-empty-files` removes other empty results too. After removals,
  empty-ancestor pruning is requested, stopping before cwd for relative targets or before
  `/` for absolute targets. Nonempty directories remain; `.orig` or `.rej` files
  can keep a directory nonempty. Dry-run does not create or prune directories.
  Pruning uses optional `FileSystem.rmdir(path, {signal})`; a missing method or
  unsupported backend reports `ENOTSUP`, never a fallback to `rm`. The backend
  must enforce empty-only removal, preserving children created after listing.
  Typed `ENOENT` means the ancestor disappeared; mutation `ENOTEMPTY` retains a
  concurrent child without failing the patch. Other pruning failures are reported
  after any completed file publication. Unlike GNU patch 2.8, permission and
  transport failures are not silently ignored. See the separately counted
  `tests/commands/diff-patch/pruning-consumer/README.md` profile and proof.
- Epoch-dated empty sides in unified/context headers also support creation and
  deletion. Timestamp recognition supports ISO-style and traditional `ctime`
  headers, following GNU patch 2.8's measured near-epoch window (strictly between
  -25 and +26 hours), not timestamp restoration or arbitrary date syntax.
  Zero-origin insertions can create a missing target without an epoch marker;
  deleting to an ordinary non-epoch empty side leaves an empty file unless `-E`
  is supplied.
- Headers may have tab-separated timestamps or unquoted spaces in filenames.
  Git C-quoted paths support literal spaces/tabs, escaped quotes, and three-digit
  octal UTF-8 bytes. Unknown escapes, oversized octets, and invalid UTF-8 fail.
  Common `diff --git`, `diff -...`, `index`, and regular-file new/deleted mode
  preambles are accepted. Mode metadata does not change permissions. Existing
  permissions are left to the filesystem's normal overwrite semantics.
  Recognized mail envelopes accept descriptive text and diffstat before the
  patch (at most 1024 lines/64 KiB), and a `-- ` signature (128 lines/8 KiB).
  Patch syntax in signatures and unsupported mode/rename metadata are rejected.
  Bare interstitial descriptive text is scanned through, including text that
  resembles rename, mode or binary metadata. This does not implement Git rename,
  mode-change or binary-patch semantics; actual unsupported Git envelopes fail.
- Successful hunks are published even when other hunks fail; later file
  sections can still succeed. Failed hunks normally produce `TARGET.rej`.
  `-r FILE`, `-rFILE`, `--reject-file=FILE`, and `--reject-file FILE` select a
  reject destination; `-r -` suppresses reject-file output. Its parent must
  already exist when the reject is written. Rejects sharing a destination in
  one invocation are appended after the first write replaces that destination.
- Mismatches (failed, offset, fuzzed, or automatically reversed application)
  enable `TARGET.orig` backups by default. `--no-backup-if-mismatch` disables
  them; `--backup-if-mismatch` enables them. Existing `.orig` is replaced unless
  numbered backups exist, in which case the next `.~N~` number is chosen.
  This is not unconditional `-b`
  backup support or GNU's complete backup-naming/versioning interface.
- Counts, coordinates, hunk ordering, and newline markers are checked, but
  default mode is not all-input preflight: some later parse failures are
  reported after earlier sections publish. Safety and parsing limits can still
  reject input before publication. Malformed/truncated input is not silently
  accepted inside declared hunks; empty input is a successful no-op. Default
  scanning can ignore trailing deletion-like text after a complete section,
  as verified against GNU. Atomic staging instead rejects that orphan payload
  before any publication. Git rename/copy semantics are not supported.
- Suppressed blank bodies are accepted: normal `<`/`>` and context `!`/`+`/`-`
  without a following space denote complete empty data lines. Bare blank context
  lines denote shared empty data only within the declared side range; count and
  incomplete-final-line validation still apply.
- Exit 0 means success, 1 means a target/hunk applicability conflict, and 2
  means malformed input, unsupported behavior, resource or filesystem failure.
  Cancellation rejects with the supplied signal reason rather than converting
  it to an ordinary command exit.

See [PARSER.md](PARSER.md) for focused parser details and historical verification.
Its earlier preflight-only publication descriptions predate this default-policy
change; the publication contract below distinguishes the two current modes.

## Text and path rules

Both commands accept strictly valid UTF-8 text without NUL bytes. Invalid UTF-8
and NUL-containing input are rejected, including identical binary files.
UTF-8 BOMs in file content, Unicode, CRLF content, and unterminated final lines
are preserved byte-for-byte; Unicode and line endings are not normalized.
Patch transport accepts LF framing or uniformly CRLF-framed physical lines.
Exactly one transport CR per line is removed once, before mail-envelope handling,
only when every physical line has CRLF framing. Mixed LF/CRLF framing is left
unchanged: LF-framed data CRs remain data, and CRCRLF transport retains one data
CR. The exact `\ No newline at end of file` marker represents an unterminated
data line; a missing final physical LF is rejected.

An explicit target such as `patch /work/file < change` authorizes that absolute
**virtual** path, not a host path; relative explicit targets work too. Without
an explicit target, absolute header paths other than `/dev/null` are rejected
before stripping, so `-p` cannot make an unsafe auto-selected header safe.
With one, otherwise-safe absolute header labels are allowed, but headers never
select another file; `-p` strips neither the explicit target nor those labels.
Traversal (`..` components), backslashes, drive-prefix components,
directory-shaped labels, and control characters other than tabs are
rejected **before normalization or stripping**, even with an explicit target.
Adjacent relative slashes collapse before stripping; traversal never collapses.
Dot components are allowed and count toward explicit strip depth before path
normalization. Repeated normalized targets see published state in
default mode, or staged state with `--atomic`. In the inspected default
`--dry-run` path, preceding results are neither published nor staged: repeated
sections read unchanged VFS content. Do not assume that this simulates a
sequential real run; `--atomic --dry-run` instead uses staged state.
Input patch files may be read from another virtual directory with `-i`, including
an absolute virtual path.
Diff operands may use absolute virtual paths. Resolved paths are limited to
4096 UTF-16 code units and 256 components; raw patch paths have the same bound.

Both tools reject symlinks in inspected path components, including cwd
ancestors, final targets, and patch-input paths. Patch also rejects hard-linked
targets and actual auxiliary outputs when `nlink` reports more than one link.
Unused headers and stripped prefixes are not inspected for authorization;
lexically unsafe automatic headers are still rejected. Directory targets are never
overwritten. These checks are not a replacement for adapter sandboxing:
`FileSystem` has no no-follow file handles or compare-and-swap operation, so
concurrent path replacement cannot be made race-free here. Host-root confinement
remains the adapter's responsibility; these commands never address host paths
outside the supplied virtual filesystem API.

## Failure and cancellation policy

**Default mode:** input is buffered and selected paths are authorized before
publication. Where a later choice depends on earlier changes, bounded read-only
application previews determine the evolving namespace using the same hunk and
reversal logic as execution. These previews consume the existing invocation
budgets; they are not unmetered or filesystem writes. Actual application and
publication remain section by section. Successful hunks/files can remain published after a conflict, later
parse error, resource failure, or sink failure. Status is emitted as sections
are processed. A conflict returns 1 and does not itself prevent later sections
from applying. A fatal publication error stops processing; a file section may
already have written its backup or target before a reject write fails.
Failures between publications, including target stat/read errors, report the
completed file-section prefix rather than losing that context.

**Explicit `--atomic` extension:** parse and stage all sections, reject hunk or
target conflicts, and check prepared result budgets before publication. Repeated
targets use preceding staged results; final state collapses to one publication
entry per target. `--atomic -R` also reverses section order, unlike default `-R`.
Ordinary preparation failures leave targets unchanged and produce no reject or
backup files. Successful staged application can still create mismatch backups.
Status is buffered until publication completes. This mode is **preflight and
staging, not a backend transaction**; its name does not promise atomic writes.

Both modes recheck target content and type before publication to detect
observable changes; atomic mode also rechecks all prepared targets before its
publication loop. There is no lock or compare-and-swap, so races remain possible.
Publication runs sequentially. A publication-stage filesystem or work-budget
failure stops immediately and reports the completed-entry count and failing
path; default counts refer to sections, atomic counts to collapsed targets.
It does not roll back or attempt later entries, and the failing operation may
already have side effects. Cancellation propagates the signal reason: earlier
writes and directory changes remain, and uncooperative in-flight host work may
continue. Directory pruning or status-output failures can occur after target
publication. No single-file or multi-file atomicity, rollback, race freedom, or
forced termination of host work is promised.

Every filesystem request receives the command signal. Waiting on host promises,
stdin, and sinks is interruptible and observes late rejections. CPU-heavy
matching, metadata traversal, and even endless empty input chunks yield
periodically. Cancellation cannot undo host effects or preempt an individual
synchronous JavaScript operation.

## Resource options

| Option | Default | Scope |
| --- | ---: | --- |
| `maxInputBytes` | 16 MiB | Aggregate captured input, including target rechecks |
| `maxOutputBytes` | 16 MiB | Diff stdout, or aggregate patch results, rejects, backups, and status |
| `maxLines` | 100,000 | Aggregate tokenized lines, including converted formats and target contents, and individual hunk-coordinate bound |
| `maxWork` | 8,000,000 | Traversal, chunk, matching, and computation work units |
| `maxMatrixCells` | 4,000,000 | Diff LCS table cells, four bytes each |
| `maxFiles` | 1,024 | Diff visited pairs/queued-entry bound, or patch file sections |
| `maxHunks` | 10,000 | Aggregate generated/parsed hunks |

Limits must be positive safe integers. Diagnostic messages have a separate
fixed bound below 4096 bytes, even when an invalid argument is very large.
Mixed patch formats share one invocation's file, hunk, line, and work budgets;
normal/context conversion also shares a cumulative byte cap of
`2 * maxInputBytes + 16,384` rather than resetting it per section.
The text algorithms buffer inputs/results rather than providing streaming
edits. Raising limits increases memory/CPU exposure; caller-selected limits
are not an absolute host-memory guarantee. Adapter internals and returned
directory listings must also be bounded by their owners.

## Known gaps

The GNU versions above are targets, not a full-coverage claim. Ed patches,
binary patches, renames/copies, mode-only patches, permission changes,
empty-directory patches, and symlink patches are unsupported. `diff -N` treats
absent content as empty and cannot express creation/deletion of a zero-byte
file. Bounded UTF-8 processing and the quadratic unmatched diff matrix do not
support arbitrary binary or huge-data workloads; there is no native fallback.

The flag lists above describe the implemented interface, not all GNU flags.
For example, patch `-b`/`--backup`, `-N`/`--forward`, `-d`/`--directory`,
`-o`/`--output`, `--posix`, and `--binary` are not accepted. Diagnostics,
timestamps/metadata, repeated-line alignment, placement, and malformed-input
handling are not established as fully GNU-identical. GNU mismatches remain
defects to investigate, not a vague GNU/BSD parity exemption. Historical BSD
observations remain evidence of that earlier oracle, not the current target.

The nine formerly failing GNU repeated-context selector checks are addressed
in the recorded [GNU-DIFF.md](GNU-DIFF.md) checkpoint; that does not resolve all
other comparisons. Asymmetric `-F0` placement and legacy BSD empty-range reverse
observations remain separately recorded, with current GNU patch migration
verification still in progress. No result here demonstrates superiority to
just-bash or completion of the wider full-shell/72-hour objective.

## Clean-source followup checkpoint

After the coordinated compiler-artifact cleanup, the August 26, 2026 checkpoint
in [GNU-PATCH.md](GNU-PATCH.md) ran **2,334 tests: 2,303 passed, 31 failed**, with
zero skips, cancellations or TODOs. The unchanged 930-test aggregate passed
928/930; the independent candidate followup passed 21/21; all author followup
regressions passed 83/83 (a subset of the full author suite, not extra coverage).
Fresh `npm run typecheck` passed. No build or compiler emission was run.

The raw failures remain visible: 28 pruning-related checks and three old
stripped-prefix rejection assertions across the executed suites. Neither
category is silently waived. Source/test hashes were stable during the recorded
run and no `.js` siblings shadowed its TypeScript inputs. This is a bounded
checkpoint, not a globally frozen repository or full GNU/project acceptance.

## Historical evidence during GNU migration

This README was reconciled against active source on August 26, 2026, without
running the global suites. Source inspection is not a test pass. Earlier
results below and in sibling documents retain their original scope and oracle;
they do not certify the changed patch default or the `--atomic` extension.

- [PARSER.md](PARSER.md) records the earlier 829/829 author and 156/156 GNU
  reference checks, alongside raw independent parser 75/80 (5 failures) and
  formats 1055/1069 (14 failures). These are historical parser checkpoints.
- [GNU-DIFF.md](GNU-DIFF.md) records subsequent selector work: compatibility
  110/110, formats 1058/1069 (11 failures), owned options 310/310, and an expanded
  author selection 746/756 (10 failures). Its source/executable hashes, old BSD
  observations, and unresolved assertions remain there.
- At this documentation inspection, the saved migration logs under
  `tests/commands/diff-patch-stress/gnu-target/` reported policy baseline
  953/956 (3 failures) in `policy-baseline-2026-08-26.tap`, atomic-before
  2011/2216 (205 failures) in `atomic-before-migration-2026-08-26.tap`, and
  atomic-after 964/1028 (64 failures) in
  `atomic-after-migration-2026-08-26.tap`. These are observed working-tree
  artifacts from ongoing verification, not a fresh run or a same-denominator
  before/after acceptance claim. All three logs recorded zero skips and
  cancellations; failures are retained, not waived.

Those historical preflight-only descriptions must not be read as the default
publication contract. Default and atomic dry-run namespace behavior now has
focused author and independent coverage described in the clean-source checkpoint.
No whole-repository runtime pass is claimed.

## Optional GNU reference driver

The source-owned native reference driver uses only a caller-selected GNU patch
2.8 binary, bounded literal argv, and isolated temporary directories:

```sh
GNU_PATCH_BINARY=/path/to/patch-2.8/src/patch \
  node --import tsx tests/commands/diff-patch/patch-gnu-reference.ts
```

It records executable identity plus exact status/content/existence checks;
native diagnostics are recorded rather than normalized into an asserted match.
The extended driver's recorded checkpoint is in `PARSER.md`.
This focused evidence does not replace the full comparison denominator or prove
full-shell compatibility or superiority.

## Historical author validation checkpoint

Author tests are in `tests/commands/diff-patch/`. They do not replace independent
verification; the original checkpoint below predates the GNU policy migration.

On August 26, 2026, the original author checkpoint passed **123/123 tests**, with no
skips or cancellations. The scoped strict TypeScript command below passed.
All nine cancellation tests also passed ten additional repetitions under
`--unhandled-rejections=strict` (90/90 repeated test executions). These are
author-side correctness observations, not an independent verification or
performance comparison.

```sh
node --unhandled-rejections=strict --import tsx --test tests/commands/diff-patch/*.test.ts
node_modules/.bin/tsc --noEmit --strict --noUncheckedIndexedAccess --exactOptionalPropertyTypes --target ES2023 --module NodeNext --moduleResolution NodeNext --skipLibCheck src/commands/diff-patch/*.ts tests/commands/diff-patch/*.ts
git diff --check -- src/commands/diff-patch tests/commands/diff-patch
```

The author suite includes 22 native exact-output diff cases with bidirectional
tool cross-application, four additional native patch comparisons, 100 seeded
repeated-line forward/reverse roundtrips (seed `0x124578`), malformed/path/binary
and resource tests, commit failure injection, cancellation/late-rejection
tests, and four complete shell workflows plus plugin-registration coverage.
Native commands run without a shell, only in isolated temporary directories,
with a three-second timeout and one-MiB captured-output bound. The author host
provides `/usr/bin/diff` identifying as `Apple diff (based on FreeBSD diff)` and
`/usr/bin/patch` identifying as `patch 2.0-12u11-Apple`.

An initial full author run had three shell-fixture failures because the bare
memory filesystem does not populate `/dev/null`. Those fixture redirections
now use ordinary virtual log files; no shared shell or adapter code was changed.
Whole-product test/build status is outside this owned-scope checkpoint.
