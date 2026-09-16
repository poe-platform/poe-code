# Filesystem Output Lifecycle Specification

Status: Implemented

Implemented Through: 35679576d17e019989dde12b985d42a6ac2b63c5

Purpose: Preserve filesystem output ownership, visibility and shared Shell byte
admission across streaming outputs and assembled direct text-program writes.

The recorded implementation includes the direct-write extension and preserves
the existing streaming/redirection behavior, verified by the focused contract,
command and built public-export checks recorded in the corresponding issue plan.

## Normative language

`MUST`, `MUST NOT` and `MAY` identify required, prohibited and permitted behavior.

## Problem Statement, Goals and Non-Goals

File output must preserve its adapter's lifecycle and visibility. By default it
shares the enclosing Shell's cumulative output accounting; network downloads use
their independent transfer limits as specified below. Per-buffer limits and host
storage quotas are independent: neither bounds cumulative repeated writes.
This contract does not promise a transaction across files, rollback of completed
incremental writes, total memory bounds or preemption of arbitrary host work.

## System boundary

`openFileOutput` is the internal filesystem output operation shared by shell
redirection, `tee`, curl body files and curl header files. Its legacy streaming
path builds on `createOutputOperation`: cleanup is registered before filesystem acquisition,
completion closes the byte stream, and abort cancels the operation and joins its
writer and admitted writes. It is not a separate invocation lifecycle.

## Legacy selection and preflight

- Resolve `fs.capabilitiesFor(path)` when supplied; otherwise use the filesystem's
  aggregate capabilities. A mount's unrelated read-only paths do not determine
  whether a writable target can be opened.
- Reject known read-only destinations before writing. Probe existing-target write
  access for ordinary overwrite/append where available. `ENOENT` permits creation; `ENOTSUP` means that this
  optional policy probe cannot establish permission. Other probe failures remain
  errors. The selected filesystem writer still owns authoritative authorization.
- Without a supplied descriptor fallback, prefer
  `writeStream(path, source, { flag, signal, mode? })` unless streaming writes are
  explicitly disabled. With that fallback, prefer the stream only when the
  effective capabilities positively advertise `descriptorWriteStream: true`.
  Missing/false descriptor admission retains the supplied fallback. The stream
  method must still be present. For append, `streamingAppend: false` disables
  that mode; `append: false` alone does not disable streaming append.
- `write: false` disables ordinary overwrite, not streaming overwrite. Fallback
  checks ordinary write and incremental append capabilities before creating or
  truncating the target. No helper-side complete-file buffering substitutes for
  an unsupported operation.
- For ordinary overwrite/append, a typed `ENOTSUP` may select incremental fallback only before the streaming
  writer requests its first source item. Merely obtaining an iterator does not
  consume it. Once reading has started, failures never replay source prefixes or
  switch output implementations. Other errors never select fallback.

The incremental fallback opens the requested mode and appends output fragments.
Append initialization uses `appendFile(empty)`, including the random-update
redirection profile: an append-only filesystem need not implement `writeFile(a)`.
Overwrite initialization continues to use `writeFile(empty, { flag: "w" })`.
Like other incremental filesystem operations, its already completed effects are
not rolled back if later work fails.

### Exclusive creation and initial mode

The existing `openFileOutput(context, path, "w" | "a", incremental?)` calls remain
compatible. The third argument additionally accepts `FileOutputOpenOptions`:

```ts
interface FileOutputOpenOptions {
  readonly flag: "w" | "a" | "wx";
  readonly mode?: number;
  readonly descriptor?: boolean;
}
```

For example, `openFileOutput(context, path, { flag: "wx", mode: 0o600 })` forwards
exclusive creation and initial mode to the selected streaming provider. Mode is
a creation request, not a later chmod or a promise beyond that provider's mode,
permission and umask semantics. Ordinary object-form overwrite/append also forwards
mode to the streaming writer or built-in incremental initialization and appends.
The request is snapshotted before asynchronous acquisition; later caller mutation
does not change the selected flag or mode. Exclusive append (`ax`) is not added.

Exclusive creation requires affirmative path-specific `exclusiveCreate: true`
and available streaming writes. Known unsupported/read-only paths are refused
before writer admission. A `wx` open does not probe write access to an existing
target: authoritative exclusive creation must reject collisions, not overwrite
them or require permission to modify that existing file. The provider owns the
atomic creation decision; no helper-side stat-then-create approximation is used.

Exclusive output never falls back, even if the streaming provider rejects with
ENOTSUP before consuming input. In particular, this helper never substitutes an
empty exclusive creation followed by pathname appends. Existing incremental
callbacks cannot receive creation options, so supplying one with `wx` or an
explicit mode is refused before invoking it. Legacy mode-free callbacks remain
unchanged. Unsupported exclusive streaming is not a reason to require canonical
descriptors: buffered-only command implementations may preserve a single bounded
`writeFile(wx)` operation with counted admission and their own registered/drained
writer ownership. That leaf fallback is not implemented by `openFileOutput`.

The existing shared sink budget, backpressure and cleanup lifecycle also apply
to exclusive streams. Providers, including quota wrappers, retain their own
publication, identity and rollback limitations; delegation does not upgrade those
guarantees. `tests/contracts/filesystem-output.test.ts` covers mode forwarding,
collision preservation, missing capabilities/streaming, no exclusive downgrade,
incremental refusal, path-local admission, quota and falsey cancellation cleanup.

### Explicit retained-descriptor output

`descriptor: true` selects a canonical `openCommandFile` resource instead of the
streaming/incremental route. Omission or false leaves that route unchanged; a
nonboolean descriptor option is rejected. Explicit descriptor output never
falls back after failure and does not call an incremental callback. It requires
the path's canonical open capability, rejects known read-only or unsupported
write/append destinations, and requires affirmative exclusive creation for `wx`.
Flags and mode are captured before asynchronous acquisition. Write-only access,
creation, truncation and append are delegated to the canonical open operation.

The returned `FileOutput.descriptor` is an admission-gated view over that same
open resource. It shares the provider's actual capability metadata, retained
identity, cursor position and close ownership; it does not reopen the pathname
or infer descriptor identity from a stat result. Renaming the pathname therefore
does not redirect subsequent writes or recreate the old pathname. This does not
upgrade providers lacking retained-object semantics or add a namespace lease.

Finish, registered cleanup and descriptor close stop new sink and descriptor
admission immediately. Already-admitted sink writes retain their access while
draining; closing their public admission does not cancel those continuations.
Partial writes retry the remaining bytes, with fragments no larger than 64 KiB;
nonempty zero progress fails. The canonical resource closes once after admitted
work drains. Abort additionally cancels the output operation. Root cancellation,
owner failure and forwarded operation cancellation retain their precedence and
exact reasons, including false, zero, empty string and null. Each method captures
its forwarded signal once before queueing. Operation cancellation does not cancel
other admitted sink work. Cooperative acquisition and cleanup remain enrolled
before resources are acquired; this does not promise to preempt an opaque host.

Descriptor writes use the same counted output budget as standard output and
other named output. They are not additionally wrapped in the legacy sink budget.
Accepted partial counts refund only the unused admitted bytes; invalid counts or
unknown failures retain conservative charges. The budget binding is shared via
the internal `filesystem-output-budget` module, not a second ledger.

The optional `FileOutputContext.cleanupFailurePrioritySignal` distinguishes
caller cancellation during cleanup from operation cancellation or normal
invocation admission closure. It is captured before acquisition and does not
replace the operation signal passed to providers. When supplied, that signal
controls cleanup cancellation precedence; omission retains the context signal.
Unacknowledged canonical close failures remain errors unless caller cancellation
or an escaping primary operation failure has precedence. A mapped close failure
can be acknowledged through the same resource's descriptor after its outcome
is handled, preventing that acknowledged failure from escaping again during
registered cleanup. Diagnostic outcomes require successful diagnostic delivery;
the silent EPIPE mapping instead retains status 141. This is explicit caller
provenance, not classification by
an exception's text or by comparing unrelated cancellation reasons.

Shell redirections select this API as described below. It does not implement
pipe endpoint aliases, write-end readiness, or extended-read descriptor semantics.

Coverage includes `tests/contracts/filesystem-output-descriptor.test.ts`,
`tests/contracts/retained-output-review.test.ts`,
`tests/commands/retained-output-descriptor.test.ts`, and the compiled consumer
`tests/plugins/retained-output-api-runtime.test.ts`.
Runtime coverage additionally includes `tests/shell/extensions/core/retained-output-runtime.test.ts`,
`tests/shell/extensions/core/retained-output-runtime-review.test.ts`, and the
compiled consumer `tests/plugins/retained-output-runtime.test.ts`.

## Streaming backpressure, cancellation and budgets

Concurrent writes to one output operation are serialized in invocation order.
Each active write is split into fragments of at most 64 KiB and waits until the
adapter advances past the fragment. This prevents premature acknowledgement and
unbounded producer read-ahead. Callers retain ownership of submitted buffers until
their awaited write completes; mutation while a write is pending is unsupported.

By default the helper uses the enclosing shell's output accounting and
cancellation, not a fresh byte/time allowance. Shell redirections, `tee` file
copies, pipeline writes and standard output each charge their actual destination.
Direct command hosts that do not supply shell accounting remain responsible for
their own host limits.

An internal caller with independent byte admission may select
`FileOutputContext.outputBudget: "independent"`. This skips only the shell output
byte charge, not cancellation, filesystem quotas, backpressure or cleanup. Curl
body files (`-o`, `-O`) and header files (`-D`), including the shared wget transfer
path, use this mode. Network `maxDownloadBytes` and `maxHeaderBytes` continue to
bound their respective data. They therefore work when the file exceeds
`ShellLimits.maxOutputBytes`, even when that limit is zero and no terminal bytes
are emitted. Stdout (`-o -`, `-D -`), stderr, write-out text, pipelines and shell
redirections remain subject to `maxOutputBytes`. This does not exempt other
commands' file writes or introduce a new storage quota.

Writer failure closes the file sink's owned output capability. An enrolled
producer can stop while waiting for its next input rather than waiting for a
subsequent write to discover the failure. Curl file consumption also observes the
file operation's signal. Cleanup joins admitted cooperative writers and network
response disposal; arbitrary uncooperative host work cannot be forcibly stopped.

`ByteSink[outputFailure]` carries a producer's stream failure through internal
wrappers, including pipeline and budget wrappers. Curl reports failed body
consumption through it even when converting the exception into an exit status.
This prevents a failed prefix from being finalized as successful EOF by a later
redirection or `tee`. A nonzero status alone is **not** a stream failure:
`false > file` still opens and truncates the file, and ordinary shell exit control
still completes its output. A writer error ignored by a command returning zero
still fails redirection completion. Existing nonzero command failure statuses,
such as curl's write-error status, are retained.

Successful completion and abort are distinct. Atomic streaming adapters may
publish only after complete EOF and preserve the prior destination on source
failure, cancellation, quota failure or output-budget exhaustion. The helper does
not promise that incremental adapters can undo published bytes. `tee` destinations
are independent operations, not a multi-file transaction: a failing target does
not roll back another successfully completed target.

## Retained command descriptors and counted output

`openCommandFile` in `filesystem-descriptor.ts` acquires an optional canonical
filesystem descriptor. Operations retain that acquired object across namespace
changes; they never reopen the pathname or emulate writes by reading and replacing
a file. Unsupported providers refuse acquisition. Access modes and advertised
positioning, truncation and synchronization capabilities remain authoritative;
memory synchronization does not imply durable storage.

Cleanup is registered before capability lookup and acquisition. Idempotent close
immediately refuses new operations, waits for acquisition and admitted cooperative
work, closes a late-arriving descriptor, and releases the retained reference.
Normal close drains admitted work rather than canceling it. Cancellation prevents
queued work from starting and is forwarded to active operations. Root cancellation
takes precedence; otherwise the original failure, including falsey thrown values,
is preserved over secondary cleanup failures. Opaque uncooperative host work cannot
be forcibly interrupted.

An internal owner may supply `cleanupFailurePrioritySignal` on the descriptor
context to select which cancellation outranks a registered teardown failure.
The signal is captured once; omission or explicit undefined preserves the
existing cancellation checks. When supplied, an unacknowledged teardown rejection
retains its exact reason unless that priority signal is aborted. Ordinary
operations and successful cleanup still observe their operational signals. This does not alter
close-failure acknowledgement, skip draining, or add a shell configuration option.

The returned `CommandFileDescriptor` additionally exposes
`acknowledgeCloseFailure(reason)`. A command may call this after handling a
settled close failure and mapping it to its command exit status. Diagnostic
outcomes require successful diagnostic delivery; silent EPIPE mapping to 141
does not require a diagnostic.
Only the exact recorded reason, compared with `Object.is`, can be acknowledged;
wrong or premature reasons return false. Repeating a successful acknowledgement
is idempotent. This does not turn `close()` into success: explicit repeated close
calls retain the original rejection. Registered cleanup still joins the same
acquisition/work/close barrier, but does not replay an acknowledged close failure.
Acknowledgement does not consume open or write failures, affect another
descriptor, undo effects, or suppress cancellation. A failed diagnostic must not
acknowledge the close failure. This command-wrapper operation does not extend the
underlying filesystem descriptor contract or authorize untrusted host code.

The command wrapper forwards optional retained-position queries only with both
`capabilities.position === true` and a backend `getPosition` method. Queries use
the same serialized operation, cancellation and cleanup path as other descriptor
operations, validate a nonnegative safe-integer result, and do not consume a
payload-byte output reservation. Missing support is not replaced by `stat().size`
or a guessed cursor.

`bindFileOutputBudget(context, sinkBudget, countedWrite)` binds both output forms
to the same runtime cleanup owner (`context.registerCleanup`), using one WeakMap.
`writeFileOutputCounted` returns a validated partial byte count rather than hiding
it behind a `ByteSink`. An enrolled owner with only a sink binding refuses counted
writes; writable `openCommandFile` acquisition checks this before creation or
truncation. Standard output already charged by its sink must not be charged again.
An unbound standalone context is explicitly trusted: its host owns output limits
and cleanup enrollment. This is neither a cross-runtime binding mechanism nor a
process-isolation boundary.

The runtime counted writer reserves the requested byte length in the same ledger
as stream and standard output before admitting the write. Only a successful safe
integer count from zero through the requested length permits one refund of the
unused reservation. Failure or an invalid/unknown count retains the full
conservative charge. The helper rejects cancellation before returning a count to
the runtime, so cancelled helper writes retain the full reservation. A direct
internal `Budget.writeCounted` callback that resolves with a valid count instead
settles that known count before checking cancellation; its operation still rejects
with the cancellation reason. A partial-write retry is a new admission; the helper
does not retry. Zero is a valid partial count, so a copying command must separately
reject nonempty zero-progress writes. Output accounting is not a logical-file-size
quota: positioning and truncation remain filesystem operations.

Callers must not mutate a borrowed buffer until the returned operation settles.
The counted callback can admit the underlying writer only once and cannot save it
for invocation after settlement. Even if that callback fails without awaiting an
already-started writer, the helper drains the writer before settling, preserving
buffer ownership and the primary failure. Descriptor close joins that work too.
These guarantees apply to canonical output selection; the legacy paths below
remain available when the provider does not affirm its canonical open capability.

Focused coverage lives in `tests/contracts/filesystem-descriptor.test.ts`, the
independent `tests/contracts/filesystem-descriptor-review.test.ts`, and
`tests/shell/counted-file-output.test.ts`.

## Redirection descriptors and visibility

Shell redirections resolve the target's capabilities and select canonical output
only when `open === true`. That selection never falls back after acquisition
failure. Independent canonical opens have independent positions; duplicated
output descriptors share their resource and position. Renaming or unlinking an
open target does not redirect later writes to a replacement pathname. Nested
truncation retains an outer handle's position, and append follows the provider's
canonical append contract. Legacy sequential-stream conflict bookkeeping does
not reject these independent canonical opens.

Canonical sinks are enrolled as counted output before command dispatch. Reusing
that same sink through builtins, interpreters or invocation forwarding does not
add another ordinary sink charge. Replacing a sink does not inherit that
enrollment. Finalization preserves an already nonzero command status, retains
root cancellation and escaping control failure precedence, and acknowledges only
close failures that the runtime has actually mapped.

Without affirmative canonical open, filesystems explicitly advertising
`randomAccessWrite: true` retain the existing
redirection offset implementation. Independent opens have independent offsets,
duplicates share their descriptor, nested truncation preserves an outer offset,
and reads can observe completed incremental writes. Without positive descriptor
stream admission this profile retains the existing budget-bounded byte image
used for offset emulation; it is not the generic sequential streaming path.

`descriptorWriteStream: true` permits the adapter's stream to implement that
descriptor directly, bypassing construction of the supplied incremental sink.
The adapter MUST preserve per-open positional overwrite cursors, append at the
current retained-resource EOF, resource pinning across rename/unlink, and
visibility/owned storage for completed chunks. The output helper adds no private
file image or per-chunk metadata probe on this path. Positively admitted streams
still share the same output budget, acknowledgement protocol and cleanup owner.
The capability does not override read-only/access policy, disabled streaming
modes, or the Shell's separate simultaneous-descriptor admission rules.

Stock Memory admits this capability only while its guarded implementation is
intact. Unsupported, unknown or explicitly masked wrapper capability results
must not be promoted by the Bash helper. Selected-path capabilities remain
authoritative; a global mount snapshot is not sufficient to override them.

Other legacy filesystems use one sequential stream per opened redirection. Duplicated
descriptors share that stream, including throughout a compound command. A second
simultaneous redirection to the same resolved shell path fails with `ENOTSUP`,
unless the provider explicitly advertises `independentWriteStreams`,
instead of inventing random-access semantics. This is not an alias-identity or
cross-process locking guarantee. An atomic adapter's new content becomes visible
at stream completion; reads during the operation can still see the original.

Append atomicity is adapter-specific. Incremental output commits fragments, not
whole commands; an echo's word and newline can be separate appends. An atomic
streaming append may commit the complete descriptor stream at once. Neither
profile implies a transaction across separate descriptors or commands.

## Direct text-program writes

Assembled awk named-file writes, sed script-output writes and sed in-place
replacement writes MUST use the same
enclosing Shell `maxOutputBytes` ledger as standard output and streaming file
destinations. Admission is cumulative across files, repeated overwrite/append
operations, close/reopen cycles and nested commands sharing an execution.
Starting another named-file destination MUST NOT create a fresh allowance.

Each submitted byte MUST be charged exactly once before its direct host write
is invoked. A write exceeding the remaining allowance MUST be rejected in full
before that host call; existing completed writes need not be rolled back.
Exactly fitting writes MUST remain admissible. Failed admitted host writes do
not refund the shared allowance, matching ordinary Shell output accounting.

The extension MUST preserve the direct write's existing flags, single-write
visibility, empty creation/truncation effects, evaluation/error ordering and
awk `close()` reopening semantics. It MUST NOT silently replace direct writes
with persistent buffered streams or count filesystem-internal rewrite traffic.
Zero bytes consume no allowance but do not erase the requested filesystem effect.

Cancellation MUST be checked before admission and MUST retain exact caller
reason identity, including falsey reasons. An already admitted direct host-write
promise MUST remain observed and awaited according to the direct-write path's
settlement behavior, even when an enclosing interruptible sink rejects earlier.
Completed writes MUST NOT leave a growing list of per-write cleanup callbacks.
No universal termination guarantee is made for an uncooperative host promise.

Direct command hosts without a Shell budget binding retain their existing
behavior and responsibility for limits; this extension introduces no additional
public option or implicit standalone allowance. Host filesystem quotas remain
an independent policy limiting stored size rather than cumulative write traffic.
Existing sed backup-copy operations retain their separate filesystem semantics
and backup-before-replacement ordering; this extension accounts assembled output
bytes, not every filesystem mutation or copy operation.

## Descriptor-stream validation evidence (#616)

On September 6, 2026 the current open issue was read through `gh` from
`poe-platform/poe-code`; its author is `kamilio`. The validated scope is the
per-chunk Memory EOF-stat/append path and Shell-side mirror traffic. The reported
85-times heap amplification, fatal OOM and inferred remote-provider impact are
not established by these controls. S3/WebDAV's `randomAccessWrite: false` profile
does not select the affected Shell EOF-probe path; generic sequential-stream
controls remain separate from live provider measurements.

The Bash production change is restricted to positive descriptor-stream selection
in `openFileOutput`. It does not edit Runtime, change fallback implementation,
batch acknowledged output, replay consumed prefixes, or add task subscriptions.
The complementary capability, Memory and wrapper implementation belongs to the
SafeFS owner and the root-owned integration/build process.

`tests/contracts/filesystem-output-descriptor-stream.test.ts` supplies tiny,
deterministic mock and genuine source-Memory controls. Memory public operations
are observed through a faithful bound-method proxy; stock method guards are not
disabled or bypassed. The source import lets the focused controls use the
parallel SafeFS implementation without rebuilding shared bundles. This is not
public-package or combined-build qualification.

- Fresh RED before changing Bash selection: 28 tests, 5 pass / 23 fail, no
  skipped/cancelled cases, 252.280709 ms. Positive-cap mocks independently expose
  the ignored descriptor admission; Memory controls also depend on the SafeFS
  implementation. After both source changes, the first cohort passed 28/28.
- Expanded descriptor controls plus unchanged filesystem-output and #613
  task-reaction controls: 101/101 pass, no skipped/cancelled cases,
  594.864222 ms, normal `node:test` child isolation on Node 22.22.0.
- Equal 32-byte Shell payloads, using 32 one-byte writes: forced legacy admission
  made 32 stat, 32 appendFile and one writeFile call; admitted descriptors made
  zero of those calls and one writeStream call. Observed copied bytes fell from
  176 to 64.
- The same payload using four eight-byte writes: legacy made four stat, four
  appendFile and one writeFile call; descriptors again made zero of those calls
  and one writeStream call. Observed copied bytes fell from 180 to 64.

Copy observations count instrumented Uint8Array constructor/set/slice traffic
within the tiny Shell executions, not heap, retained backing-store size, RSS,
provider billing, or a general amplification factor. Producer buffers are reused
only after awaited acknowledgements. Other controls cover external append,
truncate and rename, duplicate/nested descriptor offsets, per-path admission,
disabled/unknown capabilities, pre-read ENOTSUP fallback, no replay after reading,
falsey failures/cancellation, held writer cleanup, downstream consumer closure,
and one startup writer-task subscription with no per-chunk reactions.

No OOM experiment, live benchmark, host product subprocess, remote-provider test,
shared build, Git mutation, registry edit or lint/full guard was run by the Bash
owner. Root owns literal test registration, the readonly capability fixture
update, combined qualification and delivery. SafeFS's owner maintains
`docs/plans/bugfix-616-descriptor-write-stream.md` with the combined evidence.

## Test and validation matrix

The focused command matrix in `tests/commands/filesystem-output.test.ts` exercises
`>`, `>>`, `tee`, `tee -a`, and `curl -o`, plus header files where applicable:
split UTF-8, binary and empty content; read-only and unsupported modes; fallback
before reading and refusal after reading; writer and commit failures; abort,
quota, global byte/time budgets; pending producers; multiple destinations;
downstream close; and descriptor reuse/conflicts. Stream-only adapters and
streaming append without incremental append are included.
Append-only adapters are tested with both redirection profiles, new/empty/existing
targets, and empty/nonempty input while `writeFile` always rejects.

`tests/contracts/filesystem-output.test.ts` checks bounded backpressure,
concurrent writes, cleanup joining, unsupported access probes, and exact falsey
failure identity before and after consumption. Existing mounted-network and
shell lifecycle tests retain independent/interleaved descriptor offset coverage.
These are local unit/contract checks, not a claim of a deployed Worker or remote
service qualification.

The direct-write extension additionally requires:

| Requirement | Required evidence |
| --- | --- |
| Shared admission | Exact and over-limit awk/sed named writes, mixed stdout/files, multiple destinations and nested invocation. |
| Pre-write ordering | Over-limit bytes cause no rejected host call; failed admitted writes retain their charge. |
| Compatibility | Original flags and byte content, overwrite/append/reopen, empty effects and complete-write visibility. |
| Cancellation | Exact falsey reasons, no new work after cancellation and settlement of already admitted host promises. |
| Host boundary | Unbound direct hosts retain existing behavior; stored-byte quotas remain independent. |

## Conformance criteria

All direct-write requirements and their validation matrix MUST pass before that
extension is marked implemented. Streaming/redirection regression coverage MUST
remain green; direct-write adoption must not add charges to existing output
paths or change their adapter-specific publication behavior.
