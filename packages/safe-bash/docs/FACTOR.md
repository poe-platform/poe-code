# factor

`factor [NUMBER]...` prints `N: p q r` with prime factors in ascending order,
repeating factors according to multiplicity. With no operands it reads numbers
from stdin. Operands are numbers, not VFS filenames; `-` is an invalid number.
Use shell redirection to read a VFS file. No host process, host filesystem or
network fallback is used.

## API and magnitude

`createFactorCommand(options?)` returns one command definition;
`createFactorCommands(options?)` returns its one-element collection;
`factorCommands(options?)` returns the registration plugin.
`FactorCommandsOptions` provides `replace` (default false) and
`limits: Partial<FactorLimits>`. Supplied limits are copied and validated at
factory construction as positive safe integers.

The supported magnitude is **0 through 4,294,967,295 inclusive**. `maxValue` may
lower that ceiling but cannot raise it. Values above the configured ceiling
produce an explicit diagnostic naming the supported maximum, and processing
continues with subsequent operands/tokens. This intentionally differs from the
reference binary's wider numeric range. Syntax errors take precedence over
magnitude errors, even when an invalid character follows an overflowing prefix.

The implementation uses exact integer-valued Number arithmetic, removes factors
of two, then tries successive odd divisors until the squared divisor exceeds
the remainder. There are at most 32,767 distinct odd candidate divisors per
supported number. Every trial and repeated division consumes the cumulative
command work budget. No BigInt, probabilistic primality verdict, random search,
recursive factorization or external arithmetic provider is used.

| Limit | Default | Meaning |
| --- | ---: | --- |
| `maxValue` | 4,294,967,295 | Inclusive numeric ceiling; cannot exceed uint32 |
| `maxArguments` | 4,096 | Argument count |
| `maxArgumentBytes` | 65,536 | Total raw argument bytes |
| `maxInputBytes` | 16,777,216 | Cumulative actual stdin fragment bytes |
| `maxTokenBytes` | 65,536 | Physical token/operand bytes, including leading zeros and ignored NUL suffixes on stdin |
| `maxNumbers` | 65,536 | Numbers processed, including invalid tokens |
| `maxBufferedBytes` | 4,194,304 | Charged argument, fragment, token, factor-formatting and output-buffer storage |
| `maxOutputBytes` | 16,777,216 | Cumulative stdout allowance |
| `maxDiagnosticBytes` | 65,536 | Cumulative stderr allowance |
| `maxWork` | 8,388,608 | Cumulative parsing, copying, arithmetic and output work |
| `maxEmptyChunks` | 4,096 | Cumulative empty stdin fragments |

Storage accounting uses explicit logical allocation charges, not a JavaScript
heap/RSS guarantee. The output buffer reserves 1,024 bytes; a factor record has
a bounded 512-byte arithmetic/formatting reservation. Diagnostics use a separate
bounded allowance so main work/storage exhaustion can still be reported.
Explicit work checkpoints yield cooperatively once at least 1,024 additional
units have been charged. Batched argument admission and fragment-copy charges
can cross that threshold before the next checkpoint; 1,024 is not a bound on
every uninterrupted segment. Those batches remain subject to the configured
argument, input and work limits.

## Bytes, options and environment

- Decimal syntax permits initial ASCII spaces, then one optional `+`, then one
  or more ASCII digits. Trailing spaces, negative values, tabs in operands,
  hexadecimal/exponent notation and Unicode decimal digits are invalid.
- `0` and `1` print `0:\n` and `1:\n`, with no factors. Leading zeros and the
  accepted prefix are removed from successful decimal output.
- Only SPACE, TAB and LF delimit stdin tokens. CR, VT and FF are token bytes.
  For stdin, NUL terminates the numeric string as in the reference C program;
  the rest of that physical token is consumed and charged, not reinterpreted as
  another number. A leading NUL produces an invalid empty numeric string.
- Raw invalid UTF-8 bytes retain C-style octal diagnostic escapes. NUL in argv
  and malformed JavaScript UTF-16 strings are rejected rather than repaired.
- `--` ends option parsing. Options are parsed before any factoring. Presence
  of `POSIXLY_CORRECT`, even empty, ends option parsing at the first operand;
  otherwise option permutation follows the reference profile.
- `--help`/`--version` and their unambiguous prefixes print explicitly virtual
  information, not GNU copyright/version banners. Help reports the configured
  maximum. The reference's hidden `---debug` and prefixes emit the single-
  precision marker for admitted valid numbers. Neither exponent formatting nor
  other unrecognized options are supported.

Diagnostics are English/C-profile bytes. `POSIXLY_CORRECT` is the only
command-specific environment input; locale variables do not enable translated
messages, alternate digit syntax or locale-dependent quoting. There is no
clock or timezone input.

## Output and cancellation

Completed records are buffered into non-TTY-style batches of at most 512 bytes,
ending at a newline. Remaining complete records flush at successful input
completion, including runs with invalid-number diagnostics and status 1.
Interactive TTY-specific flushing is not emulated. A factorization is complete
before its record is admitted; a work limit never becomes an apparent prime
verdict or an incomplete factor line presented as success.

Fatal resource, I/O or cancellation failures stop processing. Already published
output remains; pending unflushed records may be discarded. Output and cleanup
failures are not hidden, and primary plus cleanup failures are retained together
unless caller cancellation takes precedence. VFS stream read failures are
explicit errors rather than emulating the original unchecked stdio `ferror`.

Cleanup is registered before source acquisition; admitted cooperative reads and
owned destination writes drain before iterator cleanup/public completion. Input
fragments are copied before advancing or finalizing their producer. Backpressure
is awaited, falsey cancellation reasons are preserved, and no new writes are
admitted after cancellation. These contracts require faithful providers and do
not forcibly preempt uncooperative host JavaScript. The command does not mutate
the VFS; script loading and redirection remain shell responsibilities.

## Reference evidence

The full GNU 8.30 utility source (2,661 lines) and `readtokens.c` (195 lines)
were read. `factor.c` SHA256:
`854f7a201d08d20f6fafb17f1ad0903f85bce0cab3247ac6510230283600e4f4`.
The supplied 25 native cases remain preserved. Three wide-number cases have
explicit uint32-cap expectations instead of being counted as native matches;
22 compare native stdout/stderr/status directly. Fifteen additional C/UTC native
captures cover the uint32 boundary, a large supported prime, composites, hidden
debug output, option errors, raw bytes/NUL and 511/512/513-byte totals. Thus these
40 fixture cases comprise 37 exact comparisons and three cap qualifications.
Source-derived write-boundary and virtual-information tests are separate.

This is finite Linux/reference-profile evidence, not all-input GNU parity,
proof of package signatures or a reproducible build. Wider native results and
all previous red attempts remain evidence rather than being rewritten.
