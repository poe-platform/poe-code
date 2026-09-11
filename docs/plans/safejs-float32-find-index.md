---
title: Float32Array findIndex
---

# Float32Array findIndex

Next independent improvement after locale formatting commit 6003e2715.
Published ECMAScript 2026 section 23.2.3.12 requires initial typed-array
validation, captured internal length, ascending FindViaPredicate, and return of
its index. Source inspection shows no findIndex installation in Float32 methods.
https://262.ecma-international.org/17.0/#sec-%typedarray%.prototype.findindex

Native-comparison tests cover first match,
empty/no match, callback arguments/thisArg and truthiness, mutation, resizing,
errors and invalid callbacks. Additional tests cover snapshot round-trips,
promise truthiness and job order, direct callback detachment, retained backing
storage and traversal limits.
Keep changes separate from the already delivered locale formatting fix.

Validated before implementation: built SDK throws TypeError where native returns
index 1. Regression suite has 10 failing comparisons and one coincidental
invalid-callback control passing (1.30 seconds), recorded in
/tmp/poe-safejs-float32-find-index-red.log.

The implementation extends the existing callback traversal and returns the
matching index or -1, with initial receiver validation and callback validation
even for empty arrays. The paired harness checks runtime/schema behavior without
spawning a model; it does not prove model behavior.

Verification: 528 focused Float32Array/ArrayBuffer tests passed in 36 files
(19.13 seconds), including 15 findIndex tests. Package TypeScript and exact-file
ESLint passed. The actual harness completed 70 uncached build tasks (58.933
seconds); its PNG was inspected and showed Harness passed with zero spawns.
Built SDK smoke also passed on Node 18.18.0. No matching open issue was found.
The separately prepared findLast regression file was added after this focused
suite and is intentionally RED; it is not part of this commit or passing claim.
