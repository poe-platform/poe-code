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

Use `shell.use(searchCommands())` alongside `standardCommands()`. These factories
and the shared `RegexExecutionOptions` type are available from `virtual-bash`.
Registration rejects an existing `rg` unless `replace: true`; the matcher does
not require a new registry or plugin lifecycle contract.

| Option | Default | Meaning |
| --- | --- | --- |
| `replace` | `false` | Replace an existing command registration. |
| `defaultInput` | `"auto"` | Choose `"auto"`, `"stdin"`, or `"cwd"` when no paths are supplied. |
| `maxOutputBytes` | 16 MiB | Maximum stdout bytes; a write that would exceed this limit is not performed. Diagnostics use stderr separately. |
| `maxLineBytes` | 1 MiB | Maximum record content bytes. |
| `maxFileBytes` | 64 MiB | Maximum bytes read from each data source, also the retained before-context byte limit. |
| `maxFiles` | 100,000 | Maximum visited roots and directory entries, including entries later filtered out. |
| `regex` | See `../regex-execution/README.md` | Content-matcher policy: active request 1000ms, startup 3000ms, two workers, bounded FIFO queue, automatic retirement. |

Numeric limits must be positive safe integers. They limit individual buffers and
operations, not total process memory or adapter allocations. The separate
`regex` policy bounds active content-matcher requests, not whole invocations.

### Choosing stdin or a directory

With no path operands, `auto` uses `CommandContext.stdinIsDefault` without
acquiring, reading, peeking, or replaying stdin. `false` selects supplied input,
including empty, exhausted, piped, or redirected streams. `true` selects the
current directory. Omitted metadata is legacy/unknown and deterministically
selects the current directory, regardless of any available input bytes.

`defaultInput: "stdin"` and `defaultInput: "cwd"` explicitly override ordinary
auto-selection. Explicit paths (including `-`) take precedence over those
defaults. File listing and programs taking patterns from `-f -` default to the
current directory, even with `defaultInput: "stdin"`. Pattern files other than
`-` leave ordinary input selection intact. Simultaneously using `-f -` and a
data operand `-` is an error before stdin is consumed. Explicit data paths do
not consume unrelated stdin, except when stdin supplies patterns. An explicit
`-` is labeled `<stdin>` in filename and JSON output.

The shell and transparent command forwarders now propagate the metadata, so an
empty pipe or input redirection does not fall back to filesystem discovery.
Direct legacy callers that relied on probing nonempty stdin must now supply
`stdinIsDefault: false`, an explicit `-`, or `defaultInput: "stdin"`. Stream
exhaustion never changes its provenance. Transparent `invoke` callers forwarding
stdin must also preserve its metadata in `CommandInvokeOptions`.

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
Positive directory-only globs do not implicitly select their descendants; use
`src/**`, not `src/`, to select files below `src`. Reopening an ignored directory
does not by itself whitelist hidden children. Followed directory loops report an
error and traversal continues with other siblings.
Ignore-file negations apply to the matched entry, not every descendant of a
reopened directory. Unclosed brackets are literal in ignore files (but still
invalid command-line globs). Nested `.git` markers reset inherited VCS rules,
without resetting `.ignore` or `.rgignore`. Followed cycles are detected before
ignore filtering, and diagnostics retain the ancestor's displayed path.

This is a scoped gitignore-style implementation, not a git/wildmatch library.
Glob compilation and predicates execute in the same bounded worker executor as
content matching, not on the host thread. CLI validation still precedes pattern
file/input reads; invalid ignore files are diagnosed and discarded as before,
while worker-resource failures stop traversal. Rules batch per current path and
priority without speculative filesystem reads. Public early-EOF/abort settlement
still lacks an awaited resource-cleanup barrier; see the regex-execution README.

The continuation retains the original JS-Unicode glob dialect, not native
globset byte semantics: `?` consumes a Unicode code point, and globstar's dot does
not cross line terminators (single-star's negated-slash class does). Malformed
class diagnostics retain the original parser/V8 wording rather than ripgrep's.
The ten benign native-profile probes in
`tests/commands/regex-execution/continuation/dialect-evidence.json` preserve all
baseline triples and record these differences against Darwin ripgrep 15.2.0;
six triples match native exactly. No content-regex dialect change is introduced.

It does not read `.git/info/exclude`, global git excludes, `.git` worktree
metadata, arbitrary `--ignore-file` files, or user configuration. Every virtual
path is eligible according to the supplied filesystem; no host repository,
environment config path, or network location is consulted.

## Bytes, binary files, and JSON

Input is read as cancellable byte chunks; output preserves original bytes.
Matching decodes UTF-8 and retains a mapping back to byte offsets. Malformed
bytes separate valid UTF-8 matching fragments: consuming matches cannot include
them, literal replacement characters do not match them, and anchors still refer
to the whole record rather than fragment boundaries. Output retains the original
bytes. Columns, byte offsets, and JSON submatch ranges are byte-based. `--crlf`
removes a trailing CR for matching while retaining it in ordinary line output;
only-matching output uses CRLF terminators in this mode.

By default, discovered recursive files stop when an input chunk contains NUL.
Explicit files/stdin and `--binary` search binary records, treating NUL as a
record boundary and reporting a binary-match message instead of plain content.
`-a` treats NUL as ordinary data. `--null-data` makes NUL the record delimiter
and disables NUL binary detection. Files listed by `--files` are not read or
binary-filtered. Binary detection is chunk-based; later NUL discovery cannot
retract earlier streamed output. Completed matching records are written and
awaited before requesting another input chunk; there is no speculative stdout
staging or whole-input buffering. A late binary warning preserves earlier output.
For `foo\n\0\nno\n`, whole-write delivery produces only the warning, whereas
one-byte delivery at 25 ms intervals produces `foo\n` followed by the warning.
Both schedules have exact native regressions. Native back-to-back pipe writes
may be grouped differently by its reader, so these results do not establish
universal chunk/scheduling parity or identical mmap heuristics. Existing record,
input and output byte limits still apply; blocked stdout stops further reads and
remains cancellable.

JSON Lines uses `begin`, `match`, `context`, `end`, and final `summary` events.
Files without emitted matches/context have no begin/end pair. Paths and record
data use `{ "text": ... }` when UTF-8 is valid, otherwise `{ "bytes": BASE64 }`.
Events contain record numbers, absolute byte offsets, byte submatch ranges,
binary offsets, and search/match/byte statistics. All elapsed-time fields are
deterministically zero; they are **not performance measurements**. Native test
comparison normalizes only elapsed fields, retaining byte counts, match counts,
and the rest of the JSON structure.
Quiet JSON searches emit only the summary and gather statistics across inputs.
Matches inside the fixed after-context window following `--max-count` retain
match events and statistics without extending that window. The tests preserve
native 15.2.0's limited/inverted unterminated-tail event classification, including
its counterintuitive classification of matching tail content as a match event.

## Regex and resource limitations

The matcher uses JavaScript `RegExp` with Unicode mode, not Rust regex or PCRE2.
Ordinary alternation, groups, quantifiers, character classes, anchors, and
JavaScript-compatible Unicode property expressions work. `-w` uses Unicode
letters/numbers/marks/connector punctuation/join controls for word boundaries.
Rust inline mode groups, Rust-specific Unicode property spellings, character
class set operations, POSIX classes, PCRE2, numeric backreferences, and user
lookaround are unsupported. A pre-existing named-backreference loophole
(`(?<letter>a)\k<letter>`) remains accepted with JavaScript semantics in this
isolation change; native default-engine ripgrep rejects it. Named captures
without backreferences are a separate supported JavaScript feature. No dialect
migration or native backreference compatibility is implied. JavaScript `\w`,
`\d`, `\b`, case folding, dot/anchor behavior
around CR and Unicode line separators can
differ from native Rust regex. UTF-16/other input encodings, BOM transcoding,
multiline mode, replacement output, compressed search, file-type databases, and
native mmap/threading controls are not implemented.

Content-pattern compilation, matching and invalid-UTF8 fragment variants now run
in static compiled Node workers. `SearchOptions.regex` exposes explicit request/
startup/queue/memory policy; details and cleanup limitations are documented in
`../regex-execution/README.md`. Cancellation and active-request expiry terminate
the exact worker and await cleanup. No shared cumulative invocation allowance or
historical prototype caps replace the existing pattern/record/result limits.
**Broad untrusted-regex/default acceptance remains blocked:** generated CLI and
ignore-file glob regexes still construct and match on the host in `glob.ts` via
`walk.ts`, outside this authorized content-matcher batch. Do not infer a complete
rg catastrophic-regex guarantee, hard RSS containment or a wall-clock SLA.
Cancellation-aware byte helpers stop blocked stream waits; traversal/record
loops yield periodically, but host glob calls remain non-preemptible.
Selection itself performs no stream operations. Once nondefault stdin is
selected, empty-chunk processing yields so timer cancellation is not starved.
Closed stdout (`EPIPE`) terminates successfully without scanning later files or
emitting diagnostics. A private cancellation signal releases input cleanup waits
on that path; an already-aborted caller signal still takes precedence.

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
