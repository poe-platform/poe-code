# Standalone virtual tree author candidate

`index.ts` exports `treeCommands(options?)`, `createTreeCommands(options?)`,
`createTreeCommand(options?)`, `TreeCommandsOptions` and `TreeLimits`.
The plugin registers only `tree`, with collision preflight and optional explicit
`replace`. These are **standalone source-module exports**, not root exports or
an installed package subpath. Root/package/default registration is intentionally
unchanged; independent hidden review must precede public integration.

The implementation uses async VFS metadata operations, never native processes,
host filesystem reads, file-content reads or ambient configuration files. It
does not consume stdin. Network-backed VFS configuration remains the host's
explicit responsibility. This is not a filesystem sandbox or a snapshot.

## Supported profile

- `-a`: include dot names, never `.` or `..` from a directory listing.
- `-d`: directory entries and links whose observed targets are directories.
- `-L depth`: positive maximum displayed depth; root is depth zero. Values
  above the configured safety depth are rejected before VFS I/O.
- `-P pattern`: include matching nondirectory entries, retaining real
  directories for traversal. With `-l`, directory links are also retained.
  Without `-l`, directory links must match `-P`, consistent with the captured
  native profile. Repeated `-P` patterns are ORed.
- `-I pattern`: exclude matching files/directories and their subtrees.
  Repeated patterns are ORed. Hidden exclusion happens first unless `-a`.
- Patterns are basename-only, case-sensitive UTF-8 **byte** patterns: `*`, `?`,
  bracket sets/ranges, `^`/`!` negation, `|` alternatives, backslash literals
  outside bracket sets. `?` matches one byte, not a Unicode scalar. Slash,
  globstar, malformed brackets and descending ranges are rejected. Bracket
  backslash has no special escaping semantics. No regex backtracking is used.
- `-f`: prefix descendants with the supplied operand path, not an implicit
  absolute path. `-i`: omit text branches or JSON formatting whitespace.
- `-l`: traverse observed directory symlink targets. Default **does not follow
  directory links, including explicit link operands**. Metadata `stat` still
  follows links to classify their targets even without `-l`; no content is read.
- `-J`: JSON array of `directory`, `file`, or `link` nodes; links have `target`.
  Nonempty traversed nodes have `contents`. Failed metadata has `type: unknown`;
  errors/cycles have an `error` field. Unicode names round-trip as JSON strings;
  terminal controls, formatting characters and line separators are escaped.
- `-r`, `--dirsfirst`, `--noreport`, `--charset=ASCII|UTF-8`, `-n`, `--`,
  `--help`, `--version`. Short flags can be combined and `-L/-P/-I` take
  attached values. Color is always off; `-n` is an explicit no-op.

All arguments are parsed before VFS access. Unknown options are usage errors,
not ignored switches. Empty operands, NUL and ill-formed Unicode are rejected.
The default operand is `.`; `-` is an ordinary pathname, not stdin.

Sorting is fixed unsigned UTF-8-byte order, independent of host/shell locale
and directory enumeration order. Text names use C-locale escaping: ASCII is
literal, backslash and common controls are escaped, other bytes use octal.
This preserves newline and Unicode filenames without injecting terminal control
bytes. The default branches are ASCII; UTF-8 changes branches, not name escaping.
Pretty JSON is semantically compared, not whitespace-parity claimed.

Reports count displayed entries, not disk usage: directory-target links count
as directories; broken links count as files. Nested directories count even if
empty/unreadable. A root directory counts only if it has displayed children,
matching the pinned native empty-root convention. Repeated operands/aliases
are counted repeatedly. `-d` omits the file count. No `du`, allocated-size,
permissions, timestamps, inode display or execution metadata is fabricated.

## Identity, errors and cancellation

Ancestor-only cycle detection uses complete `identityScope/dev/ino` identities
or the current optional `compareEntry` contract through the existing shared
comparison helper. It does not equate bare device/inode pairs, serialize opaque
scopes, infer provider identity from clients, or globally suppress sibling
aliases. Unknown remains unknown: safety budgets stop unprovable recursion,
without labeling it a proven cycle. `realpath` strings are deliberately **not**
treated as backing-entry authority; no lexical path check is presented as a
security boundary. Calls preserve virtual operand paths and backend routing.
Point-in-time comparisons cannot prevent namespace races or inode reuse.

Broken-link `ENOENT`/`ENOTDIR` during target classification is not an error.
Other metadata errors remain failures; no permission denial becomes absence.
Denied directory reads/comparisons stop that subtree while later siblings and
operands continue. A proven ancestor cycle is annotated and skipped (status 0).
Normal FS failures produce human-readable escaped stderr, inline/JSON error
annotations, and status 1. Syntax/unsupported-option errors use status 2.
JSON remains valid after ordinary FS failures. Ordinary file operands are useful
leaf nodes, rather than native tree's misleading error-opening-dir annotation.

Every awaited FS call receives the supplied signal and is checked before/after;
an abort races pending operations and observes their eventual rejections. The
command cannot force an uncooperative backend to stop its own work. Sinks use
`writeBytes` with the signal, owned chunks no larger than 16 KiB, and awaited
backpressure. Sink failures, cancellation and family-limit errors propagate,
not converted into FS diagnostics. Already-emitted bytes remain; output after
these exceptional failures can be a partial text prefix or incomplete JSON.
No output/namespace rollback is claimed. Shell output sinks retain the existing
shared execution output budget, including stderr and multiple invocations.
The public `CommandContext` exposes no work-budget tick: traversal work caps
are per invocation, not a new shared shell budget or a replacement Shell.

## Limits

`TreeCommandsOptions` has `replace?: boolean` and `limits?: Partial<TreeLimits>`.
Every limit is a positive safe integer, copied and validated at factory creation.

| Limit | Default | Charges |
| --- | ---: | --- |
| `maxArguments` | 4096 | All argument fields |
| `maxArgumentBytes` | 65536 | All UTF-8 argument bytes |
| `maxEntries` | 100000 | Root operands plus every returned directory entry, even excluded/hidden |
| `maxDirectoryEntries` | 10000 | Raw returned array length |
| `maxDepth` | 256 | Descent safety bound; default exceeding it fails rather than silently truncating |
| `maxPathBytes` | 16384 | Each observed path, display path, name, link target and error message |
| `maxMetadataBytes` | 8388608 | Cumulative bytes of those strings; repeated strings are charged again |
| `maxOutputBytes` | 16777216 | Combined stdout/stderr bytes, admitted before each write operation |
| `maxSteps` | 4194304 | FS/comparison calls, entries, name-sort comparisons and pattern DP work |

Directory metadata is collected to determine filtered siblings and connectors;
the whole subtree/output is not buffered. The backend `readdir` contract returns
an array, so **backend allocation/materialization happens before the command can
check the array cap**. Backend internal pagination/response limits remain needed.
Metadata caps bound author-retained data, not provider memory or CPU. Individual
sort comparisons/UTF-8 encoding are also bounded by name/path and entry caps;
the work counter is not an exact instruction/time meter. The walker yields an
event-loop turn every 64 FS/comparison operations. Pathname races can make any
listing inconsistent; no descriptor-relative snapshot API is invented.

## Evidence and remaining scope

The primary reference is the official upstream `doc/tree.1` in the pinned 2.2.1
source archive, plus the maintainer's published manual inspected through web.
`tests/commands/tree/native-fixtures.json` retains exact native output, inputs,
version, platform and archive/binary hashes. The oracle was compiled in isolated
`/tmp`, with no source modifications, main dependencies or install target.
It is Darwin arm64 / Apple clang 21.0.0 / `LC_ALL=C` / ASCII branches unless
explicitly overridden: **not evidence for GNU/Linux or arbitrary locales**.

The original cohort has 24 exact-byte/status/stderr comparisons and four parsed
JSON comparisons. Six original divergent native rows are preserved separately:
sibling-link global suppression, explicit root-link traversal, file-root text,
missing-root text/status, malformed missing-root JSON and file-root JSON.
These are not counted as compatibility passes. The virtual profile intentionally
uses ancestor-only detection, explicit link following, useful file leaves,
status-1 FS errors and valid error JSON instead. No broad parity or superiority
claim follows from this bounded cohort.

Always-runnable author tests use actual Shell registration and frozen captures.
Safety tests add direct ByteIO/FS doubles. Backend coverage is memory, rooted real,
readonly, mount, overlay and mock-S3 with pagination; it is not deployed S3/WebDAV
interoperability evidence. WebDAV, live provider authorization and special native
file types are not established by these tests. The VFS type contract only names
files, directories and symlinks. Sorting modes, `--prune`, gitignore, HTML/XML,
size/permission metadata, path patterns and raw `-N` output remain unsupported.
See the author evidence file for failed initial checks and final validation.
