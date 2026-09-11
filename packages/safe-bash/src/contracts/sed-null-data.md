# sed NUL-record mode

`sed -z` and `sed --null-data` select NUL-delimited records. Short flags can be
combined with the existing flags; `--` still ends option parsing. LF remains the
default. Neither mode strips NUL bytes or decodes record payload as Unicode:
interpreter strings retain one Latin-1 code unit per byte.

## Record semantics

- NUL mode treats embedded LF as payload. Numeric, range, last-record and regex
  addresses operate on NUL records. Empty records count; a final separator does
  not introduce a phantom record. `=` emits NUL-terminated record numbers.
- Automatic output, `p`, `P`, `s///p`, `w` and `s///w` use the NUL terminator when
  pattern space is terminated. A final unterminated pattern stays unterminated
  until another output operation on that destination requires its missing NUL.
  Repeated `p;p` on `tail` therefore produces `tail\0tail`, not `tailtail`.
  stdout and each script-output file retain independent pending-separator state.
- `P` and `D` locate NUL boundaries inside pattern space; `N`, `H` and `G` join
  spaces with NUL. NUL-mode hold operations copy/exchange termination metadata as
  well as payload; the initial empty hold space is terminated.
- `a` queues its text with the script's final LF; `i` and `c` output their text
  with the selected NUL terminator. They are not interchangeable output paths.
  Embedded script/text `\n` remains LF; script syntax remains LF-based.
- Before draining queued `a`/`r` output, sed emits any pending stdout NUL once.
  The queued bytes themselves remain raw, including leading/trailing NUL or
  non-UTF-8 bytes in an `r` file. Raw output does not establish another pending
  separator by inspecting its last byte. Queues drain at cycle end, quit, or the
  next successful `n`/`N` read; `q` also flushes pending stdout termination when
  its append queue is empty, matching the native control.
- Input files and stdin operands retain the existing continuous/separate-file
  addressing policies. A non-final unterminated file record acquires a separator
  before the following file's first record in continuous mode. `-s` and `-i`
  reset per-file interpreter state; successful `q` still ends the whole invocation.
  In-place backups and writes use the existing VFS requirements and output budget.
  `-s` retains pending output state across input files. Each in-place replacement
  has its own stdout state; explicit script-output files remain invocation-wide.

## Regex and compatibility profile

The existing byte-oriented regex engine is unchanged. Dot and negated classes
can match LF payload and a NUL inserted by `N`/hold-space operations. `^` and `$`
anchor pattern space, not each embedded LF/NUL. The existing global `^|$` policy
is retained. `\n` means LF in regexes and replacements; NUL mode does not add GNU
multiline `m`/`M` flags, hex escapes, or other previously unsupported regex syntax.
Literal NUL in a script file remains usable as a regex/replacement byte.

This is not a claim of complete GNU sed parity:

- `l` retains this implementation's 60-column wrapping profile. In NUL mode it
  escapes embedded LF as `\n`, NUL as `\000`, and emits NUL after display/wrap
  lines. GNU's default wrapping differs.
- Only the old LF-mode repeated-print policy is retained: repeated output of an
  unterminated pattern does not insert LF between writes. This discrepancy is not
  inherited by NUL mode. The existing LF file-output policy still adds LF even to
  an unterminated record. NUL stdout/file output instead tracks pattern-space
  termination and supplies a pending separator before subsequent output.

## Resource and ownership behavior

The NUL reader is local to sed; shared LF input and awk are unchanged. Retained
fragments are converted to owned byte strings before advancing/finalizing the
producer. Record admission precedes fragment copying/concatenation; pattern/hold
joins admit the separator-inclusive length before concatenation. Existing
`maxBufferBytes`, `maxSteps`, queued-append limits and shell output accounting
remain in force. Sink and file writes are awaited; input is closed on quit,
failure and cancellation, including falsey abort reasons. Direct command hosts
remain responsible for their host-owned output limits. No native processes or
implicit host filesystem access are added to the product.

The native byte controls, pinned primary-source inspection, rejected candidate
hashes and correction history are recorded in the root plan
`docs/plans/bugfix-642-sed-null-data.md`.
