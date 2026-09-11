---
title: Promise function metadata
---

## Validated gap

All nine public Promise methods exposed incorrect argument counts and lacked
native-compatible own name/length descriptors. Redefinition was rejected as a
host-function write. Twelve tests failed before implementation, including
native JavaScript descriptor comparisons.

## Change

Declare method arities and use guest function metadata for static and prototype
methods. Register their intrinsic state, including non-enumerable prototype
methods, without changing invocation behavior. Names and lengths are
non-writable, non-enumerable, and configurable; methods are not constructors.

## Validation

Verify all method descriptors, metadata redefinition, unchanged call results,
and pending/completed replay checkpoints. Run focused promise compatibility,
ordering, recovery, replay, and species tests, scoped ESLint, type checking,
and the maintained selected workspace build. Execute this harness pair through
the real CLI and inspect its screenshot before an independent commit and push.
Monitor publication alongside the next validated issue.
