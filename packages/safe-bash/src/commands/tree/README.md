# Bounded virtual tree

`index.ts` exports `treeCommands(options?)`, `createTreeCommands(options?)`,
`createTreeCommand(options?)`, `TreeCommandsOptions` and `TreeLimits`.
The plugin registers only `tree`, with collision preflight and optional explicit
`replace`. The factories and types are available through the package root and
`virtual-bash/commands/tree`. `agentCommands()` includes `tree` by default and
forwards its `tree` family limits; the aggregate replacement policy is authoritative.

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
- `-r`, `--dirsfirst`, `--noreport`, `--charset=ASCII|US-ASCII|UTF-8|UTF8`, `-n`, `--`,
  `--help`, `--version`. Short flags can be combined and `-L/-P/-I` take
  attached values. Color is always off; `-n` is an explicit no-op.

All arguments are parsed before VFS access. Unknown options are usage errors,
not ignored switches. Empty operands, NUL and ill-formed Unicode are rejected.
The default operand is `.`; `-` is an ordinary pathname, not stdin.

Sorting is fixed unsigned UTF-8-byte order, independent of host/shell locale
and directory enumeration order. Text names use C-locale escaping: ASCII is
literal, backslash and common controls are escaped, other bytes use octal.
This preserves newline and Unicode filenames without injecting terminal control
bytes. Branches use the selection rules below; UTF-8 changes branches, not name escaping.
Pretty JSON is semantically compared, not whitespace-parity claimed.

### Branch charset and virtual locale

Selection uses only own-key entries of `CommandContext.env`, never ambient host
environment, locale installation, terminal detection or configuration files:

1. The last explicit `--charset` wins. The four documented charset names are
   case-insensitive. Unknown or empty explicit values remain usage errors;
   unlike native tree's unknown-charset fallback, they are not silently accepted.
   When explicit, no environment charset/locale fields are read or charged.
2. A present `TREE_CHARSET` overrides every locale, including when empty. UTF-8
   and UTF8 (case-insensitive) select Unicode branches; all other values select
   ASCII. Values are not trimmed. This includes empty/unknown values, matching
   the pinned tree 2.2.1 native profile.
3. Otherwise the first nonempty `LC_ALL`, `LC_CTYPE`, or `LANG` selects the virtual
   locale. `C.UTF-8`, `C.utf8`, `en_US.UTF-8`, and `en_US.utf8` select UTF-8;
   `C`, `POSIX`, missing values and other names select ASCII. These locale names
   are case-sensitive; an unknown higher-precedence name does not fall through.

The virtual locale table is deterministic, not a probe of installed host locales.
The lowercase `.utf8` aliases are explicit virtual-profile aliases: the captured
Darwin native binary falls back to ASCII for those two names. Native Darwin
`en_US.UTF-8` filename collation/escaping is not emulated. For Unicode branches
with the preserved C-byte name order/escaping, use `TREE_CHARSET=UTF-8` with a C
locale or an explicit `--charset=UTF-8`. This does not enable unsafe raw names.

At most four relevant environment fields are visited. Each visited string is
length-admitted before byte sizing/normalization, charged against existing
path/name and cumulative metadata limits, and reserves its UTF-16 length plus
one work unit before scanning. Lower-precedence fields are not read after a
selection. Output continues to charge actual UTF-8 bytes, including branches;
ASCII and UTF-8 output can reach the same byte cap at different positions.

Reports count displayed entries, not disk usage: directory-target links count
as directories; broken links count as files. Nested directories count even if
empty/unreadable. A root directory counts only if it has displayed children,
matching the pinned native empty-root convention. Repeated operands/aliases
are counted repeatedly. `-d` omits the file count. No `du`, allocated-size,
permissions, timestamps, inode display or execution metadata is fabricated.
In particular, the two-file root with one nested directory reports **2
directories, 2 files**, matching tree 2.2.1. No legacy root-count subtraction is
performed. The original comparison's UTF-8/one-directory expectation remains
unchanged and is not made passing by charset selection.

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
backpressure. Sink failures, cancellation and family-limit errors propagate at
the command boundary, not converted into ordinary FS diagnostics by tree. The
current Shell may render a non-abort limit error as status 1. Already-emitted
bytes remain; output after
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
| `maxPathBytes` | 16384 | Each cwd, raw operand, observed/display path, name, link target and raw/rendered error message |
| `maxMetadataBytes` | 8388608 | Cumulative bytes of those strings; repeated strings are charged again |
| `maxOutputBytes` | 16777216 | Combined stdout/stderr bytes, admitted before each write operation |
| `maxSteps` | 4194304 | FS/comparison calls, entries, sort byte spans and grouping comparisons, pattern compilation, alternatives and DP row/transition work |

Name sorting reserves `1 + left UTF-8 byte length + right UTF-8 byte length`
before each `Buffer.compare`. This conservatively covers both full byte spans
even when the actual comparison exits early. The second `--dirsfirst` sort
charges one unit before each constant-size directory-classification comparison.
Both passes use the same cumulative budget and check cancellation before every
comparison. Ordering, stable grouping and reverse behavior are unchanged. Actual
comparison counts are engine/input dependent; this is not a CPU-time benchmark.

String admission first uses constant-time UTF-16 length as a lower bound on UTF-8
bytes, against both the per-field and remaining cumulative quota. Only then may
bounded byte sizing, regex scanning or encoding occur. Backend `Error.message`
is admitted **raw, before errno-prefix stripping**; the rendered message is also
charged when visited. Cwd/raw operands are admitted before virtual path
normalization, and arguments before byte sizing. These are memory/work policy
checks, not namespace/security authority. Unknown object/symbol/bigint exceptions
use a fixed diagnostic rather than invoking arbitrary text conversion; string
errors and `Error.message` retain their content within the bounds. Reading a
host-defined getter and backend creation of the original string remain opaque
host work, not sandboxed or retroactively bounded by this command.

Output admission similarly checks remaining bytes before sizing/encoding. Text
escaping checks each expanded part before appending, so controls cannot build an
over-limit escaped fragment. JSON fields are preflight-sized, including control,
surrogate and formatting-character escapes, before `JSON.stringify` and its
bounded control replacement. Complete formatted writes are checked again. A
bounded number of fragments may exist before aggregate line admission; this is
not an exact peak-heap or zero-allocation guarantee. Earlier output still survives
later limit failures. See `tests/commands/tree/SORT-TEXT.md` for measurements.

Pattern compilation and matching consume the **same invocation budget** as the
walk, cumulatively across all patterns and all entries, without per-name resets.
Compilation reserves `UTF-16 length + 1` units before fixed source-validation
scans, then `UTF-8 byte length + 1` before encoding/initial structures, plus one
unit for each outer parser iteration and bracket-range iteration before token/
alternative/range allocation. Source-scan units cover a fixed number of linear
passes, not individual CPU instructions. General argument validation is also
bounded separately by argument count/byte caps.

Matching charges one unit before each alternative, including empty alternatives.
An empty alternative matches only an empty name and needs **no DP row**. For each
nonempty alternative, the initial row charges `name byte length + 1` units before
allocation. Each token then reserves twice that row length before allocating:
one unit per zero-initialized cell and one per transition cell. Bracket membership
also charges its range count before evaluation, conservatively even if the range
search short-circuits. Budget rejection precedes the associated allocation/work;
requested units in a rejected batch are not evidence of allocated bytes or work
performed. See `tests/commands/tree/WORK-BUDGET.md` for the preserved original
TREE-WORK-001 failure and bounded measurements; no regex worker is involved.

Directory metadata is collected to determine filtered siblings and connectors;
the whole subtree/output is not buffered. The backend `readdir` contract returns
an array, so **backend allocation/materialization happens before the command can
check the array cap**. Backend internal pagination/response limits remain needed.
Metadata caps bound author-retained data, not provider memory or CPU. String
scans/UTF-8 encoding are also bounded by admitted name/path/output caps;
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
