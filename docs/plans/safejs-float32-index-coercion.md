---
title: Float32Array indexed assignment conversion
---

# Float32Array indexed assignment conversion

Next independent gap after with: setFloat32Member invokes float32Number,
which explicitly rejects objects rather than performing guest ToNumber.
Validate with failing native comparisons before changing assignment behavior.

Cover guest valueOf/Symbol.toPrimitive, assignment expression identity, invalid
indexes that still convert values, resize/detachment during conversion,
resource retention and snapshots. Object.defineProperty uses a separate path
and must be independently validated rather than silently included.

All six native comparisons fail before implementation (1.10 seconds), with
the concrete primitive-only numeric argument TypeError. Published 2026
TypedArraySetElement section 10.4.5.18 requires ToNumber before current-index
validity checking, including indexes outside bounds and detached storage.
https://262.ecma-international.org/17.0/#sec-typedarraysetelement

Node 22 incorrectly drops an assignment when conversion grows the buffer to
make the index valid. Published 2026 TypedArray [[Set]] (10.4.5.6) directly
invokes TypedArraySetElement for the same receiver; conversion precedes index
validity. Node 24.14.0 confirms [0,7], not Node 22's [0,0]. That regression uses
the explicit spec result.

Implemented guest ToNumber in setFloat32Member with receiver/value retention
and propagated the resulting promise through setSandboxProperty. Ordinary
non-index writes remain synchronous. Updated the prior unsupported-conversion
test while preserving host accessor-import rejection without invoking accessors.

Verification: 20 conversion tests and all 871 selected tests across 54 files
pass (26.05 seconds), covering typed arrays, buffers, destructuring, loop writes,
Object.assign and generator assignments. Package TypeScript and exact-file
ESLint pass. The actual harness passed after 70 uncached build tasks (58.859
seconds), and its PNG was inspected. Zero spawns verifies runtime/schema rather
than model behavior. Built SDK Node 18.18.0 confirms conversion and assignment
identity. No matching open issue found. Property definition conversion remains
a separately validated gap (five failing tests), not included in this fix.
