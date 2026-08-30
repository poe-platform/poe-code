# Bounded `du`

This leaf module exports `createDuCommand`, `createDuCommands`, `duCommands`,
`DuCommandsOptions`, and `DuLimits`. The definition is named `du`; the plugin is
named `du-commands`. Options are `{ replace?: boolean, limits?: Partial<DuLimits> }`.
The plugin preflights collisions and registers with the same replacement policy.
Root and the explicit `virtual-bash/commands/du` subpath expose these functions
and types. `agentCommands` includes DU; `AgentCommandsOptions.du` omits family
`replace`, because the aggregate's top-level replacement policy is authoritative.
Public integration and the owned-output adoption below are new author work,
pending separate public review; prior module/native acceptance does not certify
this integration or imply a whole-product gate.

## Accounting and failure policy

Default mode sums provider-observed `FileStat.allocatedBytes`, including directory
and final-symlink observations. Missing is unknown, not zero. Every visited
observation, including a duplicate non-directory alias, must be a nonnegative safe
integer. Missing/invalid observations diagnose the path and fail the invocation;
there is no fallback to `size`, rounded size, or assumed allocation units.
Reported zero is accepted. This is neither exclusive/reclaimable storage nor
quota, billing, heap usage, shared-extent deduplication, or a storage snapshot.

`--apparent-size` sums validated regular-file and final-symlink `size`; directory
own contribution is **zero by logical-accounting policy**, not a storage claim.
`-b` additionally selects byte reporting. Memory, S3, and WebDAV therefore support
explicit apparent-size reporting while default allocation remains unknown.
Real allocation depends on its existing Darwin/Linux metadata contract; the
author's actual native execution is Darwin only, not a Linux qualification.

Unknown size/allocation, metadata errors and arithmetic overflow mark the affected
subtree incomplete. Continue useful siblings/descendants and later operands, but
suppress incomplete directory/operand totals and an incomplete `-c` grand total.
Do not print unlabeled partial numeric totals. Selected complete descendants can
still print; `-s` intentionally suppresses them. Errors return status 1; successful
reporting returns 0. Resource-budget exhaustion stops the walk with status 1 and
retains already emitted complete rows. An exhausted combined output budget may
leave no room for a diagnostic. Caller cancellation is rethrown by exact reason.

Each contributing value and each requested aggregate must remain at most
`Number.MAX_SAFE_INTEGER`. Checked addition occurs before publication. Reporting
division/rounding uses bounded BigInt arithmetic. Without `-c`, separate operand
totals are not added together solely to enforce an unused grand-total range.

## Traversal, identity and output

Only command-issued `lstat` and `readdir` operations are used. There are no content
reads, stdin reads, `readlink`, comparison queries, subprocesses, copy-up requests,
or mutation calls. Final symlinks are not explicitly followed; intermediate links
and trailing slash resolution remain the adapter's path-resolution semantics.
For example, rooted Real and Memory resolve a final `link/` as a directory. No
follow options or `-x` are implemented. Hidden entries are included.

Non-directory identity is deduplicated invocation-wide only for a non-null object
or symbol `identityScope` plus nonnegative safe-integer `dev` and `ino`. Tokens
compare by `===`, never descriptions/serialization. Missing/invalid identity is
counted independently; no `nlink` or capabilities inference. `--count-links`
disables deduplication. This is not a claim of complete remote hardlink detection.
Directory namespaces are **never pruned by backing identity**, because mounts or
overlays can supply different children. Repeated directory operands can therefore
produce additional zero rows after non-directory deduplication, unlike native GNU.
Depth/entry/work bounds stop malformed cyclic views even when identity is unknown.

Operands retain input order and display spelling. Children use deterministic
UTF-16 code-unit order, not locale collation; directories report postorder. Default
operand is `.`. `-` is a literal path, and `--` terminates option processing. Empty
operands report `invalid zero-length file name` without a cwd/root lookup, while
later operands still run. Filesystem lookup uses
existing virtual POSIX path resolution, not an additional symlink-containment API.
Directory names must be nonempty single components other than `.`/`..`, without
NUL, slash or duplicate listing names. Malformed listings fail closed.

Records are `formatted-size<TAB>literal-display-path<LF>`, or NUL terminated with
`-0`. Names are not shell-escaped on stdout: newline/tab names need `--null` and
parsing at the first tab. Diagnostics quote operand names and escape controls;
provider messages over 4096 UTF-16 code units are explicitly marked truncated.

## Exact option and environment profile

Supported short/long pairs: `-a/--all`, `-s/--summarize`, `-c/--total`,
`-h/--human-readable`, `-B/--block-size`, `-b/--bytes`, `-d/--max-depth`,
`-l/--count-links`, `-0/--null`; also `-k`, `-m`, `--apparent-size`, `--help`.
Short clusters, attached/separate required arguments and long `=value` work.
Unknown options, abbreviations, unexpected values and NUL arguments fail before
any filesystem operation. Options may appear after operands until `--`, including
when `POSIXLY_CORRECT` exists. Parse/validate the entire invocation before effects;
`--help` does not bypass invalid options or environment-size/work limits.

By default report all encountered directories plus explicit non-directory
operands. `-a` adds encountered non-directories. `-d N`/`--max-depth=N` is a
nonnegative **decimal safe integer** and controls reporting, not accounting or
traversal. `-s` is reporting depth zero; reject `-as` and `-s` with positive depth.
Combining `-s` and `-d0` succeeds without GNU's redundant-option warning.
`-c` reports a complete grand total after all operands.

Selected formatting is last-option-wins: `-h` uses human base 1024, `-k` uses 1024
byte blocks, `-m` uses 1048576, `-b` uses one byte, and `-B` selects SIZE.
Apparent-size selection persists after later formatting flags.
Without explicit formatting, read only own properties of `context.env`, in order:
`DU_BLOCK_SIZE`, `BLOCK_SIZE`, `BLOCKSIZE`; otherwise use 512 if `POSIXLY_CORRECT`
is present, and 1024 otherwise. A selected empty/invalid formatting value falls
back to that effective default, without consulting any lower-priority variable.
Environment-byte/work bounds remain fatal; only bounded format-parser rejection
uses this fallback. Explicit `-B` remains strict. Explicit formatting ignores
invalid environment formatting. No ambient `process.env` or locale formatting is
read. GNU 9.7 regressions cover both defaults and invalid/empty precedence; this
does not broaden the supported SIZE grammar or safe-integer limit.

SIZE is a positive decimal integer, optionally followed by `k/K/m/M/G/T/P/E/Z/Y/R/Q`
and optional `iB` or `B`. Suffix only implies one and prints a normalized suffix;
numeric prefixes suppress that label. Bare suffix and `iB` mean powers of 1024;
`B` means powers of 1000. Examples: `K` prints `2K`, `1K` prints `2`, and `KB`
prints `2kB` for 1025 bytes. Products above `MAX_SAFE_INTEGER` are rejected, so
larger suffixes cannot produce accepted sizes. Also accept `human-readable` and
`si` as SIZE. Reject signs, fractions, hex, grouping prefixes, standalone `B`,
zero and missing sizes. Leading zeros are decimal, not octal.

Numeric reporting rounds upward. Human output uses 1024 (`-h`) or 1000 (`-Bsi`)
scaling, upward rounding, one decimal below ten scaled units and integer output
otherwise, promoting to the next unit when rounding reaches its base. Examples:
1024 -> `1.0K`, 1025 -> `1.1K`, 10239 -> `10K`, 1048575 -> `1.0M` under `-bh`.
These boundaries and the common profile were measured against pinned GNU 9.7;
this bounded profile is not full GNU/POSIX `du` compatibility.

## Limits and lifecycle

After argument/environment validation, an advertised stdout `ownedOutput`
capability enrolls a destination-specific `createOutputOperation`. The same
budget continues across validation and traversal: no reset or duplicate output
charging. Metadata calls and accounted stdout writes use the operation signal;
required diagnostics use the original caller signal and the same combined byte
budget. Legacy sinks without the capability keep their original signal binding.
Invocation cleanup is registered before metadata admission; operation close and
budget cleanup are awaited from finally. An exact operation-close reason is
rethrown to the caller of the direct handler; no new success/141 normalization
is added. Shell retains its existing EPIPE stage mapping. Caller abort takes
priority and retains exact identity. Other caught errors still use the existing
DU status1/diagnostic profile, including when a required diagnostic is pending
as stdout closes. No whole caller or sibling destination is aborted just to stop
the walk. Providers receive cancellation but opaque underlying promises are not
forcibly terminated; late rejection is observed, not called successful retirement.

| Limit | Default |
| --- | ---: |
| `maxArguments` | 4096 |
| `maxArgumentBytes` | 65536 |
| `maxEntries` | 100000 |
| `maxDirectoryEntries` | 10000 |
| `maxDepth` | 256 |
| `maxPathBytes` | 16384 |
| `maxMetadataBytes` | 8388608 |
| `maxOutputBytes` | 16777216 |
| `maxSteps` | 4194304 |

Overrides must be positive safe integers. Arguments and selected environment
formatting share the argument-byte allowance. Metadata counts cumulative UTF-8
path/name accounting, not exact heap bytes; identity/index overhead is additionally
entry-bounded. Work charges parsing, path/name processing, listing validation,
sort comparisons, traversal and reporting. Output is combined UTF-8 stdout/stderr
bytes, with awaited writes in at most 16 KiB chunks and no command output collector.
The family-local limits are not a shared shell budget or new CommandContext field.

Traversal is sequential and yields periodically. Pass the invocation signal to
each VFS operation; writes use an invocation-plus-cleanup signal. Register cleanup
synchronously before admission. Cleanup closes admission, cancels local waits and
timers, observes late host failures, and shares completion across overlapping
registered/finally calls. Await command-owned cooperative waits/output cancellation,
not uncooperative host FS/sink promises. Cancellation cannot undo completed work or
forcibly stop host code. `readdir` returns a materialized array: post-return limits
do not bound the provider's allocation, requests or private work before return.

**Provider effects require separate qualification:** command-issued metadata
calls alone do not prove absence of adapter-internal side effects. The original
Overlay staging-garbage negative control is preserved in historical DU evidence;
current provider purity changes and tests have separate ownership. This command
does not claim an all-adapter no-effects guarantee or independently establish
provider-level copy-up/housekeeping behavior.

Runtime dependencies remain empty. Tests use native processes only as explicit
oracles and task-owned fixtures; the shared GNU source/binary stays read-only.
See the owned test report for source checkpoints, raw mismatches and acceptance
boundaries. Different-agent review, public package integration and deployed remote
provider acceptance are separate, not implied by author-green tests.
