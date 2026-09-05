# Shell extension bindings and input

Extensions are explicit `Shell` configuration. Their builtin metadata is captured
at installation, including the original execution receiver. `expansion` defaults
to `ordinary`; `declaration` preserves assignment arguments through direct,
`command`, and `builtin` invocation. Replacing a core builtin requires explicit
`replace: true`; omitted or false replacement metadata retains collision errors.
Replacement metadata is validated and captured at installation. Duplicate
extension builtin names still reject, even when replacement is requested.
Direct dispatch and the `command`, `builtin` and `type` lookup paths honor the
installed replacement without enabling optional command implementations.

An invocation's `bindings` interface reads canonical `ShellValue` values, not
reconstructed display text. `describe` distinguishes unset, scalar and indexed
bindings and reports readonly/export attributes. `assign` uses ordinary shell
assignment rules, including element zero for an existing indexed binding.

`prepare(name, { kind: "indexed", clear? })` creates a one-shot staged transaction.
It preserves the prior binding unless `clear` is true. Staged edits are invisible
until `commit`; commit closes publication. `close` is idempotent, drains admitted
work and discards unpublished state. Concurrent transaction operations are
rejected. Binding replacement, readonly changes or incompatible exported state
invalidate publication. Values, snapshots and local restoration share the shell's
existing ownership and allocation accounting. This API is not an incremental
writer and does not establish mapfile callback semantics.

`openIndexed(name, { clear? })` instead admits an incremental indexed writer.
Admission creates or promotes the target and optionally clears it immediately.
Each awaited `set` publishes its cell before the next callback or operation;
`close` drains admitted work without rolling back already published cells.
Sequential writes do not clone the entire array per record. Retained snapshots
use copy-on-write and keep their prior contents and ownership accounting.

The writer preserves canonical bytes, local restoration and scalar command-prefix
restoration. A readonly attribute added after successful admission does not revoke
that admitted writer. Compatible array replacement remains visible to subsequent
writes; unset/recreate invalidates the identity and is safely refused rather than
emulating native stale-target behavior. This does not qualify associative/type
replacement, control-name indexing or previously unsupported indexed prefixes.
The one-shot transaction's stricter publication checks remain unchanged.
Indexed reads support `0..4294967295` so writer-created cells can be queried by
binding access, element expansion, element length and `[[ -v ]]`. This does not
widen the existing one-shot transaction or ordinary assignment limits. Admission
also binds the local declaration identity: a deeper local shadow is not the
original target, even if its name matches, and cannot receive that writer's edits.

`input.borrow(fd)` borrows an enrolled readable descriptor's shared cursor.
Descriptor aliases and subsequent consumers see the same consumed position.
Releasing a borrow does not close the underlying descriptor. A borrow is scoped
to its invocation, and its reads participate in invocation cleanup. Unreadable
descriptors fail with `EBADF`; unenrolled sources fail with `ENOTSUP` rather than
creating an independent cursor.

`read` returns an owned, explicitly releasable shell-read record, with optional
count, delimiter, exact-count and positive finite `timeoutMs` controls. It follows
existing shell-read byte handling, not arbitrary binary-record semantics.
`record({ delimiter? })` forwards the raw-record operation described below.
`readiness()` queries the shared cursor without consuming input. Neither method
lets the borrower override source provenance, polling or clocks. Invalid options
reject before consumption; zero timeout requires a readiness query, not `read`.
Extension methods retained after their invocation cannot acquire new resources
or publish new state, and a released borrow cannot read or poll its cursor.

## Internal input readiness and deadlines

The internal `ShellInput` constructor accepts explicit source provenance and an
optional nonconsuming readiness poll and clock. These capabilities belong to the
shared cursor; borrowed inputs cannot replace them. `readiness()` reports ready,
EOF, blocked or unknown without starting a producer pull. Unknown is not EOF.

`line` accepts a positive finite `timeoutMs`. Stream deadlines preserve pending
pulls and unconsumed input for later reads; regular-file provenance ignores the
deadline. Unknown provenance refuses timed reads rather than guessing. A zero
timeout is represented by a readiness query, not a timed consuming read. Queue
wait is included in the original deadline, and root cancellation retains its
reason and precedence. Results distinguish delimiter, count, EOF and timeout,
including owned partial values that callers must release.

This capability and its borrowed-input forwarding do not themselves add shell
`read -t` or infer host stream readiness. Owning-source construction and optional
builtin installation must supply those separate integrations.

## Prepared input sources

Internal `prepareBytesInput(value, budget)` captures finite input into owned,
budgeted bytes. Its result supplies a source, cursor options and idempotent
cleanup. Callers must enroll that cleanup before constructing a cursor.
`prepareFileInput(context, path, budget)` enrolls cleanup before acquisition,
classifies and reads the same canonical descriptor, and preserves the original
cleanup-registration receiver. Regular descriptors ignore positive deadlines;
character descriptors allow deadlines without inventing nonblocking readiness.
Only an unsupported canonical open permits the legacy source fallback, whose
provenance remains unknown. Queued reads observe established EOF consistently.

Canonical regular-file sources select captured `eof: "retryable"` behavior.
EOF ends the current serialized operation without closing its descriptor. The
next operation may read appended data through that same descriptor and offset;
it does not reopen the pathname. Explicit owner/cursor close still drains the
descriptor after EOF. Established EOF may still be reported by readiness until
the next consuming operation. Ordinary sources default to terminal EOF, and
retryable EOF is rejected unless regular provenance is supplied. Borrowers
cannot replace this captured policy.

`createBytePipe().readiness()` is a detachable, nonconsuming poll for buffered
bytes, drained EOF or blocked input. Empty writes do not make the pipe ready,
and failed pipes throw their original failure reason. Input-source construction
must explicitly thread these owned capabilities into the shared cursor; these
helpers do not infer capabilities for arbitrary host iterables.

Prepared transport buffers use Budget-keyed ownership accounting independently
of the expansion-value arena. Allocation is admitted before the owned copy or
descriptor buffer is created, and explicit cleanup retires the capacity lease.
`maxInputBytes` remains a per-input limit: two individually admitted inputs may
coexist even when their combined capacity exceeds one input's allowance. A
canonical descriptor may use a one-byte overflow probe when the allowance is
zero. Materializing retained shell values still uses the existing expansion
budget. This separation does not introduce an aggregate memory limit or an RSS
guarantee.

Shell execution prepares finite supplied/default stdin and inline redirections,
and file redirections prepare their canonical descriptor before constructing the
cursor. Pipeline input carries its own nonconsuming pipe poll. Transparent
evaluation, source and interpreter invocation retain the enrolled shared cursor;
arbitrary host iterables retain unknown provenance. Source cleanup is enrolled
before acquisition and remains required even when cursor construction fails.
These integrations do not install optional builtins or make arbitrary host input
pollable.

Prepared file input accepts the same optional internal
`cleanupFailurePrioritySignal` capability as canonical descriptor cleanup and
forwards it to that descriptor owner. It also applies to legacy iterator
teardown. Redirect owners select the execution-root signal, so a handled local
pipeline stop does not replace a separate teardown failure. Cleanup still drains
all enrolled sources before the runtime discards its exact handled pipeline-stop
reason; root caller cancellation retains priority.
Registered failure replay rechecks the captured priority signal. Direct close
still returns its cached promise and original rejection, including after a later
cancellation; successful cached cleanup is not reclassified as a failure.

## Internal raw input records

`ShellInput.record({ delimiter? })` reads through a byte delimiter, defaulting to
LF, or EOF. The returned owned `shellValue` preserves every byte, including the
delimiter, embedded NUL and invalid UTF-8. `reason` distinguishes `delimiter` from
`eof`; an EOF record can be empty or contain an unterminated suffix. Callers must
release each result with its idempotent `release()` operation.

Record reads share the existing cursor, serialization, cancellation and retained
byte accounting with line reads and descriptor aliases. They do not implement
backslash processing, IFS splitting, NUL removal, delimiter trimming or timed
reads. Those transformations belong to the consuming builtin. Existing `line()`
semantics remain unchanged; a raw record is not an ordinary shell variable
assignment and must not silently be substituted for a shell-read result.

The extension borrow forwards this same raw-record primitive; it does not deliver
mapfile/readarray by itself. Their activation and callback semantics remain separate.
