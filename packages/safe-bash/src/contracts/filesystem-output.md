# Filesystem output lifecycle

`openFileOutput` is the internal filesystem output operation shared by shell
redirection, `tee`, curl body files and curl header files. It builds on
`createOutputOperation`: cleanup is registered before filesystem acquisition,
completion closes the byte stream, and abort cancels the operation and joins its
writer and admitted writes. It is not a separate invocation lifecycle.

## Selection and preflight

- Resolve `fs.capabilitiesFor(path)` when supplied; otherwise use the filesystem's
  aggregate capabilities. A mount's unrelated read-only paths do not determine
  whether a writable target can be opened.
- Reject known read-only destinations before writing. Probe existing-target write
  access where available. `ENOENT` permits creation; `ENOTSUP` means that this
  optional policy probe cannot establish permission. Other probe failures remain
  errors. The selected filesystem writer still owns authoritative authorization.
- Prefer `writeStream(path, source, { flag, signal })` unless streaming writes are
  explicitly disabled. For append, `streamingAppend: false` disables that mode;
  `append: false` alone does not disable streaming append.
- `write: false` disables ordinary overwrite, not streaming overwrite. Fallback
  checks ordinary write and incremental append capabilities before creating or
  truncating the target. No helper-side complete-file buffering substitutes for
  an unsupported operation.
- A typed `ENOTSUP` may select incremental fallback only before the streaming
  writer requests its first source item. Merely obtaining an iterator does not
  consume it. Once reading has started, failures never replay source prefixes or
  switch output implementations. Other errors never select fallback.

The incremental fallback opens the requested mode and appends output fragments.
Append initialization uses `appendFile(empty)`, including the random-update
redirection profile: an append-only filesystem need not implement `writeFile(a)`.
Overwrite initialization continues to use `writeFile(empty, { flag: "w" })`.
Like other incremental filesystem operations, its already completed effects are
not rolled back if later work fails.

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
unused reservation. Failure, cancellation or an invalid/unknown count retains the
full conservative charge. A partial-write retry is a new admission; the helper
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
