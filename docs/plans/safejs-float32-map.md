---
title: Float32Array map
---

# Float32Array map

Next independent improvement after findLastIndex. The method installer does not
expose map. Validate behavior with failing native comparisons before fixing it.

Published ECMAScript 2026 section 23.2.3.22 requires initial typed-array validation
and captured internal length, callback validation, then TypedArraySpeciesCreate
before any callbacks. Each callback result is written with typed-array numeric
conversion; source reads remain live and iteration uses the initial length.
https://262.ecma-international.org/17.0/#sec-%typedarray%.prototype.map

Cover thisArg/arguments, rounding, empty arrays, callback-result object coercion,
species lookup/order/result size and aliasing, resizing/detachment, promise
results, snapshots and allocation/traversal/retention limits. Reuse existing
species semantics without duplicating that algorithm. This does not by itself
add other typed-array element types, which remain a separate completeness gap.

Validated before implementation: 10 native comparisons fail and two coincidental
TypeError controls pass (1.27 seconds). RED log:
/tmp/poe-safejs-float32-map-red.log. The map regression suite remains uncommitted
until this separate improvement is implemented and verified.

Implementation shares species lookup/allocation with slice/subarray, validating
the callback before lookup and validating custom result length before traversal.
Each live source element is mapped and converted with sandboxNumber; mapped
objects remain retained through conversion. Tests include overlapping species
storage, source/target resize, invalid species and numeric conversion errors,
promise ordering, direct source detachment, snapshots and budget cleanup.

Allocation checks distinguish direct method calls after realm cleanup (output
allocation limit) from interpreted execution (combined source and output data).
An initial direct-call test incorrectly expected automatic accounting for a
host-created input; the interpreted check confirms combined storage is charged.
No budget implementation change was justified by that test assumption.
The harness is a zero-spawn runtime/schema check, not proof of model behavior.

Verification: 585 focused Float32Array/ArrayBuffer tests passed in 39 files
(19.63 seconds), including 26 map tests. Package TypeScript and exact-file ESLint
passed. The actual harness completed 70 uncached build tasks (60.246 seconds);
its PNG was inspected and showed Harness passed with zero spawns. Built SDK
Node 18.18.0 smoke verified default subclass species and object-result coercion.
No matching open GitHub issue was found. The filter regression file was added
after the passing suite and is intentionally RED, outside this commit/claim.
