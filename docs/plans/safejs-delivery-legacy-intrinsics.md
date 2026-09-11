# Legacy snapshot assertions for delivered intrinsics

The cancelled superseded release 34617544968 retained two concrete failures:
compile-policy and Math.f16round legacy checkpoint tests omitted WeakMap,
WeakSet, WeakRef, FinalizationRegistry and Temporal from their explicit current
intrinsic expectations. The runtime already provides these globals.

Validate and include the existing local test corrections: enumerate WeakMap and
WeakSet descriptors and name WeakRef, FinalizationRegistry and Temporal as added
globals. Keep legacy source hashes, checkpoint captures, graph identity, replay
and metadata checks intact. Run both complete focused files before delivery.
