# Weak private-state graph clone rejection

## Validated boundary

The working-tree graph serializer contains six uncommitted guard lines for
private weak maps, weak sets, weak references and finalization registries.
Low-level SDK clone guards were committed separately; this is the generator
used by interpreter structured serialization.

A read-only in-memory probe transpiles the HEAD values module with imports and
re-exports resolved to the current dependencies. All four private weak-state
kinds are accepted as empty objects by that unguarded serializer (6f569b).
This directly validates the loss of internal state; it does not rely on public
WeakRef/FinalizationRegistry wiring, GC scheduling or invented issue reports.
The first probe failed to resolve relative re-exports (3e6ef1); that import
failure supplied no behavior evidence. The corrected probe handles both forms.

## Reconciliation and coverage

Commit the existing guards with new direct generator regressions. Each weak
kind is tested bare, nested in a record and nested in an array, both without
properties and with an accessor. Calling next must throw DataCloneError rather
than yield a guest property request or produce a state-losing record. An
unbranded null-prototype record still clones with its self-cycle intact.

- Node 22: 29 tests pass across the new graph regressions, SDK weak cloning,
  finalization-state tests and weak-collection accounting (b90c98).
- Node 18.20.8: all five direct graph tests pass, without skips (16d984).
- Scoped ESLint (c86b92) and package TypeScript (ce877d) pass.

No timeout thresholds or GC assumptions changed. Intl requested-options
accounting remains outside this commit. Public weak-state globals and snapshot
integration still require separate reconciliation. This is not a full-suite
green result or complete weak-reference portability. No push or release under
the active hold.
