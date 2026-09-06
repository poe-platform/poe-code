---
title: Promise catch own then lookup
---

## Validated gap

`Promise.catch` ignored a promise receiver's own `then` descriptor and called
the intrinsic method instead. Six tests failed before implementation, covering
method overrides, getter timing and receiver identity, non-callable values,
and synchronous propagation of getter errors.

## Change and checks

Read a present descriptor through the existing guest accessor machinery before
falling back to the intrinsic or generic receiver lookup. Preserve the result
of the invoked method without wrapping it in another promise.

Run focused promise compatibility, constructor, ordering, and replay tests,
scoped lint and type checking, and the maintained SafeJS workspace build.
Run this harness pair through the actual CLI and inspect its screenshot.
Push this atomic change to main and monitor publication without pausing the
next validated issue. Promise finally and constructor-property behavior remain
separate compatibility investigations.
