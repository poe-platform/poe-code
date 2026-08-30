# Split commands

`createSplitCommands(options?)` returns a one-element command-definition list.
`splitCommands(options?)` returns the `split-commands` plugin, with collision
preflight and opt-in `replace`. Both functions, `SplitCommandsOptions` and
`SplitLimits` are exported from `virtual-bash` and `virtual-bash/commands/split`.
`split` is included in `agentCommands()` and `createAgentCommands()`: the default
registry is exactly the preserved prior 60 plus `seq`, `nl`, `rev`, `unexpand`
and `split`, each registered once. Curl and SafeJS remain optional.

Configure the default family through `AgentCommandsOptions.split`, not a second
explicit plugin installation. Aggregate replacement is a top-level option:

```ts
import { agentCommands, createMemoryFileSystem, Shell } from "virtual-bash";

const shell = new Shell({ fs: createMemoryFileSystem() }).use(agentCommands({
  split: { limits: { maxFiles: 128 } },
}));
```

The original standalone source-only delivery had no root/package exports and
left the default registry at 60. Those records remain historical, not assertions
about current availability. Current availability is checked by the isolated
ESM/declaration build and strict root/subpath consumers in
`tests/plugins/stream-five-fixture-migration`; it is not a published-release claim,
final independent packed verification, or broader native semantic parity.
No runtime dependencies, subprocesses, implicit host files or network
credentials are used.

## Command profile

`split [OPTIONS] [INPUT [PREFIX]]`

- Omitted input or `-` consumes the supplied stdin byte stream. A named input is
  read only through the supplied VFS; there is at most one input operand.
- Default mode is 1000 LF-delimited lines per file, default prefix `x`.
- `-l COUNT`, `--lines=COUNT`: line counts. Unterminated final lines count;
  CR, NUL, invalid UTF-8 and every other non-LF byte pass through unchanged.
- `-b SIZE`, `--bytes=SIZE`: exact byte-sized segments except the last.
- `-C SIZE`, `--line-bytes=SIZE`: pack complete LF records up to SIZE; split a
  longer record at SIZE bytes. A bounded lookahead window preserves records.
- `-a LENGTH`, `--suffix-length=LENGTH`: fixed alphabetic/numeric suffix width.
  `0` selects default automatic width. Exhaustion leaves completed files intact.
- `-d`, `--numeric-suffixes[=FROM]`: decimal suffixes; the optional start is
  accepted only with the long `=FROM` spelling. A start disables automatic
  widening; select a sufficient `-a` width. Leading zeroes are ignored.
- `--additional-suffix=TEXT`: append TEXT after the counter; no `/` or NUL.
- Attached short arguments, combined short options, options following operands
  and `--` are supported. Long option names must be spelled in full.

GNU-oriented automatic suffixes start with `aa`/`00`; the alphabetic sequence
continues from `yz` to `zaaa`, and numeric from `89` to `9000`. Fixed `-a` width
uses the complete alphabet before exhaustion. An explicitly empty prefix is
different from omitted prefix. Size values are positive safe integers with
optional GNU multipliers: `b` = 512; `K`/`k`, `M`/`m`, `G`, `T`, `P`, `E`, `Z`,
`Y`, `R`, `Q`; optionally `B` for decimal or `iB` for binary. Unsuffixed numbers
are bytes. Bare units imply 1. Any multiplied result beyond the JavaScript safe
integer bound is rejected before effects, even if the native utility accepts it.
Counts allow the native leading whitespace/plus spelling; decimal suffix starts
use digits only. Zero sizes and multiple splitting-mode options are errors.

Not implemented: `-n`/`--number`, `--filter`, custom separators, hexadecimal
suffixes, `--elide-empty-files`, `--unbuffered`, `--verbose`, `--help`,
`--version`, obsolete `-NUMBER`, abbreviated long names, BSD `-c`/`-p`/`-n`.
There is no native-process fallback for these flags.

## Bounded streaming

`SplitCommandsOptions` has `replace?: boolean` and
`limits?: Partial<SplitLimits>`. Limits are validated positive safe integers:

| Limit | Default | Meaning |
| --- | ---: | --- |
| `maxInputBytes` | 256 MiB | Total yielded input bytes |
| `maxOutputBytes` | 256 MiB | Total offered VFS output payload |
| `maxFiles` | 4096 | Number of output files attempted |
| `maxBufferBytes` | 8 MiB | `-C` window and each fallback read/file collection |
| `maxChunkBytes` | 64 KiB | Output slice size / requested VFS read chunk |
| `maxArgumentBytes` | 64 KiB | Total UTF-8 bytes of argv |
| `maxSuffixLength` | 128 | Counter plus auto-extension characters |
| `maxSteps` | 512 Mi | Work/input-iteration budget |

These are per invocation, not a replacement for shared Shell budgets. Shell
pipe/stdout/stderr budgets still apply. Direct VFS payloads do not magically
become Shell stdout: they have this plugin's separate `maxOutputBytes` budget.

When provided and not explicitly capability-disabled, `readStream` and
`writeStream` are preferred. Writes are awaited and their sources produce owned
byte slices under consumer backpressure. A producer may supply a larger chunk
than `maxChunkBytes`: split consumes slices without copying the entire chunk,
and never asks that producer to reuse it before retained slices are copied.
The producer and adapter can themselves allocate more memory; host JavaScript
is trusted, not sandboxed. Neither file size nor `-l` line length requires whole
file buffering on streaming adapters. Cooperative work yields allow cancellation.

Without streaming reads, `readFile` receives `maxBytes` equal to the smaller
input/buffer cap; returned bytes are checked even if the adapter ignores it.
Without streaming writes, one segment is collected under `maxBufferBytes`, then
passed to `writeFile`. A larger segment fails, not silently spills to host files.
Adapters may reject unsupported exclusive creation or streaming; those failures
propagate, with no invented fallback guarantees. The mock S3 author test proves
only configured mock behavior, not deployed-provider interoperability.

## Existing files and identity

An ordinary existing output is overwritten/truncated if it can be distinguished
from the named input and earlier outputs using complete scoped identity or the
VFS's `compareEntry`. MemoryFS, explicitly rooted RealFS and the configured S3
mock have positive overwrite tests. Equal realpaths can establish aliases;
different realpaths alone do not prove backing-store distinctness. Missing or
invalid identity is not treated as safely distinct. Invalid comparison answers
fail with `EIO`; unknown existing relationships fail with `ENOTSUP`. An opaque
wrapper can preserve truthful comparison instead of fabricating inode fields.

Known input aliases, including hardlinks/symlinks, fail before input acquisition
and truncation. Earlier output aliases are also refused, unlike native GNU's
ability to overwrite an earlier output through another link. Named-input
preflight can reject known aliases even if the file is empty. Raw stdin has no
path/descriptor identity in `CommandContext`, including shell redirection: split
cannot detect whether it aliases an output. No safety promise is made there.
An output directory is not an error when no output bytes exist: empty stdin or
an empty named file leaves it alone. With named input, metadata/comparison errors
other than that known directory condition can still occur during preflight,
before reading an empty input; no content is acquired after an unsafe identity
observation.

New names use actual `wx` creation. An existing path raced into that name fails
`EEXIST` instead of being truncated. A stable dangling final symlink is followed
using the supplied VFS `readlink`, `realpath`, `lstat` and `stat`; its missing target
is created exclusively instead of opening the link itself with `wx`. Relative
targets use the resolved parent; target components are not lexically collapsed
before adapter traversal. Missing `readlink` is an explicit `ENOTSUP` gap for this
case, not a ban on supported existing symlinks. Missing parents, loops and other
resolution errors propagate. Existing, followed symlinks to distinct files may
be overwritten. VFS
path traversal and read-only policy remain adapter responsibilities. Identity
observations are not leases, transactions, an ABA defense, or protection against
external path replacement after observation. No allocated-block, strong host
inode, mode-privacy or remote-enforcement guarantees are added.

## Failure and partial effects

Normal success produces no stdout. Command errors return status 1 and a bounded
human-readable `split:` diagnostic. Typed `FsError.code` is used for decisions;
stderr is not an errno serialization API or a GNU/BSD diagnostic clone. Paths
and error meaning are retained. Cancellation throws the original supplied
reason, including errno-shaped reasons, and is never mistaken for `ENOENT`.
Signals reach reads, writes, metadata and helper byte I/O. Uncooperative host
promises cannot be forcibly stopped; the caller can stop waiting, and late
rejections are observed. Already completed host effects cannot be undone.

There is **no rollback or cleanup deletion**. On read/write/limit/cancel errors,
completed files remain. An existing current file may already have been truncated;
the current file can be empty or partial, exactly as the adapter wrote it. Native
ENOSPC and adapter errors are not converted into success. Post-write metadata
failure may report an error even though that segment was fully written.

Fallback write collection and `-C` lookahead can defer publication compared with
native incremental output: a collection/read failure may leave a preexisting
current output untouched instead of partially truncating it. This is a buffering
effect, **not** a transactional guarantee. Streaming MemoryFS/RealFS leave partial
bytes; remote writers can have different documented publication boundaries.
Budget admission is chunk-based, so the surviving partial prefix can depend on
input/write chunk boundaries. No successfully written files are deleted to fake
all-or-nothing semantics.

## Author evidence and native profiles

The owned `tests/commands/split` directory exercises byte/name/status effects,
streaming ownership, cancellation, boundaries, read/write caps, exact partial
effects, positive overwrites, alias failures, Shell pipelines, MemoryFS,
explicit-root RealFS and configured S3 mock. Native positive rows compare
stdout, stderr, status and output bytes exactly. Error rows compare exact effects
and status while separately asserting utility-specific diagnostics; semantic
agreement is not called strict agreement. Original failed author controls and
fixture corrections remain beside later results. Author tests are **not** an
independent stress proof or a full-project gate.

Oracles are a pinned GNU coreutils **9.7 built on Darwin**, and `/usr/bin/split`
on macOS 26.4.1/Darwin 25.4.0 arm64. This does not establish GNU/Linux semantics.
The Apple control lacks `-C`/GNU long names and does not auto-extend suffixes;
its usage/error statuses also differ. These expected profiles are retained.
Official primary references consulted with `web.run`: GNU's split invocation
manual and Apple OSS `text_cmds/split/split.c`. The live GNU manual's version
is not substituted for the pinned binary. Exact binary/source hashes and
per-cohort results live in the owned evidence directory.

Scoped checks: `node --import tsx --test tests/commands/split/*.test.ts` and
`node_modules/.bin/tsc -p tests/commands/split/tsconfig.json`. Native tests skip
with an explicit reason if their pinned oracle is unavailable; skips are not
passes. Native fixtures use owned temporary directories only.
