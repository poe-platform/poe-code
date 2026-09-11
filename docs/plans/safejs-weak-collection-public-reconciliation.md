# WeakMap and WeakSet public integration

## Scope and evidence

The committed builtin installer lacks WeakMap and WeakSet (34b768); their
private storage/accounting and clone rejection were committed separately.
Reconcile the existing public constructor/method implementation, builtin
installation, shared symbol-registry lookup and known-global linter entries.
WeakRef, FinalizationRegistry, Temporal and their linter entries remain separate.

Constructors implement iterable/adder dispatch, iterator closing and receiver
branding. Methods use private weak state, live-entry budgets and the shared
realm symbol registry. WeakMap includes getOrInsert and getOrInsertComputed,
with callback validation, reentrant insertion and Promise-result identity tests.
No strong-reference fallback is introduced for arbitrary symbol keys.

Object/Array globals must be created before the weak prototypes capture their
parent. An in-memory old-order/current-order comparison confirms both weak
prototype parents differ from Object.prototype under the old order and match
under the current order (d0e2fc). Two explicit parent-identity tests accompany
the installation change.

## Qualification

- Node 22 weak collections, realm ownership and symbol-registry cohort:
  123 tests across six files pass (e31dcd).
- Broader intrinsic/function-realm/weak-constructor cohort: 418 tests across
  23 files pass (06930b), before the two new parent-identity tests were added.
- Node 18.20.8 object-key constructor/realm cohort: 32 tests pass, including
  the new parent-identity tests, with no skips (57d2df).
- Node 26.8.1 collection and upsert cohort: 44 tests pass (fd2a14).
- Execution/lint parity: two tests pass (8d2889).
- Package TypeScript passes (38342e); initial scoped lint passes (235b56),
  and the final changed test/linter selection passes (23c677).

These working-tree integration tests also exercise still-uncommitted snapshot
and public features. They do not prove a standalone committed release or a
green full suite. Node 18 arbitrary unique-symbol weak keys remain unsupported;
the Node 18 selection above does not count those missing cases as passes.

README status distinguishes local public API integration from unresolved
portability and snapshot work. No push, release or issue closure under the hold.
