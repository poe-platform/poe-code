# Virtual recursive search

This subtree provides a zero-runtime-dependency, ripgrep-like `rg` command.
Product code uses only the command context's virtual filesystem and byte streams,
plus Node builtins. It does not invoke native rg, a shell, host filesystem APIs,
`eval`, or generated JavaScript. Native rg is used only by the tests.

## Integration

`index.ts` exports:

- `searchCommands(options?)`: a `VirtualShellPlugin` registering `rg`.
- `createSearchCommands(options?)`: a readonly list of command definitions for
  a `CommandRegistry`.
- `SearchOptions`: configuration shared by both factories.

Use `shell.use(searchCommands())` alongside `standardCommands()`. No root
exports, package manifests, contracts, or parent command registries are changed
by this subtree. Registration rejects an existing `rg` unless `replace: true`.

| Option | Default | Meaning |
| --- | --- | --- |
| `replace` | `false` | Replace an existing command registration. |
| `defaultInput` | `"auto"` | Choose `"auto"`, `"stdin"`, or `"cwd"` when no paths are supplied. |
| `maxOutputBytes` | 16 MiB | Maximum stdout bytes; a write that would exceed this limit is not performed. Diagnostics use stderr separately. |
| `maxLineBytes` | 1 MiB | Maximum record content bytes. |
| `maxFileBytes` | 64 MiB | Maximum bytes read from each data source, also the retained before-context byte limit. |
| `maxFiles` | 100,000 | Maximum visited roots and directory entries, including entries later filtered out. |

Numeric limits must be positive safe integers. They limit individual buffers and
operations, not total process memory, adapter allocations, or regex CPU time.

### Choosing stdin or a directory

`CommandContext` has no TTY/piped-input metadata. With no path operands, `auto`
peeks at stdin: a nonempty chunk selects stdin; an exhausted stream selects the
current directory. This differs from native rg for an *empty pipe*. Specify `-`
or `defaultInput: "stdin"` for unambiguous empty-stdin searches. Use
`defaultInput: "cwd"` to avoid reading stdin when paths are omitted. File listing
and programs taking patterns from `-f -` default to the current directory.
Explicit data paths do not consume unrelated stdin. An explicit `-` is labeled
`<stdin>` in filename and JSON output.

## Supported flags

Options may precede or follow operands. Common combined short flags and attached
values work, such as `-nHi`, `-l0`, `-A2`, and `-epattern`. A value-consuming short
flag takes the entire remaining token: use `-A1 -m2`, not `-A1m2`. `--` terminates
option parsing. Unknown flags and malformed numeric values are errors.

| Area | Flags and behavior |
| --- | --- |
| Patterns | Repeated `-e`/`--regexp`, `-f`/`--file`; otherwise the first operand is the pattern. Pattern files contain one UTF-8 pattern per line; `-f -` reads stdin. An empty pattern file matches nothing. |
| Matching | `-F`/`--fixed-strings`, `--no-fixed-strings`, `-i`/`--ignore-case`, `-s`/`--case-sensitive`, `-S`/`--smart-case`, `-v`/`--invert-match`, `--no-invert-match`, `-w`/`--word-regexp`, `-x`/`--line-regexp`. |
| Match output | `-n`/`--line-number`, `-N`/`--no-line-number`, `-H`/`--with-filename`, `-I`/`--no-filename`, `--column`/`--no-column`, `-b`/`--byte-offset`, `-o`/`--only-matching`, `--no-only-matching`, `--heading`/`--no-heading`. |
| File lists | `--files`, `-l`/`--files-with-matches`, `--files-without-match`. **`-L` means follow symlinks, not files without matches.** |
| Counts/status | `-c`/`--count`, `--count-matches`, `--include-zero`/`--no-include-zero`, `-q`/`--quiet`, `-m`/`--max-count`. Counts suppress zero unless requested. `-c -o` counts occurrences; inverted counts count selected nonmatching lines. |
| Context | `-A`/`--after-context`, `-B`/`--before-context`, `-C`/`--context`, `--context-separator`, `--no-context-separator`. Adjacent context groups merge, with no duplicate records. Context defaults to zero. |
| Path filtering | Repeated `-g`/`--glob`, `--iglob`, `--hidden`/`-.`, `--no-hidden`, `--max-depth` (0–128). |
| Ignore controls | `--no-ignore`/`--ignore`, `--no-ignore-vcs`, `--no-ignore-dot`, `--no-ignore-parent`, `--no-require-git`, and repeated `-u`/`--unrestricted`. One `-u` disables ignores, two also include hidden entries, three also enable binary searching. |
| Links/binary | `-L`/`--follow`, `--no-follow`, `-a`/`--text`, `--binary`, `--no-binary`, `--no-text`. |
| Records/format | `--json`, `-0`/`--null`, `--no-null`, `--null-data`, `--crlf`. `--null` separates filenames with NUL; `--null-data` changes the input/output record separator to NUL. |
| Diagnostics/order | `--no-messages`/`--messages`, `--sort=path`, `--color=never`, `--no-config`, `--no-ignore-global`. Config/global ignore loading and color are absent by design, so these negative options describe existing behavior. Other sort/color modes are rejected. |

Output modes (`--files`, filename lists, counts, JSON) use the last specified
mode. Output is deterministic: traversal sorts directory entries by UTF-8 bytes
and visits explicit roots in argument order, without parallel workers or TTY
color/heading detection. Default line output omits filenames for one explicit
file/stdin and includes them for recursive searches or multiple paths.

Status is `0` for selected lines/files, `1` for no selection, and `2` for errors.
`--files-without-match` selects files with no selected lines; `--files` succeeds
when it lists at least one file. Quiet successful selection overrides previously
encountered I/O error status, but does not erase emitted diagnostics. `-m0`
performs no data search or output, including no JSON summary. Command-line
flags/globs and search-pattern syntax are checked before data input/output;
pattern files must first be read to compile their patterns. Ignore-file parsing
and filesystem failures can occur during traversal after earlier output. No
search mode writes files.

## Ignore and glob rules

Traversal reads virtual `.gitignore`, `.ignore`, and `.rgignore` files in the
search directory and applicable ancestors. `.gitignore` requires a `.git` marker
in that directory or an ancestor, unless `--no-require-git` is given. `.rgignore`
has precedence over `.ignore`, which has precedence over `.gitignore`; within
one type, deeper/later matching rules win.

Patterns support `*`, `?`, `**`, character classes, brace alternatives, leading
slash anchoring, trailing slash directory rules, comments, escaped leading
`#`/`!`, escaped spaces, and `!` negation. Slashless rules match at any depth;
rules containing slashes are relative to their ignore file. Ignored directories
are pruned: negating a child alone does not reopen an ignored parent.

Command-line globs are relative to cwd. A matching positive glob overrides file
ignore/hidden filters; a matching negative glob excludes a path. Later globs win.
Having positive globs excludes nonmatching files but permits traversal through
ordinary unmatched directories. Explicit file operands bypass ignore, hidden,
and glob filters. This matches the native evidence behind the pipeline tests:
`-g '*.ts'` can intentionally include an otherwise ignored TypeScript file. Use
negative exclusions or filter a plain `--files` result to preserve file ignores.

This is a scoped gitignore-style implementation, not a git/wildmatch library.
It does not read `.git/info/exclude`, global git excludes, `.git` worktree
metadata, arbitrary `--ignore-file` files, or user configuration. Every virtual
path is eligible according to the supplied filesystem; no host repository,
environment config path, or network location is consulted.

## Bytes, binary files, and JSON

Input is read as cancellable byte chunks; output preserves original bytes.
Matching decodes UTF-8 and retains a mapping back to byte offsets. Invalid UTF-8
is represented by replacement characters for matching only, not rewritten in
output. Columns, byte offsets, and JSON submatch ranges are byte-based. `--crlf`
removes a trailing CR for matching while retaining it in ordinary line output.

By default, discovered recursive files stop when an input chunk contains NUL.
Explicit files/stdin and `--binary` search binary records, treating NUL as a
record boundary and reporting a binary-match message instead of plain content.
`-a` treats NUL as ordinary data. `--null-data` makes NUL the record delimiter
and disables NUL binary detection. Files listed by `--files` are not read or
binary-filtered. Binary detection is chunk-based; later NUL discovery cannot
retract earlier streamed output. Large-file/chunk-boundary behavior is not
claimed identical to native rg's reader/mmap heuristics.

JSON Lines uses `begin`, `match`, `context`, `end`, and final `summary` events.
Files without emitted matches/context have no begin/end pair. Paths and record
data use `{ "text": ... }` when UTF-8 is valid, otherwise `{ "bytes": BASE64 }`.
Events contain record numbers, absolute byte offsets, byte submatch ranges,
binary offsets, and search/match/byte statistics. All elapsed-time fields are
deterministically zero; they are **not performance measurements**. Native test
comparison normalizes only elapsed fields, retaining byte counts, match counts,
and the rest of the JSON structure.

## Regex and resource limitations

The matcher uses JavaScript `RegExp` with Unicode mode, not Rust regex or PCRE2.
Ordinary alternation, groups, quantifiers, character classes, anchors, and
JavaScript-compatible Unicode property expressions work. `-w` uses Unicode
letters/numbers/marks/connector punctuation/join controls for word boundaries.
Rust inline mode groups, Rust-specific Unicode property spellings, character
class set operations, POSIX classes, PCRE2, backreferences, and user lookaround
are unsupported. JavaScript `\w`, `\d`, `\b`, case folding, dot/anchor behavior
around CR and Unicode line separators, and replacement-character matching can
differ from native Rust regex. UTF-16/other input encodings, BOM transcoding,
multiline mode, replacement output, compressed search, file-type databases, and
native mmap/threading controls are not implemented.

**No catastrophic-regex safety guarantee is made.** JavaScript matching is
synchronous and may backtrack catastrophically. A signal or timer cannot stop an
individual blocked regex call. The supplied line/pattern limits do not make
untrusted regexes safe; callers requiring a hard deadline must isolate execution
outside this command. Generated glob regexes use JavaScript matching as well.
Cancellation-aware byte helpers stop blocked stream waits, and traversal/record
loops yield periodically, but these guarantees do not extend into RegExp.

Additional bounds: 1,024 search patterns/globs, 8,192 bytes per search pattern,
8,192 UTF-16 units per glob, 1 MiB per pattern/ignore file, 10,000 active ignore
rules, 100,000 before/after context records, 100,000 collected matches per line,
eight brace nesting levels, and directory depth at most 128. A configured
limit failure is an explicit status-2 error, not a silently successful truncation.
Limits cannot prevent a filesystem adapter from allocating a large `readdir`
array before the command visits it.

## Verification checkpoint

Run `node --import tsx --test tests/commands/search/*.test.ts` and
`npm run typecheck` from `/Users/kjopek/Workspace/safe-bash`.

On 2026-08-26, all 107 search tests pass. The suite includes 86 full native
differential cases, three additional native error probes, deterministic virtual
fixtures, four shell pipelines, ignore/link/binary/Unicode checks, quota tests,
and blocked-I/O/timer cancellation tests. Native comparison uses the installed
rg 15.2.0 executable directly, with fixed reviewed argv, fresh isolated temporary
directories, clean environments, three-second deadlines, 1 MiB output limits,
and unchanged-file assertions. Native tests are explicitly skipped if rg is
unavailable; that is not counted as verified parity.

Strict scoped typechecking and the final whole-repository `npm run typecheck`
both pass. These author checks are not a substitute for the assigned independent
verifier, and do not establish overall superiority over another shell.
