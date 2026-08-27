# Streaming checksums

`index.ts` exports `createChecksumCommands(): readonly CommandDefinition[]`,
containing `sha256sum`, `sha1sum`, `md5sum`, and `cksum`. Registration and the
shared byte-command plugin belong to the root integrator, not this subtree.
There are no new dependencies. Production code uses `node:crypto` for the three
digests; it does not open host paths, launch processes, evaluate code, or write
VFS files. MD5 and SHA-1 are compatibility utilities, not security recommendations.

## Flags and defaults

All four commands accept file operands, `--` to terminate options, and `-` for
stdin. Without operands, stdin is used. Options can follow operands. Each
invocation consumes stdin once; later `-` operands see EOF. Use `./-` for a
literal file named `-`. Paths are resolved against `context.cwd` using only
`context.fs`, including paths read from manifests. They are not relative to the
manifest's directory. VFS containment and symlink policy belong to the adapter.

The digest commands support exactly:

| Flag | Behavior |
| --- | --- |
| `-b`, `--binary` | Print `*` mode marker. |
| `-t`, `--text` | Print space mode marker (default). |
| `-c`, `--check` | Treat operands as checksum manifests. |
| `-z`, `--zero` | NUL-terminate generated records; do not escape filenames. |
| `--quiet` | In check mode, suppress successful `OK` records. |
| `--status` | In check mode, suppress status records and summary warnings. |
| `-w`, `--warn` | In check mode, diagnose each malformed line with its number. |
| `--strict` | In check mode, malformed lines also cause failure. |
| `--ignore-missing` | In check mode, skip only data-file `ENOENT` before any bytes are read. |

Short options can be combined. The last binary/text option wins. The last
quiet/status/warn option wins, matching GNU's mutually replacing reporting
modes; strict and ignore-missing remain independent. Binary and text modes
always hash the same original bytes, without newline conversion. Check-only
options without `--check`, and binary/text/zero options with `--check`, are
usage errors. Unknown options, option arguments such as `--check=yes`, abbreviated
long options, `--tag`, `--help`, and `--version` are rejected, not ignored.

`cksum` defaults to POSIX CRC and accepts `-a`/`--algorithm` with crc, md5,
sha1, sha224, sha256, sha384 or sha512. Explicit hash algorithms use GNU tagged
output, including filename escaping; `-z`/`--zero` preserves literal names with
NUL termination. All algorithms use the same bounded streaming/cancellation
path, never buffering a complete input. Other algorithms, checksum verification,
tag-selection, binary/text selectors and output-length options remain rejected.
This is not the complete modern GNU interface. Existing SHA/MD5 command
verification behavior and default CRC bytes/length output are unchanged.

`tests/commands/bytes/checksums/algorithms-native.json` freezes28 exact GNU9.7
observations with executable identity, covering seven algorithms, stdin/files,
binary octets, escaping and NUL output. Each runs at three chunk sizes, plus
pre-read rejection and blocked-input cancellation. The old rejection assertion
for `--algorithm=crc` becomes rejection of an unknown algorithm; explicit CRC
acceptance is independently covered, not removed from testing.

## Formats and verification

Digest output is lowercase hex, space, mode marker, filename, newline. A filename
containing backslash, LF, or CR causes a backslash prefix before the digest and
escapes those characters as `\\`, `\n`, and `\r`. Verification status records
use the same filename escaping and prefix. Zero mode emits literal filenames
with NUL delimiters and is generation-only.

Verification accepts the generated GNU untagged format, uppercase or lowercase
hex, both markers, optional leading ASCII space/tab, and space/tab before the
marker. It accepts LF/CRLF, an unterminated final line, blank lines, and comments
whose first character is `#`. It does not trim filenames. The initial backslash
indicator enables only the three escapes described above; unknown or unfinished
escapes are malformed. Backslashes without that indicator remain literal.
An entry naming `-` inside a stdin manifest is malformed; a VFS manifest can
name `-` to checksum stdin. This avoids simultaneous consumers of stdin.

Manifest text must be valid UTF-8. Decoding is fatal, not replacement-based; a
BOM is retained as a literal character, not stripped. Filename arguments must
be nonempty Unicode scalar strings with no NUL. Invalid UTF-8, NUL filenames,
bad digest widths/hex/markers, unsupported formats, invalid escapes, and overlong
decoded filenames make a manifest entry malformed. A malformed line is skipped
and counted, with a summary warning if there is another valid record. By default
it need not make an otherwise successful manifest fail; use `--strict` to require
every non-comment/nonblank line to be valid. Tagged BSD and BSD reverse formats
are deliberately unsupported, even though GNU accepts them. Raw non-UTF-8 POSIX
filename bytes cannot be represented by the injected string-path VFS contract.

Each manifest must contain at least one well-formed record and at least one
matching readable file. All well-formed records are checked, even after failures.
Mismatch produces `filename: FAILED`; file read failure produces
`filename: FAILED open or read` and an individual stderr diagnostic. Successful
records produce `filename: OK`, except in quiet/status mode. Missing files are
skipped only with ignore-missing and before any nonempty data block is read;
an all-missing manifest still fails. A subsequent `ENOENT` after data arrives
is a read failure, not a missing-file skip. Empty chunks do not count as data.
Stdin errors and missing manifest operands are never ignored. The streaming
contract has no separate open-success notification, so a pre-data file `ENOENT`
is the available missing/open signal. Read failures, no-valid-record failures,
and capability errors still diagnose under `--status`, as GNU does. Summary
wording is intentionally not byte-identical to localized GNU diagnostics.

Exit status is `0` for success, `1` for processing/verification failure, and `2`
for invalid command options/combinations (the repository convention; GNU uses
`1` for usage errors). Failures aggregate across operands/manifests; later inputs
are attempted. Abort rejects with the supplied signal's reason rather than
returning a checksum exit status. An unusable stderr sink can also reject.

`cksum` outputs unsigned decimal CRC, byte length, and operand name. With no
operands, it omits the filename and preceding space. Names are literal even when
they contain newlines, per the POSIX legacy format. The algorithm starts with
zero, updates the non-reflected polynomial `0x04c11db7`, mixes the minimal
little-endian byte representation of the input length, then complements the
32-bit remainder. Empty input is `4294967295 0`. This is **not** ordinary CRC32,
CRC32C, or a cryptographic hash.

## Streaming, limits, and cancellation

- File and manifest reads require `fs.readStream`; otherwise they fail with
  `ENOTSUP`. There is no `readFile` fallback, stat preflight, or whole-file buffer.
  Stdin works even without a streaming-capable filesystem. An adapter may still
  buffer internally; these commands cannot promise its storage implementation.
- CPU updates and scans operate on at most 64-KiB views of an incoming chunk.
  Event-loop yielding occurs after 64 KiB of work or 256 source pulls, including
  empty chunks; abort is checked between updates. The provider-owned current
  chunk can remain retained while processing it, but is never copied wholesale.
- Manifest line storage is one 65,536-byte buffer, excluding LF but including CR.
  Exceeding that size fails the current manifest with `EFBIG`, even for comments
  and without strict mode. Later manifest operands are still attempted. There is
  no whole-manifest collection or set of prior filenames/digests.
- Each operand/decoded filename is limited to 16,384 UTF-8 bytes. This also keeps
  escaped output bounded and readable by the manifest parser. A direct filename
  violation is an error; a manifest filename violation is malformed input.
- Byte counts use BigInt, capped at `2^64-1` bytes per input; line counters are
  capped at `Number.MAX_SAFE_INTEGER`. Hash/CRC state and counters stay bounded.
- `readBytes` and the `output`/`diagnostic` helpers use cancellation-aware I/O;
  late source/sink rejection is observed. Every write is awaited before further
  input processing. Sinks are never ended or closed. Cancellation cannot undo
  an adapter side effect, interrupt a synchronous adapter operation, or forcibly
  terminate an uncooperative source. Read-induced metadata changes are adapter
  policy, not writes performed by these commands.

## Author verification

Run from the repository root:

```sh
node --unhandled-rejections=strict --import tsx --test tests/commands/bytes/checksums/*.test.ts
node_modules/.bin/tsc --noEmit --target ES2023 --lib ES2023 --module NodeNext --moduleResolution NodeNext --strict --noUncheckedIndexedAccess --exactOptionalPropertyTypes --verbatimModuleSyntax --forceConsistentCasingInFileNames --skipLibCheck --types node src/commands/bytes/checksums/index.ts tests/commands/bytes/checksums/helpers.ts tests/commands/bytes/checksums/checksums.test.ts tests/commands/bytes/checksums/streaming.test.ts tests/commands/bytes/checksums/native.test.ts
for iteration in {1..20}; do
  node --unhandled-rejections=strict --import tsx --test --test-name-pattern='CPU work|blocked|backpressure|empty-chunk|pre-aborted|giant comment|ignore-missing|read errors|stdout failures' tests/commands/bytes/checksums/streaming.test.ts || exit 1
done
```

Resumed author run on 2026-08-26, exclusively from
`/Users/kjopek/Workspace/safe-bash`: Node v22.22.2, Darwin 25.4.0.
The existing post-data `ENOENT` regression first reproduced with exit 0 instead
of the expected exit 1. After the read-progress fix, the entire owned suite
reports **46 tests: 43 passed, 0 failed, 3 skipped**. The strict scoped TypeScript
command above passes with the repository's compiler flags, including imported
dependencies; this is not a whole-repository typecheck. The selected lifecycle
cases pass **20 repetitions of 15 tests: 300 passes, no failures or skips**.
The missing-stream test uses a structurally typed override and
`Object.defineProperty`, without an unsafe cast.

Tests cover static
empty/abc/CRC vectors; binary corruption; digest mismatch; escaping and malformed
encodings; option order/errors; stdin/multiple operands; cwd-relative manifests;
MemoryFileSystem permissions/read failures; no VFS write calls; manual Shell
registration, pipelines and redirection; 3-MiB chunks; cancellation during CPU,
source/sink/VFS blocking and empty floods; late rejections; backpressure; line
limits; incremental verification of 4,000 records; post-data `ENOENT` failure
with continued verification of later entries; pre-data missing-file suppression;
and stdin error fidelity under ignore-missing.

`native.test.ts` alone launches native reference utilities, using `execFile`
without shell interpolation. Its optional GNU tests create and remove their own
temporary reference directory inside `tests/commands/bytes/checksums/`; no host
filesystem or process use exists in the
production subtree. Oracles prefer GNU utilities when installed, print exact
version/platform or explicit skips, and compare 40 binary-length cases across
all four commands (0 through 1,048,577 bytes, including 255/256 and 65535/65536).
All 40 binary-length comparisons passed in this resumed run.
This host provides Darwin 1.0 `sha256sum`, `sha1sum`, and `md5sum`; its `cksum`
does not expose a version flag, so the report identifies Darwin 25.4.0 instead.
GNU-specific native option/manifest checks are skipped because GNU coreutils is
not installed. Their behavior is covered by local tests and checked against
GNU documentation/source, but is not claimed as an executed GNU comparison.

Pending/gaps: independent verifier handoff, root plugin exposure, GNU native
option/manifest comparisons on a GNU-equipped host, and practical tests beyond
4 GiB. No full GNU format/flag parity, whole-product validation, or superiority
benchmark claim is made.

## Primary references

Reviewed on 2026-08-26. GNU pages/source were inspected with `web.run`; that tool
returned no content for the POSIX page, so the same authoritative Issue 8 page
was fetched directly with `curl` to verify the polynomial, length mixing,
output format, and exit policy. No third-party algorithm implementation is used.

- POSIX.1-2024 / Issue 8 `cksum`:
  https://pubs.opengroup.org/onlinepubs/9799919799/utilities/cksum.html
- GNU checksum output formats:
  https://www.gnu.org/software/coreutils/manual/html_node/cksum-output-modes.html
- GNU verification and mode options:
  https://www.gnu.org/software/coreutils/manual/html_node/cksum-common-options.html
- GNU legacy CRC verification exclusion:
  https://www.gnu.org/software/coreutils/manual/html_node/cksum-general-options.html
- GNU MD5 compatibility/security context:
  https://www.gnu.org/software/coreutils/manual/html_node/md5sum-invocation.html
- Pinned GNU coreutils v9.7 verification/escaping/exit-policy source:
  https://github.com/coreutils/coreutils/blob/v9.7/src/digest.c
- Pinned GNU coreutils v9.7 POSIX CRC length-mixing/output source:
  https://github.com/coreutils/coreutils/blob/v9.7/src/cksum.c
