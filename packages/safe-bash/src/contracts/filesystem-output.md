# Filesystem Output Lifecycle Specification

Status: Accepted

Implemented Through: be2436635736abda76b9f3543622feb1a01d7065

Purpose: Preserve filesystem output ownership, visibility and shared Shell byte
admission across streaming outputs and assembled direct text-program writes.

The existing streaming/redirection behavior was inspected at the recorded
baseline. The direct-write extension below is accepted but not yet implemented
at that baseline; its conformance must be established before advancing this
record.

## Normative language

`MUST`, `MUST NOT` and `MAY` identify required, prohibited and permitted behavior.

## Problem Statement, Goals and Non-Goals

File output must preserve its adapter's lifecycle and visibility while sharing
the enclosing Shell's cumulative output accounting. Per-buffer limits and host
storage quotas are independent: neither bounds cumulative repeated writes.
This contract does not promise a transaction across files, rollback of completed
incremental writes, total memory bounds or preemption of arbitrary host work.

## System boundary

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

## Direct text-program writes: accepted extension

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
