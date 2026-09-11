---
title: Promise method constructor lookup
---

## Validated gap

Promise `then` and `finally` ignored own constructor descriptors. Six new tests
failed before implementation; two undefined-constructor compatibility checks
already passed. Native JavaScript rejects primitive constructors synchronously,
propagates getter errors, and reads constructors before returning or invoking
the `finally` receiver's own `then`.

## Implementation

Read constructor descriptors through existing guest accessor machinery. Retain
intrinsic/generic fallback only when absent. Gate `then` reaction registration
on successful validation, including interpreter-managed getter completion.
Do not mark the original promise observed before validation succeeds.

This fixes constructor lookup and validation, not full Promise species support.

## Validation and delivery

Run focused promise tests, scoped ESLint, SafeJS type checking, and the maintained
workspace build. Execute this harness pair with the real CLI and inspect its
screenshot. Commit and push independently; monitor publication while continuing
the next independently validated issue.
