# Fold byte streams in your virtual shell

Wrap text without host programs or losing original bytes. Register `fold` explicitly
from `@poe-platform/safe-bash/commands/fold`. `safe-bash-command-fold` is a private
implementation bundled, with declarations and license notices, into safe-bash;
consumers never install or publish it separately.

```ts
import { Shell, createMemoryFileSystem } from '@poe-platform/safe-bash';
import { foldCommands } from '@poe-platform/safe-bash/commands/fold';

const fs = createMemoryFileSystem();
await fs.writeFile('/input', new TextEncoder().encode('\u754c\u754c\u754c\n'));
const shell = new Shell({ fs }).use(foldCommands());
try {
  console.log((await shell.exec('fold -b -w5 /input')).stdout); // \u754c\n\u754c\n\u754c\n
} finally {
  await shell.dispose();
}
```

Use `foldCommands({ locale?, limits?, replace? })` for registration or
`createFoldCommand({ locale?, limits? })` for a command definition. With
`agentCommands()`, use `replace: true` to replace its existing fold command.
The default aggregate fold accepts `-c`, `--characters`, unique abbreviations
such as `--char`, and grouped flags such as `-sc`. Its fixed C byte profile counts
one character per byte and retains TAB/CR/BS column controls; the last `-b` or
`-c` wins. Locale environment variables do not enable UTF-8 decoding there.
Register this plugin to use the pinned Unicode profile described below.

| Command flag | Behavior |
| --- | --- |
| `-b`, `--bytes` | Count encoded bytes; UTF-8 scalars remain indivisible. |
| `-c`, `--characters` | Count decoded characters, without grapheme grouping. Last `-b`/`-c` wins. |
| `-s`, `--spaces` | Break after the last eligible blank, retaining that separator. NBSP U+00A0 and U+2007 are excluded. |
| `-w N`, `--width=N` | Positive decimal width; default 80 columns. Attached `-w5` and legacy `-12` work. |
| `--` | End options; remaining operands are literal VFS paths. |

Grouped flags (`-bc`), unique long abbreviations (`--wid=5`), leading whitespace,
`+5` and `05` widths are accepted. Zero, negative, fractional, suffixed and
out-of-range widths are rejected. Widths must fit checked JS safe-integer arithmetic
and the released 64-bit range. `--help` and `--version` are unavailable.

Examples: `fold -w40 /notes`, `fold -s -w20 /notes`,
`printf abcdef | fold -c -w3` (outputs `abc\ndef`). No operands or `-` reads stdin.
LF and absent final LF are preserved; finite buffer flushes add no line breaks.
In column/character modes, TAB advances to the next 8-column stop, CR resets the
column and BS subtracts the previous counted glyph width. Byte mode counts their
encoded lengths. Previous glyph width survives LF/file boundaries; checked
arithmetic rejects underflow. Too-wide scalars are consumed without looping.

The equivalent SDK is `await fold(context, { width?, mode?, spaces?, files?,
locale?, limits? })`, where mode is `'columns' | 'characters' | 'bytes'`.
It returns `{ exitCode, filesRead, filesFailed, accounting }`. Stdout is bytes;
file errors emit deterministic stderr, continue with later files and return status 1.
Lossy UTF-8 argv and NUL paths are refused. Option, profile and initial admission
errors emit diagnostics with status 1; streaming resource/arithmetic failures reject
with `FoldError`. Cancellation preserves the caller's reason.
Partial output is possible. Redirecting onto an input, including a symlink alias,
truncates it before reading; streaming output is not an atomic replacement.

| Invocation limit | Default |
| --- | --- |
| Input / decoded original bytes | 16 MiB each |
| Combined stdout and stderr | 32 MiB |
| Retained encoded storage | 1 MiB |
| Algorithm work | 256 Mi units |
| Arguments | 64 KiB |

Override individual limits via `limits`; values must be nonnegative safe integers.
`decodedBytes` defaults to `inputBytes`. Limits accumulate across files; argument
admission also consumes work. Retention accounts encoded storage, owned fallback
file input and output reservations, not total JS heap. At least 8196 bytes are
required for the 8192-byte line buffer and decoder; operands/output need additional
headroom. Without VFS `readStream`, bounded `readFile` is used.

Runtime: TypeScript ESM, byte streams, VFS-only I/O, explicit AbortSignal,
awaited writes and idempotent invocation cleanup. No external runtime dependencies,
host executables, ambient files/locale, implicit network, native/WASM fallback or
dynamic downloads. Explicit profiles are `C` (each byte decoded independently)
and default `UTF-8/Unicode-17.0.0` (pinned gnulib width/blank tables). Unknown profiles
are rejected. Malformed UTF-8 is retained byte-for-byte and initially counts one;
blank remainder rescans use the release's zero-character error mapping. No
normalization, BOM removal or grapheme segmentation occurs. Invalid `FF` bytes
and their suffix are preserved; native signed-char EOF collisions are not
reproduced. This table profile
does not qualify arbitrary libc locales or actual browser/workerd engines.

For lower-level streaming use `parseFoldArguments(args, limits)` and
`createFoldEngine(options, locale, limits, signal?)`. Feed at most 4096 bytes per
`push`, await writes of its owned output chunks, then write `endFile()` chunks and
call `dispose()` in `finally`. `accounting()` returns immutable budget snapshots.
Direct engine callers own source/sink cleanup and returned-output budgets.

Compatibility target: released GNU coreutils 9.10 (2026-02-04), archive SHA256
`16535a9adf0b10037364e2d612aad3d9f4eca3a344949ced74d12faf4bd51d25`.
Release `-s` excludes nonbreaking blanks; development snapshot
`b25722854370b8206d7f53f8934c36710cdd9974` uses a different separator predicate.
Source-derived semantics are distinct from native observations; see the
[acceptance plan](../../docs/plans/safe-bash-fold-acceptance.md).
Original implementation: MIT. Unicode 17 tables: LGPL-2.1-or-later,
Copyright 2000–2025 Free Software Foundation, Inc.; see LICENSE, COPYING.LESSER,
COPYING and bundled modified table source.
