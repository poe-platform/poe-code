# Weak constructor prototype descriptors

## Validated defect

A read-only Node 26.8.1 comparison inspected own property attributes and
value/accessor kinds on standard constructors, prototypes, namespaces and Intl
constructors. Of 819 shared rows, four differ: WeakMap, WeakSet, WeakRef and
FinalizationRegistry have writable constructor prototype properties in SafeJS.
The bounded scan does not cover arbitrary behavior or absent API disposition.

The specification requires these properties to be non-writable,
non-enumerable and non-configurable:
[weak collections](https://tc39.es/ecma262/multipage/keyed-collections.html#sec-weakmap.prototype)
and [weak references](https://tc39.es/ecma262/multipage/managing-memory.html#sec-weak-ref.prototype).

Four new focused regressions compare native behavior and guest descriptors,
Reflect.set, Reflect.defineProperty and prototype identity, with replay checks
after a guest await. All four fail before implementation (517174): guest writes
and redefinitions succeed and replace the original prototype. The initial
failure prevents the later replay assertion from running; replay is not yet
qualified by this red result.

## Cause and intended repair

`materializeFunctionProperties` creates the ordinary constructable-function
prototype property with writable true. The three weak-global factories redefine
only its value. Omitted attributes on an existing descriptor retain their old
values; they do not default to false as on a new property.

Set writable false explicitly in weak-collections.ts, weak-ref.ts and
finalization-registry.ts. Do not change the ordinary function default, which is
correct for user constructors. Re-run the focused tests, weak constructor,
subclass/realm and snapshot controls, lint and type checks. Runtime files remain
unchanged while full-package session 66781 runs; apply the repair after its
terminal diagnostics are recorded. No fix, commit or delivery is claimed yet.

The added ordinary-function control passes unchanged, including replay and
construction after replacing its prototype. The focused file now reports four
failures and one pass (e51a6e). This confirms why changing the generic function
property default would be incorrect; keep the repair in the weak factories.

A separate Node 26.8.1 comparison of all eight Temporal constructors and their
prototypes plus Temporal.Now found 265 shared property rows, no mismatches and
no missing native keys in that selection (1976a3). It checked descriptor flags,
value/accessor kind and function-value name/length, not accessor behavior or
general Temporal conformance. No Temporal descriptor edit is justified.

## Implemented and focused verification

Full-package session 66781 terminated before the runtime edit. Each of the
three weak factories now explicitly sets writable false on its constructor
prototype property. The ordinary function factory is unchanged.

All 116 selected tests across nine files pass on Node 22.23.2 (6daf6c), covering
the new descriptor/replay regression, ordinary-function control, weak APIs,
subclasses, cross-realm prototypes and weak snapshot restoration. All five new
tests pass on Node 18.20.8 (a1347d). Scoped ESLint and package TypeScript checks
pass (bee91b). This is a focused repair, not a green full-package result; see
the separately recorded 34-failure pre-fix gate. Release hold remains active.
