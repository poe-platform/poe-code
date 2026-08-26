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
gets an independent budget. Root exports, package exports, and standard-plugin
composition remain Curie's integration responsibility; this subtree does not
claim an installed package import path. Existing shared contracts were inspected
and the source entry point was exercised directly through `Shell.use`.

## Supported diff subset

- Two file/directory operands, with `-` for stdin; two `-` operands share one
  captured input. A file versus directory compares the file's basename inside
  the directory. `--` terminates options.
- Unified output is the default, also selected by `-u` / `--unified`.
  `-U N`, `-UN`, and `--unified=N` set context, including zero context.
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

- Strict unified patches from stdin, `-i FILE` / `--input=FILE`, or
  `--input FILE`; `-i -` means stdin. An optional positional target is accepted
  only for a single file patch. `-u` asserts the only supported format.
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
- `/dev/null` headers create/delete files. Creation requires absence and an
  existing parent directory. Deletion requires an empty resulting file.
  Multiple distinct targets are supported. Normal patches prefer an existing
  old header path, then an existing new header path; they do not rename files.
- Headers may have tab-separated timestamps or unquoted spaces in filenames.
  Common `diff --git`, `diff -...`, `index`, and regular-file new/deleted mode
  preambles are accepted. Mode metadata does not change permissions. Existing
  permissions are left to the filesystem's normal overwrite semantics.
- Counts, coordinate continuity, hunk ordering, newline markers, and all file
  sections are validated before writes. Duplicate target sections are rejected.
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

Patch header and explicit target paths must be relative to the virtual cwd.
Absolute paths other than the `/dev/null` header sentinel, `..` components,
backslashes, drive prefixes, empty components, and control characters are
rejected **before stripping**, even when an explicit target overrides headers.
Dot components are allowed, and duplicate normalized targets are rejected.
Input patch files may be read from another virtual directory with `-i`.
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

Commit operations run sequentially in patch order. A commit-stage filesystem
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
| `maxLines` | 100,000 | Aggregate tokenized lines and individual hunk-coordinate bound |
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

This is not full GNU/BSD diff or patch compatibility. Default normal-format
diff output, context/ed/normal patch formats, whitespace-ignore modes, binary
patches, quoted/escaped Git paths, mail preambles, renames/copies, permission
changes, automatic parent-directory creation, empty-directory changes, and
symlink patches are unsupported. `-N` treats absent content as empty and cannot
express creation/deletion of a zero-byte file. Repeated file sections are not
applied sequentially. Diagnostics, timestamps, default fuzz, default path
selection, placement heuristics, and malformed-patch policy intentionally
differ from native tools. No result here demonstrates superiority to just-bash
or completion of the wider full-shell/72-hour objective.

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
