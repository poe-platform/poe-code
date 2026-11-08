# Tee target admission

`StandardCommandsOptions`, `AgentCommandsOptions`, and `BrowserCommandsOptions`
accept `maxTeeTargets`. Their command factories and registration plugins forward
the same limit to `tee`. The default is 64 file operands per invocation. A host
may choose any nonnegative safe integer; invalid values throw `RangeError` when
the command factory runs, including during plugin setup. Zero permits
stdout-only `tee` but refuses every invocation with a file operand.

After parsing `tee` options, the command counts every file operand, including
duplicate paths. An excess produces a usage diagnostic and exit status 2 before
any tee-owned filesystem access, output opening or truncation, or stdin reading.
Options are not targets; stdout is not a target. This check does not batch,
replay, canonicalize, or deduplicate operands.

Admission does not change admitted invocations: destinations open in operand
order before input consumption, overwrite/append retain their existing adapter
semantics, and each operand retains its own output lifecycle. Byte charging,
backpressure, borrowed-buffer ownership, partial failure behavior, cancellation
reasons, and cleanup remain governed by the existing command and filesystem
output contracts. In particular, duplicate operands still cause separate opens.

Shell redirections are separate: a redirection attached to `tee` may already
have opened or truncated its destination before `tee` runs and refuses its own
targets. This option does not change those effects or count those destinations.

The limit bounds admitted file operands for one `tee` invocation, not all
concurrent commands, file descriptors, bytes, heap, persistent filesystem state,
or backend resources. A host-supplied command replacement need not implement this
policy. Existing output-byte budgets and filesystem capabilities still apply.
Increasing the host limit deliberately admits more output lifecycles; no fixed
per-target memory cost or process-level resource guarantee is implied.
