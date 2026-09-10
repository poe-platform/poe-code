# Hexdump and hd

`createHexdumpCommand(options)` constructs `hexdump`.
`createHdCommand(options)` constructs `hd` with canonical output enabled.
`createHexdumpCommands(options)` returns both definitions;
`hexdumpCommands(options)` installs both, with collision preflight.

## Supported interface

```
hexdump [-Cv] [-n LENGTH] [-s SKIP] [--] [FILE ...]
hd      [-v] [-n LENGTH] [-s SKIP] [--] [FILE ...]
```

Without file operands, read stdin. An explicit `-` names a VFS file literally;
it does not select stdin. File contents concatenate into one byte stream, even
across partial 16-byte blocks. Missing files produce diagnostics and status 1
while later files continue. Directory/read-error diagnostics follow the measured
BSD status behavior: warnings alone do not set status 1. Host cancellation,
output failures, cleanup failures and resource-limit failures remain distinct
from those nonfatal input warnings.
Empty filenames fail with ENOENT, and a trailing slash on a regular file fails
with ENOTDIR rather than silently normalizing either spelling into another input.

Default output uses little-endian two-byte hexadecimal words and seven-digit
minimum hexadecimal addresses. `-C` uses 16 one-byte hexadecimal fields, an
eight-digit minimum address and printable ASCII (`0x20` through `0x7e`). Other
bytes appear as dots only in the ASCII column; their hex values remain exact.
Repeated `-C` prints repeated canonical rows, with one final address.
`hd -C` fails with the historical BSD usage diagnostic because `hd` already
implies `-C`; that historical diagnostic mentions native options outside this
implementation's supported subset.

Repeated blocks collapse to a single `*` line unless `-v` is set. The measured
BSD implementation also collapses a final partial block when its bytes match
the prefix of the preceding full block. Default word output zero-pads the final
odd word and space-pads unused fields. Canonical ASCII output stops at the last
actual byte. Empty input prints nothing. A successful nonempty skip followed by
EOF prints the actual consumed address, even when the requested skip is larger.

`-n` limits bytes displayed after `-s`; `-n 0` performs no input acquisition,
filesystem access or skipping, including for missing file operands. Lengths use
decimal-prefix conversion. Skips use base-0 conversion (decimal, leading-zero
octal or `0x` hexadecimal), with `b`, `k`, `m` multipliers of 512, 1024 and
1048576. Native permissive prefixes are retained: `-n 3junk` means 3, `-n 0x3`
means 0, and a nonnumeric value means 0. Negative nonzero values fail. Numbers
outside JavaScript's safe integer range fail explicitly rather than overflow.
Combined short options, attached arguments and `--` work. Options are permuted
past file operands unless `POSIXLY_CORRECT` is present in the command environment.

Custom `-e` formats are optional in issue #684 and are intentionally not
implemented. `-f`, other native presets (`-b`, `-c`, `-d`, `-o`, `-x`), long
options and locale-dependent byte classification are also outside this subset.
Unsupported options fail before opening inputs; they never call a host utility.

## Host options and bounds

`options.replace` defaults to `false`; `true` permits replacing both registered
names. `options.limits` accepts partial overrides of the following positive
safe-integer limits, validated when constructing a command:

| Limit | Default | Accounted resource |
| --- | ---: | --- |
| `maxArguments` | 4096 | Argument count |
| `maxArgumentBytes` | 65536 | Byte-valued arguments |
| `maxInputBytes` | 33554432 | Cumulative bytes delivered by providers, including skipped bytes and unused chunk tails |
| `maxBufferedBytes` | 8388608 | Logical retained argument, reader, snapshot, chunk, block and output allocation budget |
| `maxOutputBytes` | 134217728 | Cumulative stdout bytes; whole rows admitted before writing |
| `maxDiagnosticBytes` | 65536 | Cumulative stderr bytes |
| `maxFormats` | 64 | Repeated canonical formats |
| `maxWork` | 536870912 | Accounted parsing, input and output work |
| `maxEmptyChunks` | 4096 | Empty chunks per input source |

Only the command environment's `POSIXLY_CORRECT` setting changes option parsing.
There are no ambient host environment variables, implicit filesystem access,
network calls, native subprocess fallbacks or runtime package dependencies.
VFS paths must be valid UTF-8 because the filesystem contract is string-valued;
dump input itself is never text-decoded.

The streaming path requests 16 KiB chunks, owns retained bytes and closes an
early-ended iterator. Filesystems that explicitly disable streaming use bounded
`readFile`, charging the snapshot concurrently with its owned chunk copy. Skips
are streamed, not host-seek shortcuts, and therefore remain subject to input
and work caps. Limits are logical ownership bounds, not total process RSS or
protection against arbitrary allocations inside host callbacks.

Cancellation is checked after effectful method getters and before invocation.
An already admitted stream returned during synchronous cancellation is acquired
only for cleanup, without pulling it. Pending reads and owned writes drain before
cleanup and command settlement. Falsey caller abort reasons retain their identity.
Cooperative work yields check the calling Shell's CPU deadline as well as the
destination's cancellation signal. Direct factory calls do not create a separate
Shell CPU timer. Arguments and stdout enrollment are captured once, so later
accessor results cannot replace the admitted inputs or output destination.
No finite settlement guarantee is made for an uncooperative host operation.

## Qualification

Native behavior is qualified against **bsdmainutils 11.1.2ubuntu3**, x64
little-endian, not util-linux. The sidecar independently read the complete
applied utility closure: six C files and `hexdump.h`, 1869 lines total. Source
hashes and the native binary hash match the supplied prior qualification.
Archive-signature authentication is inherited from that prior evidence; this
qualification does not claim a reproducible native build or a libc source audit.

Tests use in-memory filesystems and committed byte expectations: 48 applicable
cases from the prior capture, 121 fresh bounded native captures and two native
pathname controls, plus safety and actual Shell/plugin cases. Native subprocesses and disk fixtures belong
only to the separate scratch capture, never to the unit-test logic.
Byte-exact comparison is limited to the supported cases; other unsupported-option
diagnostics intentionally describe this smaller interface rather than fabricate
the installed native executable path.
