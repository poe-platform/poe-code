---
title: Promise finally own then lookup
---

## Validated gap

Promise receivers' own `then` descriptors were ignored by `finally`.
Eight tests failed before the fix: direct overrides, getter timing and receiver
identity, three non-callable values, getter errors, and fulfillment/rejection
cleanup wrappers invoked by an overridden method.

## Change

Read an existing `then` descriptor with the guest accessor machinery after the
existing constructor validation, falling back to intrinsic/generic lookup only
when no descriptor exists. Keep custom method return values and synchronous
errors intact. This does not claim complete Promise species or constructor
compatibility; those need separate validation and implementation.

## Validation and delivery

Run the focused promise regression suite, scoped ESLint, SafeJS type checking,
and maintained workspace build. Run this pair through the real CLI and inspect
its screenshot. Commit and push independently to main, then monitor release
publication while working on the next validated issue.
