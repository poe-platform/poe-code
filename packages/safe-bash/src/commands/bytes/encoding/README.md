# Encoding and byte inspection commands

`index.ts` exports `createEncodingCommands(): readonly CommandDefinition[]`.
It returns `base64`, `base32`, `xxd`, and `od` definitions for registration by
the caller. This is the source-level factory, not a claim of an independently
published package subpath. Top-level plugin/export integration is separate.
These implementations use project contracts and Node builtins, with no new
runtime dependencies, host filesystem access, subprocesses, or evaluation.

## Common behavior

- Input and output are bytes. Omitted input or the operand `-` means stdin.
  `od` concatenates multiple inputs; subsequent `-` operands do not replay stdin.
- Named inputs use only `context.fs.readStream(path, { signal, chunkSize: 8192 })`.
  A filesystem without this capability fails with `ENOTSUP` when the input is
  opened. There is no `readFile` or host-file fallback. Zero count with zero skip
  returns without opening or reading input; positive skip still consumes input.
- Short flags can be clustered, and required values can be attached or separate.
  Supported long options accept `--name=value` or `--name value`. Options can
  follow operands until `--`, which protects all subsequent literal filenames.
  No abbreviation or unspecified option is supported, including help/version.
- Every supplied option value is validated before command input is read. Valid
  repeated scalar options use the last value; an invalid earlier occurrence
  cannot be hidden. `od` output types instead accumulate in argument order.
- Success returns exit code **0**. Usage errors return **2**; malformed data,
  filesystem errors, input failures, output failures, skip past EOF, and address
  overflow return **1**, with a command-prefixed diagnostic on stderr. If the
  diagnostic sink itself fails, execution rejects instead of returning a code.
- Cancellation rejects with the supplied signal reason; it is not converted
  into a command exit code. Reads and writes use cancellable `readBytes` and
  `writeBytes`. Host operations may continue after cancellation; no rollback or
  forced interruption of an uncooperative adapter is promised.
- Output is incremental and nontransactional. Bytes already written remain
  visible if later input is malformed or I/O fails. No command writes a named
  output file. Shell redirection is a separate operation and is also
  nontransactional: it may truncate a target before command validation, including
  a target aliasing the input through a hard link or symlink. Do not use these
  commands with same-file redirection as an in-place editing mechanism.

## `base64` and `base32`

Syntax: `base64 [options] [file]` or `base32 [options] [file]`.

| Option | Behavior |
| --- | --- |
| `-d`, `--decode` | Decode rather than encode. |
| `-i`, `--ignore-garbage` | During decoding, discard bytes outside the alphabet other than `=`; no effect on encoding. |
| `-w N`, `--wrap=N` | Wrap encoded output at N characters; default 76. Zero disables wrapping and the terminal newline. Validated even during decoding. |

Wrap accepts decimal digits with an optional leading `+`, including leading
zeroes, in the range 0 through 9007199254740991. Nonempty wrapped output ends in
LF; empty input produces no output. The encodings use standard Base64 and
uppercase Base32 alphabets, with padding on partial final blocks.

Decoding always accepts LF. CR, spaces, tabs, and other nonalphabet bytes fail
unless `-i` is present. Base32 lowercase is not case-folded; with `-i` those
letters are discarded rather than decoded. URL-safe Base64 and extended-hex
Base32 alphabets are unsupported.

Decoding follows independently captured GNU coreutils 9.7 behavior. Complete
quanta use four Base64 or eight Base32 symbols. At EOF, a partial quantum whose
last retained input byte is not `=` receives implicit padding; canonical `Zg`
and `MY` therefore decode to `f`. Padding placement/count and unused bits must
still be valid. A partially supplied padding suffix ending in `=` fails.
LF is ignored for decoding but remains the last input byte unless `-i` removes
it; consequently GNU also accepts `Zg=\n` without `-i`, but rejects it with `-i`.

Bytes preceding an invalid symbol or nonzero unused bits may already have been
emitted, even within the failing quantum. `Zh==`/`MZ======` emit `f` and fail;
unpadded `Zg`/`MY` succeed. Base32 incomplete padded blocks can emit no bytes
where Base64 emits a prefix. Independently padded blocks concatenate. Consumers
must check completion/status, not treat partial output as validated data.
`tests/commands/bytes-stress/gnu-decoder-evidence.json` pins 134 native cases;
the independent suite checks every result at four virtual chunk widths. This
does not claim compatibility with every older coreutils release or other dialect.

## `xxd`

Syntax: `xxd [options] [input [output]]`. Output is stdout only. The optional
second operand must be `-`; any other output operand is rejected before reading
or writing files, even when it aliases the input.

| Option | Behavior/default |
| --- | --- |
| `-p` | Plain hexadecimal, default 30 bytes per line. |
| `-r` | Strict reversal to bytes, normal or with `-p`. |
| `-u` | Uppercase hex data in forward output; addresses remain lowercase. |
| `-d` | Decimal rather than hexadecimal forward addresses. |
| `-c N` | Normal columns 1..256, default 16; plain columns 0..4096. Plain zero emits one continuous line and a final LF for nonempty input. |
| `-g N` | Normal grouping 0..256 bytes, default 2; zero disables grouping. Ignored in plain/reverse modes but still validated. |
| `-l N` | Maximum input bytes after skip; default unlimited. |
| `-s N` | Nonnegative bytes to discard from the stream; default zero. |
| `-o N` | Nonnegative displacement added to displayed addresses; default zero. |

Exact standalone single-dash aliases are `-ps`, `-plain`, `-postscript` for `-p`,
`-revert` for `-r`, `-cols` for `-c`, `-groupsize` for `-g`, and `-len` for `-l`.
Other Vim lazy-parser spellings and double-dash long options are unsupported.

Numeric values accept decimal, leading-zero octal, and `0x`/`0X` hexadecimal;
they must be nonnegative safe integers. Signs, suffixes, and invalid octal such
as `08` are rejected. Skip is sequential consumption, not random access. A skip
past EOF fails, and skip plus displacement/address increments must remain safe
integers. Normal output uses addresses padded to at least eight digits and
ASCII bytes 32..126; other bytes display as `.`. Plain output has no addresses.

### Strict reversal

- `-rp` accepts only paired hex digits and ASCII whitespace (space or bytes
  9..13), with pairs allowed across whitespace/chunk boundaries. A nonhex byte
  or unmatched final digit fails. There is no line-length limit in plain mode.
- Normal `-r` accepts lines with a 1..14-digit hexadecimal address, a colon,
  optional single space/tab, then a nonempty hex data field. The field consists
  of even-length hex groups separated by single spaces. Two or more spaces or
  a tab end the data field; the following display/comment field is ignored and
  is not validated against the bytes. A terminal CR and blank lines are accepted.
- Addresses must be contiguous, starting at zero. Each data field may contain
  at most `-c` bytes. Lines may be short, and a final LF is optional. Each normal
  input line is limited to 4096 bytes, excluding LF but including any CR/trailer.
- `-s`, `-l`, `-o`, and `-d` are rejected in reverse mode even with zero values.
  `-u` has no effect on reversal; either hex case is accepted.
- No garbage recovery, autoskip markers, sparse output, overlapping addresses,
  out-of-order patching, or named-output mutation is supported. This intentionally
  differs from Vim's permissive reverse parser. Normal reverse validates a line
  before writing it; plain reverse can emit valid pairs before a later error.

Other unsupported features include bits, little-endian dump mode, C includes,
EBCDIC, color, autoskip, signed/relative seeks, and output-file patching.

## `od`

Syntax: `od [options] [file ...]`. Defaults are octal addresses, `o2` data,
16-byte rows, stable little-endian interpretation, no skip, and unlimited count.

| Option | Behavior |
| --- | --- |
| `-A R`, `--address-radix=R` | `d`, `o`, `x` addresses, or `n` to omit them and the final address. |
| `-j N`, `--skip-bytes=N` | Discard N bytes across concatenated inputs. |
| `-N N`, `--read-bytes=N` | Read at most N bytes after skipping. |
| `-t T`, `--format=T`, `--type=T` | Append output types, with at most 16 total. |
| `-w N`, `--width=N` | Required value 1..4096, divisible by every selected type size. |
| `--endian=little`, `--endian=big` | Explicit byte order, independent of the host. |
| `-v`, `--output-duplicates` | Show every row rather than suppressing repeated rows. |

Types are `c` (single-byte characters) or `d`, `o`, `u`, `x` followed by an
explicit size `1`, `2`, `4`, or `8`: signed decimal, octal, unsigned decimal, or
hexadecimal integers. Adjacent types such as `x1u1` and repeated `-t` accumulate.
Integer conversion uses BigInt, including full 64-bit values. Short final
integers are zero-padded at the missing byte positions in the selected byte
order. Aliases append types in order: `-b=o1`, `-c=c`, `-d=u2`, `-o=o2`,
`-s=d2`, `-x=x2`. These aliases can be clustered.

Characters use ASCII printable bytes, the escapes `\0`, `\a`, `\b`, `\t`,
`\n`, `\v`, `\f`, `\r`, or three-digit octal. There is no locale/multibyte
interpretation. Address formatting targets GNU `od`: at least six digits for
hexadecimal and seven for octal or decimal, growing without truncation for larger
offsets. Addresses begin at the skip count; formatting is independent of the host.
A final address is printed unless `-An`, including for empty input.
Consecutive identical raw rows collapse to one `*` line unless `-v` is set.

Width, skip, and count accept the same unsigned numeric bases as `xxd`. Skip
and count additionally accept suffixes: `b` = 512; `k`, `K`, `KiB` = 1024;
`m`, `M`, `MiB` = 1048576; `G`, `GiB` = 1073741824; `KB`, `MB`, `GB` use powers
of 1000. A suffix alone means one unit. A complete hexadecimal literal takes
precedence over suffix parsing. The multiplied value must be a safe integer.

Unsupported features include floating-point/named-character types, implicit or
symbolic integer sizes, strings mode, traditional trailing offset operands,
optional/default `-w` arguments, and other GNU/BSD extensions. `-e` is rejected;
use the explicit long endian option. Numeric and `+offset` operands are literal
filenames, not legacy offsets. This is not full GNU or POSIX `od` conformance.

## Streaming and resource limits

Input chunks, including a huge single chunk, are processed in views of at most
8192 bytes. Each nonempty block yields to the event loop before CPU processing;
empty-only input yields every 64 empty chunks. Commands await each output write
before continuing and retain bounded codec state, rows, or reverse lines rather
than accumulating the complete stream. Width and line limits are described
above. Author tests check output writes no larger than 32768 bytes for their
large-input configurations, plus exact decoded byte output.

These are command-owned working-buffer limits, not a whole-process memory cap:
a source's huge backing allocation remains referenced while its chunk is being
processed, and filesystem adapters or output sinks may allocate or collect
unbounded data themselves. There is no command-level total input/output cap or
time budget. Cancellation cannot undo bytes already written. Small row widths
cause many awaited writes; no throughput or speed-superiority claim is made.

## Author validation and oracle scope

Run all owned tests from the repository root:

```sh
node --unhandled-rejections=strict --import tsx --test tests/commands/bytes/encoding/*.test.ts
```

Author run on August 26, 2026: **62 tests, 60 passed, 0 failed, 2 skipped**.
The initial resumed run reproduced four failures (54 passed, 4 failed, 2 skipped);
fixing per-occurrence option validation and adding two focused regression tests
produced the final result without weakening existing assertions.

The lifecycle selection below was run ten times: **15 passed per repetition,
150 total, no failures or skips**.

```sh
for iteration in {1..10}; do
  node --unhandled-rejections=strict --import tsx --test \
    --test-name-pattern='blocked source|blocked sink|timer cancels|producer cannot|ignore-only|limit closes' \
    tests/commands/bytes/encoding/streaming.test.ts || break
done
```

Scoped TypeScript checking passed with the repository's strict flags and the
owned source/test entrypoints (including their imported dependencies):

```sh
node_modules/.bin/tsc --noEmit --target ES2023 --lib ES2023 \
  --module NodeNext --moduleResolution NodeNext --strict \
  --noUncheckedIndexedAccess --exactOptionalPropertyTypes \
  --verbatimModuleSyntax --forceConsistentCasingInFileNames \
  --skipLibCheck --types node \
  src/commands/bytes/encoding/*.ts tests/commands/bytes/encoding/*.ts
```

These results do not substitute for a fresh whole-repository test/build run.

Tests cover static encoding vectors, all byte values and chunk splits, strict
malformed-data rejection, repeated-option validation, formatting/reversal,
VFS-only streaming, bounded writes, cancellation, late rejection, backpressure,
source cleanup, and manually registered shell pipelines. Native execution exists
only in the isolated `oracle.test.ts`; the product never invokes native tools.
No dependency installation is needed beyond existing repository development tools.

Observed native identities on August 26, 2026, Darwin 25.4.0 arm64:

- GNU `base64` and `base32`: **not installed; two oracle tests skip**. Static
  vectors and local roundtrips still run, but do not establish GNU equivalence.
- Vim `xxd 2025-08-24 by Juergen Weigert et al.`: the selected forward and
  reverse matrix compares exact bytes. It does not cover unsupported features
  or establish equivalence for malformed reverse input.
- `/usr/bin/od`: system BSD utility without a version flag, binary SHA-256
  `7a75ea290e89a30322d8a0a35b94db733aadffcfbd2d23f7a4ce5966ce8950b9`.
  The selected single-format matrix normalizes whitespace and adjoining signed
  fields before comparison; it is not exact-format evidence or GNU proof.

On other hosts, oracle tests detect GNU codecs before running, prefer `god`
when its version probe succeeds, and otherwise try `/usr/bin/od`. They skip
missing executables and report the identity used. A successful GNU `od` version
probe enables exact-byte comparison instead of BSD normalization. Installed
comparator versions are not pinned by this utility group.

The current BSD comparison retains whitespace/signed-field normalization and,
for `-Ax` only, additionally removes one leading zero from seven-digit hexadecimal
address tokens. GNU comparisons remain byte-exact. This accommodates BSD's
seven-digit minimum without changing product output or the historical evidence.

These are author checks, not the separately assigned independent verification,
full-shell acceptance, a just-bash comparison, or proof of product superiority.
High-risk handoff areas are malformed decoder compatibility, strict reverse
grammar, cancellation with uncooperative adapters, and shell redirection aliasing.

## Primary references

These sources describe comparison targets and encoding formats, not a promise
that every feature in them is implemented. Online manuals are not the identity
of a native executable tested above.

- GNU Base64: https://www.gnu.org/software/coreutils/manual/html_node/base64-invocation.html
- GNU Base32: https://www.gnu.org/software/coreutils/manual/html_node/base32-invocation.html
- GNU od: https://www.gnu.org/software/coreutils/manual/html_node/od-invocation.html
- POSIX od: https://pubs.opengroup.org/onlinepubs/9799919799/utilities/od.html
- Official Vim xxd manual source: https://github.com/vim/vim/blob/master/runtime/doc/xxd.1
- RFC 4648 alphabets, padding and vectors: https://www.rfc-editor.org/rfc/rfc4648.html
