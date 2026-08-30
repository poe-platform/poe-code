# S54 author source adjudication — 2026-08-28

Original source `58be2d6c5706f3e90f01d48e695ecfd9daa52669`, original
author evidence `767b6729d3acac0dd17c42dfb9e0b93e6e9c4de5`, independent
diagnosis `915aee08` remain immutable. The independent S54 entries were
STATIC_NONCONFORMANCE before invocation, not dynamic cancellation/memory results.
S62/S64/S71/S74 are separately adjudicated fixture deltas; none is repaired here.

The approved profile specifies precharged work and a cooperative checkpoint
every 4096 units. Original `Work.step(8197)` followed by
`new Uint8Array(bytes)` then `checkpoint()` does not meet that cadence.
`nextYield = units + 4096` also discards overshoot. This is a genuine private
work/copy implementation defect, not missing byte caps or an RSS requirement.

## Narrow repair

- Preserve all numerical maxima, factories, error mapping, diagnostic bytes,
  grammar, initial target/content preflight, permission/identity rules and IO
  ownership. No Shell, public root, default registration or shared Budget edits.
- Advance checkpoint thresholds in exact 4096-unit intervals. Bulk precharges
  cross each interval with an awaited interruptible immediate; per-unit scans
  check at the boundary, including surrogate pairs and path scanning.
- Admit the complete owned-copy cost before allocating its bounded destination;
  copy in slices no larger than the current interval remainder. Retained stdin
  bytes are still owned before the producer advances/finalizes.
- Staging admits its exact planned encoding work before its result allocation.
  Encode at most 1024 UTF-16 units per native call, never splitting a valid
  surrogate pair; UTF-8 validation and output-copy work are separately charged.
  No whole-line temporary Buffer. Decode at most 2048 bytes per native call;
  preserve the original all-input NUL check before UTF-8 decoding.
- Explicit line slicing, final text consolidation and success-summary creation
  are charged before their bounded native string operations. Those operations
  remain cooperative **between** native calls, not preemptible inside them.

No allocation/RSS peak is claimed. A byte-admitted destination allocation can
still zero-initialize up to maxFileBytes (8 MiB); patch consolidation is at most
4 MiB. Native string slices/joins remain bounded by admitted input/output caps,
not magically interruptible. Re-accounting previously uncharged copies can make
maxWork refuse sooner; no refund, larger cap, deadline or global counter is added.
The 128-Mi work allowance is independent of the other maxima.

## Versioned evidence required

Before execution, seal exact source blobs and executor recipes. Run the unchanged
63 author cases plus a small S54-focused suite in source-build, offline installed
and physically moved full packages. Separate unmodified runtime cancellation
observations from private Work/prototype and allocator instrumentation. Instrumented
observations are not unmodified-runtime or OS scheduling/RSS proof. Loaded mutants
must fail their named predicates and restored bytes must pass. Preserve every
attempt, all original static rows and initial failures. Different review remains
required; no author self-acceptance or whole-product claim.
