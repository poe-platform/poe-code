# Gzip-family commands

`index.ts` exports `createCompressionCommands(): readonly CommandDefinition[]`,
returning definitions named `gzip`, `gunzip`, and `zcat`. This is the utility's
source-module factory, not a claim about package-root exports or shell
registration. All file access uses the injected `CommandContext.fs`; runtime
code uses Node builtins and shared project contracts, not host filesystem APIs,
subprocesses, evaluation, or third-party dependencies. Optional native-reference
tests, unlike the commands themselves, spawn installed gzip executables.

## Invocation and exact options

`gzip [OPTION]... [FILE]...` compresses; `gunzip` decompresses; `zcat` means
`gunzip -c`. With no operands, or for an operand exactly `-`, the command uses
stdin and stdout, never a file named `-`. Operands run in order. Each compressed
operand produces a separate gzip member; decompression concatenates decoded
members. Repeated `-` operands reuse the supplied stdin source without rewinding
it. Named files resolve relative to the injected virtual cwd.

| Short | Long | Behavior |
| --- | --- | --- |
| `-c` | `--stdout`, `--to-stdout` | Send bytes to stdout; retain named inputs. |
| `-d` | `--decompress`, `--uncompress` | Select gzip decompression. |
| `-k` | `--keep` | Retain input after successful file publication. |
| `-f` | `--force` | Permit eligible replacement and multiply linked input; see restrictions below. |
| `-t` | `--test` | Decompress and validate, discarding output; never modify inputs. |
| `-n` | `--no-name` | Accepted; the no-name/no-timestamp header policy is always enabled. |
| `-1` through `-9` | `--fast` (`-1`), `--best` (`-9`) | Compression level; default `6`, last level wins. |
| `-h` | `--help` | Print usage to stdout without reading operands. |

Short options combine, including `-9ck`. Options can follow operands until `--`;
after `--`, dash-leading names are operands. Long options must match exactly and
take no values. Unsupported flags, abbreviated long options, `--flag=value`,
and `-0` fail rather than silently doing something else. Levels are accepted but
have no effect during decompression. `-t` selects decompression regardless of
argument order and suppresses stdout even with `-c`; help takes precedence over
execution after all options have been parsed successfully.

Force does not bypass integrity checks on input starting with gzip magic
`1f 8b`. Only decompression to stdout (including stdin's implicit stdout and
`zcat`) with `-f` passes non-gzip input and suffixes through unchanged.
As in pinned GNU gzip 1.14, `-ft` accepts that data but discards all output.
File-output decompression never uses this passthrough. No option switches
`gunzip` or `zcat` back to compression.

## Names, metadata, and format

Named compression appends `.gz`. Without `-f`, file-output compression rejects
names already ending in `.gz`, `.z`, `-gz`, `-z`, `_z`, `.tgz`, or `.taz`.
File-output decompression removes `.gz`, `.z`, `-gz`, `-z`, or `_z`; `.tgz` and
`.taz` become `.tar`. These suffix checks are case-insensitive. Unknown suffixes
and empty resulting basenames fail. Stdout and test modes require no suffix,
and there is no implicit search for a missing operand with `.gz` appended.

Compression emits real gzip/DEFLATE, with zero MTIME, no original-name or comment
fields, and OS byte `255`. The implementation normalizes the OS byte on the
stream, so this policy is independent of the host OS. Given identical input and
level, this removes name, time, and OS-header variation; identical compressed
bytes across different Node/zlib versions are not promised. Decompression parses
gzip framing around Node raw-DEFLATE streams, validating optional-header CRC,
reserved flags, per-member CRC32, ISIZE and truncation. Concatenated members
decode in order. Trailing zero padding succeeds; other trailing garbage reports
warning status 2 while retaining validated output. A truncated next header
fails with status 1. Forced stdout mode preserves non-gzip suffix bytes instead.
These semantics have pinned GNU 1.14 evidence across input chunk boundaries.

Embedded gzip filenames are never used as paths. File modes, ownership,
timestamps, and other source metadata are not restored or copied by the
command. Private staging requests directory mode `0700` and file mode `0600`;
actual permission enforcement and published-file metadata depend on the VFS.
The `.tar` suffix transformation is only naming: there is no tar creation,
extraction, or archive traversal.

Input spelling is preserved until the virtual filesystem resolves it. In
particular, a parent symlink followed by `..` must be resolved by the filesystem,
not lexically normalized by the command. File destinations are derived from
the resolved regular source path, so output publication and overlap checks
refer to the actual source directory. Source identity checks still revalidate
the original input path before publication/removal.

## Streaming, cancellation, and limits

Input/output are `Uint8Array` streams. Named inputs require `readStream` and
`streamingRead !== false`; there is deliberately no `readFile` fallback.
File output additionally requires `writeStream` and `streamingWrite !== false`.
An explicit `readOnly: true` capability rejects named-file output with `EROFS`
before the streaming-write capability check or staging. Missing streaming writes
on a writable/unspecified backend still report `ENOTSUP`. Readonly policy does
not prohibit stdout compression, stdout decompression, or validation-only mode.
Those capability flags may be absent if the methods are present. Inputs must
be regular, non-symlink entries, including for stdout/test modes.

The codec uses 64 KiB chunks/high-water marks and awaited sinks for backpressure.
An empty-only producer yields to the event loop after every 64 chunks, including
during forced-decompression prefix probing, so scheduled cancellation can run.
This bounds command-managed read-ahead, not the size of a chunk already supplied
by a producer, nor buffering inside an adapter. Named input gets the combined
parent/internal abort signal, as does the staging writer. Source, codec, and
consumer failures abort their peer operations. Byte helpers stop waiting on
blocked stdin/stdout operations and observe late promise rejections; the command
does not close the caller's stdout/stderr sinks.

**A staging writer must settle before cleanup.** The transform explicitly awaits
its consumer even after pipeline failure, preventing a still-running VFS writer
from recreating or modifying the stage after cleanup. An adapter that ignores
abort and never settles can therefore block the command indefinitely. The
command cannot forcibly stop adapter work or undo late host side effects.
Tests cover delayed writers on parent cancellation and producer failure, as
well as blocked byte sources/sinks and late rejections. This is cooperative
cancellation, not a hard deadline or termination guarantee.

File staging allows at most **256 MiB (268435456 bytes) of output per operand**,
counted after compression/decompression and before forwarding each output chunk
to the writer. Exceeding it fails with `EFBIG`; no larger archive is buffered as
a workaround. Stdout and `-t` have no command-level total byte cap. Shell-level
output, execution, or cancellation limits are separate and still apply when
these definitions run through the shell. A provider may internally buffer the
staged bytes despite its streaming interface.

## Publication and cleanup boundaries

All operands are preflighted before any transformation. Invalid paths,
capabilities, suffixes, existing targets without force, duplicate outputs, or
detected input/output aliases fail the invocation before command file mutation.
Symlink inputs and destinations are rejected; hardlinked destinations aliasing
an input are rejected when their identity is available. Multiply linked inputs
require `-k` or `-f` only when file output would otherwise remove the input.

Each file output is first written to `data` in a randomly named, exclusively
created sibling `.virtual-bash-gzip-*` directory. Source snapshots/realpaths and
destination snapshots are checked again before publication; stage identity is
also checked. A previously absent destination uses `copyFile` with
`exclusive: true`. Replacing an existing regular destination requires `-f` and
`capabilities.atomicRename === true`, and uses `rename` from the stage. Without
that capability, forced replacement is refused, not implemented as unlink/copy.
Only successful publication and cleanup permit source removal (unless `-k`),
after another source snapshot check.

These are defensive checks, **not a filesystem transaction or conditional
unlink guarantee**. The VFS has no compare-and-swap, handle-relative no-follow,
or conditional-remove primitive. A hostile external mutation can race between
any check and use, including source removal, target replacement, and cleanup.
Missing/reused inode identifiers and coarse or unreliable metadata further
weaken identity checks. Parent-directory symlink races are not eliminated.

Exclusive copy need not be atomic: a backend may expose partial destination
bytes or leave a partial file after copy failure/cancellation. The command does
not delete that destination, since it cannot prove it still owns the entry.
Atomic rename is trusted only as advertised; publication may already have
occurred when cancellation or a later error is observed. Existing targets are
preserved on validation/codec failure before publication, not unconditionally
under arbitrary backend failures. Successful earlier operands are not rolled
back when later operands fail.

Cleanup uses a fresh five-second abort signal, which is only effective if the
backend honors it. It checks the directory/stage identity, removes only the
recognized stage, checks that the directory is empty, then removes the directory.
Foreign entries or replaced identities cause refusal and leave artifacts for
inspection. The final empty-directory check/removal still has a race; it is not
safe against hostile concurrent insertion. Cleanup failure retains the source,
even if the destination was already published. On both processing and cleanup
failure, an aggregate diagnostic reports the failure without deleting foreign
entries known to the checks.

## Diagnostics and compatibility boundaries

Success (including `-t` and help) returns exit code `0`; processing or filesystem
failure returns `1`; trailing-garbage warnings and option-usage errors return `2`.
An error takes precedence over warnings across operands. GNU warning semantics
are covered, but usage status and diagnostic wording are not universal GNU parity.
Diagnostics use stderr with the invoked command name.
Preflight failure stops the invocation; after preflight, per-operand processing
errors are reported and later operands are attempted. Parent cancellation
rejects with the parent abort reason instead of returning a normal exit code.
If stderr itself fails, reporting can reject rather than produce a result.

Stdout is genuinely streaming: errors or cancellation can leave partial output,
including bytes decoded before a later corrupt member/trailer. Consumers must
check completion/exit status rather than treating received bytes as validated.
`-t` emits no data, and file output stages validation before publication.

This is a specified subset, not GNU/POSIX gzip compatibility certification.
Unlike GNU gzip's default named compression, no original name/time is stored;
metadata preservation, prompting, terminal detection, name restoration (`-N`),
custom suffixes (`-S`), listing, recursion, verbosity/quiet, rsyncable mode,
environment-driven `GZIP` options, and other undocumented flags are unsupported.
Only gzip is decoded: not ZIP, zlib wrappers, raw DEFLATE, pack, or compress `.Z`.
In particular, `zcat` here means gzip decompression, **not POSIX compress-format
`.Z` decompression**. A `.Z` filename can pass the case-insensitive suffix rule
but its contents must still be gzip (or pass through unchanged under `zcat -f`).

Primary references used to check these boundaries: GNU Gzip manual, “Invoking
gzip” and “Overview”; Node.js v22.18.0 API documentation, “Zlib”, especially
`zlib.Gunzip`. These establish external behavior, not evidence that this command
matches every GNU case. Native author tests report the actual executable/version;
Apple gzip interoperability is not a GNU oracle or a superiority benchmark.

## Author validation

Run from `/Users/kjopek/Workspace/safe-bash`:

```sh
node --unhandled-rejections=strict --import tsx --test tests/commands/bytes/compression/*.test.ts
node node_modules/typescript/bin/tsc --noEmit --target ES2023 --lib ES2023 --module NodeNext --moduleResolution NodeNext --strict --noUncheckedIndexedAccess --exactOptionalPropertyTypes --verbatimModuleSyntax --forceConsistentCasingInFileNames --skipLibCheck --types node src/commands/bytes/compression/*.ts tests/commands/bytes/compression/*.ts
```

The type command matches the repository's strict settings and follows imports;
it is not a whole-repository typecheck. The limit regression exercises the same
output counter with a smaller injected limit and asserts the production 256 MiB
constant; it does not allocate a 256 MiB archive. Independent verification and
package/root registration remain separate handoff tasks.

Author checkpoint, August 26, 2026: Node v22.22.2 on Darwin 25.4.0 arm64;
84/84 owned tests passed with strict unhandled-rejection handling, zero skips,
and strict scoped TypeScript passed. Native interoperability used Apple gzip
479 for both `gzip` and `gunzip`, not GNU gzip. Twenty additional repetitions
of the following ten-test selection passed (200/200 executions):

```sh
node --unhandled-rejections=strict --import tsx --test --test-name-pattern='backpressure|cancell|blocked|tears down|consumer returning early' tests/commands/bytes/compression/streaming.test.ts
```
