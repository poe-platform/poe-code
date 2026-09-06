---
title: Custom Promise prototypes
---

## Evidence and implementation

Nine runtime tests failed before implementation. Promise instances now support
custom/null prototypes and can themselves serve as prototypes. Extensibility
checks use their guest property tables rather than frozen host wrappers. Cycles
are rejected and unchanged prototypes remain valid on non-extensible instances.

Property and resolution fallback paths respect explicit prototypes: missing
then/constructor properties do not reappear from the intrinsic prototype.
An original then method can still observe internal settlement after mutation.

Null prototypes are preserved on native export. Managed non-null prototype
graphs remain rejected by the existing data-only export boundary; unrestricted
graph export and direct portable promise heap serialization are not claimed.

## Replay boundaries

Trusted in-memory run snapshots retain ordinary promise runtime metadata while
replaying source to reconstruct guest properties/prototypes. They must not omit
promise values needed by captured closures. Arbitrary/copied snapshot roots
still reject managed promises. Tests cover pending/completed checkpoints and
completed host effects being replayed without reissue.

## Validation and delivery

Sixteen focused tests include mutation, lookup, frozen/sealed objects, cycles,
accessors, brand separation, replay, native export, forged roots, and retained
data budgets. The promise regression cohort passes 222 tests. Run the maintained
workspace unit route, excluding only the pending uncommitted host-import policy
tests (never count those as passes), then scoped lint/types, the selected build,
and this real CLI harness with screenshot inspection.

Commit and push independently; monitor publication while continuing with the
next validated limitation. Promise subclass construction remains a separate
compatibility investigation.

Local validation: the maintained workspace run passed 16,755 tests with 41
skips. That run started before the separate subclass-construction regression
file was added; its two failures are not part of this commit or the green count.
Scoped lint and type checking passed.
