# Line-ending commands

This bounded virtual profile supplies `dos2unix` and `unix2dos`. It operates on
the injected VFS and byte streams; it never starts a host process, opens a host
path, installs a dependency, or requests network access. The command functions
are `createDos2unixCommand`, `createUnix2dosCommand`,
`createLineEndingCommands`, and the plugin `lineEndingCommands`.
`LineEndingCommandsOptions` accepts `replace?: boolean` (default false) and
`limits?: Partial<LineEndingLimits>`.

The default `createAgentCommands()` and `agentCommands()` presets include both
commands. The integrated root and scoped entrypoints expose all four factories
and the `LineEndingCommandsOptions` and `LineEndingLimits` types:

- `poe-code/safe-bash` and `poe-code/safe-bash/commands/line-endings`
- `@poe-platform/safe-bash` and `@poe-platform/safe-bash/commands/line-endings`

Configure the family through `lineEndings.limits` on either aggregate factory,
for example `agentCommands({ lineEndings: { limits: { maxFiles: 32 } } })`.
All 13 fields in the limits table below are forwarded. Replacement follows the
aggregate's top-level `replace` policy; nested `lineEndings.replace` is not
forwarded. Direct family factories accept `replace` through
`LineEndingCommandsOptions`.

## Supported conversion profile

With no file operand, input comes from stdin and output goes to stdout. A bare
`-` is not a stdin alias: use no operand for stdin; `-- -` names the VFS file
`-`. Named files are converted in place by default. `-n IN OUT` selects new-file
mode, permitting multiple pairs; `-o` returns to in-place mode. The corresponding
long names are `--newfile` and `--oldfile`.

Options take effect from their position, not globally. In particular, the pinned
implementation uses the argument immediately before an output operand as the
input filename. In `-n in -b out`, this is `-b`, not `in`. `-n` without operands
still converts stdin. A later syntax error does not roll back completed files.

Supported options:

| Options | Effect |
| --- | --- |
| `-b`, `--keep-bom` | Retain a recognized input BOM in the output encoding. |
| `-r`, `--remove-bom` | Remove the input BOM and cancel an earlier add-BOM option. |
| `-m`, `--add-bom` | Add a BOM, including for empty input. |
| `-f`, `--force` | Convert control bytes instead of stopping as binary. |
| `-s`, `--safe` | Restore binary detection, the default. |
| `-q`, `--quiet` | Suppress normal progress and most warnings. |
| `-k`, `--keepdate` | Preserve input access/modification times to whole seconds. |
| `-l`, `--newline` | Add an extra line ending at the native conversion points. |
| `-u`, `--keep-utf16` | Keep UTF-16 code-unit encoding instead of transcoding. |
| `-ul`, `--assume-utf16le` | Assume little-endian UTF-16 when no BOM is detected. |
| `-ub`, `--assume-utf16be` | Assume big-endian UTF-16 when no BOM is detected. |
| `-ascii` | Restore byte conversion, disabling UTF-16 assumptions and retention. |
| `-7` | Replace high bytes with spaces; a recognized Unicode BOM disables this mapping. |
| `-c`, `--convmode` with `ascii` or `7bit` | Select these same conversion modes. |
| `-S`, `--skip-symlink` | Preserve an output symlink and its target, the default. |
| `--` | End option parsing. |
| `-h`, `--help` | Describe this virtual subset, not the native full-feature help. |

There is no short-option clustering or long-option abbreviation. ISO/codepage
conversion, Mac mode, information mode, verbose mode, license/version output,
ownership-changing options, and follow/replace-symlink options are not supported.
Unsupported options produce an explicit virtual diagnostic and status 1, rather
than pretending that the full native option set is available. Native unknown
options instead print their full help to stdout; that is an intentional gap.

## Bytes, BOMs and locale

Without a UTF-16 BOM/assumption, data is byte-preserving apart from requested line
endings, BOM handling, binary stopping, or seven-bit conversion. Invalid UTF-8
payload bytes are not repaired. Embedded BOMs are ordinary payload. `dos2unix`
removes the initial BOM by default; `unix2dos` keeps it by default. `-b` behaves
consistently in both. UTF-8, UTF-16LE/BE, and the four-byte GB18030 BOM are
recognized. Recognizing a GB18030 BOM does not implement GB18030 transcoding.

UTF-16 conversion reads `LC_ALL`, then `LC_CTYPE`, then `LANG`, ignoring empty
values; absent values select `C`. Supported transcoding locales are `C`, `POSIX`,
`C.UTF-8`, and `C.utf8`. The first two accept only ASCII output; the latter two
encode Unicode scalar values as UTF-8. Other selected locales are explicitly
refused for UTF-16 transcoding. `-u` retains UTF-16 code units, including invalid
surrogates, without transcoding. Diagnostics are fixed English. No locale files,
`LANGUAGE`, `DOS2UNIX_LOCALEDIR`, or Windows `DOS2UNIX_DISPLAY_ENC` are consulted.

The pinned 7.4.0 conversion quirks are retained, not silently normalized:

- `dos2unix` removes CR only before LF, preserving lone CR.
- `unix2dos` consumes the character after CR as lookahead: CR-CR-LF becomes
  CR-CR-CR-LF. That lookahead also bypasses the next character's binary check.
- Binary detection stops on control values below 32 other than TAB, LF, FF, CR.
  Files are left unchanged; stdout keeps the converted prefix. File skips return
  0; nonquiet stdin binary stopping returns 1, while quiet stdin returns 0.
- Truncated BOM candidates can produce a `can not read ...: Success` diagnostic
  and no converted prefix. Files remain unchanged, with a conversion warning.
  The prototype models the captured clean-process errno case, not arbitrary
  native errno residue after unrelated preceding failures.
- An odd final UTF-16 byte and a high surrogate at EOF are discarded. Pending
  high-surrogate state crosses files within one invocation, but not invocations.
  UTF-16 conversion errors preserve files and return 1 there; stdin may keep a
  partial result and return 0. Invalid-surrogate diagnostics can appear with `-q`.

VFS path arguments must be valid UTF-8 without NUL. Invalid byte arguments and
unpaired UTF-16 string arguments are refused, never redirected to replacement-
character filenames. A leading BOM in a filename is preserved. Arbitrary Linux
byte filenames are outside this VFS path profile.

## Filesystem publication and qualifications

Conversion requires stable, comparable file/directory identities and path-specific
atomic rename, exclusive creation, and permission capabilities. Append/removal
must be available. Output ancestors must be real directories, not symlinks;
an initially absent destination additionally requires `atomicRenameNoReplace`.
Publication uses `rename({ noReplace: true })` so a concurrent new destination
is preserved. Providers without that capability, including the portable real
filesystem adapter, refuse absent destinations before creating a stage;
existing-target conversion still uses ordinary atomic rename. Any
capability or identity uncertainty is refused rather than falling back to
truncate-in-place. Default output symlinks are skipped. A new-file input symlink
may resolve to a regular VFS target; path enforcement still belongs to the VFS.
Nonregular input files are skipped. Output directories are refused rather than
reproducing native failed-rename diagnostics with random temporary filenames.

The command creates an exclusive sibling stage, converts into it, sets metadata,
and atomically renames it over the destination. In-place conversion therefore
breaks an existing hardlink, leaving other names on the old contents. Each later
append, chmod, timestamp update, and publication checks stage/parent identities;
publication also checks that the destination has not been replaced. These
path-based checks do not constitute an atomic identity lease against an arbitrary
provider that mutates paths inside an admitted operation.

Only rwx permission bits are copied. New-file mode uses a fixed virtual `022`
mask, not ambient host umask. In-place publication checks that supplied uid/gid
metadata agrees with the newly created stage. There is no chown API: arbitrary
ownership changes, ACLs, xattrs, set-ID bits, host birth/ctime fidelity and native
timestamp precision are not promised. Missing uid/gid metadata cannot establish
ownership parity. `-k` needs a functioning timestamp API.

Retained cleanup is captured before stage acquisition. Known-owned stages are
removed on conversion, budget, cancellation, or publication failures. Foreign
replacements are never deleted or modified during cleanup. If creation completes
but cancellation prevents identity capture, the command cannot establish stage
ownership: an empty temporary may remain. That measured limitation is deliberate
fail-closed behavior, not rollback or a native-parity claim. Unlike native's
failed-rename path, a known-owned stage is cleaned rather than deliberately left.
Cleanup I/O failures remain observable, including together with a primary failure.

## Limits and cancellation

Every limit is a positive safe integer; invalid settings throw during factory
construction. Resource refusals are status 1 diagnostics and are not silenced by
`-q`. Limits accumulate across one invocation, except the per-path/creation and
chunk dimensions noted below.

| `LineEndingLimits` field | Default | Dimension |
| --- | ---: | --- |
| `maxArguments` | 1024 | Argument count. |
| `maxArgumentBytes` | 262144 | Total argument bytes. |
| `maxInputBytes` | 16777216 | Bytes received from all input sources, including BOMs. |
| `maxOutputBytes` | 33554432 | Converted bytes admitted to output buffers, across files/stdout. |
| `maxBufferedBytes` | 2097152 | Owned argument, reader, fallback snapshot and output buffers. |
| `maxDiagnosticBytes` | 65536 | Cumulative diagnostic bytes and separate bounded diagnostic allocation. |
| `maxFiles` | 128 | Named conversion attempts, including skipped files. |
| `maxWork` | 134217728 | Cumulative byte and I/O work, yielding at 1024-step intervals. |
| `maxEmptyChunks` | 1024 | Empty chunks per reader; work is also cumulative. |
| `maxPathBytes` | 4096 | Argument byte cap; resolved paths use conservative three-times-code-unit admission. |
| `maxDepth` | 64 | Resolved path components, including checked output ancestors. |
| `maxTempAttempts` | 128 | Exclusive sibling-name attempts per output. |
| `chunkSize` | 16384 | Requested streaming input chunk/output buffer size. |

Readers copy producer-owned chunks before advancing them. Nonstreaming reads
request a maximum of `min(maxInputBytes, floor(maxBufferedBytes/3))`, reserving
that fallback bound before acquisition and rejecting larger results. Adapters
must honor their own preallocation contract; the command cannot bound arbitrary
allocations performed inside a caller-supplied provider.

Writes honor destination backpressure and register cleanup before acquisition.
Cooperative owned writes and admitted input operations drain before cleanup.
Ordinary opaque shell sinks keep the shell's interruptible behavior. Caller
cancellation, including `false`, `0`, empty string and `null`, takes precedence;
consumer close and shell disposal stop future admission. File payload writes use
the shared shell file-output budget once, without charging again at rename.
Completed prior files are not rolled back. Transport failures and their partial
effects are not claimed to match arbitrary native stdio buffering or errno paths.

## Evidence

Reference: dos2unix 7.4.0-2, applied source commit
`5e9cfe459a0336a39d9eab910cb5860fc680e846`. The four C files and four headers
(4939 lines), Makefile, version.mk and Debian build rules were read. Cached source
files were compared against the authenticated-source preparation receipt; the
prototype did not independently verify archive signatures or rebuild binaries.
Reference binary SHA-256: dos2unix
`9a37c087deb5aed316466d2d78d9331123d4f8c2148dfdbcdf8e141f924ab73c`, unix2dos
`4f1eb6e3b23863eda1e9882ceeb2aebefbe100c3c5928ce4d0762d393b867d7d`.

Author scratch evidence covers 172 of the prior 190 native captures plus 16 new
bounded native captures, using in-memory actual-Shell fixtures. Selected cases
compare exact stdout/stderr bytes, status and VFS payloads; original regular-file
cases additionally compare rwx mode, and keepdate cases compare mtime. They do not
prove all-input parity, arbitrary ownership, native inode numbers, or host races.
The separately named safety suite covers virtual bounds, raw path refusal,
producer copying, falsey admission, output backpressure, retained cleanup, and
the unknown-identity negative control. See the handoff receipts for current
counts and any pending independent review; no packed-gate execution is implied.
