---
title: Promise own then resolution
---

## Validated gap

Resolving a new promise with a sandbox promise ignored its own `then`
property. Five regression cases failed before the fix; same-constructor
`Promise.resolve` identity already passed.

## Implementation

Use ordinary thenable resolution when a promise has a `then` descriptor.
Keep the intrinsic path when no override exists. Preserve getter timing,
receiver identity, first settlement, rejection, and self-resolution checks.
Non-callable overrides fulfill with the original object, not its settlement.
This does not change native host-promise property import policy.

## Validation

Run the focused promise runtime, ordering, replay, and recovery tests, scoped
ESLint, SafeJS type checking, and the maintained SafeJS workspace build.
Run this pair through the real harness CLI and inspect its screenshot.
Commit and push this improvement independently, then monitor publication
while continuing with the next validated compatibility gap.
