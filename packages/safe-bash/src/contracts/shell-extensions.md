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

## Optional syntax

An extension may declare `syntax: { arrayKeys: true }` to enable indexed-key
expansions, `${!name[@]}` and `${!name[*]}`. The declaration is captured before
the first parse without instantiating the extension. Factories still run after
successful initial parsing. Captured syntax follows subsequent parsing and
forks; mutating the original declaration from a factory cannot change it.
Preparse syntax capture does not move existing name, factory or runtime-identity
validation ahead of its ordinary postparse initialization point.

Syntax declarations contain only supported own data properties in a plain
object. `arrayKeys` must be `true` when present. Different extensions can declare
the same capability; this does not relax duplicate extension or builtin checks.
The `arrayKeys` declaration does not admit background-job syntax.

An extension may separately declare `indexedDeclarations: ["readonly"]` to
enable indexed readonly declarations, including their compound-assignment
grammar. This is an own data property containing a dense, bounded list of known
declaration heads; accessors, holes, extra keys, duplicates and unknown heads
are rejected. An absent or empty list remains omitted from captured syntax.
The declaration is captured and propagated with the other syntax capabilities.
Neither an extension's name nor `arrayKeys` alone enables it.

The optional `arraysExtension()` factory declares both capabilities and matching
runtime identity, with no builtins. It is absent from default registration and
package artifacts. Keys use canonical numeric ordering and the existing shared
allocation limits; this does not widen ordinary assignment bounds or implement
associative arrays. The optional leaf's semantics document records the qualified
expansion contexts and remaining limits.

### List terminators and special parameters

An extension may explicitly declare `listTerminators: [{ operator: "&" }]` and
`specialParameters: [{ name: "!" }]` within its syntax object. These are separate
capabilities: neither array syntax nor an extension named `jobs` enables them.
The declarations follow the same preparse capture and fork rules. Unsupported
operators or parameter names, accessors, sparse lists and extra properties are
rejected rather than interpreted as future capabilities.

The created instance supplies matching `listTerminators` hooks with `operator`
and `execute`, and matching `specialParameters` hooks with `name` and `lookup`.
Each hook is an own-data record; its callback is captured with its original
receiver. Hook lists must be dense and match their declarations exactly, without
duplicate handlers across instances. A valid declaration with a missing handler
fails after factory creation but before command execution. Invalid declarations
still fail before any factory is called. Mutation of caller-owned hook records
does not replace captured callbacks.

A list-terminator handler receives the usual extension context plus
`prepareChild({ signal, stdin, registerCleanup })`. Preparation binds the complete
admitted AND/OR list, not just its final pipeline. It does not expose mutable AST
or runtime state and does not convert the program back to source for reparsing.
The prepared child's `processId` is a positive virtual identity, not a host PID
or an assertion that a native process exists. Its `run()` operation is single-use.
The `stdin` policy is explicitly `inherit` or `async-default`; an asynchronous
default must not override an explicit input redirection.

Special-parameter lookup returns a canonical `ShellValue` or `undefined` for
absence. Raw values must not be reconstructed from decoded display strings.
These generic callbacks provide extension dispatch, not an automatically
installed wait builtin, job table, native process launcher or signal service.

### Execution-scoped cleanup

The actual shell context also supplies `registerExecutionCleanup(cleanup)` for
resources whose lifetime extends beyond one logical shell process. The member
is optional in the standalone context interface; an extension requiring it must
check availability before acquiring those resources, not silently substitute
ordinary frame cleanup. Registration is synchronous and precedes acquisition.

Ordinary `registerCleanup` remains attached to the shell frame and invocation.
Execution-scoped work instead remains owned until the enclosing public
`Shell.exec` settles. An isolated shell may publish its exit status and allow
parent continuation while its asynchronous descendants still run. This does not
permit the public execution or disposal to abandon those descendants' registered
resources. A direct job's own task cleanup still precedes its handle completion;
that obligation is distinct from its descendants' execution-scoped ownership.

On normal completion, EXIT handlers run before the local frame retires, including
handlers that launch further jobs. The execution drain precedes ordinary scope
sealing, so successful logical exit is not turned into cancellation. Work
registered by still-running descendants during the drain remains included until
quiescence. Enrollment after the execution lifetime closes is rejected.
Cancellation and escaping failures retain their existing outcome precedence;
registered cooperative work is cancelled as appropriate and joined rather than
detached. Opaque uncooperative host work is not forcibly preempted.

## Bindings and input

An invocation's `bindings` interface reads canonical `ShellValue` values, not
reconstructed display text. `describe` distinguishes unset, scalar and indexed
bindings and reports readonly/export attributes. `assign` uses ordinary shell
assignment rules, including element zero for an existing indexed binding.

`prepareReference(reference)` retains canonical reference syntax for operations
within the invocation's shell state, rather than snapshotting the old binding.
It returns `ShellBindingResult<ShellBindingReference>`: success carries `value`;
ordinary refusal carries an immutable, command-independent `diagnostic` body.
The caller chooses its command prefix and status. Cancellation, allocation
limits and escaping execution failures remain rejected operations with their
original identity, not ordinary diagnostic results.

The reference's `unbindName()` unsets the entire textual name. In particular,
`values[1]` is not decomposed into an element removal on that path.
`assignInteger(value)` requires a finite safe integer and resolves the current
target through canonical scalar/indexed assignment when called. Readonly
attributes are checked at operation time; local restoration, exports and
copy-on-write accounting remain the canonical shell's responsibility. This is
not a staged transaction and does not invalidate merely because the target was
replaced between preparation and assignment. Current indexed assignment accepts
the existing literal-index profile `0..2147483647`; arithmetic, nested and
negative subscripts, associative references and namerefs are not qualified by
this interface's initial implementation.

Reference operations are sequential; overlapping operations are rejected.
`close()` immediately closes admission, shares completion across repeated calls,
drains admitted cooperative work and releases retained reference accounting
without undoing mutations. Invocation cleanup also closes outstanding references.
An explicitly closed reference cannot be used for further operations. Neither
this generic API nor its consumer tests establish full `wait -p` compatibility.

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

`diagnostic(message)` accepts a canonical `ShellValue`, retaining raw payload
bytes between the ordinary script/line prefix and trailing newline. It awaits
the invocation's existing stderr sink, including redirections, output budgets,
cancellation and sink failures. It does not bypass output accounting or promise
an atomic write to arbitrary sinks. String diagnostics retain their existing
formatting; byte-valued assembly uses the existing shell-value allocation budget.

`input.validateOpen(fd)` synchronously checks whether the invocation has an open
descriptor, including write-only descriptors and aliases. It does not borrow,
read, reopen or consume input. Missing and closed descriptors fail with `EBADF`;
invalid numeric descriptors fail with `RangeError`, as with `borrow`. Invocation
lifetime and root cancellation checks apply to retained input capabilities too.
Successful validation does not establish readability or polling support.

### Non-consuming descriptor observation

`input.observe(fd)` synchronously captures the current open descriptor binding
and returns an invocation-owned observer. Missing or closed descriptors fail
with `EBADF`; malformed descriptor numbers fail with `RangeError`. The observer
does not reopen the pathname, follow a later replacement of the same descriptor
number, acquire read access, or create an additional pipe peer reference.
Its `readable` property describes access, not readiness.

`probeRead()` asynchronously returns an explicit pair:

- `readiness`: `ready`, `blocked`, or `unknown`.
- `timeout`: `honor`, `ignore`, or `unknown`.

Ready means a read attempt need not wait for readiness, not that the descriptor
is readable or that the attempt succeeds. In particular, readiness on a
write-only descriptor must not turn a subsequent read error into EOF. Unknown
readiness is neither ready nor EOF. Observation does not consume input, start
a producer pull, or replace the shared cursor's polling and provenance.

`waitRead({ timeoutMs, signal? })` accepts a positive finite timeout and returns
`ready`, `timeout`, or `unknown`. Invalid arguments reject before waiting. Zero
timeout is represented by `probeRead()`, not a consuming read or a timed wait.
The supplied signal is captured for that operation; cancelling one observation
does not close its descriptor or cancel unrelated output. Caller cancellation
and invocation lifetime continue to apply, with exact falsey reasons preserved.

Observation cleanup is registered before resource work begins. `release()`
idempotently closes observer admission, cancels and joins its admitted
cooperative observations, and releases only its observation resources. It does
not close the guest FD. New observer operations after release fail with `EBADF`;
releasing a readable borrow and releasing an observer remain separate operations.
Opaque host work is not forcibly interrupted.

Canonical regular-output observations use the same retained descriptor's
`stat()` and ignore read timeouts; pathname stat or reopen cannot establish that
resource's identity. Internal pipes require directional endpoint evidence:
buffered data or final writer closure makes the read end ready, while final
reader closure makes the write end ready for a read attempt. Read-end buffered
bytes do not establish write-end readiness. A duplicate peer FD keeps its end
open; an observation or operation lease does not. Unenrolled host/device output
remains unknown rather than receiving guessed readiness from its pathname or
generic file type. These capabilities do not activate an optional shell builtin.

Canonical descriptors may advertise `readObservation: true` with a callable
`probeRead`. The command and retained-output helpers capture that operation
with its original receiver and preserve their existing admission, serialization
and cleanup ownership. Missing advertised methods refuse acquisition; invalid
readiness results fail rather than becoming EOF. Observation performs no byte
read or write, advances no cursor, and grants no read access to a write-only FD.
The runtime uses the same retained identity for input and output observations,
including aliases. An advertised probe supplies readiness, not a timeout policy.
Canonical readable character inputs retain their independently captured stream
deadline policy; a write-only character binding without that input policy stays
unknown. Ordinary regular-input and managed-pipe policies remain unchanged.
Already-buffered input bytes remain readable without consulting the provider;
cached terminal EOF does not override an advertised provider observation.

### Readable cursor borrowing

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

## Evaluation exit and cleanup

A current-shell `exit` inside `evaluate` escapes as shell control flow rather
than returning an ordinary callback status. EXIT handlers run while the exiting
callback's local bindings remain visible. Frame-wide owned cleanup waits until
the enclosing extension execution and evaluation have unwound, so cleanup may
join the operation that registered it without creating a self-wait cycle.

The cached exit status does not skip the final owned drain. EXIT-handler failures
remain available for aggregation with cleanup failures, including falsey failure
values; root cancellation retains its existing precedence. Public execution still
awaits owned cleanup. A subshell's exit and drain belong to that child frame and
do not terminate its enclosing evaluator.

## Function diagnostic origins

Function diagnostics use the source identity and effective line base captured
when the function is defined. An evaluator's later call site must not rename or
rebase an existing function. Command-text, stdin and file/source entry modes
establish that definition context independently from their top-level diagnostic
labels; a filename that happens to equal a shell label is still a filename.
Command substitution also accounts for Bash's reprinted command layout; physical
input line numbers alone do not determine the resulting function diagnostics.

Invocation keeps the caller's descriptors, cancellation, budgets and control
scope. Returning from the function restores the caller's diagnostic context.
This provenance rule does not establish additional debugger variables or full
function-stack introspection.

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
This captured input policy is independent of optional provider observation.
Other unclassified sources remain unknown; explicitly supplied stream policies
and managed-pipe evidence remain distinct.
Legacy routing is selected before acquisition when canonical open is declared
unsupported, or is absent without affirmative support. An attempted canonical
acquisition failure never becomes a legacy read, even when it reports `ENOTSUP`;
affirmative support with a missing method also refuses. Legacy provenance
remains unknown. Queued reads observe established EOF consistently.

Canonical regular-file sources select captured `eof: "retryable"` behavior.
EOF ends the current serialized operation without closing its descriptor. The
next operation may read appended data through that same descriptor and offset;
it does not reopen the pathname. Explicit owner/cursor close still drains the
descriptor after EOF. Established EOF may still be reported by readiness until
the next consuming operation. Ordinary sources default to terminal EOF, and
retryable EOF is rejected unless regular provenance is supplied. Borrowers
cannot replace this captured policy.

Canonical nonregular input retains terminal byte EOF without retiring its
still-bound descriptor. Its byte buffer may be released at EOF; later
observations use the same retained resource until owning redirection cleanup.
Prepared-input options carry that borrowed descriptor identity through cursor
views, without reopening it or creating another close owner. Releasing an
observer or a readable borrow does not close the owning descriptor.

`createBytePipe().readiness()` is a detachable, nonconsuming poll for buffered
bytes, drained EOF or blocked input. Empty writes do not make the pipe ready,
and failed pipes throw their original failure reason. Input-source construction
must explicitly thread these owned capabilities into the shared cursor; these
helpers do not infer capabilities for arbitrary host iterables.

Managed pipes additionally expose optional `endpoints.read` and `endpoints.write`
capabilities. `acquire()` creates a distinct peer FD reference; `close()` retires
that reference idempotently. The final writer closure exposes EOF after queued
bytes drain. The final reader closure rejects pending or subsequent writes with
EPIPE and signals consumer closure, but does not by itself cancel an upstream
command or its unrelated named-file output. A later failed pipe write is a
separate delivery failure. Runtime descriptor frames retain and retire references
across duplication, moves, redirection restoration and child invocations.

Endpoint `probe()` returns a revision and directional readiness/peer-closure
snapshot. `waitForChange(revision, { timeoutMs, signal? })` observes revision
changes without pulling bytes or acquiring another peer reference. Its timeout
is an integer from zero through 2147483647 milliseconds; timeout returns
`undefined`, not EOF. Stale revisions return the current snapshot immediately;
invalid or future revisions are refused. At most 64 endpoint observation waits
may be pending per pipe. Higher-level descriptor waits retain one monotonic
deadline across notifications and bounded timer intervals.

An iterator borrowed from `endpoints.read.readable` shares the pipe cursor but
does not keep the peer FD open. Returning or throwing from that iterator cancels
only that operation lease. In contrast, the legacy `pipe.readable` iterator keeps
its whole-pipe abort behavior when explicitly terminated. Legacy `pipe.abort()`
and `pipe.abort(undefined)` retain the default EPIPE reason. Explicit
`[outputFailure](reason)` hooks and legacy iterator `throw(reason)` preserve the
actual failure value, including `undefined`; operation-lease cancellation must
not be routed through those whole-pipe failure channels.

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
