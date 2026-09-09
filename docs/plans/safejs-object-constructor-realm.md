# Object constructor realm identity

## Validated issue

Six tests failed before the change: Object(), Object(null), Object(undefined),
new Object(), and new Object(null) resolved to the observing SDK realm's
prototype, and modified originating chains were silently dropped by data copy.
The existing-object identity control passed before the change.

## Change

The null/undefined construction branch stores its captured Object.prototype
on the new record. Existing object inputs remain untouched. Derived
construction can still override that default with newTarget.prototype.
Primitive boxing is deliberately tracked as a separate unresolved gap.

## Verification

The initial object selection passed 476 tests across 23 files. Added native
VM controls for custom, null, and numeric newTarget.prototype values verify
that derived construction ignores its object argument and allocates a new
object. Scoped ESLint passed; the maintained build completed 23 workspace
builds and four fresh-process import checks. A built SDK probe now matches
native Object() creation-realm identity. The final constructor/snapshot
selection passed 1,710 tests across 128 files; package TypeScript checks
passed after the build. This is not a fresh full-package gate.
No visual CLI change, push, or release.

## Follow-up evidence

The same built SDK probe exported a factory and inspected its result with
another run's Object.getPrototypeOf. Both object rest (`const {...r}={a:7}`)
and array rest (`const [...r]=[7]`) failed originating prototype identity,
where native VM controls passed. Both allocation paths in patterns.ts lack
stored default links. They need regression tests and a separate fix.
