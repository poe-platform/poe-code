# Shell extension bindings and input

Extensions are explicit `Shell` configuration. Their builtin metadata is captured
at installation, including the original execution receiver. `expansion` defaults
to `ordinary`; `declaration` preserves assignment arguments through direct,
`command`, and `builtin` invocation. This does not grant permission to replace
existing builtins or enable optional command implementations.

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
count, delimiter and exact-count controls. It follows existing shell-read byte
handling, not arbitrary binary-record semantics. The current borrow API does not
expose deadlines or claim nonblocking readiness. Extension methods retained after
their invocation cannot acquire new resources or publish new state.

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

This internal capability does not itself add shell `read -t`, infer host stream
readiness, or expose deadlines through the extension borrow API.

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

The raw-record primitive alone does not expose a new extension borrow method or
deliver mapfile/readarray. Their activation and callback semantics remain separate.
