# Byte commands

Eleven commands operate on byte streams through the injected virtual filesystem:
`base64`, `base32`, `xxd`, `od`, `sha256sum`, `sha1sum`, `md5sum`, `cksum`,
`gzip`, `gunzip`, and `zcat`. The implementation uses Node builtins and adds no
runtime dependencies. Production commands do not execute native utilities or
fall back to host filesystem paths. Native executables are optional test oracles
only. This is a bounded compatibility implementation, not complete GNU/POSIX
utility compatibility or evidence of performance superiority.

## Registration and integration

`index.ts` exports:

- `ByteCommandsOptions`, with `readonly replace?: boolean`.
- `createByteCommands(): readonly CommandDefinition[]`, returning fresh command
  definitions in the eleven-command order above.
- `byteCommands(options: ByteCommandsOptions = {}): VirtualShellPlugin`, named
  `byte-commands`. Without replacement, setup checks **all** names for existing
  registrations before registering any command. With `{ replace: true }`, each
  definition is registered with replacement enabled. The plugin adds neither
  middleware nor filesystems. Collision preflight is not rollback for an
  arbitrary custom registry that throws during registration.

The following uses repository-relative source imports from the repository root
with `node --import tsx --input-type=module`. It does not depend on package-root
re-exports or promise an exported `virtual-bash/commands/bytes` package subpath.

```js
import { byteCommands } from "./src/commands/bytes/index.ts";
import { createMemoryFileSystem } from "./src/fs/memory/index.ts";
import { Shell } from "./src/shell/index.ts";

const fs = createMemoryFileSystem();
await fs.writeFile("/payload", Uint8Array.of(0, 255, 10, 128, 65));
const shell = new Shell({ fs }).use(byteCommands());
const result = await shell.exec(
  "set -o pipefail; gzip -c /payload | base64 -w0 | base64 -d | zcat",
);
console.log(result.exitCode, Array.from(result.stdoutBytes));
```

Expected output is `0 [ 0, 255, 10, 128, 65 ]`. Use `stdoutBytes`, not the text
view `stdout`, when consuming arbitrary binary output. `-c` avoids replacing
the input file. Commands can instead be registered individually from the
factory through the existing command registry.

## Command and flag summary

All commands accept `--` to end options and use stdin when no input is supplied
or the input is `-`. Operand counts and option combinations remain
command-specific; unsupported options fail rather than being silently ignored.
See the nested guides for exact parsing, output, and failure behavior:
[encoding and inspection](encoding/README.md),
[checksums](checksums/README.md), and [compression](compression/README.md).

| Command | Supported flags and scope |
| --- | --- |
| `base64` | `-d`/`--decode`, `-i`/`--ignore-garbage`, `-w N`/`--wrap=N`; default wrap 76, `-w0` disables wrapping; at most one input. |
| `base32` | Same options and operand limit as `base64`, using the uppercase base32 alphabet. |
| `xxd` | `-p`, `-r`, `-d`, `-u`, `-c N`, `-g N`, `-l N`, `-s N`, `-o N`; aliases `-ps`, `-plain`, `-postscript`, `-revert`, `-cols`, `-groupsize`, `-len`. One input; optional second operand must be `-`, never a named output file. |
| `od` | `-v`, `-A d\|o\|x\|n`, `-j N`, `-N N`, `-t TYPE`, `-w N`; aliases `-b`, `-c`, `-d`, `-o`, `-s`, `-x`; long forms `--output-duplicates`, `--address-radix`, `--skip-bytes`, `--read-bytes`, `--format`/`--type`, `--width`, `--endian`. Multiple inputs form one byte stream. |
| `sha256sum` | `-b`/`--binary`, `-t`/`--text`, `-c`/`--check`, `-z`/`--zero`, `--quiet`, `--status`, `-w`/`--warn`, `--strict`, `--ignore-missing`. Multiple inputs or manifests. |
| `sha1sum` | Same flags and verification rules as `sha256sum`; SHA-1 compatibility utility. |
| `md5sum` | Same flags and verification rules as `sha256sum`; MD5 compatibility utility. |
| `cksum` | POSIX CRC/byte count by default; `-a`/`--algorithm` crc, md5, sha1, sha224, sha256, sha384, sha512; explicit hashes use GNU tagged output. `-z`/`--zero` and `--` supported. Other algorithms and modern check/format/length selectors remain unsupported. |
| `gzip` | `-c`/`--stdout`/`--to-stdout`, `-d`/`--decompress`/`--uncompress`, `-k`/`--keep`, `-f`/`--force`, `-t`/`--test`, `-1` through `-9`, `--fast`, `--best`, `-n`/`--no-name`, `-h`/`--help`. Named operands default to file output. |
| `gunzip` | Same options as `gzip`, with decompression enabled by default. |
| `zcat` | Same options as `gzip`, with decompression and stdout enabled by default. |

## Byte streaming and cancellation

Input/output payloads are `Uint8Array`; binary paths do not use a text decoder.
Named inputs require `fs.readStream`, with no whole-file `readFile` fallback.
Stdin-only operation does not require a streaming filesystem. Paths resolve
against the command's virtual cwd; adapter containment and symlink guarantees
remain the adapter's responsibility.

Command processing uses bounded pieces and awaits writes for backpressure.
Supplied cancellation reaches command I/O and VFS operations; cancellation does
not undo completed side effects or forcibly interrupt synchronous or
uncooperative adapter work. Sinks remain caller-owned. An adapter, source, or
sink may itself buffer, and a provider-owned large chunk can remain retained.
The Shell can collect output and enforce its own output, pipeline, and execution
budgets; command streaming is not a claim that captured Shell output occupies
constant memory. Valid prefixes may already have reached stdout before a later
decode, verification, or decompression failure.

## Compatibility boundaries

### Encoding and inspection

- Base decoders ignore LF by default; other garbage needs `-i`. GNU coreutils
  9.7 EOF auto-padding accepts canonical unpadded final quanta. Padding placement
  and unused bits remain validated; invalid quanta can emit a prefix before
  failure, as pinned native evidence shows. There is no
  URL-safe alphabet or lowercase base32 extension. Encoding uses the declared
  wrap width, not locale or terminal settings.
- `xxd -r -p` accepts hex and ASCII whitespace, rejecting other characters and
  unmatched nibbles. Normal reverse requires contiguous hexadecimal addresses
  starting at zero, at most the configured columns, and lines at most 4096
  bytes. It is **not** native xxd's permissive, seekable/random-access patcher.
  It cannot write an explicit output-file operand; use shell redirection.
  Reverse rejects seek, length, displacement, and decimal-address options.
- Forward xxd columns are 1..256, or 0..4096 in plain mode; grouping is 0..256.
  Offsets are nonnegative safe integers. Negative/end-relative seek, include
  arrays, binary-bit dumps, autoskip, and endian-swapped modes are unsupported.
- `od` supports `c` and `d`/`o`/`u`/`x` with explicit 1/2/4/8-byte sizes, up to
  16 types, and widths 1..4096 divisible by every selected type size. Default
  output is `o2`, octal addresses, width 16, **little endian**, independent of
  host byte order. `--endian=big` is explicit; `-e` is unsupported. Floating
  point, named-character formats, native type-size letters, and legacy offset
  operands are not implemented. This is not full POSIX/GNU od compatibility.

### Checksums and manifests

- Digest binary/text flags change only the record marker, never the hashed
  bytes. Zero-terminated generation is not a supported verification format.
  Check-only flags without `--check`, and binary/text/zero with `--check`, are
  usage errors. GNU untagged records are supported; BSD tagged/reverse formats
  and abbreviated long options are not. MD5 and SHA-1 are compatibility choices,
  not security recommendations.
- Manifest paths are cwd-relative, not relative to the manifest's directory.
  Text must be valid UTF-8; raw non-UTF-8 POSIX filenames are outside the VFS
  string-path contract. Manifest line storage is capped at 65,536 bytes,
  excluding LF but including CR; filenames are capped at 16,384 UTF-8 bytes.
  Overlong lines fail the manifest even without `--strict`. Byte counts are
  capped at `2^64-1` per input; line counters at `Number.MAX_SAFE_INTEGER`.
- Malformed records need not fail an otherwise successful manifest without
  `--strict`. Every manifest needs a well-formed record and a matching readable
  input. `--ignore-missing` ignores only `ENOENT` data-file failures, not missing
  manifests, capability failures, or every read error. An all-missing manifest
  still fails. The nested checksum guide specifies escaping and reporting.
- `cksum` uses the POSIX length-mixed CRC, not ordinary CRC32/CRC32C. Its `-z`
  option is an extension. Diagnostics are not guaranteed byte-identical to
  localized GNU output. Option errors use repository status 2 rather than
  GNU digest utilities' status 1; processing failures use status 1.

### Compression files, capabilities, and limits

- gzip data uses `node:zlib`, not an archive extractor. Named inputs must be
  regular, non-symlink files. Compression defaults to level 6 and always omits
  original-name/time metadata; `-n` is accepted because no-name is already the
  policy. Compressed bytes need not match another zlib/gzip version. There is
  no original metadata restoration, recursion, listing mode, custom suffix,
  or support for every legacy format recognized by native gunzip. In particular,
  `zcat` here decodes gzip, not POSIX compress-format `.Z` data. ZIP, raw
  DEFLATE, and zlib wrappers are not supported decompression formats.
- File compression appends `.gz`. Decompression strips `.gz`, `.z`, `-gz`,
  `-z`, or `_z`, or replaces `.tgz`/`.taz` with `.tar`, case-insensitively;
  these suffix rules do not imply support for non-gzip compression formats.
  Unknown suffixes require stdout instead. Multi-link inputs require `-k` or
  `-f` before file replacement; stdout/test mode does not remove the source.
- File output requires `fs.writeStream` and must not declare
  `streamingWrite: false`; named reads likewise reject `streamingRead: false`.
  Existing destinations are rejected unless `-f`; forced replacement requires
  a distinct regular file and `capabilities.atomicRename === true`. `-f` does
  not bypass these capability or identity checks. Stdout/test paths do not
  require streaming writes.
- All operand destinations are preflighted for overlap before processing. A
  file result is streamed into a private sibling VFS directory, with a
  **256-MiB staged-output limit per operand**, for compression or decompression.
  This is a storage limit, not whole-output RAM collection. Publication uses
  exclusive VFS copy for a new destination or atomic rename for an existing
  forced destination. Exclusive copy is not a promise of atomic visibility or
  rollback if an adapter fails partway through publication.
- The input is removed only after successful publication and staging cleanup,
  unless `-k` retains it. Metadata/identity checks guard sources, destinations,
  and staging entries. Cleanup uses a separate five-second signal, checks
  ownership, refuses unexpected staging entries, and reports cleanup failure;
  suspicious or unremovable staging may remain rather than being blindly
  deleted. A published destination can remain after later cancellation,
  cleanup failure, or source-removal failure; the operation is not a transaction.
- These checks are best effort, not locking or compare-and-swap. Concurrent
  mutation between checks and VFS calls (including parent-symlink changes or
  insertion during final staging-directory cleanup), missing/weak identity metadata,
  same-metadata content changes, and dishonest capability declarations remain
  adapter limitations. Multiple operands are not an all-or-nothing batch.
- `-f` decompression passes non-gzip input through only on stdout/stdin paths,
  never in test mode or file replacement. Concatenated gzip members are handled
  by Node zlib. Stdout has no 256-MiB staging cap; apply Shell budgets when
  capturing or processing potentially expanding data.

## Author integration validation

Run from `/Users/kjopek/Workspace/safe-bash`:

```sh
node --unhandled-rejections=strict --import tsx --test tests/commands/bytes/plugin.test.ts
node_modules/.bin/tsc --noEmit --target ES2023 --lib ES2023 --module NodeNext --moduleResolution NodeNext --strict --noUncheckedIndexedAccess --exactOptionalPropertyTypes --verbatimModuleSyntax --forceConsistentCasingInFileNames --skipLibCheck --types node src/commands/bytes/index.ts tests/commands/bytes/plugin.test.ts
node --unhandled-rejections=strict --import tsx --test tests/commands/bytes/plugin.test.ts tests/commands/bytes/*/*.test.ts
node_modules/.bin/tsc --noEmit --target ES2023 --lib ES2023 --module NodeNext --moduleResolution NodeNext --strict --noUncheckedIndexedAccess --exactOptionalPropertyTypes --verbatimModuleSyntax --forceConsistentCasingInFileNames --skipLibCheck --types node src/commands/bytes/index.ts src/commands/bytes/*/*.ts tests/commands/bytes/*.ts tests/commands/bytes/*/*.ts
npm run build
```

The explicit top-level test operand ensures the plugin suite is not omitted by
a nested-only shell glob. Integration tests cover all eleven collision
positions, factory/registration behavior, binary cross-family pipelines,
manifests, errors, cancellation, backpressure, and Shell output limits. These
are author checks; independent verification is a separate handoff. Native
oracle skips must be reported, not counted as compatibility passes.

Observed author results on August 26, 2026, Node v22.22.2, Darwin 25.4.0 arm64:

- Standalone plugin suite: **36 passed, zero failed/skipped**. Its scoped strict
  typecheck and `npm run build` passed. The source integration example and built
  ESM factory/plugin binary-pipeline smoke check also passed.
- Complete byte suite, including that same plugin suite: **228 tests, 223
  passed, zero failed/cancelled, five skipped**. Strict checking of every byte
  source/test/helper and a fresh `npm run build` passed. This is not a
  whole-repository test run or whole-repository test typecheck.
- The five skips were GNU `base64`, GNU `base32`, and the three GNU digest
  manifest/option oracles (`sha256sum`, `sha1sum`, `md5sum`), because those GNU
  executables were unavailable. Installed digest oracles were Darwin 1.0;
  system `cksum` exposed no version flag. Compression used Apple gzip 479.
  xxd was Vim `2025-08-24`; od was system BSD with normalized-field comparison,
  not exact GNU formatting evidence. See nested guides for oracle coverage.
- The complete run started and ended at HEAD
  `a5fc2018ab005a6bc360b69b74ae0f70f06a426d`, after the encoding, checksum, and
  compression author commits, with the accompanying integration source/test
  included. All byte `.ts` source/test file hashes were identical before and
  after testing, typechecking, and building. The SHA-256 of their sorted
  `shasum -a 256` manifest was
  `2f673e377be5ca9fd08a6a332609a30258d1d539bb2ff89c8f1e405f4593782a`.

These counts include only the stated selected/native workloads. Skips, strict
decoder differences, unsupported formats/options, VFS race limitations, and
bounded staging remain limitations after a green author run. No independent
audit, complete GNU compatibility, benchmark win, or product superiority is
claimed.

## Independent verification checkpoint

The subsequent independent verifier owns `tests/commands/bytes-stress/`.
See its README for reproduction commands, native identities, comparison scope,
and explicit non-passes. It found and fixed two compression bugs: unsafe lexical
normalization through parent symlinks (`21b43cd`), and empty-only input starving
timer cancellation (`06e0d27`). The public plugin/factory API is unchanged.

On August 26, 2026, the pinned GNU follow-up contains **381 passed tests, zero
failures, skips, TODOs or cancellations** (154 independent, 227 author tests).
All five previously absent GNU checks ran against temporary coreutils 9.7.
GNU gzip 1.14 confirms the selected behavior for the four former Apple-dialect
TODOs; exact Apple observations are preserved separately. Always-runnable
vectors retain 240 GNU observations, and live checks explicitly skip if their
optional binaries are unavailable. See `tests/commands/bytes-stress/GNU-ORACLE.md`
for official archive/signature pins, binary identities and reproduction.

The follow-up also fixes chunked zero-padding premature closure, trailing
garbage warning/publication, forced suffix passthrough and forced-test behavior
using bounded gzip framing around Node raw-DEFLATE streams. A separate decoder
fix follows GNU 9.7 EOF auto-padding and partial output on malformed input, with
134 frozen cases at four chunk widths and pipeline regressions. Earlier
checkpoints retain their historical counts. VFS races, cooperative writer
cleanup and external-provider verification limits remain distinct from this
bounded GNU evidence.
