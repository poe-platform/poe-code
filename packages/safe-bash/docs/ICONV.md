# iconv

`iconv` provides bounded raw conversion and the explicitly admitted
C/POSIX/unset-locale `//TRANSLIT` profile. Its command module, public export maps,
and default agent-command registration are integrated in this repository.
Repository integration does not establish completed validation gates or npm
publication; neither is claimed here.

## Interface

`createIconvCommand(options)` constructs `iconv`.
`createIconvCommands(options)` returns the command family.
`iconvCommands(options)` registers it as a plugin; `replace` defaults to false.
The implementation module is `src/commands/iconv/index.ts`. The factories and
`IconvCommandsOptions` / `IconvLimits` types are exported through both public
command subpaths:

- `poe-code/safe-bash/commands/iconv`
- `@poe-platform/safe-bash/commands/iconv`

They are also re-exported from `poe-code/safe-bash` and
`@poe-platform/safe-bash`. The export maps include type, Node import, browser,
and workerd routes; this describes repository wiring, not installed-package
availability or a real-browser qualification.

`createAgentCommands()` includes `iconv` by default, and `agentCommands()`
registers it with the other default commands. Configure its nine limits through
`agentCommands({ iconv: { limits: { maxInputBytes: 1_048_576 } } })` or the same
option on `createAgentCommands`. The aggregate's top-level `replace` option
controls replacement; nested `iconv` options expose only `limits`. For a shell
without the aggregate preset, `iconvCommands({ limits: { maxInputBytes: 1_048_576 } })` provides
explicit registration. Adding it to an already registered preset requires an
intentional replacement policy rather than duplicate registration.

Syntax: `iconv -f ENC -t ENC[//TRANSLIT] [-c] [FILE ...]`.
Attached short option arguments, grouped short options, and `--` are supported.
No operands reads stdin; `-` explicitly selects stdin. A repeated stdin operand
reports a read error, matching the pinned native CLI's closed-descriptor behavior.
Paths resolve through the supplied VFS only. Input files are not modified.

Explicit codecs are ASCII, ISO-8859-1/Latin-1, UTF-8, UTF-16, UTF-16LE, and
UTF-16BE. Encoding names are ASCII-case-insensitive. The accepted spelling
aliases are declared in `src/commands/iconv/options.ts`. ASCII rejects high
bytes; Latin-1 maps all bytes directly to U+0000–U+00FF. Neither is implemented
using WHATWG's Windows-1252 aliasing. Unsupported encodings fail clearly before
input acquisition. `//TRANSLIT` is a target-encoding suffix. Other suffixes,
including `//IGNORE`, source suffixes, and unrequested utility options fail
explicitly rather than silently broadening the supported interface.

When either encoding is omitted, `LC_ALL`, then `LC_CTYPE`, then `LANG` selects
the default: C/POSIX (or unset) means ASCII; C.UTF-8/C.utf8 means UTF-8. Other
default locales require explicit `-f` and `-t`. No host locale/environment is read.

With `//TRANSLIT`, the effective locale must be C, POSIX, or unset. Other
transliteration locales, including C.UTF-8/C.utf8, fail explicitly before input
acquisition even if a particular input would be representable. No C.UTF-8
transliteration parity or accent-stripping behavior is claimed. Without the
suffix, explicit source/target codecs do not inspect the locale. Representable
characters always use their target encoding directly; for example, Latin-1
output retains `é` and `ß`, rather than replacing them with `?` and `ss`.

## Reference behavior

The admitted oracle is Ubuntu glibc **2.31-0ubuntu9.18**, amd64, little-endian,
not GNU libiconv. Oracle executable SHA-256:
`c3326a1703bd6c5e516bc752f1539610ea3ac02f8919dd4e1c0095dac910b98b`.

The matching CLI, gconv loops/skeleton, ASCII/UTF-8 conversion paths, and
ISO-8859-1/UTF-16 modules inform this implementation. This is not a claim of all
glibc encodings, all locales, or complete utility-option compatibility.

- Payloads remain bytes throughout. Valid prefix output survives a later illegal
  sequence or incomplete EOF. Diagnostics use `iconv:` instead of the oracle's
  absolute executable prefix; admitted fixtures retain both stderr byte strings.
- `-c` suppresses illegal/unrepresentable sequences, not incomplete EOF. A file
  containing only suppressed data can return 1 with empty stderr. Native status
  also depends on gconv's 8,160-code-point intermediate batches and 32,768-byte
  CLI output buffer; it cannot be inferred merely from whether any prefix printed.
- The pinned UTF-8 codec accepts historical five/six-byte forms up to 31 bits,
  while rejecting overlong encodings and surrogates. This is deliberately not
  modern Unicode-only UTF-8 validation. UTF-16 cannot represent values above
  U+10FFFF. Unicode tags U+E0000–U+E007F are ignored by ASCII/Latin-1 targets.
- Generic UTF-16 output is little-endian with a BOM when its encoder starts;
  empty input produces no BOM. Explicit-endian encodings preserve BOM code points.
  Generic source BOM handling is per file, but the pinned decoder's byte-swap
  flag persists across files, including the observed BE-file/LE-BOM-file quirk.
  Successful file conversion resets output-BOM state. Inputs are not concatenated
  to repair incomplete sequences across file boundaries.
- Pinned generic UTF-16 has another observable BOM effect for transliterated
  historical UTF-8 values above U+10FFFF: the replacement encoder emits an extra
  BOM for each such replacement in the first gconv target batch. This ends after
  the first 8,160 decoded code points, not after the first character. Explicit
  UTF-16LE/BE do not add these BOMs. Native boundary fixtures retain the behavior.
- Each file is fully read within bounds before conversion, matching native
  read-error effects: a late read failure emits no converted bytes for that file.
  Earlier files' output remains. Open failures continue to later operands;
  read/conversion failures stop them. Directory and trailing-slash errors differ.

The original transliteration handoff recorded a historical 401-case memory-only
cohort: 248 native differential fixtures and 153 API, lifecycle, cancellation,
stream-boundary, and limit checks. The later 24-file source candidate recorded
544/544 in `source-full-green-v1.log`, bound by `handoff-source-v3.json` SHA-256
`005d2d5439cd3628fc7d25e0bebed7967bacc8e386291ed7fb23a807b7d3ce74`.
That historical cohort comprises 471 canonical source cases plus 73 scratch-only
test executions: three argument/output-snapshot checks, 27 core native oracles,
37 native boundary oracles, one Shell CPU-checkpoint check, and five diagnostic
drain checks. The corresponding scratch modules are `review.test.ts`,
`native-review.test.ts`, `boundaries-review.test.ts`, `cpu-review.test.ts`, and
`lifecycle-holdouts.test.ts`; 544 is not the canonical discovery count. Two scratch
output-snapshot checks repeat maintained assertions, so the 73 executions are
not a claim of 73 additional distinct behaviors.
The integrated focused run on September 10, 2026 reported 481/481: 471 canonical
source cases plus ten iconv/hexdump public cases. Its separate evidence is
`/tmp/issue685-live-focused-v1.log`; that run does not include the 73 scratch-only
cases or establish full repository gates or publication. These are dated cohort
results, not fixed inventory assertions. Current
command tests live under `tests/commands/iconv/` and
`tests/commands/iconv-independent/`; public registration and saved-VFS workflow
checks are in `tests/plugins/iconv-commands.test.ts`, with shared public-consumer
fixtures in `scripts/fixtures/safe-packages-iconv.mjs` at the repository root.
Large native context fixtures compare captured output SHA-256 and length; their
exact bytes are retained in the separate native evidence. Unsupported-locale policy tests
are not labeled native parity. Separate source-only qualification executes the
actual command against all 1,714 new transliteration capture records, comparing
exact stdout, status, and stderr after only the executable-prefix substitution.

## Bounds and ownership

`IconvCommandsOptions.limits` accepts positive safe-integer overrides:

| Limit | Default |
| --- | ---: |
| maxArguments | 4,096 |
| maxArgumentBytes | 65,536 |
| maxInputBytes | 8,388,608 |
| maxBufferedBytes | 33,554,432 |
| maxOutputBytes | 67,108,864 |
| maxDiagnosticBytes | 65,536 |
| maxWork | 134,217,728 |
| maxChunks | 65,536 |
| maxEmptyChunks | 4,096 |

Input, output, work, and chunk limits are cumulative over the invocation. Each
consulted locale value is also bounded by `maxArgumentBytes` and charged as work.
Buffered accounting admits owned copies, concatenation overlap, argument storage, chunk
metadata, and output staging before allocation. It is not a JavaScript heap/RSS
measurement or a bound on arbitrary allocations inside a host-provided VFS.
Fallback `readFile` receives `maxBytes` and has a reserved snapshot allowance.
The immutable, shared 1,782-entry transliteration dictionary is fixed module
data, not invocation-buffer or JavaScript-heap accounting. Each fallback has
at most seven ASCII bytes; lookup/replacement work and final output are charged.

Retained source chunks are copied before producer advancement/finalization.
Writes are awaited. Cooperative work yields regularly; caller and owned-output
cancellation preserve even falsey reasons and drain admitted reads/writes and
iterator cleanup before settlement. Iterator `done` and `value` are sampled once.
Method selection and relevant VFS getters are followed by cancellation checks.
Argument count and each uncarried argument are sampled once; byte admission and
materialization use that same snapshot. Owned raw argument carriers retain their
byte identity. stdout, its owned-output capability, and its consumer signal are
captured once for enrollment and subsequent writes. Work yields preserve the
actual Shell caller-signal CPU checkpoint as well as owned-output cancellation.
An already-admitted source returned by a synchronously aborting `readStream`
is acquired only for cleanup, without advancing it.

There is no native fallback, host filesystem access, subprocess, network, or new
runtime dependency in command code. The lifecycle contract does not promise to
preempt arbitrary uncooperative host JavaScript. Maintained test fixtures use
MemoryFileSystem; native process/file captures are separate scratch evidence.

## Transliteration Data Provenance

`transliterations.ts` is generated from independently captured native conversion
behavior, not by extracting the reference table. The generators do not read
reference table text, layout, or source-file bytes. Original glibc source was
read during behavior analysis; this is not described as clean-room work or
legal clearance. No project licensing change is proposed.

The capture enumerates all **1,112,064 Unicode scalar values**. ASCII identity
is captured separately; each of the 1,111,936 non-ASCII scalars is framed in a
batch of at most 4,096. C uses NUL, POSIX uses U+001F, and unset locale uses DEL
as separators. Every output must have exactly the admitted frame count, no
trailing fragment, bounded ASCII replacements, and matching profile results;
ambiguous framing fails admission. An overlapping, unframed C sweep separately
checks ascending adjacency across batch boundaries.

The resulting functional dictionary stores **1,782 deviations from `?`**, with
150 empty outputs and a maximum expansion of seven ASCII bytes. This includes
observable tag ignoring as well as transliteration; it is not a reproduction
of the source table's structure. `é` becomes `?`, `ß` becomes `ss`, and `€`
becomes `EUR`. No Unicode normalization or guessed accent stripping is used.

Full non-ASCII sweeps also verify Latin-1 targets and UTF-16LE sources. Further
cohorts check all observed exceptions in reverse order and around ten contexts
(combining marks, ignored characters, tags, a joiner, ASCII, and an emoji), all
ignored characters together, composed/decomposed sequences, files, malformed
input, and output/batch boundaries. These sequence cohorts are not an exhaustive
enumeration of all possible multi-code-point strings.

The historical 31-bit UTF-8 domain above U+10FFFF is qualified separately with
524 deterministic boundary/pseudorandom probes across all six targets. Default
replacement follows the source-informed C fallback policy; those probes are
not misrepresented as exhaustive enumeration of the entire 31-bit domain.

The scratch handoff retains every capture generator and raw stdin/stdout/stderr
with per-record hashes, argv, locale, status, and timeout/output ceilings. It
also preserves the original failed one-BOM expectation and the subsequent
UTF-16 qualification; no native output was rewritten to match an assumption.
Capture groups are bounded by 1,150/100/544 calls, 90/30/30-second aggregate
ceilings, and two-second per-call timeouts. Actual successful calls are
1,095/75/544; the first generator stopped on its incorrect BOM expectation,
and authenticated offline derivation plus independent gap captures completed
the qualification without replacing that evidence.

Key SHA-256 identities:

- Scalar capture generator: `a3e7a14b6d6a8b979b1ffcf6b2c0e17e65e8cc6da2fa894ff7f932f42c511366`.
- Derived observations: `f888596fe3169ae0cc819af7b84a338a1eabbc1fa2a56ed7da2568e141c91f36`.
- Generated dictionary module: `2ae6cf2999eaff3a11487eebac0ef839409383658f695bbaf9ea5d715390cee1`.

The handoff manifest additionally binds every generator, raw record manifest,
scratch candidate file, observed repository helper, and the frozen core handoff.
Independent core review contributed the argv/output-snapshot regressions, a
minimum-target-output guard at the native `-c` full-buffer boundary, and the
actual Shell CPU-checkpoint regression. Source-invalid and target-unrepresentable
tails remain distinct: after 32,768 ASCII output bytes, `-c` can return 0 for an
invalid UTF-8 source byte but 1 for a valid character unrepresentable in ASCII.
