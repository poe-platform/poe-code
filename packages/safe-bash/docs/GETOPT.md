# getopt

`getopt` parses short and long options and prints shell-quoted arguments:

```sh
getopt -o ab: --long alpha,beta: -- --alpha -b 'two words' operand
```

The output is ` --alpha -b 'two words' -- 'operand'` followed by a newline.
This is the enhanced external-style command, not the shell's `getopts` builtin.
It never reads stdin or the filesystem and has no host-process, network or LLM
fallback. Script loading, command substitution and redirection belong to the
shell rather than this utility.

## API and limits

`createGetoptCommand(options?)` returns one command definition;
`createGetoptCommands(options?)` returns its one-element collection;
`getoptCommands(options?)` returns the registration plugin.
`GetoptCommandsOptions` provides `replace` (default false) and
`limits: Partial<GetoptLimits>`. Limits are copied and checked at factory
construction; every supplied value must be a positive safe integer.

| Limit | Default | Meaning |
| --- | ---: | --- |
| `maxArguments` | 4,096 | Total argument count, including wrapper arguments |
| `maxArgumentBytes` | 65,536 | Bytes in each individual argument |
| `maxInputBytes` | 1,048,576 | Cumulative argument bytes; stdin is never read |
| `maxSchemaBytes` | 65,536 | Cumulative admitted short and long specification bytes, including repeated declarations |
| `maxLongOptions` | 4,096 | Cumulative target long-option entries; duplicates count separately |
| `maxBufferedBytes` | 4,194,304 | Charged argument snapshots, specifications, parser workspace and normal output buffers |
| `maxOutputBytes` | 8,388,608 | Cumulative normal stdout bytes |
| `maxDiagnosticBytes` | 65,536 | Cumulative stderr bytes and a separate diagnostic-buffer allowance |
| `maxWork` | 8,388,608 | Cumulative argument, schema, parser, comparison, quoting and normal-output work |

All limits apply to one invocation, not independently to each option or token.
Long-name matching charges the bytes actually compared; repeated target options
do not reset the work budget. Input arrays are not mutated or repeatedly
permuted: non-option arguments are collected in stable order. Output expansion
and canonical long names are admitted before the corresponding byte buffer is
allocated. Logical storage accounting is not a JavaScript heap/RSS guarantee;
independent caps may cause a smaller effective input ceiling than any one limit.

Diagnostics have their own bounded work/storage allowance, so normal work or
buffer exhaustion can still produce an error. Diagnostic copying yields and
checks the same cancellation signal. Cooperative work steps yield after at least
1,024 charged scheduling units. Shared argument-carrier operations and bounded
string/array allocations are also constrained by the argument and storage caps;
this is not an instruction-level preemption or constant-latency guarantee.

## Parsing and quoting

- `-o`/`--options` sets the short specification; the last occurrence wins.
  `:` marks a required argument and `::` an optional argument. Optional short
  arguments are attached to the option; optional long arguments use `=VALUE`.
  Missing optional arguments are emitted as empty quoted arguments.
- `-l`/`--longoptions` appends comma, SPACE, TAB or LF separated declarations.
  CR, VT and FF are not separators. Long names may end in `:` or `::` to declare
  required or optional arguments. Empty names after suffix removal are errors.
- Exact long matches select the first declaration. Otherwise an unambiguous
  prefix is accepted; duplicate declarations can make a prefix ambiguous even
  when their names are identical. Diagnostics preserve declaration order.
- `-a`/`--alternative` enables single-dash long options with the reference
  short-option fallback rules. The GNU `W;` short-specification extension is
  supported, including its distinct diagnostic prefix.
- `-n`/`--name` sets target-parser diagnostic naming only. Wrapper diagnostics
  still use `getopt`. The last name wins; an explicitly empty name is retained.
- `-q`/`--quiet` suppresses target-parser diagnostics without changing status.
  It does not suppress wrapper errors. `-Q`/`--quiet-output` suppresses normal
  output and skips normalization. `-u`/`--unquoted` disables value quoting.
- `-s`/`--shell` accepts `bash`, `sh`, `tcsh` and `csh`. Bash/sh quoting escapes
  single quotes. Tcsh/csh also escape backslashes, exclamation marks and C-profile
  whitespace, including converting LF to the two bytes `\\n`.
- Wrapper scanning stops at the first non-option. If `-o` was not supplied, that
  argument becomes the short specification. Target scanning starts afresh;
  `--` ends that scan unless it is consumed as a required option argument.
- Target options normally precede non-options while retaining their respective
  input order. A leading `+` requests stopping at the first operand. A leading
  `-` emits operands in place and takes precedence over `POSIXLY_CORRECT`.
  A leading `:` after any ordering prefix suppresses target diagnostics but
  preserves error status. The original and ordering-prefix-stripped short
  specifications remain distinct, including reference emission quirks.
- If the first argument does not start with `-`, legacy syntax is selected:
  that argument is the short specification, all leading `+`/`-` bytes are
  stripped, and output is unquoted. Presence of `GETOPT_COMPATIBLE`, even empty,
  forces this legacy interpretation. With that variable present, no arguments
  prints ` --` plus newline successfully; `-T` is then a specification, not a test.

Normal enhanced output quotes argument values, **not long-option names**.
As in the reference, arbitrary caller-supplied schemas can produce unquoted
shell metacharacters. Do not treat the result as safe to `eval` for untrusted
schemas. Byte-preserving quoting is not a general shell-code sanitizer.

## Status, bytes and environment

Successful parsing returns 0. Target option errors return 1 while continuing
to parse and emit valid options and operands. Wrapper/schema errors return 2.
`-T`/`--test` returns 4 without output and short-circuits later wrapper options.
Configured resource exhaustion returns 3 with a diagnostic when its separate
diagnostic allowance and destination permit reporting. Status 3 is an explicit
virtual-resource policy; it does not claim an observed native OOM failure.

`-h`/`--help` and `-V`/`--version`, including unambiguous long prefixes, provide
virtual help/version information rather than the native util-linux banners.
They short-circuit later wrapper arguments. All raw arguments still pass
bounded admission before those control options are interpreted.

Invalid UTF-8 bytes in option values, names and diagnostics remain raw bytes.
NUL in argv and malformed JavaScript UTF-16 strings are refused rather than
silently repaired. The C/Linux signed-char reference profile is explicit:
a declared short `?` collides with the parser-error sentinel, declared byte 1
is emitted through the non-option path, and declared short byte 255 collides
with EOF. These are not portable promises about other C-library/CPU profiles.
The byte-255 EOF collision can discard previously deferred operands and leave
an unfinished short-option cluster in the final operand tail, matching the
pinned native parser rather than repairing that behavior.

`GETOPT_COMPATIBLE` and `POSIXLY_CORRECT` are the command-specific environment
inputs; presence, including an empty value, matters. Diagnostics and tcsh
whitespace classification use the English/C profile. Locale variables do not
enable translated messages or other character classifications. There is no
clock, timezone, implicit path or provider configuration.

## Output and cancellation

Output fragments are published with awaited backpressure; buffer sizes and
write-call boundaries do not emulate native stdio buffering. On resource, I/O
or cancellation failure, already published fragments remain. A canonical option
may have been published before its value exceeds a subsequent limit; there is
no output rollback or promise that a failed partial result can be evaluated.
If even the diagnostic allowance is exhausted or reporting fails, that failure
is not suppressed or replaced by a fabricated successful command result.

Cleanup is registered before output work is admitted. Cooperative owned writes
drain before completion/disposal; method captures preserve their receiver and
recheck cancellation after getters before invoking the method. Falsey caller
cancellation reasons retain identity and take precedence over later failures.
Ordinary opaque Shell sinks retain the shared runtime's interruptible route.
These contracts require faithful providers and do not sandbox or forcibly
preempt arbitrary host JavaScript.

## Reference profile

The full util-linux utility (472 lines) and glibc parser/entry points (810 and
159 lines) were read. Utility source SHA256:
`edb410cebd71d1a2584d967a3691db5020010a6d8648a41e5e513f3b83f6bb92`.
The reference is Ubuntu util-linux 2.34-0.1ubuntu9.6 with the pinned glibc 2.31
parser preparation. The initial 40 C/UTC captures, 30 independent raw-byte
edge captures and two additional byte-255 permutation captures compare stdout,
stderr and status without normalization.
Virtual information banners and resource/ownership tests are separate from
native comparisons. This finite Linux profile is not all-input parity,
package-signature verification or a reproducible-build claim.
