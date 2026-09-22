# fold compatibility and acceptance plan

Research-fold qualification, 2026-09-19. This pins the target for the subsequent
engine-fold, stream-fold and integration tasks in [safe-bash-fold.md](safe-bash-fold.md).
It does not implement or qualify those tasks. The package convention is available
in [the archived package-pattern document](archive/safe-bash-command-package-pattern.md);
its original path is deleted in unrelated working-tree changes and was not restored.

## Baseline and evidence authority

Compatibility baseline: **released GNU coreutils 9.10, 2026-02-04**, from
<https://ftp.gnu.org/gnu/coreutils/coreutils-9.10.tar.xz>, SHA256
`16535a9adf0b10037364e2d612aad3d9f4eca3a344949ced74d12faf4bd51d25`.
This research downloaded the archive explicitly, verified that digest and read
members in memory. It ran no native fold, BSD utility, compiler or locale oracle.
Absolute `/out` is read-only on this machine; no temporary evidence files were
written elsewhere. Durable specifications and acceptance steps live here.

Development comparison: commit
`b25722854370b8206d7f53f8934c36710cdd9974`, fetched explicitly from
`https://raw.githubusercontent.com/coreutils/coreutils/<commit>/<path>`.
Read both `src/fold.c` files, both `@node fold invocation` manual sections, and
the five release fold tests below; also fetched the five snapshot tests for
digest comparison. Source reading is specification evidence, not executed
native evidence. Upstream fixtures remain upstream controls, not original tests.

| Member | Release SHA256 | Snapshot SHA256 |
| --- | --- | --- |
| src/fold.c | `579245402394706b2e75909991bb6379d17c814611c7d24367c5c94df938d25d` | `0172cb5af864c0f75eacce93778c1b72510869a2d333c9c4b9a7d1458c77e3a9` |
| doc/coreutils.texi | `59eebfdd7631904269d3c90cdc9bd3a2f7675e2c2b3b9b26f8c855978620b01e` | `44a1a4f375a9b66c808f91154a581724303c584d1045e6292773fd1afce15f1d` |
| tests/fold/fold-characters.sh | `372417e670bbf24e82357ddb392d178cd8444dd962c1cf6d4ea9135de46b7c1c` | `0aa85a264a0330d0b95ace3cdc41b95c8eab55ae266b4966b361ce7d7ab2d048` |
| tests/fold/fold-nbsp.sh | `611bb243384ed34cba49d3f4ce960acf2fc990b2b4fb02aa03524424c0b5da9d` | same |
| tests/fold/fold-spaces.sh | `aa8f0683c4bea68b157728e1b6d8265d2bde82dc39d9dd4a28de46276f0b1c27` | same |
| tests/fold/fold-zero-width.sh | `0523b31484257aaa03be34fd0c8abe6ee4cfea31e1aae48052c1dbd078f2915d` | `38f1864d346fef40b2fbf3b17de542c1aec5439837d462adfb8c1405dad9fea4` |
| tests/fold/fold.pl | `7e2e2b7b6fcce043d2b358ce0c2a24b1785b58ccf50e7aa94832d9cc04a6f00f` | `f674d45cf1580a931e9e26b29114c9d91b17ac47839ccc4db5677d9bc7029fe3` |

The semantic source difference is the release break predicate
`c32isblank(g2.ch) && !c32isnbspace(g2.ch)` versus snapshot `c32issep(g2.ch)`.
Use the release predicate. Neither NBSP U+00A0 nor figure space U+2007 is a break
opportunity. The snapshot also omits a redundant initialization of static
booleans; the manual changes the spelling of the long width argument. These
do not justify changing the counting/control rules common to both sources.

The task supplies historical executed observations: 288 successful cases
(18 inputs × 8 flag combinations × 2 locales), 38 numeric controls across
fmt/fold, and 90 successful fold state observations (72 single-input and 18
ordered two-file cases). All successful observations report status 0 and empty
stderr. Treat these as **user-supplied native observations**, not executions by
this research. Their complete original byte transcripts, executable digest,
build configuration and libc/locale revisions are not present here. Do not
invent the remaining observations, claim 38 fold numeric cases, or generalize
the macOS locale results to every GNU build.

## Current-main inspection and concrete gaps

Inspected branch `main`, HEAD `35d01c57f8078d8afa916dc59929395d857e9c55`.
Working-tree publication changes are unrelated and preserved. Current ownership:

- `packages/safe-bash/src/commands/stream-inspection/fold.ts`: byte iteration,
  `bsw:` parser, byte-only column accounting, backspace minus one, ASCII blanks.
- `numeric-options.ts`: already normalizes legacy widths; do not report legacy
  width as missing from the current implementation.
- `shared.ts`: awaited output, stream/file/step limits and bounded RecordBuffer,
  but no Unicode decoding/width profile in fold itself.
- `tests/commands/stream-inspection/{contracts,integration,numeric-syntax}.test.ts`
  and `stream-inspection-stress/holdouts.test.ts`: memory-VFS contracts and GNU
  9.7 historical controls. Keep frozen controls unchanged and version 9.10 separately.
- No `packages/safe-bash-command-fold` or explicit `./commands/fold` export exists.

Concrete probes used the existing `fixture`/`runFixture` helpers through
`node --import tsx`, one-byte input chunks, memory VFS and capturing sinks.
They changed no source or tests. The following exact results validate gaps:

| Input hex | argv | Explicit environment | Current stdout hex | Current stderr (escaped) | Status |
| --- | --- | --- | --- | --- | --- |
| `e7958ce7958ce7958c0a` | `-c -w5` | LC_ALL=en_US.UTF-8 | empty | `fold: invalid option -- 'c'\n` | 1 |
| same | `-b -w5` | LC_ALL=en_US.UTF-8 | `e7958ce7950a8ce7958c0a` | empty | 0 |
| `000000` | `-w1` | LC_ALL=C | `000a000a00` | empty | 0 |
| `616263` | none | LC_ALL=no_such_profile | `616263` | empty | 0 |

UTF8 byte splitting, missing character mode, NUL column counting and accepting
an unavailable profile are thus concrete gaps. A `-w +5` probe on `abcdef`
already produces `61626364650a66`, status 0, empty stderr: no repair warranted.
No runtime repair is made by this documentation task. New implementation work
must reproduce each chosen gap with an original failing test first.

## Counting, controls and output contract

Default width 80, default mode columns. Parse ordered `-b/--bytes` and
`-c/--characters`; the last wins, including `-bc` (characters) and `-cb` (bytes).
`-s/--spaces` is independent of counting mode. Width values are processed in
order; each must be valid even if a later option replaces it. Support `-w5`,
`-w 5`, `--width=5`, `--width 5`, unique `--wid=5`, obsolete `-12`, and
`--` termination. Numeric legacy syntax belongs to fold's parser, not fmt's.
Released source accepts decimal 1 through `SIZE_MAX - 9`; word-size-dependent
native bounds are not JS safe-integer limits. Parse without precision loss;
an explicit resource/admission rejection for unrepresentable widths is distinct
from a native syntax rejection. No unbounded allocation follows from width.

| Event | Columns | Characters | Bytes |
| --- | --- | --- | --- |
| Ordinary admitted decoded character | pinned display width; negative width becomes 1 | 1 | encoded byte length |
| TAB | advance to next multiple of 8 | same | 1 |
| CR | column = 0 | same | 1 |
| BS | if column > 0 subtract last character width | subtract last counted width (1 once set) | 1 |
| LF | emit retained bytes and LF; reset column | same | same |
| NUL | width 0 | 1 | 1 |

TAB, CR and BS do not update last-character-width. Ordinary characters do,
including zero-width characters. Initialize that state once per invocation,
not per file, LF or inserted LF. Column and pending bytes reset per file.
Repeated files and LF may retain the prior glyph width for subsequent BS.
Byte mode bypasses control adjustment except LF; it does not update that state.

Apply the overflow character's adjustment **before** deciding the split; this
can update last-character-width. For `-s`, scan the retained decoded units for
the last release blank, emit through that separator including all its original
bytes plus LF, move the remainder, reset column, recompute the remainder with
the same stateful adjustment, then reprocess the overflow character. Ordinary
overflow emits retained bytes plus LF, resets column and reprocesses too.
Do not replace this with a stateless prospective width calculation. A glyph
wider than width on an empty retained line is consumed once to avoid looping.
Do not trim blanks, split grapheme clusters as units, replace bytes with U+FFFD,
or reconstruct source bytes by re-encoding display text.

Native BS subtraction uses unsigned size_t and only tests column > 0, not
column >= last width. The supplied controls demonstrated no underflow. Checked
JS handling is a separate admission gate: detect subtraction underflow or unsafe
addition and return a structured arithmetic/admission error; do not silently
clamp, wrap or claim native equivalence for that rejected case. Obtain an
independent native control before admitting native wraparound behavior.

Preserve terminal LF, repeated/empty lines and absent final LF. File boundaries
never synthesize LF. No operands means stdin; `-` consumes the same stdin cursor.
Continue to later operands after file open/read/close errors, retain already
emitted output, and combine failures into status 1. Output failure and cancellation
end processing; do not classify them as recoverable input-file errors.

## Explicit decoder and locale profiles

Declare a deterministic C profile: single-byte units, ASCII printable width 1,
NUL width 0, remaining nonprinting/invalid widths fall back to 1, ASCII SPACE
and TAB as blanks. UTF8 byte sequences can be split between these units.

Declare a separate UTF8 profile with strict scalar decoding, carried across
input chunks (at most three retained prefix bytes). Valid encoded codepoints
are indivisible even in byte mode. Overlong sequences, surrogate encodings,
out-of-range scalars, stray continuation bytes and incomplete EOF prefixes
fall back one original byte at a time. No BOM stripping or grapheme segmentation.
`lib/mcel.h` says encoding errors have length 1; `lib/mbbuf.h` preserves their
error flag but substitutes the input byte for the character on initial reading.
Space rescans use mcel_scan, whose encoding-error character is zero. This
read/rescan distinction needs dedicated invalid-byte/control fixtures; a
replacement-string decoder cannot establish it.

Pin a portable width candidate to **Unicode 17.0.0, release gnulib uniwidth**:

| Release member | SHA256 |
| --- | --- |
| lib/uniwidth/width.c | `127d542c509781fc1d0547c36c062f7b928cdc0b0542fd4ef9463b0407acd4f5` |
| lib/uniwidth/width0.h | `ae8e792de793f5b2b8c288ea3b657d769cbc5d6328521b6d34fba1b6e74d5802` |
| lib/uniwidth/width2.h | `a7b79e3632bc8c3f7d9579e4e77a5c0a212df31d0babfa77f13034e9136ea286` |
| lib/c32width.c | `517d5da74865290efa1992e43ee1379f5dd25dfc9c668acec8f5f9cb4e6b2caa` |
| lib/mcel.h | `131ee4054bade5e5d3f9aef4e8209c902a40c7ba4b363eacde38660df4667edb` |
| lib/mbbuf.h | `392513a05fcceaede2d45d6585dea2a503b3bb3b747c7415a32d6bf09d2e1180` |

The width headers explicitly identify Unicode 17.0.0. However c32width often
delegates to libc wcwidth, including macOS and glibc configurations; these tables
alone do **not** pin the supplied en_US.UTF-8 native locale. The portable profile
must have a distinct revision identifier and reviewed blank table implementing
the release predicate. Full en_US.UTF-8 admission remains held until libc,
locale data and width/blank tables are identified and independently compared.
Do not advertise that profile as generally supported from the small fixtures.
Reject unknown/unavailable explicit profiles before input acquisition; never
consult ambient host locale, Intl/ICU defaults or download locale assets.

## Exact fixture matrix

Notation below is a byte-preserving fixture language: ASCII literal bytes,
`\n` = 0A, `\t` = 09, `\b` = 08, `\r` = 0D, `\0` = 00; Unicode literals
encode UTF8 once when constructing the fixture. `repeat(x,n)` repeats exact
encoded bytes. Every success row expects **stderr empty, status 0**. Evidence
labels: S = source-derived; U = upstream test; N = user-supplied native observation.
UTF8 rows require the declared widths (界=2, U+0301=0, NBSP/figure space=1).

| Profile | argv | Input | Expected stdout | Authority |
| --- | --- | --- | --- | --- |
| C | none | repeat(a,81) | repeat(a,80) + `\na` | S |
| C | `-w3` | `abcdefg` | `abc\ndef\ng` | S; current numeric control |
| C | `-bw4` | `abcdef\nghijkl` | `abcd\nef\nghij\nkl` | U |
| C | `-sw4` | `a cd fgh\n` | `a \ncd \nfgh\n` | U |
| C | `-sw4` | `abc ef\n` | `abc \nef\n` | U |
| C | `-sw4` | `abcdef d\n` | `abcd\nef d\n` | U |
| C | `-sw2` | `a\t` | `a\n\t` | U |
| C | `-sw1` | `a b` | `a\n \nb` | S; separator-only line |
| C | `-w1` | `\0\0\0` | `\0\0\0` | S; U zero-width principle |
| C | `-cw1` | `\0\0\0` | `\0\n\0\n\0` | S |
| C | `-w5` | `界界界\n` | hex `e7958ce7950a8ce7958c0a` | S; N C splitting |
| UTF8 | `-w5` | `界界界\n` | `界界\n界\n` | N |
| UTF8 | `-bw5` | same | `界\n界\n界\n` | N |
| UTF8 | `-cw5` | same | `界界界\n` | N |
| UTF8 | `-bcw5` | same | `界界界\n` | N; last mode wins |
| UTF8 | `-cbw5` | same | `界\n界\n界\n` | N; last mode wins |
| UTF8 | `-w1` | `界a` | `界\na` | S; too-wide progress |
| UTF8 | `-cw5` | `a\tb\tc\n` | `a\n\t\nb\n\t\nc\n` | N |
| UTF8 | `-bw5` | same | `a\tb\tc\n` | N |
| UTF8 | `-w5` | `áb́ć\n` | input unchanged | N |
| UTF8 | `-cw5` | same | `áb́c\ń\n` | S; N nongrapheme principle |
| UTF8 | `-bw5` | same | `áb\ńć\n` | S; N nongrapheme principle |
| UTF8 | `-w7` | `界\t\bABCDE\n` | `界\n\t\bA\nBCDE\n` | N |
| UTF8 | `-cw7` | same | `界\n\t\b\nABCDE\n` | N |
| UTF8 | `-sw7` | same | `界\n\t\n\bABCDE\n` | N |
| UTF8 | `-sw10` | `abcdefghijklmnop qrstuvwxyz\n` (U+2007) | `abcdefghij\nklmnop qrs\ntuvwxyz\n` | U |
| UTF8 | `-sw10` | `abcdefghijklmnop  qrstuvwxyz\n` (two U+00A0) | `abcdefghij\nklmnop  qr\nstuvwxyz\n` | U |
| UTF8 | `-w7` or `-sw7` | repeat(U+0301,12000) + `abc\n` | input unchanged | N |
| UTF8 | `-bw7` | same | repeat(repeat(U+0301,3) + LF,3999) + repeat(U+0301,3) + `a\nbc\n` | S; N 4001 LFs |
| UTF8 | `-cw7` | same | repeat(repeat(U+0301,7) + LF,1714) + repeat(U+0301,2) + `abc\n` | S; N 1715 LFs |
| UTF8 | none | hex `c3` | hex `c3` | U |
| UTF8 | none | hex `c37cedbaad7c007cc2897ceda6bfedbfbf0a` | same exact hex | U invalid/NUL fixture |

Add original CR and backspace boundary controls before implementation:
`ab\rcdef`, width3 → `ab\rcde\nf`; `ab\bcde`, width3 → `ab\bcd\ne`
in C columns/characters (S). In bytes width3 these become `ab\r\ncde\nf`
and `ab\b\ncde\nf`. With width1, a file containing `a` followed by a file
containing `b` emits `ab`, not `a\nb` (S). These are proposed independent
controls, not newly executed native observations.

Numeric successes on `abcdef` with width5 forms (`+5`, `05`, leading-space
`5`, attached/long/abbreviated forms) expect `abcde\nf`, empty stderr, status0.
`-12` on `abcdefghijklmnop\n` expects `abcdefghijkl\nmnop\n` (S/N).
Width0, negative, fractional, suffixed and overflowing native values expect
empty stdout and status1. **Exact native stderr bytes remain a control gate**:
the supplied numeric summary has no diagnostics transcript, and diagnostics
depend on quoting/message locale and native integer bounds. Pin LC_MESSAGES=C,
argv0=fold, LANGUAGE=C and capture full stderr before claiming diagnostic parity;
do not fill it with the current implementation's simplified errors. Likewise
capture exact file-error stderr/status with an independent controlled VFS/error
mapping. Successful rows have fully pinned stdout/stderr/status now.

## Acceptance execution and implementation boundaries

Keep compatibility controls independent: freeze original inputs, ordered argv,
file order, explicit locale/message profiles and stdout/stderr/status without
importing the implementation, registry or shared width function. Record executable
digest, archive/source identity, architecture, build configuration, libc and
locale revision for any future native run. No BSD substitution. Never regenerate
expected outputs from the engine under test. Version old 9.7 fixtures separately.

Complete the supplied 90-state matrix as independent controls: nine originals
`界 TAB BS ABCDE LF`, `界 CR TAB BS ABCDE LF`, `界 LF TAB BS ABCDE LF`,
`a U+0301 TAB BS ABCDE LF`, `界 BS BS ABCDE LF`, `界 CR BS ABCDE LF`,
`TAB BS ABCDE LF`, `a NUL BS ABCDE LF`, and 12000 U+0301 then `abc LF`;
cross default/-b/-c/-s width7 with C/UTF8. Cross ordered files whose first
contains `界`, `界 LF` or `a U+0301` and whose second contains `TAB BS ABCDE LF`
with default/-c/-b and both profiles. Preserve all bytes and capture full
outputs; the summary alone does not provide every expected transcript.

Implementation tests then consume independently frozen expectations in memory
VFS with mocked capabilities. Run every multibyte/invalid/control fixture at
every short-input chunk split, with reused/mutated producer buffers and delayed
awaited sinks. Compare exact bytes, not decoded strings. For long zero-width
fixtures assert complete expected bytes and LF count; C codepoint substring
counts are not retention evidence. Removing LFs is only valid when original LF
locations are unambiguous. Add original invalid-byte `-s` rescans, blank-table
boundaries, width−1/width/width+1, first-wide-glyph and state-survival tests.

Bound retained bytes, decoder prefixes, allocation/copy volume, output, files
and algorithm steps; admit allocations before copying. Finite-buffer flushes
write without LF and retain column/last-width state. Flush boundaries may affect
the retained search window for `-s`; pin the native IO_BUFSIZE/build behavior
before qualifying long buffered blank/control cases. Never insert LF solely to
meet a byte budget. Explicit limit failures are permitted, not altered wrapping.
Count every remainder scan/reprocess against work limits. Await writes, cancel
between bounded units, register invocation cleanup before acquisition, close
iterators and admission idempotently from registered cleanup and finally, and
test falsey cancellation reasons, downstream failure and overlapping cleanup.
Preserve shared shell budgets, canonical contracts/realm identity and replay
invariants; host calls remain injected and VFS-only.

Implementation owner must be `packages/safe-bash-command-fold`, manifest name
`safe-bash-command-fold`, `private: true`, TypeScript ESM and zero external
runtime dependencies. Import canonical leaf contracts, never safe-bash itself.
Safe-bash only composes/exports at `@poe-platform/safe-bash/commands/fold`, with
CLI and SDK using the same parser/engine, explicit profiles and limits. No
host executables, implicit network/files/locales, native/WASM fallback or
dynamic downloads. Do not publish the command workspace.

Acceptance requires maintained package/build graph checks and installed tarball
runtime and declaration consumers: both must resolve without unpublished
workspace packages, preserve canonical constructor/brand identity and find
bundled implementation/assets/types. A manifest/export edit alone is no proof.
TDD is required for later code. This research changes documentation only;
release, installation, full locale admission, arithmetic edge admission and
unprovided native diagnostic/state transcripts remain explicit later gates.
