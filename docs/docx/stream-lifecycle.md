# Document stream lifecycle

The bounded package primitive `DocumentIo` accepts an explicit `ArchiveContext`
with limits, a borrowed signal, an optional shared `DocumentBudget`, and an
optional `registerCleanup(cleanup)` callback. It does not read paths, environment,
process state, network resources, or native compression facilities.

## Typed boundary

- `new DocumentIo(context: DocumentIoContext)` synchronously registers cleanup
  before any source or sink acquisition.
- `read(source: DocumentByteSource): Promise<AdmittedDocumentArchive>` admits a
  document through the existing package reader. `source.open(signal)` returns an
  `AsyncIterable<Uint8Array>`. Source opening is synchronous; byte acquisition,
  iterator finalization and package admission are awaited.
- `write(archive: DocumentArchive, sink: ArchiveSink, options:
  ArchiveWriteOptions): Promise<void>` uses the existing validating writer.
  `sink.write(bytes, signal)` is always awaited before another chunk is written.
- `cleanup(): Promise<void>` closes admission, aborts only the scope's owned
  signal and returns the same completion promise on repeated/reentrant calls.
  Completion drains all admitted cooperative work, including iterator cleanup.

Use `try/finally` and `await io.cleanup()` even when a host supplies the cleanup
registration hook. Multiple operations can share a scope and budget; operation
failure does not close sibling scopes or mutate any borrowed controller.

The source must cooperate with its supplied signal. The primitive awaits owned
source `next`/`return` and sink promises; it cannot force arbitrary host code to
stop. It observes both promise outcomes even when a caller abandons a returned
promise. An iterator that terminates normally owns its normal finalization;
early termination calls and awaits `return` if present. A source failure is
preserved when its finalizer also rejects.

Each nonempty source fragment is copied before the producer is advanced or
finalized, including views into reused buffers. The invocation reserves twice
the fragment bytes (owned fragment plus contiguous admission input), plus 64
accounting bytes per retained fragment, before copying. Empty chunks consume
work without adding retained arrays. Each fragment consumes its byte length plus
one work unit and participates in the existing cooperative checkpoint schedule.
The archive reader separately accounts parser/decoded storage. These conservative
reservations are finite accounting, not a measurement of JavaScript heap/RSS.
The writer snapshots payloads before its first suspension. A sink may retain its
received owned chunk; sink completion supplies backpressure.

Borrowed invocation/budget cancellation produces `CancellationError` with
`code: "cancelled"` and the borrowed signal's reason as `cause`. It takes
precedence over escaping resource failure. An ordinary sink failure produces
`SinkError` (`sink-failure`) with the original failure as cause, including when
scope-local cleanup has started. Typed cancellation remains cancellation.
Source errors propagate; invalid chunks reject as `InputTypeError`; limits reject
as `ResourceLimitError`. No provenance decision compares reason values.

## Shell adapter boundary

The internal adapter under `packages/safe-bash/src/commands/docx/io.ts` supplies
`documentByteSource(source)` and `documentByteSink(sink)` using the existing
`readBytes`/`writeBytes` contracts with the supplied signal. It acquires nothing
while constructing these capabilities. `createDocumentOutput(context, sink)`
registers an output scope before acquisition and returns `{ sink, cleanup }`.
Call its cleanup in `finally`, including for direct contexts without hooks.

A destination's optional `ownedOutput` enrolls cooperative output work in the
existing output-operation scope. Closing that scope drains enrolled writes and
prevents new writes, without cancelling another destination or the invocation.
A wrapped borrowed stream is not implicitly enrolled: the existing byte helpers
race cancellation and observe opaque late rejections, and aborted source
finalization can continue outside that borrowed helper's settlement. Wrapping
such a stream does not invent an ownership or preemption guarantee.

## Mapping and remaining work

This implements byte ownership, async I/O and scoped cancellation infrastructure
for the shared SDK contract. The acquisition spelling `open(signal)` follows the
planned byte capability mapping. This primitive requires explicit limits/signal;
it is not the future model factory's optional-context/default API.

The documented model factory, `save`, inherited members, enum/collection/helper
coverage, image admission and safe XML/package views retain their existing
planned dispositions in the API register. No row is marked implemented merely
because its byte transport foundation now exists. D09's byte-stream correction
continues to apply: text streams and ambient path/network acquisition are not
admitted. Existing neutral method spellings and documentation-error mappings are
unchanged.

File publication (exclusive/conditional writes and aliases), public command
registration, plural resources, selectors, schema/capabilities and paired CLI/SDK
operation acceptance remain later ordered tasks. These helpers introduce no
public CLI output or alternate editing engine and no atomic-file-write promise.
No renderer, corpus, packed-consumer or whole-public-API result is claimed here.
