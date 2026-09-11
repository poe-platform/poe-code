---
title: Float32Array reduceRight
---

# Float32Array reduceRight

Next independent improvement after reduce. The installer omits reduceRight;
validate the gap with failing native comparisons before implementation.

Published ECMAScript 2026 section 23.2.3.24 validates receiver and callback,
captures internal length, and traverses descending indices. An omitted initial
value seeds from the last element; explicit undefined is a provided seed.
Empty input without an initial value throws. Callback results remain arbitrary
values, including guest promises, without coercion or awaiting settlement.
https://262.ecma-international.org/17.0/#sec-%typedarray%.prototype.reduceright

Cover seed/callback semantics, reverse live reads, resize/detachment, error order,
promise identity, snapshots and accumulator retention/traversal limits. Reuse
the reduction path and keep this independent from reduce delivery.

Validated before implementation: 10 native comparisons fail and two coincidental
TypeError controls pass (917 milliseconds). RED log:
/tmp/poe-safejs-float32-reduce-right-red.log. The regression file remains
uncommitted until the independent reduceRight improvement is implemented.

Implementation extends the reduction path with reverse seed and traversal
indices. The accumulator remains retained without conversion or awaiting guest
promise settlement. Additional tests cover throwing then/valueOf accessors,
promise identity and job order, BigInt and negative-zero/NaN results, direct
detachment with a retained object accumulator, snapshots and traversal cleanup.
The harness is a zero-spawn runtime/schema check, not model behavior QA.

Verification: 650 focused Float32Array/ArrayBuffer tests passed in 42 files
(20.88 seconds), including 20 reduceRight tests. Package TypeScript and
exact-file ESLint passed. The actual harness completed 70 uncached build tasks
(60.064 seconds); its PNG was inspected and showed Harness passed, zero spawns.
Built SDK smoke passed on Node 18.18.0. No matching open GitHub issue was found.
The sort regression file was added after the passing suite and is intentionally
RED, outside this commit and passing claim.
