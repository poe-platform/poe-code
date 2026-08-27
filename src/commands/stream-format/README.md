# Stream formatting

`seq`, `nl`, `rev` and `unexpand` are included in `agentCommands()` and
`createAgentCommands()`. Together with `split`, they extend the preserved prior
60-command registry to exactly 65 unique defaults; curl and SafeJS remain optional.
`createStreamFormatCommands(options?)` returns four command definitions and
`streamFormatCommands(options?)` installs that family explicitly. Both functions,
`StreamFormatCommandsOptions` and `StreamFormatLimits` are exported from
`virtual-bash` and `virtual-bash/commands/stream-format`.
The plugin preflights collisions; `replace: true` intentionally replaces them.

Configure the default family through the aggregate, rather than installing the
explicit plugin again. Aggregate replacement belongs at the top level, not inside
`streamFormat`:

```ts
import { agentCommands, createMemoryFileSystem, Shell } from "virtual-bash";

const shell = new Shell({ fs: createMemoryFileSystem() }).use(agentCommands({
  streamFormat: { limits: { maxInputBytes: 1024 * 1024 } },
}));
```

The original **source-only opt-in** delivery had no root exports, package subpaths
or default registration. That historical scope and its evidence remain historical;
the current availability proof is the isolated ESM/declaration build and strict
root/subpath consumers in `tests/plugins/stream-five-fixture-migration`. This is
not a published-release claim, final independent packed verification, or an
extension of the native semantic coverage below.

`StreamFormatCommandsOptions.limits` accepts partial `StreamFormatLimits`.
Defaults per invocation: input 32 MiB, output 64 MiB, record 8 MiB, input/output
chunk 1 MiB, files 64, steps 268435456, argument bytes 65536, numeric digits 4096.
All limits are positive safe integers. The surrounding Shell still applies its
own shared budgets. Output is awaited and copied before sink publication; retained
input records are copied. Limit failures can leave already-published output.
Cancellation cannot undo completed host effects or stop uncooperative host work.
Filesystem reads use only the provided VFS; missing streaming support uses a
bounded readFile call. No product subprocesses or runtime dependencies are used.

## seq

Accepts one, two or three signed decimal operands, including decimal exponents.
Supports `-s`/`--separator`, `-w`/`--equal-width`, `-f`/`--format`, and `--`.
Format strings contain one `f`, `e` or `g` conversion (uppercase variants and
optional `L`), literal text/`%%`, sign/space/zero/left/alternate flags, width and
precision. Zero steps and combining equal-width with explicit formats fail.
Formats, exponents and coefficients are bounded before large allocation.

Without `-f`, progression uses exact scaled decimal integers, not floating
accumulation. Default fixed precision comes from first/increment, not the endpoint.
Exact decimal precision beyond native floating precision is a documented extension.
With `-f`, finite binary64 operands and a non-underflowed increment are required:
the value is first + index * increment with one binary64 rounding (the observed
Darwin arm64 fused-arithmetic profile), then its exact binary64 value is rounded
ties-to-even for rendering. This matches the pinned GNU9.7 Darwin arm64 floating
profile, including a boundary value only when its rendered number equals the
endpoint and differs from the prior output. Negative zero is preserved. This
does not claim x86 extended-precision GNU behavior. Original decimal-only format
failures and their source correction are retained in author evidence. Nonfinite,
hexadecimal floating operands, `%a`, and locale-specific numeric punctuation are
not supported. Numeric locale is always the C decimal convention.

Author native controls use pinned GNU coreutils 9.7 executables built on Darwin
arm64, not GNU/Linux. Author tests are not an independent verifier or a full gate.

## nl

Supports header/body/footer styles `a`, `t`, `n`, `pBRE` with `-h`, `-b`, `-f`;
`-v` starting number, `-i` increment, `-l` blank joining, `-w` width, `-s`
separator, `-n ln|rn|rz`, `-d` section delimiter, `-p` no-renumber, `--`, and
their GNU long names. Width must be positive; blank joining is nonnegative, with
zero treated as one as measured on GNU9.7. Numbering
and increments use signed 64-bit integers; overflow fails before printing the
next numbered line. Missing files diagnose and continue. Files retain numbering
and section state; each unterminated final line is completed with LF.

The default delimiter pair is backslash/colon. One, two or three repetitions
select footer, body or header. Every recognized section delimiter outputs a blank
line and resets the counter unless `-p`. `-d ''` disables delimiter matching;
long delimiter strings are accepted. A one-byte `-d` retains the second delimiter
byte. Blank joining counts only truly empty lines, not whitespace-only lines.

Patterns reuse the existing read-only text-programs BRE `Pattern`, not JavaScript
user-supplied RegExp. Its instruction execution, backreference comparisons and
state memory are bounded; a local Budget adapter charges this invocation's same
step counter. Compilation is bounded at 8192 pattern bytes, nesting64,
16384 instructions and repetition1000. Execution is synchronous within one
bounded match; cancellation is checked on instructions, with event-loop yields
between input work. This is byte/C-locale matching: ASCII POSIX classes and
byte ranges, no locale collation/equivalence classes or Unicode character classes.
The inherited matcher dialect is not a claim of all GNU BRE behavior.

## rev

Apple/BSD-style LF line reversal, file operands and `--`; no other flags. With
no files it reads stdin. Explicit `-` is a literal file named `-`, as on the
measured Apple reference, not the stdin convention of the other commands here.
Unterminated lines acquire LF. Guest `LC_ALL`, then `LC_CTYPE`, then `LANG`
select the character profile; empty/unset resolves to C, based on an actual
environment-cleared native control, never the host process environment.
`C`/`POSIX` reverse bytes including NUL and malformed UTF-8. Explicit UTF-8
locales reverse code points, not grapheme clusters, preserving BOM and NUL.
Other encodings are not implemented and fail explicitly.

UTF-8 validation rejects overlong encodings, surrogate encodings, out-of-range
codepoints and incomplete sequences without replacement characters. Like the
measured Apple rev, malformed input emits the reversed valid prefix plus LF
if that prefix is nonempty, diagnoses `Illegal byte sequence`, returns failure,
skips the rest of that input file, and continues later operands. This behavior
is an Apple/Darwin profile; no util-linux executable was available or installed,
and rev is not labeled GNU coreutils. Lines are bounded by maxRecordBytes.

## unexpand

Converts initial spaces/tabs by default. `-a`/`--all` converts throughout lines;
`--first-only` overrides explicit or implicit all mode regardless of option order.
`-t`/`--tabs` accepts a positive uniform size, ascending explicit stop list, and a
final `/N` absolute or `+N` relative repeat. Lists may use commas or ASCII blanks.
`-t` implies all mode. Obsolete `-4`/`-4,8` spelling does not imply all mode.
Files and repeated `-` stdin operands form one continuous byte stream, including
column state across file boundaries. With a finite list, blanks past the last
stop are preserved. Backspaces move the tracked column back, LF resets it; other
nonblank bytes advance one column. No Unicode display-width or locale-specific
blank classification is invented: this is the GNU9.7 C-byte column profile.

Pending blank runs use counters rather than line-sized storage, with an awaited
bounded byte writer. Tabs and columns must fit positive safe integers; input,
output and step limits bound actual work. No newline is added at EOF. Existing
expand remains unchanged and is exercised only as a pipe counterpart in tests.
