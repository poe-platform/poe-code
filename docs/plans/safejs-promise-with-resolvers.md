---
title: Promise.withResolvers
---

## Evidence and implementation

Eleven regressions failed because Promise.withResolvers was absent. Native Node
supports intrinsic and subclass capabilities. Expose the method through the
existing generic Promise capability construction path, preserving constructor
identity, resolver validation, and the promise/resolve/reject property order.
Use native method attributes and register it with the existing intrinsic setup.

The operation follows
[Promise.withResolvers](https://tc39.es/ecma262/multipage/control-abstraction-objects.html#sec-promise.withResolvers).
Do not call a mutable public Promise constructor method to manufacture resolvers.

## Validation and delivery

Cover fulfillment, rejection, first-settlement locking, thenable assimilation,
subclasses, generic constructors, invalid receivers, constructor exceptions,
method/result property metadata, and pending/completed public replay.
Run focused Promise regression files, scoped lint/types, the selected workspace
build, and this real CLI harness with screenshot inspection. No shared execution
path is changed, so targeted regressions cover this API addition.

Commit and push independently, then monitor publication while continuing with
the next validated limitation. Direct portable resolver-closure graph export and
complete JavaScript compatibility are not claimed by this change.

Local validation passed fifteen focused cases and 290 Promise regression tests
across ten files. Scoped lint and type checking passed. The separate native
Promise import-policy regressions were not part of this focused run.
