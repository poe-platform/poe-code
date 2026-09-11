---
title: Float32Array with verification
---

# Float32Array with

Next independent improvement after toSorted. Validate missing method against
native execution before implementation; do not commit until verified.

Published ECMAScript 2026 section 23.2.3.36 captures initial length, converts the
index then replacement value, validates the index against current storage, then
copies initial-length elements into a fresh same-type result without species.
https://262.ecma-international.org/17.0/#sec-%typedarray%.prototype.with

Cover conversion order, negative/truncated indexes, bounds failures, resize
during conversion, source independence, species avoidance, detachment,
snapshots and resource limits. This does not add other typed-array types.

Validated before implementation: all nine native comparisons fail (1.35 seconds),
including conversion order, bounds error type and resize behavior. Keep these
RED tests separate from the verified toSorted commit.

Oracle correction: Node 22 converts replacement before index and rejects an
index made valid by growth during replacement conversion. Published 2026 and
Node 24.14.0 specify/confirm index-first conversion and current-storage validity
with original-length copying. Those two regressions use explicit spec results,
not Node 22's behavior.

Implemented with guest numeric conversion, initial receiver validation, current
index validity after conversion, and budgeted fresh storage. Verification:
18 method tests pass; all 736 focused Float32/ArrayBuffer tests across 46 files
pass (22.98 seconds). Package TypeScript and exact-file ESLint pass. Actual
harness pair passed after 70 uncached build tasks (61.391 seconds), and its
PNG was inspected. Zero spawns means runtime/schema coverage, not model testing.
Built SDK Node 18.18.0 smoke confirms negative index, object coercion order,
independent result and unchanged source. No matching open GitHub issue found.
