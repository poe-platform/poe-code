# Weak snapshot integration

## Scope

Integrate the shared reachability indexing, heap representation and restoration
for WeakMap, WeakSet, WeakRef and FinalizationRegistry. Public constructors and
runtime storage are already committed. This change must not turn weak edges
into strong roots, including back-reference cycles and chained weak-map entries.
Finalization held values and callbacks remain strong; targets and unregister
tokens do not. Restoration requires a live execution owner for finalization.

The pending implementation records only reachable weak targets after collecting
strong roots and processing newly reachable weak-map values to a fixed point.
Heap capture uses those selected edges rather than independently walking weak
targets again. Restoration reconstructs identity before filling references and
defers finalization callbacks until heap validation and reconciliation succeed.

## Current validation

Original snapshot failures and the earlier implementation history are in
safejs-weak-collections.md and the weak-reference plans. During current review,
two real-snapshot regressions reproduced a node-validator inconsistency:
WeakMap and WeakSet accepted internal Promise aggregate records as keys
(4afe8c). The whole-snapshot guard already rejects these references; no new
host escape is claimed.

The key validator now reuses the existing weak-target object/symbol admission
checks, rejects absent keys, and removes duplicated registered-symbol scanning.
Both internal aggregate kinds are tested, with ordinary-key validation and
whole-restore controls. Five focused files pass all 63 tests (4388de).
TypeScript passes (ae177c); focused ESLint passes (02e62c).

Full snapshot session 64936 finished successfully: 2,082 tests across 153 files
passed in 107.48 seconds (9e20c8). Source and tests remained unchanged during
the run. Node 18.20.8 passed all 42 tests across the four weak snapshot files
(553366), including unique-symbol cases. A native probe confirms this exact
runtime accepts symbol WeakRef targets (05ab14); do not generalize the older
Node 18.18 limitation to every Node 18 release.

The cached Node 18.18.2 runtime still rejects a native unique-symbol WeakRef
target with `WeakRef: target must be an object` (6783b6). Its compatibility gap
remains open; neither the Node version floor nor weak-symbol semantics changes
in this snapshot integration.

A read-only fault-injection probe caused compilation disposal to throw during
restore, but did not observe an escaped guest cleanup callback (048d79).
That probe does not establish a callback-ordering defect, so no speculative
ordering fix was made.

The last full package gate still has ten failures. No push, release or complete
JavaScript support is claimed. Preserve unrelated staged SafeBash edits.
