# Filesystem output lifecycle

`openFileOutput` is the internal filesystem output operation shared by shell
redirection, `tee`, curl body files and curl header files. Its legacy streaming
path builds on `createOutputOperation`: cleanup is registered before filesystem acquisition,
completion closes the byte stream, and abort cancels the operation and joins its
writer and admitted writes. It is not a separate invocation lifecycle.

## Selection and preflight

- Resolve `fs.capabilitiesFor(path)` when supplied; otherwise use the filesystem's
  aggregate capabilities. A mount's unrelated read-only paths do not determine
  whether a writable target can be opened.
- Reject known read-only destinations before writing. Probe existing-target write
  access for ordinary overwrite/append where available. `ENOENT` permits creation; `ENOTSUP` means that this
  optional policy probe cannot establish permission. Other probe failures remain
  errors. The selected filesystem writer still owns authoritative authorization.
- Prefer `writeStream(path, source, { flag, signal, mode? })` unless streaming writes are
  explicitly disabled. For append, `streamingAppend: false` disables that mode;
  `append: false` alone does not disable streaming append.
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

This explicit API does not yet migrate shell redirection selection. The legacy
redirection behavior below remains in effect until its separate runtime
integration. It also does not implement pipe endpoint aliases, write-end
readiness, or extended-read descriptor semantics.

Coverage includes `tests/contracts/filesystem-output-descriptor.test.ts`,
`tests/contracts/retained-output-review.test.ts`,
`tests/commands/retained-output-descriptor.test.ts`, and the compiled consumer
`tests/plugins/retained-output-api-runtime.test.ts`.

## Backpressure, cancellation and budgets

Concurrent writes to one output operation are serialized in invocation order.
Each active write is split into fragments of at most 64 KiB and waits until the
adapter advances past the fragment. This prevents premature acknowledgement and
unbounded producer read-ahead. Callers retain ownership of submitted buffers until
their awaited write completes; mutation while a write is pending is unsupported.

The helper uses the enclosing shell's output accounting and cancellation, not a
fresh byte/time allowance. Files, pipeline writes and standard output each charge
their actual destination. In particular, `tee` file copies and curl header files
are not outside the global budget. Direct command hosts that do not supply shell
accounting remain responsible for their own host limits.

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
`acknowledgeCloseFailure(reason)`. A command may call this after successfully
diagnosing a settled close failure and mapping it to its command exit status.
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
These guarantees do not automatically migrate the legacy shell redirection
implementation described below to canonical descriptors.

Focused coverage lives in `tests/contracts/filesystem-descriptor.test.ts`, the
independent `tests/contracts/filesystem-descriptor-review.test.ts`, and
`tests/shell/counted-file-output.test.ts`.

## Redirection descriptors and visibility

Filesystems explicitly advertising `randomAccessWrite: true` retain the existing
redirection offset implementation. Independent opens have independent offsets,
duplicates share their descriptor, nested truncation preserves an outer offset,
and reads can observe completed incremental writes. This profile retains the
existing budget-bounded byte image used for offset emulation; it is not the
generic sequential streaming path.

Other filesystems use one sequential stream per opened redirection. Duplicated
descriptors share that stream, including throughout a compound command. A second
simultaneous redirection to the same resolved shell path fails with `ENOTSUP`
instead of inventing random-access semantics. This is not an alias-identity or
cross-process locking guarantee. An atomic adapter's new content becomes visible
at stream completion; reads during the operation can still see the original.

Append atomicity is adapter-specific. Incremental output commits fragments, not
whole commands; an echo's word and newline can be separate appends. An atomic
streaming append may commit the complete descriptor stream at once. Neither
profile implies a transaction across separate descriptors or commands.

## Regression coverage

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
