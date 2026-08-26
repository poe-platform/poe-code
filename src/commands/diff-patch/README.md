# Diff and patch commands

Dependency-free author implementation for virtual-bash. Product code performs
all filesystem operations through `CommandContext.fs`; it does not import host
filesystem or process APIs, launch commands, or evaluate source strings.

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

- Unified, normal, and context patches are autodetected from stdin,
  `-i FILE` / `--input=FILE`, or `--input FILE`; `-i -` means stdin.
  `-u` / `--unified`, `-n` / `--normal`, and `-c` / `--context` assert the
  input format. Normal input requires one explicit target. An optional
  positional target overrides each section's target without bypassing header
  path validation.
- `-p N`, `-pN`, and `--strip=N` strip path components; the default is zero,
  not a basename-selection heuristic. `-R` / `--reverse` swaps both headers,
  hunk coordinates, and added/deleted lines. `--dry-run` performs preparation
  without writing target files.
- `-F N`, `-FN`, `--fuzz=N`, and `--fuzz N` enable bounded context fuzz. The
  default is **zero**, intentionally stricter than common native defaults.
  Exact matching tries the expected position, then increasing offsets with
  positive offsets first. Fuzz ignores up to N outer context lines at each end,
  never removal lines; actual target context is retained. When nothing remains
  to match, only the expected position is considered. This is a deterministic
  subset, not every native patch placement heuristic.
- `-l`, `--ignore-whitespace`, and GNU's `--ignore-white-space` compare each
  nonempty horizontal space/tab run loosely. Missing runs, other characters,
  and final newline presence must still match; actual context and literal
  additions are preserved, including their original whitespace.
- `/dev/null` headers create/delete files. Creation requires absence and an
  existing parent directory. Deletion requires an empty resulting file.
  Multiple distinct targets are supported. Header-selected patches prefer an existing
  old header path, then an existing new header path; they do not rename files.
- Epoch-dated empty sides in unified/context headers also support creation and
  deletion. Timestamp recognition supports ISO-style and traditional `ctime`
  headers, following GNU patch 2.8's measured near-epoch window (strictly between
  -25 and +26 hours), not timestamp restoration or arbitrary date syntax.
  Zero-origin insertions can create a missing target without an epoch marker;
  deleting to an ordinary non-epoch empty side leaves an empty file.
- Headers may have tab-separated timestamps or unquoted spaces in filenames.
  Git C-quoted paths support literal spaces/tabs, escaped quotes, and three-digit
  octal UTF-8 bytes. Unknown escapes, oversized octets, and invalid UTF-8 fail.
  Common `diff --git`, `diff -...`, `index`, and regular-file new/deleted mode
  preambles are accepted. Mode metadata does not change permissions. Existing
  permissions are left to the filesystem's normal overwrite semantics.
  Recognized mail envelopes accept descriptive text and diffstat before the
  patch (at most 1024 lines/64 KiB), and a `-- ` signature (128 lines/8 KiB).
  Patch syntax in signatures and unsupported mode/rename metadata are rejected.
- Counts, coordinate continuity, hunk ordering, newline markers, and all file
  sections are validated before writes. Repeated normalized targets are staged
  sequentially against the preceding result. `-R` reverses section order as well
  as hunks, making it the inverse of the complete edit sequence, not native
  forward-order reversal. Git rename/copy semantics are not supported.
  Empty input is a successful no-op. Malformed/truncated input is not silently
  skipped, and no interactive questions, automatic reversal, reject files, or
  backup files are produced.
- Exit 0 means success, 1 means a target/hunk applicability conflict, and 2
  means malformed input, unsupported behavior, resource or filesystem failure.
  Cancellation rejects with the supplied signal reason rather than converting
  it to an ordinary command exit.

## Text and path rules

Both commands accept strictly valid UTF-8 text without NUL bytes. Invalid UTF-8
and NUL-containing input are rejected, including identical binary files.
UTF-8 BOMs in file content, Unicode, CRLF content, and unterminated final lines
are preserved byte-for-byte; Unicode and line endings are not normalized.
Unified patch transport uses LF-terminated physical lines and the exact
`\ No newline at end of file` marker. A missing final physical LF is rejected.

An explicit target such as `patch /work/file < change` authorizes that absolute
**virtual** path, not a host path; relative explicit targets work too. Without
an explicit target, absolute header paths other than `/dev/null` are rejected.
With one, headers are validated but never select another file, and `-p` does not
strip the explicit target. Traversal (`..` components), backslashes, drive-prefix
components, directory-shaped labels, and control characters other than tabs are
rejected **before normalization or stripping**, even with an explicit target.
Adjacent relative slashes collapse before stripping; traversal never collapses.
Dot components are allowed; repeated normalized targets share staged state.
Input patch files may be read from another virtual directory with `-i`, including
an absolute virtual path.
Diff operands may use absolute virtual paths. Resolved paths are limited to
4096 UTF-16 code units and 256 components; raw patch paths have the same bound.

Both tools reject symlinks in inspected path components, including cwd
ancestors, final targets, and patch-input paths. Patch also rejects hard-linked
targets when `nlink` reports more than one link. Directory targets are never
overwritten. These checks are not a replacement for adapter sandboxing:
`FileSystem` has no no-follow file handles or compare-and-swap operation, so
concurrent path replacement cannot be made race-free here. Host-root confinement
remains the adapter's responsibility; these commands never address host paths
outside the supplied virtual filesystem API.

## Failure and cancellation policy

Preparation parses the entire input, validates every target and hunk, computes
all outputs, and checks cumulative output size **before any target write**.
Ordinary malformed patches, mismatched hunks, unsafe paths, and preparation
limit errors leave all target bytes unchanged. Before committing, existing
target contents and types are rechecked to detect observable concurrent changes.
This is not a transaction or lock; another actor can still race those checks.

Final results collapse to one operation per target, in first-seen target order
(after reversal when requested); create-then-delete absent targets do not publish.
Commit counts refer to these final target operations, not input sections.
Commit operations run sequentially. A commit-stage filesystem
or work-budget failure stops immediately, reports the committed-prefix count
and failing path, and does not roll back or attempt later targets. The failing
operation itself may already have side effects. Cancellation during commit
propagates the signal reason: earlier commits remain, the in-flight host
operation may continue, and later targets are not attempted. No multi-file or
single-file atomicity is promised by this command. A status-output sink failure
after successful commits also does not undo changes.

Every filesystem request receives the command signal. Waiting on host promises,
stdin, and sinks is interruptible and observes late rejections. CPU-heavy
matching, metadata traversal, and even endless empty input chunks yield
periodically. Cancellation cannot undo host effects or preempt an individual
synchronous JavaScript operation.

## Resource options

| Option | Default | Scope |
| --- | ---: | --- |
| `maxInputBytes` | 16 MiB | Aggregate captured input, including target rechecks |
| `maxOutputBytes` | 16 MiB | Diff stdout, or aggregate patch results plus status |
| `maxLines` | 100,000 | Aggregate tokenized lines, including converted formats and target contents, and individual hunk-coordinate bound |
| `maxWork` | 8,000,000 | Traversal, chunk, matching, and computation work units |
| `maxMatrixCells` | 4,000,000 | Diff LCS table cells, four bytes each |
| `maxFiles` | 1,024 | Diff visited pairs/queued-entry bound, or patch file sections |
| `maxHunks` | 10,000 | Aggregate generated/parsed hunks |

Limits must be positive safe integers. Diagnostic messages have a separate
fixed bound below 4096 bytes, even when an invalid argument is very large.
The text algorithms buffer inputs/results rather than providing streaming
edits. Raising limits increases memory/CPU exposure; caller-selected limits
are not an absolute host-memory guarantee. Adapter internals and returned
directory listings must also be bounded by their owners.

## Known gaps

This is not full GNU/BSD diff or patch compatibility. Ed patches,
binary patches, renames/copies, mode-only patches, permission
changes, automatic parent-directory creation, empty-directory changes, and
symlink patches are unsupported. `-N` treats absent content as empty and cannot
express creation/deletion of a zero-byte file. Diagnostics, timestamps, default fuzz, default path
selection, placement heuristics, and malformed-patch policy intentionally
differ from native tools. No result here demonstrates superiority to just-bash
or completion of the wider full-shell/72-hour objective.
Option-order and whitespace-dialect differences remain separately recorded by
the independent verifiers.

## Optional GNU reference driver

The source-owned native reference driver uses only a caller-selected GNU patch
2.8 binary, bounded literal argv, and isolated temporary directories:

```sh
GNU_PATCH_BINARY=/path/to/patch-2.8/src/patch \
  node --import tsx tests/commands/diff-patch/patch-gnu-reference.ts
```

It records executable identity plus 126 exact status/content/existence checks;
native diagnostics are recorded rather than normalized into an asserted match.
This focused evidence does not replace the full comparison denominator or prove
full-shell compatibility or superiority.

## Author validation checkpoint

Author tests are in `tests/commands/diff-patch/`. They do not replace the
different verifier the root orchestrator will assign after handoff.

On August 26, 2026, the final author run passed **123/123 tests**, with no
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
