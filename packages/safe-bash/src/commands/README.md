# Standard virtual commands

This first tool family registers 32 working command handlers. It has **zero
runtime dependencies**, invokes no host process or shell, and accesses files
only through `CommandContext.fs`. Node builtins and the shared contracts are
the only platform facilities used. This is a measured starting point, not a
claim of complete GNU/Bash compatibility or superiority over another project.

## Stable API

`src/commands/index.ts` exports:

```ts
standardCommands(options?: StandardCommandsOptions): VirtualShellPlugin
createStandardCommands(options?: StandardCommandsOptions): readonly CommandDefinition[]

interface StandardCommandsOptions {
  readonly execute?: CommandHandler;
  readonly replace?: boolean;
}
```

Use `shell.use(standardCommands())` with the shell's plugin host, or register
the returned definitions in a `CommandRegistry`. `standardCommands` checks
all collisions before registering anything; replacement must be explicit.
No root export or package subpath export is added by this family.

`env COMMAND`, `xargs`, and `find -exec` dispatch literal command names and argv.
`env COMMAND` requests `replaceEnv: true` with its computed exported environment;
runtime support must honor this without resurrecting removed exports or PWD.
Other forwarding callers retain default merge behavior. Environment listing
uses the pinned GNU9.7 gnulib profile: new assignment names are prepended,
existing names are replaced in place, inherited order is retained. This is a
specific native profile, not a portable POSIX environment-order guarantee.
They prefer a structurally available `context.invoke(command, args, options)`
hook, matching `ShellCommandContext.invoke`. This preserves shell middleware,
functions, cancellation, filesystem, and execution budgets. Otherwise they use
`options.execute`, then the plugin host's virtual registry. Independently
created definitions fall back to their own standard-command definitions.
No command string is constructed or evaluated. Unknown commands return 127.
`xargs` gives children empty stdin, not a fresh copy of its argument stream.
`env` and child invocations receive copied environment state.

The invocation options passed to the hook are `stdin`, `cwd`, `env`, `stdout`,
and `stderr`; the tool does not override the filesystem, signal, or limits.
An injected executor outside the shell is responsible for equivalent middleware
and budget enforcement. The registry-only fallback does not implement a shell.

## Implemented surface

Options not in this table are not promised. Most flag-driven commands accept
`--`, grouped short options, attached option values, and applicable named long
options. Invalid options and malformed operands produce diagnostics and status
2; ordinary filesystem failures produce status 1, except grep errors use 2.
`echo` intentionally treats unrecognized option-like arguments as literal text.

| Command | Implemented common behavior and flags |
| --- | --- |
| `echo` | Joined operands; grouped `-n`, `-e`, `-E`; control/octal/hex escapes and `\c` stop. |
| `printf` | Format reuse; `%%`, `%s`, `%b`, `%c`, `%q`, integer/base and common floating formats; numeric width, precision, `-+ #0` flags; binary escape output. |
| `cat` | Ordered files and repeated `-` sharing stdin; raw binary streaming; `-n`, `-b`, `-s`, `-E`, `-T`, `-v`, `-A`, `-e`, `-t`, `-u`. |
| `pwd` | Logical cwd by default/`-L`; filesystem-resolved cwd with `-P`. A shell builtin may take precedence. |
| `ls` | Sorted one-per-line names; `-1`, `-a`, `-A`, `-d`, `-F`, `-p`, `-r`, `-R`, `-L`, `-l`. Long records use numeric metadata and UTC dates. |
| `mkdir` | Multiple directories, recursive parents `-p`, octal mode `-m`, verbose `-v`. |
| `touch` | Create without truncation; `-c`, `-a`, `-m`, reference times `-r`. New files without `-r` retain filesystem-assigned creation timestamps; existing files and reference times require provider timestamp support. |
| `cp` | Multiple sources, `-r`/`-R`, `-n`, `-f`, `-v`, `-P`, `-L`; nested symlink preservation by default; same-file, descendant-copy and cycle checks. |
| `mv` | Virtual rename, multiple sources into directories; `-n`, `-f`, `-v`. |
| `rm` | Files and links; `-r`/`-R`, `-f`, empty directories `-d`, `-v`; root and dot-entry protection. |
| `rmdir` | Directory/type/emptiness checks, parent removal `-p`, `-v`. |
| `ln` | Hard and literal symbolic links, `-s`, `-f`, `-n`, `-T`; multiple sources into target directories. |
| `readlink` | Literal link targets; canonical `-f`, existing-only `-e`, no newline `-n`, NUL `-z`. |
| `basename` | Root/trailing slash handling, optional suffix, `-a`, `-s`, `-z`. |
| `dirname` | Multiple path operands, trailing slashes and roots, `-z`. |
| `realpath` | Existing paths and missing final component; `-e`, `-m`, `-z`, `--relative-to`, `--relative-base`; relative bases follow the selected canonicalization mode. |
| `head` | Default ten lines, `-n`, `-c`, legacy leading `-NUMBER`, negative omit-last counts, `-q`, `-v`; early input termination. |
| `tail` | Default last ten lines, `-n`, `-c`, legacy leading `-NUMBER`, `+N` origins, `-q`, `-v`; bounded suffix buffering. |
| `wc` | `-l`, `-w`, `-c`, `-m`; multiple files/totals and GNU field widths; C/POSIX `-m` counts bytes, otherwise UTF-8 decoding across chunks (default UTF-8). Locale priority is LC_ALL, LC_CTYPE, LANG. Virtual stdin is an opaque stream, so multi-column stream width is seven; native regular-file stdin width requires descriptor metadata not currently exposed. |
| `sort` | Byte ordering, exact decimal numeric comparison `-n`, `-r`, `-f`, `-b`, `-s`, `-u`, `-t`, repeated `-k` with field/character ranges and `bfnr` modifiers, `-o`, `-c`, `-z`. |
| `uniq` | Adjacent groups, `-c`, `-d`, `-u`, `-i`, field/byte skips `-f`/`-s`, comparison width `-w`, `-z`, optional input/output paths. |
| `cut` | Byte `-b`, UTF-8 codepoint `-c`, field `-f` ranges including open/overlapping ranges; `-d`, `-s`, `-z`, `--complement`, `--output-delimiter`. |
| `tr` | Byte ranges/classes/escapes, translation, `-d`, `-s`, `-c`/`-C`; squeeze state persists across chunks. |
| `tee` | Incremental stdout and multiple file writes; append `-a`; continues remaining outputs after a file error. |
| `grep` | Common basic/extended/fixed patterns `-E`/`-F`; `-i`, `-v`, `-n`, `-c`, `-l`, `-L`, `-q`, `-h`, `-H`, `-o`, `-w`, `-x`, repeated `-e`/`-f`, `-m`, `-s`, `-a`, `-z`; 0/1/2 statuses. |
| `find` | Sorted traversal, `-P`/`-L`, depth bounds and `-depth`, name/path patterns, file/directory/link types, `-size`, `-empty`, boolean expressions, `-prune`, `-print`/`-print0`, literal `-exec ... ;` and batched `-exec ... {} +`. |
| `xargs` | Incremental quoted/escaped word parsing; `-0`, `-d`, `-n`, `-s`, `-I`, `-r`, `-t`, `-E`, `-x`, sequential `-P 1`; child failure status mapping. |
| `env` | Listing, clearing `-i`/`-`, unsetting `-u`, assignments, NUL listing `-0`, virtual directory override `-C`, direct command execution. |
| `true`, `false` | Conventional status-only commands; arguments ignored. |
| `test`, `[` | String, integer, boolean/grouped predicates; `-e`, `-a`, `-f`, `-d`, `-L`/`-h`, `-s`, `-r`, `-w`, `-x`, `-nt`, `-ot`, `-ef`; bracket terminator validation. |

## Limits and gaps for the independent verifier

- These are common-flag implementations, not complete GNU utilities. No `sed`,
  `awk`, shell interpreter command, network command, or host execution escape is
  installed. The original Bash fixture expectations are unchanged; cases needing
  absent commands remain unsupported, not passing.
- Raw `cat`, `tee`, `tr`, byte counts, and positive `head` operate incrementally.
  Line-oriented operations have a 32 MiB line limit; sort buffers up to 32 MiB;
  suffix operations retain up to 32 MiB. Filesystem providers without streaming
  read support fall back to `readFile`. Provider methods may internally buffer.
  Sort/check phases remain synchronous. Grep content regexes use the static
  worker executor described in `regex-execution/README.md`; other commands are
  not covered by that executor.
- `grep` uses a documented basic/extended-pattern translation onto JavaScript
  RegExp, not a complete POSIX leftmost-longest engine. Lookaround/special groups
  are rejected. Full locale/collation classes, binary-file heuristics, recursive
  search and context lines are not implemented. `StandardCommandsOptions.regex`
  configures content-regex worker resource policy: default active request 1000ms,
  startup 3000ms, two workers per configured grep definition, bounded FIFO queue
  and automatic retirement. This is not a cumulative Shell deadline or an RSS
  bound; expensive ordinary patterns can fail with a status-2 resource error.
  Matching uses a one-byte string view; literal argv patterns are UTF-8 encoded,
  pattern files retain their raw bytes, and selected output retains original
  bytes. `-a` explicitly selects the default without binary-file heuristics.
- Text comparison is C-like byte ordering with ASCII case/whitespace rules,
  except explicit UTF-8 character operations. `cut -c` counts
  codepoints, not graphemes or GNU implementations that treat it like bytes.
  `wc` prints plain space-separated fields rather than platform-specific padding.
  `ls -l` is a stable numeric/UTC presentation, not native locale formatting;
  terminal columns, block totals, owner lookup, and time/size sorting are absent.
- `printf` does not implement `-v`, dynamic `*` widths, `%a`, `%n`, time formats,
  Unicode escape syntax, complete `%q` rendering compatibility, or native
  overflow behavior. Width is capped at one million; precision at 1,000 (100
  for floating formats). `%s` precision is byte-based. Floating formatting uses
  JavaScript numbers rather than the platform C floating-point library.
- Metadata preservation/archive copying, interactive prompts, cross-device
  move fallback, symbolic permission expressions, parsed touch dates, and atomic
  recursive operations are absent. `cp` rejects combined `-P`/`-L` instead of
  interpreting their order. `readlink -f`/`realpath -m` do not yet resolve
  dangling symlink chains as fully as native canonicalization utilities.
- The filesystem contract has no atomic empty-directory removal method.
  `rmdir` and `rm -d` check emptiness and then use recursive removal; another
  concurrent writer can race that check. Parent removal stops at its relative
  base/root boundary. This must not be presented as atomic POSIX `rmdir`.
- Provider-dependent optional operations fail with `ENOTSUP`, not a stub success.
  Mutating operations can leave partial effects if a later step fails or is
  canceled; there is no transaction/rollback guarantee.
- `xargs` runs sequentially; `-P` values other than 1 are rejected. Command size
  is capped at 128 KiB, excluding environment size. Arguments are UTF-8 strings,
  not arbitrary undecodable bytes. Combined `-I`/`-n` is rejected rather than
  issuing native precedence warnings. Signal-derived child statuses cannot be
  distinguished from explicit exits by the current result contract.
- `find` has a depth ceiling of 1,024, no `-execdir`, `-delete`, ownership/time
  predicates, or mount-boundary handling. Batched `-exec` accepts one final `{}`;
  command arguments remain literal even when they look like find options.
- Obsolete ambiguous `test -a/-o` edge cases and comprehensive locale semantics
  are not claimed. Permission predicates rely on the provider's `access` method.

## Validation and handoff

Focused tests live in `tests/commands/**`; run them with:

```sh
node --import tsx --test tests/commands/*.test.ts
npm run typecheck
```

The first implementation validation contains 44 tests with multiple assertions
per command/behavior, including six real-shell pipeline/invocation tests. These
cover byte preservation, chunk boundaries, shared stdin, virtual file effects,
literal filenames through `find`/`xargs`, shell-function dispatch, middleware,
and shared command limits. They are implementation checks, not the separate
agent's comparative stress suite. Unsupported flags, semantic differences,
resource limits, and benchmark results must remain visible in that evaluation.
