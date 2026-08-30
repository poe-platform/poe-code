# Which: sealed author precode policy v1

Date: 2026-08-27. Status: **design candidate, implementation HOLD**. This is the
author's policy for a DIFFERENT independent fixture freeze by Poincare, followed
by explicit root implementation release. It is not that freeze, implementation,
runtime acceptance, public integration, or a claim of superiority. Hidden fixtures
were not inspected. No unresolved author behavior choice remains; root acceptance
and independent freeze remain release blockers. Changes to this policy require a
new version and coordination before implementation, not silent test adjustment.

Only this new document and non-executable `design-evidence/*.data` / `.json` are
owned here. No existing source, tests, package/default exports, config, AGENTS,
timeout work, NullableTEMPv5 guard, or expr/v6 work is changed. No new dependency,
runtime hook, filesystem capability, or executable-permission contract is proposed.

## 1. Profile and existing overlap

The proposed command is **FreeBSD-style `which [-as] [--] program...`, virtual
executable-mode discovery v1**. It searches standalone virtual files, not shell
functions, aliases, builtins, registered command definitions, interpreters, or host
programs. A registry-only name is a miss: never invent `/usr/bin/<name>`. It never
executes a discovered file. Success is not proof that shell dispatch will select
that file, that its contents are executable, or that a host principal can run it.

Actual `src/shell/runtime.ts` `discoveryBuiltin` already implements `type -aP`.
Its `searchPaths` follows `stat`, requires `capabilities.permissions === true`,
then calls `access(X_OK)`; it collects paths, reads shell-local PATH, searches the
bare operand when PATH is absent, and avoids adding an extra slash to a PATH
component already ending in slash. That useful overlap is acknowledged, not sold
as new discovery capability. Reusing it directly would impose the wrong profile,
couple a standalone command to private shell state/budgets, and change runtime.
Do not extract, export, duplicate registry discovery, or modify that runtime here.

Reuse existing `CommandContext`, `CommandDefinition`, `VirtualShellPlugin`,
`FileStat`, `FsError` / `isFsError`, `validatePath`, `isAbsolutePath`, and
`writeBytes` from `../../contracts/index.js`. Node builtin `Buffer.byteLength`
and `TextEncoder` suffice for byte accounting/encoding. Do not use the generic
`commands/internal.ts` options/command wrappers: their diagnostics, long-option
handling and catch conversion do not implement this profile. No new shared helper
or shared resource budget is necessary. `resolvePath` was inspected; it performs
lexical normalization, so it must not be used to construct displayed paths.

Proposed implementation paths, **not created or authorized by this document**:

| Path | Proposed interface/responsibility |
| --- | --- |
| `src/commands/which/options.ts` | `WhichLimits`, `WhichCommandsOptions`, private validated settings |
| `src/commands/which/which.ts` | `createWhichCommand(options: WhichCommandsOptions = {}): CommandDefinition` |
| `src/commands/which/index.ts` | Re-export factory/types; `createWhichCommands(options: WhichCommandsOptions = {}): readonly CommandDefinition[]`; `whichCommands(options: WhichCommandsOptions = {}): VirtualShellPlugin` |

`WhichCommandsOptions` has only `readonly replace?: boolean` and
`readonly limits?: Partial<WhichLimits>`. The singular factory yields name
`which`; the plural yields its singleton array. Plugin name is `which-commands`;
it preflights collisions unless `replace` is true and registers with the same
replacement policy. `replace` has no handler semantic effect. Follow the inspected
tree-family factory shape, not a new plugin mechanism. These names are proposals,
not available root imports. Root/public/default integration is a separate owner
decision after release. No README or consumer example claims present support.

## 2. Argument grammar and exact ordinary results

Arguments are literal `context.args`, excluding command name. Scan options only
before the first operand. Accept repeated/bundled `a` and `s` in either order.
`--` ends option scanning and is discarded; solitary `-` is an operand and ends
scanning. After the first operand, every remaining token (even `-a`, `--`, `-z`)
is an operand. Empty string is an operand, but always a miss. No long options,
version/help options, shell expansion, globbing, quoting interpretation, stdin
sentinel, or GNU environment/alias features exist. No operands after parsing is
usage failure, including `[]`, `['--']`, and `['-as']`.

Output is UTF-8 bytes; newline means one LF, never CRLF. Ordinary missing programs
produce no diagnostic. Iterate operands in order, retaining successes even after
an earlier miss. Without `-a`, emit only the first hit for each operand; with `-a`,
emit every hit in PATH order, including duplicates and repeated operands. `-s`
suppresses successful stdout, not usage/fatal stderr; `-as` still traverses all
candidates and therefore still exposes later fatal errors/caps. No buffering of
all matches, deduplication, sorting, or rollback of written output is permitted.

Return `{ exitCode: 0 }` exactly when every operand has a hit; otherwise return
`{ exitCode: 1 }`. All diagnosed command failures in this profile use 1, not 2,
126 or 127. Exceptions specified in section 5 reject instead of becoming a status.

Exact usage diagnostic `U` is `usage: which [-as] program ...\n`. An unknown
option produces `which: illegal option -- X\n` followed by `U`, one diagnostic
write, status 1 and empty stdout. `X` is the first unknown option Unicode scalar
in scan order; `--help` therefore reports `-`. This deliberately defines Unicode
diagnostics at the virtual string level; native getopt examines bytes and may emit
an incomplete UTF-8 byte for a non-ASCII option. Repeated valid flags have no
additional effect. A malformed option stops parsing before any VFS operation.

## 3. PATH, cwd, spelling and followed metadata

Use only the invocation's `context.env.PATH` and `context.cwd`. Do not read
`process.env`, host cwd, host files, registry state or other env keys. Do not
promote unexported shell locals; the invocation context supplies the command env.
Capture the PATH and cwd strings once; do not mutate env/cwd/args. Concurrent
mutation by trusted caller JavaScript is not a promised snapshot/lease contract.

After input admission and grammar validation, absent PATH gives silent status 1
without probes, **even for explicit slash operands**. This intentionally follows
the pinned FreeBSD `main` ordering rather than the current shell helper. PATH
equal to empty string is one empty component, not absent. Each empty component,
including leading, consecutive and trailing empties, means `.`. Preserve all
components in order. A colon is always a separator; no escaping or platform
default PATH is invented. PATH is fully validated/admitted even for explicit
slash operands; resource/NUL failures can thus precede their lookup.

For a nonempty operand containing `/`, its display candidate is exactly the
operand and it is considered once; PATH entries are not searched. Otherwise each
display candidate is exactly `(component === '' ? '.' : component) + '/' + name`.
Always add that separator, including when component already ends in `/` or is
`/`. Thus `/bin/:/bin` can display `/bin//p` then `/bin/p`; `/` displays `//p`.
No `realpath`, `join`, tilde expansion, slash collapsing, canonicalization, or
conversion of relative displayed paths to absolute paths is allowed.

Validate cwd as an absolute NUL-free virtual path. Lookup uses an absolute path:
an absolute display candidate unchanged, or `(cwd === '/' ? '' : cwd) + '/' +
displayCandidate`. Validate with existing path helpers without normalizing this
constructed spelling first. Both displayed and absolute lookup byte lengths must
be admitted before concatenation. The supplied VFS owns its existing lexical,
mount and symlink resolution; this command adds no containment or host authority.
No promise is made to repair adapter-specific normalization of intermediate
`symlink/..`. A candidate ending `/`, `/.`, or `/..` is necessarily directory-
designating and is a miss without stat; never accidentally turn `p/` into `p`.
This still consumes one candidate-probe admission. Empty operands have no candidate.

For other candidates, call exactly `fs.stat(absoluteLookup, { signal })`, following
the final symlink through the adapter. A hit requires `stat.type === 'file'` and
`(stat.mode & 0o111) !== 0`. Directory or a non-followed symlink result is a miss.
For a file, a non-integer, negative, or greater-than-`0o177777` mode is a fatal
invalid-metadata error; absent required mode is not synthesized. No content read,
directory listing, recursion, link inspection, manual symlink traversal or
execution occurs. Dangling targets and loops use the typed error rules below.

This is **advisory virtual mode eligibility**, not native access equality:
`uid`/`gid` are optional observations, not a command principal or ACL model.
No uid/group matching, owner-bit preference, root exception, or `fs.access` probe
is performed. Memory's actual access helper checks owner bits; real delegates
access to its host; S3 reports virtual metadata and denies file X_OK; WebDAV
rejects execution-access checks. The inspected S3 file fallback is 0644 but
stored virtual mode metadata can differ; inspected WebDAV file mode is 0666.
Use reported mode without fabricating executability. `permissions:false` or
absence does not make a set execute bit disappear, and does not turn that bit
into an enforcement guarantee. This permits meaningful metadata discovery on
advisory backends without inventing a capability. Real-service interoperability
and native permission parity are unqualified, not inferred from these readings.

## 4. Candidate errors, diagnostics and precedence

Only actual `FsError` instances with `ENOENT`, `ENOTDIR`, `EACCES`, `EPERM`,
`ELOOP`, or `ENAMETOOLONG` are ordinary candidate misses; continue. A no-execute
file or directory is also an ordinary miss. A code-shaped arbitrary object is
not silently treated as a filesystem miss. A live abort reason wins before any
errno classification, including an errno-shaped `signal.reason`.

Every other typed FsError is fatal: stop the entire invocation immediately,
preserve earlier stdout, emit one diagnostic, and return 1. No later operand or
candidate is probed. Exact form is `which: CANDIDATE: DESCRIPTION\n`, using the
unmodified display candidate and the lowercase description for that code in the
inspected `src/contracts/errors.ts` `descriptions` table (including `ENOTSUP` =
`operation not supported`, `EIO` = `input/output error`). Do not print errno
serialization, host syscall paths, arbitrary provider messages, or stacks.
Unknown/non-FsError provider failures use description `filesystem operation failed`.
Invalid followed-file mode uses `invalid file mode metadata`. These diagnostics
are declared virtual policy; native `is_there` treats access/stat failures as
misses instead. Quiet mode does not hide an infrastructure failure.

Input NUL anywhere in args/PATH/cwd gives `which: invalid argument: NUL byte\n`.
Invalid cwd gives `which: cwd must be an absolute virtual path\n`. A exceeded
budget gives `which: LIMIT limit exceeded\n`, with the exact option key from
section 6. These are fatal status 1. Diagnostics do not interpolate rejected
giant inputs. Within admission, count/byte limits precede NUL validation, then
grammar, then PATH/cwd validation and candidate traversal. For simultaneous
admission violations follow section 6's listed order; for a candidate, check
signal, probe count, display length, lookup length, then perform stat. Output
admission occurs only after an eligible hit. A prior ordinary miss cannot hide a
later fatal error; a first hit without `-a` avoids later candidate errors entirely.

## 5. Cancellation, sinks and ownership

Check `signal.throwIfAborted()` at entry, bounded scan boundaries, before and after
every awaited stat/write, in every FS catch before classification, and before
return. Await stat with the supplied signal; do not fire-and-forget or schedule
parallel candidates. Cooperative cancellation rejects with the exact
`signal.reason` identity, including non-Error values. A provider that ignores
signals can delay direct handler completion; this design promises neither
preemption nor a new cancellation deadline. Completed effects are not undone.

Write using awaited `writeBytes(sink, ownedUint8Array, signal)` outside FS catch
blocks. Synchronous and asynchronous stdout/stderr failures reject with their
original identity, not an extra diagnostic/status; if signal is already aborted
at the observation checkpoint, its exact reason takes precedence. The existing
byte helper observes late rejection when its abort race settles. Never retry a
failed sink or route it into filesystem diagnostics. Retain no borrowed chunks;
each output line is newly encoded and not mutated after submission.

Never obtain/read/return/cancel `stdin` or inspect `stdinIsDefault`; `-` is a
filename, not stdin. Do not invoke child commands, close caller-owned sinks,
create `ownedOutput` operations, or register fake cleanup. No independently owned
resource is acquired beyond the awaited stat; adapter internals retain their
existing cooperative resource contract. No new runtime contract is needed.

## 6. Logical admission limits (proposed exact options)

All counters are per invocation, including failures, not a shared shell/family
budget. `WhichLimits` consists of the following readonly numeric properties:

| Key, checked in this admission order | Default | Accounting |
| --- | ---: | --- |
| `maxArguments` | 4096 | All argument entries, including flags/empty strings, before copying or scanning |
| `maxArgumentBytes` | 65536 | Sum of UTF-8 byte lengths of all args, no argv0 or synthetic terminators |
| `maxPathEnvBytes` | 65536 | UTF-8 length of present PATH, even when unused by slash operands |
| `maxPathComponents` | 4096 | Colon count plus one for present PATH; absent PATH has zero |
| `maxPathBytes` | 16384 | Each cwd, display candidate, and absolute lookup separately; not their sum |
| `maxProbes` | 65536 | Every admitted candidate attempt across operands, including misses, errors, duplicates and directory suffixes |
| `maxOutputBytes` | 8388608 | Cumulative successful stdout line bytes including every LF; quiet mode charges zero |

Validate supplied known limits at factory construction: positive safe integers,
with `maxPathBytes <= Number.MAX_SAFE_INTEGER - 256`; otherwise throw
`RangeError('Invalid which limit: KEY')` before registration/execution. Unknown
limit keys throw `RangeError('Unknown which limit: KEY')`; do not silently create
an option. Default/validate only these settings; no hidden elapsed-time limit.

Admission reads length/count before allocation. Reject `.length` greater than
the remaining UTF-8 byte allowance before byte counting (UTF-8 length is never
less than JS UTF-16 length); count bytes without `TextEncoder.encode` allocation.
Check cancellation at each argument and each 4096 code-unit scan boundary.
PATH component counting uses a bounded cursor scan, not `.split(':')`; iterate
components lazily per operand, not an array or Cartesian product. Count option
characters and NUL checks with the same bounded scan discipline. Length sums
use subtraction against remaining allowance to avoid overflow. Captured PATH/cwd
are references to immutable strings, not copies of caller inputs.

Pre-admit display/absolute concatenation using component/name/cwd UTF-8 lengths
and literal separator contributions. Admit the probe before its construction,
including failed probes. Check an output line's length plus LF against remaining
stdout allowance before concatenating/encoding/writing; never partially emit a
line merely to fit. One successfully submitted line can still be partly consumed
by a sink that fails: no transactional-output claim. Non-ASCII names and lone
surrogates use standard UTF-8 replacement encoding, never character counts as
byte counts. Rescanning PATH is bounded by arguments/probes/input bytes; empty
operands do not create uncounted backend work.

Stderr is a separate bounded terminal diagnostic allowance of
`maxPathBytes + 256` bytes, not stdout remaining space. At most one terminal
diagnostic is emitted; unknown-option plus usage is one combined diagnostic.
Fixed descriptions are short enough for this bound; candidate diagnostics admit
the candidate first and account prefix/description/LF before encoding. Never
append arbitrary host error text. Thus exhausting stdout still permits its fixed
limit diagnostic. Total requested output is bounded by `maxOutputBytes +
maxPathBytes + 256` mathematically; avoid computing an unsafe combined counter.

These are logical input/attempt/output bounds, **not RSS bounds**. Caller argv and
giant strings already exist before invocation; JavaScript/encoding/path/backend
overhead, backend RPC amplification, provider stat allocations, sink retention
and caller-selected huge limits are not measured or bounded physical memory.
No cap promises to interrupt an uncooperative backend operation. There are no
native PATH_MAX/FILENAME_MAX emulation constants: exceeding a declared virtual
limit is diagnosed, not silently converted into a native long-path miss.

## 7. Freeze-ready result matrix

These are author policy examples, **not executed tests, native observations or
independent fixtures**. Default example: cwd `/v`, PATH `/a:/b`, executable regular
files `/a/p`, `/b/p`, `/v/p`, `/v/-`; `q` absent. `U` is the exact usage line above.
Notation `stdout ; stderr ; status`; `empty` means zero bytes. Native column
`S` means the same result is inferred from pinned source **conditional on native
access succeeding for those files**, not a binary-qualified observation. `V`
means deliberately virtual-only/error/cap behavior, not native evidence.

| Header | Input / altered fixture | Native (source inference, not run) | Declared virtual result/status and diagnostics |
| --- | --- | --- | --- |
| First hit | `p` | S | `/a/p\n ; empty ; 0` |
| All / duplicates | `-a p`, PATH `/a:/a:/b` | S | `/a/p\n/a/p\n/b/p\n ; empty ; 0` |
| Partial success | `p q p` | S | `/a/p\n/a/p\n ; empty ; 1` |
| Continue after miss | `q p` | S | `/a/p\n ; empty ; 1` |
| Quiet bundles | `-sa -a p q` | S | `empty ; empty ; 1`; all candidates still considered |
| Option order | `p -a` (`-a` absent) | S | `/a/p\n ; empty ; 1` |
| Terminator/literal | `-- -`, PATH empty | S | `./-\n ; empty ; 0` |
| Lone dash | `- -s`, PATH empty (`-s` absent) | S | `./-\n ; empty ; 1`; no stdin access |
| No operand | `[]`, `--`, or `-as` | S | `empty ; U ; 1` |
| Unknown flags | `-az p` | S | `empty ; which: illegal option -- z\n` followed by `U ; 1` |
| Long option | `--help` | S | `empty ; which: illegal option -- -\n` followed by `U ; 1` |
| Unset PATH | `p ./p /a/p`, PATH absent | S | `empty ; empty ; 1`; zero probes |
| Empty PATH | `p`, PATH empty | S | `./p\n ; empty ; 0` |
| Empty components | `-a p`, PATH `:/a:` | S | `./p\n/a/p\n./p\n ; empty ; 0` |
| Relative PATH | `p`, PATH `.` | S | `./p\n ; empty ; 0`, lookup `/v/./p` |
| Slash spelling | `./p /a//p` | S | `./p\n/a//p\n ; empty ; 0` |
| Trailing separator | `p`, PATH `/a/` | S | `/a//p\n ; empty ; 0` |
| Empty operand | `'' p` | S | `/a/p\n ; empty ; 1` |
| Directory suffix | `/a/p/` | S | `empty ; empty ; 1`; one attempt, no stat |
| Symlink | `/a/link` follows executable `/a/p` | S | `/a/link\n ; empty ; 0`, not target spelling |
| Miss classes | Dangling/loop/notdir/denied first candidate; `/b/p` hit | S | `/b/p\n ; empty ; 0` |
| Mode distinction | First file mode 0001; native user owner without execute | Native access may deny; principal not supplied | `/a/p\n ; empty ; 0` if stat succeeds; advisory bits only |
| Permission capability | `permissions:false`, regular file mode 0755 | V | `/a/p\n ; empty ; 0`; no access probe/host guarantee |
| Unsupported stat | First candidate `FsError('ENOTSUP')` | Native failed access/stat is a miss | `empty ; which: /a/p: operation not supported\n ; 1`; stop |
| Late fatal | `-a p`, `/a/p` hit, `/b/p` EIO | Native stat failure is a miss | `/a/p\n ; which: /b/p: input/output error\n ; 1` |
| Short circuit | `p`, `/a/p` hit, `/b/p` EIO | S | `/a/p\n ; empty ; 0`; `/b/p` never probed |
| Probe cap | `-a p`, maxProbes 1 | V | `/a/p\n ; which: maxProbes limit exceeded\n ; 1` |
| Output cap | `p`, maxOutputBytes 4 | V | `empty ; which: maxOutputBytes limit exceeded\n ; 1` |
| Unicode bytes | PATH `/a`, executable `/a/é`, maxOutputBytes 5 | V | `empty ; which: maxOutputBytes limit exceeded\n ; 1`; line is 6 bytes |
| Abort/sink | Abort reason or sink rejection object | V | Exact rejection identity; prior output retained; no manufactured status |

Independent freeze should additionally distinguish partial-multioperand behavior,
post-operand flags, UTF-8 thresholds, failed-attempt caps, advisory mode vs access,
provider normalization, rejection identity, no-stdin ownership and no content
reads. These are policy dimensions only; no hidden fixture is supplied or assumed.

## 8. Primary provenance and qualification

Official project source revision: `8268a31bcceb9ebe32d380cab792c89c5d897d15`.
Access date for all retained responses: **2026-08-27**. This is a pinned source
selection, not a claim to be current HEAD or a FreeBSD 14.3 release/build.

- [FreeBSD commit provenance](https://reviews.freebsd.org/rG8268a31bcceb9ebe32d380cab792c89c5d897d15): identifies the 2024-04-05 which path-length type change.
- [Official tree: which.c](https://cgit.freebsd.org/src/tree/usr.bin/which/which.c?id=8268a31bcceb9ebe32d380cab792c89c5d897d15), retained from [project mirror raw source](https://raw.githubusercontent.com/freebsd/freebsd-src/8268a31bcceb9ebe32d380cab792c89c5d897d15/usr.bin/which/which.c). Sections `main`, `usage`, `is_there`, `print_matches` establish PATH absence ordering, aggregate status, access/stat regular-file eligibility, literal candidate construction and native length checks. SHA-256 `dce7ea97b948b1ba0248a1a699248b8ab63c36f4887d8b95a8ae2b8cbe6bae25`.
- [Official tree: which(1)](https://cgit.freebsd.org/src/tree/usr.bin/which/which.1?id=8268a31bcceb9ebe32d380cab792c89c5d897d15), retained from [project mirror raw manual](https://raw.githubusercontent.com/freebsd/freebsd-src/8268a31bcceb9ebe32d380cab792c89c5d897d15/usr.bin/which/which.1). Sections SYNOPSIS, DESCRIPTION, EXAMPLES define the short flags and demonstrate duplicate output. SHA-256 `904c4c1e74bbbbb1b6c0114cdea88b0609282cb6f7ed39513cfb4a912f151cdb`.
- [Official tree: getopt.c](https://cgit.freebsd.org/src/tree/lib/libc/stdlib/getopt.c?id=8268a31bcceb9ebe32d380cab792c89c5d897d15), retained from [project mirror raw source](https://raw.githubusercontent.com/freebsd/freebsd-src/8268a31bcceb9ebe32d380cab792c89c5d897d15/lib/libc/stdlib/getopt.c). Function `getopt` defines stop-at-operand, lone dash, `--`, option bundling and illegal-option diagnostic. SHA-256 `a911e3dcd3cdfed04cc1192e7668feabe5452435c58304c53870a3d7a26f0fce`.

Web search/fetch was performed. cgit and rendered man endpoint opens returned no
usable body through the web tool; the official project's pinned GitHub mirror
provided the actual manual/source bytes. Raw data preserves upstream notices,
is classified non-executable, and is not TypeScript input or canonical tests.
`design-evidence/provenance.json` records byte counts, hashes, exact URLs and
local source guards; its local HEAD is a capture anchor, not exclusive tree
ownership or a runtime gate.

**Native availability:** no FreeBSD binary was provisioned; specifically no
FreeBSD 14.3 qualification. Darwin `/usr/bin/which` was not invoked, inspected,
hashed or qualified. Zero native controls were needed; no uid/effective-policy
measurement or native fixture scratch exists. No GNU oracle was used. This is
not GNU parity and must not erase BSD/GNU differences; GNU extensions are outside
the declared grammar. All table native results are conditional source inferences,
not author executions, and certainly not Poincare independent evidence.

No product/test implementation, test suite, typecheck/build or real service
acceptance was run for this document-only task. Verify raw hashes, document-only
owned diff, explicit-path commit and unchanged read-source guards. Concurrent
foreign files/staging remain outside the commit; guard equality of listed files
does not prove an append-proof repository or qualify unlisted files.
